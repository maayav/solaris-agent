import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok, created, errorResponse } from "../../lib/response";
import { scanTriggerSchema, type ScanTriggerInput } from "../../types";
import { supabaseClient } from "../../db/clients/supabase-client";
import { redisClient } from "../../db/clients/redis-client";

const scansRoute = new Hono();

const githubWebhookPayloadSchema = z.object({
  ref: z.string(),
  repository: z.object({
    clone_url: z.string(),
  }),
  pusher: z.record(z.string(), z.unknown()).nullable().optional(),
  commits: z.array(z.record(z.string(), z.unknown())).optional(),
});

scansRoute.post("/trigger", zValidator("json", scanTriggerSchema), async (c) => {
  const input = c.req.valid("json") as ScanTriggerInput;

  const scanId = crypto.randomUUID();

  try {
    await supabaseClient.createScan(scanId, input.repo_url, input.triggered_by);

    const jobData: {
      repo_url: string;
      triggered_by?: string;
      scan_id: string;
    } = {
      repo_url: input.repo_url,
      scan_id: scanId,
    };
    if (input.triggered_by) {
      jobData.triggered_by = input.triggered_by;
    }
    await redisClient.publishScanJob(jobData);

    const queueLength = await redisClient.getStreamLength("scan_queue");

    return created(c, {
      scan_id: scanId,
      message: "Scan job queued successfully",
      queue_position: queueLength,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to queue scan job";
    return errorResponse(c, 500, message);
  }
});

scansRoute.post("/webhook/github", zValidator("json", githubWebhookPayloadSchema), async (c) => {
  const payload = c.req.valid("json");

  const repoUrl = payload.repository.clone_url;
  if (!repoUrl) {
    return errorResponse(c, 400, "Repository URL not found in payload");
  }

  const scanId = crypto.randomUUID();

  try {
    await supabaseClient.createScan(scanId, repoUrl, "github_webhook");

    await redisClient.publishScanJob({
      repo_url: repoUrl,
      triggered_by: "github_webhook",
      scan_id: scanId,
    });

    return created(c, {
      status: "queued",
      repo_url: repoUrl,
      branch: payload.ref,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to process webhook";
    return errorResponse(c, 500, message);
  }
});

scansRoute.get("/", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const status = c.req.query("status") || undefined;

  try {
    const result = await supabaseClient.listScans(status, limit, offset);

    const scans = result.scans.map((scan) => ({
      scan_id: scan.id,
      status: (scan as Record<string, unknown>).status as string,
      progress: (scan as Record<string, unknown>).progress as number,
      current_stage: (scan as Record<string, unknown>).current_stage as string | null,
      stage_output: (scan as Record<string, unknown>).stage_output as Record<string, unknown> | null,
      error_message: (scan as Record<string, unknown>).error_message as string | null,
      started_at: (scan as Record<string, unknown>).started_at as string | null,
      completed_at: (scan as Record<string, unknown>).completed_at as string | null,
      created_at: (scan as Record<string, unknown>).created_at as string,
      data_source: "supabase" as const,
    }));

    return ok(c, {
      scans,
      total: result.total,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list scans";
    return errorResponse(c, 500, message);
  }
});

scansRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const scan = await supabaseClient.getScanStatus(id);

  if (!scan) {
    return errorResponse(c, 404, "Scan not found");
  }

  return ok(c, {
    scan_id: (scan as Record<string, unknown>).id,
    status: (scan as Record<string, unknown>).status,
    progress: (scan as Record<string, unknown>).progress,
    current_stage: (scan as Record<string, unknown>).current_stage,
    stage_output: (scan as Record<string, unknown>).stage_output,
    error_message: (scan as Record<string, unknown>).error_message,
    started_at: (scan as Record<string, unknown>).started_at,
    completed_at: (scan as Record<string, unknown>).completed_at,
    created_at: (scan as Record<string, unknown>).created_at,
    data_source: "supabase",
  });
});

scansRoute.get("/:id/status", async (c) => {
  const scanId = c.req.param("id");

  const scan = await supabaseClient.getScanStatus(scanId);

  if (!scan) {
    return errorResponse(c, 404, `Scan not found: ${scanId}`);
  }

  return ok(c, {
    scan_id: (scan as Record<string, unknown>).id,
    status: (scan as Record<string, unknown>).status,
    progress: (scan as Record<string, unknown>).progress,
    current_stage: (scan as Record<string, unknown>).current_stage,
    stage_output: (scan as Record<string, unknown>).stage_output,
    error_message: (scan as Record<string, unknown>).error_message,
    started_at: (scan as Record<string, unknown>).started_at,
    completed_at: (scan as Record<string, unknown>).completed_at,
    created_at: (scan as Record<string, unknown>).created_at,
    data_source: "supabase",
  });
});

scansRoute.get("/:id/results", async (c) => {
  const scanId = c.req.param("id");

  const report = await supabaseClient.getReport(scanId);

  if (!report) {
    return errorResponse(c, 404, `Scan report not found: ${scanId}`);
  }

  const scan = report.scan as Record<string, unknown>;
  const vulnerabilities = report.vulnerabilities as Array<Record<string, unknown>>;

  const confirmedVulns = vulnerabilities.filter((v) => v.confirmed);
  const criticalCount = confirmedVulns.filter((v) => v.severity === "critical").length;
  const highCount = confirmedVulns.filter((v) => v.severity === "high").length;
  const mediumCount = confirmedVulns.filter((v) => v.severity === "medium").length;
  const lowCount = confirmedVulns.filter((v) => v.severity === "low").length;

  const summary = {
    total: vulnerabilities.length,
    confirmed: confirmedVulns.length,
    critical: criticalCount,
    high: highCount,
    medium: mediumCount,
    low: lowCount,
  };

  return ok(c, {
    scan_id: scanId,
    repo_url: scan.repo_url,
    status: scan.status,
    summary,
    findings: vulnerabilities,
    report_path: scan.report_path || null,
    created_at: scan.created_at || null,
    completed_at: scan.completed_at || null,
  });
});

scansRoute.post("/:id/cancel", async (c) => {
  const scanId = c.req.param("id");

  const scan = await supabaseClient.getScanStatus(scanId);

  if (!scan) {
    return errorResponse(c, 404, "Scan not found");
  }

  const currentStatus = (scan as Record<string, unknown>).status as string;

  if (currentStatus !== "pending" && currentStatus !== "running") {
    return errorResponse(c, 400, `Cannot cancel scan with status: ${currentStatus}`);
  }

  const success = await supabaseClient.updateScanStatus(
    scanId,
    "cancelled",
    (scan as Record<string, unknown>).progress as number,
    "Scan cancelled by user request"
  );

  if (!success) {
    return errorResponse(c, 500, "Failed to cancel scan");
  }

  await redisClient.publish("scan_cancellations", {
    scan_id: scanId,
    timestamp: new Date().toISOString(),
  });

  return ok(c, {
    scan_id: scanId,
    message: "Scan cancelled successfully",
    previous_status: currentStatus,
  });
});

export { scansRoute };
