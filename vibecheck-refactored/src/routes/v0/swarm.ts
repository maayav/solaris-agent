import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ok, created, errorResponse } from "../../lib/response";
import { supabaseClient } from "../../db/clients/supabase-client";
import { redisClient } from "../../db/clients/redis-client";
import { wsConnectionManager } from "../../lib/ws-manager";
import {
  swarmTriggerRequestSchema,
  swarmMissionSchemaFull,
  swarmEventSchema,
  swarmFindingSchemaFull,
  swarmEventTimelineSchema,
  missionStatisticsSchema,
  swarmExploitAttemptSchema,
  agentStateSchema,
  type SwarmTriggerRequest,
  type SwarmMissionFull,
  type SwarmFindingFull,
  type SwarmEventTimeline,
  type MissionStatistics,
  type SwarmExploitAttempt,
  type AgentState,
} from "../../types";

const swarmRoute = new Hono();

const AGENT_TEAMS: Array<{ name: string; team: string }> = [
  { name: "purple-cmd", team: "command" },
  { name: "kg-agent", team: "knowledge" },
  { name: "sast-agent", team: "analysis" },
  { name: "llm-verify", team: "verification" },
  { name: "traffic-mon", team: "monitoring" },
  { name: "sig-detect", team: "detection" },
  { name: "redis-pub", team: "communication" },
  { name: "red-cmd", team: "command" },
  { name: "alpha-recon", team: "reconnaissance" },
  { name: "gamma-exploit", team: "exploitation" },
  { name: "critic", team: "evaluation" },
  { name: "sandbox", team: "sandbox" },
];

async function initializeAgentStates(missionId: string): Promise<void> {
  for (const agent of AGENT_TEAMS) {
    await supabaseClient.createSwarmAgentState(
      missionId,
      crypto.randomUUID(),
      agent.name,
      agent.team,
      "idle",
      "0",
      ""
    );
  }
}

swarmRoute.get("/missions", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const missions = await supabaseClient.listSwarmMissions(limit, offset);

  return ok(c, {
    missions,
    total: missions.length,
  });
});

swarmRoute.post("/trigger", zValidator("json", swarmTriggerRequestSchema), async (c) => {
  const input = c.req.valid("json") as SwarmTriggerRequest;
  const missionId = crypto.randomUUID();

  let deployedTarget = input.target;

  const dbMode = input.mode === "repo" ? "static" : input.mode;

  await supabaseClient.createSwarmMission(
    missionId,
    deployedTarget,
    input.objective,
    dbMode,
    input.max_iterations,
    input.scan_id
  );

  await initializeAgentStates(missionId);

  const missionData: Record<string, unknown> = {
    mission_id: missionId,
    target: deployedTarget,
    objective: input.objective,
    mode: input.mode,
    max_iterations: input.max_iterations,
    action: "start",
  };

  if (input.mode === "repo" && input.repo_url) {
    missionData.repo_url = input.repo_url;
    missionData.auto_deploy = input.auto_deploy;
  }

  await redisClient.publish("swarm_missions", missionData);

  wsConnectionManager.broadcastToMission(missionId, {
    type: "mission_started",
    mission_id: missionId,
    target: deployedTarget,
    objective: input.objective,
    mode: input.mode,
  });

  return created(c, {
    mission_id: missionId,
    message: "Swarm mission triggered successfully",
    status: "pending",
    target: deployedTarget,
  });
});

swarmRoute.get("/:missionId", async (c) => {
  const missionId = c.req.param("missionId");

  const mission = await supabaseClient.getSwarmMission(missionId);
  if (!mission) {
    return errorResponse(c, 404, `Mission ${missionId} not found`);
  }

  const findings = await supabaseClient.getSwarmFindings(missionId);

  return ok(c, {
    mission_id: mission.id,
    scan_id: mission.scan_id,
    target: mission.target,
    objective: mission.objective,
    mode: mission.mode,
    status: mission.status,
    progress: mission.progress,
    current_phase: mission.current_phase,
    iteration: mission.iteration,
    max_iterations: mission.max_iterations,
    findings_count: findings.length,
    created_at: mission.created_at,
    started_at: mission.started_at,
    completed_at: mission.completed_at,
  });
});

swarmRoute.get("/:missionId/agents", async (c) => {
  const missionId = c.req.param("missionId");

  const states = await supabaseClient.getSwarmAgentStates(missionId);

  return ok(c, states);
});

swarmRoute.get("/:missionId/events", async (c) => {
  const missionId = c.req.param("missionId");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
  const agent = c.req.query("agent") || undefined;

  const events = await supabaseClient.getSwarmAgentEvents(missionId, limit, agent);

  return ok(c, events);
});

swarmRoute.get("/:missionId/timeline-events", async (c) => {
  const missionId = c.req.param("missionId");
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 500);
  const eventType = c.req.query("event_type") || undefined;
  const agent = c.req.query("agent") || undefined;
  const iteration = c.req.query("iteration");
  const iterationNum = iteration ? parseInt(iteration, 10) : undefined;

  const events = await supabaseClient.getSwarmEvents(missionId, limit, eventType, agent, iterationNum);

  return ok(c, events);
});

swarmRoute.get("/:missionId/findings", async (c) => {
  const missionId = c.req.param("missionId");

  const findings = await supabaseClient.getSwarmFindings(missionId);

  return ok(c, findings);
});

swarmRoute.get("/:missionId/timeline", async (c) => {
  const missionId = c.req.param("missionId");

  const timeline = await supabaseClient.getMissionTimeline(missionId);

  return ok(c, timeline);
});

swarmRoute.get("/:missionId/statistics", async (c) => {
  const missionId = c.req.param("missionId");

  const stats = await supabaseClient.getMissionStatistics(missionId);
  if (!stats) {
    return errorResponse(c, 404, `Statistics not found for mission ${missionId}`);
  }

  return ok(c, stats);
});

swarmRoute.get("/:missionId/exploit-attempts", async (c) => {
  const missionId = c.req.param("missionId");
  const limit = Math.min(parseInt(c.req.query("limit") || "500", 10), 1000);
  const exploitType = c.req.query("exploit_type") || undefined;
  const successParam = c.req.query("success");
  const success = successParam ? successParam === "true" : undefined;

  const attempts = await supabaseClient.getSwarmExploitAttempts(missionId, limit, exploitType, success);

  return ok(c, attempts);
});

swarmRoute.post("/:missionId/cancel", async (c) => {
  const missionId = c.req.param("missionId");

  const mission = await supabaseClient.getSwarmMission(missionId);
  if (!mission) {
    return errorResponse(c, 404, `Mission ${missionId} not found`);
  }

  const now = new Date().toISOString();
  await supabaseClient.updateSwarmMission(missionId, {
    status: "cancelled",
    completed_at: now,
  });

  await redisClient.publish("swarm_missions", {
    mission_id: missionId,
    action: "cancel",
  });

  wsConnectionManager.broadcastToMission(missionId, {
    type: "mission_cancelled",
    mission_id: missionId,
  });

  return ok(c, { message: "Mission cancelled", mission_id: missionId });
});

swarmRoute.post("/:missionId/cleanup", async (c) => {
  const missionId = c.req.param("missionId");
  void missionId;

  return ok(c, {
    message: "Cleanup endpoint - Docker cleanup requires Docker CLI which is not available in this environment",
    mission_id: missionId,
  });
});

export { swarmRoute };
