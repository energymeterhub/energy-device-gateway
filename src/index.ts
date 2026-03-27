import path from 'node:path';
import { isSupportedPasswordHash } from './core/auth.ts';
import { createServer } from './server/create-server.ts';
import type { FirmwareInfo, RuntimeOptions } from './core/types.ts';

const firmware: FirmwareInfo = {
  project: 'energy-device-gateway',
  version: process.env.npm_package_version || '0.1.0',
  idf: 'nodejs',
  build_date: new Date().toISOString().slice(0, 10),
  build_time: new Date().toISOString().slice(11, 19)
};

const authPasswordHash = process.env.ENERGY_DEVICE_GATEWAY_PASSWORD_HASH || null;
if (authPasswordHash && !isSupportedPasswordHash(authPasswordHash)) {
  throw new Error('ENERGY_DEVICE_GATEWAY_PASSWORD_HASH must use a supported hash format');
}

const runtimeOptions: RuntimeOptions = {
  configPath: process.env.ENERGY_DEVICE_GATEWAY_CONFIG_PATH || path.join(process.cwd(), 'data/config.json'),
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8080),
  pollIntervalMs: Number(process.env.ENERGY_DEVICE_GATEWAY_POLL_INTERVAL_MS || 5000),
  uploadIntervalMs: Number(process.env.ENERGY_DEVICE_GATEWAY_UPLOAD_INTERVAL_MS || 60_000),
  selfRestartEnabled: process.env.ENERGY_DEVICE_GATEWAY_SELF_RESTART === 'true',
  authPassword: process.env.ENERGY_DEVICE_GATEWAY_PASSWORD || null,
  authPasswordHash
};

const app = await createServer({
  runtimeOptions,
  firmware
});

await app.listen({
  host: runtimeOptions.host,
  port: runtimeOptions.port
});
