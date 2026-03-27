import { createBaseMeterData, type MeterDriver } from './base.js';
import { ModbusTcpClient } from '../modbus/client.js';
import type { MeterConfig } from '../core/types.js';

function regsToInt32(high: number, low: number): number {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(high, 0);
  buffer.writeUInt16BE(low, 2);
  return buffer.readInt32BE(0);
}

function regsToUint32(high: number, low: number): number {
  return high * 0x10000 + low;
}

export class IammeterDriver implements MeterDriver {
  readonly type = 'IAMMETER_WEM3080T' as const;

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
    await this.read();
  }

  async read() {
    const regs = await this.client.readRegisters('holding', 0, 38);
    const modelNumber = regs[9] ?? 0;
    const data = createBaseMeterData(
      this.config,
      modelNumber === 2 ? 'WEM3080T' : `IAMMETER-${modelNumber}`
    );

    const parsePhase = (offset: number) => ({
      voltage: (regs[offset] ?? 0) / 100,
      current: (regs[offset + 1] ?? 0) / 100,
      active_power: regsToInt32(regs[offset + 2] ?? 0, regs[offset + 3] ?? 0),
      reactive_power: 0,
      forward_energy: regsToUint32(regs[offset + 4] ?? 0, regs[offset + 5] ?? 0) / 800,
      reverse_energy: regsToUint32(regs[offset + 6] ?? 0, regs[offset + 7] ?? 0) / 800,
      power_factor: (regs[offset + 8] ?? 0) / 1000
    });

    data.phase_a = parsePhase(0);
    data.phase_b = parsePhase(10);
    data.phase_c = parsePhase(20);
    data.frequency = (regs[30] ?? 0) / 100;
    data.total_power = regsToInt32(regs[32] ?? 0, regs[33] ?? 0);
    data.total_forward_energy = regsToUint32(regs[34] ?? 0, regs[35] ?? 0) / 800;
    data.total_reverse_energy = regsToUint32(regs[36] ?? 0, regs[37] ?? 0) / 800;

    return data;
  }
}
