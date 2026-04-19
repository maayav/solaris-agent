import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventBus } from '../../src/events/bus';
import { FalkorDBClient } from '../../src/infra/falkordb';
import { generateMissionId } from '../../src/utils/id';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

describe('Event Bus Integration', () => {
  let bus: EventBus;
  
  beforeAll(() => {
    bus = new EventBus(':memory:');
  });
  
  afterAll(() => {
    bus.close();
  });
  
  beforeEach(() => {
    bus.cleanup();
  });

  it('should emit and consume events', async () => {
    const eventId = await bus.emit('finding_written', { findingId: 'test-1', severity: 'high' }, 'verifier-1');
    expect(eventId).toBeDefined();
    
    const consumed = await bus.consume('verifier-1', ['finding_written']);
    expect(consumed.length).toBe(1);
    expect(consumed[0].type).toBe('finding_written');
    expect(consumed[0].payload.findingId).toBe('test-1');
  });
  
  it('should not consume same event twice', async () => {
    await bus.emit('mission_queued', { missionId: 'test-1' }, 'commander-1');
    
    const first = await bus.consume('gamma-1', ['mission_queued']);
    expect(first.length).toBe(1);
    
    const second = await bus.consume('gamma-2', ['mission_queued']);
    expect(second.length).toBe(0);
  });
  
  it('should get pending count', async () => {
    await bus.emit('finding_written', { test: 1 }, 'agent-1');
    await bus.emit('finding_written', { test: 2 }, 'agent-1');
    await bus.emit('credential_found', { test: 3 }, 'agent-1');
    
    const findingCount = await bus.getPendingCount(['finding_written']);
    expect(findingCount).toBe(2);
    
    const allCount = await bus.getPendingCount(['finding_written', 'credential_found']);
    expect(allCount).toBe(3);
  });
});

describe('FalkorDB + EventBus Integration', () => {
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
  });

  beforeEach(async () => {
    // Clean up before each test to ensure isolation
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:TestNode) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (m:Mission) DETACH DELETE m');
  });
  
  afterAll(async () => {
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:TestNode) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (m:Mission) DETACH DELETE m');
    await client.close();
    bus.close();
  });

  it('should create mission in FalkorDB and emit event', async () => {
    const missionId = generateMissionId('sql-injection');
    
    await client.createNode('Mission', missionId, {
      executor: 'gamma',
      exploit_type: 'sql-injection',
      status: 'queued',
      verified: true,
      authorized: true,
      priority: 'high',
    });
    
    const eventId = await bus.emit('mission_queued', { missionId }, 'commander-1');
    expect(eventId).toBeDefined();
    
    const pendingCount = await bus.getPendingCount(['mission_queued']);
    expect(pendingCount).toBeGreaterThanOrEqual(1);
    
    const mission = await client.findNodeById(missionId);
    expect(mission).toBeDefined();
    expect((mission as any)?.exploit_type).toBe('sql-injection');
  });
  
  it('should claim mission and update event consumption', async () => {
    const missionId = generateMissionId('xss');
    
    await client.createNode('Mission', missionId, {
      executor: 'gamma',
      exploit_type: 'xss',
      status: 'queued',
      verified: true,
      authorized: true,
      priority: 'medium',
    });
    
    await bus.emit('mission_queued', { missionId }, 'commander-1');
    
    const claimedId = await client.claimMission('gamma', 'gamma-1');
    expect(claimedId).toBe(missionId);
    
    const updatedMission = await client.findNodeById(missionId);
    expect((updatedMission as any)?.status).toBe('active');
    expect((updatedMission as any)?.claimed_by).toBe('gamma-1');
  });
});
