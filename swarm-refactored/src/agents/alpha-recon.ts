import type {
  RedTeamState,
  Task,
  ReconResult,
  IntelligenceReport,
  A2AMessage,
  Phase,
  Priority,
  AgentRole,
  MessageType,
} from '../types/index.js';
import { IntelligenceReportSchema } from './schemas.js';
import { llmClient } from '../core/llm-client.js';

function logWithTimestamp(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '✅';
  console.info(`[${timestamp}] ${prefix} [alpha_recon] ${message}`);
}

const MAX_FINDINGS = 15;

const SENSITIVE_FILES = [
  '.env',
  '.env.example',
  'config.json',
  'secrets.yaml',
  'docker-compose.yml',
];

const API_DISCOVERY_PATTERNS = [
  '/api/*',
  '/rest/*',
  '/graphql',
  '/swagger',
  '/api-docs',
];

const IDOR_PATTERNS = [
  '/api/users/',
  '/api/orders/',
  '/rest/basket/',
  '/rest/user/',
];

const SENSITIVE_ENDPOINTS = [
  '/.env',
  '/.git/config',
  '/config.json',
  '/swagger.json',
  '/robots.txt',
  '/sitemap.xml',
  '/.well-known/',
  '/admin',
  '/manage',
  '/dashboard',
  '/console',
];

function detect_target_type_sync(target: string): 'live' | 'static' {
  const normalized = target.toLowerCase().trim();

  if (normalized.includes('github.com') || normalized.startsWith('git@github.com')) {
    return 'static';
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return 'live';
  }

  const staticPatterns = [
    /^\/[^\/]/,
    /^\.\//,
    /^\.\.\//,
    /^[a-zA-Z]:\\/,
  ];

  for (const pattern of staticPatterns) {
    if (pattern.test(target)) {
      return 'static';
    }
  }

  const codeIndicators = ['.git', '/src/', '/code/', '.py', '.js', '.ts', '.go', '.java'];
  if (codeIndicators.some((ind) => target.includes(ind))) {
    return 'static';
  }

  return 'live';
}

