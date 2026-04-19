import { exec, execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import type { SemgrepFinding } from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAINT_RULE_PATH = join(__dirname, "..", "..", "rules", "express-taint.yaml");

const execAsync = promisify(exec);

export interface SemgrepRunOptions {
  rules?: string[];
  config?: string;
  targets: string[];
  timeout?: number;
  repoPath?: string;
  scanId?: string;
}

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

function isTestFixture(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");
  return TEST_FIXTURE_PATTERNS.some((pattern) =>
    normalizedPath.includes(pattern)
  );
}

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

export class SemgrepRunner {
  private defaultRules: string[] = [
    "p/owasp-top-ten",
    "p/nodejs",
    "p/secrets",
  ];

  async run(options: SemgrepRunOptions): Promise<SemgrepFinding[]> {
    const { config, targets, timeout = 300 } = options;
    const configStr = config || this.defaultRules.join(",");

    const cmdArgs: string[] = [];
    for (const c of configStr.split(",")) {
      cmdArgs.push("--config", c.trim());
    }

    // Add custom taint rule if available (same logic as original semgrep_runner.py)
    try {
      const fs = require("fs");
      if (fs.existsSync(TAINT_RULE_PATH)) {
        cmdArgs.push("--config", TAINT_RULE_PATH);
      }
    } catch {
      // Ignore if fs module fails
    }

    cmdArgs.push("--json", "--quiet", "--no-git-ignore");
    cmdArgs.push("--timeout", "60");
    cmdArgs.push("--max-memory", "4096");
    cmdArgs.push("--jobs", "4");
    cmdArgs.push(...targets);

    const command = `semgrep ${cmdArgs.join(" ")}`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: timeout * 1000,
        maxBuffer: 50 * 1024 * 1024,
      });

      return this.parseResults(stdout);
    } catch (error) {
      if (error instanceof Error && "stdout" in error) {
        const stdout = (error as { stdout?: string }).stdout;
        if (stdout) {
          return this.parseResults(stdout);
        }
      }
      console.error("Semgrep execution failed:", error);
      return [];
    }
  }

  async runOnFile(filePath: string, rules?: string[]): Promise<SemgrepFinding[]> {
    return this.run({
      rules: rules || this.defaultRules,
      targets: [filePath],
    });
  }

  async runOnDirectory(
    dirPath: string,
    patterns: string[] = ["*.js", "*.ts", "*.jsx", "*.tsx", "*.py"]
  ): Promise<SemgrepFinding[]> {
    const fs = require("fs");
    const { execSync } = require("child_process");
    
    if (!fs.existsSync(dirPath)) {
      console.error("[semgrep] Directory does not exist:", dirPath);
      return [];
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      console.error("[semgrep] Path is not a directory:", dirPath);
      return [];
    }

    let resolvedDir = dirPath;
    if (process.platform === "win32") {
      try {
        resolvedDir = execSync(`powershell -Command "(Get-Item '${dirPath}').FullName"`, { encoding: "utf-8" }).trim();
        console.log("[semgrep] Resolved path:", resolvedDir);
      } catch {
        console.log("[semgrep] Could not resolve short path, using original");
      }
    }

    const cmdArgs: string[] = [];
    for (const c of this.defaultRules) {
      cmdArgs.push("--config", c);
    }

    if (fs.existsSync(TAINT_RULE_PATH)) {
      cmdArgs.push("--config", TAINT_RULE_PATH);
    }

    cmdArgs.push("--json", "--no-git-ignore");
    cmdArgs.push("--timeout", "60");
    cmdArgs.push("--max-memory", "4096");
    cmdArgs.push("--jobs", "4");
    cmdArgs.push(resolvedDir);

    const cmdArray = ["semgrep", ...cmdArgs];
    console.log("[semgrep] Running command:", cmdArray.join(" "));

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile("semgrep", cmdArgs, {
          timeout: 300 * 1000,
          maxBuffer: 50 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      if (stderr) {
        console.log("[semgrep] stderr:", stderr.substring(0, 500));
      }
      console.log("[semgrep] stdout length:", stdout?.length || 0);
      if (stdout && stdout.length < 1000) {
        console.log("[semgrep] stdout content:", stdout);
      }

      return this.parseResults(stdout);
    } catch (error) {
      console.error("Semgrep directory scan failed:", error);
      return [];
    }
  }

  private parseResults(jsonOutput: string): SemgrepFinding[] {
    try {
      const parsed = JSON.parse(jsonOutput);
      const results: SemgrepFinding[] = [];
      const fileCache = new Map<string, string[]>();
      const totalResults = (parsed.results || []).length;
      let filteredByTest = 0;

      console.log("[semgrep] Raw semgrep results count:", totalResults);
      console.log("[semgrep] errors:", JSON.stringify(parsed.errors || []).substring(0, 1000));
      console.log("[semgrep] paths.scanned count:", (parsed.paths?.scanned || []).length);
      
      if (totalResults > 0) {
        console.log("[semgrep] First result check:", JSON.stringify(parsed.results[0]).substring(0, 500));
      }

      for (const result of parsed.results || []) {
        const extra = result.extra || {};
        const metadata = extra.metadata || {};
        const start = result.start || {};
        const end = result.end || {};
        const startLine = start.line || 0;
        const endLine = end.line || startLine;
        const path = result.path || "";
        const ruleId = result.check || "unknown";
        const vulnType = mapCheckIdToVulnType(ruleId);

        if (isTestFixture(path)) {
          filteredByTest++;
          console.log(`[semgrep] FILTERED (test fixture): ${path}:${startLine} (${ruleId})`);
          continue;
        }

        const codeSnippet = extractCodeContext(path, startLine, endLine);

        console.log(`[semgrep] KEEP: ${path}:${startLine} (${ruleId} -> ${vulnType})`);

        results.push({
          rule_id: ruleId,
          severity: this.mapSeverity(extra.severity),
          title: extra.message || result.check || "Unknown finding",
          description: extra.justification || extra.sprint || undefined,
          file_path: path,
          line_number: startLine,
          code_snippet: codeSnippet || undefined,
          cwe_id: metadata.cwe_id || this.extractCwe(ruleId),
          owasp_category: metadata.owasp || undefined,
          metadata: {
            confidence: extra.confidence,
            fix: extra.fix,
            suggested_fix: extra.suggested_fix,
            fingerprint: result.fingerprint || this.generateFingerprint(ruleId, path, startLine, codeSnippet),
            vuln_type: vulnType,
          },
        });
      }

      console.log("[semgrep] Filtered by test fixture:", filteredByTest);
      console.log("[semgrep] Results after filtering:", results.length);

      const deduplicated = this.deduplicateFindings(results, fileCache);
      console.log("[semgrep] Results after deduplication:", deduplicated.length);
      return deduplicated;
    } catch (error) {
      console.error("Failed to parse Semgrep results:", error);
      return [];
    }
  }

  private generateFingerprint(
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

  private deduplicateFindings(
    findings: SemgrepFinding[],
    fileCache: Map<string, string[]>
  ): SemgrepFinding[] {
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
        console.log(`[semgrep] DEDUP: ${finding.file_path}:${finding.line_number} - keeping ${existing.rule_id}, dropping ${finding.rule_id}`);
        if (
          finding.rule_id.startsWith("rules.") &&
          !existing.rule_id.startsWith("rules.")
        ) {
          console.log(`[semgrep] DEDUP REPLACE: ${finding.file_path}:${finding.line_number} - replacing with ${finding.rule_id}`);
          seen.set(key, finding);
        }
      }
    }

    const afterFirstDedup = Array.from(seen.values());
    console.log(`[semgrep] After first dedup: ${afterFirstDedup.length} findings (removed ${findings.length - afterFirstDedup.length})`);
    return this.deduplicateAdjacentFindings(afterFirstDedup, fileCache);
  }

  private deduplicateAdjacentFindings(
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

        const hasBoundary = hasFunctionBoundaryBetween(
          filePath,
          prevLine,
          lineStart,
          fileCache
        );

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

  private mapSeverity(severity: string): SemgrepFinding["severity"] {
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

  private extractCwe(ruleId: string): string | undefined {
    const cweMatch = ruleId.match(/CWE-(\d+)/i);
    if (cweMatch) {
      return `CWE-${cweMatch[1]}`;
    }
    return undefined;
  }
}

export const semgrepRunner = new SemgrepRunner();
