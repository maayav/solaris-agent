import { z } from "zod";

export const scanStatusEnum = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const severityEnum = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const scanStageEnum = z.enum([
  "clone_repository",
  "tree_sitter_parse",
  "build_knowledge_graph",
  "n_plus_one_query_detect",
  "semgrep_static_analysis",
  "semantic_lifting",
  "llm_verification",
  "pattern_propagation",
  "supabase_storage",
]);

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  repository_url: z.string().url(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Project = z.infer<typeof projectSchema>;

export const scanQueueSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  status: scanStatusEnum,
  stage: scanStageEnum.optional(),
  error_message: z.string().optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type ScanQueue = z.infer<typeof scanQueueSchema>;

export const vulnerabilitySchema = z.object({
  id: z.string().uuid(),
  scan_id: z.string().uuid(),
  project_id: z.string().uuid(),
  severity: severityEnum,
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  file_path: z.string().optional(),
  line_number: z.number().int().positive().optional(),
  code_snippet: z.string().optional(),
  cwe_id: z.string().optional(),
  remediation: z.string().optional(),
  verified: z.boolean().default(false),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Vulnerability = z.infer<typeof vulnerabilitySchema>;

export const swarmMissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  target: z.string().min(1),
  status: z.enum(["active", "completed", "cancelled", "failed"]),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type SwarmMission = z.infer<typeof swarmMissionSchema>;

export const swarmFindingSchema = z.object({
  id: z.string().uuid(),
  mission_id: z.string().uuid(),
  finding_type: z.string(),
  severity: severityEnum,
  title: z.string(),
  description: z.string().optional(),
  created_at: z.string().datetime().optional(),
});

export type SwarmFinding = z.infer<typeof swarmFindingSchema>;

export const createProjectSchema = projectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const createScanQueueSchema = scanQueueSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateScanQueueInput = z.infer<typeof createScanQueueSchema>;

export const createVulnerabilitySchema = vulnerabilitySchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateVulnerabilityInput = z.infer<typeof createVulnerabilitySchema>;

export const updateScanQueueSchema = scanQueueSchema
  .omit({
    id: true,
    project_id: true,
    created_at: true,
    updated_at: true,
  })
  .partial();

export type UpdateScanQueueInput = z.infer<typeof updateScanQueueSchema>;

export const updateVulnerabilitySchema = vulnerabilitySchema
  .omit({
    id: true,
    scan_id: true,
    project_id: true,
    created_at: true,
    updated_at: true,
  })
  .partial();

export type UpdateVulnerabilityInput = z.infer<typeof updateVulnerabilitySchema>;

export const swarmTriggerRequestSchema = z.object({
  target: z.string().min(1),
  objective: z.string().default("Execute a comprehensive security audit"),
  mode: z.enum(["live", "static", "repo"]).default("live"),
  max_iterations: z.number().int().positive().default(5),
  scan_id: z.string().uuid().optional(),
  repo_url: z.string().url().optional(),
  auto_deploy: z.boolean().default(false),
});

export type SwarmTriggerRequest = z.infer<typeof swarmTriggerRequestSchema>;

export const swarmTriggerResponseSchema = z.object({
  mission_id: z.string().uuid(),
  message: z.string(),
  status: z.string(),
  target: z.string().nullable(),
});

export type SwarmTriggerResponse = z.infer<typeof swarmTriggerResponseSchema>;

export const agentStateSchema = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  agent_team: z.string(),
  status: z.string(),
  iter: z.string().nullable(),
  task: z.string().nullable(),
  recent_logs: z.array(z.record(z.unknown())),
  last_updated: z.string().datetime(),
});

export type AgentState = z.infer<typeof agentStateSchema>;

export const swarmMissionSchemaFull = z.object({
  id: z.string().uuid(),
  scan_id: z.string().uuid().nullable(),
  target: z.string(),
  objective: z.string().default(""),
  mode: z.string().nullable(),
  status: z.string(),
  progress: z.number().int().nonnegative().default(0),
  current_phase: z.string().nullable(),
  iteration: z.number().int().nonnegative().default(0),
  max_iterations: z.number().int().positive().default(5),
  findings_count: z.number().int().nonnegative().default(0),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
});

export type SwarmMissionFull = z.infer<typeof swarmMissionSchemaFull>;

export const swarmEventSchema = z.object({
  id: z.string().uuid(),
  agent_name: z.string(),
  agent_team: z.string(),
  event_type: z.string(),
  message: z.string(),
  payload: z.record(z.unknown()),
  iteration: z.number().int().nullable(),
  phase: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type SwarmEvent = z.infer<typeof swarmEventSchema>;

export const swarmFindingSchemaFull = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  severity: severityEnum,
  finding_type: z.string().nullable(),
  source: z.string().nullable(),
  target: z.string().nullable(),
  endpoint: z.string().nullable(),
  confirmed: z.boolean(),
  agent_name: z.string().nullable(),
  cve_id: z.string().nullable(),
  created_at: z.string().datetime(),
  exploit_attempt_id: z.string().uuid().nullable(),
  agent_iteration: z.number().int().nullable(),
  confidence_score: z.number().nullable(),
});

export type SwarmFindingFull = z.infer<typeof swarmFindingSchemaFull>;

export const swarmEventTimelineSchema = z.object({
  id: z.string().uuid(),
  mission_id: z.string().uuid(),
  event_type: z.string(),
  agent_name: z.string(),
  stage: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  success: z.boolean().nullable(),
  error_type: z.string().nullable(),
  created_at: z.string().datetime(),
  iteration: z.number().int().nullable(),
  execution_time_ms: z.number().int().nullable(),
  child_events: z.number().int().nullable(),
  exploit_type: z.string().nullable(),
  target_url: z.string().nullable(),
  was_deduplicated: z.boolean().nullable(),
  attempt_number: z.number().int().nullable(),
});

export type SwarmEventTimeline = z.infer<typeof swarmEventTimelineSchema>;

export const missionStatisticsSchema = z.object({
  mission_id: z.string().uuid(),
  target: z.string().nullable(),
  status: z.string().nullable(),
  created_at: z.string().datetime().nullable(),
  total_events: z.number().int().nullable(),
  exploit_events: z.number().int().nullable(),
  agent_starts: z.number().int().nullable(),
  total_exploit_attempts: z.number().int().nullable(),
  successful_exploits: z.number().int().nullable(),
  failed_exploits: z.number().int().nullable(),
  deduplicated_exploits: z.number().int().nullable(),
  deduplication_rate_pct: z.number().nullable(),
  total_findings: z.number().int().nullable(),
  critical_findings: z.number().int().nullable(),
  high_findings: z.number().int().nullable(),
  max_iteration: z.number().int().nullable(),
});

export type MissionStatistics = z.infer<typeof missionStatisticsSchema>;

export const swarmExploitAttemptSchema = z.object({
  id: z.string().uuid(),
  mission_id: z.string().uuid(),
  event_id: z.string().uuid().nullable(),
  exploit_type: z.string(),
  target_url: z.string(),
  method: z.string(),
  payload: z.string().nullable(),
  payload_hash: z.string().nullable(),
  tool_used: z.string().nullable(),
  command_executed: z.string().nullable(),
  success: z.boolean(),
  response_code: z.number().int().nullable(),
  exit_code: z.number().int().nullable(),
  error_type: z.string().nullable(),
  error_message: z.string().nullable(),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  evidence: z.record(z.unknown()),
  created_at: z.string().datetime(),
  execution_time_ms: z.number().int().nullable(),
  was_deduplicated: z.boolean(),
  deduplication_key: z.string().nullable(),
  attempt_number: z.number().int().nullable(),
  critic_evaluated: z.boolean().nullable(),
  critic_success: z.boolean().nullable(),
  critic_feedback: z.string().nullable(),
});

export type SwarmExploitAttempt = z.infer<typeof swarmExploitAttemptSchema>;