export type AgentRole = 'commander' | 'agent_alpha' | 'agent_beta' | 'agent_gamma' | 'agent_critic';

export const AgentRole = {
  COMMANDER: 'commander' as AgentRole,
  ALPHA: 'agent_alpha' as AgentRole,
  BETA: 'agent_beta' as AgentRole,
  GAMMA: 'agent_gamma' as AgentRole,
  CRITIC: 'agent_critic' as AgentRole,
};

export type MessageType =
  | 'TASK_ASSIGNMENT'
  | 'STRATEGY_UPDATE'
  | 'INTELLIGENCE_REPORT'
  | 'EXPLOIT_RESULT'
  | 'STATUS_UPDATE'
  | 'HITL_REQUEST'
  | 'HITL_RESPONSE'
  | 'MISSION_START'
  | 'MISSION_COMPLETE';

export const MessageType = {
  TASK_ASSIGNMENT: 'TASK_ASSIGNMENT' as MessageType,
  STRATEGY_UPDATE: 'STRATEGY_UPDATE' as MessageType,
  INTELLIGENCE_REPORT: 'INTELLIGENCE_REPORT' as MessageType,
  EXPLOIT_RESULT: 'EXPLOIT_RESULT' as MessageType,
  STATUS_UPDATE: 'STATUS_UPDATE' as MessageType,
  HITL_REQUEST: 'HITL_REQUEST' as MessageType,
  HITL_RESPONSE: 'HITL_RESPONSE' as MessageType,
  MISSION_START: 'MISSION_START' as MessageType,
  MISSION_COMPLETE: 'MISSION_COMPLETE' as MessageType,
};

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const Priority = {
  LOW: 'LOW' as Priority,
  MEDIUM: 'MEDIUM' as Priority,
  HIGH: 'HIGH' as Priority,
  CRITICAL: 'CRITICAL' as Priority,
};

export type Phase = 'planning' | 'recon' | 'exploitation' | 'reporting' | 'complete';

export type ExploitType =
  | 'sqli'
  | 'xss'
  | 'idor'
  | 'lfi'
  | 'auth_bypass'
  | 'info_disclosure'
  | 'sensitive_data_exposure'
  | 'xxe'
  | 'client_side_bypass'
  | 'authentication'
  | 'broken_access_control'
  | 'command_injection'
  | 'vulnerability_scan'
  | 'osint'
  | 'cve'
  | 'jwt'
  | 'scrape'
  | 'ffuf'
  | 'nmap'
  | 'nuclei'
  | 'python'
  | 'curl'
  | 'ssrf'
  | 'path_traversal'
  | 'prototype_pollution'
  | 'open_redirect'
  | 'security_misconfiguration';

export interface A2AMessage {
  msg_id: string;
  sender: AgentRole;
  recipient: AgentRole | 'all';
  type: MessageType;
  priority: Priority;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface TaskAssignment {
  agent: 'agent_alpha' | 'agent_gamma';
  description: string;
  target: string;
  tools_allowed: string[];
  priority: Priority;
  exploit_type: ExploitType;
}

export interface CommanderPlan {
  strategy: string;
  tasks: TaskAssignment[];
  next_phase: Phase;
  analysis?: string;
  stealth_mode?: boolean;
}

export interface ExploitResult {
  target: string;
  exploit_type: ExploitType;
  success: boolean;
  payload_used: string;
  response_code?: number;
  evidence: string;
  impact: string;
  execution_time: number;
  error_type?: string;
  deterministic?: boolean;
  recommendation?: string;
  severity?: string;
}

export interface IntelligenceReport {
  source: string;
  asset: string;
  finding: string;
  confidence: number;
  evidence: string;
  cve_hint?: string | null;
  recommended_action?: string;
}

export interface ReconResult {
  source: 'blue_team_static_analysis' | 'alpha_recon' | 'nmap' | 'curl' | 'recon';
  finding_id?: string;
  vuln_type?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  file_path?: string;
  line_start?: number;
  line_end?: number;
  title: string;
  description?: string;
  code_snippet?: string;
  confidence: number;
  confirmed?: boolean;
  exploit_suggestions?: string[];
  endpoint?: string | null;
  asset: string;
  finding: string;
  evidence?: string;
  cve_hint?: string | null;
  recommended_action?: string | null;
}

export interface Evaluation {
  success: boolean;
  evidence: string;
  error_type?: string;
  feedback?: string;
  severity: string;
  recommendation?: string;
  deterministic?: boolean;
}

export interface BlueTeamFinding {
  finding_id: string;
  scan_id: string;
  vuln_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file_path: string;
  category?: string;
  line_start?: number;
  line_end?: number;
  title?: string;
  description?: string;
  code_snippet?: string;
  confirmed: boolean;
  confidence_score?: number;
  false_positive: boolean;
  fix_suggestion?: string;
  reproduction_test?: string;
  created_at?: string;
  repo_url?: string;
  exploit_suggestions: string[];
}

export interface DefenseAnalytics {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability_type: string;
  description: string;
  blocked_payload?: string;
  detected_signature?: string;
  endpoint?: string;
  target?: string;
  mission_id?: string;
  source: 'blue_team' | 'waf' | 'ids';
  agent?: string;
  timestamp: string;
}

export interface Credential {
  name: string;
  value: string;
  type: 'jwt' | 'cookie' | 'basic';
  target: string;
}

export interface DiscoveredToken {
  name: string;
  value: string;
  type: 'jwt' | 'cookie' | 'bearer' | 'api_key';
  source: 'critic_analysis' | 'response_scan';
  timestamp: string;
}

export interface BlueTeamFinding {
  finding_id: string;
  scan_id: string;
  vuln_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file_path: string;
  category?: string;
  line_start?: number;
  line_end?: number;
  title?: string;
  description?: string;
  code_snippet?: string;
  confirmed: boolean;
  confidence_score?: number;
  false_positive: boolean;
  fix_suggestion?: string;
  reproduction_test?: string;
  created_at?: string;
  repo_url?: string;
  exploit_suggestions: string[];
}

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  command: string;
  timed_out: boolean;
  success: boolean;
}

