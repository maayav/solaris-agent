import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type {
  RedTeamState,
  Task,
  TaskAssignment,
  Phase,
  A2AMessage,
  DefenseAnalytics,
  Priority,
  ExploitType,
  AgentRole,
  MessageType,
} from '../types/index.js';
import { CommanderPlanSchema } from './schemas.js';
import { llmClient, repairJSON, tryParseJSON } from '../core/llm-client.js';
import { supabaseClient } from '../core/supabase-client.js';
import { redisBus } from '../core/redis-bus.js';

function logWithTimestamp(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '📋';
  console.info(`[${timestamp}] ${prefix} [commander] ${message}`);
}

const AGENT_ROLE_MAPPING: Record<string, string> = {
  'agent_alpha': 'agent_alpha',
  'alpha': 'agent_alpha',
  'recon': 'agent_alpha',
  'reconnaissance': 'agent_alpha',
  'scanner': 'agent_alpha',
  'agent_gamma': 'agent_gamma',
  'gamma': 'agent_gamma',
  'exploit': 'agent_gamma',
  'exploitation': 'agent_gamma',
  'attacker': 'agent_gamma',
  'agent_critic': 'agent_critic',
  'critic': 'agent_critic',
  'reviewer': 'agent_critic',
  'evaluator': 'agent_critic',
  'commander': 'commander',
};

const VECTOR_ROTATION_RULES = {
  min_categories: 3,
  forbidden_duration: 5,
  max_same_endpoint_type: 1,
  owasp_categories: [
    'sqli', 'xss', 'idor', 'lfi',
    'auth_bypass', 'info_disclosure',
    'sensitive_data_exposure', 'xxe',
  ],
} as const;

const MAX_PROMPT_TOKENS = 4096;

function normalizeAgentName(name: string): 'agent_alpha' | 'agent_gamma' {
  const lower = name.toLowerCase().trim();
  const normalized = AGENT_ROLE_MAPPING[lower] || 'agent_gamma';
  return normalized as 'agent_alpha' | 'agent_gamma';
}

function normalizePriority(priority: string): Priority {
  const validPriorities: Priority[] = ['HIGH', 'MEDIUM', 'LOW', 'CRITICAL'];
  return validPriorities.includes(priority as Priority) ? priority as Priority : 'MEDIUM';
}

function normalizeExploitType(type: string): ExploitType {
  const validTypes: ExploitType[] = [
    'sqli', 'xss', 'idor', 'lfi', 'auth_bypass',
    'info_disclosure', 'sensitive_data_exposure', 'xxe',
    'client_side_bypass', 'authentication', 'broken_access_control'
  ];
  return validTypes.includes(type as ExploitType) ? type as ExploitType : 'sqli';
}

function truncatePrompt(prompt: string, maxTokens: number = MAX_PROMPT_TOKENS): string {
  const tokens = prompt.split(/\s+/);
  if (tokens.length <= maxTokens) return prompt;
  return tokens.slice(0, maxTokens).join(' ');
}

function generateFallbackTasks(state: RedTeamState): TaskAssignment[] {
  const successful_vectors = (state.blackboard.successful_vectors as string[]) || [];
  const target = state.target;

  if (successful_vectors.includes('idor')) {
    return [
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'idor' as ExploitType,
        target: `${target}/rest/basket/6`,
        tools_allowed: ['curl'],
        priority: 'HIGH' as Priority,
        description: 'Test IDOR on basket endpoint',
      },
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'idor' as ExploitType,
        target: `${target}/rest/user/1`,
        tools_allowed: ['curl'],
        priority: 'HIGH' as Priority,
        description: 'Test IDOR on user endpoint',
      },
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'sqli' as ExploitType,
        target: `${target}/rest/user/login`,
        tools_allowed: ['curl'],
        priority: 'HIGH' as Priority,
        description: 'Test SQL injection on login',
      },
    ];
  }

  if (successful_vectors.includes('sqli') || successful_vectors.includes('auth_bypass')) {
    return [
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'sqli' as ExploitType,
        target: `${target}/rest/products`,
        tools_allowed: ['curl'],
        priority: 'HIGH' as Priority,
        description: 'Test SQL injection on products endpoint',
      },
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'xss' as ExploitType,
        target: `${target}/#/search`,
        tools_allowed: ['curl'],
        priority: 'MEDIUM' as Priority,
        description: 'Test XSS on search endpoint',
      },
      {
        agent: 'agent_gamma' as const,
        exploit_type: 'info_disclosure' as ExploitType,
        target: `${target}/api/Products`,
        tools_allowed: ['curl'],
        priority: 'MEDIUM' as Priority,
        description: 'Test information disclosure on API',
      },
    ];
  }

  return [
    {
      agent: 'agent_gamma' as const,
      exploit_type: 'auth_bypass' as ExploitType,
      target: `${target}/rest/user/login`,
      tools_allowed: ['curl'],
      priority: 'HIGH' as Priority,
      description: 'Test authentication bypass on login endpoint',
    },
    {
      agent: 'agent_gamma' as const,
      exploit_type: 'idor' as ExploitType,
      target: `${target}/rest/basket/1`,
      tools_allowed: ['curl'],
      priority: 'HIGH' as Priority,
      description: 'Test IDOR on basket endpoint',
    },
    {
      agent: 'agent_alpha' as const,
      exploit_type: 'info_disclosure' as ExploitType,
      target,
      tools_allowed: ['nmap', 'curl'],
      priority: 'MEDIUM' as Priority,
      description: 'Perform reconnaissance scan',
    },
  ];
}

