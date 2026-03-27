import { EventEmitter } from 'node:events';
import { createMeterDriver } from '../meters/factory.js';
import { resolveAuthSettings } from './auth.js';
import { loadConfig, saveConfig } from './config.js';
import { RuntimeTelemetry } from './telemetry.js';
import { resolveUploadUrl, uploadMeterData } from './upload.js';
import type { GatewayConfig, NormalizedMeterData, RuntimeOptions, RuntimeStatus } from './types.js';

export class GatewayRuntime extends EventEmitter {
  private config: GatewayConfig | null = null;
  private lastReading: NormalizedMeterData | null = null;
  private lastReadingError: Error | null = null;
  private lastUploadError: Error | null = null;
  private lastPollAt: string | null = null;
  private lastUploadAt: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private uploadTimer: NodeJS.Timeout | null = null;
  private readonly telemetry = new RuntimeTelemetry();

  constructor(
    private readonly options: RuntimeOptions,
    private readonly firmwareVersion: string
  ) {
    super();
  }

  async init(): Promise<void> {
    this.config = await loadConfig(this.options.configPath);
    this.telemetry.recordEvent({
      level: 'info',
      category: 'system',
      message: 'Gateway runtime initialized'
    });
    this.startPolling();
    this.startUploader();
  }

  getConfig(): GatewayConfig {
    if (!this.config) {
      throw new Error('Runtime not initialized');
    }

    return this.config;
  }

  async replaceConfig(nextConfig: GatewayConfig): Promise<void> {
    await saveConfig(this.options.configPath, nextConfig);
    this.config = nextConfig;
    this.lastReading = null;
    this.lastReadingError = null;
    this.lastUploadError = null;
    this.telemetry.recordEvent({
      level: 'info',
      category: 'config',
      message: `Configuration updated for ${nextConfig.meter.type}`
    });
  }

  getLastReading(): NormalizedMeterData | null {
    return this.lastReading;
  }

  getLastReadingError(): Error | null {
    return this.lastReadingError;
  }

  getLastUploadError(): Error | null {
    return this.lastUploadError;
  }

  getTelemetry(): RuntimeTelemetry {
    return this.telemetry;
  }

  getStatus(isAuthenticated: boolean): RuntimeStatus {
    const config = this.getConfig();
    const auth = resolveAuthSettings(
      config.auth.passwordHash,
      this.options.authPasswordHash,
      this.options.authPassword
    );
    return {
      authenticated: isAuthenticated,
      authConfigured: !auth.requiresSetup,
      authUsername: auth.username,
      authManagedByEnvironment: auth.managedByEnvironment,
      authEnvironmentVariable: auth.environmentVariable,
      meterConfigured: Boolean(config.meter.host),
      sourceType: config.meter.type,
      sourceHost: config.meter.host,
      sourcePort: config.meter.port,
      destinationType: config.destination.type,
      destinationUrl: resolveUploadUrl(config),
      pollIntervalMs: this.options.pollIntervalMs,
      uploadIntervalMs: this.options.uploadIntervalMs,
      lastPollAt: this.lastPollAt,
      lastUploadAt: this.lastUploadAt,
      lastUploadError: this.lastUploadError?.message ?? null,
      lastReadingError: this.lastReadingError?.message ?? null,
      deviceName: config.device.device_name
    };
  }

  async readMeterNow(): Promise<NormalizedMeterData> {
    const driver = createMeterDriver(this.getConfig().meter);

    try {
      const reading = await driver.read();
      this.lastReading = reading;
      this.lastReadingError = null;
      this.lastPollAt = new Date().toISOString();
      this.telemetry.recordReading(reading);
      return reading;
    } catch (error) {
      this.lastReadingError = error as Error;
      this.telemetry.recordEvent({
        level: 'error',
        category: 'poll',
        message: this.lastReadingError.message
      });
      throw error;
    }
  }

  private startPolling(): void {
    const runPoll = async () => {
      const config = this.getConfig();
      if (!config.meter.host) {
        return;
      }

      try {
        await this.readMeterNow();
      } catch {
        return;
      }
    };

    void runPoll();
    this.pollTimer = setInterval(() => {
      void runPoll();
    }, this.options.pollIntervalMs);
  }

  private startUploader(): void {
    const runUpload = async () => {
      try {
        const config = this.getConfig();
        if (config.destination.type === 'NONE' || !config.meter.host) {
          return;
        }

        const reading = await this.readMeterNow();
        await uploadMeterData(reading, config, this.firmwareVersion);
        this.lastUploadAt = new Date().toISOString();
        this.lastUploadError = null;
        this.telemetry.recordEvent({
          level: 'info',
          category: 'upload',
          message: `Uploaded reading to ${config.destination.type}`
        });
      } catch (error) {
        this.lastUploadError = error as Error;
        this.telemetry.recordEvent({
          level: 'error',
          category: 'upload',
          message: this.lastUploadError.message
        });
        this.emit('upload-error', error);
      }
    };

    void runUpload();
    this.uploadTimer = setInterval(() => {
      void runUpload();
    }, this.options.uploadIntervalMs);
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }
  }
}
