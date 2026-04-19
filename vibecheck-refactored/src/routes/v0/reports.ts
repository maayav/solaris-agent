import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok, errorResponse } from "../../lib/response";
import { supabaseClient } from "../../db/clients/supabase-client";
import { severityEnum, scanStatusEnum } from "../../types";

const reportsRoute = new Hono();

const severityCountsSchema = z.object({
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
});

type SeverityCounts = z.infer<typeof severityCountsSchema>;

reportsRoute.get("/:scanId", async (c) => {
  const scanId = c.req.param("scanId");

  const { data: scan, error: scanError } = await supabaseClient
    .from("scan_queue")
    .select("*")
    .eq("id", scanId)
    .single();

  if (scanError || !scan) {
    return errorResponse(c, 404, "Scan not found");
  }

  const { data: vulnerabilities, error: vulnError } = await supabaseClient
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scanId);

  if (vulnError) {
    return errorResponse(c, 500, vulnError.message);
  }

  const severityCounts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let confirmedCount = 0;

  for (const vuln of vulnerabilities ?? []) {
    const sev = vuln.severity?.toLowerCase() as keyof SeverityCounts;
    if (sev && sev in severityCounts) {
      severityCounts[sev]++;
    } else {
      severityCounts.info++;
    }
    if (vuln.verified) {
      confirmedCount++;
    }
  }

  return ok(c, {
    scan_id: scanId,
    project_name: scan.project_id,
    repo_url: scan.repository_url,
    status: scan.status,
    total_vulnerabilities: (vulnerabilities ?? []).length,
    critical_count: severityCounts.critical,
    high_count: severityCounts.high,
    medium_count: severityCounts.medium,
    low_count: severityCounts.low,
    confirmed_count: confirmedCount,
    created_at: scan.created_at,
    completed_at: scan.completed_at,
    vulnerabilities: vulnerabilities ?? [],
  });
});

reportsRoute.get("/:scanId/vulnerabilities", async (c) => {
  const scanId = c.req.param("scanId");
  const severity = c.req.query("severity");
  const confirmedOnly = c.req.query("confirmed_only") === "true";
  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = Math.min(parseInt(c.req.query("page_size") || "20", 10), 100);

  let query = supabaseClient.from("vulnerabilities").select("*", { count: "exact" }).eq("scan_id", scanId);

  if (severity) {
    query = query.eq("severity", severity.toLowerCase());
  }

  if (confirmedOnly) {
    query = query.eq("verified", true);
  }

  const offset = (page - 1) * pageSize;
  query = query.range(offset, offset + pageSize - 1);

  const { data: vulnerabilities, error: vulnError, count } = await query;

  if (vulnError) {
    return errorResponse(c, 500, vulnError.message);
  }

  return ok(c, {
    vulnerabilities: vulnerabilities ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize,
  });
});

reportsRoute.get("/:scanId/vulnerabilities/:vulnId", async (c) => {
  const scanId = c.req.param("scanId");
  const vulnId = c.req.param("vulnId");

  const { data: vuln, error: vulnError } = await supabaseClient
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scanId)
    .eq("id", vulnId)
    .single();

  if (vulnError || !vuln) {
    return errorResponse(c, 404, "Vulnerability not found");
  }

  const { data: related, error: relatedError } = await supabaseClient
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scanId)
    .neq("id", vulnId)
    .or(`type.eq.${vuln.type},file_path.eq.${vuln.file_path}`)
    .limit(5);

  if (relatedError) {
    return errorResponse(c, 500, relatedError.message);
  }

  return ok(c, {
    vulnerability: vuln,
    related_vulnerabilities: related ?? [],
  });
});

reportsRoute.get("/:scanId/export", async (c) => {
  const scanId = c.req.param("scanId");
  const format = c.req.query("format") || "json";

  if (!["json", "csv", "sarif"].includes(format)) {
    return errorResponse(c, 400, `Unsupported export format: ${format}`);
  }

  return ok(c, {
    scan_id: scanId,
    format,
    download_url: `/reports/${scanId}/download.${format}`,
  });
});

reportsRoute.get("/:scanId/statistics", async (c) => {
  const scanId = c.req.param("scanId");

  const { data: vulnerabilities, error: vulnError } = await supabaseClient
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scanId);

  if (vulnError) {
    return errorResponse(c, 500, vulnError.message);
  }

  const bySeverity: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byType: Record<string, number> = {};
  let confirmedCount = 0;
  let falsePositiveCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const vuln of vulnerabilities ?? []) {
    const severity = vuln.severity?.toLowerCase() as keyof SeverityCounts;
    if (severity && severity in bySeverity) {
      bySeverity[severity]++;
    } else {
      bySeverity.info++;
    }

    const vulnType = vuln.type || "unknown";
    byType[vulnType] = (byType[vulnType] || 0) + 1;

    if (vuln.verified) confirmedCount++;
    if ((vuln as Record<string, unknown>).false_positive) falsePositiveCount++;
    if (typeof (vuln as Record<string, unknown>).confidence_score === "number") {
      confidenceSum += (vuln as Record<string, unknown>).confidence_score as number;
      confidenceCount++;
    }
  }

  const averageConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;

  return ok(c, {
    scan_id: scanId,
    total_vulnerabilities: (vulnerabilities ?? []).length,
    by_severity: bySeverity,
    by_type: byType,
    confirmed_count: confirmedCount,
    false_positive_count: falsePositiveCount,
    average_confidence: averageConfidence,
  });
});

export { reportsRoute };