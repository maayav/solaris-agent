import { describe, it, expect, beforeEach } from 'vitest';
import type { RedTeamState, Phase } from '../types/index.js';
import { createInitialState, createEmptyBlackboard } from '../core/state.js';
import { detectTargetType } from '../agents/alpha-recon.js';
import { shouldContinue } from '../graph/langgraph.js';
import { isDestructivePayload, PHASE_1_TYPES, PHASE_2_TYPES } from './gamma-exploit.js';

describe('TestRedTeamState', () => {
  describe('createInitialState', () => {
    it('should create initial state with correct values', () => {
      const state = createInitialState('test-123', 'Test recon', 'http://localhost:3000');

      expect(state.mission_id).toBe('test-123');
      expect(state.objective).toBe('Test recon');
      expect(state.target).toBe('http://localhost:3000');
      expect(state.phase).toBe('planning');
      expect(state.iteration).toBe(0);
      expect(state.messages).toEqual([]);
      expect(state.recon_results).toEqual([]);
      expect(state.exploit_results).toEqual([]);
      expect(state.needs_human_approval).toBe(false);
      expect(state.reflection_count).toBe(0);
      expect(state.max_reflections).toBe(3);
      expect(state.pending_exploit).toBeNull();
    });

    it('should create initial state with custom max_iterations', () => {
      const state = createInitialState('test-456', 'Test', 'http://localhost:3000', {
        maxIterations: 3,
      });

      expect(state.max_iterations).toBe(3);
    });

    it('should create initial state with default max_iterations', () => {
      const state = createInitialState('test-789', 'Test', 'http://localhost:3000');

      expect(state.max_iterations).toBe(5);
    });

    it('should create initial state with default max_reflections', () => {
      const state = createInitialState('test-abc', 'Test', 'http://localhost:3000');

      expect(state.max_reflections).toBe(3);
    });

    it('should initialize messages as empty array', () => {
      const state = createInitialState('test-msg', 'Test', 'http://localhost:3000');

      expect(state.messages).toEqual([]);
      expect(Array.isArray(state.messages)).toBe(true);
    });

    it('should initialize recon_results as empty array', () => {
      const state = createInitialState('test-recon', 'Test', 'http://localhost:3000');

      expect(state.recon_results).toEqual([]);
      expect(Array.isArray(state.recon_results)).toBe(true);
    });

    it('should initialize exploit_results as empty array', () => {
      const state = createInitialState('test-exp', 'Test', 'http://localhost:3000');

      expect(state.exploit_results).toEqual([]);
      expect(Array.isArray(state.exploit_results)).toBe(true);
    });

    it('should set needs_human_approval to false', () => {
      const state = createInitialState('test-hitl', 'Test', 'http://localhost:3000');

      expect(state.needs_human_approval).toBe(false);
    });

    it('should set pending_exploit to null', () => {
      const state = createInitialState('test-pending', 'Test', 'http://localhost:3000');

      expect(state.pending_exploit).toBeNull();
    });
  });

  describe('createEmptyBlackboard', () => {
    it('should create empty blackboard with correct structure', () => {
      const blackboard = createEmptyBlackboard();

      expect(blackboard).toHaveProperty('successful_vectors');
      expect(blackboard).toHaveProperty('compromised_endpoints');
      expect(blackboard).toHaveProperty('stealth_mode');
      expect(blackboard).toHaveProperty('forbidden_endpoints');
      expect(blackboard).toHaveProperty('forbidden_until_iteration');
      expect(blackboard).toHaveProperty('last_analysis');
      expect(blackboard).toHaveProperty('current_strategy');
    });

    it('should initialize arrays correctly', () => {
      const blackboard = createEmptyBlackboard();

      expect(Array.isArray(blackboard.successful_vectors)).toBe(true);
      expect(Array.isArray(blackboard.compromised_endpoints)).toBe(true);
      expect(Array.isArray(blackboard.forbidden_endpoints)).toBe(true);
      expect(blackboard.successful_vectors).toEqual([]);
      expect(blackboard.compromised_endpoints).toEqual([]);
      expect(blackboard.forbidden_endpoints).toEqual([]);
    });

    it('should initialize stealth_mode to false', () => {
      const blackboard = createEmptyBlackboard();

      expect(blackboard.stealth_mode).toBe(false);
    });

    it('should initialize forbidden_until_iteration to 0', () => {
      const blackboard = createEmptyBlackboard();

      expect(blackboard.forbidden_until_iteration).toBe(0);
    });
  });
});

describe('TestRouting', () => {
  describe('shouldContinue', () => {
    it('should return report when phase is complete', () => {
      const state = createInitialState('test-complete', 'Test', 'http://localhost:3000');
      state.phase = 'complete';

      expect(shouldContinue(state)).toBe('report');
    });

    it('should return report when iteration equals max_iterations', () => {
      const state = createInitialState('test-max', 'Test', 'http://localhost:3000', {
        maxIterations: 3,
      });
      state.iteration = 3;

      expect(shouldContinue(state)).toBe('report');
    });

    it('should return exploit_only when phase is exploitation', () => {
      const state = createInitialState('test-exp', 'Test', 'http://localhost:3000');
      state.phase = 'exploitation';
      state.iteration = 1;

      expect(shouldContinue(state)).toBe('exploit_only');
    });

    it('should return continue when in recon phase', () => {
      const state = createInitialState('test-recon', 'Test', 'http://localhost:3000');
      state.phase = 'recon';
      state.iteration = 1;

      expect(shouldContinue(state)).toBe('continue');
    });

    it('should return continue when in planning phase', () => {
      const state = createInitialState('test-plan', 'Test', 'http://localhost:3000');
      state.phase = 'planning';
      state.iteration = 0;

      expect(shouldContinue(state)).toBe('continue');
    });
  });
});

