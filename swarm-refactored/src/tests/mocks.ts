import { vi, type Mock } from 'vitest';

export const MOCK_REDIS_DATA = new Map<string, Record<string, string>>();

export const mockRedisBus = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ping: vi.fn().mockResolvedValue(true),
  publish: vi.fn().mockResolvedValue(undefined),
  consume: vi.fn().mockResolvedValue([]),
  ack: vi.fn().mockResolvedValue(undefined),
  blackboard_write: vi.fn().mockResolvedValue(undefined),
  blackboard_read: vi.fn().mockImplementation((missionId: string, key: string) => {
    const data = MOCK_REDIS_DATA.get(`redteam:blackboard:${missionId}`);
    return Promise.resolve(data?.[key] ? JSON.parse(data[key]) : null);
  }),
  blackboard_read_all: vi.fn().mockImplementation((missionId: string) => {
    const data = MOCK_REDIS_DATA.get(`redteam:blackboard:${missionId}`);
    return Promise.resolve(data || {});
  }),
  blackboard_clear: vi.fn().mockResolvedValue(undefined),
  get_payload_attempt_count: vi.fn().mockResolvedValue(0),
  increment_payload_attempt: vi.fn().mockResolvedValue(1),
  get_tokens: vi.fn().mockResolvedValue({}),
  store_token: vi.fn().mockResolvedValue(undefined),
  get_latest_defense_intel: vi.fn().mockResolvedValue([]),
  consume_defense_analytics: vi.fn().mockResolvedValue([]),
  findings_store: vi.fn().mockResolvedValue(undefined),
  findings_read: vi.fn().mockResolvedValue(null),
  findings_read_all: vi.fn().mockResolvedValue({}),
  store_successful_payload: vi.fn().mockResolvedValue(undefined),
  a2a_publish: vi.fn().mockResolvedValue(undefined),
  a2a_consume: vi.fn().mockResolvedValue([]),
};

export const MOCK_SUPABASE_DATA = {
  missions: new Map<string, object>(),
  agent_states: new Map<string, object>(),
  swarm_events: new Map<string, object[]>(),
};

export const mockSupabaseClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  enabled: true,
  createMission: vi.fn().mockImplementation((missionId: string, target: string, objective?: string) => {
    MOCK_SUPABASE_DATA.missions.set(missionId, {
      id: missionId,
      target,
      objective,
      status: 'running',
      created_at: new Date().toISOString(),
    });
    return Promise.resolve({ id: missionId, target, status: 'running', created_at: new Date().toISOString() });
  }),
  updateMissionStatus: vi.fn().mockResolvedValue(true),
  updateAgentState: vi.fn().mockResolvedValue(true),
  logSwarmEvent: vi.fn().mockResolvedValue('event-123'),
  logKillChainEvent: vi.fn().mockResolvedValue(true),
  logExploitAttempt: vi.fn().mockResolvedValue('attempt-123'),
  logSwarmFinding: vi.fn().mockResolvedValue('finding-123'),
  getVulnerabilities: vi.fn().mockResolvedValue([]),
  getScanIdsByRepo: vi.fn().mockResolvedValue([]),
  getRecentHighSeverityVulnerabilities: vi.fn().mockResolvedValue([]),
};

export function createMockLlmResponse(response: string) {
  return vi.fn().mockResolvedValue(response);
}

export function createMockLlmError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

export const MOCK_LLM_RESPONSES = {
  commander_plan: JSON.stringify({
    strategy: 'Test strategy - target authentication endpoints',
    next_phase: 'exploitation',
    tasks: [
      {
        agent: 'agent_gamma',
        description: 'Test SQL injection on login endpoint',
        target: 'http://localhost:3000/rest/user/login',
        tools_allowed: ['curl'],
        priority: 'HIGH',
        exploit_type: 'sqli',
      },
      {
        agent: 'agent_alpha',
        description: 'Scan for information disclosure',
        target: 'http://localhost:3000/api',
        tools_allowed: ['curl'],
        priority: 'MEDIUM',
        exploit_type: 'info_disclosure',
      },
    ],
  }),
  alpha_recon: JSON.stringify([
    {
      url: 'http://localhost:3000/api/Products',
      method: 'GET',
      headers: {},
      finding: 'Information disclosure on products API',
      severity: 'MEDIUM',
      confidence: 0.8,
    },
  ]),
  gamma_exploit: JSON.stringify([
    {
      tool: 'curl',
      args: {
        url: 'http://localhost:3000/rest/user/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: '{"email":"admin@juice-sh.op","password":"admin"}',
      },
      exploit_type: 'sqli',
    },
  ]),
  critic_analyze: JSON.stringify({
    verdict: 'viable',
    severity: 'HIGH',
    recommendations: ['Try authentication bypass', 'Test for IDOR'],
  }),
};

export function resetMocks() {
  MOCK_REDIS_DATA.clear();
  MOCK_SUPABASE_DATA.missions.clear();
  MOCK_SUPABASE_DATA.agent_states.clear();
  MOCK_SUPABASE_DATA.swarm_events.clear();
  
  vi.clearAllMocks();
}
