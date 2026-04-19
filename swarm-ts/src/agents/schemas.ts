import { z } from 'zod'

export const TaskAssignmentSchema = z.object({
  task_id: z.string().optional(),
  description: z.string(),
  target: z.string().default(''),
  tools_allowed: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
})

export const AuthorizationContextSchema = z.object({
  type: z.enum(['vdp', 'pentest_contract', 'ctf', 'private_lab']),
  evidence_url: z.string().optional(),
  scope_domains: z.array(z.string()),
  excluded_domains: z.array(z.string()).default([]),
  authorized_by: z.string(),
  authorized_at: z.string(),
  expiry: z.string().optional(),
  checksum: z.string(),
})

export const CommanderPlanSchema = z.object({
  strategy: z.string(),
  tasks: z.array(TaskAssignmentSchema).default([]),
  next_phase: z.enum(['recon', 'exploitation', 'complete']),
})

export const ExploitResultSchema = z.object({
  target: z.string(),
  exploit_type: z.string(),
  success: z.boolean(),
  payload: z.string().optional(),
  http_status: z.number().optional(),
  response_body: z.string().optional(),
  baseline_response: z.string().optional(),
  injected_payload: z.string().optional(),
  vulnerability_type: z.string().optional(),
  evidence: z.string().optional(),
  impact: z.string().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).default('MEDIUM'),
  execution_time: z.number().optional(),
})

export const ReconFindingSchema = z.object({
  tool: z.string(),
  target: z.string(),
  findings: z.array(z.string()).default([]),
  timestamp: z.string(),
})

export const A2AMessageSchema = z.object({
  msg_id: z.string(),
  sender: z.enum(['commander', 'agent_alpha', 'agent_beta', 'agent_gamma', 'agent_critic']),
  recipient: z.union([
    z.enum(['commander', 'agent_alpha', 'agent_beta', 'agent_gamma', 'agent_critic']),
    z.literal('all')
  ]),
  type: z.enum([
    'TASK_ASSIGNMENT', 'STRATEGY_UPDATE', 'INTELLIGENCE_REPORT',
    'EXPLOIT_RESULT', 'STATUS_UPDATE', 'HITL_REQUEST', 'HITL_RESPONSE',
    'MISSION_START', 'MISSION_COMPLETE'
  ]),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  payload: z.record(z.unknown()).default({}),
  timestamp: z.string(),
})

export const CredentialContextSchema = z.object({
  token: z.string(),
  token_handle: z.string(),
  type: z.enum(['bearer', 'cookie', 'api_key', 'basic_auth', 'jwt', 'session']),
  scope: z.array(z.string()),
  discovered_at: z.string(),
  discovered_by: z.string(),
  expiry: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
})

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>
export type AuthorizationContext = z.infer<typeof AuthorizationContextSchema>
export type CommanderPlan = z.infer<typeof CommanderPlanSchema>
export type ExploitResult = z.infer<typeof ExploitResultSchema>
export type ReconFinding = z.infer<typeof ReconFindingSchema>
export type A2AMessage = z.infer<typeof A2AMessageSchema>
export type CredentialContext = z.infer<typeof CredentialContextSchema>
