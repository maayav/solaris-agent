import { z } from "zod";
import {
  projectSchema,
  scanQueueSchema,
  vulnerabilitySchema,
  scanStatusEnum,
  severityEnum,
  scanStageEnum,
  swarmMissionSchema,
  swarmFindingSchema,
  swarmMissionSchemaFull,
  swarmFindingSchemaFull,
  swarmTriggerRequestSchema,
  swarmTriggerResponseSchema,
  agentStateSchema,
  swarmEventSchema,
  swarmEventTimelineSchema,
  missionStatisticsSchema,
  swarmExploitAttemptSchema,
  type Project,
  type ScanQueue,
  type Vulnerability,
  type SwarmMission,
  type SwarmFinding,
  type SwarmMissionFull,
  type SwarmFindingFull,
  type SwarmTriggerRequest,
  type SwarmTriggerResponse,
  type AgentState,
  type SwarmEvent,
  type SwarmEventTimeline,
  type MissionStatistics,
  type SwarmExploitAttempt,
  type CreateProjectInput,
  type CreateScanQueueInput,
  type CreateVulnerabilityInput,
  type UpdateScanQueueInput,
  type UpdateVulnerabilityInput,
} from "../db/schema";

export {
  projectSchema,
  scanQueueSchema,
  vulnerabilitySchema,
  scanStatusEnum,
  severityEnum,
  scanStageEnum,
  swarmMissionSchema,
  swarmFindingSchema,
  swarmMissionSchemaFull,
  swarmFindingSchemaFull,
  swarmTriggerRequestSchema,
  swarmTriggerResponseSchema,
  agentStateSchema,
  swarmEventSchema,
  swarmEventTimelineSchema,
  missionStatisticsSchema,
  swarmExploitAttemptSchema,
  type Project,
  type ScanQueue,
  type Vulnerability,
  type SwarmMission,
  type SwarmFinding,
  type SwarmMissionFull,
  type SwarmFindingFull,
  type SwarmTriggerRequest,
  type SwarmTriggerResponse,
  type AgentState,
  type SwarmEvent,
  type SwarmEventTimeline,
  type MissionStatistics,
  type SwarmExploitAttempt,
  type CreateProjectInput,
  type CreateScanQueueInput,
  type CreateVulnerabilityInput,
  type UpdateScanQueueInput,
  type UpdateVulnerabilityInput,
};

export const scanTriggerSchema = z.object({
  repo_url: z.string().url(),
  project_name: z.string().optional(),
  triggered_by: z.string().default("manual"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});

export type ScanTriggerInput = z.infer<typeof scanTriggerSchema>;

export const codeEntitySchema = z.object({
  id: z.string(),
  type: z.enum(["function", "class", "endpoint", "import", "sql_query", "loop", "variable"]),
  name: z.string(),
  file_path: z.string(),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  code_snippet: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CodeEntity = z.infer<typeof codeEntitySchema>;

export const codeRelationshipSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  relationship_type: z.enum([
    "calls",
    "contains",
    "imports",
    "references",
    "returns",
    "raises",
    "assigns",
  ]),
});

export type CodeRelationship = z.infer<typeof codeRelationshipSchema>;

export const semgrepFindingSchema = z.object({
  rule_id: z.string(),
  severity: severityEnum,
  title: z.string(),
  description: z.string().optional(),
  file_path: z.string(),
  line_number: z.number().int().positive(),
  code_snippet: z.string().optional(),
  cwe_id: z.string().optional(),
  owasp_category: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type SemgrepFinding = z.infer<typeof semgrepFindingSchema>;

export const llmVerificationResultSchema = z.object({
  finding_id: z.string(),
  verified: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
  false_positive: z.boolean().default(false),
  suggested_remediation: z.string().optional(),
});

export type LLMVerificationResult = z.infer<typeof llmVerificationResultSchema>;

export const scanReportSchema = z.object({
  scan_id: z.string().uuid(),
  project_id: z.string().uuid(),
  status: scanStatusEnum,
  stage: scanStageEnum,
  progress_percent: z.number().min(0).max(100),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  findings: z.object({
    semgrep: z.array(semgrepFindingSchema),
    n_plus_one: z.array(vulnerabilitySchema),
    llm_verified: z.array(llmVerificationResultSchema),
  }),
  summary: z.object({
    total_findings: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    verified_false_positive: z.number().int().nonnegative(),
  }),
});

export type ScanReport = z.infer<typeof scanReportSchema>;

export const defenseAnalyticsEventSchema = z.object({
  event_type: z.enum([
    "scan_started",
    "scan_completed",
    "finding_detected",
    "finding_verified",
    "finding_dismissed",
  ]),
  scan_id: z.string().uuid(),
  project_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export type DefenseAnalyticsEvent = z.infer<typeof defenseAnalyticsEventSchema>;
