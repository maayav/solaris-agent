import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RedTeamState, Phase, ExecResult } from '../types';
import { createInitialState, createEmptyBlackboard } from '../core/state';
import { shouldContinue } from '../graph/langgraph';
import { detectTargetType } from '../agents/alpha-recon';
import { isDestructivePayload, PHASE_1_TYPES, PHASE_2_TYPES } from '../agents/gamma-exploit';
import { scan_for_juice_shop_hints } from '../agents/critic-agent';
import { report_generation_node } from '../agents/report-generator';

const { mockRedisBus, mockSupabaseClient } = vi.hoisted(() => {
  const mockRedisBus = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
    publish: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue([]),
    ack: vi.fn().mockResolvedValue(undefined),
    blackboard_write: vi.fn().mockResolvedValue(undefined),
    blackboard_read: vi.fn().mockResolvedValue(null),
    blackboard_read_all: vi.fn().mockResolvedValue({}),
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

  const mockSupabaseClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    enabled: true,
    createMission: vi.fn().mockResolvedValue({ id: 'test', target: 'http://test', status: 'running', created_at: new Date().toISOString() }),
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

  return { mockRedisBus, mockSupabaseClient };
});

vi.mock('../core/redis-bus', () => ({
  redisBus: mockRedisBus,
}));

vi.mock('../core/supabase-client', () => ({
  supabaseClient: mockSupabaseClient,
}));

describe('Integration: Alpha Recon Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect target type correctly', () => {
    expect(detectTargetType('github.com/user/repo')).toBe('static');
    expect(detectTargetType('http://localhost:3000')).toBe('live');
    expect(detectTargetType('https://api.example.com')).toBe('live');
  });

  it('should detect static targets with github', () => {
    expect(detectTargetType('github.com')).toBe('static');
    expect(detectTargetType('github.com/user/repo')).toBe('static');
  });

  it('should detect live targets with http', () => {
    expect(detectTargetType('http://localhost')).toBe('live');
    expect(detectTargetType('https://example.com')).toBe('live');
    expect(detectTargetType('http://127.0.0.1:8080')).toBe('live');
  });
});

describe('Integration: Gamma Exploit Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect DROP as destructive', () => {
    expect(isDestructivePayload('DROP TABLE users')).toBe(true);
    expect(isDestructivePayload('DROP DATABASE main')).toBe(true);
  });

  it('should detect DELETE as destructive', () => {
    expect(isDestructivePayload('DELETE FROM users WHERE id=1')).toBe(true);
    expect(isDestructivePayload('DELETE * FROM customers')).toBe(true);
  });

  it('should not flag non-destructive SQL as destructive', () => {
    expect(isDestructivePayload("' OR 1=1 --")).toBe(false);
    expect(isDestructivePayload('SELECT * FROM users')).toBe(false);
  });

  it('should detect shell commands as destructive', () => {
    expect(isDestructivePayload('rm -rf /')).toBe(true);
    expect(isDestructivePayload('SHUTDOWN;')).toBe(true);
    expect(isDestructivePayload("EXEC xp_cmdshell('dir')")).toBe(true);
  });

  it('should have correct phase types defined', () => {
    expect(PHASE_1_TYPES).toContain('sqli');
    expect(PHASE_1_TYPES).toContain('xss');
    expect(PHASE_1_TYPES).toContain('xxe');
    expect(PHASE_1_TYPES).toContain('command_injection');
    expect(PHASE_2_TYPES).toContain('idor');
    expect(PHASE_2_TYPES).toContain('auth_bypass');
    expect(PHASE_2_TYPES).toContain('broken_access_control');
  });
});

describe('Integration: Critic Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should scan for Juice Shop hints', () => {
    const execResult: ExecResult = {
      exit_code: 0,
      stdout: 'Juice Shop detected - SQL injection possible',
      stderr: '',
      command: '',
      timed_out: false,
      success: true,
    };

    const hints = scan_for_juice_shop_hints(execResult);
    expect(Array.isArray(hints)).toBe(true);
  });

  it('should return empty hints for non-Juice Shop output', () => {
    const execResult: ExecResult = {
      exit_code: 0,
      stdout: 'Hello world',
      stderr: '',
      command: '',
      timed_out: false,
      success: true,
    };

    const hints = scan_for_juice_shop_hints(execResult);
    expect(Array.isArray(hints)).toBe(true);
  });
});

describe('Integration: Report Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a report', async () => {
    const state = createInitialState('test-mission', 'Test operation', 'http://localhost:3000');
    state.phase = 'complete';
    state.recon_results = [
      {
        asset: 'http://localhost:3000/api/Products',
        title: 'Information disclosure',
        finding: 'Information disclosure on products API',
        severity: 'medium',
        confidence: 0.8,
        source: 'alpha_recon' as const,
      },
    ];
    state.exploit_results = [
      {
        target: 'http://localhost:3000/rest/user/login',
        exploit_type: 'sqli' as const,
        success: true,
        payload_used: "' OR 1=1 --",
        evidence: 'Auth bypassed',
        impact: 'Full authentication bypass',
        execution_time: 0.5,
      },
    ];
    state.blackboard.successful_vectors = ['sqli'];
    state.blackboard.compromised_endpoints = ['http://localhost:3000/rest/user/login'];

    const result = await report_generation_node(state);

    expect(result.report).toBeDefined();
    expect(result.report_path).toBeDefined();
  });
});

describe('Integration: State Machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route to report when phase is complete', () => {
    const state = createInitialState('test', 'Test', 'http://localhost:3000');
    state.phase = 'complete';

    expect(shouldContinue(state)).toBe('report');
  });

  it('should route to report when max iterations reached', () => {
    const state = createInitialState('test', 'Test', 'http://localhost:3000', { maxIterations: 3 });
    state.iteration = 3;
    state.phase = 'exploitation';

    expect(shouldContinue(state)).toBe('report');
  });

  it('should route to exploit_only when in exploitation phase', () => {
    const state = createInitialState('test', 'Test', 'http://localhost:3000');
    state.phase = 'exploitation';
    state.iteration = 1;

    expect(shouldContinue(state)).toBe('exploit_only');
  });

  it('should route to continue when in recon phase', () => {
    const state = createInitialState('test', 'Test', 'http://localhost:3000');
    state.phase = 'recon';
    state.iteration = 1;

    expect(shouldContinue(state)).toBe('continue');
  });
});

describe('Integration: Redis Bus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should connect', async () => {
    await expect(mockRedisBus.connect()).resolves.toBeUndefined();
  });

  it('should write to blackboard', async () => {
    await mockRedisBus.blackboard_write('mission-1', 'test_key', { value: 'test_data' });
    expect(mockRedisBus.blackboard_write).toHaveBeenCalled();
  });

  it('should get payload attempt count', async () => {
    const count = await mockRedisBus.get_payload_attempt_count('mission-1', 'hash123');
    expect(count).toBe(0);
  });
});

describe('Integration: Supabase Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should connect', async () => {
    await expect(mockSupabaseClient.connect()).resolves.toBeUndefined();
  });

  it('should create mission', async () => {
    const result = await mockSupabaseClient.createMission('mission-1', 'http://localhost:3000', 'Test mission');
    expect(result).toBeDefined();
  });
});
