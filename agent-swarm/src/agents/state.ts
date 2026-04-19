export type AgentState = 'DORMANT' | 'STANDBY' | 'ACTIVE' | 'COOLDOWN' | 'ERROR';

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: string;
}

export const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  DORMANT: ['STANDBY'],
  STANDBY: ['ACTIVE', 'DORMANT', 'ERROR'],
  ACTIVE: ['COOLDOWN', 'ERROR'],
  COOLDOWN: ['STANDBY', 'DORMANT', 'ERROR'],
  ERROR: ['DORMANT', 'STANDBY'],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export const AGENT_INITIAL_STATES: Record<string, AgentState> = {
  commander: 'STANDBY',
  verifier: 'STANDBY',
  gamma: 'DORMANT',
  alpha: 'STANDBY',
  osint: 'DORMANT',
  mcp: 'DORMANT',
  mission_planner: 'DORMANT',
  chain_planner: 'DORMANT',
  critic: 'DORMANT',
  post_exploit: 'DORMANT',
  report_agent: 'DORMANT',
  specialist: 'DORMANT',
};
