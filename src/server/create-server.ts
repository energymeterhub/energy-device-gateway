import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSessionToken,
  getMinimumPasswordLength,
  getSessionCookieName,
  hashPassword,
  parseCookies,
  resolveAuthSettings,
  verifyPassword,
  verifySessionToken
} from '../core/auth.js';
import {
  normalizeConfig,
  resetConfig,
  toConfigResponse,
  validateGatewayConfig
} from '../core/config.js';
import { GatewayRuntime } from '../core/runtime.js';
import { validateDestinationConfig, validateMeterConnectivity } from '../core/validation.js';
import { toUploadPayload } from '../core/upload.js';
import type { FirmwareInfo, GatewayConfig, RuntimeOptions } from '../core/types.js';

interface CreateServerOptions {
  runtimeOptions: RuntimeOptions;
  firmware: FirmwareInfo;
}

interface AuthenticatedRequest extends FastifyRequest {
  isAuthenticated?: boolean;
}

const PUBLIC_PATHS = new Set([
  '/login',
  '/health',
  '/api/auth/bootstrap',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session'
]);

function toErrorPayload(message: string) {
  return { error: message };
}

function sourceConfigured(config: GatewayConfig): boolean {
  return Boolean(config.meter.type && config.meter.host);
}

function isPublicAssetPath(url: string): boolean {
  return (
    url.startsWith('/assets/') ||
    url.startsWith('/favicon') ||
    url.startsWith('/logo.svg') ||
    url.startsWith('/site.webmanifest')
  );
}

async function readBodyAsBuffer(request: { raw: AsyncIterable<Buffer | string> }) {
  const chunks: Buffer[] = [];
  for await (const chunk of request.raw) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseConfigInput(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid JSON');
  }

  return body as Record<string, unknown>;
}

function setAuthenticatedRequestFlag(request: AuthenticatedRequest, password: string | null): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[getSessionCookieName()];
  const authenticated = verifySessionToken(token, password);
  request.isAuthenticated = authenticated;
  return authenticated;
}

