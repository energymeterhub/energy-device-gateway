import { getMeterProtocol } from '../core/defaults.js';
import type { MeterConfig, MeterType, NormalizedMeterData, PhaseData } from '../core/types.js';

export interface MeterDriver {
  readonly type: MeterType;
  validate(): Promise<void>;
  read(): Promise<NormalizedMeterData>;
}

export function createEmptyPhase(): PhaseData {
  return {
    voltage: 0,
    current: 0,
    active_power: 0,
    reactive_power: 0,
    forward_energy: 0,
    reverse_energy: 0,
    power_factor: 0
  };
}

export function createBaseMeterData(config: MeterConfig, model: string): NormalizedMeterData {
  return {
    type: config.type,
    protocol: getMeterProtocol(config.type),
    model,
    timestamp: Math.floor(Date.now() / 1000),
    phase_a: createEmptyPhase(),
    phase_b: createEmptyPhase(),
    phase_c: createEmptyPhase(),
    frequency: 0,
    total_power: 0,
    total_forward_energy: 0,
    total_reverse_energy: 0,
    valid_phases: 0x07
  };
}