function processDefenseAnalytics(
  defenseIntel: DefenseAnalytics[],
  state: RedTeamState
): { forbiddenEndpoints: string[]; stealthMode: boolean } {
  const forbiddenEndpoints: string[] = [];
  let stealthMode = state.blackboard.stealth_mode || false;
  const alertCount = defenseIntel.length;
  const hasHighSeverity = defenseIntel.some(
    (d) => d.severity === 'HIGH' || d.severity === 'CRITICAL'
  );

  if (alertCount > 3) {
    stealthMode = true;
  }

  if (hasHighSeverity) {
    stealthMode = true;
    for (const intel of defenseIntel.filter((d) => d.severity === 'HIGH' || d.severity === 'CRITICAL')) {
      if (intel.endpoint) {
        forbiddenEndpoints.push(intel.endpoint);
      }
    }
  }

  return { forbiddenEndpoints, stealthMode };
}

function buildCommanderPrompt(state: RedTeamState, defenseIntel: DefenseAnalytics[]): string {
  const {
    objective,
    target,
    blackboard,
    blue_team_intelligence_brief,
    iteration,
    recon_results,
    exploit_results,
  } = state;

  const successfulVectors = (blackboard.successful_vectors || []) as string[];
  const compromisedEndpoints = (blackboard.compromised_endpoints || []) as string[];
  const stealthMode = blackboard.stealth_mode || false;

  let prompt = `You are the Commander agent orchestrating a red team operation.

MISSION OBJECTIVE: ${objective}
TARGET: ${target}
ITERATION: ${iteration + 1}

Current blackboard intelligence:
- Successful vectors: ${successfulVectors.join(', ') || 'None'}
- Compromised endpoints: ${compromisedEndpoints.join(', ') || 'None'}
- Stealth mode: ${stealthMode ? 'ACTIVE' : 'Inactive'}

`;

  if (blue_team_intelligence_brief) {
    prompt += `BLUE TEAM STATIC ANALYSIS INTELLIGENCE:
${blue_team_intelligence_brief}

`;
  }

  if (defenseIntel.length > 0) {
    prompt += `DEFENSE ANALYTICS (recent detections):
${defenseIntel.map((d) => `- [${d.severity}] ${d.description} (endpoint: ${d.endpoint || 'N/A'})`).join('\n')}

`;
  }

  if (recon_results.length > 0) {
    prompt += `Recent reconnaissance findings:
${recon_results.slice(-5).map((r) => `- ${r.finding} (confidence: ${r.confidence})`).join('\n')}

`;
  }

  if (exploit_results.length > 0) {
    prompt += `Recent exploit results:
${exploit_results.slice(-5).map((r) => `- ${r.exploit_type}: ${r.success ? 'SUCCESS' : 'FAILED'} - ${r.evidence.slice(0, 100)}`).join('\n')}

`;
  }

  const validExploitTypes = [
    'sqli', 'xss', 'idor', 'lfi', 'auth_bypass', 'info_disclosure',
    'sensitive_data_exposure', 'xxe', 'client_side_bypass', 'authentication',
    'broken_access_control', 'command_injection', 'vulnerability_scan', 'osint',
    'cve', 'jwt', 'scrape', 'ffuf', 'nmap', 'nuclei', 'python', 'curl',
    'ssrf', 'path_traversal', 'prototype_pollution', 'open_redirect',
    'security_misconfiguration'
  ].join(', ');

  prompt += `Based on the mission objective and current intelligence, generate a CommanderPlan with:
 1. A 2-3 sentence attack strategy
 2. 3-5 specific task assignments for agents
 3. The next phase: 'recon', 'exploitation', or 'complete'

 IMPORTANT: exploit_type MUST be one of these exact values:
 ${validExploitTypes}

 Return your response as a JSON object with this schema:
 {
   "strategy": "attack strategy description",
   "next_phase": "recon" | "exploitation" | "complete",
   "analysis": "brief analysis of current state",
   "stealth_mode": boolean,
   "tasks": [
     {
       "agent": "agent_alpha" | "agent_gamma",
       "description": "specific task description",
       "target": "full URL to target",
       "tools_allowed": ["nmap", "curl", ...],
       "priority": "HIGH" | "MEDIUM" | "LOW",
       "exploit_type": "USE ONLY: sqli, xss, idor, lfi, auth_bypass, info_disclosure, sensitive_data_exposure, xxe, client_side_bypass, authentication, broken_access_control, command_injection, vulnerability_scan, osint, cve, jwt, scrape, ffuf, nmap, nuclei, python, curl, ssrf, path_traversal, prototype_pollution, open_redirect, security_misconfiguration"
     }
   ]
 }`;

  return truncatePrompt(prompt, MAX_PROMPT_TOKENS);
}

