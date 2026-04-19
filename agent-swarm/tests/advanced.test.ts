/**
 * Advanced Nodes Test (Phase 2+)
 * Tests WafDuel, GammaHandoff, BeliefNode, SpecialistConfig
 * 
 * Usage: bun run tests/advanced.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FalkorDBClient } from '../src/infra/falkordb';
import {
  BeliefNodeSchema,
  GammaHandoffNodeSchema,
  WafDuelNodeSchema,
  SpecialistConfigNodeSchema,
  ExploitBriefNodeSchema,
  CrossEngagementLessonNodeSchema,
} from '../src/graph/schema';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

describe('Advanced Phase 2 Nodes', () => {
  let client: FalkorDBClient;

  beforeAll(async () => {
    client = new FalkorDBClient({
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
      password: FALKORDB_PASSWORD,
    });
    await client.connect();
  });

  afterAll(async () => {
    await cleanupNodes(client);
    await client.close();
  });

  beforeEach(async () => {
    await cleanupNodes(client);
  });

  async function cleanupNodes(c: FalkorDBClient) {
    const prefixes = ['belief/', 'gamma_handoff/', 'waf_duel/', 'specialist/', 'intel/brief:', 'cross_lesson/'];
    for (const prefix of prefixes) {
      try {
        await c.raw().call(
          'GRAPH.QUERY', 'solaris',
          `MATCH (n) WHERE n.id STARTS WITH '${prefix}' DETACH DELETE n`
        );
      } catch {}
    }
    try {
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Belief) DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:GammaHandoff) DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:WafDuel) DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:SpecialistConfig) DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Intel) DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:CrossEngagementLesson) DETACH DELETE n');
    } catch {}
  }

  describe('BeliefNodeSchema', () => {
    it('should validate a valid belief node', () => {
      const belief = {
        id: 'belief/endpoint:login:sql_injection',
        type: 'belief' as const,
        endpoint_id: 'endpoint:POST-/api/login',
        vuln_class: 'sql_injection',
        p_vulnerable: 0.7,
        p_protected: 0.2,
        p_exploitable: 0.56,
        evidence_log: [
          {
            timestamp: Date.now(),
            mission_id: 'mission:test-001',
            action: 'probe' as const,
            response: 'HTTP 500',
            delta_p_v: 0.1,
            delta_p_p: 0.05,
          },
        ],
        last_updated: Date.now(),
      };

      const result = BeliefNodeSchema.safeParse(belief);
      expect(result.success).toBe(true);
    });

    it('should reject invalid probability values', () => {
      const belief = {
        id: 'belief/test',
        type: 'belief' as const,
        endpoint_id: 'endpoint:test',
        vuln_class: 'test',
        p_vulnerable: 1.5, // Invalid: > 1
        p_protected: -0.1, // Invalid: < 0
        p_exploitable: 0.5,
        evidence_log: [],
        last_updated: Date.now(),
      };

      const result = BeliefNodeSchema.safeParse(belief);
      expect(result.success).toBe(false);
    });

    it('should validate evidence log entries', () => {
      const belief = {
        id: 'belief/test-evidence',
        type: 'belief' as const,
        endpoint_id: 'endpoint:test',
        vuln_class: 'test',
        p_vulnerable: 0.5,
        p_protected: 0.3,
        p_exploitable: 0.35,
        evidence_log: [
          {
            timestamp: Date.now(),
            mission_id: 'mission:test-001',
            action: 'exploit_success' as const,
            response: 'HTTP 200 - Data extracted',
            delta_p_v: 0.4,
            delta_p_p: 0,
          },
          {
            timestamp: Date.now() + 1000,
            mission_id: 'mission:test-002',
            action: 'waf_block' as const,
            response: 'HTTP 403 - WAF Blocked',
            delta_p_v: 0,
            delta_p_p: 0.3,
          },
        ],
        last_updated: Date.now(),
      };

      const result = BeliefNodeSchema.safeParse(belief);
      expect(result.success).toBe(true);
    });
  });

  describe('GammaHandoffNodeSchema', () => {
    it('should validate a valid gamma handoff', () => {
      const handoff = {
        id: 'gamma_handoff/test-handoff-001',
        type: 'gamma_handoff' as const,
        mission_id: 'mission:test-001',
        from_instance: 'gamma-1',
        to_instance: 'gamma-2',
        hypothesis: 'WAF is blocking on keyword UNION',
        confirmed_facts: [
          'HTTP 403 on UNION SELECT',
          'HTTP 200 on basic auth probe',
        ],
        failed_payloads: [
          {
            payload: 'UNION SELECT NULL--',
            response_snippet: '403 Forbidden',
            waf_triggered: true,
          },
        ],
        next_action: 'Try time-based blind SQLi',
        context_budget: 3,
        written_at: Date.now(),
        consumed_at: Date.now() + 5000,
      };

      const result = GammaHandoffNodeSchema.safeParse(handoff);
      expect(result.success).toBe(true);
    });

    it('should validate handoff without to_instance (unclaimed)', () => {
      const handoff = {
        id: 'gamma_handoff/test-handoff-002',
        type: 'gamma_handoff' as const,
        mission_id: 'mission:test-001',
        from_instance: 'gamma-1',
        to_instance: undefined,
        hypothesis: 'Trying different encoding',
        confirmed_facts: [],
        failed_payloads: [],
        next_action: 'Base64 encode payload',
        context_budget: 5,
        written_at: Date.now(),
      };

      const result = GammaHandoffNodeSchema.safeParse(handoff);
      expect(result.success).toBe(true);
    });
  });

  describe('WafDuelNodeSchema', () => {
    it('should validate a valid WAF duel', () => {
      const duel = {
        id: 'waf_duel/test-duel-001',
        type: 'waf_duel' as const,
        mission_id: 'mission:test-001',
        waf_model: 'Cloudflare SQL Injection Detection',
        bypass_candidates: [
          {
            payload: "admin'/**/OR/**/1=1--",
            bypass_hypothesis: 'Comments to bypass keyword filters',
            result: 'success' as const,
          },
          {
            payload: 'UNION SELECT NULL,NULL,NULL--',
            bypass_hypothesis: 'Null-based union injection',
            result: 'failed' as const,
          },
        ],
        status: 'active' as const,
        created_at: Date.now(),
      };

      const result = WafDuelNodeSchema.safeParse(duel);
      expect(result.success).toBe(true);
    });

    it('should allow bypass candidates without result (pending)', () => {
      const duel = {
        id: 'waf_duel/test-duel-002',
        type: 'waf_duel' as const,
        mission_id: 'mission:test-001',
        waf_model: 'AWS WAF',
        bypass_candidates: [
          {
            payload: 'test',
            bypass_hypothesis: 'Initial probe',
            result: undefined,
          },
        ],
        status: 'active' as const,
        created_at: Date.now(),
      };

      const result = WafDuelNodeSchema.safeParse(duel);
      expect(result.success).toBe(true);
    });
  });

  describe('SpecialistConfigNodeSchema', () => {
    it('should validate a valid specialist config', () => {
      const specialist = {
        id: 'specialists/specialist:graphql:gamma-1',
        type: 'specialist_config' as const,
        surface_type: 'GraphQL Endpoint',
        parent_mission: 'mission:test-001',
        system_prompt: 'You are a GraphQL security specialist...',
        mission_template: {
          id: 'mission:graphql-test',
          type: 'mission' as const,
          executor: 'gamma' as const,
          exploit_type: 'graphql_introspection',
          escalation_level: 'baseline' as const,
          priority: 'high' as const,
          target_endpoint: 'endpoint:POST-/graphql',
          context_nodes: [],
          credential_nodes: [],
          depends_on: [],
          status: 'pending_verification' as const,
          authorized: false,
          verified: false,
          attempt_count: 0,
          created_by: 'mission_planner' as const,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        spawn_condition: 'GraphQL endpoint discovered',
        despawn_trigger: 'Mission queue empty for 5 minutes',
        created_at: Date.now(),
        status: 'active' as const,
      };

      const result = SpecialistConfigNodeSchema.safeParse(specialist);
      expect(result.success).toBe(true);
    });
  });

  describe('ExploitBriefNodeSchema', () => {
    it('should validate a valid exploit brief', () => {
      const brief = {
        id: 'intel/brief:mission:sqli-login-003',
        type: 'intel' as const,
        subtype: 'exploit_brief' as const,
        mission_id: 'mission:sqli-login-003',
        exploit_type: 'sql_injection',
        target_component: 'express@4.18',
        technique_summary: 'SQL Injection in login form via UNION-based extraction',
        working_examples: [
          {
            source: 'PayloadsAllTheThings',
            payload: "admin' UNION SELECT NULL,NULL,NULL--",
            context: 'Works when column count is known',
          },
          {
            source: 'HackTricks',
            payload: "admin' OR 1=1--",
            context: 'Basic bypass for authentication',
          },
        ],
        known_waf_bypasses: [
          'Comment-based filters: /**/',
          'Case variation: UniOn SeLeCt',
        ],
        common_failures: [
          'Column count mismatch',
          'WAF blocking on UNION keyword',
        ],
        lesson_refs: ['lessons/lesson:sqli-waf-bypass-001'],
        osint_confidence: 'high' as const,
      };

      const result = ExploitBriefNodeSchema.safeParse(brief);
      expect(result.success).toBe(true);
    });
  });

  describe('CrossEngagementLessonNodeSchema', () => {
    it('should validate a cross-engagement lesson', () => {
      const lesson = {
        id: 'cross_lesson:sqli-nodejs-001',
        type: 'cross_engagement_lesson' as const,
        stack_fingerprint: {
          framework: ['express', 'nodejs'],
          auth_type: 'jwt' as const,
          db_hints: ['postgresql', 'sequelize'],
          server: 'express',
        },
        engagement_id: 'eng-2025-q1-001',
        target_class: 'REST API',
        exploit_type: 'sql_injection',
        failure_class: 'waf_blocked',
        successful_payload: "admin' UNION SELECT NULL,NULL--",
        delta: 'WAF was blocking on UNION keyword, worked after adding comments',
        reusable: true,
        tags: ['sqli', 'waf-bypass', 'postgresql'],
        created_at: Date.now(),
      };

      const result = CrossEngagementLessonNodeSchema.safeParse(lesson);
      expect(result.success).toBe(true);
    });

    it('should validate without optional fields', () => {
      const lesson = {
        id: 'cross_lesson:idor-react-001',
        type: 'cross_engagement_lesson' as const,
        stack_fingerprint: {
          framework: ['react', 'nodejs'],
          auth_type: 'session' as const,
          db_hints: ['mongodb'],
        },
        engagement_id: 'eng-2025-q1-002',
        target_class: 'SPA',
        exploit_type: 'idor',
        reusable: false,
        tags: ['idor', 'auth-bypass'],
        created_at: Date.now(),
      };

      const result = CrossEngagementLessonNodeSchema.safeParse(lesson);
      expect(result.success).toBe(true);
    });
  });

  describe('FalkorDB CRUD for Advanced Nodes', () => {
    it('should create and retrieve a BeliefNode', async () => {
      const beliefId = 'belief/endpoint:login:xss';
      const belief = {
        id: beliefId,
        type: 'belief',
        endpoint_id: 'endpoint:POST-/api/login',
        vuln_class: 'xss',
        p_vulnerable: 0.6,
        p_protected: 0.1,
        p_exploitable: 0.54,
        evidence_log: [],
        last_updated: Date.now(),
      };

      await client.createNode('Belief', beliefId, belief);
      const retrieved = await client.findNodeById(beliefId);

      expect(retrieved).toBeTruthy();
      expect((retrieved as any)?.vuln_class).toBe('xss');
      expect((retrieved as any)?.p_vulnerable).toBe(0.6);
    });

    it('should create and retrieve a WafDuelNode', async () => {
      const duelId = 'waf_duel:mission:xss-001';
      const duel = {
        id: duelId,
        type: 'waf_duel',
        mission_id: 'mission:xss-001',
        waf_model: 'TestWAF',
        bypass_candidates: [],
        status: 'active',
        created_at: Date.now(),
      };

      await client.createNode('WafDuel', duelId, duel);
      const retrieved = await client.findNodeById(duelId);

      expect(retrieved).toBeTruthy();
      expect((retrieved as any)?.waf_model).toBe('TestWAF');
      expect((retrieved as any)?.status).toBe('active');
    });

    it('should create and retrieve a GammaHandoffNode', async () => {
      const handoffId = 'gamma_handoff:mission:test-handoff';
      const handoff = {
        id: handoffId,
        type: 'gamma_handoff',
        mission_id: 'mission:test',
        from_instance: 'gamma-1',
        hypothesis: 'Test hypothesis',
        confirmed_facts: [],
        failed_payloads: [],
        next_action: 'Continue testing',
        context_budget: 5,
        written_at: Date.now(),
      };

      await client.createNode('GammaHandoff', handoffId, handoff);
      const retrieved = await client.findNodeById(handoffId);

      expect(retrieved).toBeTruthy();
      expect((retrieved as any)?.from_instance).toBe('gamma-1');
      expect((retrieved as any)?.context_budget).toBe(5);
    });

    it('should create and retrieve a CrossEngagementLessonNode', async () => {
      const lessonId = 'cross_lesson:sqli-express-001';
      const lesson = {
        id: lessonId,
        type: 'cross_engagement_lesson',
        stack_fingerprint: {
          framework: ['express'],
          auth_type: 'jwt',
          db_hints: ['postgresql'],
        },
        engagement_id: 'eng-001',
        target_class: 'API',
        exploit_type: 'sql_injection',
        reusable: true,
        tags: ['sqli'],
        created_at: Date.now(),
      };

      await client.createNode('CrossEngagementLesson', lessonId, lesson);
      const retrieved = await client.findNodeById(lessonId);

      expect(retrieved).toBeTruthy();
      expect((retrieved as any)?.exploit_type).toBe('sql_injection');
      expect((retrieved as any)?.reusable).toBe(true);
    });
  });
});
