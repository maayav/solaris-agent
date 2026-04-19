import type {
  RedTeamState,
  A2AMessage,
  ReconResult,
  ExploitResult,
  Task,
  BlueTeamFinding,
  Credential,
  Report,
  Phase,
  Blackboard,
} from '../types/index.js';

export function createInitialState(
  missionId: string,
  objective: string,
  target: string,
  options?: {
    maxIterations?: number;
    maxReflections?: number;
    repoUrl?: string;
    fastMode?: boolean;
  }
): RedTeamState {
  return {
    mission_id: missionId,
    objective,
    target,
    phase: 'planning' as Phase,
    messages: [] as A2AMessage[],
    blackboard: createEmptyBlackboard(),
    recon_results: [] as ReconResult[],
    exploit_results: [] as ExploitResult[],
    current_tasks: [] as Task[],
    strategy: '',
    iteration: 0,
    max_iterations: options?.maxIterations ?? 5,
    needs_human_approval: false,
    human_response: null,
    reflection_count: 0,
    max_reflections: options?.maxReflections ?? 3,
    pending_exploit: null,
    discovered_credentials: {} as Record<string, Credential>,
    contextual_memory: {} as Record<string, unknown>,
    report: null,
    report_path: null,
    blue_team_findings: [] as BlueTeamFinding[],
    blue_team_recon_results: [] as ReconResult[],
    blue_team_intelligence_brief: '',
    errors: [] as string[],
    mode: null,
    fast_mode: options?.fastMode ?? false,
    repo_url: options?.repoUrl ?? null,
  };
}

export function createEmptyBlackboard(): Blackboard {
  return {
    successful_vectors: [],
    compromised_endpoints: [],
    stealth_mode: false,
    forbidden_endpoints: [],
    forbidden_until_iteration: 0,
    last_analysis: '',
    current_strategy: '',
  };
}

export function createA2AMessage(
  sender: string,
  recipient: string | 'all',
  type: string,
  priority: string,
  payload: Record<string, unknown>
): A2AMessage {
  return {
    msg_id: crypto.randomUUID(),
    sender: sender as any,
    recipient: recipient as any,
    type: type as any,
    priority: priority as any,
    payload,
    timestamp: new Date().toISOString(),
  };
}

export function getStateSummary(state: RedTeamState): string {
  return `
Mission: ${state.mission_id}
Phase: ${state.phase}
Iteration: ${state.iteration}/${state.max_iterations}
Target: ${state.target}
Messages: ${state.messages.length}
Recon findings: ${state.recon_results.length}
Exploit results: ${state.exploit_results.length}
Errors: ${state.errors.length}
`.trim();
}