export async function commander_plan(
  state: RedTeamState,
  defenseIntel: DefenseAnalytics[] = []
): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[] }> {
  const prompt = buildCommanderPrompt(state, defenseIntel);

  const messages = [
    { role: 'system' as const, content: `You are Commander, orchestrating red team operations. Always respond with valid JSON matching the schema. Do NOT include any markdown formatting or explanations - ONLY raw JSON.

IMPORTANT: exploit_type MUST be one of these exact values:
sqli, xss, idor, lfi, auth_bypass, info_disclosure, sensitive_data_exposure, xxe, client_side_bypass, authentication, broken_access_control, command_injection, vulnerability_scan, osint, cve, jwt, scrape, ffuf, nmap, nuclei, python, curl, ssrf, path_traversal, prototype_pollution, open_redirect, security_misconfiguration

DO NOT use any other value for exploit_type.` },
    { role: 'user' as const, content: prompt },
  ];

  let plan;
  try {
    const response = await llmClient.chatForAgent('commander', messages);
    
    const repaired = repairJSON(response);
    const parseResult = tryParseJSON(repaired);
    
    if (parseResult.success) {
      const safeParseResult = CommanderPlanSchema.safeParse(parseResult.data);
      if (safeParseResult.success) {
        plan = safeParseResult.data;
        logWithTimestamp(`Commander: Planning successful - strategy: ${plan.strategy.substring(0, 60)}...`);
      } else {
        const issues = safeParseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Validation failed: ${issues}`);
      }
    } else {
      throw new Error(`JSON parse failed: ${parseResult.error}`);
    }
  } catch (error) {
    logWithTimestamp(`Commander planning failed: ${error}, using fallback tasks`, 'WARN');

    const fallbackTasks = generateFallbackTasks(state);
    plan = {
      strategy: 'Fallback strategy - targeting common vulnerabilities',
      tasks: fallbackTasks,
      next_phase: fallbackTasks.some((t) => t.agent === 'agent_alpha') ? 'recon' as Phase : 'exploitation' as Phase,
      stealth_mode: false,
    };
  }

  const { forbiddenEndpoints, stealthMode } = processDefenseAnalytics(defenseIntel, state);

  if (forbiddenEndpoints.length > 0) {
    state.blackboard.forbidden_endpoints = forbiddenEndpoints as string[];
    state.blackboard.forbidden_until_iteration = state.iteration + VECTOR_ROTATION_RULES.forbidden_duration;
  }

  if (stealthMode) {
    state.blackboard.stealth_mode = true;
  }

  logWithTimestamp(`Strategy: ${plan.strategy}`);
  logWithTimestamp(`Next phase: ${plan.next_phase}`);
  logWithTimestamp(`Tasks: ${plan.tasks.length}`);
  for (const task of plan.tasks) {
    logWithTimestamp(`  → [${task.priority}] ${task.agent}: ${task.description} (${task.exploit_type})`);
  }

  const normalizedTasks: Task[] = plan.tasks.map((t: TaskAssignment) => ({
    agent: normalizeAgentName(t.agent),
    description: t.description,
    target: t.target,
    tools_allowed: t.tools_allowed,
    priority: normalizePriority(t.priority),
    exploit_type: normalizeExploitType(t.exploit_type),
    task_id: uuidv4(),
    status: 'pending',
  }));

  const taskMessages: A2AMessage[] = normalizedTasks.map((task: Task) => ({
    msg_id: uuidv4(),
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

  return {
    stateUpdate: {
      phase: plan.next_phase as Phase,
      strategy: plan.strategy,
      current_tasks: normalizedTasks,
      blackboard: {
        ...state.blackboard,
        current_strategy: plan.strategy,
      },
      needs_human_approval: false,
    },
    messages: taskMessages,
  };
}

export async function commander_observe(
  state: RedTeamState,
  defenseIntel: DefenseAnalytics[] = []
): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[] }> {
  const intelReports = state.messages.filter(
    (m) => m.type === 'INTELLIGENCE_REPORT'
  );
  const exploitResults = state.messages.filter(
    (m) => m.type === 'EXPLOIT_RESULT'
  );

  const successfulExploits = state.exploit_results.filter((e) => e.success);
  const successfulVectors = [...new Set(successfulExploits.map((e) => e.exploit_type))];
  const compromisedEndpoints = [...new Set(successfulExploits.map((e) => e.target))];

  state.blackboard.successful_vectors = successfulVectors as string[];
  state.blackboard.compromised_endpoints = compromisedEndpoints as string[];

  if (state.iteration >= state.max_iterations) {
    return {
      stateUpdate: {
        phase: 'complete' as Phase,
      },
      messages: [],
    };
  }

  const { forbiddenEndpoints, stealthMode } = processDefenseAnalytics(defenseIntel, state);

  if (forbiddenEndpoints.length > 0) {
    state.blackboard.forbidden_endpoints = forbiddenEndpoints as string[];
    state.blackboard.forbidden_until_iteration = state.iteration + VECTOR_ROTATION_RULES.forbidden_duration;
  }

  if (stealthMode && !state.blackboard.stealth_mode) {
    state.blackboard.stealth_mode = true;
  }

  let nextPhase: Phase = 'exploitation';
  let newTasks: TaskAssignment[] = [];

  if (intelReports.length === 0 && exploitResults.length === 0) {
    nextPhase = 'recon';
    newTasks = [
      {
        agent: 'agent_alpha' as const,
        description: 'Perform initial reconnaissance',
        target: state.target,
        tools_allowed: ['nmap', 'curl'],
        priority: 'HIGH' as Priority,
        exploit_type: 'info_disclosure' as ExploitType,
      },
    ];
  } else {
    const plan = await commander_plan(state, defenseIntel);
    nextPhase = plan.stateUpdate.phase as Phase;
    newTasks = plan.stateUpdate.current_tasks as TaskAssignment[];
  }

  const normalizedTasks: Task[] = newTasks.map((t: TaskAssignment) => ({
    agent: normalizeAgentName(t.agent),
    description: t.description,
    target: t.target,
    tools_allowed: t.tools_allowed,
    priority: normalizePriority(t.priority),
    exploit_type: normalizeExploitType(t.exploit_type),
    task_id: uuidv4(),
    status: 'pending',
  }));

  const taskMessages: A2AMessage[] = normalizedTasks.map((task: Task) => ({
    msg_id: uuidv4(),
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

  return {
    stateUpdate: {
      phase: nextPhase,
      iteration: state.iteration + 1,
      current_tasks: normalizedTasks,
      blackboard: state.blackboard,
    },
    messages: taskMessages,
  };
}

export async function commander_plan_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const defenseIntel = await redisBus.get_latest_defense_intel(state.mission_id);
    const { stateUpdate, messages } = await commander_plan(state, defenseIntel);

    return {
      ...stateUpdate,
      messages: messages,
    };
  } catch (error) {
    console.error('Commander plan failed:', error);
    state.errors.push(`Commander planning error: ${error}`);
    return {
      errors: state.errors,
      phase: 'complete' as Phase,
    };
  }
}

export async function commander_observe_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const defenseIntel = await redisBus.get_latest_defense_intel(state.mission_id);
    const { stateUpdate, messages } = await commander_observe(state, defenseIntel);

    return {
      ...stateUpdate,
      messages: messages,
    };
  } catch (error) {
    console.error('Commander observe failed:', error);
    state.errors.push(`Commander observe error: ${error}`);
    return {
      errors: state.errors,
    };
  }
}
