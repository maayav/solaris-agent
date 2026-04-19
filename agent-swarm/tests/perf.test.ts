/**
 * Performance Test
 * Tests query speed and scalability
 * 
 * Usage: bun run tests/perf.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FalkorDBClient } from '../src/infra/falkordb';
import { getQueuedMissions, getActiveMissions } from '../src/graph/missions';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

describe('Performance Tests', () => {
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
    await cleanupTestNodes(client);
    await client.close();
  });

  async function cleanupTestNodes() {
    try {
      await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) WHERE n.id STARTS WITH "perf/" DETACH DELETE n');
      await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Mission) DETACH DELETE n');
    } catch {}
  }

  it('getQueuedMissions should be fast', async () => {
    // Create a few test missions
    for (let i = 0; i < 5; i++) {
      await client.createNode('Mission', `perf/mission-${i}-${Date.now()}`, {
        id: `perf/mission-${i}-${Date.now()}`,
        executor: 'gamma',
        exploit_type: `perf-test-${i}`,
        target_endpoint: 'endpoint:test',
        status: 'queued',
        priority: 'medium',
        context_nodes: [],
        credential_nodes: [],
        depends_on: [],
        verified: true,
        authorized: true,
        attempt_count: 0,
        created_by: 'perf-test',
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }

    const start = performance.now();
    const missions = await getQueuedMissions(client, 'gamma');
    const elapsed = performance.now() - start;

    console.log(`  getQueuedMissions took ${elapsed.toFixed(2)}ms for ${missions.length} missions`);

    // Should complete in under 50ms
    expect(elapsed).toBeLessThan(50);
  });

  it('getActiveMissions should be fast', async () => {
    const start = performance.now();
    const missions = await getActiveMissions(client, 'gamma');
    const elapsed = performance.now() - start;

    console.log(`  getActiveMissions took ${elapsed.toFixed(2)}ms for ${missions.length} missions`);

    expect(elapsed).toBeLessThan(50);
  });

  it('node creation should be fast', async () => {
    const nodeId = `perf/node-test-${Date.now()}`;
    const start = performance.now();
    
    await client.createNode('Endpoint', nodeId, {
      id: nodeId,
      method: 'GET',
      path: '/api/perf-test',
      url: 'http://test.com/api/perf-test',
      discovered_by: 'perf-test',
      created_at: Date.now(),
    });
    
    const elapsed = performance.now() - start;
    console.log(`  createNode took ${elapsed.toFixed(2)}ms`);

    expect(elapsed).toBeLessThan(100);
  });

  it('node retrieval by ID should be fast', async () => {
    const nodeId = `perf/retrieve-test-${Date.now()}`;
    
    await client.createNode('Endpoint', nodeId, {
      id: nodeId,
      method: 'GET',
      path: '/api/retrieve',
      url: 'http://test.com/api/retrieve',
      discovered_by: 'perf-test',
      created_at: Date.now(),
    });

    const start = performance.now();
    const node = await client.findNodeById(nodeId);
    const elapsed = performance.now() - start;

    console.log(`  findNodeById took ${elapsed.toFixed(2)}ms`);
    expect(node).toBeTruthy();
    expect(elapsed).toBeLessThan(50);
  });

  it('edge creation should be fast', async () => {
    const fromId = `perf/from-${Date.now()}`;
    const toId = `perf/to-${Date.now()}`;

    await client.createNode('Endpoint', fromId, { id: fromId, method: 'GET', path: '/from', url: 'http://test.com/from', discovered_by: 'perf', created_at: Date.now() });
    await client.createNode('Target', toId, { id: toId, name: 'Test', base_url: 'http://test.com', status: 'active', created_at: Date.now() });

    const start = performance.now();
    await client.createEdge(fromId, toId, 'PART_OF');
    const elapsed = performance.now() - start;

    console.log(`  createEdge took ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it('graph traversal should be fast', async () => {
    // Create a small chain: A -> B -> C -> D
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `perf/chain-${i}-${Date.now()}`;
      ids.push(id);
      await client.createNode('Endpoint', id, {
        id,
        method: 'GET',
        path: `/chain-${i}`,
        url: `http://test.com/chain-${i}`,
        discovered_by: 'perf',
        created_at: Date.now(),
      });
    }

    // Create chain edges
    await client.createEdge(ids[0], ids[1], 'FOUND_AT');
    await client.createEdge(ids[1], ids[2], 'FOUND_AT');
    await client.createEdge(ids[2], ids[3], 'FOUND_AT');

    const start = performance.now();
    const traversed = await client.traverse(ids[0], ['FOUND_AT'], 5);
    const elapsed = performance.now() - start;

    console.log(`  traverse (depth 5) took ${elapsed.toFixed(2)}ms, found ${traversed.length} nodes`);
    expect(traversed.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });

  it('getContext should be fast', async () => {
    const nodeId = `perf/context-test-${Date.now()}`;
    
    await client.createNode('Mission', nodeId, {
      id: nodeId,
      executor: 'gamma',
      exploit_type: 'perf-test',
      target_endpoint: 'endpoint:test',
      status: 'queued',
      priority: 'medium',
      context_nodes: [],
      credential_nodes: [],
      depends_on: [],
      verified: true,
      authorized: true,
      attempt_count: 0,
      created_by: 'perf-test',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const start = performance.now();
    const context = await client.getContext(nodeId, 2);
    const elapsed = performance.now() - start;

    console.log(`  getContext (depth 2) took ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it('should handle many concurrent operations', async () => {
    const numOperations = 20;
    const start = performance.now();

    const promises = Array.from({ length: numOperations }, async (_, i) => {
      const nodeId = `perf/concurrent-${i}-${Date.now()}`;
      return client.createNode('Endpoint', nodeId, {
        id: nodeId,
        method: 'GET',
        path: `/concurrent-${i}`,
        url: `http://test.com/concurrent-${i}`,
        discovered_by: 'perf',
        created_at: Date.now(),
      });
    });

    await Promise.all(promises);
    const elapsed = performance.now() - start;

    console.log(`  ${numOperations} concurrent creates took ${elapsed.toFixed(2)}ms (${(elapsed / numOperations).toFixed(2)}ms avg)`);
    
    // Should handle 20 concurrent creates in under 2 seconds
    expect(elapsed).toBeLessThan(2000);
  });
});
