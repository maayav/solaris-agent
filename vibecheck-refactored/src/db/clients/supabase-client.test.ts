import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SupabaseClient } from "./supabase-client";
import { env } from "../../config/env";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

describe("SupabaseClient", () => {
  let supabaseClient: SupabaseClient;

  beforeEach(() => {
    supabaseClient = new SupabaseClient({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    });
  });

  afterEach(async () => {
    try {
      await supabaseClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  });

  describe("connect", () => {
    it("should connect to supabase without error", async () => {
      if (SKIP_INTEGRATION) return;
      await expect(supabaseClient.connect()).resolves.not.toThrow();
    });

    it("should set isConnected to true after connection", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      expect(supabaseClient.isConnected).toBe(true);
    });
  });

  describe("from", () => {
    it("should return a query builder for a table", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      const query = supabaseClient.from("projects");
      expect(query).toBeDefined();
      expect(typeof query.select).toBe("function");
    });
  });

  describe("insert", () => {
    it("should insert data into a table", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      const result = await supabaseClient.insert("projects", {
        name: "Test Project",
        repository_url: "https://github.com/test/repo",
      });
      expect(result).toBeDefined();
    });
  });

  describe("select", () => {
    it("should select data from a table", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      const result = await supabaseClient
        .from("projects")
        .select("*")
        .limit(10);
      expect(result).toBeDefined();
    });
  });

  describe("update", () => {
    it("should update data in a table", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      await supabaseClient
        .update("projects", { name: "Updated Name" })
        .eq("id", "test-id");
    });
  });

  describe("delete", () => {
    it("should delete data from a table", async () => {
      if (SKIP_INTEGRATION) return;
      await supabaseClient.connect();
      await supabaseClient
        .delete("projects")
        .eq("id", "test-id");
    });
  });
});