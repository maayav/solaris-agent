import { z } from 'zod';

export const AgentRoleSchema = z.enum([
  'commander',
  'agent_alpha',
  'agent_beta',
  'agent_gamma',
  'agent_critic',
]);

export const MessageTypeSchema = z.enum([
  'TASK_ASSIGNMENT',
  'STRATEGY_UPDATE',
  'INTELLIGENCE_REPORT',
  'EXPLOIT_RESULT',
  'STATUS_UPDATE',
  'HITL_REQUEST',
  'HITL_RESPONSE',
  'MISSION_START',
  'MISSION_COMPLETE',
]);

export const PrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const PhaseSchema = z.enum([
  'planning',
  'recon',
  'exploitation',
  'reporting',
  'complete',
]);

export const ExploitTypeSchema = z.enum([
  'sqli',
  'xss',
  'idor',
  'lfi',
  'auth_bypass',
  'info_disclosure',
  'sensitive_data_exposure',
  'xxe',
  'client_side_bypass',
  'authentication',
  'broken_access_control',
  'command_injection',
  'vulnerability_scan',
  'osint',
  'cve',
  'jwt',
  'scrape',
  'ffuf',
  'nmap',
  'nuclei',
  'python',
  'curl',
  'ssrf',
  'path_traversal',
  'prototype_pollution',
  'open_redirect',
  'security_misconfiguration',
]);

export const TaskAssignmentSchema = z.object({
  agent: z.enum(['agent_alpha', 'agent_gamma']),
  description: z.string(),
  target: z.string(),
  tools_allowed: z.array(z.string()),
  priority: PrioritySchema,
  exploit_type: ExploitTypeSchema,
});

export const CommanderPlanSchema = z.object({
  strategy: z.string(),
  tasks: z.array(TaskAssignmentSchema).min(1),
  next_phase: PhaseSchema,
  analysis: z.string().optional(),
  stealth_mode: z.boolean().optional(),
});

export const ExploitResultSchema = z.object({
  target: z.string(),
  exploit_type: ExploitTypeSchema,
  success: z.boolean(),
  payload_used: z.string(),
  response_code: z.number().optional(),
  evidence: z.string(),
  impact: z.string(),
  execution_time: z.number(),
  error_type: z.string().optional(),
  deterministic: z.boolean().optional(),
  recommendation: z.string().optional(),
  severity: z.string().optional(),
});

export const IntelligenceReportSchema = z.object({
  source: z.string().optional(),
  asset: z.string(),
  finding: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  cve_hint: z.string().nullable().optional(),
  recommended_action: z.string().optional(),
});

export const EvaluationSchema = z.object({
  success: z.boolean(),
  evidence: z.string(),
  error_type: z.string().optional(),
  feedback: z.string().optional(),
  severity: z.string(),
  recommendation: z.string().optional(),
  deterministic: z.boolean().optional(),
});

export const BlueTeamFindingSchema = z.object({
  finding_id: z.string(),
  scan_id: z.string(),
  vuln_type: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  file_path: z.string(),
  category: z.string().optional(),
  line_start: z.number().optional(),
  line_end: z.number().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  code_snippet: z.string().optional(),
  confirmed: z.boolean(),
  confidence_score: z.number().optional(),
  false_positive: z.boolean(),
  fix_suggestion: z.string().optional(),
  reproduction_test: z.string().optional(),
  created_at: z.string().optional(),
  repo_url: z.string().optional(),
  exploit_suggestions: z.array(z.string()),
});

export const DefenseAnalyticsSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  vulnerability_type: z.string(),
  description: z.string(),
  blocked_payload: z.string().optional(),
  detected_signature: z.string().optional(),
  endpoint: z.string().optional(),
  target: z.string().optional(),
  mission_id: z.string().optional(),
  source: z.enum(['blue_team', 'waf', 'ids']),
  agent: z.string().optional(),
  timestamp: z.string(),
});

export const A2AMessageSchema = z.object({
  msg_id: z.string(),
  sender: AgentRoleSchema,
  recipient: z.union([AgentRoleSchema, z.literal('all')]),
  type: MessageTypeSchema,
  priority: PrioritySchema,
  payload: z.record(z.unknown()),
  timestamp: z.string(),
});

export const CredentialSchema = z.object({
  name: z.string(),
  value: z.string(),
  type: z.enum(['jwt', 'cookie', 'basic']),
  target: z.string(),
});

