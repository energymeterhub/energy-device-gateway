import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/core/defaults.js';
import { toUploadPayload, resolveUploadUrl } from '../src/core/upload.js';
import type { NormalizedMeterData } from '../src/core/types.js';

function createReading(): NormalizedMeterData {
  return {
    type: 'IAMMETER_WEM3080T',
    protocol: 'modbus-tcp',
    model: 'WEM3080T',
    timestamp: 1,
    phase_a: {
      voltage: 230.1,
      current: 5.2,
      active_power: 1120,
      reactive_power: 0,
      forward_energy: 12.4,
      reverse_energy: 0.2,
      power_factor: 0.94
    },
    phase_b: {
      voltage: 229.8,
      current: 5.1,
      active_power: 1100,
      reactive_power: 0,
      forward_energy: 12,
      reverse_energy: 0.1,
      power_factor: 0.95
    },
    phase_c: {
      voltage: 231.2,
      current: 5,
      active_power: 1090,
      reactive_power: 0,
      forward_energy: 11.8,
      reverse_energy: 0,
      power_factor: 0.96
    },
    frequency: 49.98,
    total_power: 3310,
    total_forward_energy: 36.2,
    total_reverse_energy: 0.3,
    valid_phases: 0x07
  };
}

test('toUploadPayload emits IAMMETER-compatible Datas arrays', () => {
  const config = createDefaultConfig();
  const payload = toUploadPayload(createReading(), config, '0.1.0');

  assert.equal(payload.method, 'uploadsn');
  assert.equal(payload.server, 'em');
  assert.equal(payload.version, '0.1.0');
  assert.equal(payload.Datas.length, 3);
  assert.deepEqual(payload.Datas[0], [230.1, 5.2, 1120, 12.4, 0.2, 49.98, 0.94]);
});

test('resolveUploadUrl uses cloud and local destinations correctly', () => {
  const config = createDefaultConfig();
  assert.equal(
    resolveUploadUrl(config),
    'https://www.iammeter.com/api/v1/sensor/uploadsensor'
  );

  config.destination.type = 'IAMMETER_LOCAL';
  config.destination.address = 'http://192.168.1.50';
  assert.equal(
    resolveUploadUrl(config),
    'http://192.168.1.50/api/v1/sensor/uploadsensor'
  );

  config.destination.type = 'NONE';
  assert.equal(resolveUploadUrl(config), null);
});

test('toUploadPayload falls back to configured destination serial number', () => {
  const config = createDefaultConfig();
  config.destination.sn = 'SN-001';

  const payload = toUploadPayload(createReading(), config, '0.1.0');
  assert.equal(payload.SN, 'SN-001');
});
