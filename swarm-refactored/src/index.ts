import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '..', '.env') });

export * from './types/index.js';

export * from './agents/schemas.js';
export { commander_plan, commander_observe } from './agents/commander.js';
export { alpha_recon, detectTargetType } from './agents/alpha-recon.js';
export {
  gamma_exploit,
  execute_single_exploit,
  isDestructivePayload,
  hitl_approval_gate_node,
  gamma_exploit_node,
} from './agents/gamma-exploit.js';
export {
  analyze_exploit_result,
  deterministic_precheck,
  scan_for_juice_shop_hints,
  extractSessionTokens,
  isValidJWT,
  storeDiscoveredTokens,
} from './agents/critic-agent.js';
export { blue_team_enrichment_node } from './agents/blue-team-enrichment.js';
export { report_generation_node } from './agents/report-generator.js';

export * from './core/state.js';
export { RedisBus, redisBus } from './core/redis-bus.js';
export { LLMClient, llmClient, AGENT_MODEL_CONFIG } from './core/llm-client.js';
export { SupabaseClientWrapper, supabaseClient } from './core/supabase-client.js';
export { toolRegistry, ToolRegistry } from './core/tool-registry.js';

export {
  runMission,
  shouldContinue,
} from './graph/langgraph.js';

import { runMission } from './graph/langgraph.js';
import { toolRegistry } from './core/tool-registry.js';

async function main() {
  console.log('Swarm Refactored - Red Team Agent System (LangGraph)');
  console.log('====================================================\n');

  console.log('════════════════════════════════════════════════════════════');
  console.log('TOOL REGISTRY');
  console.log('════════════════════════════════════════════════════════════');
  await toolRegistry.initialize();
  const tools = toolRegistry.listTools();
  console.log(`Total Tools: ${tools.length}\n`);
  for (const tool of tools) {
    console.log(`  • ${tool.name}${tool.aliases?.length ? ` (${tool.aliases.join(', ')})` : ''}`);
  }
  console.log('════════════════════════════════════════════════════════════\n');

  const missionId = crypto.randomUUID();
  const objective = 'Penetration test of OWASP Juice Shop';
  const target = process.env.TARGET_URL || 'http://localhost:8080';

  console.log(`Mission ID: ${missionId}`);
  console.log(`Target: ${target}`);
  console.log(`Objective: ${objective}\n`);

  try {
    const finalState = await runMission(missionId, objective, target, {
      maxIterations: 3,
      fastMode: process.env.FAST_MODE === 'true',
    });

    console.log('\n=== Mission Complete ===');
    console.log(`Final Phase: ${finalState.phase}`);
    console.log(`Iterations: ${finalState.iteration}/${finalState.max_iterations}`);
    console.log(`Recon Findings: ${finalState.recon_results.length}`);
    console.log(`Exploit Results: ${finalState.exploit_results.length}`);
    console.log(`Successful Exploits: ${finalState.exploit_results.filter((e) => e.success).length}`);
    console.log(`Errors: ${finalState.errors.length}`);

    if (finalState.report) {
      console.log('\n=== Report Summary ===');
      console.log(`Generated: ${finalState.report.report_metadata.generated_at}`);
      console.log(`Progress: ${finalState.report.kill_chain_progress.progress_percentage.toFixed(1)}%`);
      console.log('\nRecommendations:');
      finalState.report.recommendations.forEach((r) => console.log(`  - ${r}`));
    }
  } catch (error) {
    console.error('Mission failed with error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { main };