function deduplicateFindings(findings: ReconResult[]): ReconResult[] {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = `${finding.asset}|${finding.finding}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildReconPrompt(target: string, tasks: Task[]): string {
  const taskDescriptions = tasks
    .filter((t) => t.agent === 'agent_alpha')
    .map((t) => `- ${t.description} (target: ${t.target})`)
    .join('\n');

  return `You are Alpha Recon, performing reconnaissance for a red team operation.

TARGET: ${target}

TASK ASSIGNMENTS:
${taskDescriptions || 'Perform general reconnaissance to discover attack surface.'}

RECONNAISSANCE OBJECTIVES:
1. API Discovery - Find /api/*, /rest/*, /graphql, /swagger endpoints
2. IDOR Patterns - Identify numeric IDs in URLs, predictable identifiers
3. Sensitive Endpoints - Hunt for /.env, /.git/config, /config.json, etc.
4. Input Vectors - Find search, login, registration endpoints
5. Authentication Analysis - Identify login endpoints, JWT in responses

TOOLS AVAILABLE:
- nmap: Network scanning (port discovery)
- curl: HTTP fingerprinting
- python: Custom scripts

Respond with a JSON array of findings:
[
  {
    "asset": "URL or endpoint discovered",
    "finding": "description of the finding",
    "confidence": 0.0-1.0,
    "evidence": "evidence supporting the finding",
    "cve_hint": null or "CVE-XXXX-XXXX if applicable",
    "recommended_action": "recommended follow-up action"
  }
]`;
}

export async function alpha_recon(
  state: RedTeamState
): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[] }> {
  logWithTimestamp(`Executing recon for mission=${state.mission_id}`);

  if (state.fast_mode) {
    const minimalFinding: ReconResult = {
      source: 'alpha_recon',
      title: 'OWASP Juice Shop Detected',
      confidence: 0.5,
      asset: state.target,
      finding: 'Target appears to be OWASP Juice Shop web application',
    };

    logWithTimestamp('Using fast mode - minimal reconnaissance');
    return {
      stateUpdate: {
        recon_results: [...state.recon_results, minimalFinding],
        phase: 'exploitation' as Phase,
      },
      messages: [],
    };
  }

  const mode = detect_target_type_sync(state.target);
  logWithTimestamp(`Detected mode=${mode} for target=${state.target}`);

  if (mode === 'static') {
    return handleStaticMode(state);
  }

  return handleLiveMode(state);
}

async function handleLiveMode(
  state: RedTeamState
): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[] }> {
  const alphaTasks = state.current_tasks.filter((t) => t.agent === 'agent_alpha');

  if (alphaTasks.length === 0) {
    logWithTimestamp('No alpha tasks assigned, skipping');
    return {
      stateUpdate: {},
      messages: [],
    };
  }

  const prompt = buildReconPrompt(state.target, alphaTasks);

  const messages = [
    { role: 'system' as const, content: 'You are Alpha Recon, a reconnaissance agent. Always respond with valid JSON.' },
    { role: 'user' as const, content: prompt },
  ];

  let rawFindings: IntelligenceReport[] = [];

  try {
    logWithTimestamp('Calling LLM for reconnaissance');
    const response = await llmClient.chatForAgent('alpha', messages);
    const parsed = JSON.parse(response);
    rawFindings = Array.isArray(parsed) ? parsed : parsed.findings || [];
    logWithTimestamp(`LLM returned ${rawFindings.length} raw findings`);
  } catch (error) {
    logWithTimestamp(`LLM parsing failed: ${error}`, 'ERROR');
    rawFindings = [];
  }

  const validatedFindings: ReconResult[] = [];
  let skippedBlueTeam = 0;

  for (const finding of rawFindings) {
    if (
      finding.source === 'blue_team' ||
      (finding.finding && finding.finding.startsWith('Blue Team:'))
    ) {
      skippedBlueTeam++;
      continue;
    }

    try {
      IntelligenceReportSchema.parse(finding);
      validatedFindings.push({
        source: 'alpha_recon',
        title: finding.recommended_action || finding.finding || 'Discovered endpoint',
        confidence: finding.confidence || 0.5,
        evidence: finding.evidence || '',
        cve_hint: finding.cve_hint || null,
        asset: finding.asset || state.target,
        finding: finding.finding || 'Discovered endpoint',
        recommended_action: finding.recommended_action || '',
      });
    } catch (error) {
      // Skip invalid findings silently
    }
  }

  if (validatedFindings.length > MAX_FINDINGS) {
    validatedFindings.sort((a, b) => b.confidence - a.confidence);
    validatedFindings.splice(MAX_FINDINGS);
  }

  const deduplicated = deduplicateFindings([
    ...state.blue_team_recon_results,
    ...validatedFindings,
  ]);

  const intelMessages: A2AMessage[] = validatedFindings.map((finding: ReconResult) => ({
    msg_id: crypto.randomUUID(),
    sender: 'agent_alpha' as AgentRole,
    recipient: 'commander' as AgentRole,
    type: 'INTELLIGENCE_REPORT' as MessageType,
    priority: (finding.confidence >= 0.8 ? 'HIGH' : 'MEDIUM') as Priority,
    payload: {
      asset: finding.asset,
      finding: finding.finding,
      confidence: finding.confidence,
      evidence: finding.evidence,
      cve_hint: finding.cve_hint,
      recommended_action: finding.recommended_action,
    },
    timestamp: new Date().toISOString(),
  }));

  logWithTimestamp(`${validatedFindings.length} new findings from LLM (skipped ${skippedBlueTeam} blue_team findings)`);

  return {
    stateUpdate: {
      recon_results: deduplicated,
      mode: 'live' as const,
    },
    messages: intelMessages,
  };
}

async function handleStaticMode(
  state: RedTeamState
): Promise<{ stateUpdate: Partial<RedTeamState>; messages: A2AMessage[] }> {
  const findings: ReconResult[] = [];

  if (state.repo_url) {
    state.blackboard.repo_path = state.repo_url;
  }

  findings.push({
    source: 'alpha_recon',
    title: 'Static Analysis Mode',
    confidence: 1.0,
    evidence: 'Repository URL provided - using static analysis',
    asset: state.target,
    finding: `Repository target detected: ${state.repo_url || state.target}`,
  });

  const intelMessages: A2AMessage[] = findings.map((finding: ReconResult) => ({
    msg_id: crypto.randomUUID(),
    sender: 'agent_alpha' as AgentRole,
    recipient: 'commander' as AgentRole,
    type: 'INTELLIGENCE_REPORT' as MessageType,
    priority: 'MEDIUM' as Priority,
    payload: {
      asset: finding.asset,
      finding: finding.finding,
      confidence: finding.confidence,
      evidence: finding.evidence,
    },
    timestamp: new Date().toISOString(),
  }));

  return {
    stateUpdate: {
      recon_results: [...state.recon_results, ...findings],
      mode: 'static' as const,
      blackboard: {
        ...state.blackboard,
        repo_path: state.repo_url || undefined,
      },
    },
    messages: intelMessages,
  };
}

export function detectTargetType(target: string): 'live' | 'static' {
  const normalized = target.toLowerCase().trim();

  if (normalized.includes('github.com') || normalized.startsWith('git@github.com')) {
    return 'static';
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return 'live';
  }

  const staticPatterns = [
    /^\/[^\/]/,
    /^\.\//,
    /^\.\.\//,
    /^[a-zA-Z]:\\/,
  ];

  for (const pattern of staticPatterns) {
    if (pattern.test(target)) {
      return 'static';
    }
  }

  const codeIndicators = ['.git', '/src/', '/code/', '.py', '.js', '.ts', '.go', '.java'];
  if (codeIndicators.some((ind) => target.includes(ind))) {
    return 'static';
  }

  return 'live';
}

export async function alpha_recon_node(
  state: RedTeamState
): Promise<Partial<RedTeamState>> {
  try {
    const { stateUpdate, messages } = await alpha_recon(state);

    return {
      ...stateUpdate,
      messages: messages,
    };
  } catch (error) {
    logWithTimestamp(`Alpha recon failed: ${error}`, 'ERROR');
    state.errors.push(`Alpha recon error: ${error}`);
    return {
      errors: state.errors,
    };
  }
}
