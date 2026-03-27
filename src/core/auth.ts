import crypto from 'node:crypto';

const SESSION_COOKIE = 'energy_device_gateway_session';
const DEFAULT_AUTH_USERNAME = 'admin';
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_HASH_PREFIX = 'scrypt';
const ENV_PASSWORD_HASH_PREFIX = 'sha256';
interface ScryptParams {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

const SCRYPT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};
const ENV_PASSWORD_SALT = 'energy-device-gateway:env-password';

export type AuthEnvironmentVariable =
  | 'ENERGY_DEVICE_GATEWAY_PASSWORD_HASH'
  | 'ENERGY_DEVICE_GATEWAY_PASSWORD';

export interface ResolvedAuthSettings {
  username: string;
  passwordHash: string | null;
  managedByEnvironment: boolean;
  environmentVariable: AuthEnvironmentVariable | null;
  requiresSetup: boolean;
  sessionSecret: string | null;
}

interface ParsedHash {
  algorithm: 'scrypt' | 'sha256';
  hash: Buffer;
  salt?: Buffer;
  params?: ScryptParams;
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function parsePasswordHash(passwordHash: string): ParsedHash | null {
  const trimmed = passwordHash.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split('$');
  if (parts[0] === PASSWORD_HASH_PREFIX && parts.length === 6) {
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const hash = parts[5];

    if (![N, r, p].every(Number.isFinite) || !salt || !hash) {
      return null;
    }

    try {
      return {
        algorithm: 'scrypt',
        params: {
          N,
          r,
          p,
          maxmem: SCRYPT_PARAMS.maxmem
        },
        salt: decodeBase64Url(salt),
        hash: decodeBase64Url(hash)
      };
    } catch {
      return null;
    }
  }

  if (parts[0] === ENV_PASSWORD_HASH_PREFIX && parts.length === 2 && parts[1]) {
    try {
      return {
        algorithm: 'sha256',
        hash: decodeBase64Url(parts[1])
      };
    } catch {
      return null;
    }
  }

  return null;
}

function deriveScryptHash(password: string, salt: Buffer, params = SCRYPT_PARAMS): Buffer {
  return crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH, params);
}

function createEnvironmentPasswordHash(password: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${ENV_PASSWORD_SALT}:${password}`)
    .digest();
  return `${ENV_PASSWORD_HASH_PREFIX}$${encodeBase64Url(digest)}`;
}

function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getDefaultAuthUsername(): string {
  return DEFAULT_AUTH_USERNAME;
}

export function getMinimumPasswordLength(): number {
  return MIN_PASSWORD_LENGTH;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = deriveScryptHash(password, salt, SCRYPT_PARAMS);
  return [
    PASSWORD_HASH_PREFIX,
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    encodeBase64Url(salt),
    encodeBase64Url(hash)
  ].join('$');
}

export function isSupportedPasswordHash(passwordHash: string | null | undefined): boolean {
  return typeof passwordHash === 'string' && parsePasswordHash(passwordHash) !== null;
}

export function verifyPassword(password: string, passwordHash: string | null | undefined): boolean {
  if (typeof passwordHash !== 'string' || !passwordHash.trim()) {
    return false;
  }

  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }

  if (parsed.algorithm === 'sha256') {
    return timingSafeEqualStrings(createEnvironmentPasswordHash(password), passwordHash);
  }

  const derived = deriveScryptHash(password, parsed.salt ?? Buffer.alloc(0), parsed.params);
  return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
}

export function normalizeLegacyPasswordHash(passwordHash: string | undefined | null): string {
  return isSupportedPasswordHash(passwordHash) ? passwordHash!.trim() : '';
}

export function resolveAuthSettings(
  configPasswordHash: string | undefined | null,
  envPasswordHash: string | null,
  envPassword: string | null
): ResolvedAuthSettings {
  if (envPasswordHash) {
    const normalized = normalizeLegacyPasswordHash(envPasswordHash);
    if (!normalized) {
      throw new Error('ENERGY_DEVICE_GATEWAY_PASSWORD_HASH must use a supported hash format');
    }

    return {
      username: DEFAULT_AUTH_USERNAME,
      passwordHash: normalized,
      managedByEnvironment: true,
      environmentVariable: 'ENERGY_DEVICE_GATEWAY_PASSWORD_HASH',
      requiresSetup: false,
      sessionSecret: normalized
    };
  }

  if (envPassword) {
    const normalized = createEnvironmentPasswordHash(envPassword);
    return {
      username: DEFAULT_AUTH_USERNAME,
      passwordHash: normalized,
      managedByEnvironment: true,
      environmentVariable: 'ENERGY_DEVICE_GATEWAY_PASSWORD',
      requiresSetup: false,
      sessionSecret: normalized
    };
  }

  const normalized = normalizeLegacyPasswordHash(configPasswordHash);
  return {
    username: DEFAULT_AUTH_USERNAME,
    passwordHash: normalized || null,
    managedByEnvironment: false,
    environmentVariable: null,
    requiresSetup: !normalized,
    sessionSecret: normalized || null
  };
}

export function createSessionToken(secret: string): string {
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string | null): boolean {
  if (!secret) {
    return false;
  }

  if (!token) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload, secret);
  const provided = Buffer.from(parts[2] ?? '');
  const expectedBuffer = Buffer.from(expected);
  return provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ''];
      })
  );
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}

export function buildExpiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
