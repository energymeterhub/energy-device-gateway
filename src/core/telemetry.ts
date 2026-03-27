import crypto from 'node:crypto';
import type { MeterHistoryPoint, NormalizedMeterData, RuntimeEvent } from './types.js';

const MAX_HISTORY = 288;
const MAX_EVENTS = 120;

export class RuntimeTelemetry {
  private readonly history: MeterHistoryPoint[] = [];
  private readonly events: RuntimeEvent[] = [];

  recordReading(reading: NormalizedMeterData): void {
    this.history.unshift({
      collectedAt: new Date(reading.timestamp * 1000).toISOString(),
      totalPower: reading.total_power,
      totalForwardEnergy: reading.total_forward_energy,
      totalReverseEnergy: reading.total_reverse_energy,
      frequency: reading.frequency,
      phasePower: [
        reading.phase_a.active_power,
        reading.phase_b.active_power,
        reading.phase_c.active_power
      ]
    });

    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }
  }

  recordEvent(event: Omit<RuntimeEvent, 'id' | 'createdAt'>): void {
    this.events.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...event
    });

    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
  }

  getHistory(): MeterHistoryPoint[] {
    return [...this.history];
  }

  getEvents(): RuntimeEvent[] {
    return [...this.events];
  }
}
