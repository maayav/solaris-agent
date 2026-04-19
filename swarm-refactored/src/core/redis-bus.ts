import Redis from 'ioredis';
import type {
  A2AMessage,
  DefenseAnalytics,
  ExploitResult,
  ReconResult,
  DiscoveredToken,
  BlueTeamFinding,
} from '../types/index.js';

const STREAMS = {
  A2A_MESSAGES: 'a2a_messages',
  RED_TEAM_EVENTS: 'red_team_events',
  DEFENSE_ANALYTICS: 'defense_analytics',
};

const KEY_PREFIX = 'redteam';

export class RedisBus {
  private _client: Redis | null = null;
  private subscriber: Redis | null = null;
  private url: string;

  constructor(url: string = 'redis://localhost:6379/0') {
    this.url = url;
  }

  getClient(): Redis {
    if (!this._client) {
      throw new Error('Redis not connected');
    }
    return this._client;
  }

  async connect(): Promise<void> {
    const url = process.env.REDIS_URL || this.url;
    this._client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.subscriber = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this._client.on('error', () => {});
    this.subscriber.on('error', () => {});

    try {
      await this._client.connect();
      await this._client.ping();
    } catch {
      this._client = null;
      this.subscriber = null;
      throw new Error('Redis connection failed');
    }
  }

  async disconnect(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    if (this._client) {
      await this._client.quit();
      this._client = null;
    }
  }

  async publish(stream: string, message: Record<string, string>): Promise<void> {
    if (!this._client) return;
    await this._client.xadd(stream, '*', ...this.flattenObject(message));
  }

  async consume(
    stream: string,
    group: string,
    consumer: string,
    count: number = 10
  ): Promise<Array<{ id: string; message: Record<string, string> }>> {
    if (!this._client) return [];

    try {
      const result = await this._client.xreadgroup(
        'GROUP',
        group,
        consumer,
        'COUNT',
        count,
        'BLOCK',
        5000,
        'STREAMS',
        stream,
        '>'
      ) as unknown as Array<[string, Array<[string, string[]]>]> | null;

      if (!result || !result[0]) return [];

      return result[0][1].map((item: [string, string[]]) => ({
        id: item[0],
        message: this.unflattenObject(item[1]),
      }));
    } catch {
      return [];
    }
  }

  async ack(stream: string, group: string, id: string): Promise<void> {
    if (!this._client) return;
    await this._client.xack(stream, group, id);
  }

  async blackboard_write(
    missionId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    if (!this._client) return;
    const fullKey = `${KEY_PREFIX}:blackboard:${missionId}`;
    await this._client.hset(fullKey, key, JSON.stringify(value));
  }

  async blackboard_read<T = unknown>(missionId: string, key: string): Promise<T | null> {
    if (!this._client) return null;
    const fullKey = `${KEY_PREFIX}:blackboard:${missionId}`;
    const value = await this._client.hget(fullKey, key);
    return value ? JSON.parse(value) : null;
  }

