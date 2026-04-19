/* eslint-disable @typescript-eslint/no-explicit-any */
import { StateGraph, START, END } from '@langchain/langgraph';
import type { RedTeamState, Phase, A2AMessage, Task, ExploitResult, ReconResult, BlueTeamFinding, Blackboard } from '../types/index.js';
import { commander_plan_node, commander_observe_node } from '../agents/commander.js';
import { alpha_recon_node } from '../agents/alpha-recon.js';
import { gamma_exploit_node, hitl_approval_gate_node } from '../agents/gamma-exploit.js';
import { report_generation_node } from '../agents/report-generator.js';
import { blue_team_enrichment_node } from '../agents/blue-team-enrichment.js';
import { supabaseClient } from '../core/supabase-client.js';
import { redisBus } from '../core/redis-bus.js';

type SwarmNode = (state: RedTeamState) => Promise<Partial<RedTeamState>>;

function addMessages(existing: A2AMessage[], update: A2AMessage[]): A2AMessage[] {
  return [...existing, ...update];
}

function mergeBlackboard(existing: Blackboard, update: Partial<Blackboard>): Blackboard {
  return { ...existing, ...update };
}

function mergeReconResults(existing: ReconResult[], update: ReconResult[]): ReconResult[] {
  return [...existing, ...update];
}

function mergeExploitResults(existing: ExploitResult[], update: ExploitResult[]): ExploitResult[] {
  return [...existing, ...update];
}

function mergeFindings(x: BlueTeamFinding[], y: BlueTeamFinding[]): BlueTeamFinding[] {
  return [...x, ...y];
}

function mergeStrings(x: string[], y: string[]): string[] {
  return [...x, ...y];
}

function mergeErrors(x: string[], y: string[]): string[] {
  return [...x, ...y];
}

function shouldContinue(state: RedTeamState): 'continue' | 'exploit_only' | 'report' {
  const { phase, iteration, max_iterations } = state;

  if (phase === 'complete') {
    return 'report';
  }

  if (iteration >= max_iterations) {
    return 'report';
  }

  if (phase === 'exploitation') {
    return 'exploit_only';
  }

  return 'continue';
}

export type SwarmState = RedTeamState;

function createInitialBlackboard(): Blackboard {
  return {
    successful_vectors: [],
    compromised_endpoints: [],
    stealth_mode: false,
    forbidden_endpoints: [],
    forbidden_until_iteration: 0,
    last_analysis: '',
    current_strategy: '',
    use_hardcoded_exploits: false,
  };
}

