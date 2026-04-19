import { z } from 'zod';

// ===========================================
// CORE NODE SCHEMAS
// ===========================================

export const TargetNodeSchema = z.object({
  id: z.string(),
  type: z.literal('target'),
  name: z.string(),
  base_url: z.string().url(),
  repo_path: z.string().optional(),
  tech_stack: z.array(z.string()),
  scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  status: z.enum(['active', 'complete', 'paused']),
  created_at: z.number(),
  engagement_id: z.string(),
});

export const EndpointParamSchema = z.object({
  name: z.string(),
  location: z.enum(['query', 'body', 'header', 'path']),
  type: z.enum(['string', 'number', 'boolean', 'array']),
});

export const EndpointNodeSchema = z.object({
  id: z.string(),
  type: z.literal('endpoint'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']),
  path: z.string(),
  url: z.string(),
  parameters: z.array(EndpointParamSchema).optional(),
  headers: z.record(z.string()).optional(),
  auth_required: z.boolean(),
  discovered_by: z.string(),
  created_at: z.number(),
});

export const ComponentNodeSchema = z.object({
  id: z.string(),
  type: z.literal('component'),
  name: z.string(),
  version: z.string().optional(),
  fingerprint: z.string().optional(),
  discovered_at: z.number(),
});

export const VulnerabilityNodeSchema = z.object({
  id: z.string(),
  type: z.literal('vulnerability'),
  vuln_class: z.string(),
  cve: z.string().optional(),
  cvss_score: z.number().min(0).max(10).optional(),
  cvss_vector: z.string().optional(),
  cisa_kev: z.boolean().default(false),
  exploitdb_poc: z.boolean().default(false),
  description: z.string().optional(),
  affected_components: z.array(z.string()).optional(),
  created_at: z.number(),
});

export const UserNodeSchema = z.object({
  id: z.string(),
  type: z.literal('user'),
  email: z.string(),
  role: z.string().optional(),
  privileges: z.array(z.string()).optional(),
  discovered_at: z.number(),
  discovered_by: z.string(),
});

export const CredentialNodeSchema = z.object({
  id: z.string(),
  type: z.literal('credential'),
  cred_type: z.enum(['bearer', 'cookie', 'api_key', 'basic_auth', 'jwt', 'session', 'password']),
  value: z.string(),
  handle: z.string().optional(),
  scope: z.array(z.string()),
  validation_status: z.enum(['pending', 'confirmed', 'expired', 'probe_error']),
  validated_by: z.string().optional(),
  validated_at: z.number().optional(),
  created_at: z.number(),
  created_by: z.string(),
  expires_at: z.number().optional(),
});

export const MissionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('mission'),
  executor: z.enum(['gamma', 'mcp']),
  exploit_type: z.string(),
  escalation_level: z.enum(['baseline', 'aggressive', 'evasive']),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  target_endpoint: z.string(),
  context_nodes: z.array(z.string()),
  credential_nodes: z.array(z.string()),
  chain_id: z.string().optional(),
  depends_on: z.array(z.string()),
  status: z.enum(['pending_verification', 'queued', 'active', 'completed', 'failed', 'archived']),
  authorized: z.boolean(),
  verified: z.boolean(),
  attempt_count: z.number(),
  created_by: z.enum(['mission_planner', 'chain_planner', 'post_exploit']),
  skip_liveness_probe: z.boolean().optional(),
  brief_node_id: z.string().nullable().optional(),
  claimed_by: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

export const ExploitNodeSchema = z.object({
  id: z.string(),
  type: z.literal('exploit'),
  mission_id: z.string(),
  exploit_type: z.string(),
  payload: z.string(),
  target_endpoint: z.string(),
  http_status: z.number().optional(),
  response_body: z.string().optional(),
  success: z.boolean(),
  evidence: z.string().optional(),
  executed_by: z.string(),
  executed_at: z.number(),
});

export const ArtifactNodeSchema = z.object({
  id: z.string(),
  type: z.literal('artifact'),
  subtype: z.enum(['file', 'backup', 'coupon', 'nft', 'config', 'token']),
  name: z.string(),
  path: z.string().optional(),
  content_type: z.string().optional(),
  discovered_at: z.number(),
  discovered_by: z.string(),
  mission_id: z.string().optional(),
});

export const FindingNodeSchema = z.object({
  id: z.string(),
  type: z.literal('finding'),
  source: z.string(),
  target_endpoint: z.string().optional(),
  vuln_class: z.string().optional(),
  evidence: z.record(z.unknown()),
  created_at: z.number(),
});

export const ChainStepSchema = z.object({
  order: z.number(),
  mission_id: z.string(),
  action: z.string(),
  outcome: z.enum(['pending', 'success', 'failed']),
});

export const ChainNodeSchema = z.object({
  id: z.string(),
  type: z.literal('chain'),
  name: z.string(),
  chain_type: z.enum(['credential_abuse', 'idor', 'auth_escalation', 'rce_pivot']),
  steps: z.array(ChainStepSchema),
  status: z.enum(['active', 'completed', 'failed']),
  created_at: z.number(),
  created_by: z.string(),
});

export const LessonNodeSchema = z.object({
  id: z.string(),
  type: z.literal('lesson'),
  mission_id: z.string(),
  exploit_type: z.string(),
  failure_class: z.enum([
    'waf_blocked', 'wrong_endpoint', 'auth_required', 'payload_rejected',
    'target_patched', 'wrong_method', 'encoding_needed', 'session_required', 'unknown'
  ]),
  failed_payloads: z.array(z.string()),
  successful_payload: z.string().optional(),
  delta: z.string().optional(),
  reusable: z.boolean(),
  tags: z.array(z.string()),
  created_at: z.number(),
});

export const FailedMissionNodeSchema = z.object({
  id: z.string(),
  type: z.literal('failed_mission'),
  mission_id: z.string(),
  exploit_type: z.string(),
  failure_class: z.string(),
  evidence: z.record(z.unknown()),
  final_outcome: z.enum(['confirmed_unexploitable', 'needs_manual_review', 'likely_patched']),
  created_at: z.number(),
});

export const IntelNodeSchema = z.object({
  id: z.string(),
  type: z.literal('intel'),
  subtype: z.enum([
    'payload_library', 'technique_doc', 'cve_detail', 'exploit_brief',
    'tactic', 'technique', 'privesc_vector', 'attack_pattern'
  ]),
  name: z.string(),
  data: z.record(z.unknown()),
  linked_vuln_class: z.string().optional(),
  source: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

// ===========================================
// ADVANCED NODE SCHEMAS (Phase 2+)
// ===========================================

export const BeliefUpdateSchema = z.object({
  timestamp: z.number(),
  mission_id: z.string(),
  action: z.enum(['probe', 'exploit_success', 'exploit_fail', 'waf_block', 'auth_block']),
  response: z.string(),
  delta_p_v: z.number(),
  delta_p_p: z.number(),
});

export const BeliefNodeSchema = z.object({
  id: z.string(),
  type: z.literal('belief'),
  endpoint_id: z.string(),
  vuln_class: z.string(),
  p_vulnerable: z.number().min(0).max(1),
  p_protected: z.number().min(0).max(1),
  p_exploitable: z.number().min(0).max(1),
  evidence_log: z.array(BeliefUpdateSchema),
  last_updated: z.number(),
});

export const FailedPayloadSchema = z.object({
  payload: z.string(),
  response_snippet: z.string(),
  waf_triggered: z.boolean(),
});

export const GammaHandoffNodeSchema = z.object({
  id: z.string(),
  type: z.literal('gamma_handoff'),
  mission_id: z.string(),
  from_instance: z.string(),
  to_instance: z.string().optional(),
  hypothesis: z.string(),
  confirmed_facts: z.array(z.string()),
  failed_payloads: z.array(FailedPayloadSchema),
  next_action: z.string(),
  context_budget: z.number(),
  written_at: z.number(),
  consumed_at: z.number().optional(),
});

export const BypassCandidateSchema = z.object({
  payload: z.string(),
  bypass_hypothesis: z.string(),
  result: z.enum(['success', 'failed']).optional(),
});

export const WafDuelNodeSchema = z.object({
  id: z.string(),
  type: z.literal('waf_duel'),
  mission_id: z.string(),
  waf_model: z.string(),
  bypass_candidates: z.array(BypassCandidateSchema),
  status: z.enum(['active', 'completed', 'failed']),
  created_at: z.number(),
});

export const SpecialistConfigNodeSchema = z.object({
  id: z.string(),
  type: z.literal('specialist_config'),
  surface_type: z.string(),
  parent_mission: z.string(),
  system_prompt: z.string(),
  mission_template: MissionNodeSchema,
  spawn_condition: z.string(),
  despawn_trigger: z.string(),
  created_at: z.number(),
  status: z.enum(['active', 'despawned']),
});

export const WorkingExampleSchema = z.object({
  source: z.string(),
  payload: z.string(),
  context: z.string(),
});

export const ExploitBriefNodeSchema = z.object({
  id: z.string(),
  type: z.literal('intel'),
  subtype: z.literal('exploit_brief'),
  mission_id: z.string(),
  exploit_type: z.string(),
  target_component: z.string().optional(),
  technique_summary: z.string(),
  working_examples: z.array(WorkingExampleSchema),
  known_waf_bypasses: z.array(z.string()),
  common_failures: z.array(z.string()),
  lesson_refs: z.array(z.string()),
  osint_confidence: z.enum(['high', 'medium', 'low']),
});

export const StackFingerprintSchema = z.object({
  framework: z.array(z.string()),
  auth_type: z.enum(['jwt', 'session', 'oauth2', 'api_key', 'unknown']),
  db_hints: z.array(z.string()),
  server: z.string().optional(),
});

export const CrossEngagementLessonNodeSchema = z.object({
  id: z.string(),
  type: z.literal('cross_engagement_lesson'),
  stack_fingerprint: StackFingerprintSchema,
  engagement_id: z.string(),
  target_class: z.string(),
  exploit_type: z.string(),
  failure_class: z.string().optional(),
  successful_payload: z.string().optional(),
  delta: z.string().optional(),
  reusable: z.boolean(),
  tags: z.array(z.string()),
  created_at: z.number(),
});

// ===========================================
// TYPE EXPORTS
// ===========================================

export type TargetNode = z.infer<typeof TargetNodeSchema>;
export type EndpointNode = z.infer<typeof EndpointNodeSchema>;
export type ComponentNode = z.infer<typeof ComponentNodeSchema>;
export type VulnerabilityNode = z.infer<typeof VulnerabilityNodeSchema>;
export type UserNode = z.infer<typeof UserNodeSchema>;
export type CredentialNode = z.infer<typeof CredentialNodeSchema>;
export type MissionNode = z.infer<typeof MissionNodeSchema>;
export type ExploitNode = z.infer<typeof ExploitNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;
export type FindingNode = z.infer<typeof FindingNodeSchema>;
export type ChainNode = z.infer<typeof ChainNodeSchema>;
export type LessonNode = z.infer<typeof LessonNodeSchema>;
export type FailedMissionNode = z.infer<typeof FailedMissionNodeSchema>;
export type IntelNode = z.infer<typeof IntelNodeSchema>;
export type BeliefNode = z.infer<typeof BeliefNodeSchema>;
export type GammaHandoffNode = z.infer<typeof GammaHandoffNodeSchema>;
export type WafDuelNode = z.infer<typeof WafDuelNodeSchema>;
export type SpecialistConfigNode = z.infer<typeof SpecialistConfigNodeSchema>;
export type ExploitBriefNode = z.infer<typeof ExploitBriefNodeSchema>;
export type CrossEngagementLessonNode = z.infer<typeof CrossEngagementLessonNodeSchema>;
