import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '..', '.env') });

import { supabaseClient } from './core/supabase-client';
import { redisBus } from './core/redis-bus';
import { llmClient } from './core/llm-client';
import { getBlueTeamFindings } from './core/blue-team-bridge';
import { createInitialState } from './core/state';
import { gamma_exploit } from './agents/gamma-exploit';
import type { RedTeamState, Phase, A2AMessage, Task, ExploitResult, ReconResult, BlueTeamFinding, Blackboard, AgentRole, MessageType, Priority } from './types/index';

function logWithTimestamp(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'PIPELINE', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const prefix = level === 'PIPELINE' ? '🔄' : level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '✅';
  const logLine = `[${timestamp}] ${prefix} [${level}] ${message}`;
  if (meta) {
    console[level === 'PIPELINE' ? 'log' : level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine, meta);
  } else {
    console[level === 'PIPELINE' ? 'log' : level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error'](logLine);
  }
}

async function initializeConnections(): Promise<void> {
  logWithTimestamp('INFO', 'Initializing connections...');
  
  const startTime = Date.now();
  
  try {
    logWithTimestamp('DEBUG', 'Connecting to Redis...');
    await redisBus.connect();
    logWithTimestamp('INFO', 'Redis connected', { elapsed: `${Date.now() - startTime}ms` });
  } catch (error) {
    logWithTimestamp('WARN', 'Redis connection failed - running without message queue', { error: String(error) });
  }
  
  const supabaseStart = Date.now();
  try {
    logWithTimestamp('DEBUG', 'Connecting to Supabase...');
    await supabaseClient.connect();
    if (supabaseClient.enabled && supabaseClient.connected) {
      logWithTimestamp('INFO', 'Supabase connected', { elapsed: `${Date.now() - supabaseStart}ms` });
    } else {
      logWithTimestamp('WARN', 'Supabase not available - will run without database');
    }
  } catch (error) {
    logWithTimestamp('WARN', 'Supabase connection failed - will run without database', { error: String(error) });
  }
}

async function runBlueTeamEnrichment(state: RedTeamState): Promise<{ stateUpdate: Partial<RedTeamState>; duration: number }> {
  const startTime = Date.now();
  logWithTimestamp('PIPELINE', '→ BLUE_TEAM_ENRICHMENT', { mission_id: state.mission_id, target: state.target });
  
  const blueTeamFindings: BlueTeamFinding[] = [];
  let blueTeamIntelligenceBrief = '';
  
  try {
    const findings = await getBlueTeamFindings(state.target, {
      minSeverity: 'medium',
      includeUnconfirmed: false,
      repoUrl: state.repo_url || undefined,
    });
    
    blueTeamFindings.push(...findings);
    
    if (findings.length > 0) {
      logWithTimestamp('INFO', `Loaded ${findings.length} Blue Team findings`);
      blueTeamIntelligenceBrief = `Blue Team Intelligence:\n${findings.length} static analysis findings loaded`;
    } else {
      logWithTimestamp('INFO', 'No Blue Team findings available for this target');
      blueTeamIntelligenceBrief = 'No Blue Team static analysis findings available. Proceed with standard reconnaissance.';
    }
  } catch (error) {
    logWithTimestamp('ERROR', 'Blue Team enrichment failed', { error: String(error) });
    blueTeamIntelligenceBrief = `Blue Team enrichment failed: ${error}`;
  }
  
  const duration = Date.now() - startTime;
  logWithTimestamp('PIPELINE', `← BLUE_TEAM_ENRICHMENT complete`, { findings: blueTeamFindings.length, duration: `${duration}ms` });
  
  return {
    stateUpdate: {
      blue_team_findings: blueTeamFindings,
      blue_team_recon_results: blueTeamFindings.map(f => ({
        source: 'blue_team_static_analysis' as const,
        finding_id: f.finding_id,
        vuln_type: f.vuln_type,
        severity: f.severity as ReconResult['severity'],
        file_path: f.file_path,
        line_start: f.line_start,
        line_end: f.line_end,
        title: f.title || `${f.vuln_type} in ${f.file_path}`,
        description: f.description,
        code_snippet: f.code_snippet,
        confidence: f.confidence_score || 0.8,
        confirmed: f.confirmed,
        exploit_suggestions: f.exploit_suggestions || [],
        endpoint: f.file_path?.split('/').pop() || '',
        asset: f.file_path || '',
        finding: f.description || f.title || f.vuln_type,
        evidence: f.code_snippet || '',
        cve_hint: null,
        recommended_action: f.exploit_suggestions?.[0] || null,
      })),
      blue_team_intelligence_brief: blueTeamIntelligenceBrief,
    },
    duration,
  };
}

async function runCommanderPlan(state: RedTeamState): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[]; duration: number }> {
  const startTime = Date.now();
  logWithTimestamp('PIPELINE', '→ COMMANDER_PLAN', { mission_id: state.mission_id, iteration: state.iteration });
  
  try {
    let defenseIntel: any[] = [];
    try {
      defenseIntel = await redisBus.get_latest_defense_intel(state.mission_id);
    } catch (redisError) {
      logWithTimestamp('WARN', 'Could not fetch defense intel from Redis', { error: String(redisError) });
    }
    
    const prompt = buildCommanderPrompt(state, defenseIntel);
    
    const messages = [
      { role: 'system' as const, content: 'You are Commander, orchestrating red team operations. Always respond with valid JSON matching the schema.' },
      { role: 'user' as const, content: prompt },
    ];
    
    logWithTimestamp('DEBUG', 'Calling LLM for Commander plan...');
    const response = await llmClient.chatForAgent('commander', messages);
    
    let plan;
    try {
      const parsed = JSON.parse(response);
      plan = parsed;
    } catch (parseError) {
      logWithTimestamp('ERROR', 'Failed to parse Commander response as JSON', { error: String(parseError), response: response.substring(0, 200) });
      throw parseError;
    }
    
    const normalizedTasks: Task[] = (plan.tasks || []).map((t: any, idx: number) => ({
      agent: t.agent || 'agent_gamma',
      description: t.description || 'No description',
      target: t.target || state.target,
      tools_allowed: t.tools_allowed || ['curl'],
      priority: (t.priority || 'MEDIUM') as Priority,
      exploit_type: (t.exploit_type || 'sqli') as any,
      task_id: crypto.randomUUID(),
      status: 'pending',
    }));
    
    const taskMessages: A2AMessage[] = normalizedTasks.map((task: Task) => ({
      msg_id: crypto.randomUUID(),
      sender: 'commander' as AgentRole,
      recipient: task.agent,
      type: 'TASK_ASSIGNMENT' as MessageType,
      priority: task.priority,
      payload: {
        task_id: task.task_id,
        description: task.description,
        target: task.target,
        tools_allowed: task.tools_allowed,
        exploit_type: task.exploit_type,
      },
      timestamp: new Date().toISOString(),
    }));
    
    const duration = Date.now() - startTime;
    logWithTimestamp('PIPELINE', `← COMMANDER_PLAN complete`, { 
      tasks: normalizedTasks.length, 
      next_phase: plan.next_phase,
      strategy: plan.strategy?.substring(0, 50),
      duration: `${duration}ms` 
    });
    
    return {
      stateUpdate: {
        phase: (plan.next_phase || 'exploitation') as Phase,
        strategy: plan.strategy || '',
        current_tasks: normalizedTasks,
        blackboard: {
          ...state.blackboard,
          current_strategy: plan.strategy,
        },
        needs_human_approval: false,
      },
      messages: taskMessages,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logWithTimestamp('ERROR', 'Commander plan failed', { error: String(error), elapsed: `${duration}ms` });
    
    const fallbackTasks: Task[] = [
      {
        agent: 'agent_alpha' as const,
        description: 'Perform reconnaissance',
        target: state.target,
        tools_allowed: ['nmap', 'curl'],
        priority: 'HIGH' as Priority,
        exploit_type: 'info_disclosure' as any,
        task_id: crypto.randomUUID(),
        status: 'pending',
      },
    ];
    
    return {
      stateUpdate: {
        phase: 'recon' as Phase,
        strategy: 'Fallback strategy due to planning error',
        current_tasks: fallbackTasks,
      },
      messages: [],
      duration,
    };
  }
}

function buildCommanderPrompt(state: RedTeamState, defenseIntel: any[]): string {
  const successfulVectors = (state.blackboard.successful_vectors || []) as string[];
  const compromisedEndpoints = (state.blackboard.compromised_endpoints || []) as string[];
  
  let prompt = `You are the Commander agent orchestrating a red team operation.

MISSION OBJECTIVE: ${state.objective}
TARGET: ${state.target}
ITERATION: ${state.iteration + 1}

Current blackboard intelligence:
- Successful vectors: ${successfulVectors.join(', ') || 'None'}
- Compromised endpoints: ${compromisedEndpoints.join(', ') || 'None'}

Based on the mission objective and current intelligence, generate a CommanderPlan with:
1. A 2-3 sentence attack strategy
2. 1-3 specific task assignments for agents
3. The next phase: 'recon' or 'exploitation'

Return your response as a JSON object with this schema:
{
  "strategy": "attack strategy description",
  "next_phase": "recon" | "exploitation",
  "tasks": [
    {
      "agent": "agent_alpha" | "agent_gamma",
      "description": "specific task description",
      "target": "full URL to target",
      "tools_allowed": ["nmap", "curl"],
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "exploit_type": "sqli" | "xss" | "idor"
    }
  ]
}`;

  return prompt;
}

async function runAlphaRecon(state: RedTeamState): Promise<{ stateUpdate: Partial<RedTeamState>; reconResults: ReconResult[]; duration: number }> {
  const startTime = Date.now();
  logWithTimestamp('PIPELINE', '→ ALPHA_RECON', { mission_id: state.mission_id, target: state.target });
  
  const reconResults: ReconResult[] = [];
  
  try {
    const target = state.target;
    
    logWithTimestamp('INFO', 'Performing basic reconnaissance...');
    
    if (target.includes('localhost') || target.includes('127.0.0.1')) {
      logWithTimestamp('INFO', 'Localhost target detected - simulating recon findings');
      
      reconResults.push({
        source: 'nmap',
        finding_id: crypto.randomUUID(),
        vuln_type: 'open_port',
        severity: 'low',
        file_path: '',
        title: 'Port 3000 Open',
        description: 'Target has port 3000 open (common for Node.js apps)',
        confidence: 0.9,
        confirmed: true,
        endpoint: '',
        asset: target,
        finding: 'Open port detected',
        evidence: 'Port scan revealed open port',
        cve_hint: null,
        recommended_action: 'Investigate running service',
      });
      
      if (state.blue_team_findings && state.blue_team_findings.length > 0) {
        const blueTeamRecon = state.blue_team_recon_results || [];
        reconResults.push(...blueTeamRecon.slice(0, 3));
        logWithTimestamp('INFO', `Added ${blueTeamRecon.slice(0, 3).length} Blue Team findings to recon results`);
      }
    } else {
      logWithTimestamp('INFO', 'Remote target - simulated recon');
      reconResults.push({
        source: 'curl',
        finding_id: crypto.randomUUID(),
        vuln_type: 'http_response',
        severity: 'low',
        file_path: '',
        title: 'HTTP Service Detected',
        description: 'HTTP service detected on target',
        confidence: 0.7,
        confirmed: false,
        endpoint: '/',
        asset: target,
        finding: 'HTTP service detected',
        evidence: 'Target responded with HTTP headers',
        cve_hint: null,
        recommended_action: 'Further reconnaissance needed',
      });
    }
  } catch (error) {
    logWithTimestamp('ERROR', 'Alpha recon failed', { error: String(error) });
  }
  
  const duration = Date.now() - startTime;
  logWithTimestamp('PIPELINE', `← ALPHA_RECON complete`, { findings: reconResults.length, duration: `${duration}ms` });
  
  return {
    stateUpdate: {
      recon_results: [...state.recon_results, ...reconResults],
    },
    reconResults,
    duration,
  };
}

async function runGammaExploit(state: RedTeamState): Promise<{ stateUpdate: Partial<RedTeamState>; exploitResults: ExploitResult[]; duration: number }> {
  const startTime = Date.now();
  const taskCount = state.current_tasks.filter(t => t.agent === 'agent_gamma').length;
  logWithTimestamp('PIPELINE', '→ GAMMA_EXPLOIT', { mission_id: state.mission_id, tasks: taskCount });
  
  const exploitResults: ExploitResult[] = [];
  
  try {
    logWithTimestamp('INFO', `Calling real gamma_exploit with ${state.current_tasks.length} tasks...`);
    
    const { stateUpdate, messages } = await gamma_exploit(state);
    
    const newResults = stateUpdate.exploit_results || [];
    exploitResults.push(...newResults);
    
    const successes = newResults.filter(r => r.success);
    const failures = newResults.filter(r => !r.success);
    
    logWithTimestamp('INFO', `Gamma exploit completed: ${successes.length} successes, ${failures.length} failures`);
    
    for (const result of newResults) {
      logWithTimestamp(result.success ? 'INFO' : 'WARN', 
        `Exploit ${result.exploit_type}: ${result.success ? 'SUCCESS' : 'FAILED'}`, {
        target: result.target,
        response_code: result.response_code,
        evidence: result.evidence?.substring(0, 100),
      });
      
      if (supabaseClient.enabled) {
        await supabaseClient.logExploitAttempt({
          missionId: state.mission_id,
          exploitType: result.exploit_type,
          targetUrl: result.target,
          success: result.success,
          responseCode: result.response_code,
          evidence: result.evidence,
          executionTimeMs: Math.round((result.execution_time || 0) * 1000),
        });
      }
    }
    
    if (messages.length > 0) {
      logWithTimestamp('INFO', `Generated ${messages.length} A2A messages from gamma exploit`);
    }
    
  } catch (error) {
    logWithTimestamp('ERROR', 'Gamma exploit failed', { error: String(error) });
  }
  
  const duration = Date.now() - startTime;
  logWithTimestamp('PIPELINE', `← GAMMA_EXPLOIT complete`, { 
    attempts: exploitResults.length, 
    successes: exploitResults.filter(r => r.success).length,
    duration: `${duration}ms` 
  });
  
  return {
    stateUpdate: {
      exploit_results: [...state.exploit_results, ...exploitResults],
    },
    exploitResults,
    duration,
  };
}

async function runMission(
  missionId: string,
  objective: string,
  target: string,
  options?: {
    maxIterations?: number;
    fastMode?: boolean;
  }
): Promise<RedTeamState> {
  const totalStartTime = Date.now();
  logWithTimestamp('INFO', '═'.repeat(60));
  logWithTimestamp('INFO', 'SWARM WORKER - Starting Mission');
  logWithTimestamp('INFO', '═'.repeat(60));
  logWithTimestamp('INFO', `Mission ID: ${missionId}`);
  logWithTimestamp('INFO', `Target: ${target}`);
  logWithTimestamp('INFO', `Objective: ${objective}`);
  logWithTimestamp('INFO', `Max Iterations: ${options?.maxIterations ?? 5}`);
  logWithTimestamp('INFO', '═'.repeat(60));
  
  await initializeConnections();
  
  const initialState: RedTeamState = {
    mission_id: missionId,
    objective,
    target,
    phase: 'planning' as Phase,
    messages: [{
      msg_id: crypto.randomUUID(),
      sender: 'commander' as AgentRole,
      recipient: 'all' as AgentRole,
      type: 'MISSION_START' as MessageType,
      priority: 'HIGH' as Priority,
      payload: { mission_id: missionId, objective, target },
      timestamp: new Date().toISOString(),
    } as A2AMessage],
    blackboard: {
      successful_vectors: [],
      compromised_endpoints: [],
      stealth_mode: false,
      forbidden_endpoints: [],
      forbidden_until_iteration: 0,
      last_analysis: '',
      current_strategy: '',
      use_hardcoded_exploits: false,
    },
    recon_results: [],
    exploit_results: [],
    current_tasks: [],
    strategy: '',
    iteration: 0,
    max_iterations: options?.maxIterations ?? 5,
    needs_human_approval: false,
    human_response: null,
    reflection_count: 0,
    max_reflections: 3,
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
    repo_url: null,
  };
  
  if (supabaseClient.enabled) {
    await supabaseClient.createMission(missionId, target, objective);
    await supabaseClient.logSwarmEvent({
      mission_id: missionId,
      event_type: 'mission_start',
      agent_name: 'commander',
      title: 'Mission started - Swarm Worker',
      stage: 'planning',
      target,
    });
  }
  
  let state = initialState;
  const iterationTimings: Record<string, number> = {};
  
  while (state.phase !== 'complete' && state.iteration < state.max_iterations) {
    const iterStartTime = Date.now();
    logWithTimestamp('INFO', '─'.repeat(60));
    logWithTimestamp('INFO', `ITERATION ${state.iteration + 1}/${state.max_iterations}`);
    logWithTimestamp('INFO', '─'.repeat(60));
    
    const blueTeamResult = await runBlueTeamEnrichment(state);
    state = { ...state, ...blueTeamResult.stateUpdate };
    
    const commanderResult = await runCommanderPlan(state);
    state = { ...state, ...commanderResult.stateUpdate, messages: [...state.messages, ...commanderResult.messages] };
    
    if (state.phase === 'recon' || commanderResult.stateUpdate.phase === 'recon') {
      const reconResult = await runAlphaRecon(state);
      state = { ...state, ...reconResult.stateUpdate };
    }
    
    if (state.phase === 'exploitation') {
      const exploitResult = await runGammaExploit(state);
      state = { ...state, ...exploitResult.stateUpdate };
    }
    
    if (state.iteration >= state.max_iterations - 1) {
      state.phase = 'complete';
    } else {
      state.iteration++;
    }
    
    const iterDuration = Date.now() - iterStartTime;
    iterationTimings[state.iteration] = iterDuration;
    logWithTimestamp('INFO', `Iteration ${state.iteration} completed in ${iterDuration}ms`);
  }
  
  const totalDuration = Date.now() - totalStartTime;
  
  logWithTimestamp('INFO', '═'.repeat(60));
  logWithTimestamp('INFO', 'MISSION COMPLETE');
  logWithTimestamp('INFO', '═'.repeat(60));
  logWithTimestamp('INFO', `Final Phase: ${state.phase}`);
  logWithTimestamp('INFO', `Total Duration: ${totalDuration}ms`);
  logWithTimestamp('INFO', `Iterations: ${state.iteration}`);
  logWithTimestamp('INFO', `Recon Findings: ${state.recon_results.length}`);
  logWithTimestamp('INFO', `Exploit Results: ${state.exploit_results.length}`);
  logWithTimestamp('INFO', `Successful Exploits: ${state.exploit_results.filter(e => e.success).length}`);
  logWithTimestamp('INFO', `Blue Team Findings: ${state.blue_team_findings.length}`);
  logWithTimestamp('INFO', `Errors: ${state.errors.length}`);
  
  if (supabaseClient.enabled) {
    await supabaseClient.updateMissionStatus(missionId, 'completed');
    await supabaseClient.logSwarmEvent({
      mission_id: missionId,
      event_type: 'mission_complete',
      agent_name: 'commander',
      title: 'Mission completed - Swarm Worker',
      stage: 'complete',
      iteration: state.iteration,
    });
  }
  
  await redisBus.disconnect();
  
  return state;
}

async function main() {
  const missionId = crypto.randomUUID();
  const objective = process.env.MISSION_OBJECTIVE || 'Penetration test of OWASP Juice Shop';
  const target = process.env.TARGET_URL || 'http://localhost:8080';
  const maxIterations = parseInt(process.env.MAX_ITERATIONS || '3', 10);
  
  try {
    const finalState = await runMission(missionId, objective, target, {
      maxIterations,
      fastMode: process.env.FAST_MODE === 'true',
    });
    
    console.log('\n' + '═'.repeat(60));
    console.log('FINAL STATE SUMMARY');
    console.log('═'.repeat(60));
    console.log(JSON.stringify({
      mission_id: finalState.mission_id,
      phase: finalState.phase,
      iteration: finalState.iteration,
      recon_results_count: finalState.recon_results.length,
      exploit_results_count: finalState.exploit_results.length,
      successful_exploits: finalState.exploit_results.filter(e => e.success).length,
      blue_team_findings_count: finalState.blue_team_findings.length,
      errors_count: finalState.errors.length,
    }, null, 2));
    
    if (finalState.exploit_results.length > 0) {
      console.log('\nExploit Results:');
      finalState.exploit_results.forEach((result, idx) => {
        console.log(`  ${idx + 1}. [${result.success ? 'SUCCESS' : 'FAILED'}] ${result.exploit_type} on ${result.target}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    logWithTimestamp('ERROR', 'Mission failed with unhandled error', { error: String(error) });
    process.exit(1);
  }
}

main().catch(error => {
  logWithTimestamp('ERROR', 'Main function failed', { error: String(error) });
  process.exit(1);
});