export const DiscoveredTokenSchema = z.object({
  name: z.string(),
  value: z.string(),
  type: z.enum(['jwt', 'cookie', 'bearer', 'api_key']),
  source: z.enum(['critic_analysis', 'response_scan']),
  timestamp: z.string(),
});

export const ExecResultSchema = z.object({
  exit_code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  command: z.string(),
  timed_out: z.boolean(),
});

export const ReconResultSchema = z.object({
  source: z.enum(['blue_team_static_analysis', 'alpha_recon']),
  finding_id: z.string().optional(),
  vuln_type: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  file_path: z.string().optional(),
  line_start: z.number().optional(),
  line_end: z.number().optional(),
  title: z.string(),
  description: z.string().optional(),
  code_snippet: z.string().optional(),
  confidence: z.number(),
  confirmed: z.boolean().optional(),
  exploit_suggestions: z.array(z.string()).optional(),
  endpoint: z.string().nullable().optional(),
  asset: z.string(),
  finding: z.string(),
});

export const TaskSchema = z.object({
  agent: z.enum(['agent_alpha', 'agent_gamma']),
  description: z.string(),
  target: z.string(),
  tools_allowed: z.array(z.string()),
  priority: PrioritySchema,
  exploit_type: ExploitTypeSchema,
  task_id: z.string().optional(),
  status: z.string().optional(),
});

export const BlackboardSchema = z.object({
  successful_vectors: z.array(z.string()),
  compromised_endpoints: z.array(z.string()),
  stealth_mode: z.boolean(),
  forbidden_endpoints: z.array(z.string()),
  forbidden_until_iteration: z.number(),
  last_analysis: z.string(),
  current_strategy: z.string(),
  repo_path: z.string().optional(),
});

export const KillChainNarrativeStepSchema = z.object({
  step: z.number(),
  phase: z.string(),
  finding: z.string(),
  asset: z.string(),
  exploit_type: z.string(),
  impact: z.string(),
  evidence: z.string(),
  credentials_discovered: z.boolean(),
});

export const ReportSchema = z.object({
  report_metadata: z.object({
    generated_at: z.string(),
    mission_id: z.string(),
    report_version: z.literal('1.0'),
  }),
  mission_summary: z.object({
    objective: z.string(),
    target: z.string(),
    final_phase: PhaseSchema,
    iterations_completed: z.number(),
    max_iterations: z.number(),
    strategy: z.string(),
  }),
  reconnaissance_findings: z.array(ReconResultSchema),
  exploitation_results: z.array(ExploitResultSchema),
  kill_chain_progress: z.object({
    phases_completed: z.array(z.enum([
      'reconnaissance',
      'weaponization',
      'exploitation',
      'installation',
      'c2',
      'actions_on_objectives',
    ])),
    total_phases: z.literal(7),
    progress_percentage: z.number(),
    successful_exploits: z.number(),
    narrative: z.array(KillChainNarrativeStepSchema),
  }),
  statistics: z.object({
    total_messages: z.number(),
    intel_reports: z.number(),
    exploit_attempts: z.number(),
    successful_exploits: z.number(),
    high_confidence_findings: z.number(),
    reflection_count: z.number(),
    errors_count: z.number(),
  }),
  recommendations: z.array(z.string()),
  errors: z.array(z.string()),
});

export const COMMANDER_OUTPUT_SCHEMA = {
  type: 'object' as const,
  required: ['analysis', 'next_phase', 'strategy', 'stealth_mode', 'tasks'],
  properties: {
    analysis: { type: 'string' },
    next_phase: {
      type: 'string',
      enum: ['recon', 'exploitation', 'complete'],
    },
    strategy: { type: 'string' },
    stealth_mode: { type: 'boolean' },
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['agent', 'description', 'target', 'tools_allowed', 'priority', 'exploit_type'],
        properties: {
          agent: {
            type: 'string',
            enum: ['agent_alpha', 'agent_gamma'],
          },
          description: { type: 'string' },
          target: { type: 'string' },
          tools_allowed: {
            type: 'array',
            items: { type: 'string' },
          },
          priority: {
            type: 'string',
            enum: ['HIGH', 'MEDIUM', 'LOW'],
          },
          exploit_type: {
            type: 'string',
            enum: [
              'sqli',
              'xss',
              'idor',
              'lfi',
              'auth_bypass',
              'info_disclosure',
              'sensitive_data_exposure',
              'xxe',
              'client_side_bypass',
              'authentication',
              'broken_access_control',
            ],
          },
        },
      },
    },
  },
};
