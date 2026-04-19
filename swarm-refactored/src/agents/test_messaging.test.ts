import { describe, it, expect } from 'vitest';
import { createA2AMessage } from '../core/state.js';
import {
  TaskAssignmentSchema,
  IntelligenceReportSchema,
  ExploitResultSchema,
  A2AMessageSchema,
  ReconResultSchema,
  PhaseSchema,
  AgentRoleSchema,
  MessageTypeSchema,
  PrioritySchema,
  ExploitTypeSchema,
} from './schemas.js';

describe('TestA2AMessage', () => {
  describe('createA2AMessage', () => {
    it('should create a message with correct sender', () => {
      const msg = createA2AMessage('commander', 'agent_alpha', 'TASK_ASSIGNMENT', 'HIGH', {
        description: 'Scan target',
      });

      expect(msg.sender).toBe('commander');
    });

    it('should create a message with correct recipient', () => {
      const msg = createA2AMessage('agent_alpha', 'commander', 'INTELLIGENCE_REPORT', 'MEDIUM', {
        finding: 'Port 3000 open',
      });

      expect(msg.recipient).toBe('commander');
    });

    it('should create a message with correct type', () => {
      const msg = createA2AMessage('agent_gamma', 'commander', 'EXPLOIT_RESULT', 'CRITICAL', {
        success: true,
        exploit_type: 'sqli',
      });

      expect(msg.type).toBe('EXPLOIT_RESULT');
    });

    it('should auto-generate msg_id', () => {
      const msg = createA2AMessage('agent_alpha', 'commander', 'INTELLIGENCE_REPORT', 'HIGH', {});

      expect(msg.msg_id).toBeDefined();
      expect(typeof msg.msg_id).toBe('string');
      expect(msg.msg_id.length).toBeGreaterThan(0);
    });

    it('should set timestamp', () => {
      const msg = createA2AMessage('agent_alpha', 'commander', 'INTELLIGENCE_REPORT', 'HIGH', {});

      expect(msg.timestamp).toBeDefined();
      expect(typeof msg.timestamp).toBe('string');
    });

    it('should include payload', () => {
      const payload = { description: 'Test task' };
      const msg = createA2AMessage('commander', 'agent_alpha', 'TASK_ASSIGNMENT', 'HIGH', payload);

      expect(msg.payload).toEqual(payload);
    });

    it('should allow all as recipient', () => {
      const msg = createA2AMessage('commander', 'all', 'MISSION_START', 'HIGH', {});

      expect(msg.recipient).toBe('all');
    });
  });

  describe('A2AMessageSchema', () => {
    it('should validate a correct TASK_ASSIGNMENT message', () => {
      const msg = {
        msg_id: '123e4567-e89b-12d3-a456-426614174000',
        sender: 'commander',
        recipient: 'agent_alpha',
        type: 'TASK_ASSIGNMENT',
        priority: 'HIGH',
        payload: { description: 'Scan target' },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = A2AMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate INTELLIGENCE_REPORT message', () => {
      const msg = {
        msg_id: '123e4567-e89b-12d3-a456-426614174000',
        sender: 'agent_alpha',
        recipient: 'commander',
        type: 'INTELLIGENCE_REPORT',
        priority: 'MEDIUM',
        payload: { finding: 'Port 3000 open' },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = A2AMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate EXPLOIT_RESULT message', () => {
      const msg = {
        msg_id: '123e4567-e89b-12d3-a456-426614174000',
        sender: 'agent_gamma',
        recipient: 'commander',
        type: 'EXPLOIT_RESULT',
        priority: 'CRITICAL',
        payload: { success: true, exploit_type: 'sqli' },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = A2AMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate MISSION_START message', () => {
      const msg = {
        msg_id: '123e4567-e89b-12d3-a456-426614174000',
        sender: 'commander',
        recipient: 'all',
        type: 'MISSION_START',
        priority: 'HIGH',
        payload: { mission_id: 'test-123', objective: 'Test' },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = A2AMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject invalid sender role', () => {
      const msg = {
        msg_id: '123e4567-e89b-12d3-a456-426614174000',
        sender: 'invalid_agent',
        recipient: 'commander',
        type: 'INTELLIGENCE_REPORT',
        priority: 'MEDIUM',
        payload: {},
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      const result = A2AMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });
});

describe('TestPayloadSchemas', () => {
  describe('TaskAssignmentSchema', () => {
    it('should validate a correct task assignment', () => {
      const task = {
        agent: 'agent_alpha',
        description: 'Perform nmap scan',
        target: 'http://localhost:3000',
        tools_allowed: ['nmap', 'curl'],
        priority: 'HIGH',
        exploit_type: 'sqli',
      };

      const result = TaskAssignmentSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should reject task with missing required fields', () => {
      const task = {
        agent: 'agent_alpha',
      };

      const result = TaskAssignmentSchema.safeParse(task);
      expect(result.success).toBe(false);
    });

    it('should accept agent_gamma as valid agent', () => {
      const task = {
        agent: 'agent_gamma',
        description: 'SQL injection test',
        target: 'http://localhost:3000',
        tools_allowed: ['curl'],
        priority: 'HIGH',
        exploit_type: 'sqli',
      };

      const result = TaskAssignmentSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should reject invalid agent role', () => {
      const task = {
        agent: 'agent_beta',
        description: 'Test',
        target: 'http://localhost:3000',
        tools_allowed: ['curl'],
        priority: 'HIGH',
        exploit_type: 'sqli',
      };

      const result = TaskAssignmentSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });

  describe('IntelligenceReportSchema', () => {
    it('should validate a correct intelligence report', () => {
      const intel = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Port 3000 running Express',
        confidence: 0.95,
        evidence: 'nmap output: 3000/tcp open',
      };

      const result = IntelligenceReportSchema.safeParse(intel);
      expect(result.success).toBe(true);
    });

    it('should accept null cve_hint', () => {
      const intel = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Test finding',
        confidence: 0.8,
        evidence: 'test evidence',
        cve_hint: null,
      };

      const result = IntelligenceReportSchema.safeParse(intel);
      expect(result.success).toBe(true);
    });

    it('should reject confidence out of range (> 1)', () => {
      const intel = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Test',
        confidence: 1.5,
        evidence: 'test',
      };

      const result = IntelligenceReportSchema.safeParse(intel);
      expect(result.success).toBe(false);
    });

    it('should reject confidence out of range (< 0)', () => {
      const intel = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Test',
        confidence: -0.1,
        evidence: 'test',
      };

      const result = IntelligenceReportSchema.safeParse(intel);
      expect(result.success).toBe(false);
    });

    it('should accept confidence at boundaries (0 and 1)', () => {
      const intelLow = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Test',
        confidence: 0.0,
        evidence: 'test',
      };

      const intelHigh = {
        source: 'alpha_recon',
        asset: 'http://localhost:3000',
        finding: 'Test',
        confidence: 1.0,
        evidence: 'test',
      };

      expect(IntelligenceReportSchema.safeParse(intelLow).success).toBe(true);
      expect(IntelligenceReportSchema.safeParse(intelHigh).success).toBe(true);
    });
  });

  describe('ExploitResultSchema', () => {
    it('should validate a successful exploit result', () => {
      const result = {
        target: 'http://localhost:3000/rest/user/login',
        exploit_type: 'sqli',
        success: true,
        payload_used: "' OR 1=1--",
        evidence: 'SQL error message leaked',
        impact: 'Admin authentication bypass',
        execution_time: 0.5,
      };

      const parseResult = ExploitResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should validate a failed exploit result', () => {
      const result = {
        target: 'http://localhost:3000/login',
        exploit_type: 'sqli',
        success: false,
        payload_used: "' OR 1=1--",
        evidence: 'No SQL error detected',
        impact: 'N/A',
        execution_time: 0.3,
      };

      const parseResult = ExploitResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should accept valid exploit types', () => {
      const types = ['sqli', 'xss', 'idor', 'auth_bypass', 'info_disclosure', 'authentication'];

      types.forEach((type) => {
        const result = {
          target: 'http://localhost:3000',
          exploit_type: type,
          success: false,
          payload_used: 'test',
          evidence: 'test',
          impact: 'test',
          execution_time: 0.1,
        };

        expect(ExploitResultSchema.safeParse(result).success).toBe(true);
      });
    });

    it('should reject invalid exploit type', () => {
      const result = {
        target: 'http://localhost:3000',
        exploit_type: 'invalid_type',
        success: false,
        payload_used: 'test',
        evidence: 'test',
        impact: 'test',
        execution_time: 0.1,
      };

      const parseResult = ExploitResultSchema.safeParse(result);
      expect(parseResult.success).toBe(false);
    });
  });

  describe('ReconResultSchema', () => {
    it('should validate a correct recon result', () => {
      const result = {
        source: 'alpha_recon',
        title: 'SQL Injection Endpoint',
        confidence: 0.9,
        asset: 'http://localhost:3000/api/users',
        finding: 'Potential SQL injection in user endpoint',
        evidence: 'Error-based SQL detection',
      };

      const parseResult = ReconResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should accept blue_team_static_analysis as source', () => {
      const result = {
        source: 'blue_team_static_analysis',
        title: 'Blue Team Finding',
        confidence: 0.95,
        asset: 'http://localhost:3000',
        finding: 'Static analysis finding',
        evidence: 'Code analysis',
      };

      const parseResult = ReconResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = {
        source: 'alpha_recon',
      };

      const parseResult = ReconResultSchema.safeParse(result);
      expect(parseResult.success).toBe(false);
    });
  });
});

describe('TestEnumSchemas', () => {
  describe('AgentRoleSchema', () => {
    it('should validate valid agent roles', () => {
      const roles = ['commander', 'agent_alpha', 'agent_beta', 'agent_gamma', 'agent_critic'];
      roles.forEach((role) => {
        expect(AgentRoleSchema.safeParse(role).success).toBe(true);
      });
    });

    it('should reject invalid agent roles', () => {
      expect(AgentRoleSchema.safeParse('invalid').success).toBe(false);
    });
  });

  describe('MessageTypeSchema', () => {
    it('should validate valid message types', () => {
      const types = ['TASK_ASSIGNMENT', 'INTELLIGENCE_REPORT', 'EXPLOIT_RESULT', 'MISSION_START'];
      types.forEach((type) => {
        expect(MessageTypeSchema.safeParse(type).success).toBe(true);
      });
    });
  });

  describe('PrioritySchema', () => {
    it('should validate valid priorities', () => {
      const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      priorities.forEach((priority) => {
        expect(PrioritySchema.safeParse(priority).success).toBe(true);
      });
    });
  });

  describe('PhaseSchema', () => {
    it('should validate valid phases', () => {
      const phases = ['planning', 'recon', 'exploitation', 'reporting', 'complete'];
      phases.forEach((phase) => {
        expect(PhaseSchema.safeParse(phase).success).toBe(true);
      });
    });
  });

  describe('ExploitTypeSchema', () => {
    it('should validate valid exploit types', () => {
      const types = ['sqli', 'xss', 'idor', 'auth_bypass', 'info_disclosure', 'xxe', 'authentication'];
      types.forEach((type) => {
        expect(ExploitTypeSchema.safeParse(type).success).toBe(true);
      });
    });

    it('should reject network_scanning (not in enum)', () => {
      expect(ExploitTypeSchema.safeParse('network_scanning').success).toBe(false);
    });
  });
});
