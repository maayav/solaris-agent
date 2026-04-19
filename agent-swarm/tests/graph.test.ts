import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FalkorDBClient } from '../src/infra/falkordb';
import { EventBus } from '../src/events/bus';
import { queueMission, claimMission, completeMission } from '../src/graph/missions';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

describe('Graph Full Lifecycle', () => {
  let client: FalkorDBClient;
  let bus: EventBus;
  
  beforeAll(async () => {
    client = new FalkorDBClient({
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
      password: FALKORDB_PASSWORD,
    });
    await client.connect();
    bus = new EventBus(':memory:');
    
    // Clean up any existing test nodes
    await cleanupTestNodes(client);
  });
  
  afterAll(async () => {
    await cleanupTestNodes(client);
    await client.close();
    bus.close();
  });
  
  beforeEach(async () => {
    await cleanupTestNodes(client);
  });

  async function cleanupTestNodes(c: FalkorDBClient) {
    try {
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "recon/" DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "gamma/" DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "bridge/" DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "test-" DETACH DELETE n');
      await c.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "mission-" DETACH DELETE n');
    } catch {}
  }

  it('full lifecycle: recon → finding → mission → claim → complete', async () => {
    // 1. Create target
    const target = await client.createNode('Target', 'test-target-1', {
      name: 'Test Target',
      base_url: 'http://localhost:3000',
      tech_stack: ['nodejs'],
      scope: ['localhost:3000'],
      out_of_scope: [],
      status: 'active',
      engagement_id: 'test-engagement',
    });
    expect(target.id).toBe('test-target-1');

    // 2. Create endpoint in recon section
    const endpoint = await client.createNode('Endpoint', 'recon/endpoint:POST-/api/login', {
      id: 'recon/endpoint:POST-/api/login',
      type: 'endpoint',
      method: 'POST',
      path: '/api/login',
      url: 'http://localhost:3000/api/login',
      auth_required: false,
      discovered_by: 'alpha',
      created_at: Date.now(),
    });
    expect(endpoint.method).toBe('POST');

    // 3. Create edge from endpoint to target
    await client.createEdge('recon/endpoint:POST-/api/login', 'test-target-1', 'PART_OF');

    // 4. Emit finding_written event
    const eventId = await bus.emit('finding_written', { 
      findingId: 'recon/endpoint:POST-/api/login',
      severity: 'high'
    }, 'alpha');
    expect(eventId).toContain('evt:finding_written');

    // 5. Commander consumes finding_written → emits finding_validated
    const findingEvents = await bus.consume('commander', ['finding_written']);
    expect(findingEvents.length).toBe(1);
    
    // Verify event is marked as consumed
    const pendingAfterConsume = await bus.getPendingCount(['finding_written']);
    expect(pendingAfterConsume).toBe(0);

    // 6. Queue mission (Mission Planner would do this)
    const mission = await queueMission(client, {
      executor: 'gamma',
      exploit_type: 'sql_injection',
      escalation_level: 'baseline',
      priority: 'high',
      target_endpoint: 'recon/endpoint:POST-/api/login',
      context_nodes: ['test-target-1'],
      credential_nodes: [],
      depends_on: [],
      authorized: true,
      verified: true,
      attempt_count: 0,
      created_by: 'mission_planner',
    });
    expect(mission.id).toContain('mission:');
    expect(mission.status).toBe('pending_verification');

    // 7. Update mission to queued (after verification)
    await client.updateNode(mission.id, { status: 'queued' });

    // 8. Atomic claim by gamma
    const claimedId = await claimMission(client, 'gamma', 'gamma-1');
    expect(claimedId).toBeTruthy();

    // 9. Verify mission is active
    const activeMission = await client.findNodeById(claimedId!);
    expect((activeMission as any)?.status).toBe('active');
    expect((activeMission as any)?.claimed_by).toBe('gamma-1');

    // 10. Complete the mission
    await completeMission(client, claimedId!, { 
      success: true, 
      evidence: 'SQL injection successful, extracted admin table' 
    });

    // 11. Verify final state
    const finalMission = await client.findNodeById(claimedId!);
    expect((finalMission as any)?.status).toBe('completed');
  });

  it('should handle finding → validation → mission queue flow', async () => {
    // Create endpoint
    await client.createNode('Endpoint', 'recon/endpoint:GET-/api/users', {
      id: 'recon/endpoint:GET-/api/users',
      type: 'endpoint',
      method: 'GET',
      path: '/api/users',
      url: 'http://localhost:3000/api/users',
      auth_required: true,
      discovered_by: 'alpha',
      created_at: Date.now(),
    });

    // Emit finding_written
    await bus.emit('finding_written', { 
      endpointId: 'recon/endpoint:GET-/api/users',
      vuln_class: 'auth_bypass'
    }, 'alpha');

    // Verifier consumes and validates
    const events = await bus.consume('verifier', ['finding_written']);
    expect(events.length).toBe(1);

    // Verifier emits finding_validated
    await bus.emit('finding_validated', {
      endpointId: 'recon/endpoint:GET-/api/users',
      vuln_class: 'auth_bypass',
      validated: true
    }, 'verifier');

    // Queue mission
    const mission = await queueMission(client, {
      executor: 'gamma',
      exploit_type: 'auth_bypass',
      escalation_level: 'baseline',
      priority: 'critical',
      target_endpoint: 'recon/endpoint:GET-/api/users',
      context_nodes: [],
      credential_nodes: [],
      depends_on: [],
      authorized: true,
      verified: true,
      attempt_count: 0,
      created_by: 'mission_planner',
    });

    // Update to queued status (after verification/authorization in real flow)
    await client.updateNode(mission.id, { status: 'queued' });

    // Mission should be claimable
    const claimedId = await claimMission(client, 'gamma', 'gamma-1');
    expect(claimedId).toBeTruthy();
  });

  it('should track mission through pending → queued → active → completed states', async () => {
    // Create mission in pending_verification
    const mission = await queueMission(client, {
      executor: 'gamma',
      exploit_type: 'xss',
      escalation_level: 'baseline',
      priority: 'medium',
      target_endpoint: 'recon/endpoint:POST-/comment',
      context_nodes: [],
      credential_nodes: [],
      depends_on: [],
      authorized: false,
      verified: false,
      attempt_count: 0,
      created_by: 'mission_planner',
    });

    expect(mission.status).toBe('pending_verification');

    // Move to queued (after verification)
    await client.updateNode(mission.id, { 
      status: 'queued',
      verified: true,
      authorized: true,
    });

    // Claim
    const claimedId = await claimMission(client, 'gamma', 'gamma-1');
    expect(claimedId).toBe(mission.id);

    // Verify status changed to active
    const claimed = await client.findNodeById(mission.id);
    expect((claimed as any)?.status).toBe('active');

    // Complete
    await completeMission(client, mission.id, { success: false, evidence: 'WAF blocked' });
    
    const final = await client.findNodeById(mission.id);
    expect((final as any)?.status).toBe('failed');
  });
});
