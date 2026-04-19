# Swarm Module Behavioral Specification

> **Purpose**: Explicit documentation of all agent behaviors, decision logic, and implicit state transitions for the TypeScript refactoring effort.
> 
> **Scope**: This document captures behaviors found in ~5000 lines of Python agent code that have **zero test coverage**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [State Machine Specification](#2-state-machine-specification)
3. [Agent Behavioral Specifications](#3-agent-behavioral-specifications)
   - 3.1 [Commander Agent](#31-commander-agent)
   - 3.2 [Alpha Recon Agent](#32-alpha-recon-agent)
   - 3.3 [Gamma Exploit Agent](#33-gamma-exploit-agent)
   - 3.4 [Critic Agent](#34-critic-agent)
   - 3.5 [HITL Gate](#35-hitl-gate)
4. [LLM Cascade Behavior](#4-llm-cascade-behavior)
5. [Redis Streams Contracts](#5-redis-streams-contracts)
6. [Token Chaining Protocol](#6-token-chaining-protocol)
7. [PentAGI Reflection Loop](#7-pentagi-reflection-loop)
8. [Stealth Mode Activation](#8-stealth-mode-activation)
9. [Deterministic Evaluation Rules](#9-deterministic-evaluation-rules)
10. [Critical Implementation Notes](#10-critical-implementation-notes)
11. [Report Generator](#11-report-generator)
12. [Blue Team Bridge](#12-blue-team-bridge)
13. [ExecSandbox Behavior](#13-execsandbox-behavior)
14. [TargetManager Lifecycle](#14-targetmanager-lifecycle)
15. [Known Inconsistencies Fixed](#15-known-inconsistencies-fixed)

---

## 1. Architecture Overview

### 1.1 System Context

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RED TEAM SWARM                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    A2A Messages    ┌─────────────┐    ┌─────────────┐     │
│  │  Commander  │◄──────────────────►│    Alpha    │    │   Gamma     │     │
│  │  (Brain)    │   Redis Streams    │  (Recon)    │    │  (Exploit)  │     │
│  └──────┬──────┘                    └──────┬──────┘    └──────┬──────┘     │
│         │                                   │                   │          │
│         │                                   │                   │          │
│         │         ┌─────────────┐          │                   │          │
│         └────────►│   Critic    │◄─────────┴───────────────────┘          │
│                   │ (Evaluator) │                                          │
│                   └──────┬──────┘                                          │
│                          │                                                 │
│                   ┌──────┴──────┐                                         │
│                   │   HITL Gate │                                         │
│                   │  (Safety)   │                                         │
│                   └─────────────┘                                         │
│                                                                              │
│  External Dependencies:                                                      │
│  • Redis Streams (A2A messaging)                                            │
│  • Supabase (persistence)                                                   │
│  • OpenRouter/Ollama (LLM cascade)                                          │
│  • Docker Sandbox (tool execution)                                          │
│  • Blue Team Bridge (defense_analytics stream)                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **A2A Communication** | All agents communicate via Redis Streams using structured A2AMessage schema |
| **State Immutability** | State updates return deltas; LangGraph merges with `operator.add` for messages |
| **Token Chaining** | Discovered credentials flow through Redis `findings:{mission_id}:tokens` hash |
| **Fail-Safe Defaults** | If LLM parsing fails, fallback to deterministic behaviors |
| **Stealth Adaptation** | Auto-activate stealth mode when Blue Team detection count > 3 |

---

## 2. State Machine Specification

### 2.1 Phase Transitions

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   planning   │────►│    recon     │────►│ exploitation │────►│  reporting   │
│  (initial)   │     │   (alpha)    │     │   (gamma)    │     │  (report)    │
└──────────────┘     └──────┬───────┘     └──────┬───────┘     └──────────────┘
                            │                    │
                            │                    │
                            ▼                    ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   observe    │◄────│  hitl_gate   │
                     │  (commander) │     │   (safety)   │
                     └──────┬───────┘     └──────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ continue │  │exploit_  │  │  report  │
       │(recon)   │  │  only    │  │ (complete)│
       └────┬─────┘  └────┬─────┘  └────┬─────┘
            │             │             │
            └─────────────┴─────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   complete   │
                   │    (end)     │
                   └──────────────┘
```

### 2.2 State Schema (RedTeamState)

```typescript
interface RedTeamState {
  // ── Mission Identity ───────────────────────────────────────
  mission_id: string;                    // UUID v4
  objective: string;                     // Mission description
  target: string;                        // URL, GitHub repo, or local path

  // ── Phase Tracking ─────────────────────────────────────────
  phase: 'planning' | 'recon' | 'exploitation' | 'reporting' | 'complete';

  // ── Message Accumulator ────────────────────────────────────
  messages: A2AMessage[];                // Append-only via operator.add

  // ── Shared Intelligence ────────────────────────────────────
  blackboard: Record<string, any>;       // Key-value store for findings

  // ── Agent Outputs ──────────────────────────────────────────
  recon_results: ReconResult[];          // Alpha's findings
  exploit_results: ExploitResult[];      // Gamma's results

  // ── Commander Strategy ─────────────────────────────────────
  current_tasks: Task[];                 // Active task assignments
  strategy: string;                      // Commander's current strategy text

  // ── Control Flow ───────────────────────────────────────────
  iteration: number;                     // Current loop iteration (0-based)
  max_iterations: number;                // Safety limit (default: 5)
  needs_human_approval: boolean;         // HITL gate flag
  human_response: string | null;         // Human's decision

  // ── Self-Reflection (Phase 3) ──────────────────────────────
  reflection_count: number;              // Number of correction attempts
  max_reflections: number;               // Max retries (default: 3)
  pending_exploit: Exploit | null;       // Exploit awaiting HITL approval

  // ── GLOBAL AUTH CHAINING ───────────────────────────────────
  discovered_credentials: Record<string, Credential>;
  contextual_memory: Record<string, any>; // Session tokens, cookies

  // ── Mission Report ─────────────────────────────────────────
  report: Report | null;
  report_path: string | null;

  // ── Blue Team Integration ──────────────────────────────────
  blue_team_findings: BlueTeamFinding[];
  blue_team_recon_results: ReconResult[];
  blue_team_intelligence_brief: string;

  // ── Error Handling ─────────────────────────────────────────
  errors: string[];

  // ── Mode Configuration ─────────────────────────────────────
  mode: 'live' | 'static' | null;        // Auto-detected if null
  fast_mode: boolean;                    // Skip recon tools
  repo_url: string | null;               // GitHub URL if mode == 'repo'
}
```

### 2.3 Should Continue Routing Logic

```typescript
function shouldContinue(state: RedTeamState): 'continue' | 'exploit_only' | 'report' {
  const { phase, iteration, max_iterations } = state;

  // CRITICAL: Check phase first
  if (phase === 'complete') {
    return 'report';
  }

  // Force completion at max iterations
  if (iteration >= max_iterations) {
    return 'report';
  }

  // Phase-based routing
  if (phase === 'exploitation') {
    return 'exploit_only';  // Skip recon, go straight to Gamma
  }

  // Default: continue recon cycle
  return 'continue';
}
```

**Behavioral Rules:**
1. `phase='complete'` **ALWAYS** routes to report (highest priority)
2. `iteration >= max_iterations` forces completion (safety limit)
3. `phase='exploitation'` skips recon to focus on exploitation
4. Default is `'continue'` to maintain recon-exploit-observe loop

---

## 3. Agent Behavioral Specifications

### 3.1 Commander Agent

#### 3.1.1 Core Responsibilities

| Function | Purpose | Trigger |
|----------|---------|---------|
| `commander_plan()` | Initial mission planning | Mission start |
| `commander_observe()` | Evaluate results & plan next iteration | After each exploit phase |

#### 3.1.2 Planning Behavior

**Input Processing:**
1. Read `objective`, `target`, `blackboard` from state
2. Fetch `blue_team_intel` from state (if available)
3. Truncate prompts to 4096 tokens for Ollama compatibility

**LLM Prompt Structure:**
```
SYSTEM: Commander system prompt with cyber kill chain rules

USER:
  MISSION OBJECTIVE: {objective}
  TARGET: {target}
  Current blackboard intelligence: {blackboard}
  BLUE TEAM STATIC ANALYSIS INTELLIGENCE: {blue_team_intel}
  
  Generate task assignments...
```

**Output Schema (JSON):**
```typescript
interface CommanderPlan {
  strategy: string;           // 2-3 sentence attack strategy
  tasks: TaskAssignment[];    // MUST have ≥1 task
}

interface TaskAssignment {
  agent: 'agent_alpha' | 'agent_gamma';
  description: string;        // Specific task description
  target: string;            // Full URL to target
  tools_allowed: string[];   // e.g., ['nmap', 'curl']
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  exploit_type: ExploitType; // OWASP category
}

type ExploitType = 
  | 'sqli' | 'xss' | 'idor' | 'lfi' 
  | 'auth_bypass' | 'info_disclosure' | 'sensitive_data_exposure'
  | 'xxe' | 'client_side_bypass' | 'authentication' 
  | 'broken_access_control';
```

**Task Generation Rules:**
1. **MUST** generate at least 1 task (schema enforces `minItems: 1`)
2. **MUST** prioritize Blue Team findings if available:
   - Start with HIGH/CRITICAL confirmed vulnerabilities
   - Target specific file paths and line numbers
   - Focus on injection points (SQLi, XSS) first
3. Tools allowed per agent:
   - Alpha: `['nmap', 'nuclei', 'curl']`
   - Gamma: `['curl', 'python', 'nuclei']`

#### 3.1.3 Observation Behavior

**State Analysis:**
1. Gather all `INTELLIGENCE_REPORT` and `EXPLOIT_RESULT` messages
2. Extract strategy memory from blackboard:
   - `successful_vectors`: List of successful exploit types
   - `compromised_endpoints`: List of exploited URLs
   - `stealth_mode`: Boolean flag
3. Fetch Blue Team defense analytics from Redis

**Defense Analytics Processing:**
```typescript
interface DefenseAnalytics {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability_type: string;
  description: string;
  blocked_payload?: string;
  detected_signature?: string;
  endpoint?: string;
}
```

**Behavioral Rules:**
1. **HIGH severity detection** → Mark endpoint as FORBIDDEN for 5 iterations
2. **Defense count > 3** → Activate stealth mode
3. **Parse failures > 3** → Terminate mission with error

**Vector Rotation Policy:**
```typescript
const VECTOR_ROTATION_RULES = {
  min_categories: 3,                    // Must rotate through ≥3 OWASP categories
  forbidden_duration: 5,                // Iterations to ban HIGH severity endpoints
  max_same_endpoint_type: 1,            // Never repeat exploit type on same endpoint
  owasp_categories: [                   // Must prioritize unexplored categories
    'sqli', 'xss', 'idor', 'lfi', 
    'auth_bypass', 'info_disclosure', 
    'sensitive_data_exposure', 'xxe'
  ]
};
```

**Task Generation Mandate:**
- If `next_phase !== 'complete'`, **MUST** generate 3-5 tasks
- Each task must target DIFFERENT endpoint or use DIFFERENT exploit type
- Tasks with priority:
  - **HIGH**: Critical vulnerabilities (SQLi, Auth Bypass, RCE)
  - **MEDIUM**: IDOR, Info Disclosure, XSS
  - **LOW**: Recon tasks when no clear vulnerabilities

#### 3.1.4 Agent Name Normalization

The Commander accepts various agent name formats and normalizes them:

```typescript
const AGENT_ROLE_MAPPING: Record<string, AgentRole> = {
  // Alpha variations
  'agent_alpha': AgentRole.ALPHA,
  'alpha': AgentRole.ALPHA,
  'recon': AgentRole.ALPHA,
  'reconnaissance': AgentRole.ALPHA,
  'scanner': AgentRole.ALPHA,
  
  // Gamma variations
  'agent_gamma': AgentRole.GAMMA,
  'gamma': AgentRole.GAMMA,
  'exploit': AgentRole.GAMMA,
  'exploitation': AgentRole.GAMMA,
  'attacker': AgentRole.GAMMA,
  
  // Critic variations
  'agent_critic': AgentRole.CRITIC,
  'critic': AgentRole.CRITIC,
  'reviewer': AgentRole.CRITIC,
  'evaluator': AgentRole.CRITIC,
  
  // Beta variations
  'agent_beta': AgentRole.BETA,
  'beta': AgentRole.BETA,
  
  // Commander
  'commander': AgentRole.COMMANDER,
};

// Unknown agents default to GAMMA
```

#### 3.1.5 Fallback Task Generation

If LLM returns 0 tasks but `next_phase !== 'complete'`, generate fallback tasks:

```typescript
function generateFallbackTasks(state: RedTeamState): Task[] {
  const successful_vectors = state.blackboard.successful_vectors || [];
  const target = state.target;
  
  // Context-aware fallbacks based on successful vectors
  if (successful_vectors.includes('idor')) {
    return [
      { agent: 'agent_gamma', exploit_type: 'idor', target: `${target}/rest/basket/6`, priority: 'HIGH' },
      { agent: 'agent_gamma', exploit_type: 'idor', target: `${target}/rest/user/1`, priority: 'HIGH' },
      { agent: 'agent_gamma', exploit_type: 'sqli', target: `${target}/rest/user/login`, priority: 'HIGH' },
    ];
  }
  
  if (successful_vectors.includes('sqli') || successful_vectors.includes('auth_bypass')) {
    return [
      { agent: 'agent_gamma', exploit_type: 'sqli', target: `${target}/rest/products`, priority: 'HIGH' },
      { agent: 'agent_gamma', exploit_type: 'xss', target: `${target}/#/search`, priority: 'MEDIUM' },
      { agent: 'agent_gamma', exploit_type: 'info_disclosure', target: `${target}/api/Products`, priority: 'MEDIUM' },
    ];
  }
  
  // Default early-iteration fallbacks
  return [
    { agent: 'agent_gamma', exploit_type: 'auth_bypass', target: `${target}/rest/user/login`, priority: 'HIGH' },
    { agent: 'agent_gamma', exploit_type: 'idor', target: `${target}/rest/basket/1`, priority: 'HIGH' },
    { agent: 'agent_alpha', exploit_type: 'recon', target, priority: 'MEDIUM' },
  ];
}
```

---

### 3.2 Alpha Recon Agent

#### 3.2.1 Core Responsibilities

Execute reconnaissance tools and analyze output for attack surface discovery.

#### 3.2.2 Mode Detection

```typescript
function detectTargetType(target: string): 'live' | 'static' {
  const normalized = target.toLowerCase().trim();
  
  // GitHub URLs -> Static analysis
  if (normalized.includes('github.com') || normalized.startsWith('git@github.com')) {
    return 'static';
  }
  
  // HTTP/HTTPS URLs (non-GitHub) -> Live mode
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return 'live';
  }
  
  // Local file paths -> Static analysis
  if (path.exists(target)) {
    return 'static';
  }
  
  // Path patterns
  const staticPatterns = [
    /^\/[^\/]/,        // Unix absolute: /home, /var
    /^\.\//,            // Relative: ./
    /^\.\.\//,          // Parent: ../
    /^[a-zA-Z]:\\\/,     // Windows: C:\
  ];
  
  for (const pattern of staticPatterns) {
    if (pattern.test(target)) {
      return 'static';
    }
  }
  
  // Code indicators
  const codeIndicators = ['.git', '/src/', '/code/', '.py', '.js', '.ts', '.go', '.java'];
  if (codeIndicators.some(ind => target.includes(ind))) {
    return 'static';
  }
  
  return 'live';  // Default
}
```

#### 3.2.3 Live Mode Behavior

**Task Execution Flow:**

1. **Filter Tasks**: Find all `TASK_ASSIGNMENT` messages addressed to `AgentRole.ALPHA`
2. **LLM Planning**: Ask LLM which tools to run based on task descriptions
3. **Tool Execution**: Execute each tool in sandbox
4. **Output Analysis**: Use LLM to parse tool output into structured findings
5. **Message Generation**: Convert findings to `INTELLIGENCE_REPORT` A2A messages

**Tool Selection (LLM Decision):**

Available tools for Alpha:
- `nmap` - Network scanning (port discovery)
- `curl` - HTTP fingerprinting (1-2s vs 120s for nuclei)
- `python` - Custom scripts

**NOT available to Alpha:**
- `sqlmap`, `ffuf`, `jwt_tool` (exploitation tools → Gamma)

**Reconnaissance Objectives (Instructed to LLM):**

1. **API Discovery**
   - Find: `/api/*`, `/rest/*`, `/graphql`, `/swagger`
   - Document: endpoint path, HTTP methods, authentication

2. **IDOR Pattern Discovery**
   - Identify: numeric IDs (`/api/users/1`), UUIDs, predictable identifiers
   - Test parameters: `id`, `user_id`, `order_id`, `file_id`

3. **Sensitive Endpoint Detection**
   - Hunt: `/.env`, `/.git/config`, `/config.json`, `/swagger.json`
   - Check: `/robots.txt`, `/sitemap.xml`, `/.well-known/`
   - Try: `/admin`, `/manage`, `/dashboard`, `/console`

4. **Input Vector Mapping**
   - Find: search, login, registration, comment endpoints
   - Document: parameter names, data types, validation patterns

5. **Authentication Analysis**
   - Identify: login endpoints, session mechanisms
   - Look for: JWT in responses, cookie settings, CORS headers

**Finding Deduplication:**

```typescript
// Skip findings that came from blue_team (already on blackboard)
if (finding.source === 'blue_team' || finding.finding.startsWith('Blue Team:')) {
  skippedBlueCount++;
  continue;
}

// Limit to max 15 findings to prevent context window flooding
const MAX_FINDINGS = 15;
if (newFindings.length > MAX_FINDINGS) {
  // Sort by confidence and take top MAX_FINDINGS
  newFindings.sort((a, b) => b.confidence - a.confidence);
  newFindings = newFindings.slice(0, MAX_FINDINGS);
}
```

#### 3.2.4 Static Mode Behavior

When `mode === 'static'`:

1. Clone GitHub repo to temp directory if URL provided
2. Run `npm audit` if `package.json` exists
3. Run `pip-audit` if `requirements.txt` exists
4. Analyze file structure (count source files)
5. Look for sensitive files (`.env`, `config.json`, etc.)
6. Store `repo_path` in blackboard for Gamma to access

```typescript
const SENSITIVE_FILES = [
  '.env', '.env.example', 'config.json', 
  'secrets.yaml', 'docker-compose.yml'
];
```

#### 3.2.5 Fast Mode

When `fast_mode === true`:
- Skip all recon tools
- Return minimal finding: "OWASP Juice Shop web application detected"
- Proceed directly to exploitation

---

### 3.3 Gamma Exploit Agent

#### 3.3.1 Core Responsibilities

Craft and execute exploits against discovered vulnerabilities. This is the most complex agent with ~1900 lines of code.

#### 3.3.2 Mode Detection

Same as Alpha: `'live'` for HTTP targets, `'static'` for code repos.

#### 3.3.3 Live Mode Behavior

**Two-Phase Execution Strategy:**

```typescript
// Phase 1: Token-generating exploits
const PHASE_1_TYPES = ['sqli', 'authentication', 'xss', 'xxe', 'command_injection'];

// Phase 2: Token-consuming exploits
const PHASE_2_TYPES = ['idor', 'auth_bypass', 'broken_access_control'];

async function executeExploits(state: RedTeamState): Promise<ExploitResult[]> {
  // Split tool calls into phases
  const phase1Calls = toolCalls.filter(tc => 
    PHASE_1_TYPES.includes(tc.exploit_type)
  );
  const phase2Calls = toolCalls.filter(tc => 
    PHASE_2_TYPES.includes(tc.exploit_type)
  );
  
  // Execute Phase 1 (parallel)
  const phase1Results = await Promise.all(
    phase1Calls.map(tc => executeSingleExploit(tc))
  );
  
  // Check if tokens were generated
  const tokenAvailable = await checkAuthTokenAvailable(missionId);
  
  // Execute Phase 2 (parallel, with tokens if available)
  const phase2Results = await Promise.all(
    phase2Calls.map(tc => executeSingleExploit(tc, tokenAvailable))
  );
  
  return [...phase1Results, ...phase2Results];
}
```

**Token Injection Logic:**

Before each exploit execution:
1. Read shared tokens from Redis: `findings:{mission_id}:tokens`
2. Inject into request headers:
   - `Authorization: Bearer {token}` for bearer tokens
   - `Cookie: {cookie}` for session cookies
3. Skip empty or invalid tokens (`len < 5`)

**Exploit Planning:**

1. Query episodic memory for successful exploits
2. Ask LLM to plan exploits based on:
   - Task assignments from Commander
   - Recon intelligence
   - Previously successful exploits (for variants)
   - Available credentials/tokens
3. Merge LLM plan with hardcoded Juice Shop arsenal
4. Generate adaptive variants based on successful patterns
5. Deduplicate exploits by `(URL, method, data)` tuple

**Adaptive Exploit Generation:**

```typescript
function generateExploitVariants(successfulExploit: ExploitResult): Exploit[] {
  const variants = [];
  const { exploit_type, target } = successfulExploit;
  
  switch (exploit_type) {
    case 'info_disclosure':
      // If /api/Products worked, try Users, Orders, Feedbacks, etc.
      if (target.includes('/api/')) {
        const endpoints = ['Users', 'Orders', 'Feedbacks', 'Challenges', 'Reviews'];
        for (const endpoint of endpoints) {
          variants.push(createVariant(target, endpoint));
        }
      }
      break;
      
    case 'idor':
      // Try different IDs for IDOR endpoints
      if (target.includes('/rest/basket/')) {
        for (const basketId of [2, 3, 4, 5, 10, 99]) {
          variants.push(createVariant(target, basketId));
        }
      }
      break;
      
    case 'auth_bypass':
      // If /admin worked, try sub-paths
      if (target.endsWith('/admin')) {
        const paths = ['/admin/users', '/admin/config', '/admin/roles'];
        for (const path of paths) {
          variants.push(createVariant(target, path));
        }
      }
      break;
  }
  
  // Limit variants to avoid explosion
  return variants.slice(0, 8);
}
```

**Payload Deduplication:**

```typescript
// Check if payload has been tried > 2 times
const payloadHash = md5(payload).slice(0, 16);
const attemptCount = await redis.getPayloadAttemptCount(missionId, payloadHash);

if (attemptCount >= 2) {
  logger.info(`Skipping payload (already tried ${attemptCount} times)`);
  return null;  // Skip this exploit
}

await redis.incrementPayloadAttempt(missionId, payloadHash);
```

**Exploit Type Constraints:**

```typescript
const EXPLOIT_TYPE_RULES = {
  max_per_type_per_iteration: {
    sqli: 1,           // Max 1 SQL injection attempt per iteration
    xss: 2,            // Max 2 XSS attempts
    idor: 5,           // Max 5 IDOR attempts
    auth_bypass: 3,
    info_disclosure: 5,
  },
  avoid_repetition: true,     // Never test same endpoint with same type twice
  prioritize_diversity: true, // Rotate through OWASP categories
};
```

#### 3.3.4 Static Mode Behavior

When `mode === 'static'`:

1. Get `repo_path` from blackboard (set by Alpha)
2. Run Semgrep with OWASP rules: `semgrep --config=p/owasp-top-ten`
3. If Semgrep unavailable, run basic pattern matching:
   - `eval\s*(` → CRITICAL
   - `innerHTML\s*[=:]` → HIGH (XSS)
   - `password\s*[=:]\s*["'][^"']+["']` → HIGH (hardcoded)
4. Return findings as `EXPLOIT_RESULT` messages

#### 3.3.5 OWASP Arsenal

Hardcoded fallback exploits covering all 10 OWASP categories:

```typescript
const JUICE_SHOP_FALLBACKS = [
  // 1. SQL Injection - Classic auth bypass
  {
    tool: 'curl',
    args: {
      url: `${target}/rest/user/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: '{"email":"admin@juice-sh.op\' OR 1=1--","password":"anything"}',
    },
    exploit_type: 'sqli',
  },
  
  // 2. Auth Bypass - Admin panel
  {
    tool: 'curl',
    args: { url: `${target}/admin`, method: 'GET' },
    exploit_type: 'auth_bypass',
  },
  
  // 3. IDOR - Basket access
  {
    tool: 'curl',
    args: { url: `${target}/rest/basket/1`, method: 'GET' },
    exploit_type: 'idor',
  },
  
  // ... (12 total categories)
];
```

---

### 3.4 Critic Agent

#### 3.4.1 Core Responsibilities

Evaluate exploit results and provide structured feedback for the PentAGI reflection loop.

#### 3.4.2 Evaluation Flow

```typescript
async function analyzeExploitResult(
  exploitType: string,
  toolName: string,
  command: string,
  result: ExecResult,
  intel?: Intelligence[],
  previousAttempts?: Attempt[]
): Promise<Evaluation> {
  
  // Step 1: Deterministic pre-check (catches obvious cases)
  const deterministic = deterministicPrecheck(result, exploitType, command);
  if (deterministic) {
    return deterministic;  // Skip LLM for obvious cases
  }
  
  // Step 2: Pre-scan for Juice Shop patterns
  const hints = scanForJuiceShopHints(result);
  const groundedFeedback = buildGroundedFeedback(hints, exploitType);
  
  // Step 3: LLM evaluation with grounded context
  const evaluation = await llmEvaluate(
    exploitType, result, intel, previousAttempts, groundedFeedback
  );
  
  // Step 4: Post-processing
  // - Preserve original exploit_type (don't let LLM change it)
  // - Add recommendation if missing
  // - Enhance feedback for server errors
  
  return evaluation;
}
```

#### 3.4.3 Deterministic Pre-Check Rules

**CRITICAL**: These rules run BEFORE LLM to prevent small models from misinterpreting clear signals.

```typescript
function deterministicPrecheck(
  result: ExecResult, 
  exploitType: string, 
  payload: string
): Evaluation | null {
  const combined = result.stdout + result.stderr;
  const statusCode = extractStatusCode(combined);
  
  // ========== HTTP 500 on Injection = Success ==========
  const INJECTION_TYPES = ['sqli', 'xss', 'xxe', 'ssti', 'command_injection'];
  
  if (statusCode === 500 && INJECTION_TYPES.includes(exploitType)) {
    const injectionChars = ["'", '"', '<', '>', ';', '|', '&', '${', '#{', '`'];
    const hasInjection = injectionChars.some(c => payload.includes(c));
    
    if (hasInjection) {
      return {
        success: true,
        evidence: `HTTP 500 triggered by ${exploitType} payload - server crash = vulnerable`,
        error_type: 'server_crash',
        severity: 'HIGH',
        deterministic: true,
      };
    }
  }
  
  // ========== HTTP 401/403 = Auth Wall ==========
  if (statusCode === 401 || statusCode === 403) {
    return {
      success: false,
      evidence: `HTTP ${statusCode} - Authentication required`,
      error_type: 'auth_required',
      feedback: 'Try using session tokens from previous exploits',
      severity: 'low',
      recommendation: 'chain_token',
      deterministic: true,
    };
  }
  
  // ========== HTTP 404 = Not Found ==========
  if (statusCode === 404) {
    return {
      success: false,
      evidence: 'HTTP 404 - Endpoint not found',
      error_type: 'not_found',
      recommendation: 'pivot',
      deterministic: true,
    };
  }
  
  // ========== IDOR Success Rule ==========
  if (statusCode === 200 && exploitType === 'idor') {
    const contentType = extractContentType(combined);
    if (contentType.includes('application/json') && combined.includes('"id"')) {
      return {
        success: true,
        evidence: "HTTP 200 OK with JSON containing 'id' field - IDOR confirmed",
        error_type: 'none',
        severity: 'HIGH',
        deterministic: true,
      };
    }
  }
  
  // ========== .git Exposure = CRITICAL ==========
  if (statusCode === 200 && payload.includes('/.git/')) {
    const gitIndicators = ['ref:', 'HEAD', '[core]', 'git@github.com'];
    if (gitIndicators.some(ind => combined.includes(ind))) {
      return {
        success: true,
        evidence: 'CRITICAL: /.git/ exposed - source code reconstruction possible',
        error_type: 'none',
        severity: 'CRITICAL',
        recommendation: 'escalate',
        deterministic: true,
      };
    }
  }
  
  // ========== SPA Catchall Filter ==========
  if (statusCode === 200) {
    const contentType = extractContentType(combined);
    if (contentType === 'text/html' && isApiEndpoint(payload)) {
      return {
        success: false,
        evidence: 'HTTP 200 but returned HTML (SPA catchall)',
        error_type: 'spa_catchall',
        recommendation: 'pivot',
        deterministic: true,
      };
    }
  }
  
  // Fall through to LLM for ambiguous cases
  return null;
}
```

#### 3.4.4 Error Type Patterns

```typescript
const ERROR_PATTERNS: Record<ErrorType, RegExp[]> = {
  syntax_error: [
    /SyntaxError:/,
    /Parse error/,
    /unexpected token/,
    /JSONDecodeError/,
    /NameError:/,
    /TypeError:/,
  ],
  waf_block: [
    /403 Forbidden/,
    /WAF/,
    /ModSecurity/,
    /blocked/,
    /detected malicious/,
  ],
  auth_failure: [
    /401 Unauthorized/,
    /Invalid credentials/,
    /login failed/,
    /Session expired/,
  ],
  timeout: [
    /timeout/,
    /timed out/,
    /Connection timed out/,
  ],
  not_found: [
    /404 Not Found/,
    /Endpoint not found/,
    /Cannot GET/,
  ],
  rate_limit: [
    /429 Too Many Requests/,
    /rate limit/,
  ],
  server_error: [
    /500 Internal Server Error/,
    /502 Bad Gateway/,
    /503 Service Unavailable/,
  ],
};
```

#### 3.4.5 Success Criteria by Exploit Type

```typescript
const SUCCESS_CRITERIA: Record<ExploitType, string[]> = {
  sqli: [
    'Boolean-based true/false in response',
    'UNION works',
    'SQLite/Sequelize errors (query executed)',
    'Authentication bypassed',
    'JWT token returned',
    'User ID returned',
  ],
  xss: [
    'Script tags in response',
    'Payload stored/reflected',
    'HTTP 200/201 with JSON confirmation (stored XSS)',
  ],
  auth_bypass: [
    'Access to admin panel',
    'Elevated privileges',
    'JWT token in response',
  ],
  idor: [
    'Access to other users\' data',
    'Different user IDs in responses',
    'HTTP 200 OK with JSON containing "id"',
  ],
  info_disclosure: [
    'JSON arrays/objects returned',
    'Database fields visible',
  ],
  xxe: [
    'File contents retrieved (/etc/passwd)',
    'Error messages showing file system',
  ],
};
```

#### 3.4.6 Juice Shop Pattern Detection

```typescript
const JUICE_SHOP_PATTERNS = {
  sequelize: [/Sequelize/, /sequelize/, /SQLITE/, /sqlite/],
  express: [/Express/, /express/, /Node.js/],
  jwt: [/jwt/, /JWT/, /JsonWebToken/],
  sql_syntax_error: [
    /SQLITE_CANTOPEN/,
    /SQL syntax/,
    /near .* syntax error/,
  ],
  success_indicators: [
    /"id":/,
    /"token":/,
    /"email":/,
    /"role":/,
    /authentication/,
    /success/,
    /admin/,
    /customer/,
    /200 OK/,
  ],
};
```

---

### 3.5 HITL Gate

#### 3.5.1 Core Responsibilities

Human-in-the-loop safety check for destructive exploits.

#### 3.5.2 Destructive Pattern Detection

```typescript
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bDROP\s+/,           // SQL DROP
  /\bDELETE\s+FROM/,     // SQL DELETE
  /\bTRUNCATE\s+/,       // SQL TRUNCATE
  /\bUPDATE\s+.*\bSET\s+/, // SQL UPDATE
  /\bINSERT\s+INTO/,     // SQL INSERT
  /\bSHUTDOWN\b/,        // System shutdown
  /\bEXEC\s+\(/,         // Command execution
  /\beval\s*\(/,         // Code evaluation
  /rm\s+-rf/,            // File deletion
  /format\s+/,           // Disk format
  /dd\s+if=/,            // Disk dump
];

function isDestructivePayload(payload: string | object): boolean {
  const payloadStr = typeof payload === 'object' 
    ? JSON.stringify(payload) 
    : payload;
  
  return DESTRUCTIVE_PATTERNS.some(pattern => 
    pattern.test(payloadStr.toUpperCase())
  );
}
```

#### 3.5.3 Gate Behavior

```typescript
async function hitlApprovalGate(state: RedTeamState): Promise<StateUpdate> {
  const warnings: string[] = [];
  
  for (const result of state.exploit_results) {
    const payload = result.payload_used || '';
    
    if (isDestructivePayload(payload)) {
      warnings.push(
        `DESTRUCTIVE PAYLOAD: ${result.exploit_type} on ${result.target}`
      );
    }
  }
  
  // Current implementation logs warnings but doesn't block
  // Future: Add actual human approval flow
  
  return { errors: warnings };
}
```

---

## 4. LLM Cascade Behavior

### 4.1 Cascade Priority Order

```
1st → OpenRouter primary model
      ↓ (timeout: 15s)
2nd → OpenRouter fallback chain (deepseek-r1:free → qwq-32b:free)
      ↓ (timeout: 15s each)
3rd → Ollama local (last resort)
```

### 4.2 Model Selection Logic

```typescript
class LLMClient {
  async chat(options: ChatOptions): Promise<string> {
    const { model, messages, temperature, fallback_model } = options;
    
    // Check if Ollama model (no "/" in name)
    const isOllamaModel = !model.includes('/');
    
    if (isOllamaModel) {
      // DEMO MODE: Use Ollama directly
      try {
        return await ollamaClient.chat({ model, messages, temperature });
      } catch (e) {
        // Try fallback Ollama model
        const ollamaFallback = fallback_model || 'qwen2.5-coder:7b-instruct';
        return await ollamaClient.chat({ 
          model: ollamaFallback, 
          messages, 
          temperature 
        });
      }
    }
    
    // OpenRouter model
    if (hasOpenRouterKey()) {
      try {
        return await openRouterClient.chat(options);
      } catch (e) {
        logger.warning('OpenRouter cascade exhausted, falling back to Ollama');
      }
    }
    
    // Fallback to Ollama
    const ollamaModel = fallback_model || settings.commander_model_fallback;
    return await ollamaClient.chat({ 
      model: ollamaModel, 
      messages, 
      temperature 
    });
  }
}
```

### 4.3 Per-Agent Model Configuration

| Agent | Primary Model | Fallback Model | Temperature |
|-------|--------------|----------------|-------------|
| Commander | `settings.commander_model` | `settings.commander_model_fallback` | 0.3 |
| Alpha | `settings.recon_model` | `settings.recon_model_fallback` | 0.2 |
| Gamma | `settings.exploit_model` | `settings.exploit_model_fallback` | 0.2 |
| Critic | `settings.critic_model` | `settings.critic_model_fallback` | 0.1 |

### 4.4 JSON Schema Constraints

For Ollama models, use grammar-based JSON decoding:

```typescript
const COMMANDER_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['analysis', 'next_phase', 'strategy', 'stealth_mode', 'tasks'],
  properties: {
    analysis: { type: 'string' },
    next_phase: { 
      type: 'string', 
      enum: ['recon', 'exploitation', 'complete'] 
    },
    strategy: { type: 'string' },
    stealth_mode: { type: 'boolean' },
    tasks: {
      type: 'array',
      minItems: 1,  // Hard constraint
      items: {
        type: 'object',
        required: ['agent', 'description', 'target', 'tools_allowed', 'priority', 'exploit_type'],
        properties: {
          agent: { 
            type: 'string', 
            enum: ['agent_alpha', 'agent_gamma'] 
          },
          description: { type: 'string' },
          target: { type: 'string' },
          tools_allowed: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          priority: { 
            type: 'string', 
            enum: ['HIGH', 'MEDIUM', 'LOW'] 
          },
          exploit_type: {
            type: 'string',
            enum: ['sqli', 'xss', 'idor', 'lfi', 'auth_bypass', 
                   'info_disclosure', 'sensitive_data_exposure', 
                   'xxe', 'client_side_bypass', 'authentication', 
                   'broken_access_control']
          }
        }
      }
    }
  }
};
```

---

## 5. Redis Streams Contracts

### 5.1 Stream Names

```typescript
const STREAMS = {
  // Agent-to-agent communication
  A2A_MESSAGES: 'a2a_messages',
  
  // Red team kill chain events
  RED_TEAM_EVENTS: 'red_team_events',
  
  // Blue Team → Red Team bridge (CRITICAL: shared with VibeCheck)
  DEFENSE_ANALYTICS: 'defense_analytics',
};
```

### 5.2 A2A Message Schema

```typescript
interface A2AMessage {
  msg_id: string;           // UUID v4
  sender: AgentRole;        // COMMANDER | ALPHA | BETA | GAMMA | CRITIC
  recipient: AgentRole | 'all';
  type: MessageType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  payload: Record<string, any>;
  timestamp: ISO8601;       // UTC
}

enum AgentRole {
  COMMANDER = 'commander',
  ALPHA = 'agent_alpha',
  BETA = 'agent_beta',
  GAMMA = 'agent_gamma',
  CRITIC = 'agent_critic',
}

enum MessageType {
  // Commander → Agents
  TASK_ASSIGNMENT = 'TASK_ASSIGNMENT',
  STRATEGY_UPDATE = 'STRATEGY_UPDATE',
  
  // Agents → Commander
  INTELLIGENCE_REPORT = 'INTELLIGENCE_REPORT',
  EXPLOIT_RESULT = 'EXPLOIT_RESULT',
  STATUS_UPDATE = 'STATUS_UPDATE',
  
  // HITL
  HITL_REQUEST = 'HITL_REQUEST',
  HITL_RESPONSE = 'HITL_RESPONSE',
  
  // System
  MISSION_START = 'MISSION_START',
  MISSION_COMPLETE = 'MISSION_COMPLETE',
}
```

### 5.3 Defense Analytics Stream Contract

**⚠️ CRITICAL**: This stream is shared with VibeCheck Blue Team. Schema changes require coordination.

```typescript
interface DefenseAnalyticsMessage {
  // Required fields
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability_type: string;
  description: string;
  timestamp: ISO8601;
  
  // Optional fields
  blocked_payload?: string;
  detected_signature?: string;
  endpoint?: string;
  target?: string;
  mission_id?: string;
  
  // Source tracking
  source: 'blue_team' | 'waf' | 'ids';
  agent?: string;
}
```

**Producer**: VibeCheck Blue Team  
**Consumer**: Swarm Commander (via `get_latest_defense_intel()`)

### 5.4 Blackboard Schema

```typescript
// Redis key: redteam:blackboard:{mission_id}
interface Blackboard {
  // Strategy memory
  successful_vectors: string[];
  compromised_endpoints: string[];
  stealth_mode: boolean;
  forbidden_endpoints: string[];
  forbidden_until_iteration: number;
  
  // Mission state
  last_analysis: string;
  current_strategy: string;
  
  // Shared context
  repo_path?: string;
  
  // Custom data
  [key: string]: any;
}
```

### 5.5 Shared Findings Store

```typescript
// Redis key: redteam:findings:{mission_id}:{category}
interface FindingsStore {
  // Category: 'tokens'
  tokens: {
    Authorization?: string;  // Bearer token
    Cookie?: string;         // Session cookie
    [name: string]: string;  // Custom tokens
  };
  
  // Category: 'credentials'
  credentials: {
    [name: string]: {
      value: string;
      type: 'jwt' | 'cookie' | 'basic';
      target: string;
    };
  };
  
  // Category: 'successful_payloads'
  successful_payloads: {
    [hash: string]: {
      payload: string;
      exploit_type: string;
      target: string;
      timestamp: ISO8601;
    };
  };
  
  // Category: 'endpoints'
  endpoints: {
    [url: string]: {
      discovered_at: ISO8601;
      methods: string[];
      auth_required: boolean;
    };
  };
  
  // Category: 'owasp_successes'
  owasp_successes: {
    [exploit_type: string]: 'true';
  };
}
```

### 5.6 Payload Attempt Tracking

```typescript
// Redis key: redteam:payload_attempts:{mission_id}
interface PayloadAttempts {
  [payloadHash: string]: number;  // Attempt count (max 2)
}

async function checkPayloadLimit(
  missionId: string, 
  payload: string
): Promise<boolean> {
  const hash = md5(payload).slice(0, 16);
  const count = await redis.hget(`redteam:payload_attempts:${missionId}`, hash);
  
  if (parseInt(count || '0') >= 2) {
    return false;  // Exceeded limit
  }
  
  await redis.hincrby(`redteam:payload_attempts:${missionId}`, hash, 1);
  return true;
}
```

---

## 6. Token Chaining Protocol

### 6.1 Token Discovery

Tokens discovered during exploitation are automatically extracted:

```typescript
interface DiscoveredToken {
  name: string;
  value: string;
  type: 'jwt' | 'cookie' | 'bearer' | 'api_key';
  source: 'critic_analysis' | 'response_scan';
  timestamp: ISO8601;
}

function extractSessionTokens(result: ExecResult): DiscoveredToken[] {
  const tokens: DiscoveredToken[] = [];
  const combined = result.stdout + result.stderr;
  
  // JWT pattern
  const jwtMatch = combined.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch && isValidJWT(jwtMatch[0])) {
    tokens.push({
      name: 'bearer_token',
      value: jwtMatch[0],
      type: 'jwt',
      source: 'response_scan',
    });
  }
  
  // Cookie pattern
  const cookieMatch = combined.match(/Set-Cookie:\s*([^;]+)/i);
  if (cookieMatch) {
    tokens.push({
      name: 'cookie',
      value: cookieMatch[1],
      type: 'cookie',
      source: 'response_scan',
    });
  }
  
  return tokens;
}

function isValidJWT(token: string): boolean {
  // Remove 'Bearer ' prefix if present
  const cleanToken = token.replace(/^Bearer\s+/i, '');
  
  // JWT should have 3 parts separated by dots
  const parts = cleanToken.split('.');
  if (parts.length !== 3) return false;
  
  // Each part should be base64url (alphanumeric + _ + -)
  for (const part of parts) {
    if (part.length < 4) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return false;
  }
  
  return true;
}
```

### 6.2 Token Storage Rules

```typescript
async function writeSharedToken(
  missionId: string,
  tokenName: string,
  tokenValue: string
): Promise<void> {
  // Skip obviously invalid tokens
  if (tokenName === 'Authorization' && !isValidJWT(tokenValue)) {
    logger.debug(`Skipping invalid JWT: ${tokenValue.slice(0, 30)}...`);
    return;
  }
  
  // Don't overwrite longer (better) tokens
  const existing = await redis.findingsLoad(missionId, 'tokens', tokenName);
  if (existing) {
    const existingVal = String(existing);
    const newVal = String(tokenValue);
    
    // Longer JWT is likely more complete/real
    if (existingVal.length > newVal.length) {
      logger.debug(`Keeping existing ${tokenName} (longer/better)`);
      return;
    }
  }
  
  await redis.findingsStore(missionId, 'tokens', tokenName, tokenValue);
  logger.info(`Stored ${tokenName} in Redis for other exploits`);
}
```

### 6.3 Token Injection

Before each exploit execution, tokens are automatically injected:

```typescript
async function injectTokens(
  toolArgs: ToolArgs, 
  missionId: string
): Promise<ToolArgs> {
  const tokens = await readSharedTokens(missionId);
  
  if (Object.keys(tokens).length === 0) {
    return toolArgs;
  }
  
  const headers = toolArgs.headers || {};
  
  for (const [name, value] of Object.entries(tokens)) {
    // Skip empty or invalid values
    if (!value || value === ':' || value.length < 5) {
      continue;
    }
    
    if (name.toLowerCase().startsWith('bearer') || name === 'Authorization') {
      const bearerValue = value.startsWith('Bearer') ? value : `Bearer ${value}`;
      headers['Authorization'] = bearerValue;
    } else if (name.toLowerCase() === 'cookie') {
      headers['Cookie'] = value;
    } else if (!(name in headers)) {
      headers[name] = value;
    }
  }
  
  return { ...toolArgs, headers };
}
```

---

## 7. PentAGI Reflection Loop

### 7.1 Overview

The PentAGI reflection loop enables Gamma to self-correct failed exploits using Critic feedback.

### 7.2 Loop Structure

```
Gamma (Plan/Execute) 
    ↓
Sandbox (Execute tool)
    ↓
Critic (Evaluate result)
    ↓
[If failed AND reflection_count < max_reflections]
    ↓
Reflection (LLM-guided correction)
    ↓
Gamma (Retry with corrected payload)
    ↓
[Repeat until success or max_reflections reached]
```

### 7.3 Reflection Trigger Conditions

```typescript
function shouldReflect(
  state: RedTeamState, 
  analysis: Evaluation
): boolean {
  // Don't reflect on successful exploits
  if (analysis.success) return false;
  
  // Check reflection limits
  if (state.reflection_count >= state.max_reflections) {
    logger.warning(`Max reflections (${state.max_reflections}) reached`);
    return false;
  }
  
  // Don't reflect on certain error types
  if (analysis.error_type === 'not_found') {
    logger.info('Not reflecting: endpoint does not exist');
    return false;
  }
  
  return true;
}
```

### 7.4 Reflection Prompt

```typescript
const REFLECTION_PROMPT = `You are Agent Gamma performing self-reflection on a FAILED exploit attempt.

CRITIC FEEDBACK:
- Error Type: {error_type}
- Feedback: {feedback}
- Severity: {severity}

ORIGINAL EXPLOIT TYPE: {exploit_type}
ORIGINAL PAYLOAD: {payload}
ORIGINAL COMMAND: {command}

RESULT:
Exit Code: {exit_code}
STDOUT: {stdout}
STDERR: {stderr}

CONTEXTUAL MEMORY (use tokens/cookies discovered in previous attempts):
{memory}

ERROR ANALYSIS: {error_analysis}

SPECIFIC CORRECTION STRATEGY based on error type:
- syntax_error: Fix Python/curl syntax first - DO NOT change the exploit logic
- waf_block: Try URL encoding, base64 encoding, or different attack vector
- auth_failure: Try using discovered session tokens or cookies from memory
- timeout: Try time-based blind injection or slower approach
- not_found: Verify endpoint path from recon intel, try alternative paths
- rate_limit: Add delays between requests

Respond in JSON:
{
  "corrected": true/false,
  "reasoning": "what went wrong and how you're fixing it",
  "new_tool_call": {
    "tool": "curl" | "python",
    "args": {
      "url": "full URL",
      "method": "GET or POST",
      "headers": {"Content-Type": "application/json"},
      "data": "request body"
    },
    "exploit_type": "sqli|xss|auth_bypass|etc"
  }
}`;
```

### 7.5 Reflection Implementation

```typescript
async function selfReflectAndRetry(
  state: RedTeamState,
  toolCall: ToolCall,
  result: ExecResult,
  analysis: Evaluation,
  contextualMemory?: Record<string, any>
): Promise<ToolCall | null> {
  
  const reflectionCount = state.reflection_count || 0;
  const maxReflections = state.max_reflections || 3;
  
  if (reflectionCount >= maxReflections) {
    return null;
  }
  
  const prompt = REFLECTION_PROMPT
    .replace('{error_type}', analysis.error_type)
    .replace('{feedback}', analysis.feedback)
    .replace('{severity}', analysis.severity)
    .replace('{exploit_type}', toolCall.exploit_type)
    .replace('{payload}', JSON.stringify(toolCall.args))
    .replace('{command}', result.command)
    .replace('{exit_code}', String(result.exit_code))
    .replace('{stdout}', result.stdout?.slice(0, 1500) || '(empty)')
    .replace('{stderr}', result.stderr?.slice(0, 500) || '(empty)')
    .replace('{memory}', JSON.stringify(contextualMemory, null, 2))
    .replace('{error_analysis}', analysis.evidence);
  
  const response = await llmClient.chat({
    model: settings.exploit_model,
    messages: [
      { role: 'system', content: 'You are a security expert performing self-reflection...' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    fallback_model: settings.exploit_model_fallback,
  });
  
  const reflection = parseJsonResponse(response);
  
  if (!reflection?.corrected) {
    logger.info(`Reflection determined exploit cannot be corrected`);
    return null;
  }
  
  const newToolCall = reflection.new_tool_call;
  
  // Ensure new_tool_call is a dict, not a string
  if (typeof newToolCall === 'string') {
    try {
      return JSON.parse(newToolCall);
    } catch {
      return null;
    }
  }
  
  return newToolCall;
}
```

---

## 8. Stealth Mode Activation

### 8.1 Activation Triggers

```typescript
interface StealthTriggers {
  defense_alert_count: number;      // Activate if > 3
  high_severity_detected: boolean;  // Activate if HIGH/CRITICAL alert
  consecutive_failures: number;     // Activate if > 5
}

function shouldActivateStealthMode(
  defenseIntel: DefenseAnalytics[],
  state: RedTeamState
): boolean {
  const alertCount = defenseIntel.length;
  const hasHighSeverity = defenseIntel.some(
    d => d.severity === 'HIGH' || d.severity === 'CRITICAL'
  );
  
  return alertCount > 3 || hasHighSeverity;
}
```

### 8.2 Stealth Mode Actions

When stealth mode is active:

1. **Header Rotation**
   ```typescript
   const STEALTH_HEADERS = {
     'X-Forwarded-For': '127.0.0.1',
     'User-Agent': randomFromList(USER_AGENTS),
     'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
   };
   ```

2. **Payload Encoding**
   - URL encode: `%27` instead of `'`
   - Double URL encode: `%2527` for WAF evasion
   - Base64 wrap for complex payloads

3. **Request Timing**
   - Add delays between requests: `--connect-timeout 30`
   - Use POST instead of GET for payload delivery
   - Split payloads across multiple parameters

4. **Comment Injection**
   - Use `/**/` between SQL keywords: `SELECT/**/1/**/FROM/**/users`

### 8.3 Stealth Mode Propagation

```typescript
// Commander sets stealth_mode in blackboard
if (shouldActivateStealthMode(defenseIntel, state)) {
  state.blackboard.stealth_mode = true;
  logger.warning('🛡️ STEALTH MODE ACTIVATED');
}

// Gamma reads stealth_mode before executing exploits
const stealthMode = state.blackboard.stealth_mode || false;
if (stealthMode) {
  toolArgs = applyStealthTechniques(toolArgs);
}
```

---

## 9. Deterministic Evaluation Rules

### 9.1 HTTP Status Code Rules

| Status | Exploit Type | Result | Evidence |
|--------|-------------|--------|----------|
| 500 | injection (sqli/xss/xxe) | **SUCCESS** | Payload crashed server |
| 401/403 | any | FAILURE | Auth required |
| 404 | any | FAILURE | Endpoint not found |
| 429 | any | FAILURE | Rate limited |
| 200 + JSON + `"id"` | idor | **SUCCESS** | IDOR confirmed |
| 200 + git content | any | **SUCCESS** | .git exposed |
| 200 + HTML (API endpoint) | any | FAILURE | SPA catchall |

### 9.2 Exit Code Rules

| Exit Code | Meaning | Result |
|-----------|---------|--------|
| 0 | Success | Depends on output |
| 7 | Connection failed | FAILURE (network issue) |
| 18 | Partial transfer | **SUCCESS** if >1000 bytes received |
| 28 | Timeout | FAILURE (retry) |
| 35 | SSL error | FAILURE |

### 9.3 Pattern-Based Rules

```typescript
const DETERMINISTIC_PATTERNS = {
  // SQL Injection success
  sqli_success: [
    /SQLITE_ERROR/i,
    /SQLITE_CANTOPEN/i,
    /MySQL error/i,
    /ORA-\d+/i,
    /union select/i,
  ],
  
  // XSS success
  xss_success: [
    /<script/i,
    /alert\s*\(/i,
    /onerror\s*=/i,
    /javascript:/i,
  ],
  
  // Auth bypass success
  auth_success: [
    /"token":\s*"[^"]+"/i,
    /admin/i,
    /dashboard/i,
    /welcome/i,
  ],
  
  // Info disclosure success
  info_disclosure_success: [
    /"password":/i,
    /"secret":/i,
    /api[_-]?key/i,
    /-----BEGIN/i,
  ],
};
```

---

## 10. Critical Implementation Notes

### 10.1 Load-Bearing Decisions

| Decision | Impact | Validation Required |
|----------|--------|---------------------|
| **Phase 1: State Machine** | Backbone of entire swarm | Integration tests for all phase transitions |
| **Phase 5: LLM Cascade** | Mission-critical reliability | Prototype failover with actual rate limits |

### 10.2 Silent Regression Risks

The following behaviors are implicit in ~5000 lines of code with **zero test coverage**:

1. **Commander task assignment** under partial Blue Team intel
2. **Alpha Recon tool selection** (nmap vs nuclei vs curl)
3. **Gamma Exploit token chaining** sequences
4. **Critic scoring algorithm** (deterministic + LLM blend)
5. **HITL Gate approval/rejection** patterns
6. **LLM cascade failover** at each tier
7. **Sandbox container reuse** vs teardown decisions
8. **Phase transition guards** (what causes `planning → recon` to fail)

### 10.3 Testing Requirements

Every behavioral spec in this document must have a corresponding test in the TypeScript rewrite:

```typescript
// Example: Phase transition test
describe('State Machine', () => {
  test('should route to report when phase=complete', () => {
    const state = createState({ phase: 'complete' });
    expect(shouldContinue(state)).toBe('report');
  });
  
  test('should force completion at max_iterations', () => {
    const state = createState({ iteration: 5, max_iterations: 5 });
    expect(shouldContinue(state)).toBe('report');
  });
  
  test('should route to exploit_only when phase=exploitation', () => {
    const state = createState({ phase: 'exploitation' });
    expect(shouldContinue(state)).toBe('exploit_only');
  });
});

// Example: Deterministic evaluation test
describe('Critic Deterministic Rules', () => {
  test('should mark HTTP 500 on SQLi as success', () => {
    const result = createExecResult({ 
      exitCode: 0, 
      stdout: 'HTTP/1.1 500 Internal Server Error\n...' 
    });
    const evaluation = deterministicPrecheck(result, 'sqli', "' OR 1=1--");
    expect(evaluation?.success).toBe(true);
  });
  
  test('should skip invalid JWT tokens', () => {
    const isValid = isValidJWT('www.owasp.org');
    expect(isValid).toBe(false);
  });
});
```

### 10.4 Migration Order Reminder

1. **Phase 1** (LOAD-BEARING): State machine design - **DO NOT PROCEED without passing integration tests**
2. **Phase 2**: Wait for VibeCheck Phase 2 to complete stream contract locking
3. **Phase 3**: Redis Streams port - **Coordinate `defense_analytics` schema with VibeCheck**
4. **Phase 5** (LOAD-BEARING): LLM cascade - **Prototype failover with actual rate limits**
5. **Phase 8**: Implement agents - **Each agent needs behavioral spec tests**

### 10.5 Cross-Module Contract

**⚠️ DEFENSE_ANALYTICS STREAM** is shared with VibeCheck:

| Field | Type | Required | Producer | Consumer |
|-------|------|----------|----------|----------|
| severity | string | ✅ | VibeCheck | Swarm |
| vulnerability_type | string | ✅ | VibeCheck | Swarm |
| description | string | ✅ | VibeCheck | Swarm |
| blocked_payload | string | ❌ | VibeCheck | Swarm |
| endpoint | string | ❌ | VibeCheck | Swarm |

**Before changing any field**: Coordinate with VibeCheck team and version the stream (e.g., `defense_analytics:v2`).

---

## Appendix A: A2A Message Examples

### Task Assignment
```json
{
  "msg_id": "550e8400-e29b-41d4-a716-446655440000",
  "sender": "commander",
  "recipient": "agent_gamma",
  "type": "TASK_ASSIGNMENT",
  "priority": "HIGH",
  "payload": {
    "task_id": "abc123",
    "description": "Test SQLi on login endpoint using Blue Team intel",
    "target": "http://localhost:3000/rest/user/login",
    "tools_allowed": ["curl"],
    "constraints": [],
    "exploit_type": "sqli"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Intelligence Report
```json
{
  "msg_id": "550e8400-e29b-41d4-a716-446655440001",
  "sender": "agent_alpha",
  "recipient": "commander",
  "type": "INTELLIGENCE_REPORT",
  "priority": "HIGH",
  "payload": {
    "asset": "http://localhost:3000",
    "finding": "Admin panel exposed at /admin",
    "confidence": 0.9,
    "evidence": "HTTP 200 OK, no auth required",
    "cve_hint": null,
    "recommended_action": "Test auth bypass on /admin"
  },
  "timestamp": "2024-01-15T10:31:00Z"
}
```

### Exploit Result
```json
{
  "msg_id": "550e8400-e29b-41d4-a716-446655440002",
  "sender": "agent_gamma",
  "recipient": "commander",
  "type": "EXPLOIT_RESULT",
  "priority": "CRITICAL",
  "payload": {
    "target": "http://localhost:3000/rest/user/login",
    "exploit_type": "sqli",
    "success": true,
    "payload_used": "' OR 1=1--",
    "response_code": 200,
    "evidence": "JWT token returned: eyJhbGciOiJ...",
    "impact": "Authentication bypass achieved",
    "execution_time": 1.23
  },
  "timestamp": "2024-01-15T10:32:00Z"
}
```

---

## Appendix B: Configuration Reference

### Environment Variables

```bash
# LLM Models
COMMANDER_MODEL=google/gemini-2.0-flash-exp:free
COMMANDER_MODEL_FALLBACK=qwen2.5-coder:7b-instruct
RECON_MODEL=qwen2.5-coder:7b-instruct
RECON_MODEL_FALLBACK=qwen2.5-coder:3b-instruct
EXPLOIT_MODEL=google/gemini-2.0-flash-exp:free
EXPLOIT_MODEL_FALLBACK=deepseek-r1:free
CRITIC_MODEL=qwen2.5-coder:7b-instruct
CRITIC_MODEL_FALLBACK=qwen2.5-coder:3b-instruct

# API Keys
OPENROUTER_API_KEY=sk-or-v1-...

# Redis
REDIS_URL=redis://localhost:6379/0

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Default Mission Settings
DEFAULT_MAX_ITERATIONS=5
DEFAULT_MAX_REFLECTIONS=3
```

---

---

## 11. Report Generator

### 11.1 Core Responsibilities

Generate comprehensive mission reports in both JSON (structured data) and Markdown (human-readable) formats upon mission completion.

### 11.2 Report Schema

```typescript
interface MissionReport {
  report_metadata: {
    generated_at: ISO8601;           // UTC timestamp
    mission_id: string;              // UUID from state
    report_version: "1.0";
  };
  
  mission_summary: {
    objective: string;               // Mission objective
    target: string;                  // Target URL/repo
    final_phase: Phase;              // Final state phase
    iterations_completed: number;    // Total iterations run
    max_iterations: number;          // Iteration limit
    strategy: string;                // Final strategy text
  };
  
  reconnaissance_findings: ReconFinding[];   // Deduplicated recon results
  exploitation_results: ExploitResult[];     // Deduplicated exploit results
  
  kill_chain_progress: {
    phases_completed: KillChainPhase[];      // ['reconnaissance', 'weaponization', ...]
    total_phases: 7;                         // Standard cyber kill chain
    progress_percentage: number;             // 0-100 completion
    successful_exploits: number;
    narrative: KillChainNarrativeStep[];     // Step-by-step progression
  };
  
  statistics: {
    total_messages: number;
    intel_reports: number;
    exploit_attempts: number;
    successful_exploits: number;
    high_confidence_findings: number;        // confidence >= 0.8
    reflection_count: number;
    errors_count: number;
  };
  
  recommendations: string[];         // Prioritized remediation advice
  errors: string[];                  // Errors encountered during mission
}

type KillChainPhase = 
  | 'reconnaissance' 
  | 'weaponization' 
  | 'exploitation' 
  | 'installation' 
  | 'c2' 
  | 'actions_on_objectives';

interface KillChainNarrativeStep {
  step: number;
  phase: string;
  finding: string;
  asset: string;
  exploit_type: string;
  impact: string;                    // Human-readable impact label
  evidence: string;                  // First 200 chars of evidence
  credentials_discovered: boolean;
}
```

### 11.3 Finding Deduplication

**Reconnaissance Findings Deduplication:**

```typescript
function deduplicateFindings(
  findings: ReconFinding[], 
  keyFields: string[] = ['asset', 'finding']
): ReconFinding[] {
  const seen = new Set<string>();
  
  return findings.filter(finding => {
    // Create unique key from specified fields
    const key = keyFields.map(f => finding[f] || '').join('|');
    
    if (seen.has(key)) {
      return false;  // Skip duplicate
    }
    seen.add(key);
    return true;
  });
}
```

**Exploitation Results Deduplication:**

```typescript
function deduplicateExploits(exploits: ExploitResult[]): ExploitResult[] {
  // Group by (target, exploit_type) - ignore success flag for grouping
  const grouped = groupBy(exploits, e => `${e.target}|${e.exploit_type}`);
  
  // Keep the BEST result from each group
  return Object.values(grouped).map(group => {
    return group.sort((a, b) => {
      // Priority: success=True > connection_timeout > auth_required > other failures
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);
      return priorityA - priorityB;
    })[0];  // Return highest priority (lowest number)
  });
}

function getPriority(exploit: ExploitResult): number {
  if (exploit.success) return 0;                    // Success always wins
  if (exploit.error_type === 'connection_timeout') return 1;  // Network issues are soft failures
  if (exploit.error_type === 'auth_required') return 2;       // Auth failures might be retryable
  return 3;                                         // Other failures
}
```

### 11.4 Kill Chain Analysis

```typescript
function analyzeKillChain(state: RedTeamState): KillChainProgress {
  const phasesCompleted: KillChainPhase[] = [];
  
  // Phase detection logic
  if (hasReconResults(state)) {
    phasesCompleted.push('reconnaissance');
  }
  
  if (state.current_tasks?.length > 0) {
    phasesCompleted.push('weaponization');
  }
  
  if (hasExploitResults(state)) {
    phasesCompleted.push('exploitation');
  }
  
  if (Object.keys(state.discovered_credentials).length > 0) {
    phasesCompleted.push('installation');
  }
  
  // C2 phase: pivot to admin/data endpoints
  const hasPrivilegedExploits = state.exploit_results.some(
    e => e.success && ['idor', 'auth_bypass', 'data_exfiltration'].includes(e.exploit_type)
  );
  if (hasPrivilegedExploits) {
    phasesCompleted.push('c2');
  }
  
  // Actions on objectives: any successful exploit
  const hasSuccessfulExploits = state.exploit_results.some(e => e.success);
  if (hasSuccessfulExploits) {
    phasesCompleted.push('actions_on_objectives');
  }
  
  return {
    phases_completed: phasesCompleted,
    total_phases: 7,
    progress_percentage: (phasesCompleted.length / 7) * 100,
    successful_exploits: countSuccessfulExploits(state),
    narrative: buildKillChainNarrative(state),
  };
}
```

### 11.5 Impact Labels

```typescript
const IMPACT_LABELS: Record<ExploitType, string> = {
  sqli: "Database Access / Auth Bypass",
  idor: "Unauthorized Data Access",
  sensitive_data_exposure: "Sensitive File Exposure",
  xss: "Script Injection (DOM/Stored)",
  auth_bypass: "Authentication Bypass",
  info_disclosure: "Information Leakage",
  xxe: "XML External Entity Injection",
  authentication: "Authentication Weakness",
  client_side_bypass: "Client-Side Security Bypass",
  lfi: "Local File Inclusion",
  rfi: "Remote File Inclusion",
  rce: "Remote Code Execution",
  broken_access_control: "Access Control Violation",
  security_misconfiguration: "Security Misconfiguration",
};
```

### 11.6 Recommendation Generation

```typescript
function generateRecommendations(state: RedTeamState): string[] {
  const recommendations: string[] = [];
  
  // Check for CVE hints
  const cveHints = new Set<string>();
  for (const finding of state.recon_results) {
    if (finding.cve_hint) {
      cveHints.add(finding.cve_hint);
    }
  }
  if (cveHints.size > 0) {
    recommendations.push(
      `Review and patch identified CVEs: ${Array.from(cveHints).join(', ')}`
    );
  }
  
  // Check for successful exploits
  const successful = state.exploit_results.filter(e => e.success);
  if (successful.length > 0) {
    recommendations.push(
      "CRITICAL: Successful exploits detected - immediate remediation required"
    );
    for (const exp of successful) {
      recommendations.push(
        `  - ${exp.exploit_type} on ${exp.target}`
      );
    }
  }
  
  // Check for high confidence findings
  const highConf = state.recon_results.filter(f => f.confidence >= 0.8);
  if (highConf.length > 0) {
    recommendations.push(
      `Review ${highConf.length} high-confidence reconnaissance findings`
    );
  }
  
  // Check for open ports/services
  const hasOpenServices = state.recon_results.some(
    f => f.asset.toLowerCase().includes('port') || 
         f.finding.toLowerCase().includes('open')
  );
  if (hasOpenServices) {
    recommendations.push("Review exposed services and close unnecessary ports");
  }
  
  // Default recommendation if nothing else
  if (recommendations.length === 0) {
    recommendations.push("Continue monitoring and periodic security assessments");
  }
  
  return recommendations;
}
```

### 11.7 Report Output Formats

**JSON Format** (for API consumption):
```json
{
  "report_metadata": {
    "generated_at": "2024-01-15T10:30:00Z",
    "mission_id": "550e8400-e29b-41d4-a716-446655440000",
    "report_version": "1.0"
  },
  "mission_summary": {
    "objective": "Penetration test of OWASP Juice Shop",
    "target": "http://localhost:3000",
    "final_phase": "complete",
    "iterations_completed": 3,
    "max_iterations": 5,
    "strategy": "Focus on SQLi and IDOR vulnerabilities"
  },
  "reconnaissance_findings": [...],
  "exploitation_results": [...],
  "kill_chain_progress": {
    "phases_completed": ["reconnaissance", "weaponization", "exploitation", "installation"],
    "total_phases": 7,
    "progress_percentage": 57.1,
    "successful_exploits": 5,
    "narrative": [...]
  },
  "statistics": {
    "total_messages": 47,
    "intel_reports": 12,
    "exploit_attempts": 35,
    "successful_exploits": 5,
    "high_confidence_findings": 8,
    "reflection_count": 2,
    "errors_count": 0
  },
  "recommendations": [
    "CRITICAL: Successful exploits detected - immediate remediation required",
    "  - sqli on http://localhost:3000/rest/user/login",
    "Review 8 high-confidence reconnaissance findings"
  ],
  "errors": []
}
```

**Markdown Format** (for human review):
- Professional header with classification banner
- Executive summary with key metrics
- Detailed findings tables
- Kill chain narrative with flow diagram
- Recommendations section
- Appendices with raw evidence

---

## 12. Blue Team Bridge

### 12.1 Core Responsibilities

Transform Blue Team static analysis findings into Red Team actionable intelligence. Bridges the gap between code-level vulnerabilities and runtime exploit targets.

### 12.2 BlueTeamFinding Schema

```typescript
interface BlueTeamFinding {
  // Required fields (identification)
  finding_id: string;
  scan_id: string;
  vuln_type: string;           // sql_injection, xss, hardcoded_secret, etc.
  severity: 'critical' | 'high' | 'medium' | 'low';
  file_path: string;           // e.g., /tmp/vibecheck/repos/xxx/routes/profileImageUrlUpload.ts
  
  // Optional fields
  category?: string;
  line_start?: number;
  line_end?: number;
  title?: string;
  description?: string;
  code_snippet?: string;
  confirmed: boolean;          // Default: false
  confidence_score?: number;
  false_positive: boolean;     // Default: false
  fix_suggestion?: string;
  reproduction_test?: string;
  created_at?: ISO8601;
  repo_url?: string;
  exploit_suggestions: string[];  // Generated based on vuln_type
}
```

### 12.3 to_recon_result Transformation

```typescript
function toReconResult(finding: BlueTeamFinding): ReconResult {
  return {
    source: 'blue_team_static_analysis',
    finding_id: finding.finding_id,
    vuln_type: finding.vuln_type,
    severity: finding.severity,
    file_path: finding.file_path,
    line_start: finding.line_start,
    line_end: finding.line_end,
    title: finding.title || `${finding.vuln_type} in ${finding.file_path}`,
    description: finding.description,
    code_snippet: finding.code_snippet,
    confidence: finding.confidence_score || 0.8,
    confirmed: finding.confirmed,
    exploit_suggestions: finding.exploit_suggestions,
    endpoint: extractEndpoint(finding),  // Critical: converts file path to API endpoint
  };
}
```

### 12.4 Endpoint Extraction Logic

Converts Blue Team file paths to Red Team API endpoints:

```typescript
function extractEndpoint(finding: BlueTeamFinding): string | null {
  if (!finding.file_path) return null;
  
  // Extract filename from path
  const filename = finding.file_path
    .split('/').pop()
    ?.split('\\').pop()
    ?.replace('.ts', '')
    ?.replace('.js', '');
  
  if (!filename) return null;
  
  // Convert camelCase/PascalCase to kebab-case
  // Insert hyphens before capitals
  const step1 = filename.replace(/(.)([A-Z][a-z]+)/g, '$1-$2');
  const kebabCase = step1.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  
  // Map common route patterns (Juice Shop specific)
  const ENDPOINT_MAPPINGS: Record<string, string> = {
    'profile': '/api/{kebabCase}',
    'address': '/api/Addresss',
    'upload': '/api/{kebabCase}',
    'redirect': '/redirect',
    'recycles': '/api/Recycles',
    'quarantine': '/api/Products',
    'logfile': '/api/Logs',
    'key': '/api/Key',
    'data-erasure': '/api/Users',
    'update-user-profile': '/profile',
    'update-product-reviews': '/api/Products',
    'memory': '/api/Memory',
    'vuln-code-snippet': '/api/VulnCode',
    'insecurity': '/',  // Library files, no specific endpoint
  };
  
  for (const [pattern, endpoint] of Object.entries(ENDPOINT_MAPPINGS)) {
    if (kebabCase.startsWith(pattern) || kebabCase.includes(pattern)) {
      return endpoint.replace('{kebabCase}', kebabCase);
    }
  }
  
  // Default: assume /api/ prefix
  return `/api/${kebabCase}`;
}
```

### 12.5 Exploit Suggestion Generation

```typescript
function computeExploitSuggestions(finding: BlueTeamFinding): string[] {
  const vulnType = finding.vuln_type.toLowerCase();
  
  // SQL Injection
  if (vulnType.includes('sql') || vulnType.includes('sqli')) {
    return [
      `Test SQL injection at lines ${finding.line_start}-${finding.line_end}`,
      "Try: ' OR '1'='1",
      "Try: UNION SELECT * FROM users",
      "Look for error-based SQLi in error messages",
    ];
  }
  
  // XSS
  if (vulnType.includes('xss')) {
    return [
      `Test XSS at lines ${finding.line_start}-${finding.line_end}`,
      "Try: <script>alert(1)</script>",
      "Try: '><img src=x onerror=alert(1)>",
      "Check for CSP bypass opportunities",
    ];
  }
  
  // Path Traversal
  if (vulnType.includes('path') || vulnType.includes('traversal')) {
    return [
      `Test path traversal at lines ${finding.line_start}-${finding.line_end}`,
      "Try: ../../../etc/passwd",
      "Try: ....//....//etc/passwd (bypass filters)",
    ];
  }
  
  // Command Injection
  if (vulnType.includes('command') || vulnType.includes('rce')) {
    return [
      `Test command injection at lines ${finding.line_start}-${finding.line_end}`,
      "Try: ; cat /etc/passwd",
      "Try: `whoami`",
      "Try: $(id)",
    ];
  }
  
  // Hardcoded Secrets
  if (vulnType.includes('secret') || vulnType.includes('hardcoded')) {
    const endpoint = extractEndpoint(finding);
    return [
      `Check hardcoded secrets in source code (affects ${endpoint})`,
      "Look for API keys, passwords, tokens in code",
      "Try these credentials against login endpoints",
    ];
  }
  
  // Auth/JWT
  if (vulnType.includes('auth') || vulnType.includes('jwt')) {
    return [
      `Test authentication bypass at lines ${finding.line_start}-${finding.line_end}`,
      "Look for JWT weaknesses (none algorithm, weak signing)",
      "Test for IDOR vulnerabilities",
    ];
  }
  
  // Deserialization
  if (vulnType.includes('deserialize')) {
    return [
      `Test deserialization at lines ${finding.line_start}-${finding.line_end}`,
      "Look for pickle, yaml.load, or JSON.parse vulnerabilities",
      "Try prototype pollution payloads",
    ];
  }
  
  // Default fallback
  return [
    `Investigate ${finding.vuln_type} at lines ${finding.line_start}-${finding.line_end}`,
    "Review code snippet for exploitation opportunities",
  ];
}
```

### 12.6 Finding Retrieval Flow

```typescript
async function getFindingsForTarget(
  target: string,
  options: {
    min_severity: 'low' | 'medium' | 'high' | 'critical';
    include_unconfirmed: boolean;
    repo_url?: string;
  }
): Promise<BlueTeamFinding[]> {
  // Step 1: Try Supabase query by repo URL pattern
  let findings = await getFromSupabase(target, options);
  
  // Step 2: If no results, try pattern matching
  if (findings.length === 0) {
    findings = await getByRepoPattern(target, options);
  }
  
  // Step 3: If still no results and target looks like repo, trigger scan
  if (findings.length === 0 && looksLikeRepo(target)) {
    logger.warning(`No Blue Team findings for ${target}, triggering auto-scan...`);
    const scanTriggered = await triggerBlueTeamScan(target);
    
    if (scanTriggered) {
      await sleep(2000);  // Wait for scan to populate
      findings = await getFromSupabase(target, options);
    }
  }
  
  // Step 4: Sort by severity (critical first)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return (b.confidence_score || 0) - (a.confidence_score || 0);
  });
  
  // Step 5: Generate exploit suggestions for each finding
  for (const finding of findings) {
    finding.exploit_suggestions = computeExploitSuggestions(finding);
  }
  
  return findings;
}
```

### 12.7 Supabase Query Strategy

```typescript
async function getFromSupabase(
  target: string,
  options: QueryOptions
): Promise<BlueTeamFinding[]> {
  // Extract repo name from target
  const repoName = extractRepoName(target, options.repo_url);
  
  // Strategy 1: Find matching scan_ids from scan_queue table
  const scanIds: string[] = [];
  if (repoName) {
    const scanResult = await supabase
      .table('scan_queue')
      .select('id, repo_url')
      .ilike('repo_url', `%${repoName}%`)
      .limit(500)
      .execute();
    
    if (scanResult.data) {
      scanIds.push(...scanResult.data.map(row => row.id));
    }
  }
  
  // Strategy 2: For Juice Shop targets, search by name
  if (scanIds.length === 0 && 
      (target.toLowerCase().includes('juice') || 
       target.includes('3000') || 
       target.includes('8080'))) {
    const juiceResult = await supabase
      .table('scan_queue')
      .select('id, repo_url, created_at')
      .ilike('repo_url', '%juice%')
      .order('created_at', { ascending: false })
      .limit(100)
      .execute();
    
    if (juiceResult.data) {
      scanIds.push(...juiceResult.data.map(row => row.id));
    }
  }
  
  // Query vulnerabilities table
  let findings: BlueTeamFinding[] = [];
  
  // Strategy 1: Filter by scan_ids
  if (scanIds.length > 0) {
    const result = await supabase
      .table('vulnerabilities')
      .select('*')
      .in('scan_id', scanIds)
      .order('severity', { ascending: false })
      .limit(500)
      .execute();
    
    if (result.data) {
      findings = result.data;
    }
  }
  
  // Strategy 2: If no results, search by file_path
  if (findings.length === 0 && repoName) {
    const result = await supabase
      .table('vulnerabilities')
      .select('*')
      .ilike('file_path', `%${repoName}%`)
      .order('severity', { ascending: false })
      .limit(100)
      .execute();
    
    if (result.data) {
      findings = result.data;
    }
  }
  
  return findings.map(row => new BlueTeamFinding(row));
}
```

---

## 13. ExecSandbox Behavior

### 13.1 Core Responsibilities

Execute shell commands in isolated **child processes** (NOT Docker containers) running as uid 65534 (nobody) for security isolation.

**Architecture Note**: The Swarm service uses `child_process.spawn` directly - Docker is only used by TargetManager for running target containers (Juice Shop), not for tool execution.

### 13.2 ExecResult Interface

```typescript
interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  command: string;
  timed_out: boolean;
}

// Exit code 0: Success
// Exit code 18: Partial transfer (acceptable if data received)
// Exit code -1: Process failure (TRIGGER RESTART LOGIC)
// Exit code 7: Connection failed
// Exit code 28: Timeout

function isSuccess(result: ExecResult): boolean {
  // B23: Exit code 18 (partial transfer) is acceptable if we got data
  // This happens with FTP/directory listings that hit size limits
  const acceptableCodes = [0, 18];
  return acceptableCodes.includes(result.exit_code) && !result.timed_out;
}
```

### 13.3 Main ExecSandbox Implementation

```typescript
import { spawn, SpawnOptions } from 'child_process';
import { promisify } from 'util';

interface ExecOpts {
  timeout?: number;        // Default: 30000ms
  cwd?: string;            // Working directory
  env?: Record<string, string>;
  maxBuffer?: number;      // Default: 10MB
}

class ExecSandbox {
  private readonly NOBODY_UID = 65534;
  private readonly NOBODY_GID = 65534;
  private readonly DEFAULT_TIMEOUT = 30000;  // 30 seconds
  private readonly MAX_BUFFER = 10 * 1024 * 1024;  // 10MB
  
  async run(
    cmd: string, 
    args: string[] = [], 
    opts?: ExecOpts
  ): Promise<ExecResult> {
    return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let killed = false;
      
      const spawnOpts: SpawnOptions = {
        uid: this.NOBODY_UID,
        gid: this.NOBODY_GID,
        cwd: opts?.cwd || '/tmp',
        env: {
          PATH: '/usr/bin:/usr/local/bin:/bin',
          HOME: '/tmp',
          ...opts?.env,
        },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      
      const child = spawn(cmd, args, spawnOpts);
      const timeout = opts?.timeout ?? this.DEFAULT_TIMEOUT;
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 5s if still running
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeout);
      
      // Collect stdout
      child.stdout?.on('data', (data: Buffer) => {
        stdout.push(data);
        // Prevent memory explosion
        if (Buffer.concat(stdout).length > this.MAX_BUFFER) {
          child.stdout?.pause();
        }
      });
      
      // Collect stderr
      child.stderr?.on('data', (data: Buffer) => {
        stderr.push(data);
      });
      
      // Handle completion
      child.on('close', (code: number | null, signal: string | null) => {
        clearTimeout(timeoutId);
        
        const result: ExecResult = {
          exit_code: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf-8', 0, this.MAX_BUFFER),
          stderr: Buffer.concat(stderr).toString('utf-8'),
          command: `${cmd} ${args.join(' ')}`,
          timed_out: killed && code === null,
        };
        
        resolve(result);
      });
      
      // Handle spawn errors (e.g., command not found)
      child.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        
        resolve({
          exit_code: -1,
          stdout: '',
          stderr: `Spawn error: ${err.message}`,
          command: `${cmd} ${args.join(' ')}`,
          timed_out: false,
        });
      });
    });
  }
  
  /**
   * Execute a shell command (uses /bin/sh -c)
   */
  async exec(command: string, opts?: ExecOpts): Promise<ExecResult> {
    return this.run('/bin/sh', ['-c', command], opts);
  }
}

// Singleton instance
export const execSandbox = new ExecSandbox();
```

### 13.4 Exit Code -1 Handling

When exit code -1 is returned (process spawn failure or abnormal termination), the sandbox logs the issue but does NOT retry at the sandbox level. The calling agent (Gamma) handles retries via the PentAGI reflection loop.

```typescript
async function executeTool(
  toolName: string, 
  toolArgs: Record<string, any>
): Promise<ExecResult> {
  // Build command from tool configuration
  const { cmd, args } = buildCommand(toolName, toolArgs);
  
  const result = await execSandbox.run(cmd, args, {
    timeout: toolArgs.timeout ?? 60000,
    cwd: toolArgs.workdir ?? '/tmp',
  });
  
  // Log the result
  if (result.success) {
    logger.debug("Tool %s succeeded (exit=%d)", toolName, result.exit_code);
  } else if (result.timed_out) {
    logger.warning("Tool %s timed out after %dms", toolName, toolArgs.timeout ?? 60000);
  } else {
    logger.warning("Tool %s failed (exit=%d): %s", 
      toolName, result.exit_code, result.stderr.slice(0, 200));
  }
  
  return result;
}
```

### 13.5 Timeout Handling

```typescript
async function execWithTimeout(
  command: string,
  timeoutMs: number
): Promise<ExecResult> {
  const result = await execSandbox.exec(command, { timeout: timeoutMs });
  
  if (result.timed_out) {
    logger.warning("Command timed out after %dms: %s", timeoutMs, command.slice(0, 80));
  }
  
  return result;
}
```

### 13.6 Tool Registry Integration

```typescript
interface Tool {
  name: string;
  buildCommand: (args: any) => { cmd: string; args: string[] };
  validateArgs: (args: any) => boolean;
}

const TOOL_REGISTRY: Record<string, Tool> = {
  curl: {
    name: 'curl',
    buildCommand: (args) => ({
      cmd: 'curl',
      args: [
        '-s', '-i',                // Silent, include headers
        '-X', args.method || 'GET',
        '-H', `Content-Type: ${args.contentType || 'application/json'}`,
        ...(args.headers ? Object.entries(args.headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]) : []),
        ...(args.data ? ['-d', args.data] : []),
        args.url,
      ],
    }),
    validateArgs: (args) => !!args.url,
  },
  
  nmap: {
    name: 'nmap',
    buildCommand: (args) => ({
      cmd: 'nmap',
      args: [
        ...(args.args ? args.args.split(' ') : ['-sV', '--top-ports', '20']),
        args.target,
      ],
    }),
    validateArgs: (args) => !!args.target,
  },
  
  python: {
    name: 'python',
    buildCommand: (args) => ({
      cmd: 'python3',
      args: ['-c', args.code],
    }),
    validateArgs: (args) => !!args.code,
  },
};

async function executeTool(toolName: string, args: any): Promise<ExecResult> {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  
  if (!tool.validateArgs(args)) {
    return {
      exit_code: -1,
      stdout: '',
      stderr: `Invalid arguments for tool ${toolName}`,
      command: `${toolName} ${JSON.stringify(args)}`,
      timed_out: false,
    };
  }
  
  const { cmd, args: cmdArgs } = tool.buildCommand(args);
  return execSandbox.run(cmd, cmdArgs, { timeout: args.timeout ?? 60000 });
}
```

### 13.7 File Operations

File operations are performed directly by the Node.js process (not through the sandbox), then passed to tools as arguments:

```typescript
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const WORKSPACE_DIR = join(tmpdir(), 'swarm-workspace');

async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  // Set permissions for nobody user (65534)
  // Note: On Linux, may need chmod/chown depending on setup
}

async function writeTempFile(filename: string, content: string): Promise<string> {
  await ensureWorkspace();
  const filepath = join(WORKSPACE_DIR, filename);
  await fs.writeFile(filepath, content, 'utf-8');
  return filepath;
}

async function readTempFile(filepath: string): Promise<string | null> {
  try {
    return await fs.readFile(filepath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function cleanupTempFile(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch {
    // Ignore cleanup errors
  }
}
```

---

## 14. TargetManager Lifecycle

### 14.1 Core Responsibilities

Manage Docker target containers (like OWASP Juice Shop) lifecycle: spin-up, network isolation, health checks, and teardown.

**Architecture Note**: TargetManager is the ONLY component that uses Docker - it manages the target application containers. The Swarm service itself (ExecSandbox) uses `child_process.spawn` for tool execution, NOT Docker.

### 14.2 Lifecycle States

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   absent     │────►│  creating    │────►│   running    │────►│  destroying  │
│              │     │  (network)   │     │  (healthy)   │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                        │              │
                                                        ▼              ▼
                                                 ┌──────────────┐     ┌──────────────┐
                                                 │   unhealthy  │────►│   absent     │
                                                 │  (retry X3)  │     │  (cleanup)   │
                                                 └──────────────┘     └──────────────┘
```

### 14.3 Spin-Up Sequence

```typescript
interface TargetConfig {
  image: string;               // e.g., "bkimminich/juice-shop:latest"
  name: string;                // e.g., "juice-shop-target-{missionId}"
  port: number;                // Container internal port (e.g., 3000)
  hostPort: number;            // Host mapped port (e.g., 8080)
  network: string;             // Docker network name
  env?: Record<string, string>;
  volumes?: VolumeMapping[];
}

async function spinUpTarget(config: TargetConfig): Promise<TargetInfo> {
  const client = getDockerClient();
  
  // Step 1: Ensure network exists
  const network = await ensureNetwork(config.network);
  
  // Step 2: Pull image if not exists
  await pullImageIfNeeded(config.image);
  
  // Step 3: Create container with network
  const container = await client.containers.create({
    image: config.image,
    name: config.name,
    labels: {
      "managed-by": "swarm-target-manager",
      "mission-id": extractMissionId(config.name),
      "created-at": new Date().toISOString(),
    },
    host_config: {
      port_bindings: {
        [`${config.port}/tcp`]: [{ host_port: String(config.hostPort) }],
      },
      network_mode: config.network,
      auto_remove: false,  // We'll handle cleanup
      memory: 512 * 1024 * 1024,  // 512MB limit
      cpu_shares: 512,
    },
    env: Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`),
  });
  
  // Step 4: Start container
  await container.start();
  
  // Step 5: Wait for healthy state
  const health = await waitForHealthy(container, {
    timeout: 30_000,           // 30 second timeout
    interval: 1_000,           // Check every second
    retries: 3,
  });
  
  if (!health.healthy) {
    // Cleanup failed container
    await destroyTarget(container.id);
    throw new Error(`Target failed health check: ${health.error}`);
  }
  
  return {
    container_id: container.id,
    name: config.name,
    host: IS_LINUX ? "localhost" : "host.docker.internal",
    port: config.hostPort,
    internal_port: config.port,
    network: config.network,
    url: `http://${IS_LINUX ? "localhost" : "host.docker.internal"}:${config.hostPort}`,
    status: "running",
    started_at: new Date().toISOString(),
  };
}
```

### 14.4 Network Creation Order

```typescript
async function ensureNetwork(networkName: string): Promise<Network> {
  const client = getDockerClient();
  
  try {
    // Check if network exists
    const networks = await client.networks.list({
      filters: { name: [networkName] }
    });
    
    if (networks.length > 0) {
      logger.debug("Network '%s' already exists", networkName);
      return client.networks.get(networks[0].id);
    }
  } catch (error) {
    logger.debug("Error checking network: %s", error);
  }
  
  // Create isolated bridge network
  logger.info("Creating network '%s'...", networkName);
  const network = await client.networks.create({
    name: networkName,
    driver: "bridge",
    internal: true,  // NO external egress - target is fully isolated (security)
    labels: {
      "managed-by": "swarm-target-manager",
    },
    ipam: {
      config: [{
        subnet: "172.20.0.0/16",
        gateway: "172.20.0.1",
      }],
    },
  });
  
  logger.info("Network '%s' created (subnet: 172.20.0.0/16)", networkName);
  return network;
}
```

### 14.5 Health Check Implementation

```typescript
interface HealthCheckResult {
  healthy: boolean;
  attempts: number;
  error?: string;
  response_time_ms?: number;
}

async function waitForHealthy(
  container: Container,
  options: {
    timeout: number;
    interval: number;
    retries: number;
  }
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  let attempts = 0;
  
  // Get container info to find exposed port
  const containerInfo = await container.inspect();
  const portBindings = containerInfo.host_config.port_bindings;
  const hostPort = Object.values(portBindings)[0]?.[0]?.host_port;
  
  if (!hostPort) {
    return { healthy: false, attempts: 0, error: "No port binding found" };
  }
  
  while (Date.now() - startTime < options.timeout) {
    attempts++;
    
    try {
      const checkStart = Date.now();
      const response = await fetch(`http://localhost:${hostPort}/`, {
        method: "HEAD",
        timeout: 5000,
      });
      const responseTime = Date.now() - checkStart;
      
      if (response.status < 500) {
        return {
          healthy: true,
          attempts,
          response_time_ms: responseTime,
        };
      }
    } catch (error) {
      // Not ready yet, wait and retry
    }
    
    await sleep(options.interval);
  }
  
  return {
    healthy: false,
    attempts,
    error: `Health check timeout after ${options.timeout}ms`,
  };
}
```

### 14.6 Teardown on Mission Cancel

```typescript
async function destroyTarget(
  containerId: string,
  options: { force: boolean = false; removeVolumes: boolean = true }
): Promise<void> {
  const client = getDockerClient();
  
  try {
    const container = client.containers.get(containerId);
    const info = await container.inspect();
    
    logger.info("Destroying target container: %s", info.name);
    
    // Step 1: Stop container
    try {
      await container.stop({ t: options.force ? 0 : 10 });  // 10s graceful, 0s force
      logger.debug("Container %s stopped", info.name);
    } catch (error) {
      logger.warning("Error stopping container (may already be stopped): %s", error);
    }
    
    // Step 2: Remove container
    try {
      await container.remove({ 
        v: options.removeVolumes,  // Remove volumes
        force: options.force,       // Force remove if running
      });
      logger.info("Container %s removed", info.name);
    } catch (error) {
      logger.error("Error removing container: %s", error);
      throw error;
    }
    
    // Step 3: Cleanup network if no more containers using it
    const networkName = info.host_config.network_mode;
    if (networkName && networkName !== "default") {
      await cleanupNetworkIfEmpty(networkName);
    }
    
  } catch (NotFound) {
    logger.debug("Container %s not found (already removed)", containerId);
  }
}

async function cleanupNetworkIfEmpty(networkName: string): Promise<void> {
  const client = getDockerClient();
  
  try {
    const network = await client.networks.get(networkName);
    const info = await network.inspect();
    
    // Check if any containers are still using this network
    const connectedContainers = Object.keys(info.containers || {});
    
    if (connectedContainers.length === 0) {
      logger.info("Network '%s' has no containers, removing...", networkName);
      await network.remove();
      logger.info("Network '%s' removed", networkName);
    } else {
      logger.debug(
        "Network '%s' still has %d container(s)", 
        networkName, 
        connectedContainers.length
      );
    }
  } catch (error) {
    logger.warning("Error cleaning up network: %s", error);
  }
}
```

### 14.7 Mission Cancellation Handler

```typescript
async function handleMissionCancellation(missionId: string): Promise<void> {
  logger.info("Mission %s cancelled - cleaning up target resources...", missionId);
  
  const client = getDockerClient();
  
  // Find all containers associated with this mission
  const containers = await client.containers.list({
    all: true,
    filters: {
      label: [`mission-id=${missionId}`],
    },
  });
  
  logger.info("Found %d container(s) to clean up for mission %s", containers.length, missionId);
  
  // Destroy each container
  const cleanupPromises = containers.map(async (containerInfo) => {
    try {
      await destroyTarget(containerInfo.id, { force: true });
      return { id: containerInfo.id, success: true };
    } catch (error) {
      logger.error("Failed to cleanup container %s: %s", containerInfo.id, error);
      return { id: containerInfo.id, success: false, error };
    }
  });
  
  const results = await Promise.all(cleanupPromises);
  const successCount = results.filter(r => r.success).length;
  
  logger.info(
    "Mission %s cleanup complete: %d/%d containers removed",
    missionId,
    successCount,
    containers.length
  );
}
```

### 14.8 Resource Limits

```typescript
const TARGET_RESOURCE_LIMITS = {
  // Memory limits
  memory: 512 * 1024 * 1024,        // 512MB per target
  memory_swap: 512 * 1024 * 1024,   // No swap
  
  // CPU limits
  cpu_shares: 512,                  // Half of default (1024)
  cpu_quota: 50000,                 // 50% of CPU
  cpu_period: 100000,
  
  // Network limits
  network_mode: "bridge",           // Isolated network
  
  // I/O limits
  blkio_weight: 300,                // Lower I/O priority
};
```

---

## 15. Known Inconsistencies Fixed

### 15.1 BETA Agent Role Removal

**Issue**: The original Python code defined a BETA agent role in the A2A message schema, but it was never actually used in the swarm logic.

**Fix**: The TypeScript rewrite should **NOT** include BETA in the agent role mapping. The swarm only uses:
- Commander (orchestration)
- Alpha (reconnaissance)
- Gamma (exploitation)
- Critic (evaluation)

```typescript
// CORRECT - BETA removed
const AGENT_ROLE_MAPPING = {
  'agent_alpha': AgentRole.ALPHA,
  'alpha': AgentRole.ALPHA,
  'agent_gamma': AgentRole.GAMMA,
  'gamma': AgentRole.GAMMA,
  'agent_critic': AgentRole.CRITIC,
  'critic': AgentRole.CRITIC,
  'commander': AgentRole.COMMANDER,
};
```

---

*Document Version: 1.1*  
*Last Updated: 2024-01-15*  
*Status: Complete - Ready for TypeScript Refactoring*
