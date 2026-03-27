import { createBaseMeterData, type MeterDriver } from './base.js';
import type { MeterConfig } from '../core/types.js';

function derivePowerFactor(voltage: number, current: number, activePower: number): number {
  if (voltage <= 0 || current <= 0) {
    return 0;
  }

  const apparentPower = voltage * current;
  if (apparentPower <= 0) {
    return 0;
  }

  const powerFactor = activePower / apparentPower;
  return Math.max(-1, Math.min(1, powerFactor));
}

function getNumber(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function fetchJson(baseUrl: string, path: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Expected JSON object payload');
    }

    return payload as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export class Shelly3emDriver implements MeterDriver {
  readonly type = 'SHELLY_3EM' as const;

  private readonly baseUrl: string;
  private readonly config: MeterConfig;

  constructor(config: MeterConfig) {
    this.config = config;
    this.baseUrl = `http://${config.host}:${config.port}`;
  }

  async validate(): Promise<void> {
    const payload = await fetchJson(this.baseUrl, '/rpc/EM.GetStatus?id=0', this.config.timeout_ms);
    if (getNumber(payload, 'id', -1) !== 0) {
      throw new Error('Unexpected Shelly Pro 3EM EM status payload');
    }
  }

  async read() {
    const emStatus = await fetchJson(this.baseUrl, '/rpc/EM.GetStatus?id=0', this.config.timeout_ms);
    const emData = await fetchJson(this.baseUrl, '/rpc/EMData.GetStatus?id=0', this.config.timeout_ms);
    const data = createBaseMeterData(this.config, 'Shelly Pro 3EM');

    const readPhase = (
      voltageKey: string,
      currentKey: string,
      powerKeys: string[],
      forwardEnergyKey: string,
      reverseEnergyKey: string
    ) => {
      const voltage = getNumber(emStatus, voltageKey);
      const current = getNumber(emStatus, currentKey);
      const activePower = Math.round(
        powerKeys.map((key) => getNumber(emStatus, key, Number.NaN)).find((value) => !Number.isNaN(value)) ?? 0
      );

      return {
        voltage,
        current,
        active_power: activePower,
        reactive_power: 0,
        forward_energy: getNumber(emData, forwardEnergyKey) / 1000,
        reverse_energy: getNumber(emData, reverseEnergyKey) / 1000,
        power_factor: derivePowerFactor(voltage, current, activePower)
      };
    };

    data.phase_a = readPhase(
      'a_voltage',
      'a_current',
      ['a_act_power'],
      'a_total_act_energy',
      'a_total_act_ret_energy'
    );
    data.phase_b = readPhase(
      'b_voltage',
      'b_current',
      ['b_act_power'],
      'b_total_act_energy',
      'b_total_act_ret_energy'
    );
    data.phase_c = readPhase(
      'c_voltage',
      'c_current',
      ['c_active_power', 'c_act_power'],
      'c_total_act_energy',
      'c_total_act_ret_energy'
    );

    data.frequency = getNumber(emStatus, 'freq', getNumber(emStatus, 'frequency', 0));
    data.total_power = data.phase_a.active_power + data.phase_b.active_power + data.phase_c.active_power;
    data.total_forward_energy =
      data.phase_a.forward_energy + data.phase_b.forward_energy + data.phase_c.forward_energy;
    data.total_reverse_energy =
      data.phase_a.reverse_energy + data.phase_b.reverse_energy + data.phase_c.reverse_energy;

    return data;
  }
}
