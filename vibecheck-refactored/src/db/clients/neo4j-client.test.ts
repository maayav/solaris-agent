import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Neo4jClient } from "./neo4j-client";
import { env } from "../../config/env";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

describe("Neo4jClient", () => {
  let neo4jClient: Neo4jClient;

  beforeEach(() => {
    neo4jClient = new Neo4jClient({
      uri: env.NEO4J_URI,
      user: env.NEO4J_USERNAME,
      password: env.NEO4J_PASSWORD,
    });
  });

  afterEach(async () => {
    try {
      await neo4jClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  });

  describe("connect", () => {
    it("should connect to neo4j without error", async () => {
      if (SKIP_INTEGRATION) return;
      await expect(neo4jClient.connect()).resolves.not.toThrow();
    });

    it("should set isConnected to true after connection", async () => {
      if (SKIP_INTEGRATION) return;
      await neo4jClient.connect();
      expect(neo4jClient.isConnected).toBe(true);
    });
  });

  describe("executeQuery", () => {
    it("should execute a simple cypher query", async () => {
      if (SKIP_INTEGRATION) return;
      await neo4jClient.connect();
      const result = await neo4jClient.executeQuery(
        "RETURN 1 as num"
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("executeWrite", () => {
    it("should execute a write query", async () => {
      if (SKIP_INTEGRATION) return;
      await neo4jClient.connect();
      const result = await neo4jClient.executeWrite(
        "CREATE (n:TestNode {id: $id}) RETURN n",
        { id: "test-123" }
      );
      expect(result).toBeDefined();
    });
  });
});