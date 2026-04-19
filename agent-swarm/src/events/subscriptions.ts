import type { SwarmEventType } from './types.js';

export interface AgentSubscription {
  agentId: string;
  agentType: string;
  events: SwarmEventType[];
}

export const AGENT_SUBSCRIPTIONS: Record<string, SwarmEventType[]> = {
  commander: [
    'finding_written',
    'credential_found',
    'mission_verified',
    'exploit_completed',
    'exploit_failed',
    'swarm_complete',
    'validation_probe_complete',
  ],
  verifier: [
    'mission_queued',
  ],
  mission_planner: [
    'finding_validated',
  ],
  gamma: [
    'mission_authorized',
    'brief_ready',
    'waf_duel_started',
    'handoff_requested',
  ],
  mcp: [
    'mission_authorized',
    'validation_probe_requested',
  ],
  alpha: [
    'scan_initiated',
    'mission_authorized',
  ],
  osint: [
    'mission_queued',
    'enrichment_requested',
    'exploit_failed',
    'waf_duel_started',
  ],
  chain_planner: [
    'credential_found',
    'credential_promoted',
    'exploit_completed',
  ],
  critic: [
    'exploit_failed',
  ],
  post_exploit: [
    'rce_confirmed',
  ],
  report_agent: [
    'swarm_complete',
  ],
  specialist: [
    'specialist_activated',
  ],
};

export function getSubscriptions(agentType: string): SwarmEventType[] {
  return AGENT_SUBSCRIPTIONS[agentType] || [];
}

export function getAllSubscribedEvents(): SwarmEventType[] {
  const allEvents = new Set<SwarmEventType>();
  for (const events of Object.values(AGENT_SUBSCRIPTIONS)) {
    for (const event of events) {
      allEvents.add(event);
    }
  }
  return Array.from(allEvents);
}
