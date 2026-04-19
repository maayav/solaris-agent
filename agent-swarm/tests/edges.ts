/**
 * Edge Coverage Test
 * Verifies all edge types work correctly
 * 
 * Usage: bun run tests/edges.test.ts
 */

import { FalkorDBClient } from '../src/infra/falkordb';
import { EdgeType } from '../src/graph/edges';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

async function cleanupAll(client: FalkorDBClient) {
  try {
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n) DETACH DELETE n');
  } catch {}
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       Edge Coverage Test                            ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const client = new FalkorDBClient({
    host: FALKORDB_HOST,
    port: FALKORDB_PORT,
    password: FALKORDB_PASSWORD,
  });

  await client.connect();
  console.log('✓ Connected to FalkorDB\n');

  await cleanupAll(client);

  const tests: { name: string; edgeType: string; fromId: string; toId: string; createEdge: () => Promise<void>; verifyEdge: () => Promise<boolean> }[] = [];

  // Setup nodes for testing
  const targetId = 'target:test';
  await client.createNode('Target', targetId, { id: targetId, name: 'Test', base_url: 'http://test.com', status: 'active', created_at: Date.now() });

  const endpointId = 'recon/endpoint:GET-/api/test';
  await client.createNode('Endpoint', endpointId, { id: endpointId, method: 'GET', path: '/api/test', url: 'http://test.com/api/test', discovered_by: 'test', created_at: Date.now() });

  const vulnId = 'recon/vuln:test-vuln';
  await client.createNode('Vulnerability', vulnId, { id: vulnId, vuln_class: 'test', created_at: Date.now() });

  const credId = 'bridge/cred:test-cred';
  await client.createNode('Credential', credId, { id: credId, cred_type: 'bearer', value: 'test', scope: [], validation_status: 'pending', created_by: 'test', created_at: Date.now() });

  const missionId = 'gamma/mission:test-001';
  await client.createNode('Mission', missionId, { 
    id: missionId, 
    executor: 'gamma', 
    exploit_type: 'test', 
    target_endpoint: endpointId,
    status: 'queued',
    priority: 'high',
    context_nodes: [],
    credential_nodes: [],
    depends_on: [],
    verified: true,
    authorized: true,
    attempt_count: 0,
    created_by: 'test',
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const intelId = 'intel/payload:test';
  await client.createNode('Intel', intelId, { id: intelId, subtype: 'payload_library', name: 'Test', data: {}, created_at: Date.now(), updated_at: Date.now() });

  const lessonId = 'lessons/lesson:test-001';
  await client.createNode('Lesson', lessonId, { 
    id: lessonId, 
    mission_id: missionId,
    exploit_type: 'test',
    failure_class: 'waf_blocked',
    failed_payloads: [],
    reusable: true,
    tags: ['test'],
    created_at: Date.now()
  });

  const chainId = 'chain:test-001';
  await client.createNode('Chain', chainId, { 
    id: chainId,
    name: 'Test Chain',
    chain_type: 'credential_abuse',
    steps: [],
    status: 'active',
    created_by: 'test',
    created_at: Date.now()
  });

  const exploitId = 'gamma/exploit:test-001';
  await client.createNode('Exploit', exploitId, { 
    id: exploitId,
    mission_id: missionId,
    exploit_type: 'test',
    payload: 'test',
    target_endpoint: endpointId,
    success: true,
    executed_by: 'gamma-1',
    executed_at: Date.now()
  });

  const artifactId = 'gamma/artifact:test-file';
  await client.createNode('Artifact', artifactId, { 
    id: artifactId,
    subtype: 'file',
    name: 'test.txt',
    discovered_by: 'test',
    discovered_at: Date.now()
  });

  const failedMissionId = 'lessons/failed:test-001';
  await client.createNode('FailedMission', failedMissionId, { 
    id: failedMissionId,
    mission_id: missionId,
    exploit_type: 'test',
    failure_class: 'test',
    evidence: {},
    final_outcome: 'needs_manual_review',
    created_at: Date.now()
  });

  // Missing nodes that are referenced in edge tests
  const userId = 'user:test';
  await client.createNode('User', userId, { 
    id: userId, 
    email: 'test@test.com', 
    role: 'user', 
    discovered_by: 'test', 
    discovered_at: Date.now() 
  });

  const componentId = 'component:test';
  await client.createNode('Component', componentId, { 
    id: componentId, 
    name: 'test-component', 
    version: '1.0', 
    discovered_at: Date.now() 
  });

  const specialistId = 'specialist:test';
  await client.createNode('SpecialistConfig', specialistId, { 
    id: specialistId, 
    surface_type: 'test', 
    parent_mission: missionId, 
    system_prompt: 'test', 
    spawn_condition: 'test', 
    despawn_trigger: 'test', 
    created_at: Date.now(),
    status: 'active'
  });

  const beliefId = 'belief:test';
  await client.createNode('Belief', beliefId, { 
    id: beliefId, 
    endpoint_id: endpointId, 
    vuln_class: 'test', 
    p_vulnerable: 0.5, 
    p_protected: 0.3, 
    p_exploitable: 0.35, 
    evidence_log: [], 
    last_updated: Date.now() 
  });

  const agentId = 'agent:test';
  await client.createNode('Agent', agentId, { 
    id: agentId, 
    type: 'gamma', 
    status: 'active' 
  });

  console.log('✓ Created test nodes\n');
  console.log('─'.repeat(50));
  console.log('Testing edge types...\n');

  const results: { edgeType: string; passed: boolean; error?: string }[] = [];

  // Test each edge type
  const edgeTests = [
    { edgeType: EdgeType.PART_OF, fromId: endpointId, toId: targetId },
    { edgeType: EdgeType.DEPENDS_ON, fromId: missionId, toId: missionId }, // self-referential for testing
    { edgeType: EdgeType.UNLOCKS, fromId: credId, toId: endpointId },
    { edgeType: EdgeType.AUTHENTICATED_VIA, fromId: userId, toId: exploitId },
    { edgeType: EdgeType.HAS_CREDENTIAL, fromId: missionId, toId: credId },
    { edgeType: EdgeType.FOUND_AT, fromId: exploitId, toId: endpointId },
    { edgeType: EdgeType.LED_TO, fromId: exploitId, toId: artifactId },
    { edgeType: EdgeType.EXPLOITS, fromId: missionId, toId: vulnId },
    { edgeType: EdgeType.EXTRACTED_FROM, fromId: credId, toId: exploitId },
    { edgeType: EdgeType.CHAINS_INTO, fromId: exploitId, toId: chainId },
    { edgeType: EdgeType.NEXT_IN_CHAIN, fromId: missionId, toId: missionId },
    { edgeType: EdgeType.ENRICHES, fromId: intelId, toId: vulnId },
    { edgeType: EdgeType.IMPERSONATES, fromId: credId, toId: userId },
    { edgeType: EdgeType.ESCALATES_TO, fromId: credId, toId: credId },
    { edgeType: EdgeType.FAILED_WITH, fromId: missionId, toId: failedMissionId },
    { edgeType: EdgeType.RESOLVED_BY, fromId: failedMissionId, toId: lessonId },
    { edgeType: EdgeType.AFFECTS, fromId: vulnId, toId: componentId },
    { edgeType: EdgeType.LINKED_TO, fromId: intelId, toId: intelId },
    { edgeType: EdgeType.BRIEF_FOR, fromId: intelId, toId: missionId },
    { edgeType: EdgeType.SPECIALIZES, fromId: specialistId, toId: missionId },
    { edgeType: EdgeType.BELIEF_EVIDENCE, fromId: beliefId, toId: beliefId },
    { edgeType: EdgeType.CLAIMED_BY, fromId: missionId, toId: agentId },
  ];

  for (const test of edgeTests) {
    try {
      await client.createEdge(test.fromId, test.toId, test.edgeType);
      const found = await client.findEdges(test.fromId, test.edgeType);
      const passed = found.includes(test.toId);
      
      results.push({ 
        edgeType: test.edgeType, 
        passed,
        error: passed ? undefined : `Edge not found after creation`
      });
      
      console.log(`  ${passed ? '✓' : '✗'} ${test.edgeType}`);
      if (!passed) {
        console.log(`      Expected toId: ${test.toId}`);
        console.log(`      Found: ${found}`);
      }
    } catch (err: any) {
      results.push({ 
        edgeType: test.edgeType, 
        passed: false, 
        error: err.message 
      });
      console.log(`  ✗ ${test.edgeType}: ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log('\nEdge Type Summary:\n');
  
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  
  console.log(`  Passed: ${passedCount}/${results.length}`);
  console.log(`  Failed: ${failedCount}/${results.length}`);
  
  if (failedCount > 0) {
    console.log('\nFailed edges:\n');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.edgeType}`);
      if (r.error) console.log(`    Error: ${r.error}`);
    }
  }

  // Test edge property storage
  console.log('\n' + '─'.repeat(50));
  console.log('\nTesting edge properties...\n');

  await client.createEdge(exploitId, artifactId, EdgeType.LED_TO, {
    extracted_value: 'admin_password_hash',
    timestamp: Date.now(),
  });

  const edgeProps = await client.findEdgeWithProps(exploitId, artifactId, EdgeType.LED_TO);
  
  if (edgeProps && typeof edgeProps === 'object' && Object.keys(edgeProps).length > 0) {
    console.log('  ✓ Edge properties stored and retrieved correctly');
    console.log(`    Properties: ${JSON.stringify(edgeProps)}`);
  } else {
    console.log('  ✗ Edge properties not found or empty');
    console.log(`    Raw result: ${JSON.stringify(edgeProps)}`);
  }

  // Test findEdges without edge type (all outgoing edges)
  console.log('\n' + '─'.repeat(50));
  console.log('\nTesting findEdges without edge type filter...\n');

  const allEdges = await client.findEdges(missionId);
  console.log(`  Found ${allEdges.length} outgoing edges from mission`);
  console.log(`  Edges: ${allEdges.join(', ')}`);
  
  if (allEdges.length >= 4) { // DEPENDS_ON (self), HAS_CREDENTIAL, EXPLOITS, FAILED_WITH
    console.log('  ✓ findEdges (unfiltered) works correctly');
  } else {
    console.log('  ✗ Unexpected edge count');
  }

  console.log('\n' + '─'.repeat(50));

  if (failedCount === 0) {
    console.log('\n✓ ALL EDGE TESTS PASSED');
  } else {
    console.log('\n✗ SOME EDGE TESTS FAILED');
    process.exitCode = 1;
  }

  await cleanupAll(client);
  await client.close();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║       Test Complete                                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
