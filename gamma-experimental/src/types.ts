export interface Mission {
  missionId: string;
  target: string;
  targetUrl: string;
  scanType: 'full' | 'quick' | 'focused';
  maxIterations: number;
  maxContextTokens: number;
  reconReports: string[];
}

export interface Finding {
  timestamp: number;
  type: 'jwt' | 'credential' | 'endpoint' | 'vulnerability' | 'info' | 'exploit';
  value: string;
  source: string;
}

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  success: boolean;
}

export interface PhaseState {
  phase: 'recon' | 'exploit' | 'escalate' | 'persist' | 'exfil' | 'complete';
  iteration: number;
  commandsRun: string[];
  findings: Finding[];
  currentPlan: string[];
  completedTasks: string[];
  pendingTasks: string[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OrchestratorPlan {
  phases: Phase[];
  currentPhase: number;
  tasks: string[];
  completedTasks: string[];
  reasoning: string;
}

export interface Phase {
  name: 'recon' | 'exploit' | 'escalate' | 'persist' | 'exfil';
  description: string;
  tasks: string[];
}

export interface ContextWindow {
  recentCommands: { cmd: string; output: string }[];
  commandSummary: string;
  findings: Finding[];
  planProgress: string;
  currentPhase: string;
  totalIterations: number;
}
