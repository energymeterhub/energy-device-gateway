import crypto from 'node:crypto';
import os from 'node:os';

export function resolveGatewayMacLikeId(): string {
  const interfaces = os.networkInterfaces();

  for (const group of Object.values(interfaces)) {
    for (const entry of group ?? []) {
      if (!entry || entry.internal || !entry.mac || entry.mac === '00:00:00:00:00:00') {
        continue;
      }

      return entry.mac.replace(/:/g, '').toUpperCase();
    }
  }

  return crypto.createHash('sha1').update(os.hostname()).digest('hex').slice(0, 12).toUpperCase();
}
