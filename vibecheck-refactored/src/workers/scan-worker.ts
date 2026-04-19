import { simpleGit, SimpleGit } from "simple-git";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { treeSitterParser } from "../services/parser";
import { semgrepRunner } from "../services/semgrep";
import { ollamaClient, type LLMVerificationResult } from "../services/ollama";
import { graphService } from "../services/graph";
import { qdrantClient } from "../db/clients/qdrant-client";
import { neo4jClient } from "../db/clients/neo4j-client";
import { supabaseClient } from "../db/clients/supabase-client";
import { redisClient } from "../db/clients/redis-client";
import type { CodeEntity, CodeRelationship, SemgrepFinding } from "../types";

const STAGES = [
  "clone",
  "parse",
  "graph",
  "n_plus_one",
  "semgrep",
  "semantic_lift",
  "llm_verify",
  "pattern_propagate",
  "storage",
] as const;

const BATCH_SIZE = 5;

export interface VerifiedVuln {
  vuln_type: string;
  rule_id: string;
  code_snippet: string;
  file_path: string;
  line_start: number;
  severity: string;
  confidence: string;
  reasoning: string;
  remediation?: string;
  llm_source: string;
}

export interface ScanContext {
  scanId: string;
  projectId: string;
  repositoryUrl: string;
  branch: string;
  cloneDir: string;
  entities?: CodeEntity[];
  relationships?: CodeRelationship[];
  nPlusOnes?: Array<{ functionId: string; functionName: string; callCount: number; codeSnippet?: string; filePath?: string; lineStart?: number }>;
  semgrepFindings?: SemgrepFinding[];
  verifiedVulns?: VerifiedVuln[];
}

export interface ScanStageResult {
  stage: (typeof STAGES)[number];
  status: "completed" | "skipped" | "error";
  progress: number;
  stats?: Record<string, unknown>;
}

