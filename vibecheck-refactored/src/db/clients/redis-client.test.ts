import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RedisClient } from "./redis-client";
import { env } from "../../config/env";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

describe("RedisClient", () => {
  let redisClient: RedisClient;

  beforeEach(() => {
    redisClient = new RedisClient({
      url: env.REDIS_URL,
    });
  });

  afterEach(async () => {
    try {
      await redisClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  });

  describe("connect", () => {
    it("should connect to redis without error", async () => {
      if (SKIP_INTEGRATION) return;
      await expect(redisClient.connect()).resolves.not.toThrow();
    });

    it("should set isConnected to true after connection", async () => {
      if (SKIP_INTEGRATION) return;
      await redisClient.connect();
      expect(redisClient.isConnected).toBe(true);
    });
  });

  describe("xadd", () => {
    it("should add a message to a stream", async () => {
      if (SKIP_INTEGRATION) return;
      await redisClient.connect();
      const messageId = await redisClient.xadd(
        "test-stream",
        "*",
        { key: "value" }
      );
      expect(messageId).toBeTruthy();
      expect(typeof messageId).toBe("string");
    });
  });

  describe("xread", () => {
    it("should read messages from a stream", async () => {
      if (SKIP_INTEGRATION) return;
      await redisClient.connect();
      await redisClient.xadd("test-stream", "*", { event: "test" });
      const messages = await redisClient.xread("test-stream", ">", 1);
      expect(messages).toBeDefined();
    });
  });

  describe("xgroup", () => {
    it("should create a consumer group", async () => {
      if (SKIP_INTEGRATION) return;
      await redisClient.connect();
      await redisClient.xadd("test-stream", "*", { event: "test" });
      const result = await redisClient.xgroup(
        "test-stream",
        "test-group",
        "0"
      );
      expect(result).toBe(0);
    });
  });
});