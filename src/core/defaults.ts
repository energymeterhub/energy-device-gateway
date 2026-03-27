import type { GatewayConfig, MeterProtocol, MeterType, MeterTypeAlias } from './types.js';

const METER_TYPE_ALIASES: Record<MeterTypeAlias, MeterType> = {
  IAMMETER_WEM3080T: 'IAMMETER_WEM3080T',
  IAMMETER: 'IAMMETER_WEM3080T',
  FRONIUS_SUNSPEC: 'FRONIUS_SUNSPEC',
  FRONIUS: 'FRONIUS_SUNSPEC',
  FRONIUS_GEN24: 'FRONIUS_SUNSPEC',
  SHELLY_3EM: 'SHELLY_3EM',
  SHELLY: 'SHELLY_3EM',
  SHELLY_PRO_3EM: 'SHELLY_3EM'
};

const DEFAULT_PORTS: Record<MeterType, number> = {
  IAMMETER_WEM3080T: 502,
  FRONIUS_SUNSPEC: 502,
  SHELLY_3EM: 80
};

const METER_PROTOCOLS: Record<MeterType, MeterProtocol> = {
  IAMMETER_WEM3080T: 'modbus-tcp',
  FRONIUS_SUNSPEC: 'modbus-tcp',
  SHELLY_3EM: 'http'
};

export function normalizeMeterType(value: string | undefined | null): MeterType {
  if (!value) {
    return 'IAMMETER_WEM3080T';
  }

  const resolved = METER_TYPE_ALIASES[value as MeterTypeAlias];
  if (!resolved) {
    throw new Error(`Unsupported meter type "${value}"`);
  }

  return resolved;
}

export function getDefaultMeterPort(type: MeterType): number {
  return DEFAULT_PORTS[type];
}

export function getMeterProtocol(type: MeterType): MeterProtocol {
  return METER_PROTOCOLS[type];
}

export function createDefaultConfig(): GatewayConfig {
  return {
    version: 4,
    wifi: {
      ssid: '',
      password: ''
    },
    meter: {
      type: 'IAMMETER_WEM3080T',
      host: '',
      port: 502,
      unit_id: 1,
      timeout_ms: 5000
    },
    cloud: {
      server: 'https://www.iammeter.com',
      sn: ''
    },
    destination: {
      type: 'IAMMETER_CLOUD',
      address: '',
      sn: ''
    },
    device: {
      device_name: 'energy_device_gateway'
    },
    auth: {
      passwordHash: ''
    }
  };
}
