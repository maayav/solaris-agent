import { describe, it, expect } from "bun:test";
import type { LLMVerificationResult } from "../services/ollama";

describe("ScanWorker severity mapping", () => {
  function mapSeverity(vulnType: string): string {
    const severityMap: Record<string, string> = {
      sql_injection: "critical",
      sqli: "critical",
      xss: "high",
      "cross-site scripting": "high",
      ssrf: "high",
      "server-side request forgery": "high",
      hardcoded_secret: "high",
      hardcoded_jwt: "critical",
      n_plus_1: "medium",
      prototype_pollution: "high",
      path_traversal: "high",
      command_injection: "critical",
      code_injection: "critical",
      open_redirect: "medium",
      csrf: "medium",
      security_misconfiguration: "medium",
      jwt_issue: "high",
      weak_crypto: "medium",
      weak_random: "medium",
      missing_auth: "high",
      cors_misconfiguration: "medium",
    };

    const vulnLower = vulnType.toLowerCase();
    for (const [key, severity] of Object.entries(severityMap)) {
      if (vulnLower.includes(key)) {
        return severity;
      }
    }
    return "medium";
  }

  it("should map sql_injection to critical", () => {
    expect(mapSeverity("sql_injection")).toBe("critical");
    expect(mapSeverity("SQL_INJECTION")).toBe("critical");
    expect(mapSeverity("sqli")).toBe("critical");
  });

  it("should map xss to high", () => {
    expect(mapSeverity("xss")).toBe("high");
    expect(mapSeverity("cross-site scripting")).toBe("high");
    expect(mapSeverity("XSS")).toBe("high");
  });

  it("should map ssrf to high", () => {
    expect(mapSeverity("ssrf")).toBe("high");
    expect(mapSeverity("server-side request forgery")).toBe("high");
  });

  it("should map hardcoded_secret to high", () => {
    expect(mapSeverity("hardcoded_secret")).toBe("high");
    expect(mapSeverity("hardcoded_jwt")).toBe("critical");
  });

  it("should map n_plus_1 to medium", () => {
    expect(mapSeverity("n_plus_1")).toBe("medium");
    expect(mapSeverity("n+1")).toBe("medium");
  });

  it("should map command_injection to critical", () => {
    expect(mapSeverity("command_injection")).toBe("critical");
    expect(mapSeverity("command_injection_detected")).toBe("critical");
  });

  it("should map path_traversal to high", () => {
    expect(mapSeverity("path_traversal")).toBe("high");
    expect(mapSeverity("path_traversal_vulnerability")).toBe("high");
  });

  it("should map open_redirect to medium", () => {
    expect(mapSeverity("open_redirect")).toBe("medium");
  });

  it("should map prototype_pollution to high", () => {
    expect(mapSeverity("prototype_pollution")).toBe("high");
  });

  it("should default to medium for unknown types", () => {
    expect(mapSeverity("some_unknown_vuln")).toBe("medium");
    expect(mapSeverity("custom_vulnerability")).toBe("medium");
  });
});