async function resolvePublicDir(currentDir: string): Promise<string> {
  const candidates = [
    path.resolve(currentDir, '../web/public'),
    path.resolve(currentDir, '../../../src/web/public')
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('Unable to locate public web assets');
}

function ensureAuthenticated(request: AuthenticatedRequest, reply: FastifyReply, password: string | null): boolean {
  const authenticated = setAuthenticatedRequestFlag(request, password);
  if (authenticated) {
    return true;
  }

  reply.code(401).send({ error: 'Authentication required' });
  return false;
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = await resolvePublicDir(currentDir);
  const app = fastify({ logger: true });
  const runtime = new GatewayRuntime(options.runtimeOptions, options.firmware.version);
  await runtime.init();

  runtime.on('upload-error', (error) => {
    app.log.error(error);
  });

  const getAuthSettings = () => resolveAuthSettings(
    runtime.getConfig().auth.passwordHash,
    options.runtimeOptions.authPasswordHash,
    options.runtimeOptions.authPassword
  );

  const ensureAuthenticatedRequest = (request: FastifyRequest, reply: FastifyReply) =>
    ensureAuthenticated(request as AuthenticatedRequest, reply, getAuthSettings().sessionSecret);

  app.addHook('onClose', async () => {
    await runtime.shutdown();
  });

  app.addHook('onRequest', async (request, reply) => {
    const req = request as AuthenticatedRequest;
    const url = request.url.split('?')[0] || '/';
    const auth = getAuthSettings();
    const authenticated = setAuthenticatedRequestFlag(req, auth.sessionSecret);

    if (PUBLIC_PATHS.has(url) || isPublicAssetPath(url)) {
      return;
    }

    if (url === '/') {
      if (!authenticated) {
        reply.redirect('/login');
      }
      return;
    }

    if (url.startsWith('/api/')) {
      if (!authenticated) {
        reply.code(401).send({ error: 'Authentication required' });
      }
      return;
    }

    if (!authenticated) {
      reply.redirect('/login');
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS']
  });

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/assets/'
  });

  app.get('/logo.svg', async (_request, reply) => {
    const logoPath = path.join(publicDir, 'logo.svg');
    const logo = await readFile(logoPath, 'utf8');
    reply.type('image/svg+xml');
    return logo;
  });

  app.get('/login', async (_request, reply) => {
    const htmlPath = path.join(publicDir, 'login.html');
    reply.type('text/html; charset=utf-8');
    return readFile(htmlPath, 'utf8');
  });

  app.get('/', async (_request, reply) => {
    const htmlPath = path.join(publicDir, 'index.html');
    reply.type('text/html; charset=utf-8');
    return readFile(htmlPath, 'utf8');
  });

  app.post('/api/auth/bootstrap', async (request, reply) => {
    const auth = getAuthSettings();
    if (auth.managedByEnvironment) {
      reply.code(400);
      return toErrorPayload(`Password is managed by ${auth.environmentVariable}`);
    }

    if (!auth.requiresSetup) {
      reply.code(409);
      return toErrorPayload('Administrator password has already been initialized');
    }

    const body = parseConfigInput(request.body);
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (newPassword.length < getMinimumPasswordLength()) {
      reply.code(400);
      return toErrorPayload(`Password must be at least ${getMinimumPasswordLength()} characters`);
    }

    if (newPassword !== confirmPassword) {
      reply.code(400);
      return toErrorPayload('Password and confirmation do not match');
    }

    const nextPasswordHash = hashPassword(newPassword);
    const previous = runtime.getConfig();
    await runtime.replaceConfig({
      ...previous,
      auth: {
        ...previous.auth,
        passwordHash: nextPasswordHash
      }
    });

    reply.header('set-cookie', buildSessionCookie(createSessionToken(nextPasswordHash)));
    runtime.getTelemetry().recordEvent({
      level: 'info',
      category: 'auth',
      message: 'Administrator password initialized'
    });
    return {
      status: 'ok',
      message: 'Administrator password set.',
      username: auth.username
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const auth = getAuthSettings();
    if (auth.requiresSetup || !auth.passwordHash) {
      reply.code(409);
      return toErrorPayload('Administrator password has not been initialized');
    }

    const body = parseConfigInput(request.body);
    const providedUsername = typeof body.username === 'string' ? body.username : '';
    const provided = typeof body.password === 'string' ? body.password : '';
    if (providedUsername !== auth.username || !verifyPassword(provided, auth.passwordHash)) {
      runtime.getTelemetry().recordEvent({
        level: 'warn',
        category: 'auth',
        message: 'Failed login attempt'
      });
      reply.code(401);
      return toErrorPayload('Invalid username or password');
    }

    const token = createSessionToken(auth.sessionSecret ?? auth.passwordHash);
    reply.header('set-cookie', buildSessionCookie(token));
    runtime.getTelemetry().recordEvent({
      level: 'info',
      category: 'auth',
      message: 'Authenticated session created'
    });
    return { status: 'ok' };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.header('set-cookie', buildExpiredSessionCookie());
    return { status: 'ok' };
  });

  app.get('/api/auth/session', async (request) => {
    const auth = getAuthSettings();
    const authenticated = (request as AuthenticatedRequest).isAuthenticated ?? false;
    return {
      authenticated,
      authConfigured: !auth.requiresSetup,
      username: auth.username,
      authManagedByEnvironment: auth.managedByEnvironment,
      authEnvironmentVariable: auth.environmentVariable,
      passwordChangeAllowed: !auth.managedByEnvironment && !auth.requiresSetup,
      setupRequired: auth.requiresSetup,
      minimumPasswordLength: getMinimumPasswordLength()
    };
  });

  app.post('/api/auth/password', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }

    const auth = getAuthSettings();
    if (auth.managedByEnvironment) {
      reply.code(400);
      return toErrorPayload(`Password is managed by ${auth.environmentVariable}`);
    }

    if (auth.requiresSetup || !auth.passwordHash) {
      reply.code(400);
      return toErrorPayload('Administrator password has not been initialized');
    }

    const body = parseConfigInput(request.body);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!verifyPassword(currentPassword, auth.passwordHash)) {
      reply.code(401);
      return toErrorPayload('Current password is incorrect');
    }

    if (newPassword.length < getMinimumPasswordLength()) {
      reply.code(400);
      return toErrorPayload(`New password must be at least ${getMinimumPasswordLength()} characters`);
    }

    if (newPassword !== confirmPassword) {
      reply.code(400);
      return toErrorPayload('New password and confirmation do not match');
    }

    const nextPasswordHash = hashPassword(newPassword);
    const previous = runtime.getConfig();
    await runtime.replaceConfig({
      ...previous,
      auth: {
        ...previous.auth,
        passwordHash: nextPasswordHash
      }
    });

    reply.header('set-cookie', buildSessionCookie(createSessionToken(nextPasswordHash)));
    runtime.getTelemetry().recordEvent({
      level: 'info',
      category: 'auth',
      message: 'Gateway password updated'
    });
    return {
      status: 'ok',
      message: 'Password updated.',
      username: auth.username
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    return toConfigResponse(runtime.getConfig(), options.firmware);
  });

  app.get('/api/runtime/status', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    return runtime.getStatus((request as AuthenticatedRequest).isAuthenticated ?? false);
  });

  app.get('/api/runtime/history', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    return runtime.getTelemetry().getHistory();
  });

  app.get('/api/runtime/events', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    return runtime.getTelemetry().getEvents();
  });

  app.get('/api/meter/normalized', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    const config = runtime.getConfig();
    if (!sourceConfigured(config)) {
      reply.code(400);
      return toErrorPayload('Meter not configured');
    }

    try {
      return await runtime.readMeterNow();
    } catch (error) {
      reply.code(502);
      return toErrorPayload((error as Error).message || 'Failed to read meter data');
    }
  });

  app.get('/api/meter/data', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    const config = runtime.getConfig();
    if (!sourceConfigured(config)) {
      reply.code(200);
      return toErrorPayload('Meter not configured');
    }

    try {
      const data = await runtime.readMeterNow();
      return toUploadPayload(data, config, options.firmware.version);
    } catch {
      reply.code(200);
      return toErrorPayload('Failed to read meter data');
    }
  });

  app.post('/api/config', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }

    try {
      const previous = runtime.getConfig();
      const parsed = parseConfigInput(request.body);
      const nextConfig = normalizeConfig(parsed, previous);
      validateGatewayConfig(nextConfig);
      await validateMeterConnectivity(nextConfig.meter);
      validateDestinationConfig(nextConfig);
      await runtime.replaceConfig(nextConfig);
      return {
        status: 'saved',
        message: 'Gateway settings validated and saved.',
        apply: 'live'
      };
    } catch (error) {
      reply.code(400);
      return toErrorPayload((error as Error).message || 'Invalid settings');
    }
  });

  app.post('/api/network', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }

    try {
      const previous = runtime.getConfig();
      const raw = parseConfigInput(request.body);
      const nextConfig = normalizeConfig({ wifi: raw.wifi ?? {} }, previous);
      await runtime.replaceConfig({
        ...previous,
        wifi: nextConfig.wifi
      });
      return { status: 'ok' };
    } catch (error) {
      reply.code(400);
      return toErrorPayload((error as Error).message || 'Invalid network settings');
    }
  });

  app.post('/api/source', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }

    try {
      const previous = runtime.getConfig();
      const parsed = parseConfigInput(request.body);
      const nextConfig = normalizeConfig(parsed, previous);
      const merged: GatewayConfig = {
        ...previous,
        meter: nextConfig.meter,
        cloud: nextConfig.cloud,
        destination: nextConfig.destination,
        device: nextConfig.device
      };
      validateGatewayConfig(merged);
      await validateMeterConnectivity(merged.meter);
      validateDestinationConfig(merged);
      await runtime.replaceConfig(merged);
      return {
        status: 'saved',
        message: 'Source settings validated and applied.',
        apply: 'live'
      };
    } catch (error) {
      reply.code(400);
      return toErrorPayload((error as Error).message || 'Invalid source settings');
    }
  });

  app.get('/api/wifi/scan', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    return [];
  });

  app.post('/api/restart', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    if (options.runtimeOptions.selfRestartEnabled) {
      setTimeout(() => process.exit(0), 250);
    }
    return { status: 'restarting' };
  });

  app.post('/api/factory-reset', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    const config = await resetConfig(options.runtimeOptions.configPath);
    await runtime.replaceConfig(config);
    const auth = getAuthSettings();
    if (auth.sessionSecret) {
      reply.header('set-cookie', buildSessionCookie(createSessionToken(auth.sessionSecret)));
    } else {
      reply.header('set-cookie', buildExpiredSessionCookie());
    }
    if (options.runtimeOptions.selfRestartEnabled) {
      setTimeout(() => process.exit(0), 250);
    }
    return {
      status: 'factory_resetting',
      authConfigured: !auth.requiresSetup,
      setupRequired: auth.requiresSetup
    };
  });

  app.post('/api/ota', async (request, reply) => {
    if (!ensureAuthenticatedRequest(request, reply)) {
      return;
    }
    const buffer = await readBodyAsBuffer(request);
    const uploadDir = path.join(path.dirname(options.runtimeOptions.configPath), 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, 'latest-upload.bin'), buffer);
    reply.code(200);
    return { status: 'success' };
  });

  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(404);
    return { error: 'Not Found' };
  });

  return app;
}
