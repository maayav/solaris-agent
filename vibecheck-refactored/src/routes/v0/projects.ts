import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok, created, errorResponse } from "../../lib/response";
import { projectSchema, type Project, type CreateProjectInput } from "../../types";
import { supabaseClient } from "../../db/clients/supabase-client";

const projectsRoute = new Hono();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  repository_url: z.string().url(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

projectsRoute.post("/", zValidator("json", createProjectSchema), async (c) => {
  const body = c.req.valid("json");

  const { data: project, error } = await supabaseClient
    .from("projects")
    .insert({
      name: body.name,
      repository_url: body.repository_url,
      description: body.description,
      metadata: body.metadata,
    })
    .select()
    .single();

  if (error) {
    return errorResponse(c, 400, error.message);
  }

  return created(c, project!);
});

projectsRoute.get("/", async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = (page - 1) * limit;

  const { data: projects, error, count } = await supabaseClient
    .from("projects")
    .select("*", { count: "exact" })
    .range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(c, 500, error.message);
  }

  return ok(c, {
    data: projects,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  });
});

projectsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const { data: project, error } = await supabaseClient
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) {
    return errorResponse(c, 404, "Project not found");
  }

  return ok(c, project);
});

projectsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const { error } = await supabaseClient.from("projects").delete().eq("id", id);

  if (error) {
    return errorResponse(c, 500, error.message);
  }

  return c.json({ success: true });
});

export { projectsRoute };
