import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSessionToken,
  getDefaultAuthUsername,
  getMinimumPasswordLength,
  getSessionCookieName,
  hashPassword,
  isSupportedPasswordHash,
  parseCookies,
  resolveAuthSettings,
  verifyPassword,
  verifySessionToken
} from '../src/core/auth.js';

test('session token verifies with matching secret', () => {
  const token = createSessionToken('gateway-session-secret');
  assert.equal(verifySessionToken(token, 'gateway-session-secret'), true);
  assert.equal(verifySessionToken(token, 'different-secret'), false);
});

test('hashPassword stores a supported hash that verifyPassword can validate', () => {
  const password = 'correct-horse-battery';
  const passwordHash = hashPassword(password);
  assert.equal(isSupportedPasswordHash(passwordHash), true);
  assert.equal(verifyPassword(password, passwordHash), true);
  assert.equal(verifyPassword('wrong-password', passwordHash), false);
});

test('parseCookies extracts named cookies', () => {
  const cookies = parseCookies('foo=bar; energy_device_gateway_session=abc123');
  assert.equal(cookies.foo, 'bar');
  assert.equal(cookies[getSessionCookieName()], 'abc123');
});

test('cookie helpers emit expected session cookie names', () => {
  const token = createSessionToken('gateway-session-secret');
  assert.match(buildSessionCookie(token), /^energy_device_gateway_session=/);
  assert.match(buildExpiredSessionCookie(), /^energy_device_gateway_session=/);
});

test('resolveAuthSettings requires setup when no config hash or environment override exists', () => {
  const auth = resolveAuthSettings('', null, null);
  assert.equal(auth.username, getDefaultAuthUsername());
  assert.equal(auth.passwordHash, null);
  assert.equal(auth.requiresSetup, true);
  assert.equal(auth.managedByEnvironment, false);
});

test('resolveAuthSettings honors environment plaintext password without exposing a default credential', () => {
  const auth = resolveAuthSettings('', null, 'very-strong-password');
  assert.equal(auth.username, getDefaultAuthUsername());
  assert.equal(auth.managedByEnvironment, true);
  assert.equal(auth.environmentVariable, 'ENERGY_DEVICE_GATEWAY_PASSWORD');
  assert.equal(auth.requiresSetup, false);
  assert.equal(verifyPassword('very-strong-password', auth.passwordHash), true);
});

test('minimum password length is enforced at 8 characters', () => {
  assert.equal(getMinimumPasswordLength(), 8);
});

test('verifySessionToken rejects malformed signatures safely', () => {
  assert.equal(verifySessionToken('bad.token.sig', 'gateway-session-secret'), false);
});
