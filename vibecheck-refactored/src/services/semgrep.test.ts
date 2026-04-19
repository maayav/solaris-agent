import { describe, it, expect, beforeAll } from "bun:test";
import { SemgrepRunner, semgrepRunner } from "./semgrep";
import type { SemgrepFinding } from "../types";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

function isSemgrepInstalled(): boolean {
  try {
    execSync("semgrep --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SEMGREP_INSTALLED = isSemgrepInstalled();

describe("SemgrepRunner", () => {
  describe("run", () => {
    if (!SEMGREP_INSTALLED) {
      it("should handle empty results gracefully (skipped - semgrep not installed)", () => {});
    } else {
      it("should handle empty results gracefully", async () => {
        const runner = new SemgrepRunner();
        const results = await runner.run({
          targets: ["nonexistent_directory/"],
          timeout: 5,
        });
        expect(Array.isArray(results)).toBe(true);
      });
    }
  });

  describe("runOnFile", () => {
    if (!SEMGREP_INSTALLED) {
      it("should handle nonexistent files gracefully (skipped - semgrep not installed)", () => {});
    } else {
      it("should handle nonexistent files gracefully", async () => {
        const runner = new SemgrepRunner();
        const results = await runner.runOnFile("/nonexistent/file.ts");
        expect(Array.isArray(results)).toBe(true);
      });
    }
  });

  describe("runOnDirectory", () => {
    if (!SEMGREP_INSTALLED) {
      it("should handle nonexistent directories gracefully (skipped - semgrep not installed)", () => {});
    } else {
      it("should handle nonexistent directories gracefully", async () => {
        const runner = new SemgrepRunner();
        const results = await runner.runOnDirectory("/nonexistent/directory");
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(0);
      });
    }
  });
});

describe("Semgrep dedup logic", () => {
  describe("isTestFixture", () => {
    const TEST_FIXTURE_PATTERNS = [
      "test",
      "spec",
      "__tests__",
      "fixture",
      "mock",
      "example",
      "sample",
      "demo",
      "codefixes",
      "vulncodefixes",
      "_correct.ts",
      "impossible.php",
      ".min.",
      ".test.",
      ".spec.",
    ];

    function isTestFixture(filePath: string): boolean {
      const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");
      return TEST_FIXTURE_PATTERNS.some((pattern) =>
        normalizedPath.includes(pattern)
      );
    }

    it("should filter out test files", () => {
      expect(isTestFixture("src/components/Button.test.tsx")).toBe(true);
      expect(isTestFixture("src/utils/helpers.spec.ts")).toBe(true);
      expect(isTestFixture("__tests__/integration.test.js")).toBe(true);
      expect(isTestFixture("fixtures/test-data.json")).toBe(true);
    });

    it("should filter out mock and example files", () => {
      expect(isTestFixture("src/api/mock-server.ts")).toBe(true);
      expect(isTestFixture("examples/auth-example.ts")).toBe(true);
      expect(isTestFixture("demo/sample-app.js")).toBe(true);
    });

    it("should filter out vulncodefixes directory", () => {
      expect(isTestFixture("vulncodefixes/sql_injection.java")).toBe(true);
      expect(isTestFixture("codefixes/xss_fix.ts")).toBe(true);
    });

    it("should allow production files", () => {
      expect(isTestFixture("src/components/Button.tsx")).toBe(false);
      expect(isTestFixture("src/utils/parser.ts")).toBe(false);
      expect(isTestFixture("lib/authentication.ts")).toBe(false);
    });
  });

  describe("mapCheckIdToVulnType", () => {
    const CHECK_ID_TO_VULN_TYPE: Record<string, string> = {
      sql: "sql_injection",
      sqli: "sql_injection",
      xss: "xss",
      secret: "hardcoded_secret",
      hardcoded: "hardcoded_secret",
      path: "path_traversal",
      traversal: "path_traversal",
      "tainted-filename": "path_traversal",
      "tainted-file": "path_traversal",
      filename: "path_traversal",
      "file-read": "path_traversal",
      sendfile: "path_traversal",
      "express-res-sendfile": "path_traversal",
      command: "command_injection",
      exec: "command_injection",
      rce: "command_injection",
      "tainted-exec": "command_injection",
      "tainted-sql": "sql_injection",
      echoed: "xss",
      echo: "xss",
      ssrf: "ssrf",
      redirect: "open_redirect",
      jwt: "jwt_issue",
      crypto: "weak_crypto",
      hash: "weak_crypto",
      random: "weak_random",
      eval: "code_injection",
      deserialize: "insecure_deserialization",
      prototype: "prototype_pollution",
      auth: "missing_auth",
      cors: "cors_misconfiguration",
    };

    function mapCheckIdToVulnType(checkId: string): string {
      const checkIdLower = checkId.toLowerCase();

      const sortedPatterns = Object.keys(CHECK_ID_TO_VULN_TYPE).sort(
        (a, b) => b.length - a.length
      );

      for (const pattern of sortedPatterns) {
        if (checkIdLower.includes(pattern)) {
          return CHECK_ID_TO_VULN_TYPE[pattern] || "security_misconfiguration";
        }
      }

      return "security_misconfiguration";
    }

    it("should map sql injection patterns", () => {
      expect(mapCheckIdToVulnType("sql-injection")).toBe("sql_injection");
      expect(mapCheckIdToVulnType("sqli")).toBe("sql_injection");
      expect(mapCheckIdToVulnType("tainted-sql-call")).toBe("sql_injection");
    });

    it("should map xss patterns", () => {
      expect(mapCheckIdToVulnType("xss")).toBe("xss");
      expect(mapCheckIdToVulnType("echoed-html")).toBe("xss");
      expect(mapCheckIdToVulnType("reflected-xss")).toBe("xss");
    });

    it("should map path traversal patterns", () => {
      expect(mapCheckIdToVulnType("path-traversal")).toBe("path_traversal");
      expect(mapCheckIdToVulnType("tainted-filename")).toBe("path_traversal");
      expect(mapCheckIdToVulnType("file-read")).toBe("path_traversal");
    });

    it("should map command injection patterns", () => {
      expect(mapCheckIdToVulnType("command-injection")).toBe("command_injection");
      expect(mapCheckIdToVulnType("rce")).toBe("command_injection");
      expect(mapCheckIdToVulnType("tainted-exec")).toBe("command_injection");
    });

    it("should map hardcoded secrets", () => {
      expect(mapCheckIdToVulnType("hardcoded-secret")).toBe("hardcoded_secret");
      expect(mapCheckIdToVulnType("hardcoded-api-key")).toBe("hardcoded_secret");
    });

    it("should map unknown patterns to security_misconfiguration", () => {
      expect(mapCheckIdToVulnType("some-unknown-pattern")).toBe("security_misconfiguration");
    });

    it("should prefer longer pattern matches", () => {
      expect(mapCheckIdToVulnType("express-res-sendfile")).toBe("path_traversal");
    });
  });

  describe("severity mapping", () => {
    function mapSeverity(severity: string): "high" | "medium" | "low" | "info" {
      switch (severity.toLowerCase()) {
        case "error":
          return "high";
        case "warning":
          return "medium";
        case "info":
          return "low";
        default:
          return "info";
      }
    }

    it("should map ERROR to high", () => {
      expect(mapSeverity("ERROR")).toBe("high");
      expect(mapSeverity("error")).toBe("high");
    });

    it("should map WARNING to medium", () => {
      expect(mapSeverity("WARNING")).toBe("medium");
      expect(mapSeverity("warning")).toBe("medium");
    });

    it("should map INFO to low", () => {
      expect(mapSeverity("INFO")).toBe("low");
      expect(mapSeverity("info")).toBe("low");
    });

    it("should default to info for unknown", () => {
      expect(mapSeverity("unknown")).toBe("info");
    });
  });

  describe("deduplicateFindings", () => {
    function deduplicateFindings(findings: SemgrepFinding[]): SemgrepFinding[] {
      const seen = new Map<string, SemgrepFinding>();

      const sorted = [...findings].sort((a, b) => {
        const keyA = `${a.file_path}:${a.rule_id}:${a.line_number}`;
        const keyB = `${b.file_path}:${b.rule_id}:${b.line_number}`;
        return keyA.localeCompare(keyB);
      });

      for (const finding of sorted) {
        const key = `${finding.file_path}:${finding.line_number}`;
        if (!seen.has(key)) {
          seen.set(key, finding);
        } else {
          const existing = seen.get(key)!;
          if (
            finding.rule_id.startsWith("rules.") &&
            !existing.rule_id.startsWith("rules.")
          ) {
            seen.set(key, finding);
          }
        }
      }

      return Array.from(seen.values());
    }

    it("should deduplicate findings on same file and line", () => {
      const findings: SemgrepFinding[] = [
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.length).toBe(1);
      expect(result[0]!.line_number).toBe(10);
    });

    it("should keep findings on different lines", () => {
      const findings: SemgrepFinding[] = [
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 20,
          code_snippet: "innerHTML = userInput2",
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.length).toBe(2);
    });

    it("should keep findings on different files", () => {
      const findings: SemgrepFinding[] = [
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/utils.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.length).toBe(2);
    });

    it("should prefer rules.* style rule_ids over others", () => {
      const findings: SemgrepFinding[] = [
        {
          rule_id: "javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
        {
          rule_id: "rules.javascript-xss",
          severity: "high",
          title: "XSS found",
          file_path: "src/index.ts",
          line_number: 10,
          code_snippet: "innerHTML = userInput",
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result.length).toBe(1);
      expect(result[0]!.rule_id).toBe("rules.javascript-xss");
    });
  });

  describe("hasFunctionBoundaryBetween", () => {
    const FUNCTION_BOUNDARY_PATTERNS = [
      /export\s+function\s+\w+/,
      /export\s+const\s+\w+\s*=/,
      /export\s+async\s+function/,
      /export\s+default\s+function/,
      /^\s*function\s+\w+/,
      /^\s*async\s+function\s+\w+/,
      /^\s*const\s+\w+\s*=\s*\(/,
      /^\s*const\s+\w+\s*=\s*async/,
      /function\s+\w+\s*\(/,
      /public\s+function\s+\w+/,
      /private\s+function\s+\w+/,
      /protected\s+function\s+\w+/,
      /static\s+function\s+\w+/,
      /^\s*def\s+\w+\s*\(/,
      /^\s*async\s+def\s+\w+\s*\(/,
      /^\s*class\s+\w+/,
    ];

    function hasFunctionBoundaryBetween(
      filePath: string,
      line1: number,
      line2: number,
      fileCache: Map<string, string[]>
    ): boolean {
      if (line1 > line2) {
        [line1, line2] = [line2, line1];
      }

      try {
        let allLines: string[];
        if (fileCache.has(filePath)) {
          allLines = fileCache.get(filePath)!;
        } else {
          const content = require("fs").readFileSync(filePath, "utf-8");
          allLines = content.split("\n");
          fileCache.set(filePath, allLines);
        }

        for (
          let lineNum = line1;
          lineNum < Math.min(line2 - 1, allLines.length);
          lineNum++
        ) {
          const line = allLines[lineNum] || "";
          for (const pattern of FUNCTION_BOUNDARY_PATTERNS) {
            if (pattern.test(line)) {
              return true;
            }
          }
        }
        return false;
      } catch {
        return true;
      }
    }

    it("should detect function declarations as boundaries", () => {
      const fileCache = new Map<string, string[]>();
      const content = `line1
function myFunc() {
line3
}`;
      fileCache.set("test.ts", content.split("\n"));
      
      expect(hasFunctionBoundaryBetween("test.ts", 1, 4, fileCache)).toBe(true);
    });

    it("should detect class declarations as boundaries", () => {
      const fileCache = new Map<string, string[]>();
      const content = `line1
class MyClass {
line3
}`;
      fileCache.set("test.ts", content.split("\n"));
      
      expect(hasFunctionBoundaryBetween("test.ts", 1, 4, fileCache)).toBe(true);
    });

    it("should detect arrow functions as boundaries", () => {
      const fileCache = new Map<string, string[]>();
      const content = `line1
const myFunc = () => {
line3
}`;
      fileCache.set("test.ts", content.split("\n"));
      
      expect(hasFunctionBoundaryBetween("test.ts", 1, 4, fileCache)).toBe(true);
    });

    it("should return false when no boundary exists", () => {
      const fileCache = new Map<string, string[]>();
      const content = `line1
line2
line3
line4
`;
      fileCache.set("test.ts", content.split("\n"));
      
      expect(hasFunctionBoundaryBetween("test.ts", 1, 3, fileCache)).toBe(false);
    });

    it("should return true for nonexistent files (fail-safe)", () => {
      const fileCache = new Map<string, string[]>();
      expect(hasFunctionBoundaryBetween("/nonexistent/file.ts", 1, 3, fileCache)).toBe(true);
    });
  });

  describe("extractCodeContext", () => {
    function extractCodeContext(
      filePath: string,
      startLine: number,
      endLine: number,
      context: number = 4
    ): string {
      try {
        const content = require("fs").readFileSync(filePath, "utf-8");
        const allLines = content.split("\n");
        const lo = Math.max(0, startLine - 1 - context);
        const hi = Math.min(allLines.length, endLine + context);
        return allLines.slice(lo, hi).join("\n").trim();
      } catch {
        return "";
      }
    }

    it("should extract code with default context", () => {
      const content = `function before() {}
function target() {
  const x = 1;
}
function after() {}`;
      writeFileSync("/tmp/test_extract.ts", content);
      
      const result = extractCodeContext("/tmp/test_extract.ts", 2, 4);
      expect(result).toContain("function target()");
      expect(result).toContain("const x = 1");
    });

    it("should handle custom context size", () => {
      const content = `line1
function target() {
  const x = 1;
}`;
      writeFileSync("/tmp/test_context.ts", content);
      
      const result = extractCodeContext("/tmp/test_context.ts", 2, 3, 1);
      expect(result).toContain("line1");
      expect(result).toContain("function target()");
      expect(result).toContain("const x = 1;");
    });

    it("should handle nonexistent files gracefully", () => {
      const result = extractCodeContext("/nonexistent/file.ts", 1, 3);
      expect(result).toBe("");
    });

    it("should handle lines near file boundaries", () => {
      const content = `line1
line2`;
      writeFileSync("/tmp/test_boundary.ts", content);
      
      const result = extractCodeContext("/tmp/test_boundary.ts", 1, 2, 10);
      expect(result).toBe("line1\nline2");
    });
  });

  describe("generateFingerprint", () => {
    function generateFingerprint(
      ruleId: string,
      filePath: string,
      lineNumber: number,
      codeSnippet?: string
    ): string {
      const content = `${ruleId}:${filePath}:${lineNumber}:${(codeSnippet || "").substring(0, 100)}`;
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16);
    }

    it("should generate consistent fingerprints", () => {
      const fp1 = generateFingerprint("sql-injection", "src/db.ts", 42, "SELECT * FROM users");
      const fp2 = generateFingerprint("sql-injection", "src/db.ts", 42, "SELECT * FROM users");
      expect(fp1).toBe(fp2);
    });

    it("should generate different fingerprints for different locations", () => {
      const fp1 = generateFingerprint("sql-injection", "src/db.ts", 42);
      const fp2 = generateFingerprint("sql-injection", "src/db.ts", 43);
      expect(fp1).not.toBe(fp2);
    });

    it("should generate different fingerprints for different rules", () => {
      const fp1 = generateFingerprint("sql-injection", "src/db.ts", 42);
      const fp2 = generateFingerprint("xss", "src/db.ts", 42);
      expect(fp1).not.toBe(fp2);
    });

    it("should truncate long code snippets to 100 chars", () => {
      const longSnippet = "a".repeat(200);
      const fp1 = generateFingerprint("sql", "f", 1, longSnippet);
      const fp2 = generateFingerprint("sql", "f", 1, "a".repeat(100));
      expect(fp1).toBe(fp2);
    });

    it("should handle undefined code snippet", () => {
      const fp = generateFingerprint("sql-injection", "src/db.ts", 42);
      expect(fp).toBeTruthy();
      expect(fp.length).toBeGreaterThan(0);
    });
  });

  describe("adjacent-line deduplication", () => {
    function deduplicateAdjacentFindings(
      findings: SemgrepFinding[],
      fileCache: Map<string, string[]>,
      window: number = 30
    ): SemgrepFinding[] {
      if (!findings.length) return findings;

      const sorted = [...findings].sort((a, b) => {
        const keyA = `${a.file_path}:${a.rule_id}:${a.line_number}`;
        const keyB = `${b.file_path}:${b.rule_id}:${b.line_number}`;
        return keyA.localeCompare(keyB);
      });

      const clusters = new Map<string, SemgrepFinding>();
      const lastFinding = new Map<string, SemgrepFinding>();

      const FUNCTION_BOUNDARY_PATTERNS = [
        /export\s+function\s+\w+/,
        /export\s+const\s+\w+\s*=/,
        /function\s+\w+\s*\(/,
        /class\s+\w+/,
      ];

      for (const finding of sorted) {
        const filePath = finding.file_path;
        const ruleId = finding.rule_id;
        const lineStart = finding.line_number;
        const fileRuleKey = `${filePath}:${ruleId}`;

        if (!lastFinding.has(fileRuleKey)) {
          const clusterKey = `${filePath}:${ruleId}:${lineStart}`;
          clusters.set(clusterKey, finding);
          lastFinding.set(fileRuleKey, finding);
        } else {
          const prev = lastFinding.get(fileRuleKey)!;
          const prevLine = prev.line_number;

          let hasBoundary = false;
          try {
            let allLines: string[];
            if (fileCache.has(filePath)) {
              allLines = fileCache.get(filePath)!;
            } else {
              const content = require("fs").readFileSync(filePath, "utf-8");
              allLines = content.split("\n");
              fileCache.set(filePath, allLines);
            }

            for (
              let lineNum = prevLine;
              lineNum < Math.min(lineStart - 1, allLines.length);
              lineNum++
            ) {
              const line = allLines[lineNum] || "";
              for (const pattern of FUNCTION_BOUNDARY_PATTERNS) {
                if (pattern.test(line)) {
                  hasBoundary = true;
                  break;
                }
              }
              if (hasBoundary) break;
            }
          } catch {
            hasBoundary = true;
          }

          if (Math.abs(lineStart - prevLine) <= window && !hasBoundary) {
            const existingClusterKey = `${filePath}:${ruleId}:${prev.line_number}`;
            if (clusters.has(existingClusterKey) && lineStart < prev.line_number) {
              clusters.delete(existingClusterKey);
              const newClusterKey = `${filePath}:${ruleId}:${lineStart}`;
              clusters.set(newClusterKey, finding);
            }
            lastFinding.set(fileRuleKey, finding);
          } else {
            const clusterKey = `${filePath}:${ruleId}:${lineStart}`;
            clusters.set(clusterKey, finding);
            lastFinding.set(fileRuleKey, finding);
          }
        }
      }

      return Array.from(clusters.values());
    }

    it("should merge nearby findings within window", () => {
      const fileCache = new Map<string, string[]>();
      fileCache.set("test.ts", [
        "line0",
        "const a = 1;",
        "const b = 2;",
        "const c = 3;",
        "const d = 4;",
      ]);

      const findings: SemgrepFinding[] = [
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 2 },
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 3 },
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 4 },
      ];

      const result = deduplicateAdjacentFindings(findings, fileCache, 30);
      expect(result.length).toBe(1);
      expect(result[0]!.line_number).toBe(2);
    });

    it("should keep findings separated by function boundaries", () => {
      const fileCache = new Map<string, string[]>();
      fileCache.set("test.ts", [
        "line0",
        "function foo() {}",
        "const a = 1;",
        "function bar() {}",
        "const b = 2;",
      ]);

      const findings: SemgrepFinding[] = [
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 2 },
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 3 },
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 5 },
      ];

      const result = deduplicateAdjacentFindings(findings, fileCache, 30);
      expect(result.length).toBe(2);
    });

    it("should keep findings outside window apart", () => {
      const findings: SemgrepFinding[] = [
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 2 },
        { rule_id: "test", severity: "high", title: "test finding", file_path: "test.ts", line_number: 100 },
      ];

      const result = deduplicateAdjacentFindings(findings, new Map(), 30);
      expect(result.length).toBe(2);
    });

    it("should handle empty findings array", () => {
      const result = deduplicateAdjacentFindings([], new Map());
      expect(result.length).toBe(0);
    });

    it("should handle different rule_ids separately", () => {
      const findings: SemgrepFinding[] = [
        { rule_id: "sql-injection", severity: "high", title: "test finding", file_path: "test.ts", line_number: 2 },
        { rule_id: "sql-injection", severity: "high", title: "test finding", file_path: "test.ts", line_number: 3 },
        { rule_id: "xss", severity: "high", title: "test finding", file_path: "test.ts", line_number: 2 },
        { rule_id: "xss", severity: "high", title: "test finding", file_path: "test.ts", line_number: 3 },
      ];

      const result = deduplicateAdjacentFindings(findings, new Map(), 30);
      expect(result.length).toBe(4);
    });
  });
});
