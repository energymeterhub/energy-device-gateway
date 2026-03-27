import { createBaseMeterData, type MeterDriver } from './base.js';
import { ModbusTcpClient } from '../modbus/client.js';
import type { MeterConfig } from '../core/types.js';

const SUNSPEC_SIGNATURE_START = 40000;
const SUNSPEC_COMMON_START = 40002;
const SUNSPEC_COMMON_SIZE = 68;
const SUNSPEC_INV103_START = 40070;
const SUNSPEC_INV103_SIZE = 52;

function regToInt16(value: number): number {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer.readInt16BE(0);
}

function regsToUint32(high: number, low: number): number {
  return high * 0x10000 + low;
}

function applyScale(raw: number, scaleFactor: number): number {
  return raw * 10 ** scaleFactor;
}

function readAsciiWords(registers: number[]): string {
  const chars: string[] = [];

  for (const register of registers) {
    const left = String.fromCharCode((register >> 8) & 0xff);
    const right = String.fromCharCode(register & 0xff);
    if (left !== '\0') {
      chars.push(left);
    }
    if (right !== '\0') {
      chars.push(right);
    }
  }

  return chars.join('').trim();
}

export class FroniusSunSpecDriver implements MeterDriver {
  readonly type = 'FRONIUS_SUNSPEC' as const;

  private readonly client: ModbusTcpClient;
  private readonly config: MeterConfig;

  constructor(config: MeterConfig) {
    this.config = config;
    this.client = new ModbusTcpClient({
      host: config.host,
      port: config.port,
      unitId: config.unit_id,
      timeoutMs: config.timeout_ms
    });
  }

  async validate(): Promise<void> {
    const signature = await this.client.readRegisters('holding', SUNSPEC_SIGNATURE_START, 2);
    if (signature[0] !== 0x5375 || signature[1] !== 0x6e53) {
      throw new Error('SunSpec signature not found at holding register 40000');
    }
  }

  async read() {
    await this.validate();

    const common = await this.client.readRegisters('holding', SUNSPEC_COMMON_START, SUNSPEC_COMMON_SIZE);
    const inv = await this.client.readRegisters('holding', SUNSPEC_INV103_START, SUNSPEC_INV103_SIZE);

    if (common[0] !== 1 || inv[0] !== 103) {
      throw new Error(`Unexpected SunSpec model chain common=${common[0]} inverter=${inv[0]}`);
    }

    const currentSf = regToInt16(inv[6] ?? 0);
    const voltageSf = regToInt16(inv[13] ?? 0);
    const powerSf = regToInt16(inv[15] ?? 0);
    const frequencySf = regToInt16(inv[17] ?? 0);
    const energySf = regToInt16(inv[26] ?? 0);

    const manufacturer = readAsciiWords(common.slice(2, 10));
    const model = readAsciiWords(common.slice(10, 18));
    const deviceModel = manufacturer && model ? `${manufacturer} ${model}` : model || 'Fronius SunSpec';

    const data = createBaseMeterData(this.config, deviceModel);
    data.phase_a.current = applyScale(inv[3] ?? 0, currentSf);
    data.phase_b.current = applyScale(inv[4] ?? 0, currentSf);
    data.phase_c.current = applyScale(inv[5] ?? 0, currentSf);
    data.phase_a.voltage = applyScale(inv[10] ?? 0, voltageSf);
    data.phase_b.voltage = applyScale(inv[11] ?? 0, voltageSf);
    data.phase_c.voltage = applyScale(inv[12] ?? 0, voltageSf);
    data.total_power = Math.round(applyScale(inv[14] ?? 0, powerSf));
    data.frequency = applyScale(inv[16] ?? 0, frequencySf);
    data.total_forward_energy = applyScale(regsToUint32(inv[24] ?? 0, inv[25] ?? 0), energySf) / 1000;
    data.total_reverse_energy = 0;

    const basePhasePower = Math.trunc(data.total_power / 3);
    data.phase_a.active_power = basePhasePower;
    data.phase_b.active_power = basePhasePower;
    data.phase_c.active_power = data.total_power - basePhasePower - basePhasePower;

    const phaseEnergy = data.total_forward_energy / 3;
    data.phase_a.forward_energy = phaseEnergy;
    data.phase_b.forward_energy = phaseEnergy;
    data.phase_c.forward_energy = phaseEnergy;

    return data;
  }
}
