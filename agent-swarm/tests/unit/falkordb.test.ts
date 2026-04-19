import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FalkorDBClient } from '../../src/infra/falkordb';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

describe('FalkorDBClient', () => {
  let client: FalkorDBClient;
  
  beforeAll(async () => {
    client = new FalkorDBClient({
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
      password: FALKORDB_PASSWORD,
    });
    await client.connect();
    
    // Clean up any existing test nodes
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:TestNode) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (m:Mission) DETACH DELETE m');
  });
  
  afterAll(async () => {
    // Clean up
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:TestNode) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (m:Mission) DETACH DELETE m');
    await client.close();
  });

  it('should connect to FalkorDB', async () => {
    const pong = await client.ping();
    expect(pong).toBe(true);
  });

  it('should create and retrieve a node', async () => {
    const testId = `test-${Date.now()}`;
    
    const node = await client.createNode('TestNode', testId, {
      name: 'Test Target',
      base_url: 'http://localhost:3000',
    });
    
    expect(node.id).toBe(testId);
    expect(node.name).toBe('Test Target');
    
    const retrieved = await client.findNodeById(testId);
    expect(retrieved?.name).toBe('Test Target');
  });

  it('should update a node', async () => {
    const testId = `test-update-${Date.now()}`;
    
    await client.createNode('TestNode', testId, { name: 'Original' });
    const updated = await client.updateNode(testId, { name: 'Updated' });
    expect(updated?.name).toBe('Updated');
  });

  it('should query nodes by label', async () => {
    const testId1 = `test-query1-${Date.now()}`;
    const testId2 = `test-query2-${Date.now()}`;
    
    await client.createNode('TestNode', testId1, { name: 'Test 1' });
    await client.createNode('TestNode', testId2, { name: 'Test 2' });
    
    const nodes = await client.findNodesByLabel('TestNode');
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('should query nodes by filter', async () => {
    const testId = `test-filter-${Date.now()}`;
    await client.createNode('TestNode', testId, { name: 'Filter Test', status: 'active' });
    
    const nodes = await client.findNodesByLabel('TestNode', { status: 'active' });
    expect(nodes.some(n => n.id === testId)).toBe(true);
  });

  it('should create and find edges', async () => {
    const fromId = `test-from-${Date.now()}`;
    const toId = `test-to-${Date.now()}`;
    
    await client.createNode('TestNode', fromId, { name: 'From' });
    await client.createNode('TestNode', toId, { name: 'To' });
    
    await client.createEdge(fromId, toId, 'PART_OF');
    
    const edges = await client.findEdges(fromId);
    expect(edges).toContain(toId);
  });

  it('should use Redis KV operations', async () => {
    const key = `test-kv-${Date.now()}`;
    const value = { foo: 'bar', count: 42 };
    
    await client.setKV(key, value, 60);
    const retrieved = await client.getKV<typeof value>(key);
    expect(retrieved).toEqual(value);
    
    await client.delKV(key);
    const deleted = await client.getKV(key);
    expect(deleted).toBeNull();
  });

  it('should claim a mission', async () => {
    // Create a queued mission
    const missionId = `mission:test-${Date.now()}`;
    await client.createNode('Mission', missionId, {
      executor: 'gamma',
      exploit_type: 'test',
      status: 'queued',
      verified: true,
      authorized: true,
      priority: 'high',
      created_at: Date.now(),
    });
    
    // Claim it
    const claimedId = await client.claimMission('gamma', 'gamma-1');
    expect(claimedId).toBe(missionId);
    
    // Verify it's no longer available
    const claimedAgain = await client.claimMission('gamma', 'gamma-2');
    expect(claimedAgain).toBeNull();
  });
});
