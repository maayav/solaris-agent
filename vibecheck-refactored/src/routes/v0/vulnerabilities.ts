import { Hono } from "hono";
import { ok, errorResponse } from "../../lib/response";
import { supabaseClient } from "../../db/clients/supabase-client";

const vulnerabilitiesRoute = new Hono();

vulnerabilitiesRoute.get("/", async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = (page - 1) * limit;
  const severity = c.req.query("severity");
  const scanId = c.req.query("scan_id");
  const projectId = c.req.query("project_id");
  const isVerified = c.req.query("verified");
  const falsePositive = c.req.query("false_positive");

  let query = supabaseClient
    .from("vulnerabilities")
    .select("*", { count: "exact" })
    .range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  if (severity) {
    query = query.eq("severity", severity);
  }
  if (scanId) {
    query = query.eq("scan_id", scanId);
  }
  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  if (isVerified !== undefined) {
    query = query.eq("is_verified", isVerified === "true");
  }
  if (falsePositive !== undefined) {
    query = query.eq("false_positive", falsePositive === "true");
  }

  const { data: vulnerabilities, error, count } = await query;

  if (error) {
    return errorResponse(c, 500, error.message);
  }

  return ok(c, {
    data: vulnerabilities,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  });
});

vulnerabilitiesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const { data: vulnerability, error } = await supabaseClient
    .from("vulnerabilities")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !vulnerability) {
    return errorResponse(c, 404, "Vulnerability not found");
  }

  return ok(c, vulnerability);
});

vulnerabilitiesRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const allowedFields = ["severity", "status", "is_verified", "false_positive", "notes", "remediation"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse(c, 400, "No valid fields to update");
  }

  const { data: vulnerability, error } = await supabaseClient
    .from("vulnerabilities")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return errorResponse(c, 500, error.message);
  }

  return ok(c, vulnerability);
});

vulnerabilitiesRoute.get("/stats/summary", async (c) => {
  const projectId = c.req.query("project_id");

  let query = supabaseClient
    .from("vulnerabilities")
    .select("severity, is_verified, false_positive, status");

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: vulnerabilities, error } = await query;

  if (error) {
    return errorResponse(c, 500, error.message);
  }

  const stats = {
    total: vulnerabilities?.length ?? 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    verified: 0,
    false_positive: 0,
    by_status: {
      open: 0,
      in_progress: 0,
      resolved: 0,
      dismissed: 0,
    } as Record<string, number>,
  };

  for (const v of vulnerabilities ?? []) {
    switch (v.severity) {
      case "critical":
        stats.critical++;
        break;
      case "high":
        stats.high++;
        break;
      case "medium":
        stats.medium++;
        break;
      case "low":
        stats.low++;
        break;
    }
    if (v.is_verified) stats.verified++;
    if (v.false_positive) stats.false_positive++;
    if (v.status) {
      const currentCount = stats.by_status[v.status];
      if (currentCount !== undefined) {
        stats.by_status[v.status] = currentCount + 1;
      }
    }
  }

  return ok(c, stats);
});

export { vulnerabilitiesRoute };
