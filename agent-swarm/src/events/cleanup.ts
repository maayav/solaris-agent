import { EventBus } from './bus.js';
import { EventTTL, type SwarmEventType } from './types.js';

export interface CleanupStats {
  deleted: number;
  errors: string[];
}

export class EventCleanup {
  private bus: EventBus;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(bus: EventBus, intervalMs = 60000) {
    this.bus = bus;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.run().catch(console.error);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async run(): Promise<CleanupStats> {
    const stats: CleanupStats = { deleted: 0, errors: [] };
    const now = Date.now();

    for (const [eventType, ttl] of Object.entries(EventTTL)) {
      if (ttl === null) continue;

      const cutoff = now - ttl;
      try {
        const deleted = await this.cleanupEventType(eventType as SwarmEventType, cutoff);
        stats.deleted += deleted;
      } catch (err) {
        stats.errors.push(`${eventType}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return stats;
  }

  private async cleanupEventType(eventType: SwarmEventType, cutoff: number): Promise<number> {
    return this.bus.cleanupByType(eventType, cutoff);
  }
}
