import net from 'node:net';
import { getMeterProtocol } from './defaults.js';
import type { DestinationType, GatewayConfig, MeterConfig } from './types.js';

function protocolLabel(type: ReturnType<typeof getMeterProtocol>): string {
  return type === 'http' ? 'HTTP' : 'Modbus TCP';
}

export async function probeTcpConnectivity(host: string, port: number, timeoutMs = 3000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      callback();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(resolve));
    socket.once('timeout', () => settle(() => reject(new Error('Connection timed out'))));
    socket.once('error', (error) => settle(() => reject(error)));
  });
}

export async function validateMeterConnectivity(config: MeterConfig): Promise<void> {
  if (!config.host) {
    return;
  }

  const protocol = getMeterProtocol(config.type);

  try {
    await probeTcpConnectivity(config.host, config.port, 3000);
  } catch {
    throw new Error(
      `Cannot connect to ${protocolLabel(protocol)} device at ${config.host}:${config.port}`
    );
  }
}

export function validateDestinationConfig(config: GatewayConfig): void {
  const destinationType: DestinationType = config.destination.type;

  if (destinationType === 'IAMMETER_LOCAL' && !config.destination.address) {
    throw new Error('Local destination address is required');
  }
}
