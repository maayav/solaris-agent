import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { QdrantClient } from "./qdrant-client";
import { env } from "../../config/env";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

describe("QdrantClient", () => {
  let qdrantClient: QdrantClient;

  beforeEach(() => {
    qdrantClient = new QdrantClient({
      url: env.QDRANT_URL,
      ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    });
  });

  afterEach(async () => {
    try {
      await qdrantClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  });

  describe("connect", () => {
    it("should connect to qdrant without error", async () => {
      if (SKIP_INTEGRATION) return;
      await expect(qdrantClient.connect()).resolves.not.toThrow();
    });

    it("should set isConnected to true after connection", async () => {
      if (SKIP_INTEGRATION) return;
      await qdrantClient.connect();
      expect(qdrantClient.isConnected).toBe(true);
    });
  });

  describe("createCollection", () => {
    it("should create a collection", async () => {
      if (SKIP_INTEGRATION) return;
      await qdrantClient.connect();
      const result = await qdrantClient.createCollection("test-collection", {
        vectors: { size: 1536, distance: "Cosine" },
      });
      expect(result).toBe(true);
    });
  });

  describe("upsert", () => {
    it("should upsert vectors to a collection", async () => {
      if (SKIP_INTEGRATION) return;
      await qdrantClient.connect();
      await qdrantClient.createCollection("test-collection-2", {
        vectors: { size: 4, distance: "Cosine" },
      });
      const result = await qdrantClient.upsert("test-collection-2", {
        points: [
          {
            id: "1",
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: { code: "test" },
          },
        ],
      });
      expect(result).toBe(true);
    });
  });

  describe("search", () => {
    it("should search for similar vectors", async () => {
      if (SKIP_INTEGRATION) return;
      await qdrantClient.connect();
      await qdrantClient.createCollection("test-search", {
        vectors: { size: 4, distance: "Cosine" },
      });
      await qdrantClient.upsert("test-search", {
        points: [
          {
            id: "1",
            vector: [0.1, 0.2, 0.3, 0.4],
            payload: { code: "original" },
          },
        ],
      });
      const results = await qdrantClient.search("test-search", {
        vector: [0.1, 0.2, 0.3, 0.4],
        limit: 10,
      });
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });
});