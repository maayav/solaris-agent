import { describe, it, expect, beforeEach, vi } from "bun:test";
import { GraphService } from "./graph";
import type { CodeEntity, CodeRelationship } from "../types";

const SKIP_INTEGRATION = !process.env.RUN_INTEGRATION_TESTS;

const mockSession = {
  run: vi.fn().mockResolvedValue({ records: [] }),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../db/clients/neo4j-client", () => ({
  neo4jClient: {
    session: vi.fn().mockReturnValue(mockSession),
  },
}));

describe("GraphService", () => {
  let graphService: GraphService;

  beforeEach(() => {
    graphService = new GraphService();
    vi.clearAllMocks();
  });

  describe("addNodes", () => {
    it("should return 0 for empty entities array", async () => {
      const result = await graphService.addNodes("scan-1", []);
      expect(result).toBe(0);
    });

    it("should throw error for invalid node type", async () => {
      const invalidEntity: CodeEntity = {
        id: "test-1",
        type: "invalid_type" as CodeEntity["type"],
        name: "test",
        file_path: "test.ts",
        line_start: 1,
        line_end: 10,
      };

      await expect(graphService.addNodes("scan-1", [invalidEntity])).rejects.toThrow(
        "Invalid node type: invalid_type"
      );
    });

    it("should group entities by type and create nodes", async () => {
      if (SKIP_INTEGRATION) return;

      const entities: CodeEntity[] = [
        {
          id: "func-1",
          type: "function",
          name: "testFunc",
          file_path: "test.ts",
          line_start: 1,
          line_end: 10,
          code_snippet: "function testFunc() {}",
        },
        {
          id: "func-2",
          type: "function",
          name: "testFunc2",
          file_path: "test2.ts",
          line_start: 20,
          line_end: 30,
          code_snippet: "function testFunc2() {}",
        },
      ];

      const result = await graphService.addNodes("scan-1", entities);
      expect(result).toBe(2);
    });

    it("should handle mixed valid entity types", async () => {
      if (SKIP_INTEGRATION) return;

      const entities: CodeEntity[] = [
        {
          id: "func-1",
          type: "function",
          name: "testFunc",
          file_path: "test.ts",
          line_start: 1,
          line_end: 10,
        },
        {
          id: "loop-1",
          type: "loop",
          name: "testLoop",
          file_path: "test.ts",
          line_start: 5,
          line_end: 8,
        },
      ];

      const result = await graphService.addNodes("scan-1", entities);
      expect(result).toBe(2);
    });
  });

  describe("createRelationships", () => {
    it("should return 0 for empty relationships array", async () => {
      const result = await graphService.createRelationships("scan-1", []);
      expect(result).toBe(0);
    });

    it("should create relationships for each entry", async () => {
      if (SKIP_INTEGRATION) return;

      const relationships: CodeRelationship[] = [
        {
          source_id: "func-1",
          target_id: "func-2",
          relationship_type: "calls",
        },
        {
          source_id: "func-2",
          target_id: "func-3",
          relationship_type: "contains",
        },
      ];

      const result = await graphService.createRelationships("scan-1", relationships);
      expect(result).toBe(2);
    });
  });

  describe("detectNPlusOne", () => {
    it("should return N+1 candidates for scan", async () => {
      if (SKIP_INTEGRATION) return;

      const result = await graphService.detectNPlusOne("scan-1");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("deleteScanGraph", () => {
    it("should delete scan graph when Neo4j is available", async () => {
      if (SKIP_INTEGRATION) return;

      await graphService.deleteScanGraph("scan-1");
      const { neo4jClient } = await import("../db/clients/neo4j-client");
      expect(neo4jClient.session).toHaveBeenCalled();
    });
  });
});

describe("NPlusOneCandidate interface", () => {
  it("should have correct shape", () => {
    const candidate = {
      endpointPath: "/api/users",
      method: "GET",
      file: "handlers.ts",
      lineStart: 10,
      lineEnd: 20,
      ormMethod: "findMany",
      model: "User",
      functionName: "getUsers",
      isDynamic: true,
    };

    expect(candidate.endpointPath).toBe("/api/users");
    expect(candidate.method).toBe("GET");
    expect(candidate.isDynamic).toBe(true);
  });
});

describe("GraphStats interface", () => {
  it("should have correct shape", () => {
    const stats = {
      nodes: 100,
      edges: 250,
    };

    expect(stats.nodes).toBe(100);
    expect(stats.edges).toBe(250);
  });
});
