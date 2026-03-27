import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { verifyPassword } from '../src/core/auth.js';
import { createServer } from '../src/server/create-server.js';
import type { FirmwareInfo, RuntimeOptions } from '../src/core/types.js';

const firmware: FirmwareInfo = {
  project: 'energy-device-gateway',
  version: '0.1.0-test',
  idf: 'nodejs',
  build_date: '2026-03-27',
  build_time: '10:00:00'
};

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw ? (raw.split(';', 1)[0] ?? '') : '';
}

async function createTestApp(overrides: Partial<RuntimeOptions> = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'energy-device-gateway-'));
  const runtimeOptions: RuntimeOptions = {
    configPath: path.join(tempDir, 'config.json'),
    host: '127.0.0.1',
    port: 0,
    pollIntervalMs: 60_000,
    uploadIntervalMs: 60_000,
    selfRestartEnabled: false,
    authPassword: null,
    authPasswordHash: null,
    ...overrides
  };

  const app = await createServer({
    runtimeOptions,
    firmware
  });

  return { app, runtimeOptions, tempDir };
}

test('bootstrap initializes the administrator password and persists only a hash', async (t) => {
  const { app, runtimeOptions, tempDir } = await createTestApp();
  t.after(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  const sessionBefore = await app.inject({
    method: 'GET',
    url: '/api/auth/session'
  });
  assert.equal(sessionBefore.statusCode, 200);
  assert.equal(sessionBefore.json().authConfigured, false);
  assert.equal(sessionBefore.json().setupRequired, true);

  const bootstrap = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    headers: {
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      newPassword: 'bootstrap-pass',
      confirmPassword: 'bootstrap-pass'
    })
  });

  assert.equal(bootstrap.statusCode, 200);
  const cookie = extractCookie(bootstrap.headers['set-cookie']);
  assert.match(cookie, /^energy_device_gateway_session=/);

  const runtimeStatus = await app.inject({
    method: 'GET',
    url: '/api/runtime/status',
    headers: {
      cookie
    }
  });

  assert.equal(runtimeStatus.statusCode, 200);
  assert.equal(runtimeStatus.json().authConfigured, true);

  const config = JSON.parse(await readFile(runtimeOptions.configPath, 'utf8')) as {
    auth?: { password?: string; passwordHash?: string };
  };
  assert.equal(typeof config.auth?.password, 'undefined');
  assert.equal(typeof config.auth?.passwordHash, 'string');
  assert.equal(verifyPassword('bootstrap-pass', config.auth?.passwordHash), true);
});

test('password rotation updates the stored hash and invalidates the previous password', async (t) => {
  const { app, runtimeOptions, tempDir } = await createTestApp();
  t.after(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  const bootstrap = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    headers: {
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      newPassword: 'bootstrap-pass',
      confirmPassword: 'bootstrap-pass'
    })
  });
  const cookie = extractCookie(bootstrap.headers['set-cookie']);

  const rotate = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: {
      'content-type': 'application/json',
      cookie
    },
    payload: JSON.stringify({
      currentPassword: 'bootstrap-pass',
      newPassword: 'rotated-password',
      confirmPassword: 'rotated-password'
    })
  });

  assert.equal(rotate.statusCode, 200);

  const config = JSON.parse(await readFile(runtimeOptions.configPath, 'utf8')) as {
    auth?: { passwordHash?: string };
  };
  assert.equal(verifyPassword('bootstrap-pass', config.auth?.passwordHash), false);
  assert.equal(verifyPassword('rotated-password', config.auth?.passwordHash), true);
});