export interface Task {
  agent: 'agent_alpha' | 'agent_gamma';
  description: string;
  target: string;
  tools_allowed: string[];
  priority: Priority;
  exploit_type: ExploitType;
  task_id?: string;
  status?: string;
}

export interface Report {
  report_metadata: {
    generated_at: string;
    mission_id: string;
    report_version: '1.0';
  };
  mission_summary: {
    objective: string;
    target: string;
    final_phase: Phase;
    iterations_completed: number;
    max_iterations: number;
    strategy: string;
  };
  reconnaissance_findings: ReconResult[];
  exploitation_results: ExploitResult[];
  kill_chain_progress: {
    phases_completed: KillChainPhase[];
    total_phases: number;
    progress_percentage: number;
    successful_exploits: number;
    narrative: KillChainNarrativeStep[];
  };
  statistics: {
    total_messages: number;
    intel_reports: number;
    exploit_attempts: number;
    successful_exploits: number;
    high_confidence_findings: number;
    reflection_count: number;
    errors_count: number;
  };
  recommendations: string[];
  errors: string[];
}

export type KillChainPhase =
  | 'reconnaissance'
  | 'weaponization'
  | 'exploitation'
  | 'installation'
  | 'c2'
  | 'actions_on_objectives';

export interface KillChainNarrativeStep {
  step: number;
  phase: string;
  finding: string;
  asset: string;
  exploit_type: string;
  impact: string;
  evidence: string;
  credentials_discovered: boolean;
}

export interface Blackboard {
  successful_vectors: string[];
  compromised_endpoints: string[];
  stealth_mode: boolean;
  forbidden_endpoints: string[];
  forbidden_until_iteration: number;
  last_analysis: string;
  current_strategy: string;
  repo_path?: string;
  use_hardcoded_exploits: boolean;
  [key: string]: unknown;
}

export interface RedTeamState {
  mission_id: string;
  objective: string;
  target: string;
  phase: Phase;
  messages: A2AMessage[];
  blackboard: Blackboard;
  recon_results: ReconResult[];
  exploit_results: ExploitResult[];
  current_tasks: Task[];
  strategy: string;
  iteration: number;
  max_iterations: number;
  needs_human_approval: boolean;
  human_response: string | null;
  reflection_count: number;
  max_reflections: number;
  pending_exploit: Task | null;
  discovered_credentials: Record<string, Credential>;
  contextual_memory: Record<string, unknown>;
  report: Report | null;
  report_path: string | null;
  blue_team_findings: BlueTeamFinding[];
  blue_team_recon_results: ReconResult[];
  blue_team_intelligence_brief: string;
  errors: string[];
  mode: 'live' | 'static' | null;
  fast_mode: boolean;
  repo_url: string | null;
}

export type ContinueDecision = 'continue' | 'exploit_only' | 'report';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  exploit_type: ExploitType;
}

export interface Attempt {
  exploit_type: string;
  payload: string;
  command: string;
  exit_code: number;
  timestamp: string;
}