describe('TestDetectTargetType', () => {
  describe('detectTargetType', () => {
    it('should return live for HTTP URLs', () => {
      expect(detectTargetType('http://localhost:3000')).toBe('live');
      expect(detectTargetType('https://example.com')).toBe('live');
      expect(detectTargetType('http://192.168.1.1:8080')).toBe('live');
    });

    it('should return static for GitHub URLs', () => {
      expect(detectTargetType('github.com/user/repo')).toBe('static');
      expect(detectTargetType('https://github.com/user/repo')).toBe('static');
      expect(detectTargetType('git@github.com:user/repo.git')).toBe('static');
    });

    it('should return static for local file paths', () => {
      expect(detectTargetType('/home/user/project')).toBe('static');
      expect(detectTargetType('./src')).toBe('static');
      expect(detectTargetType('../parent/path')).toBe('static');
    });

    it('should return static for Windows paths', () => {
      expect(detectTargetType('D:\\Projects\\myapp')).toBe('static');
      expect(detectTargetType('C:\\Users\\test')).toBe('static');
    });

    it('should return static for paths with repo indicators', () => {
      expect(detectTargetType('repo/src/index.ts')).toBe('static');
      expect(detectTargetType('/code/main.py')).toBe('static');
      expect(detectTargetType('project/.git/config')).toBe('static');
    });

    it('should return live for domain names without protocol', () => {
      expect(detectTargetType('example.com')).toBe('live');
      expect(detectTargetType('localhost')).toBe('live');
      expect(detectTargetType('subdomain.example.com')).toBe('live');
    });

    it('should return live as default for unknown targets', () => {
      expect(detectTargetType('some-random-string')).toBe('live');
      expect(detectTargetType('')).toBe('live');
    });

    it('should handle case insensitivity', () => {
      expect(detectTargetType('GITHUB.COM/USER/REPO')).toBe('static');
      expect(detectTargetType('HTTP://LOCALHOST:3000')).toBe('live');
    });

    it('should handle whitespace', () => {
      expect(detectTargetType('  github.com/user/repo  ')).toBe('static');
      expect(detectTargetType('  http://localhost:3000  ')).toBe('live');
    });
  });
});

describe('TestGammaExploit', () => {
  describe('isDestructivePayload', () => {
    it('should detect DROP TABLE as destructive', () => {
      expect(isDestructivePayload('DROP TABLE users;')).toBe(true);
      expect(isDestructivePayload('DROP DATABASE main;')).toBe(true);
    });

    it('should detect DELETE as destructive', () => {
      expect(isDestructivePayload('DELETE FROM users WHERE id=1')).toBe(true);
      expect(isDestructivePayload('DELETE * FROM customers')).toBe(true);
    });

    it('should detect TRUNCATE as destructive', () => {
      expect(isDestructivePayload('TRUNCATE TABLE orders')).toBe(true);
    });

    it('should detect UPDATE with destructive patterns', () => {
      expect(isDestructivePayload("UPDATE users SET password='hacked'")).toBe(true);
    });

    it('should detect INSERT with destructive patterns', () => {
      expect(isDestructivePayload("INSERT INTO admin VALUES ('hacker', 'pass')")).toBe(true);
    });

    it('should detect shell commands as destructive', () => {
      expect(isDestructivePayload('SHUTDOWN;')).toBe(true);
      expect(isDestructivePayload("EXEC xp_cmdshell('dir')")).toBe(true);
      expect(isDestructivePayload("eval('malicious code')")).toBe(true);
    });

    it('should detect filesystem destruction as destructive', () => {
      expect(isDestructivePayload('rm -rf /')).toBe(true);
      expect(isDestructivePayload('format c:')).toBe(true);
      expect(isDestructivePayload('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('should accept non-destructive payloads', () => {
      expect(isDestructivePayload("' OR 1=1 --")).toBe(false);
      expect(isDestructivePayload("<script>alert('xss')</script>")).toBe(false);
      expect(isDestructivePayload('/api/users/1')).toBe(false);
      expect(isDestructivePayload('GET /admin HTTP/1.1')).toBe(false);
    });

    it('should handle object payloads', () => {
      const payload = { sql: 'DROP TABLE users;' };
      expect(isDestructivePayload(payload)).toBe(true);
    });
  });

  describe('PHASE_1_TYPES', () => {
    it('should contain sqli', () => {
      expect(PHASE_1_TYPES).toContain('sqli');
    });

    it('should contain authentication', () => {
      expect(PHASE_1_TYPES).toContain('authentication');
    });

    it('should contain xss', () => {
      expect(PHASE_1_TYPES).toContain('xss');
    });

    it('should contain xxe', () => {
      expect(PHASE_1_TYPES).toContain('xxe');
    });

    it('should contain command_injection', () => {
      expect(PHASE_1_TYPES).toContain('command_injection');
    });
  });

  describe('PHASE_2_TYPES', () => {
    it('should contain idor', () => {
      expect(PHASE_2_TYPES).toContain('idor');
    });

    it('should contain auth_bypass', () => {
      expect(PHASE_2_TYPES).toContain('auth_bypass');
    });

    it('should contain broken_access_control', () => {
      expect(PHASE_2_TYPES).toContain('broken_access_control');
    });
  });
});

describe('TestPhaseTypes', () => {
  it('should allow valid phase values', () => {
    const phases: Phase[] = ['planning', 'recon', 'exploitation', 'complete'];
    
    phases.forEach((phase) => {
      const state = createInitialState('test-phase', 'Test phase', 'http://localhost:3000');
      state.phase = phase;
      expect(state.phase).toBe(phase);
    });
  });
});
