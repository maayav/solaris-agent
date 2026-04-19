/**
 * Memory Sections Isolation Test
 * Verifies that nodes in different sections (recon/, gamma/, bridge/, intel/) don't cross-contaminate
 * 
 * Usage: bun run tests/sections.test.ts
 */

import { FalkorDBClient } from '../src/infra/falkordb';

const FALKORDB_HOST = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT || '50353');
const FALKORDB_PASSWORD = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';

async function cleanupAllSections(client: FalkorDBClient) {
  const sections = ['recon/', 'gamma/', 'bridge/', 'intel/', 'lessons/', 'belief/', 'specialists/'];
  for (const section of sections) {
    try {
      await client.raw().call(
        'GRAPH.QUERY', 'solaris',
        `MATCH (n) WHERE n.id STARTS WITH '${section}' DETACH DELETE n`
      );
    } catch {}
  }
  try {
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Target) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Mission) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Credential) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Intel) DETACH DELETE n');
    await client.raw().call('GRAPH.QUERY', 'solaris', 'MATCH (n:Lesson) DETACH DELETE n');
  } catch {}
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       Memory Sections Isolation Test                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const client = new FalkorDBClient({
    host: FALKORDB_HOST,
    port: FALKORDB_PORT,
    password: FALKORDB_PASSWORD,
  });

  await client.connect();
  console.log('✓ Connected to FalkorDB\n');

  // Clean slate
  await cleanupAllSections(client);
  console.log('✓ Cleaned all sections\n');

  console.log('─'.repeat(50));
  console.log('Creating nodes in each section...\n');

  // Create Target (root node, no section prefix)
  const targetId = 'target:juiceshop';
  await client.createNode('Target', targetId, {
    id: targetId,
    name: 'JuiceShop',
    base_url: 'http://localhost:3000',
    tech_stack: ['nodejs', 'express'],
    scope: ['localhost:3000'],
    out_of_scope: [],
    status: 'active',
    engagement_id: 'test-eng',
    created_at: Date.now(),
  });
  console.log(`  Created Target: ${targetId}`);

  // Create nodes in recon/ section
  const reconNodes = [
    { id: 'recon/endpoint:GET-/api/products', type: 'Endpoint', props: { method: 'GET', path: '/api/products', url: 'http://localhost:3000/api/products', auth_required: false, discovered_by: 'alpha', created_at: Date.now() } },
    { id: 'recon/endpoint:POST-/api/login', type: 'Endpoint', props: { method: 'POST', path: '/api/login', url: 'http://localhost:3000/api/login', auth_required: false, discovered_by: 'alpha', created_at: Date.now() } },
    { id: 'recon/component:express@4.18', type: 'Component', props: { name: 'express', version: '4.18', discovered_at: Date.now() } },
    { id: 'recon/user:admin@juiceshop', type: 'User', props: { email: 'admin@juiceshop', role: 'admin', discovered_by: 'alpha', discovered_at: Date.now() } },
    { id: 'recon/vuln:sqli-login', type: 'Vulnerability', props: { vuln_class: 'sql_injection', cvss_score: 9.8, created_at: Date.now() } },
  ];

  for (const node of reconNodes) {
    await client.createNode(node.type, node.id, { id: node.id, type: node.type.toLowerCase(), ...node.props });
  }
  console.log(`  Created ${reconNodes.length} recon/ nodes`);

  // Create nodes in gamma/ section
  const gammaNodes = [
    { id: 'gamma/mission:sqli-login-001', type: 'Mission', props: { executor: 'gamma', exploit_type: 'sql_injection', status: 'queued', priority: 'high', target_endpoint: 'recon/endpoint:POST-/api/login', context_nodes: [], credential_nodes: [], depends_on: [], verified: true, authorized: true, attempt_count: 0, created_by: 'mission_planner', created_at: Date.now(), updated_at: Date.now() } },
    { id: 'gamma/mission:xss-product-002', type: 'Mission', props: { executor: 'gamma', exploit_type: 'xss', status: 'active', priority: 'medium', target_endpoint: 'recon/endpoint:GET-/api/products', context_nodes: [], credential_nodes: [], depends_on: [], verified: true, authorized: true, attempt_count: 1, created_by: 'mission_planner', created_at: Date.now(), updated_at: Date.now() } },
    { id: 'gamma/exploit:sqli-001-result', type: 'Exploit', props: { mission_id: 'gamma/mission:sqli-login-001', exploit_type: 'sql_injection', payload: "admin' OR '1'='1", target_endpoint: 'recon/endpoint:POST-/api/login', success: true, executed_by: 'gamma-1', executed_at: Date.now() } },
  ];

  for (const node of gammaNodes) {
    await client.createNode(node.type, node.id, { id: node.id, type: node.type.toLowerCase(), ...node.props });
  }
  console.log(`  Created ${gammaNodes.length} gamma/ nodes`);

  // Create nodes in bridge/ section (unvalidated credentials)
  const bridgeNodes = [
    { id: 'bridge/cred:jwt-found-001', type: 'Credential', props: { cred_type: 'jwt', value: 'eyJhbGci...', scope: ['localhost:3000'], validation_status: 'pending', created_by: 'gamma', created_at: Date.now() } },
    { id: 'bridge/cred:cookie-found-002', type: 'Credential', props: { cred_type: 'cookie', value: 'session=abc123', scope: ['localhost:3000'], validation_status: 'pending', created_by: 'gamma', created_at: Date.now() } },
  ];

  for (const node of bridgeNodes) {
    await client.createNode(node.type, node.id, { id: node.id, type: 'credential', ...node.props });
  }
  console.log(`  Created ${bridgeNodes.length} bridge/ nodes`);

  // Create nodes in intel/ section
  const intelNodes = [
    { id: 'intel/payload_library:sqli-bypass', type: 'Intel', props: { subtype: 'payload_library', name: 'SQLi Bypass Payloads', data: { payloads: ['\' OR 1=1--', 'admin\'--'] }, created_at: Date.now(), updated_at: Date.now() } },
    { id: 'intel/technique:sqli-erp', type: 'Intel', props: { subtype: 'technique_doc', name: 'SQL Injection ERP Systems', data: { description: 'Testing SQL injection in ERP systems' }, linked_vuln_class: 'sql_injection', created_at: Date.now(), updated_at: Date.now() } },
  ];

  for (const node of intelNodes) {
    await client.createNode(node.type, node.id, { id: node.id, type: 'intel', ...node.props });
  }
  console.log(`  Created ${intelNodes.length} intel/ nodes`);

  // Create edges between sections
  console.log('\nCreating edges...\n');

  // Endpoint → Target
  await client.createEdge('recon/endpoint:POST-/api/login', targetId, 'PART_OF');
  console.log('  Created PART_OF edge: endpoint → target');

  // Mission → Endpoint
  await client.createEdge('gamma/mission:sqli-login-001', 'recon/endpoint:POST-/api/login', 'EXPLOITS');
  console.log('  Created EXPLOITS edge: mission → endpoint');

  // Credential → Mission (for context)
  await client.createEdge('gamma/mission:sqli-login-001', 'bridge/cred:jwt-found-001', 'HAS_CREDENTIAL');
  console.log('  Created HAS_CREDENTIAL edge: mission → credential');

  // Intel → Vulnerability
  await client.createEdge('intel/payload_library:sqli-bypass', 'recon/vuln:sqli-login', 'ENRICHES');
  console.log('  Created ENRICHES edge: intel → vulnerability');

  // Exploit → Mission
  await client.createEdge('gamma/exploit:sqli-001-result', 'gamma/mission:sqli-login-001', 'LED_TO');
  console.log('  Created LED_TO edge: exploit → mission');

  console.log('\n' + '─'.repeat(50));
  console.log('Verifying section isolation...\n');

  // Query each section and verify counts
  let passed = true;

  // Test recon/ section
  const reconResult = await client.raw().call(
    'GRAPH.QUERY', 'solaris',
    "MATCH (n) WHERE n.id STARTS WITH 'recon/' RETURN count(n) as count"
  );
  const reconCount = reconResult[1]?.[0]?.[0] || 0;
  console.log(`  recon/: ${reconCount} nodes (expected: ${reconNodes.length})`);
  if (reconCount !== reconNodes.length) {
    console.log('    ✗ FAIL: Unexpected count');
    passed = false;
  } else {
    console.log('    ✓ PASS');
  }

  // Test gamma/ section
  const gammaResult = await client.raw().call(
    'GRAPH.QUERY', 'solaris',
    "MATCH (n) WHERE n.id STARTS WITH 'gamma/' RETURN count(n) as count"
  );
  const gammaCount = gammaResult[1]?.[0]?.[0] || 0;
  console.log(`  gamma/: ${gammaCount} nodes (expected: ${gammaNodes.length})`);
  if (gammaCount !== gammaNodes.length) {
    console.log('    ✗ FAIL: Unexpected count');
    passed = false;
  } else {
    console.log('    ✓ PASS');
  }

  // Test bridge/ section
  const bridgeResult = await client.raw().call(
    'GRAPH.QUERY', 'solaris',
    "MATCH (n) WHERE n.id STARTS WITH 'bridge/' RETURN count(n) as count"
  );
  const bridgeCount = bridgeResult[1]?.[0]?.[0] || 0;
  console.log(`  bridge/: ${bridgeCount} nodes (expected: ${bridgeNodes.length})`);
  if (bridgeCount !== bridgeNodes.length) {
    console.log('    ✗ FAIL: Unexpected count');
    passed = false;
  } else {
    console.log('    ✓ PASS');
  }

  // Test intel/ section
  const intelResult = await client.raw().call(
    'GRAPH.QUERY', 'solaris',
    "MATCH (n) WHERE n.id STARTS WITH 'intel/' RETURN count(n) as count"
  );
  const intelCount = intelResult[1]?.[0]?.[0] || 0;
  console.log(`  intel/: ${intelCount} nodes (expected: ${intelNodes.length})`);
  if (intelCount !== intelNodes.length) {
    console.log('    ✗ FAIL: Unexpected count');
    passed = false;
  } else {
    console.log('    ✓ PASS');
  }

  // Test cross-section edges
  console.log('\nVerifying cross-section edges...\n');

  // Get missions that EXPLOIT the login endpoint
  const exploitEdges = await client.findEdges('gamma/mission:sqli-login-001', 'EXPLOITS');
  console.log(`  Mission EXPLOITS edges from gamma/mission:sqli-login-001:`);
  console.log(`    Found: ${exploitEdges.length} targets`);
  if (exploitEdges.includes('recon/endpoint:POST-/api/login')) {
    console.log('    ✓ PASS: Correctly links to recon endpoint');
  } else {
    console.log('    ✗ FAIL: Should link to recon/endpoint:POST-/api/login');
    passed = false;
  }

  // Verify gamma mission has credential link
  const credEdges = await client.findEdges('gamma/mission:sqli-login-001', 'HAS_CREDENTIAL');
  console.log(`\n  Mission HAS_CREDENTIAL edges from gamma/mission:sqli-login-001:`);
  console.log(`    Found: ${credEdges.length} credentials`);
  if (credEdges.includes('bridge/cred:jwt-found-001')) {
    console.log('    ✓ PASS: Correctly links to bridge credential');
  } else {
    console.log('    ✗ FAIL: Should link to bridge/cred:jwt-found-001');
    passed = false;
  }

  // Verify intel enriches vulnerability
  const enrichEdges = await client.findEdges('intel/payload_library:sqli-bypass', 'ENRICHES');
  console.log(`\n  Intel ENRICHES edges from intel/payload_library:sqli-bypass:`);
  console.log(`    Found: ${enrichEdges.length} vulnerabilities`);
  if (enrichEdges.includes('recon/vuln:sqli-login')) {
    console.log('    ✓ PASS: Correctly links to recon vulnerability');
  } else {
    console.log('    ✗ FAIL: Should link to recon/vuln:sqli-login');
    passed = false;
  }

  console.log('\n' + '─'.repeat(50));

  if (passed) {
    console.log('\n✓ ALL SECTION ISOLATION TESTS PASSED');
    console.log('  - Nodes correctly partitioned by section prefix');
    console.log('  - Cross-section edges work correctly');
    console.log('  - No namespace cross-contamination detected');
  } else {
    console.log('\n✗ SOME TESTS FAILED');
    process.exitCode = 1;
  }

  // Cleanup
  await cleanupAllSections(client);
  await client.close();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║       Test Complete                                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
