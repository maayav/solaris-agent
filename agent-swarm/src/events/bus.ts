import { Database } from 'bun:sqlite';
import type { SwarmEvent, SwarmEventType } from './types.js';

let sharedDb: Database | null = null;
let sharedInstance: EventBus | null = null;

export class EventBus {
  public db: Database;
  
  constructor(dbPath?: string) {
    if (sharedInstance && !dbPath) {
      this.db = sharedInstance.db;
      Object.setPrototypeOf(this, sharedInstance);
      return;
    }

    const resolvedPath = dbPath || process.env.SQLITE_EVENTS_PATH || './solaris-events.db';

    if (sharedDb) {
      this.db = sharedDb;
    } else {
      this.db = new Database(resolvedPath);
      sharedDb = this.db;
    }

    if (!sharedInstance) {
      sharedInstance = this;
    }

    this.initialize();
  }

  static getInstance(): EventBus {
    if (!sharedInstance) {
      sharedInstance = new EventBus();
    }
    return sharedInstance;
  }
  
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        consumed INTEGER DEFAULT 0,
        consumed_by TEXT,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_consumed ON events(consumed);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    `);
  }
  
  async emit(type: SwarmEventType, payload: Record<string, unknown>, createdBy: string): Promise<string> {
    const id = `evt:${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, payload, consumed, created_at, created_by)
      VALUES (?, ?, ?, 0, ?, ?)
    `);
    
    stmt.run(id, type, JSON.stringify(payload), Date.now(), createdBy);
    
    return id;
  }
  
  async consume(
    agentId: string,
    subscriptions: SwarmEventType[],
    limit = 20
  ): Promise<SwarmEvent[]> {
    const placeholders = subscriptions.map(() => '?').join(',');
    
    const selectStmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE consumed = 0 
        AND type IN (${placeholders})
      ORDER BY created_at ASC
      LIMIT ?
    `);
    
    const events = selectStmt.all(...subscriptions, limit) as any[];
    
    if (events.length === 0) return [];
    
    const now = Date.now();
    const updateStmt = this.db.prepare(`
      UPDATE events 
      SET consumed = 1, consumed_by = ?, consumed_at = ?
      WHERE id = ? AND consumed = 0
    `);
    
    const consumedEvents: SwarmEvent[] = [];
    
    for (const event of events) {
      const result = updateStmt.run(agentId, now, event.id);
      if (result.changes > 0) {
        consumedEvents.push({
          ...event,
          payload: JSON.parse(event.payload),
          consumed: true,
          consumed_by: agentId,
          consumed_at: now,
        });
      }
    }
    
    return consumedEvents;
  }
  
  async getPendingCount(subscriptions: SwarmEventType[]): Promise<number> {
    const placeholders = subscriptions.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM events 
      WHERE consumed = 0 AND type IN (${placeholders})
    `);
    
    const result = stmt.get(...subscriptions) as { count: number };
    return result.count;
  }
  
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - 600000; // 10 min default
    
    const stmt = this.db.prepare(`
      DELETE FROM events 
      WHERE consumed = 1 
        AND consumed_at < ?
        AND type NOT IN ('swarm_complete')
    `);
    
    const result = stmt.run(cutoff);
    return result.changes;
  }
  
  async getOrphanedEvents(olderThanMs: number = 600000): Promise<SwarmEvent[]> {
    const cutoff = Date.now() - olderThanMs;
    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE consumed = 0 AND created_at < ?
      ORDER BY created_at ASC
    `);
    
    const events = stmt.all(cutoff) as any[];
    
    return events.map(e => ({
      ...e,
      payload: JSON.parse(e.payload),
      consumed: false,
    }));
  }

  async cleanupByType(eventType: SwarmEventType, cutoff: number): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM events 
      WHERE type = ? AND consumed = 1 AND consumed_at < ?
    `);
    
    const result = stmt.run(eventType, cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
