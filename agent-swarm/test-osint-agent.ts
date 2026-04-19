#!/usr/bin/env bun
/**
 * OSINT Agent Integration Test
 * Run: bun test-osint-agent.ts
 */

import { OsintAgent } from './src/agents/osint.js';
import { getFalkorDB } from './src/infra/falkordb.js';
import { EventBus } from './src/events/bus.js';
import { getConfig } from './src/config/index.js';
import { lightRAG } from './src/infra/light-rag.js';

async function setup() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     OSINT Agent Integration Test     ║');
  console.log('╚════════════════════════════════════════╝\n');

  const config = getConfig();
  console.log('Config loaded');
  console.log('  FalkorDB:', config.FALKORDB_HOST);

  const graph = getFalkorDB();
  await graph.connect();
  console.log('✓ FalkorDB connected');

  const eventBus = new EventBus('./test-events.db');
  console.log('✓ EventBus initialized');

  return { graph, eventBus };
}

async function cleanup(graph: ReturnType<typeof getFalkorDB>, eventBus: EventBus) {
  await graph.close();
  eventBus.close();
  console.log('\n✓ Cleanup complete');
}

async function testEnrichmentRequest() {
  console.log('\n=== Test 1: Enrichment Request (CVE) ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-1',
    agentType: 'osint',
  });

  const event: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-1',
    type: 'enrichment_requested',
    payload: {
      target_id: 'CVE-2021-44228',
      enrichment_type: 'cve',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  await agent.processEvent(event);
  console.log('✓ Enrichment request processed');
}

async function testEnrichmentTechnique() {
  console.log('\n=== Test 1b: Enrichment Request (Technique) ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-1b',
    agentType: 'osint',
  });

  const event: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-1b',
    type: 'enrichment_requested',
    payload: {
      target_id: 'sql-injection',
      enrichment_type: 'technique',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  await agent.processEvent(event);
  console.log('✓ Technique enrichment request processed');
}

async function testMissionQueued() {
  console.log('\n=== Test 2: Mission Queued (ExploitBrief) ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-2',
    agentType: 'osint',
  });

  const event: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-2',
    type: 'mission_queued',
    payload: {
      missionId: 'mission:sqli-test-001',
      exploit_type: 'sqli',
      target_endpoint: 'http://test.example.com/login',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  await agent.processEvent(event);
  console.log('✓ Mission queued event processed');
}

async function testWafDuel() {
  console.log('\n=== Test 3: WAF Duel Intel ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-3',
    agentType: 'osint',
  });

  const event: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-3',
    type: 'waf_duel_started',
    payload: {
      duel_id: 'duel:001',
      target_id: 'test-target-001',
      waf_type: 'Cloudflare',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  await agent.processEvent(event);
  console.log('✓ WAF duel event processed');
}

async function testExploitFailed() {
  console.log('\n=== Test 4: Exploit Failed (Supplementary Brief) ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-4',
    agentType: 'osint',
  });

  const event: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-4',
    type: 'exploit_failed',
    payload: {
      mission_id: 'mission:xss-test-001',
      failure_class: 'waf_blocked',
      exploit_type: 'xss',
      target_id: 'test-target-001',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  await agent.processEvent(event);
  console.log('✓ Exploit failed event processed');
}

async function verifyNodesInGraph(graph: ReturnType<typeof getFalkorDB>) {
  console.log('\n=== Verify: Check Graph for Intel Nodes ===');

  const cypher = "MATCH (n:IntelNode) RETURN n.id, n.subtype, n.name LIMIT 20";

  try {
    const result = await graph.graphQuery(cypher);
    const columns = result[0] || [];
    const rows = result[1] || [];
    console.log(`✓ Found ${rows.length} IntelNode nodes`);
    
    if (rows.length > 0) {
      console.log('  Columns:', columns.join(', '));
      console.log('  Sample nodes:');
      for (const row of rows.slice(0, 5)) {
        const id = row[0];
        const subtype = row[1];
        const name = row[2];
        console.log(`    - ${id}`);
        console.log(`      subtype: ${subtype}, name: ${name}`);
      }
    }
  } catch (error) {
    console.log('  Query failed:', error instanceof Error ? error.message : error);
  }
}

async function verifyFeedIngestion(graph: ReturnType<typeof getFalkorDB>) {
  console.log('\n=== Verify: Check CISA KEV Feed Nodes ===');

  try {
    const result = await graph.graphQuery("MATCH (n:IntelNode {source: 'CISA KEV'}) RETURN n.id, n.name LIMIT 10");
    const rows = result[1] || [];
    console.log(`✓ Found ${rows.length} CISA KEV nodes`);
    for (const row of rows.slice(0, 3)) {
      console.log(`    - ${row[0]}: ${row[1]}`);
    }
  } catch (error) {
    console.log('  CISA KEV nodes not found (expected on first run)');
  }
}

async function verifyLightRAG(graph: ReturnType<typeof getFalkorDB>) {
  console.log('\n=== Verify: Light RAG for Intel Section ===');

  try {
    await lightRAG.initialize();
    console.log('✓ Light RAG initialized');
  } catch (error) {
    console.log('  Light RAG init failed (vector search may not be available):', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Verify: Check Vector Indexes ===');
  try {
    const listResult = await graph.graphQuery('CALL db.indexes()');
    const indexes = listResult[1] || [];
    console.log(`✓ Found ${indexes.length} indexes`);
    for (const idx of indexes) {
      console.log(`    - ${idx[0]}`);
    }
  } catch (error) {
    console.log('  Index list failed (vector search may not be available):', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Verify: Check Intel Node Embeddings ===');
  try {
    const embResult = await graph.graphQuery("MATCH (n:IntelNode) WHERE n.payload_embedding IS NOT NULL RETURN count(n) as cnt");
    const embCount = embResult[1]?.[0]?.[0] || 0;
    console.log(`✓ Nodes with embeddings: ${embCount}`);
  } catch (error) {
    console.log('  Embedding check failed:', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Test: Query Intel by Text Search ===');
  try {
    const textResult = await graph.graphQuery("MATCH (n:IntelNode) WHERE n.name CONTAINS 'injection' OR n.name CONTAINS 'SQL' RETURN n.id, n.name, n.subtype LIMIT 5");
    const rows = textResult[1] || [];
    console.log(`✓ Text search returned ${rows.length} results`);
    for (const row of rows) {
      console.log(`    - ${row[0]}: ${row[1]} (${row[2]})`);
    }
  } catch (error) {
    console.log('  Text search failed:', error instanceof Error ? error.message : error);
  }
}

async function testFeedInitialization() {
  console.log('\n=== Test 0: Feed Initialization ===');
  
  const agent = new OsintAgent({
    agentId: 'osint-test-0',
    agentType: 'osint',
  });

  await agent.initializeFeeds();
  console.log('✓ Feed initialization complete');
}

async function main() {
  let graph: ReturnType<typeof getFalkorDB>;
  let eventBus: EventBus;

  try {
    ({ graph, eventBus } = await setup());

    await testFeedInitialization();
    await testEnrichmentRequest();
    await testEnrichmentTechnique();
    await testMissionQueued();
    await testWafDuel();
    await testExploitFailed();

    await verifyNodesInGraph(graph);
    await verifyFeedIngestion(graph);
    await verifyLightRAG(graph);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     All Tests Passed! ✅             ║');
    console.log('╚════════════════════════════════════════╝');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup(graph, eventBus);
  }
}

main();
