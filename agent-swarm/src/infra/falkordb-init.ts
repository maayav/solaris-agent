/**
 * FalkorDB Initialization Script
 * 
 * Creates the meta graph node to establish the Solaris graph.
 * Note: FalkorDB on Railway doesn't have RediSearch module,
 * so FT.CREATE indexes aren't available. The graph works without indexes.
 * 
 * Usage:
 *   bun run falkordb:init
 */

import Redis from 'ioredis';

const GRAPH_NAME = 'solaris';

async function initializeFalkorDB(): Promise<void> {
  const host = process.env.FALKORDB_HOST || 'caboose.proxy.rlwy.net';
  const port = parseInt(process.env.FALKORDB_PORT || '50353');
  const password = process.env.FALKORDB_PASSWORD || 'uLkhZrFuAgKdopfJyxMFGoiVgpTStcRC';
  
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       FalkorDB Initialization - Solaris Agent          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
  
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
    process.exit(1);
  }

  try {
    const pong = await redis.ping();
    console.log(`✓ FalkorDB ping: ${pong}`);
  } catch (error: any) {
    console.error('✗ FalkorDB ping failed:', error.message);
    process.exit(1);
  }

  console.log();
  console.log('Creating graph schema...');
  console.log('─'.repeat(50));

  try {
    await redis.call(
      'GRAPH.QUERY',
      GRAPH_NAME,
      `MERGE (n:__MetaGraph {name: 'solaris-meta'}) SET n.created_at = '${Date.now()}'`
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

  await redis.quit();
}

initializeFalkorDB().catch(console.error);