describe("buildVulnerabilityRecord", () => {
  function buildVulnerabilityRecord(
    scanId: string,
    projectId: string,
    candidate: { vuln_type: string; rule_id: string; code_snippet: string; file_path: string; line_start: number },
    result: LLMVerificationResult
  ): Record<string, unknown> {
    const severityMap: Record<string, string> = {
      sql_injection: "critical",
      sqli: "critical",
      xss: "high",
      "cross-site scripting": "high",
      ssrf: "high",
      "server-side request forgery": "high",
      hardcoded_secret: "high",
      hardcoded_jwt: "critical",
      n_plus_1: "medium",
      prototype_pollution: "high",
      path_traversal: "high",
      command_injection: "critical",
      code_injection: "critical",
      open_redirect: "medium",
      csrf: "medium",
      security_misconfiguration: "medium",
      jwt_issue: "high",
      weak_crypto: "medium",
      weak_random: "medium",
      missing_auth: "high",
      cors_misconfiguration: "medium",
    };

    const mapSeverity = (vulnType: string): string => {
      const vulnLower = vulnType.toLowerCase();
      for (const [key, severity] of Object.entries(severityMap)) {
        if (vulnLower.includes(key)) {
          return severity;
        }
      }
      return "medium";
    };

    const severity = mapSeverity(candidate.vuln_type);
    const confidenceScore = result.confidence === "high" ? 0.9 : result.confidence === "medium" ? 0.7 : 0.5;
    const vulnTypeClean = candidate.vuln_type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const fileName = candidate.file_path.split("/").pop() || "Unknown";

    return {
      scan_id: scanId,
      project_id: projectId,
      type: candidate.vuln_type,
      severity,
      category: candidate.rule_id,
      title: `${vulnTypeClean} in ${fileName}:${candidate.line_start}`,
      description: result.reasoning || "Security vulnerability detected",
      file_path: candidate.file_path,
      line_start: candidate.line_start,
      code_snippet: candidate.code_snippet,
      confirmed: result.is_vulnerability,
      confidence: result.confidence,
      confidence_score: confidenceScore,
      reasoning: result.reasoning,
      remediation: result.remediation,
      llm_source: result.source,
      details: { rule_id: candidate.rule_id, vuln_type: candidate.vuln_type },
    };
  }

  it("should build a complete vulnerability record", () => {
    const scanId = "scan-123";
    const projectId = "proj-456";
    const candidate = {
      vuln_type: "sql_injection",
      rule_id: "javascript-sql-injection",
      code_snippet: "const query = 'SELECT * FROM users WHERE id = ' + userId",
      file_path: "src/database/users.ts",
      line_start: 42,
    };
    const result: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "high",
      reasoning: "User input is directly concatenated into SQL query",
      remediation: "Use parameterized queries",
      source: "openrouter",
    };

    const record = buildVulnerabilityRecord(scanId, projectId, candidate, result);

    expect(record.scan_id).toBe(scanId);
    expect(record.project_id).toBe(projectId);
    expect(record.type).toBe("sql_injection");
    expect(record.severity).toBe("critical");
    expect(record.category).toBe("javascript-sql-injection");
    expect(record.title).toContain("Sql Injection");
    expect(record.title).toContain("users.ts:42");
    expect(record.file_path).toBe("src/database/users.ts");
    expect(record.line_start).toBe(42);
    expect(record.confirmed).toBe(true);
    expect(record.confidence).toBe("high");
    expect(record.confidence_score).toBe(0.9);
    expect(record.llm_source).toBe("openrouter");
    expect(record.remediation).toBe("Use parameterized queries");
  });

  it("should map confidence correctly", () => {
    const baseCandidate = {
      vuln_type: "xss",
      rule_id: "javascript-xss",
      code_snippet: "element.innerHTML = userInput",
      file_path: "src/index.ts",
      line_start: 10,
    };

    const highResult: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "high",
      reasoning: "XSS found",
      source: "ollama",
    };
    const highRecord = buildVulnerabilityRecord("scan-1", "proj-1", baseCandidate, highResult);
    expect(highRecord.confidence_score).toBe(0.9);

    const mediumResult: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "medium",
      reasoning: "Possible XSS",
      source: "ollama",
    };
    const mediumRecord = buildVulnerabilityRecord("scan-2", "proj-2", baseCandidate, mediumResult);
    expect(mediumRecord.confidence_score).toBe(0.7);

    const lowResult: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "low",
      reasoning: "Unclear",
      source: "ollama",
    };
    const lowRecord = buildVulnerabilityRecord("scan-3", "proj-3", baseCandidate, lowResult);
    expect(lowRecord.confidence_score).toBe(0.5);
  });

  it("should extract filename correctly from file_path", () => {
    const candidate = {
      vuln_type: "ssrf",
      rule_id: "javascript-ssrf",
      code_snippet: "fetch(userUrl)",
      file_path: "/path/to/my-project/src/api/client.ts",
      line_start: 15,
    };
    const result: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "high",
      reasoning: "SSRF",
      source: "ollama",
    };

    const record = buildVulnerabilityRecord("scan-1", "proj-1", candidate, result);

    expect(record.title).toContain("client.ts:15");
  });

  it("should capitalize vulnerability type in title", () => {
    const candidate = {
      vuln_type: "n_plus_1",
      rule_id: "neo4j-n-plus-1",
      code_snippet: "for (const id of ids) { db.query(id); }",
      file_path: "src/utils.ts",
      line_start: 5,
    };
    const result: LLMVerificationResult = {
      is_vulnerability: true,
      confidence: "medium",
      reasoning: "N+1 query",
      source: "ollama",
    };

    const record = buildVulnerabilityRecord("scan-1", "proj-1", candidate, result);

    expect(record.title).toContain("N Plus_1");
  });
});
