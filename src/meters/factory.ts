import type { MeterDriver } from './base.js';
import { FroniusSunSpecDriver } from './fronius-sunspec.js';
import { IammeterDriver } from './iammeter.js';
import { Shelly3emDriver } from './shelly-3em.js';
import type { MeterConfig } from '../core/types.js';

export function createMeterDriver(config: MeterConfig): MeterDriver {
  switch (config.type) {
    case 'IAMMETER_WEM3080T':
      return new IammeterDriver(config);
    case 'FRONIUS_SUNSPEC':
      return new FroniusSunSpecDriver(config);
    case 'SHELLY_3EM':
      return new Shelly3emDriver(config);
    default:
      throw new Error(`Unsupported meter type ${(config as MeterConfig).type}`);
  }
}
