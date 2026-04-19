import { describe, it, expect, vi } from "bun:test";
import { z } from "zod";
import {
  projectSchema,
  scanQueueSchema,
  vulnerabilitySchema,
  scanStatusEnum,
  severityEnum,
  type Project,
  type ScanQueue,
  type Vulnerability,
} from "./index";

describe("Database Schemas", () => {
  describe("projectSchema", () => {
    it("should validate a valid project object", () => {
      const validProject = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Test Project",
        repository_url: "https://github.com/test/repo",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = projectSchema.safeParse(validProject);
      expect(result.success).toBe(true);
    });

    it("should reject project without name", () => {
      const invalidProject = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        repository_url: "https://github.com/test/repo",
      };

      const result = projectSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
    });

    it("should reject project with invalid url", () => {
      const invalidProject = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Test Project",
        repository_url: "not-a-url",
      };

      const result = projectSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
    });
  });

  describe("scanQueueSchema", () => {
    it("should validate a valid scan queue object", () => {
      const validScan = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        project_id: "123e4567-e89b-12d3-a456-426614174001",
        status: "pending",
        stage: "clone_repository",
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = scanQueueSchema.safeParse(validScan);
      expect(result.success).toBe(true);
    });

    it("should accept valid scan statuses", () => {
      const statuses = ["pending", "in_progress", "completed", "failed", "cancelled"];

      for (const status of statuses) {
        const scan = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          project_id: "123e4567-e89b-12d3-a456-426614174001",
          status,
          stage: "clone_repository",
        };

        const result = scanQueueSchema.safeParse(scan);
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid scan status", () => {
      const invalidScan = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        project_id: "123e4567-e89b-12d3-a456-426614174001",
        status: "invalid_status",
        stage: "clone_repository",
      };

      const result = scanQueueSchema.safeParse(invalidScan);
      expect(result.success).toBe(false);
    });
  });

  describe("vulnerabilitySchema", () => {
    it("should validate a valid vulnerability object", () => {
      const validVuln = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        scan_id: "123e4567-e89b-12d3-a456-426614174001",
        project_id: "123e4567-e89b-12d3-a456-426614174002",
        severity: "high",
        title: "SQL Injection",
        description: "Potential SQL injection vulnerability",
        file_path: "/src/db/query.ts",
        line_number: 42,
        code_snippet: "query = 'SELECT * FROM users WHERE id = ' + userId",
        cwe_id: "CWE-89",
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = vulnerabilitySchema.safeParse(validVuln);
      expect(result.success).toBe(true);
    });

    it("should accept valid severity levels", () => {
      const severities = ["critical", "high", "medium", "low", "info"];

      for (const severity of severities) {
        const vuln = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          scan_id: "123e4567-e89b-12d3-a456-426614174001",
          project_id: "123e4567-e89b-12d3-a456-426614174002",
          severity,
          title: "Test Vulnerability",
          description: "Test description",
        };

        const result = vulnerabilitySchema.safeParse(vuln);
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid severity", () => {
      const invalidVuln = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        scan_id: "123e4567-e89b-12d3-a456-426614174001",
        project_id: "123e4567-e89b-12d3-a456-426614174002",
        severity: "invalid",
        title: "Test Vulnerability",
      };

      const result = vulnerabilitySchema.safeParse(invalidVuln);
      expect(result.success).toBe(false);
    });
  });

  describe("scanStatusEnum", () => {
    it("should have correct values", () => {
      expect(scanStatusEnum.options).toEqual(["pending", "in_progress", "completed", "failed", "cancelled"]);
    });
  });

  describe("severityEnum", () => {
    it("should have correct values", () => {
      expect(severityEnum.options).toEqual(["critical", "high", "medium", "low", "info"]);
    });
  });
});