export class ScanWorker {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();
  }

  async start(): Promise<void> {
    console.log("Scan worker starting...");

    await redisClient.connect();
    console.log("Connected to Redis");

    await supabaseClient.connect();
    console.log("Connected to Supabase");

    await neo4jClient.connect();
    console.log("Connected to Neo4j");

    await qdrantClient.connect();
    console.log("Connected to Qdrant");

    await redisClient.setupConsumerGroups([
      { stream: "scan_queue", group: "scan_workers" },
    ]);
    console.log("Consumer groups initialized");

    await this.processPendingMessages();

    await this.consumeScanQueue();
  }

  async stop(): Promise<void> {
    console.log("Stopping scan worker...");
    await redisClient.disconnect();
    await supabaseClient.disconnect();
    await neo4jClient.disconnect();
    await qdrantClient.disconnect();
  }

  private async processPendingMessages(): Promise<void> {
    try {
      const messages = await redisClient.xRead("scan_queue", "scan_workers", this.workerId(), 60000, 10);
      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (error) {
      console.error("Error claiming pending messages:", error);
    }
  }

  private async consumeScanQueue(): Promise<void> {
    for await (const message of redisClient.xConsume("scan_queue", "scan_workers", this.workerId())) {
      await this.processMessage(message);
    }
  }

  private workerId(): string {
    return `worker-${randomUUID().slice(0, 8)}`;
  }

  async processMessage(message: { id: string; data: Record<string, string> }): Promise<void> {
    const { id: msgId, data } = message;
    const scanId = data.scan_id;
    const projectId = data.project_id;
    const repositoryUrl = data.repo_url;
    const branch = data.branch || "main";
    const options = data.options ? JSON.parse(data.options) : {};

    console.log(`Processing scan job: ${scanId}`);

    const context: ScanContext = {
      scanId: scanId!,
      projectId: projectId!,
      repositoryUrl: repositoryUrl!,
      branch,
      cloneDir: join(tmpdir(), `scan_${scanId!}`),
    };

    try {
      await this.updateScanStatus(scanId!, "running", 0, "Starting scan");

      await this.runStage(context, "clone", 5, () => this.stageClone(context));
      await this.runStage(context, "parse", 15, () => this.stageParse(context));
      await this.runStage(context, "graph", 25, () => this.stageGraph(context));
      await this.runStage(context, "n_plus_one", 35, () => this.stageNPlusOne(context));

      if (options.enable_semgrep !== false) {
        await this.runStage(context, "semgrep", 50, () => this.stageSemgrep(context));
      } else {
        await this.runStage(context, "semgrep", 50, async () => ({ status: "skipped", stats: { reason: "disabled" } }));
      }

      if (options.enable_llm_verification !== false) {
        await this.runStage(context, "semantic_lift", 65, () => this.stageSemanticLift(context));
        await this.runStage(context, "llm_verify", 70, () => this.stageLLMVerify(context));
        await this.runStage(context, "pattern_propagate", 80, () => this.stagePatternPropagate(context));
      } else {
        await this.runStage(context, "semantic_lift", 65, async () => ({ status: "skipped", stats: { reason: "disabled" } }));
        await this.runStage(context, "llm_verify", 70, async () => ({ status: "skipped", stats: { reason: "disabled" } }));
        await this.runStage(context, "pattern_propagate", 80, async () => ({ status: "skipped", stats: { reason: "disabled" } }));
      }

      await this.runStage(context, "storage", 95, () => this.stageStorage(context));

      await this.updateScanStatus(scanId!, "completed", 100, "Completed");
      await redisClient.xAck("scan_queue", "scan_workers", msgId);

      console.log(`Scan job completed: ${scanId}`);
    } catch (error) {
      console.error(`Scan job failed: ${scanId}`, error);
      await this.updateScanStatus(scanId!, "failed", 0, "Failed", String(error));
      throw error;
    }
  }

  private async runStage(
    context: ScanContext,
    stage: (typeof STAGES)[number],
    progressPercent: number,
    fn: () => Promise<{ status: string; stats?: Record<string, unknown> }>
  ): Promise<void> {
    const stageIndex = STAGES.indexOf(stage);
    console.log(`[${stage}] Starting stage...`);

    try {
      const result = await fn();
      console.log(`[${stage}] Completed:`, result.stats);

      const nextStage = STAGES[stageIndex + 1] || "Completed";
      await this.updateScanStatus(context.scanId, "running", progressPercent, nextStage);
    } catch (error) {
      console.error(`[${stage}] Stage failed:`, error);
      await this.updateScanStatus(context.scanId, "failed", progressPercent, `${stage} failed`);
      throw error;
    }
  }

  private async stageClone(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    await fs.rm(context.cloneDir, { recursive: true, force: true });
    await this.git.clone(context.repositoryUrl, context.cloneDir, ["--depth", "1"]);

    return {
      status: "completed",
      stats: { repository_url: context.repositoryUrl },
    };
  }

  private async stageParse(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    const entities: CodeEntity[] = [];
    const relationships: CodeRelationship[] = [];

    await this.walkDirectory(context.cloneDir, async (filePath) => {
      const language = treeSitterParser.detectLanguage(filePath);
      if (!language) return;

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const tree = treeSitterParser.parseFile(content, language);
        const fileEntities = treeSitterParser.extractEntities(tree, filePath);
        const fileRelationships = treeSitterParser.extractRelationships(fileEntities, tree, filePath);

        entities.push(...fileEntities);
        relationships.push(...fileRelationships);
      } catch {
        // Skip files that can't be parsed
      }
    });

    context.entities = entities;
    context.relationships = relationships;

    return {
      status: "completed",
      stats: { entities: entities.length, relationships: relationships.length },
    };
  }

  private async stageGraph(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    await graphService.createScanGraph(
      context.scanId,
      context.projectId,
      context.repositoryUrl
    );

    const nodesInserted = await graphService.addNodes(context.scanId, context.entities || []);
    const edgesCreated = await graphService.createRelationships(context.scanId, context.relationships || []);
    const containmentEdges = await graphService.createContainmentEdges();

    return {
      status: "completed",
      stats: { nodes: nodesInserted, edges: edgesCreated + containmentEdges },
    };
  }

  private async stageNPlusOne(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    const candidates = await graphService.detectNPlusOne(context.scanId);

    context.nPlusOnes = candidates.map((c) => ({
      functionId: c.functionName,
      functionName: c.functionName,
      callCount: 0,
      codeSnippet: "",
      filePath: c.file,
      lineStart: c.lineStart,
    }));

    return {
      status: "completed",
      stats: { candidates: candidates.length },
    };
  }

  private async stageSemgrep(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    const findings = await semgrepRunner.runOnDirectory(context.cloneDir);
    context.semgrepFindings = findings;

    return {
      status: "completed",
      stats: { findings: findings.length, files: new Set(findings.map((f) => f.file_path)).size },
    };
  }

  private async stageSemanticLift(_context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    return {
      status: "completed",
      stats: { reason: "disabled - using raw findings" },
    };
  }

  private async stageLLMVerify(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    const allCandidates = [
      ...(context.nPlusOnes || []).map((n) => ({
        vuln_type: "n_plus_1",
        rule_id: "neo4j-n-plus-1-detection",
        code_snippet: n.codeSnippet || "",
        file_path: n.filePath || "",
        line_start: n.lineStart || 0,
      })),
      ...(context.semgrepFindings || []).map((f) => ({
        vuln_type: "semgrep",
        rule_id: f.rule_id,
        code_snippet: f.code_snippet || "",
        file_path: f.file_path,
        line_start: f.line_number,
      })),
    ];

    const totalCandidates = allCandidates.length;
    console.log(`[llm_verify] Starting verification of ${totalCandidates} candidates (batch size: ${BATCH_SIZE})`);

    let confirmed = 0;
    let rejected = 0;
    let errors = 0;
    let savedCount = 0;
    const recentlyVerified: Array<{ file_path: string; line_start: number; vuln_type: string; confirmed: boolean; confidence: string }> = [];

    const verifiedResults: Array<{ candidate: typeof allCandidates[number]; result: LLMVerificationResult }> = [];
    const confirmedVulns: VerifiedVuln[] = [];

    for (let batchStart = 0; batchStart < allCandidates.length; batchStart += BATCH_SIZE) {
      const batch = allCandidates.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalCandidates / BATCH_SIZE);

      console.log(`[llm_verify] Processing batch ${batchNum}/${totalBatches} (${batch.length} candidates)`);

      const batchPromises = batch.map(async (candidate) => {
        try {
          console.log(`[llm_verify] → Verifying: ${candidate.vuln_type} at ${candidate.file_path}:${candidate.line_start}`);
          console.log(`[llm_verify]   Code (${candidate.code_snippet.length} chars): ${candidate.code_snippet.slice(0, 150)}...`);
          const result = await ollamaClient.verifyFindingTwoTier(
            candidate.code_snippet,
            candidate.vuln_type,
            `File: ${candidate.file_path}:${candidate.line_start}`
          );
          console.log(`[llm_verify] ← Response: is_vuln=${result.is_vulnerability}, confidence=${result.confidence}`);
          return { candidate, result, error: null };
        } catch (error) {
          console.log(`[llm_verify] ← Error: ${error}`);
          return { candidate, result: null, error };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const { candidate, result, error } of batchResults) {
        if (error || !result) {
          errors++;
          verifiedResults.push({ candidate, result: { is_vulnerability: false, confidence: "low", reasoning: String(error), source: "ollama" as const } });
          continue;
        }

        verifiedResults.push({ candidate, result });

        const recentEntry = {
          file_path: candidate.file_path,
          line_start: candidate.line_start,
          vuln_type: candidate.vuln_type,
          confirmed: result.is_vulnerability,
          confidence: result.confidence,
        };
        recentlyVerified.push(recentEntry);
        if (recentlyVerified.length > 10) {
          recentlyVerified.shift();
        }

        if (result.is_vulnerability) {
          confirmed++;
          console.log(`[llm_verify] ✓ CONFIRMED: ${candidate.vuln_type} in ${candidate.file_path}:${candidate.line_start} (confidence: ${result.confidence})`);
          console.log(`[llm_verify]   Reasoning: ${result.reasoning}`);
          console.log(`[llm_verify]   Remediation: ${result.remediation || "N/A"}`);

          const vulnRecord = this.buildVulnerabilityRecord(context.scanId, context.projectId, candidate, result);
          await this.saveVulnerability(vulnRecord);
          savedCount++;

          confirmedVulns.push({
            vuln_type: candidate.vuln_type,
            rule_id: candidate.rule_id,
            code_snippet: candidate.code_snippet,
            file_path: candidate.file_path,
            line_start: candidate.line_start,
            severity: this.mapSeverity(candidate.vuln_type),
            confidence: result.confidence,
            reasoning: result.reasoning,
            remediation: result.remediation ?? "N/A",
            llm_source: result.source,
          });
        } else {
          rejected++;
          console.log(`[llm_verify] ✗ REJECTED: ${candidate.vuln_type} in ${candidate.file_path}:${candidate.line_start}`);
          console.log(`[llm_verify]   Reasoning: ${result.reasoning}`);
          console.log(`[llm_verify]   Code snippet (${candidate.code_snippet.length} chars): ${candidate.code_snippet.slice(0, 200)}...`);
        }

        const processedCount = confirmed + rejected + errors;
        if (processedCount % 5 === 0 || processedCount === totalCandidates) {
          const progressPct = (processedCount / totalCandidates) * 100;
          console.log(`[llm_verify] Progress: ${processedCount}/${totalCandidates} (${progressPct.toFixed(1)}%) - Confirmed: ${confirmed}, Rejected: ${rejected}, Errors: ${errors}`);

          await this.updateScanStatus(
            context.scanId,
            "running",
            70 + Math.floor((processedCount / totalCandidates) * 15),
            `LLM Verification (${processedCount}/${totalCandidates})`,
          );
        }
      }
    }

    console.log(`[llm_verify] Verification complete: ${confirmed} confirmed, ${rejected} rejected, ${errors} errors`);

    context.verifiedVulns = confirmedVulns;

    return {
      status: "completed",
      stats: { confirmed, rejected, errors, total: totalCandidates, saved_to_db: savedCount },
    };
  }

  private async stagePatternPropagate(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    const confirmedVulns = context.verifiedVulns || [];
    if (confirmedVulns.length === 0) {
      return { status: "completed", stats: { propagated: 0, reason: "no confirmed vulnerabilities" } };
    }

    let propagatedCount = 0;

    for (const vuln of confirmedVulns) {
      try {
        const similarFuncs = await this.propagatePattern(vuln);
        if (similarFuncs.length > 0) {
          propagatedCount += similarFuncs.length;
          console.log(`[pattern_propagate] Found ${similarFuncs.length} similar functions for ${vuln.vuln_type} in ${vuln.file_path}`);
        }
      } catch (error) {
        console.log(`[pattern_propagate] Skipped ${vuln.vuln_type}: ${error}`);
      }
    }

    return {
      status: "completed",
      stats: { propagated: propagatedCount },
    };
  }

  private async stageStorage(context: ScanContext): Promise<{ status: string; stats: Record<string, unknown> }> {
    await fs.rm(context.cloneDir, { recursive: true, force: true });

    return {
      status: "completed",
      stats: { cleaned_up: true },
    };
  }

  private async updateScanStatus(
    scanId: string,
    status: string,
    progressPercent: number,
    currentStage: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      await supabaseClient
        .from("scan_queue")
        .update({
          status,
          stage: currentStage,
          progress_percent: progressPercent,
          error_message: errorMessage,
          ...(status === "running" ? { started_at: new Date().toISOString() } : {}),
          ...(status === "completed" || status === "failed" ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq("id", scanId);
    } catch (error) {
      console.error("Failed to update scan status:", error);
    }
  }

  private async saveVulnerability(vuln: Record<string, unknown>): Promise<void> {
    try {
      await supabaseClient.from("vulnerabilities").insert(vuln);
    } catch (error) {
      console.error("Failed to save vulnerability:", error);
    }
  }

  private mapSeverity(vulnType: string): string {
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

  private buildVulnerabilityRecord(
    scanId: string,
    projectId: string,
    candidate: { vuln_type: string; rule_id: string; code_snippet: string; file_path: string; line_start: number },
    result: LLMVerificationResult
  ): Record<string, unknown> {
    const severity = this.mapSeverity(candidate.vuln_type);
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

  private async walkDirectory(dir: string, callback: (filePath: string) => Promise<void>): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__pycache__") {
          continue;
        }
        await this.walkDirectory(fullPath, callback);
      } else if (entry.isFile()) {
        const ext = entry.name.substring(entry.name.lastIndexOf("."));
        if ([".js", ".ts", ".jsx", ".tsx", ".py", ".pyi"].includes(ext)) {
          await callback(fullPath);
        }
      }
    }
  }

  private async embedCode(codeSnippet: string): Promise<number[]> {
    try {
      return await ollamaClient.embedCode(codeSnippet);
    } catch (error) {
      console.log(`[embed] Ollama embedding failed, trying OpenRouter: ${error}`);
      try {
        return await ollamaClient.embedWithOpenRouter(codeSnippet);
      } catch {
        return [];
      }
    }
  }

  private async propagatePattern(vuln: VerifiedVuln): Promise<Array<{ file_path: string; line_start: number; function_name: string; similarity_score: number }>> {
    if (!vuln.code_snippet) {
      return [];
    }

    try {
      const vector = await this.embedCode(vuln.code_snippet);
      if (vector.length === 0) {
        return [];
      }

      const results = await qdrantClient.search("function_summaries", {
        vector,
        limit: 20,
      });

      const similarFunctions: Array<{ file_path: string; line_start: number; function_name: string; similarity_score: number }> = [];
      for (const result of results) {
        if (
          result.payload["file"] === vuln.file_path &&
          result.payload["line_start"] === vuln.line_start
        ) {
          continue;
        }

        if (result.score >= 0.75) {
          similarFunctions.push({
            file_path: result.payload["file"] as string,
            line_start: result.payload["line_start"] as number,
            function_name: result.payload["name"] as string,
            similarity_score: result.score,
          });
        }
      }

      return similarFunctions;
    } catch (error) {
      console.log(`[propagate] Pattern propagation error: ${error}`);
      return [];
    }
  }

  private async generateDetailedReport(
    context: ScanContext,
    verifiedVulns: VerifiedVuln[]
  ): Promise<string> {
    const reportLines: string[] = [];
    const repoName = context.repositoryUrl.split("/").pop()?.replace(".git", "") || "unknown";

    reportLines.push(`# Scan Report: ${repoName}`);
    reportLines.push("");
    reportLines.push(`**Scan ID:** ${context.scanId}`);
    reportLines.push(`**Repository:** ${context.repositoryUrl}`);
    reportLines.push(`**Timestamp:** ${new Date().toISOString()}`);
    reportLines.push("");

    reportLines.push("## File Tree");
    reportLines.push("");
    reportLines.push("```");

    const fileTree = await this.buildFileTree(context.cloneDir);
    reportLines.push(fileTree);

    reportLines.push("```");
    reportLines.push("");

    const { totalFiles, totalDirs } = await this.countFilesAndDirs(context.cloneDir);
    reportLines.push("## Summary");
    reportLines.push("");
    reportLines.push(`- **Total files:** ${totalFiles}`);
    reportLines.push(`- **Total directories:** ${totalDirs}`);
    reportLines.push("");

    if (verifiedVulns.length > 0) {
      reportLines.push("## Vulnerabilities Found");
      reportLines.push("");
      reportLines.push(`**Total vulnerabilities:** ${verifiedVulns.length}`);
      reportLines.push("");

      const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const vuln of verifiedVulns) {
        const sev = vuln.severity.toLowerCase();
        if (sev in severityCounts) {
          severityCounts[sev as keyof typeof severityCounts]++;
        }
      }

      reportLines.push("### By Severity");
      reportLines.push("");
      reportLines.push(`- **Critical:** ${severityCounts.critical}`);
      reportLines.push(`- **High:** ${severityCounts.high}`);
      reportLines.push(`- **Medium:** ${severityCounts.medium}`);
      reportLines.push(`- **Low:** ${severityCounts.low}`);
      reportLines.push("");

      reportLines.push("### Details");
      reportLines.push("");

      for (let i = 0; i < verifiedVulns.length; i++) {
        const vuln = verifiedVulns[i];
        if (!vuln) continue;
        const vulnTypeClean = vuln.vuln_type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

        reportLines.push(`#### ${i + 1}. ${vulnTypeClean}`);
        reportLines.push("");
        reportLines.push(`- **File:** \`${vuln.file_path}\``);
        reportLines.push(`- **Line:** ${vuln.line_start}`);
        reportLines.push(`- **Severity:** ${vuln.severity}`);
        reportLines.push(`- **Confidence:** ${vuln.confidence}`);
        reportLines.push(`- **Description:** ${vuln.reasoning}`);
        if (vuln.remediation) {
          reportLines.push(`- **Remediation:** ${vuln.remediation}`);
        }
        reportLines.push("");
      }
    }

    reportLines.push("---");
    reportLines.push("*Generated by VibeCheck MVP*");

    return reportLines.join("\n");
  }

  private async buildFileTree(repoPath: string, maxDepth: number = 3): Promise<string> {
    const ignorePatterns = new Set([".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"]);
    const lines: string[] = [];

    const processDir = async (dir: string, prefix: string = "", depth: number = 0): Promise<void> => {
      if (depth > maxDepth) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });
      const sortedEntries = entries
        .filter((e) => !ignorePatterns.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        if (!entry) continue;
        const isLast = i === sortedEntries.length - 1;
        const connector = isLast ? "    " : "    ";
        const linePrefix = `${prefix}${connector}`;

        if (entry.isDirectory()) {
          lines.push(`${linePrefix}${entry.name}/`);
          await processDir(join(dir, entry.name), prefix + connector, depth + 1);
        } else {
          const fullPath = join(dir, entry.name);
          try {
            const stats = await fs.stat(fullPath);
            const sizeStr = this.formatFileSize(stats.size);
            lines.push(`${linePrefix}${entry.name} (${sizeStr})`);
          } catch {
            lines.push(`${linePrefix}${entry.name}`);
          }
        }
      }
    };

    await processDir(repoPath);
    return lines.join("\n");
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }

  private async countFilesAndDirs(repoPath: string): Promise<{ totalFiles: number; totalDirs: number }> {
    const ignorePatterns = new Set([".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"]);
    let totalFiles = 0;
    let totalDirs = 0;

    const processDir = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignorePatterns.has(entry.name)) continue;
        if (entry.isDirectory()) {
          totalDirs++;
          await processDir(join(dir, entry.name));
        } else if (entry.isFile()) {
          totalFiles++;
        }
      }
    };

    await processDir(repoPath);
    return { totalFiles, totalDirs };
  }
}