  async blackboard_read_all(missionId: string): Promise<Record<string, unknown>> {
    if (!this._client) return {};
    const fullKey = `${KEY_PREFIX}:blackboard:${missionId}`;
    const data = await this._client.hgetall(fullKey);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = JSON.parse(value);
    }
    return result;
  }

  async blackboard_clear(missionId: string): Promise<void> {
    if (!this._client) return;
    const fullKey = `${KEY_PREFIX}:blackboard:${missionId}`;
    await this._client.del(fullKey);
  }

  async consume_defense_analytics(
    group: string = 'swarm-consumers',
    consumer: string = 'swarm',
    count: number = 10
  ): Promise<Array<{ id: string; analytics: DefenseAnalytics }>> {
    if (!this._client) return [];

    try {
      await this._client.xgroup(
        'CREATE',
        STREAMS.DEFENSE_ANALYTICS,
        group,
        'MKSTREAM',
        'ENTRIESREAD',
        '0'
      );
    } catch {
      // Group may already exist
    }

    const messages = await this.consume(
      STREAMS.DEFENSE_ANALYTICS,
      group,
      consumer,
      count
    );

    return messages
      .map(({ id, message }) => ({
        id,
        analytics: {
          severity: message.severity as DefenseAnalytics['severity'],
          vulnerability_type: message.vulnerability_type,
          description: message.description,
          blocked_payload: message.blocked_payload,
          detected_signature: message.detected_signature,
          endpoint: message.endpoint,
          target: message.target,
          mission_id: message.mission_id,
          source: message.source as DefenseAnalytics['source'],
          agent: message.agent,
          timestamp: message.timestamp,
        },
      }))
      .filter((m) => m.analytics.mission_id !== undefined);
  }

  async get_latest_defense_intel(
    missionId?: string
  ): Promise<DefenseAnalytics[]> {
    if (!this._client) return [];

    const messages = await this.consume_defense_analytics();

    const filtered = messages.filter(
      (m) => !missionId || m.analytics.mission_id === missionId
    );

    return filtered.map((m) => m.analytics);
  }

  async findings_store(
    missionId: string,
    category: string,
    key: string,
    value: string
  ): Promise<void> {
    if (!this._client) return;
    const fullKey = `${KEY_PREFIX}:findings:${missionId}:${category}`;
    await this._client.hset(fullKey, key, value);
  }

  async findings_read(
    missionId: string,
    category: string,
    key: string
  ): Promise<string | null> {
    if (!this._client) return null;
    const fullKey = `${KEY_PREFIX}:findings:${missionId}:${category}`;
    return this._client.hget(fullKey, key);
  }

  async findings_read_all(
    missionId: string,
    category: string
  ): Promise<Record<string, string>> {
    if (!this._client) return {};
    const fullKey = `${KEY_PREFIX}:findings:${missionId}:${category}`;
    return this._client.hgetall(fullKey);
  }

  async get_payload_attempt_count(
    missionId: string,
    payloadHash: string
  ): Promise<number> {
    if (!this._client) return 0;
    const fullKey = `${KEY_PREFIX}:payload_attempts:${missionId}`;
    const count = await this._client.hget(fullKey, payloadHash);
    return count ? parseInt(count, 10) : 0;
  }

  async increment_payload_attempt(
    missionId: string,
    payloadHash: string
  ): Promise<number> {
    if (!this._client) return 0;
    const fullKey = `${KEY_PREFIX}:payload_attempts:${missionId}`;
    return this._client.hincrby(fullKey, payloadHash, 1);
  }

  async ping(): Promise<boolean> {
    if (!this._client) return false;
    try {
      const result = await this._client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async store_token(
    missionId: string,
    tokenName: string,
    tokenValue: string
  ): Promise<void> {
    await this.findings_store(missionId, 'tokens', tokenName, tokenValue);
  }

  async get_tokens(missionId: string): Promise<Record<string, string>> {
    return this.findings_read_all(missionId, 'tokens');
  }

  async store_successful_payload(
    missionId: string,
    hash: string,
    payload: string,
    exploitType: string,
    target: string
  ): Promise<void> {
    const fullKey = `${KEY_PREFIX}:findings:${missionId}:successful_payloads`;
    await this._client?.hset(
      fullKey,
      hash,
      JSON.stringify({ payload, exploit_type: exploitType, target, timestamp: new Date().toISOString() })
    );
  }

  async a2a_publish(message: A2AMessage): Promise<void> {
    await this.publish(STREAMS.A2A_MESSAGES, {
      msg_id: message.msg_id,
      sender: message.sender,
      recipient: message.recipient as string,
      type: message.type,
      priority: message.priority,
      payload: JSON.stringify(message.payload),
      timestamp: message.timestamp,
    });
  }

  async a2a_consume(
    group: string,
    consumer: string,
    count: number = 10
  ): Promise<Array<{ id: string; message: A2AMessage }>> {
    const raw = await this.consume(STREAMS.A2A_MESSAGES, group, consumer, count);

    return raw.map(({ id, message }) => ({
      id,
      message: {
        msg_id: message.msg_id,
        sender: message.sender as A2AMessage['sender'],
        recipient: message.recipient as A2AMessage['recipient'],
        type: message.type as A2AMessage['type'],
        priority: message.priority as A2AMessage['priority'],
        payload: JSON.parse(message.payload as string),
        timestamp: message.timestamp,
      } as A2AMessage,
    }));
  }

  private flattenObject(obj: Record<string, string | number | boolean>): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      result.push(key, String(value));
    }
    return result;
  }

  private unflattenObject(arr: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < arr.length; i += 2) {
      result[arr[i]] = arr[i + 1];
    }
    return result;
  }
}

export const redisBus = new RedisBus();
