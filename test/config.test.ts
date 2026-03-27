import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/core/auth.js';
import { createDefaultConfig } from '../src/core/defaults.js';
import { normalizeConfig, validateGatewayConfig } from '../src/core/config.js';

test('normalizeConfig maps legacy meter aliases to canonical types', () => {
  const config = normalizeConfig({
    meter: {
      type: 'FRONIUS_GEN24'
    }
  }, createDefaultConfig());

  assert.equal(config.meter.type, 'FRONIUS_SUNSPEC');
  assert.equal(config.meter.port, 502);
});

test('validateGatewayConfig allows empty host before source is configured', () => {
  const config = createDefaultConfig();
  assert.doesNotThrow(() => validateGatewayConfig(config));
});

test('validateGatewayConfig requires local destination URL when local upload is enabled', () => {
  const config = normalizeConfig({
    meter: {
      host: '192.168.1.10'
    },
    destination: {
      type: 'IAMMETER_LOCAL',
      address: ''
    }
  }, createDefaultConfig());

  assert.throws(() => validateGatewayConfig(config), /Local destination address is required/);
});

test('normalizeConfig preserves previous wifi password when blank password is submitted', () => {
  const previous = createDefaultConfig();
  previous.wifi.password = 'secret';

  const config = normalizeConfig({
    wifi: {
      ssid: 'office-network',
      password: ''
    }
  }, previous);

  assert.equal(config.wifi.ssid, 'office-network');
  assert.equal(config.wifi.password, 'secret');
});

test('normalizeConfig preserves previous auth hash when blank auth payload is submitted', () => {
  const previous = createDefaultConfig();
  previous.auth.passwordHash = hashPassword('stable-password');
  const replacement = normalizeConfig({
    auth: {}
  }, previous);

  assert.equal(replacement.auth.passwordHash, previous.auth.passwordHash);
});

test('normalizeConfig migrates legacy plaintext auth.password into passwordHash', () => {
  const config = normalizeConfig({
    auth: {
      password: 'very-strong-password'
    }
  }, createDefaultConfig());

  assert.notEqual(config.auth.passwordHash, '');
  assert.equal(verifyPassword('very-strong-password', config.auth.passwordHash), true);
});
