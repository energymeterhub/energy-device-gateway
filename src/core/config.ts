import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPassword, normalizeLegacyPasswordHash } from './auth.js';
import { createDefaultConfig, getDefaultMeterPort, normalizeMeterType } from './defaults.js';
import type { ConfigResponse, FirmwareInfo, GatewayConfig, MeterConfig } from './types.js';

type UnknownRecord = Record<string, unknown>;

function asObject(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as UnknownRecord;
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : fallback;
}

function validateHost(host: string): void {
  if (host.length === 0) {
    throw new Error('Meter host is required');
  }

  if (host.includes('://') || host.includes('/') || host.includes('?') || host.includes('#')) {
    throw new Error('Meter host must be a host or IP only');
  }

  const bracketedIpv6 = /^\[[^[\]]+\]$/;
  if (!bracketedIpv6.test(host) && host.includes(':')) {
    throw new Error('Meter host must not include a port');
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Meter port must be between 1 and 65535');
  }
}

function validateDestinationAddress(address: string): void {
  try {
    const url = new URL(address);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Destination address must use http or https');
    }
  } catch {
    throw new Error('Destination address must be a valid URL');
  }
}

export function normalizeConfig(input: unknown, previous = createDefaultConfig()): GatewayConfig {
  const raw = asObject(input, 'Config');
  const defaults = createDefaultConfig();
  const wifi = raw.wifi == null ? {} : asObject(raw.wifi, 'wifi');
  const meter = raw.meter == null ? {} : asObject(raw.meter, 'meter');
  const cloud = raw.cloud == null ? {} : asObject(raw.cloud, 'cloud');
  const destination = raw.destination == null ? {} : asObject(raw.destination, 'destination');
  const device = raw.device == null ? {} : asObject(raw.device, 'device');
  const auth = raw.auth == null ? {} : asObject(raw.auth, 'auth');

  const legacyAuthPassword = typeof auth.password === 'string' ? auth.password.trim() : '';
  const normalizedAuthPasswordHash = normalizeLegacyPasswordHash(
    typeof auth.passwordHash === 'string' ? auth.passwordHash : null
  );
  const previousAuthPasswordHash = normalizeLegacyPasswordHash(previous.auth.passwordHash);

  const meterType = normalizeMeterType(normalizeString(meter.type, previous.meter.type));
  const meterPort = normalizeInteger(
    meter.port,
    previous.meter.port || getDefaultMeterPort(meterType)
  );

  const destinationTypeRaw = normalizeString(destination.type, previous.destination.type);
  const destinationType =
    destinationTypeRaw === 'NONE' ||
    destinationTypeRaw === 'IAMMETER_CLOUD' ||
    destinationTypeRaw === 'IAMMETER_LOCAL'
      ? destinationTypeRaw
      : defaults.destination.type;

  const config: GatewayConfig = {
    version: normalizeInteger(raw.version, defaults.version),
    wifi: {
      ssid: normalizeString(wifi.ssid, previous.wifi.ssid),
      password:
        typeof wifi.password === 'string'
          ? wifi.password || previous.wifi.password
          : previous.wifi.password
    },
    meter: {
      type: meterType,
      host: normalizeString(meter.host, previous.meter.host),
      port: meterPort,
      unit_id: normalizeInteger(meter.unit_id, previous.meter.unit_id || defaults.meter.unit_id),
      timeout_ms: normalizeInteger(
        meter.timeout_ms,
        previous.meter.timeout_ms || defaults.meter.timeout_ms
      )
    },
    cloud: {
      server: normalizeString(cloud.server, previous.cloud.server),
      sn: normalizeString(cloud.sn, previous.cloud.sn)
    },
    destination: {
      type: destinationType,
      address: normalizeString(destination.address, previous.destination.address),
      sn: normalizeString(destination.sn, previous.destination.sn || previous.cloud.sn)
    },
    device: {
      device_name: normalizeString(device.device_name, previous.device.device_name)
    },
    auth: {
      passwordHash:
        normalizedAuthPasswordHash ||
        (legacyAuthPassword ? hashPassword(legacyAuthPassword) : '') ||
        previousAuthPasswordHash ||
        defaults.auth.passwordHash
    }
  };

  if (config.destination.type === 'IAMMETER_CLOUD') {
    config.destination.address = '';
  }

  return config;
}

export function validateMeterConfig(config: MeterConfig): void {
  if (!config.host) {
    return;
  }

  validateHost(config.host);
  validatePort(config.port);
}

export function validateGatewayConfig(config: GatewayConfig): void {
  validateMeterConfig(config.meter);

  if (config.destination.type === 'IAMMETER_LOCAL') {
    if (!config.destination.address) {
      throw new Error('Local destination address is required');
    }
    validateDestinationAddress(config.destination.address);
  }
}

export async function loadConfig(configPath: string): Promise<GatewayConfig> {
  try {
    const content = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    const normalized = normalizeConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveConfig(configPath, normalized);
    }
    return normalized;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      const defaults = createDefaultConfig();
      await saveConfig(configPath, defaults);
      return defaults;
    }

    throw error;
  }
}

export async function saveConfig(configPath: string, config: GatewayConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function resetConfig(configPath: string): Promise<GatewayConfig> {
  await rm(configPath, { force: true });
  const defaults = createDefaultConfig();
  await saveConfig(configPath, defaults);
  return defaults;
}

export function toConfigResponse(config: GatewayConfig, firmware: FirmwareInfo): ConfigResponse {
  return {
    version: config.version,
    wifi: {
      ssid: config.wifi.ssid,
      password: ''
    },
    ap_mode: false,
    hide_monitor_ui: false,
    meter: {
      type: config.meter.type,
      host: config.meter.host,
      port: config.meter.port
    },
    cloud: {
      server: config.cloud.server,
      sn: config.cloud.sn
    },
    destination: {
      type: config.destination.type,
      address: config.destination.address,
      sn: config.destination.sn
    },
    device: config.device,
    firmware
  };
}
