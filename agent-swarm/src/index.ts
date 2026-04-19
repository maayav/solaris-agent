/**
 * Solaris-Agent Graph Network Infrastructure
 * 
 * Entry point for the agent swarm system.
 */

import { getConfig } from './config/index.js';
import { getFalkorDB } from './infra/falkordb.js';
import { EventBus } from './events/bus.js';

export { getConfig } from './config/index.js';
export { getFalkorDB, FalkorDBClient } from './infra/falkordb.js';
export { EventBus } from './events/bus.js';
export * from './events/types.js';
export * from './events/subscriptions.js';
export * from './events/cleanup.js';
export * from './graph/schema.js';
export * from './graph/edges.js';
export * from './graph/missions.js';
export * from './utils/id.js';
export * from './agents/index.js';
export { getSupabase } from './infra/supabase.js';

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       Solaris-Agent Graph Network Infrastructure      ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();

  const config = getConfig();
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`Log Level: ${config.LOG_LEVEL}`);
  console.log();

  console.log('Connecting to FalkorDB...');
  const graph = getFalkorDB();
  
  try {
    await graph.connect();
    const pong = await graph.ping();
    if (pong) {
      console.log('✓ FalkorDB connected');
    } else {
      console.error('✗ FalkorDB ping failed');
    }
  } catch (error) {
    console.error('✗ Failed to connect to FalkorDB:', error);
    console.error('  Make sure your .env has correct FALKORDB_* settings');
    console.error('  Or run `docker-compose up -d` for local development');
  }

  console.log('Initializing SQLite Event Bus...');
  new EventBus(config.SQLITE_EVENTS_PATH);
  console.log(`✓ Event Bus ready (${config.SQLITE_EVENTS_PATH})`);

  console.log();
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║              System Ready!                           ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Next: Implement your agents in src/agents/');
  console.log('See docs/SOLARIS_AGENT_MVP_GRAPH_NETWORK.md for the plan');
}

main().catch(console.error);
