import Redis from "ioredis";

interface RedisClientOptions {
  url: string;
  tls?: boolean;
}

export class RedisClient {
  private client: Redis | null = null;
  private _isConnected = false;

  constructor(private options: RedisClientOptions) {}

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(): Promise<void> {
    const isTLS = this.options.url.startsWith("rediss://");
    this.client = new Redis(this.options.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      },
      tls: isTLS ? {} : undefined,
    });

    this.client.on("connect", () => {
      this._isConnected = true;
    });

    this.client.on("error", () => {
      this._isConnected = false;
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.client) return reject(new Error("Client not initialized"));
      
      this.client.once("ready", () => {
        this._isConnected = true;
        resolve();
      });
      
      this.client.once("error", (err) => {
        reject(err);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this._isConnected = false;
    }
  }

  async xadd(
    stream: string,
    id: string,
    fields: Record<string, string>
  ): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const args: string[] = [stream, id];
    for (const [key, value] of Object.entries(fields)) {
      args.push(key, value);
    }

    const result = await this.client.xadd(...args as [string, ...string[]]);
    if (result === null) {
      throw new Error("XADD returned null");
    }
    return result;
  }

  async xread(
    stream: string,
    startId: string,
    count?: number
  ): Promise<Array<[string, Array<[string, string]>]> | null> {
    if (!this.client) throw new Error("Client not connected");
    
    if (count) {
      return this.client.xread("COUNT", count.toString(), "STREAMS", stream, startId) as Promise<Array<[string, Array<[string, string]>]> | null>;
    }
    return this.client.xread("STREAMS", stream, startId) as Promise<Array<[string, Array<[string, string]>]> | null>;
  }

  async xgroup(
    stream: string,
    group: string,
    id: string,
    mkstream = false
  ): Promise<number> {
    if (!this.client) throw new Error("Client not connected");
    
    if (mkstream) {
      return this.client.xgroup("CREATE", stream, group, id, "MKSTREAM") as Promise<number>;
    }
    return this.client.xgroup("CREATE", stream, group, id) as Promise<number>;
  }

  async ensureGroup(stream: string, group: string): Promise<void> {
    if (!this.client) throw new Error("Client not connected");

    try {
      await this.client.xgroup("CREATE", stream, group, "$", "MKSTREAM");
    } catch (e) {
      if (e instanceof Error && e.message.includes("BUSYGROUP")) {
        return;
      }
      throw e;
    }
  }

  async setupConsumerGroups(streams: Array<{ stream: string; group: string }>): Promise<void> {
    for (const { stream, group } of streams) {
      await this.ensureGroup(stream, group);
    }
  }

  async xreadgroup(
    group: string,
    consumer: string,
    streams: string[],
    count?: number
  ): Promise<Array<[string, Array<[string, string]>]> | null> {
    if (!this.client) throw new Error("Client not connected");

    const args: (string | number)[] = ["GROUP", group, consumer];
    if (count) {
      args.push("COUNT", count);
    }
    args.push("STREAMS");
    for (const stream of streams) {
      args.push(stream);
    }
    for (const _stream of streams) {
      args.push(">");
    }

    return this.client.call("XREADGROUP", ...args) as Promise<Array<[string, Array<[string, string]>]> | null>;
  }

  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    if (!this.client) throw new Error("Client not connected");
    return this.client.xack(stream, group, ...ids);
  }

  async xclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    ...ids: string[]
  ): Promise<Array<[string, Array<[string, string]>]>> {
    if (!this.client) throw new Error("Client not connected");
    return this.client.xclaim(stream, group, consumer, minIdleTime, ...ids) as Promise<Array<[string, Array<[string, string]>]>>;
  }

  async xRead(
    stream: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    count?: number
  ): Promise<Array<{ id: string; data: Record<string, string> }>> {
    if (!this.client) throw new Error("Client not connected");
    
    const results: Array<{ id: string; data: Record<string, string> }> = [];
    
    const pending = await this.claimPending(stream, group, consumer, minIdleTime, count || 10);
    for (const { id, data } of pending) {
      const parsedData: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        parsedData[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      results.push({ id, data: parsedData });
    }
    
    const messages = await this.xreadgroup(group, consumer, [stream], count);
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const streamName = msg[0];
        const msgList = msg[1];
        for (const item of msgList) {
          const id = item[0];
          const items = item[1];
          const data: Record<string, string> = {};
          for (let i = 0; i < items.length; i += 2) {
            const k = items[i];
            const v = items[i + 1];
            if (k !== undefined && v !== undefined) {
              data[k] = v;
            }
          }
          results.push({ id, data });
        }
      }
    }
    
    return results;
  }

  async *xConsume(
    stream: string,
    group: string,
    consumer: string,
    count = 10
  ): AsyncGenerator<{ id: string; data: Record<string, string> }> {
    if (!this.client) throw new Error("Client not connected");
    
    while (this._isConnected) {
      const pending = await this.claimPending(stream, group, consumer, 0, count);
      for (const { id, data } of pending) {
        const parsedData: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          parsedData[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        yield { id, data: parsedData };
      }
      
      const messages = await this.xreadgroup(group, consumer, [stream], count);
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          const streamName = msg[0];
          const msgList = msg[1];
          for (const item of msgList) {
            const id = item[0];
            const items = item[1];
            const data: Record<string, string> = {};
            for (let i = 0; i < items.length; i += 2) {
              const k = items[i];
              const v = items[i + 1];
              if (k !== undefined && v !== undefined) {
                data[k] = v;
              }
            }
            yield { id, data };
          }
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async xAck(stream: string, group: string, id: string): Promise<void> {
    await this.xack(stream, group, id);
  }

  async ping(): Promise<string> {
    if (!this.client) throw new Error("Client not connected");
    return this.client.ping();
  }

  async publishScanJob(data: {
    repo_url: string;
    project_id?: string;
    triggered_by?: string;
    scan_id?: string;
  }): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const message: Record<string, string> = {
      repo_url: data.repo_url,
      project_id: data.project_id || "",
      triggered_by: data.triggered_by || "manual",
      timestamp: new Date().toISOString(),
    };

    if (data.scan_id) {
      message.scan_id = data.scan_id;
    }

    return this.xadd("scan_queue", "*", message);
  }

  async publish(channel: string, data: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const message: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
      ),
      timestamp: new Date().toISOString(),
    };

    return this.xadd(channel, "*", message);
  }

  async publishA2AMessage(
    missionId: string,
    sender: string,
    recipient: string,
    msgType: string,
    payload: Record<string, unknown>,
    priority: string = "NORMAL"
  ): Promise<string> {
    if (!this.client) throw new Error("Client not connected");

    const data = {
      mission_id: missionId,
      sender,
      recipient,
      type: msgType,
      priority,
      payload: JSON.stringify(payload),
      timestamp: new Date().toISOString(),
    };

    const streamName = `a2a_messages:${missionId}`;
    return this.xadd(streamName, "*", data);
  }

  async setBlackboard(missionId: string, key: string, value: Record<string, unknown>): Promise<void> {
    if (!this.client) throw new Error("Client not connected");
    const blackboardKey = `blackboard:${missionId}`;
    await this.client.hset(blackboardKey, key, JSON.stringify(value));
  }

  async getBlackboard(missionId: string, key: string): Promise<Record<string, unknown> | null> {
    if (!this.client) throw new Error("Client not connected");
    const blackboardKey = `blackboard:${missionId}`;
    const value = await this.client.hget(blackboardKey, key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  async getAllBlackboard(missionId: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error("Client not connected");
    const blackboardKey = `blackboard:${missionId}`;
    const values = await this.client.hgetall(blackboardKey);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      try {
        result[k] = JSON.parse(v);
      } catch {
        result[k] = v;
      }
    }
    return result;
  }

  async getStreamLength(streamName: string): Promise<number> {
    if (!this.client) throw new Error("Client not connected");
    return this.client.xlen(streamName);
  }

  async getPendingCount(streamName: string, groupName: string): Promise<number> {
    if (!this.client) throw new Error("Client not connected");
    const info = await this.client.xpending(streamName, groupName) as { pending?: number } | null;
    return info?.pending ?? 0;
  }

  async claimPending(
    streamName: string,
    groupName: string,
    consumerName: string,
    minIdleTime: number,
    count: number = 1
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    if (!this.client) throw new Error("Client not connected");

    const result = await this.client.call(
      "XAUTOCLAIM",
      streamName,
      groupName,
      consumerName,
      minIdleTime.toString(),
      "0",
      count.toString()
    ) as [string, Array<[string, Array<[string, string]>]>, unknown[]];

    if (!result || !result[1] || result[1].length === 0) return [];

    return result[1].map(([id, items]) => {
      const data: Record<string, unknown> = {};
      for (let i = 0; i < items.length; i += 2) {
        const k = items[i];
        const v = items[i + 1];
        if (k !== undefined && v !== undefined) {
          try {
            data[k] = JSON.parse(v);
          } catch {
            data[k] = v;
          }
        }
      }
      return { id, data };
    });
  }

  async consume(
    streamName: string,
    groupName: string,
    consumerName: string,
    block: number = 5000,
    count: number = 1
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    if (!this.client) throw new Error("Client not connected");

    const messages = await this.client.call(
      "XREADGROUP",
      "GROUP", groupName, consumerName,
      "COUNT", count,
      "BLOCK", block,
      "STREAMS", streamName, ">"
    ) as Array<[string, Array<[string, string]>]> | null;

    if (!messages) return [];

    const results: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const msg of messages) {
      const stream = msg[0];
      const msgList = msg[1];
      for (const item of msgList) {
        const id = item[0];
        const items = item[1];
        const data: Record<string, unknown> = {};
        for (let i = 0; i < items.length; i += 2) {
          const k = items[i];
          const v = items[i + 1];
          if (k !== undefined && v !== undefined) {
            try {
              data[k] = JSON.parse(v);
            } catch {
              data[k] = v;
            }
          }
        }
        results.push({ id, data });
      }
    }
    return results;
  }
}

export const redisClient = new RedisClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});