export async function runMission(
  missionId: string,
  objective: string,
  target: string,
  options?: {
    maxIterations?: number;
    maxReflections?: number;
    repoUrl?: string;
    fastMode?: boolean;
  }
): Promise<RedTeamState> {
  try {
    await redisBus.connect();
  } catch (error) {
    console.warn('[Redis] Connection failed, running without message queue:', error);
  }
  
  try {
    await supabaseClient.connect();
  } catch (error) {
    console.warn('[Supabase] Connection failed, running without database:', error);
  }

  const initialState: RedTeamState = {
    mission_id: missionId,
    objective,
    target,
    phase: 'planning' as Phase,
    messages: [{
      msg_id: crypto.randomUUID(),
      sender: 'commander',
      recipient: 'all',
      type: 'MISSION_START',
      priority: 'HIGH',
      payload: { mission_id: missionId, objective, target },
      timestamp: new Date().toISOString(),
    } as A2AMessage],
    blackboard: createInitialBlackboard(),
    recon_results: [],
    exploit_results: [],
    current_tasks: [],
    strategy: '',
    iteration: 0,
    max_iterations: options?.maxIterations ?? 5,
    needs_human_approval: false,
    human_response: null,
    reflection_count: 0,
    max_reflections: options?.maxReflections ?? 3,
    pending_exploit: null,
    discovered_credentials: {},
    contextual_memory: {},
    report: null,
    report_path: null,
    blue_team_findings: [],
    blue_team_recon_results: [],
    blue_team_intelligence_brief: '',
    errors: [],
    mode: null,
    fast_mode: options?.fastMode ?? false,
    repo_url: options?.repoUrl ?? null,
  };

  await supabaseClient.createMission(missionId, target, objective);

  const graph = new StateGraph<any, any>({
    channels: {
      mission_id: {
        reducer: (_x: string, y: string) => y,
        default: () => missionId,
      },
      objective: {
        reducer: (_x: string, y: string) => y,
        default: () => objective,
      },
      target: {
        reducer: (_x: string, y: string) => y,
        default: () => target,
      },
      phase: {
        reducer: (_x: Phase, y: Phase) => y,
        default: () => 'planning' as Phase,
      },
      messages: {
        reducer: addMessages as any,
        default: () => [] as A2AMessage[],
      },
      blackboard: {
        reducer: mergeBlackboard as any,
        default: createInitialBlackboard,
      },
      recon_results: {
        reducer: mergeReconResults as any,
        default: () => [] as ReconResult[],
      },
      exploit_results: {
        reducer: mergeExploitResults as any,
        default: () => [] as ExploitResult[],
      },
      current_tasks: {
        reducer: (_x: Task[], y: Task[]) => y,
        default: () => [] as Task[],
      },
      strategy: {
        reducer: (_x: string, y: string) => y,
        default: () => '',
      },
      iteration: {
        reducer: (_x: number, y: number) => y,
        default: () => 0,
      },
      max_iterations: {
        reducer: (_x: number, y: number) => y,
        default: () => options?.maxIterations ?? 5,
      },
      needs_human_approval: {
        reducer: (_x: boolean, y: boolean) => y,
        default: () => false,
      },
      human_response: {
        reducer: (_x: string | null, y: string | null) => y,
        default: () => null,
      },
      reflection_count: {
        reducer: (_x: number, y: number) => y,
        default: () => 0,
      },
      max_reflections: {
        reducer: (_x: number, y: number) => y,
        default: () => options?.maxReflections ?? 3,
      },
      pending_exploit: {
        reducer: (_x: any, y: any) => y,
        default: () => null,
      },
      discovered_credentials: {
        reducer: (x: any, y: any) => ({ ...x, ...y }),
        default: () => ({}),
      },
      contextual_memory: {
        reducer: (x: any, y: any) => ({ ...x, ...y }),
        default: () => ({}),
      },
      report: {
        reducer: (_x: any, y: any) => y,
        default: () => null,
      },
      report_path: {
        reducer: (_x: string | null, y: string | null) => y,
        default: () => null,
      },
      blue_team_findings: {
        reducer: mergeFindings as any,
        default: () => [] as BlueTeamFinding[],
      },
      blue_team_recon_results: {
        reducer: mergeReconResults as any,
        default: () => [] as ReconResult[],
      },
      blue_team_intelligence_brief: {
        reducer: (_x: string, y: string) => y,
        default: () => '',
      },
      errors: {
        reducer: mergeErrors as any,
        default: () => [] as string[],
      },
      mode: {
        reducer: (_x: any, y: any) => y,
        default: () => null,
      },
      fast_mode: {
        reducer: (_x: boolean, y: boolean) => y,
        default: () => options?.fastMode ?? false,
      },
      repo_url: {
        reducer: (_x: string | null, y: string | null) => y,
        default: () => options?.repoUrl ?? null,
      },
    },
  });

  (graph as any).addNode('blue_team_enrichment', blue_team_enrichment_node as SwarmNode);
  (graph as any).addNode('commander_plan', commander_plan_node as SwarmNode);
  (graph as any).addNode('alpha_recon', alpha_recon_node as SwarmNode);
  (graph as any).addNode('gamma_exploit', gamma_exploit_node as SwarmNode);
  (graph as any).addNode('hitl_gate', hitl_approval_gate_node as SwarmNode);
  (graph as any).addNode('commander_observe', commander_observe_node as SwarmNode);
  (graph as any).addNode('generate_report', report_generation_node as SwarmNode);

  (graph as any).addEdge(START, 'blue_team_enrichment');
  (graph as any).addEdge('blue_team_enrichment', 'commander_plan');
  (graph as any).addEdge('commander_plan', 'alpha_recon');
  (graph as any).addEdge('alpha_recon', 'gamma_exploit');
  (graph as any).addEdge('gamma_exploit', 'hitl_gate');
  (graph as any).addEdge('hitl_gate', 'commander_observe');

  (graph as any).addConditionalEdges(
    'commander_observe',
    shouldContinue as any,
    {
      continue: 'alpha_recon',
      exploit_only: 'gamma_exploit',
      report: 'generate_report',
    }
  );

  (graph as any).addEdge('generate_report', END);

  const app = graph.compile();

  const finalState = await app.invoke(initialState);

  return finalState as RedTeamState;
}

export { shouldContinue };
