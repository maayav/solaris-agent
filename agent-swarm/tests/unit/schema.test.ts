import { describe, it, expect } from 'vitest';
import {
  TargetNodeSchema,
  EndpointNodeSchema,
  MissionNodeSchema,
  CredentialNodeSchema,
  FindingNodeSchema,
  IntelNodeSchema,
} from '../../src/graph/schema';
import { EdgeType } from '../../src/graph/edges';

describe('Graph Schemas', () => {
  describe('TargetNodeSchema', () => {
    it('should validate a valid target node', () => {
      const target = {
        id: 'target:api.example.com',
        type: 'target' as const,
        name: 'Example API',
        base_url: 'https://api.example.com',
        tech_stack: ['nodejs', 'express', 'postgresql'],
        scope: ['api.example.com'],
        out_of_scope: ['cdn.example.com'],
        status: 'active' as const,
        created_at: Date.now(),
        engagement_id: 'eng-001',
      };
      
      const result = TargetNodeSchema.safeParse(target);
      expect(result.success).toBe(true);
    });

    it('should reject invalid base_url', () => {
      const target = {
        id: 'target:bad',
        type: 'target' as const,
        name: 'Bad Target',
        base_url: 'not-a-url',
        tech_stack: [],
        scope: [],
        out_of_scope: [],
        status: 'active' as const,
        created_at: Date.now(),
        engagement_id: 'eng-001',
      };
      
      const result = TargetNodeSchema.safeParse(target);
      expect(result.success).toBe(false);
    });
  });

  describe('EndpointNodeSchema', () => {
    it('should validate a valid endpoint', () => {
      const endpoint = {
        id: 'endpoint:GET-/api/users',
        type: 'endpoint' as const,
        method: 'GET' as const,
        path: '/api/users',
        url: 'https://api.example.com/api/users',
        auth_required: true,
        discovered_by: 'alpha-recon',
        created_at: Date.now(),
      };
      
      const result = EndpointNodeSchema.safeParse(endpoint);
      expect(result.success).toBe(true);
    });

    it('should reject invalid HTTP method', () => {
      const endpoint = {
        id: 'endpoint:INVALID-/api',
        type: 'endpoint' as const,
        method: 'INVALID' as const,
        path: '/api',
        url: 'https://api.example.com/api',
        auth_required: false,
        discovered_by: 'test',
        created_at: Date.now(),
      };
      
      const result = EndpointNodeSchema.safeParse(endpoint);
      expect(result.success).toBe(false);
    });
  });

  describe('MissionNodeSchema', () => {
    it('should validate a valid mission', () => {
      const mission = {
        id: 'mission:sqli-001',
        type: 'mission' as const,
        executor: 'gamma' as const,
        exploit_type: 'sql_injection',
        escalation_level: 'baseline' as const,
        priority: 'high' as const,
        target_endpoint: 'endpoint:POST-/api/login',
        context_nodes: ['target:api.example.com'],
        credential_nodes: [],
        depends_on: [],
        status: 'pending_verification' as const,
        authorized: false,
        verified: false,
        attempt_count: 0,
        created_by: 'mission_planner' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      
      const result = MissionNodeSchema.safeParse(mission);
      expect(result.success).toBe(true);
    });

    it('should reject invalid executor', () => {
      const mission = {
        id: 'mission:bad-001',
        type: 'mission' as const,
        executor: 'invalid' as any,
        exploit_type: 'test',
        escalation_level: 'baseline' as const,
        priority: 'low' as const,
        target_endpoint: 'endpoint:GET-/api',
        context_nodes: [],
        credential_nodes: [],
        depends_on: [],
        status: 'queued' as const,
        authorized: true,
        verified: true,
        attempt_count: 0,
        created_by: 'mission_planner' as const,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      
      const result = MissionNodeSchema.safeParse(mission);
      expect(result.success).toBe(false);
    });
  });

  describe('CredentialNodeSchema', () => {
    it('should validate credential types', () => {
      const credTypes = ['bearer', 'cookie', 'api_key', 'basic_auth', 'jwt', 'session', 'password'] as const;
      
      for (const cred_type of credTypes) {
        const cred = {
          id: `cred:${cred_type}-001`,
          type: 'credential' as const,
          cred_type,
          value: 'secret-value',
          scope: ['api.example.com'],
          validation_status: 'pending' as const,
          created_at: Date.now(),
          created_by: 'alpha-recon',
        };
        
        const result = CredentialNodeSchema.safeParse(cred);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('IntelNodeSchema', () => {
    it('should validate intel subtypes', () => {
      const subtypes = [
        'payload_library', 'technique_doc', 'cve_detail', 'exploit_brief',
        'tactic', 'technique', 'privesc_vector', 'attack_pattern'
      ] as const;
      
      for (const subtype of subtypes) {
        const intel = {
          id: `intel:${subtype}-001`,
          type: 'intel' as const,
          subtype,
          name: `${subtype} Intel`,
          data: { source: 'test' },
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        
        const result = IntelNodeSchema.safeParse(intel);
        expect(result.success).toBe(true);
      }
    });
  });
});

describe('EdgeType', () => {
  it('should have all expected edge types', () => {
    expect(EdgeType.PART_OF).toBe('PART_OF');
    expect(EdgeType.DEPENDS_ON).toBe('DEPENDS_ON');
    expect(EdgeType.UNLOCKS).toBe('UNLOCKS');
    expect(EdgeType.HAS_CREDENTIAL).toBe('HAS_CREDENTIAL');
    expect(EdgeType.FOUND_AT).toBe('FOUND_AT');
    expect(EdgeType.LED_TO).toBe('LED_TO');
    expect(EdgeType.EXPLOITS).toBe('EXPLOITS');
    expect(EdgeType.CHAINS_INTO).toBe('CHAINS_INTO');
    expect(EdgeType.CLAIMED_BY).toBe('CLAIMED_BY');
  });
});
