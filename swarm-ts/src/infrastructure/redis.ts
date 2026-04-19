import { Redis } from '@upstash/redis'
import { getConfig } from './config.js'

let redisClient: Redis | null = null

export function getRedis(): Redis {
  if (!redisClient) {
    const config = getConfig()
    if (!config.UPSTASH_REDIS_REST_URL || !config.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Upstash Redis configuration missing')
    }
    redisClient = new Redis({
      url: config.UPSTASH_REDIS_REST_URL,
      token: config.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return redisClient
}

export class MessageBus {
  private redis: Redis

  constructor(redis?: Redis) {
    this.redis = redis ?? getRedis()
  }

  async publish(stream: string, message: Record<string, unknown>): Promise<string> {
    return await this.redis.xadd(stream, message as Record<string, string>)
  }

  async consume(
    stream: string,
    group: string,
    consumer: string,
    count = 10
  ): Promise<Record<string, string>[]> {
    return await this.redis.xreadgroup(
      group,
      consumer,
      { stream, count, block: 5000 }
    ) as Record<string, string>[]
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key)
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, { ex: ttl })
    } else {
      await this.redis.set(key, value)
    }
  }

  async del(key: string): Promise<number> {
    return await this.redis.del(key)
  }

  async incrbyfloat(key: string, amount: number): Promise<number> {
    return await this.redis.incrbyfloat(key, amount)
  }

  async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    return await this.redis.setbit(key, offset, value)
  }

  async bitcount(key: string): Promise<number> {
    return await this.redis.bitcount(key)
  }

  async exists(key: string): Promise<boolean> {
    return await this.redis.exists(key)
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds)
  }

  async getBlackboard(missionId: string): Promise<Record<string, unknown>> {
    const data = await this.get(`swarm:blackboard:${missionId}`)
    return data ? JSON.parse(data) : {}
  }

  async setBlackboard(missionId: string, data: Record<string, unknown>): Promise<void> {
    await this.set(`swarm:blackboard:${missionId}`, JSON.stringify(data))
  }

  async recordCost(missionId: string, cost: number): Promise<number> {
    return await this.incrbyfloat(`swarm:cost:${missionId}`, cost)
  }

  async getCost(missionId: string): Promise<number> {
    const cost = await this.get(`swarm:cost:${missionId}`)
    return cost ? parseFloat(cost) : 0
  }

  async updateCoverage(missionId: string, bitIndex: number): Promise<number> {
    await this.setbit(`swarm:coverage:${missionId}`, bitIndex, 1)
    return await this.bitcount(`swarm:coverage:${missionId}`)
  }
}
