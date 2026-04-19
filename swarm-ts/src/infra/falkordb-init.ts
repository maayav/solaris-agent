/**
 * FalkorDB Initialization Script
 * 
 * Sets up the graph schema and creates constraints/indexes for the Solaris-Agent
 * graph network. Run this once on a fresh FalkorDB instance.
 * 
 * Usage:
 *   npx tsx src/infra/falkordb-init.ts
 *   # or
 *   bun run src/infra/falkordb-init.ts
 */

import Redis from 'ioredis';

const GRAPH_NAME = 'solaris';

interface IndexConfig {
  name: string;
  label: string;
  property: string;
  type?: 'exact' | 'range' | 'fulltext';
}

const INDEXES: IndexConfig[] = [
  // Node property indexes
  { name: 'idx_target_id', label: 'Target', property: 'id', type: 'exact' },
  { name: 'idx_endpoint_id', label: 'Endpoint', property: 'id', type: 'exact' },
  { name: 'idx_mission_id', label: 'Mission', property: 'id', type: 'exact' },
  { name: 'idx_mission_status', label: 'Mission', property: 'status', type: 'exact' },
  { name: 'idx_mission_executor', label: 'Mission', property: 'executor', type: 'exact' },
  { name: 'idx_mission_priority', label: 'Mission', property: 'priority', type: 'range' },
  { name: 'idx_credential_id', label: 'Credential', property: 'id', type: 'exact' },
  { name: 'idx_credential_type', label: 'Credential', property: 'cred_type', type: 'exact' },
  { name: 'idx_credential_validation', label: 'Credential', property: 'validation_status', type: 'exact' },
  { name: 'idx_vulnerability_id', label: 'Vulnerability', property: 'id', type: 'exact' },
  { name: 'idx_vulnerability_class', label: 'Vulnerability', property: 'vuln_class', type: 'exact' },
  { name: 'idx_vulnerability_cve', label: 'Vulnerability', property: 'cve', type: 'exact' },
  { name: 'idx_user_id', label: 'User', property: 'id', type: 'exact' },
  { name: 'idx_component_id', label: 'Component', property: 'id', type: 'exact' },
  { name: 'idx_finding_id', label: 'Finding', property: 'id', type: 'exact' },
  { name: 'idx_chain_id', label: 'Chain', property: 'id', type: 'exact' },
  { name: 'idx_lesson_id', label: 'Lesson', property: 'id', type: 'exact' },
  { name: 'idx_lesson_exploit_type', label: 'Lesson', property: 'exploit_type', type: 'exact' },
  { name: 'idx_intel_id', label: 'Intel', property: 'id', type: 'exact' },
  { name: 'idx_intel_subtype', label: 'Intel', property: 'subtype', type: 'exact' },
  { name: 'idx_artifact_id', label: 'Artifact', property: 'id', type: 'exact' },
  { name: 'idx_belief_id', label: 'Belief', property: 'id', type: 'exact' },
  { name: 'idx_gamma_handoff_id', label: 'GammaHandoff', property: 'id', type: 'exact' },
  { name: 'idx_waf_duel_id', label: 'WafDuel', property: 'id', type: 'exact' },
  { name: 'idx_specialist_config_id', label: 'SpecialistConfig', property: 'id', type: 'exact' },
];

async function createIndex(redis: Redis, index: IndexConfig): Promise<void> {
  const { name, label, property, type } = index;
  
  try {
    // FalkorDB uses Redis search (RediSearch) for indexing
    // For exact match indexes
    if (type === 'exact' || type === 'range') {
      await redis.call(
        'FT.CREATE',
        name,
        'ON', 'node',
        'LABEL', label,
        'SCHEMA', property, 'STRING', 'INDEX', 'PREFIX', '1', `${label}:`
      );
    }
    
    console.log(`✓ Created index: ${name} (${label}.${property})`);
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log(`○ Index already exists: ${name}`);
    } else {
      console.error(`✗ Failed to create index ${name}:`, error.message);
    }
  }
}

async function initializeFalkorDB(): Promise<void> {
  // Get FalkorDB config from environment
  const host = process.env.FALKORDB_HOST || 'localhost';
  const port = parseInt(process.env.FALKORDB_PORT || '6379');
  const password = process.env.FALKORDB_PASSWORD || 'falkordb_dev_password';
  
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       FalkorDB Initialization - Solaris Agent          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
  
  // Connect to FalkorDB
  const redis = new Redis({
    host,
    port,
    password,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    console.log(`✓ Connected to FalkorDB at ${host}:${port}`);
  } catch (error: any) {
    console.error('✗ Failed to connect to FalkorDB:', error.message);
    console.error('  Make sure FalkorDB is running: docker-compose up -d');
    process.exit(1);
  }

  // Verify connection
  try {
    const pong = await redis.ping();
    console.log(`✓ FalkorDB ping: ${pong}`);
  } catch (error: any) {
    console.error('✗ FalkorDB ping failed:', error.message);
    process.exit(1);
  }

  console.log();
  console.log('Creating indexes...');
  console.log('─'.repeat(50));

  // Create indexes
  for (const index of INDEXES) {
    await createIndex(redis, index);
  }

  console.log();
  console.log('─'.repeat(50));
  console.log('Creating graph schema constraints...');
  console.log('─'.repeat(50));

  // Create graph and add schema labels
  try {
    // Create a dummy node to establish the graph
    await redis.call(
      'GRAPH.QUERY',
      GRAPH_NAME,
      'MERGE (n:__MetaGraph {name: $name}) SET n.created_at = $ts',
      'name', 'solaris-meta',
      'ts', Date.now().toString()
    );
    console.log(`✓ Created meta graph node`);
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log(`○ Meta graph already exists`);
    } else {
      console.error(`✗ Failed to create meta graph:`, error.message);
    }
  }

  console.log();
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║              Initialization Complete!                  ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Next steps:');
  console.log('  1. Update swarm-ts/.env with your configuration');
  console.log('  2. Run: bun run dev  (or npm run dev)');
  console.log();

  await redis.quit();
}

// Run if executed directly
initializeFalkorDB().catch(console.error);
