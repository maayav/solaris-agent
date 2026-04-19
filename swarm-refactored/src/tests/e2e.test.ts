import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runMission } from '../graph/langgraph';
import { redisBus } from '../core/redis-bus';
import { supabaseClient } from '../core/supabase-client';

vi.mock('../core/redis-bus', () => ({
  redisBus: {
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
  },
}));

vi.mock('../core/supabase-client', () => {
  const originalModule = vi.importActual('../core/supabase-client');
  return {
    supabaseClient: {
      ...originalModule,
      connect: vi.fn().mockResolvedValue(undefined),
      createMission: vi.fn().mockResolvedValue({ id: 'test', target: 'http://test', status: 'running', created_at: new Date().toISOString() }),
      updateMissionStatus: vi.fn().mockResolvedValue(true),
      updateAgentState: vi.fn().mockResolvedValue(true),
      logSwarmEvent: vi.fn().mockResolvedValue('event-123'),
      logKillChainEvent: vi.fn().mockResolvedValue(true),
      logExploitAttempt: vi.fn().mockResolvedValue('attempt-123'),
      logSwarmFinding: vi.fn().mockResolvedValue('finding-123'),
    },
  };
});

vi.mock('../core/sandbox-manager', () => ({
  sharedSandboxManager: {
    execCommand: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execCurl: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execNmap: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execNuclei: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execSqlmap: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execFfuf: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    execJwtTool: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    executePython: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
    ensureSharedSandbox: vi.fn().mockRejectedValue(new Error('Docker not available')),
    ensureImage: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
  executeToolViaSandbox: vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'Docker not available', success: false }),
  translateUrlForSandbox: vi.fn().mockImplementation((url: string) => url),
  setActiveTarget: vi.fn(),
  getSandboxTarget: vi.fn().mockReturnValue({ host: 'localhost', port: '3000' }),
  isSandboxAvailable: vi.fn().mockReturnValue(false),
  checkSandboxHealth: vi.fn().mockResolvedValue(false),
}));

describe.skip('E2E: Full Mission Pipeline', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
    await supabaseClient.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should run a complete mission with single iteration', async () => {
    const missionId = `test-${Date.now()}`;
    const objective = 'Test red team operation against localhost';
    const target = 'http://localhost:3000';

    const finalState = await runMission(missionId, objective, target, {
      maxIterations: 1,
    });

    expect(finalState.mission_id).toBe(missionId);
    expect(finalState.objective).toBe(objective);
    expect(finalState.target).toBe(target);
    expect(finalState.iteration).toBeGreaterThanOrEqual(0);
    expect(finalState.phase).toBeDefined();
    expect(Array.isArray(finalState.messages)).toBe(true);
    expect(Array.isArray(finalState.errors)).toBeDefined();
  }, 120000);

  it('should run a mission with multiple iterations', async () => {
    const missionId = `test-multi-${Date.now()}`;
    const objective = 'Multi-iteration test';
    const target = 'http://localhost:3000';

    const finalState = await runMission(missionId, objective, target, {
      maxIterations: 2,
    });

    expect(finalState.iteration).toBeGreaterThanOrEqual(1);
    expect(finalState.messages.length).toBeGreaterThan(0);
  }, 180000);

  it('should use fast mode when specified', async () => {
    const missionId = `test-fast-${Date.now()}`;

    const finalState = await runMission(missionId, 'Fast test', 'http://localhost:3000', {
      maxIterations: 1,
      fastMode: true,
    });

    expect(finalState.fast_mode).toBe(true);
  }, 120000);
});

describe.skip('E2E: Mission State Transitions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should transition through phases correctly', async () => {
    const missionId = `test-transition-${Date.now()}`;

    const finalState = await runMission(missionId, 'Phase transition test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    const validPhases = ['planning', 'recon', 'exploitation', 'complete'];
    expect(validPhases).toContain(finalState.phase);
  }, 120000);
});

describe.skip('E2E: Agent Communication', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should generate A2A messages during mission', async () => {
    const missionId = `test-a2a-${Date.now()}`;

    const finalState = await runMission(missionId, 'A2A test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    expect(finalState.messages.length).toBeGreaterThan(0);
    
    const messageTypes = finalState.messages.map(m => m.type);
    expect(messageTypes).toContain('MISSION_START');
  }, 120000);
});

describe.skip('E2E: Reconnaissance Flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should perform reconnaissance on live target', async () => {
    const missionId = `test-recon-${Date.now()}`;

    const finalState = await runMission(missionId, 'Recon test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    expect(Array.isArray(finalState.recon_results)).toBe(true);
  }, 120000);

  it('should handle static analysis for repo target', async () => {
    const missionId = `test-static-${Date.now()}`;

    const finalState = await runMission(missionId, 'Static test', 'github.com/test/repo', {
      maxIterations: 1,
    });

    expect(finalState.mode).toBe('static');
    expect(finalState.phase).toBeDefined();
  }, 120000);
});

describe.skip('E2E: Exploitation Flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should attempt exploits during exploitation phase', async () => {
    const missionId = `test-exploit-${Date.now()}`;

    const finalState = await runMission(missionId, 'Exploit test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    expect(Array.isArray(finalState.exploit_results)).toBe(true);
  }, 120000);
});

describe.skip('E2E: Error Handling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should continue mission even with errors', async () => {
    const missionId = `test-errors-${Date.now()}`;

    const finalState = await runMission(missionId, 'Error handling test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    expect(finalState).toBeDefined();
    expect(finalState.errors).toBeDefined();
  }, 120000);
});

describe.skip('E2E: Report Generation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisBus.connect();
  });

  afterEach(async () => {
    await redisBus.disconnect();
  });

  it('should generate report on mission completion', async () => {
    const missionId = `test-report-${Date.now()}`;

    const finalState = await runMission(missionId, 'Report test', 'http://localhost:3000', {
      maxIterations: 1,
    });

    if (finalState.phase === 'complete') {
      expect(finalState.report).toBeDefined();
    }
  }, 120000);
});
