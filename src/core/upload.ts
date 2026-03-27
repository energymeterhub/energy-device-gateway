import { resolveGatewayMacLikeId } from './device-id.js';
import type { GatewayConfig, NormalizedMeterData, UploadPayload } from './types.js';

const IAMMETER_UPLOAD_PATH = '/api/v1/sensor/uploadsensor';

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toUploadPayload(
  data: NormalizedMeterData,
  config: GatewayConfig,
  firmwareVersion: string
): UploadPayload {
  const mac = resolveGatewayMacLikeId();
  const sn = config.destination.sn || config.cloud.sn || mac;

  return {
    method: 'uploadsn',
    mac,
    version: firmwareVersion,
    server: 'em',
    SN: sn,
    Datas: [data.phase_a, data.phase_b, data.phase_c].map((phase) => [
      round(phase.voltage, 3),
      round(phase.current, 3),
      round(phase.active_power, 3),
      round(phase.forward_energy, 3),
      round(phase.reverse_energy, 3),
      round(data.frequency, 3),
      round(phase.power_factor, 3)
    ]) as UploadPayload['Datas']
  };
}

export function resolveUploadUrl(config: GatewayConfig): string | null {
  if (config.destination.type === 'NONE') {
    return null;
  }

  if (config.destination.type === 'IAMMETER_CLOUD') {
    return new URL(IAMMETER_UPLOAD_PATH, config.cloud.server).toString();
  }

  return new URL(IAMMETER_UPLOAD_PATH, config.destination.address).toString();
}

export async function uploadMeterData(
  data: NormalizedMeterData,
  config: GatewayConfig,
  firmwareVersion: string,
  timeoutMs = 10_000
): Promise<void> {
  const url = resolveUploadUrl(config);
  if (!url) {
    return;
  }

  const payload = toUploadPayload(data, config, firmwareVersion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const text = await response.text();
    if (!text) {
      return;
    }

    try {
      const parsed = JSON.parse(text) as { successful?: boolean; message?: string };
      if (parsed.successful === false) {
        throw new Error(parsed.message || 'Upload rejected by destination');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return;
      }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}
