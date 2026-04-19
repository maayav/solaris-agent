# SWARM TypeScript Migration Specification

**Red Team · Multi-Agent · Autonomous Security Testing Platform**
**Version:** 1.0
**Status:** Implementation Ready

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Target Architecture](#3-target-architecture)
4. [Service Migrations](#4-service-migrations)
5. [Custom State Machine](#5-custom-state-machine)
6. [Agent Implementations](#6-agent-implementations)
7. [Schema Translation](#7-schema-translation)
8. [API Migration](#8-api-migration)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Testing Strategy](#10-testing-strategy)
11. [Environment Variables](#11-environment-variables)

---

## 1. Executive Summary

This document specifies the migration of the SWARM Red Team module from **Python to TypeScript with Bun runtime**, transitioning from local infrastructure to cloud-based services.

### Key Changes

| Component | Current | Target |
|-----------|---------|--------|
| **Runtime** | Python 3.10+ | Bun + TypeScript |
| **Orchestration** | LangGraph 0.2.48 | Custom StateMachine |
| **Message Bus** | Local Redis | Upstash Redis (Cloud) |
| **Vector DB** | Local Qdrant | Qdrant Cloud |
| **Graph DB** | FalkorDB (local) | Neo4j Aura |
| **LLM Provider** | Ollama + OpenRouter | Ollama only (for now) |
| **Sandbox** | Docker | nsjail + Firecracker microVM |
| **API** | FastAPI | Hono (Bun) |
| **Schemas** | Pydantic | Zod |

### Migration Rationale

1. **Performance**: Bun provides 3-10x faster startup and execution than Python
2. **Type Safety**: TypeScript ensures compile-time safety for complex agent logic
3. **Cloud-Ready**: Managed services reduce operational overhead
4. **No Docker Dependency**: Moving to lightweight sandbox (nsjail/firecracker)
5. **Simplicity**: Custom state machine reduces dependency on LangGraph versioning

---

## 2. Current Architecture

### 2.1 LangGraph State Machine (5 Phases)

```
planning → recon → exploitation → reporting → complete
    ↓         ↓           ↓            ↓
 (assign)  (scan)    (exploit)    (compile)
    ↓         ↓           ↓            ↓
 (decide)  (analyze)  (validate)   (deliver)
```

### 2.2 Agent System

| Agent | Lines | Role |
|-------|-------|------|
| **Commander** | 1096 | Strategic planning, task assignment, phase decisions, Blue Team intel |
| **Alpha Recon** | 661 | Nmap, nuclei, curl reconnaissance |
| **Gamma Exploit** | 1823+ | OWASP Top 10, PentAGI self-reflection, token chaining |
| **Critic** | 1065 | Deterministic + LLM exploit evaluation |
| **HITL Gate** | ~100 | Human-in-the-loop, destructive payload approval |

### 2.3 RedTeamState Schema (30+ Fields)

```python
{
    mission_id, phase, messages, blackboard,
    recon_results, exploit_results, discovered_credentials,
    blue_team_findings, llm_calls, token_usage,
    sandbox_id, tools_used, findings, exploit_attempts,
    # Budget controls
    cost_usd, max_cost_usd, started_at, max_duration_seconds,
    # Quality signals
    stall_count, max_stall_count, coverage_score,
    critical_findings_count, high_findings_count,
    previous_findings_hash
}
```

### 2.4 LLM Cascade

```
OpenRouter (primary)
    ↓ (failure)
OpenRouter (fallback 1)
    ↓ (failure)
OpenRouter (fallback 2)
    ↓ (failure)
Ollama (local)
```

### 2.5 Infrastructure

| Technology | Purpose |
|------------|---------|
| Redis Streams | A2A messaging between agents |
| Supabase | PostgreSQL persistence |
| Docker SDK | Sandbox container management |
| Tree-Sitter | Multi-language code parsing |
| Semgrep | Static vulnerability analysis |

---

## 3. Target Architecture

### 3.1 TypeScript/Bun Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TypeScript/Bun SWARM Architecture                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  Custom State Machine (Async)                      │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐              │ │
│  │  │Commander│─▶│  Alpha   │─▶│  Gamma   │─▶│  Critic  │              │ │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘              │ │
│  │       │            │            │            │                     │ │
│  │       ▼            ▼            ▼            ▼                     │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │              MissionState (interface)                       │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │Upstash Redis │  │Qdrant Cloud │  │ Neo4j Aura   │                 │
│  │   (Cloud)    │  │   (Cloud)   │  │   (Cloud)   │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │              Hono API Server (Bun serve)                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Structure

```
swarm/
├── src/
│   ├── agents/
│   │   ├── commander.ts      # Strategic planning agent
│   │   ├── alpha.ts          # Reconnaissance agent
│   │   ├── gamma.ts          # Exploitation agent
│   │   ├── critic.ts         # Evaluation agent
│   │   ├── hitl-gate.ts      # Human approval
│   │   ├── state.ts          # State definitions
│   │   ├── schemas.ts        # Zod schemas
│   │   ├── graph.ts          # State machine
│   │   └── messages.ts       # A2A message types
│   │
│   ├── core/
│   │   ├── state-machine.ts  # Custom LangGraph replacement
│   │   ├── llm-client.ts     # Ollama client
│   │   ├── config.ts         # Environment config
│   │   ├── events.ts        # Event bus
│   │   └── logging.ts       # Structured logging
│   │
│   ├── infrastructure/
│   │   ├── redis.ts          # Upstash Redis client
│   │   ├── qdrant.ts         # Qdrant Cloud client
│   │   ├── neo4j.ts          # Neo4j Aura client
│   │   ├── supabase.ts       # Supabase client
│   │   └── sandbox.ts        # nsjail executor
│   │
│   ├── tools/
│   │   ├── registry.ts       # Tool registry
│   │   ├── curl.ts           # HTTP tool
│   │   ├── nmap.ts           # Port scanning
│   │   ├── nuclei.ts         # Vulnerability scanning
│   │   └── python.ts         # Python execution
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── missions.ts   # Mission CRUD
│   │   │   ├── execute.ts    # Execute mission
│   │   │   └── events.ts     # Event streaming
│   │   ├── middleware/
│   │   │   ├── auth.ts        # Authentication
│   │   │   └── cors.ts       # CORS
│   │   └── index.ts          # Hono app
│   │
│   └── utils/
│       ├── crypto.ts         # HMAC, encryption
│       └── validation.ts     # Zod validation
│
├── tests/
│   ├── agents/
│   ├── infrastructure/
│   └── integration/
│
├── package.json
├── tsconfig.json
├── bun.lockb
└── .env.example
```

---

## 4. Service Migrations

### 4.1 Redis → Upstash Redis

**Configuration Changes**

```bash
# .env changes
# Before
REDIS_URL=redis://localhost:6380

# After
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxx
```

**Implementation**

```typescript
// src/infrastructure/redis.ts
import { Redis } from '@upstash/redis'

export class MessageBus {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  }

  async publish(stream: string, message: Record<string, unknown>): Promise<string> {
    return await this.redis.xadd(stream, message)
  }

  async consume(
    stream: string,
    group: string,
    consumer: string,
    count = 10
  ): Promise<Record<string, unknown>[]> {
    return await this.redis.xreadgroup(groupname(group), consumername(consumer), {
      stream,
      count,
      block: 5000,
    })
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key)
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, { ex: ttl })
    } else {
      await this.redis.set(key, value)
    }
  }

  async incrbyfloat(key: string, amount: number): Promise<number> {
    return await this.redis.incrbyfloat(key, amount)
  }

  async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    return await this.redis.setbit(key, offset, value)
  }

  async bitcount(key: string): Promise<number> {
    return await this.redis.bitcount(key)
  }
}
```

**Key Pattern Changes**

| Old Key Pattern | New Key Pattern | Purpose |
|-----------------|-----------------|---------|
| `redteam:blackboard:{mission_id}` | `swarm:blackboard:{mission_id}` | Mission state |
| `a2a_messages` | `swarm:a2a:{mission_id}` | A2A messages |
| `redteam:findings:{mission_id}:*` | `swarm:findings:{mission_id}:*` | Findings store |
| `redteam:payload_attempts:{mission_id}` | `swarm:payloads:{mission_id}` | Payload tracking |
| `redteam:coverage:{mission_id}` | `swarm:coverage:{mission_id}` | OWASP coverage |

### 4.2 Qdrant → Qdrant Cloud

**Configuration**

```bash
# .env changes
# Before
QDRANT_URL=http://localhost:6333

# After
QDRANT_URL=https://xxx.us-east-1-0.qdrant.cloud
QDRANT_API_KEY=your-api-key
```

**Implementation**

```typescript
// src/infrastructure/qdrant.ts
import { QdrantClient } from '@qdrant/client'

export interface ExploitPayload {
  id: string
  vector: number[]
  payload: Record<string, unknown>
}

export class EpisodicMemory {
  private client: QdrantClient

  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL!,
      apiKey: process.env.QDRANT_API_KEY!,
    })
  }

  async storeSuccessfulExploit(payload: ExploitPayload): Promise<boolean> {
    await this.client.upsert('successful_exploits', {
      points: [{
        id: payload.id,
        vector: payload.vector,
        payload: payload.payload,
      }],
    })
    return true
  }

  async recallStrategies(stack: string, vulnClass: string, limit = 5) {
    return await this.client.search('successful_exploits', {
      vector: stack,
      limit,
      filter: { must: [{ key: 'vuln_class', match: { value: vulnClass } }] }
    })
  }

  async deleteCollection(name: string): Promise<void> {
    return await this.client.deleteCollection(name)
  }
}
```

### 4.3 FalkorDB → Neo4j Aura

**Configuration**

```bash
# .env changes
# Before
FALKORDB_URL=redis://localhost:6379

# After
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
```

**Implementation**

```typescript
// src/infrastructure/neo4j.ts
import neo4j from 'neo4j-driver'

export class AttackGraphDB {
  private driver: neo4j.Driver

  constructor() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME!,
        process.env.NEO4J_PASSWORD!
      )
    )
  }

  async createAttackGraph(missionId: string, target: string): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `CREATE (t:Target {
          url: $url,
          created_at: datetime(),
          status: 'active'
        }) RETURN t`,
        { url: target }
      )
    } finally {
      await session.close()
    }
  }

  async addAsset(
    missionId: string,
    assetType: string,
    identifier: string,
    properties?: Record<string, unknown>
  ): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `MATCH (t:Target)
         CREATE (a:${assetType} {identifier: $id, discovered_at: datetime(), ...props})
         CREATE (t)-[:HAS]->(a)
         RETURN a`,
        { id: identifier, props: properties }
      )
    } finally {
      await session.close()
    }
  }

  async addVulnerability(
    missionId: string,
    vulnType: string,
    severity: string,
    cve?: string
  ): Promise<void> {
    const session = this.driver.session()
    try {
      await session.run(
        `MATCH (t:Target)
         CREATE (v:Vulnerability {type: $type, severity: $severity, cve: $cve, discovered_at: datetime()})
         CREATE (t)-[:HAS_VULN]->(v)
         RETURN v`,
        { type: vulnType, severity, cve }
      )
    } finally {
      await session.close()
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }
}
```

### 4.4 Supabase (No Major Changes)

```typescript
// src/infrastructure/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)
```

---

## 5. Custom State Machine

### 5.1 Core Implementation

```typescript
// src/core/state-machine.ts

export type Phase = 'planning' | 'recon' | 'exploitation' | 'reporting' | 'complete'

export interface MissionState {
  mission_id: string
  objective: string
  target: string
  phase: Phase

  messages: A2AMessage[]
  blackboard: Record<string, unknown>
  recon_results: ReconFinding[]
  exploit_results: ExploitResult[]
  discovered_credentials: CredentialHandle[]

  current_tasks: TaskAssignment[]
  strategy: string

  iteration: number
  max_iterations: number
  needs_human_approval: boolean
  human_response: string | null

  cost_usd: number
  max_cost_usd: number
  started_at: string
  max_duration_seconds: number

  stall_count: number
  max_stall_count: number
  coverage_score: number
  critical_findings_count: number
  high_findings_count: number
  previous_findings_hash: string

  authorization: AuthorizationContext | null
  authorization_verified: boolean

  mode: 'live' | 'static'
  repo_url: string | null

  errors: string[]
}

export type NodeFunction = (state: MissionState) => Promise<Partial<MissionState>>
export type RoutingFunction = (state: MissionState) => string

export interface NodeDefinition {
  name: string
  fn: NodeFunction
}

export interface EdgeDefinition {
  from: string
  to: string | RoutingFunction
}

export class StateMachine {
  private nodes: Map<string, NodeFunction> = new Map()
  private edges: EdgeDefinition[] = []
  private state: MissionState | null = null

  addNode(name: string, fn: NodeFunction): this {
    this.nodes.set(name, fn)
    return this
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ from, to })
    return this
  }

  addConditionalEdge(
    from: string,
    routingFn: RoutingFunction,
    _branches: Record<string, string>
  ): this {
    this.edges.push({ from, to: routingFn })
    return this
  }

  async run(initialState: MissionState): Promise<MissionState> {
    this.state = initialState
    let currentNode = 'blue_team_enrichment'

    while (true) {
      const node = this.nodes.get(currentNode)
      if (!node) {
        throw new Error(`Node not found: ${currentNode}`)
      }

      const updates = await node(this.state)
      this.state = { ...this.state!, ...updates }

      const edge = this.edges.find(e => e.from === currentNode)
      if (!edge) {
        break
      }

      if (typeof edge.to === 'function') {
        currentNode = edge.to(this.state)
      } else {
        currentNode = edge.to
      }

      if (currentNode === 'END' || this.state.phase === 'complete') {
        break
      }
    }

    return this.state
  }
}
```

### 5.2 Graph Construction

```typescript
// src/agents/graph.ts
import { StateMachine, MissionState } from '../core/state-machine'
import { commanderPlan, commanderObserve } from './commander'
import { alphaRecon } from './alpha'
import { gammaExploit, hitlApprovalGate } from './gamma'
import { generateReportNode } from './report'
import { blueTeamEnrichment } from './blue-team-bridge'

export function buildRedTeamGraph(): StateMachine {
  const graph = new StateMachine()

  graph.addNode('blue_team_enrichment', blueTeamEnrichment)
  graph.addNode('commander_plan', commanderPlan)
  graph.addNode('alpha_recon', alphaRecon)
  graph.addNode('gamma_exploit', gammaExploit)
  graph.addNode('hitl_gate', hitlApprovalGate)
  graph.addNode('commander_observe', commanderObserve)
  graph.addNode('generate_report', generateReportNode)

  graph.addEdge('blue_team_enrichment', 'commander_plan')
  graph.addEdge('commander_plan', 'alpha_recon')
  graph.addEdge('alpha_recon', 'gamma_exploit')
  graph.addEdge('gamma_exploit', 'hitl_gate')
  graph.addEdge('hitl_gate', 'commander_observe')

  graph.addConditionalEdge('commander_observe', shouldContinue, {
    'continue': 'alpha_recon',
    'exploit_only': 'gamma_exploit',
    'report': 'generate_report',
  })

  graph.addEdge('generate_report', 'END')

  return graph
}

export function shouldContinue(state: MissionState): string {
  const { phase, iteration, max_iterations, stall_count, max_stall_count, cost_usd, max_cost_usd } = state

  if (phase === 'complete') return 'report'
  if (iteration >= max_iterations) return 'report'
  if (stall_count >= max_stall_count) return 'report'
  if (cost_usd >= max_cost_usd) return 'report'

  if (phase === 'exploitation') return 'exploit_only'

  return 'continue'
}

export function createInitialState(options: CreateMissionOptions): MissionState {
  return {
    mission_id: options.mission_id ?? crypto.randomUUID(),
    objective: options.objective,
    target: options.target,
    phase: 'planning',
    messages: [],
    blackboard: {},
    recon_results: [],
    exploit_results: [],
    discovered_credentials: [],
    current_tasks: [],
    strategy: '',
    iteration: 0,
    max_iterations: options.max_iterations ?? 5,
    needs_human_approval: false,
    human_response: null,
    cost_usd: 0,
    max_cost_usd: options.max_cost_usd ?? 2.0,
    started_at: new Date().toISOString(),
    max_duration_seconds: options.max_duration_seconds ?? 3600,
    stall_count: 0,
    max_stall_count: options.max_stall_count ?? 2,
    coverage_score: 0,
    critical_findings_count: 0,
    high_findings_count: 0,
    previous_findings_hash: '',
    authorization: options.authorization ?? null,
    authorization_verified: false,
    mode: options.mode ?? detectTargetType(options.target),
    repo_url: options.repo_url ?? null,
    errors: [],
  }
}

function detectTargetType(target: string): 'live' | 'static' {
  if (target.startsWith('http://') || target.startsWith('https://')) return 'live'
  if (target.includes('github.com') || target.includes('gitlab.com')) return 'static'
  return 'live'
}
```

### 5.3 Stall Detection

```typescript
// src/core/state-machine.ts (continued)

import { createHash } from 'crypto'

function hashFindings(findings: unknown[]): string {
  const normalized = (findings as Record<string, unknown>[])
    .map(f => `${f.get('type', '')}|${f.get('endpoint', '')}`)
    .sort()
    .join('|')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function computeStallDetection(state: MissionState): MissionState {
  const currentHash = hashFindings(state.exploit_results)
  const prevHash = state.previous_findings_hash

  if (prevHash === '') {
    state.stall_count = 0
  } else if (currentHash === prevHash) {
    state.stall_count = (state.stall_count ?? 0) + 1
  } else {
    state.stall_count = 0
  }

  state.previous_findings_hash = currentHash
  return state
}
```

---

## 6. Agent Implementations

### 6.1 Commander Agent

```typescript
// src/agents/commander.ts
import { LLMClient } from '../core/llm-client'
import { MissionState } from './state'
import { TaskAssignment, CommanderPlan } from './schemas'

const PLAN_PROMPT = `You are the Commander of a red team operation. Your mission is to decompose the objective into task assignments.

Objective: {objective}
Target: {target}

Analyze the target and create a strategic plan with task assignments for the reconnaissance and exploitation teams.`

const OBSERVE_PROMPT = `You are the Commander observing the results from field agents. Evaluate the intelligence and decide the next phase.

Current Phase: {phase}
Iteration: {iteration}
Recon Results: {recon_results}
Exploit Results: {exploit_results}
Blackboard: {blackboard}

Decide: continue to next phase, exploit_only, or report.`

export async function commanderPlan(state: MissionState): Promise<Partial<MissionState>> {
  const llm = new LLMClient()
  
  const messages = [
    { role: 'user' as const, content: PLAN_PROMPT.replace('{objective}', state.objective).replace('{target}', state.target) }
  ]

  const response = await llm.chat('commander', messages)
  const plan = JSON.parse(response) as CommanderPlan

  return {
    phase: 'recon',
    strategy: plan.strategy,
    current_tasks: plan.tasks,
  }
}

export async function commanderObserve(state: MissionState): Promise<Partial<MissionState>> {
  const llm = new LLMClient()
  
  const messages = [
    { role: 'user' as const, content: OBSERVE_PROMPT
      .replace('{phase}', state.phase)
      .replace('{iteration}', String(state.iteration))
      .replace('{recon_results}', JSON.stringify(state.recon_results))
      .replace('{exploit_results}', JSON.stringify(state.exploit_results))
      .replace('{blackboard}', JSON.stringify(state.blackboard))
    }
  ]

  const response = await llm.chat('commander', messages)
  const decision = JSON.parse(response)

  return {
    phase: decision.next_phase,
    iteration: state.iteration + 1,
  }
}
```

### 6.2 Alpha Recon Agent

```typescript
// src/agents/alpha.ts
import { MissionState } from './state'
import { ToolRegistry } from '../tools/registry'
import { nmapTool, nucleiTool, curlTool } from '../tools'

const RECON_PROMPT = `You are Alpha, the reconnaissance agent. Analyze the task and decide which tools to use.

Task: {task}
Target: {target}
Available Tools: {tools}

Choose the best tool for the job.`

export async function alphaRecon(state: MissionState): Promise<Partial<MissionState>> {
  const registry = new ToolRegistry()
  const results = []

  for (const task of state.current_tasks) {
    const toolName = await selectTool(task, state.blackboard)
    const tool = registry.get(toolName)
    
    if (tool) {
      const result = await tool.execute({ target: task.target, ...task.parameters })
      results.push({
        tool: toolName,
        result,
        timestamp: new Date().toISOString(),
      })
    }
  }

  return {
    recon_results: results,
    phase: 'exploitation',
  }
}

async function selectTool(task: TaskAssignment, blackboard: Record<string, unknown>): Promise<string> {
  if (task.tools_allowed.length > 0) {
    return task.tools_allowed[0]
  }
  
  if (task.description.includes('scan') || task.description.includes('port')) {
    return 'nmap'
  }
  if (task.description.includes('vuln') || task.description.includes('scan')) {
    return 'nuclei'
  }
  return 'curl'
}
```

### 6.3 Gamma Exploit Agent

```typescript
// src/agents/gamma.ts
import { MissionState } from './state'
import { ToolRegistry } from '../tools/registry'
import { MissionThrottle } from '../core/throttle'

const OWASP_ARSENAL = [
  'sqli', 'xss', 'idor', 'auth_bypass', 'ssrf',
  'path_traversal', 'cmdi', 'xxe', 'file_upload'
]

const EXPLOIT_PROMPT = `You are Gamma, the exploitation agent. Execute the assigned exploit and self-reflect on results.

Task: {task}
Target: {target}
Available Tokens: {tokens}
OWASP Vector: {vector}

Execute the exploit and analyze the result. If failed, self-reflect and retry.`

export async function gammaExploit(state: MissionState): Promise<Partial<MissionState>> {
  const registry = new ToolRegistry()
  const throttle = new MissionThrottle()
  const results = []

  for (const task of state.current_tasks) {
    const exploitType = await selectExploitType(task)
    
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctx = await throttle.acquire()
      
      const tool = registry.get('curl')
      const payload = generatePayload(exploitType, task.parameters)
      
      const result = await tool.execute({
        target: task.target,
        method: 'POST',
        payload,
        headers: ctx.ua ? { 'User-Agent': ctx.ua } : {},
      })

      const evaluation = await evaluateExploit(result, exploitType)
      
      results.push({
        exploit_type: exploitType,
        success: evaluation.success,
        payload,
        response: result,
        evidence: evaluation.evidence,
        impact: evaluation.impact,
      })

      if (evaluation.success) break
    }
  }

  return {
    exploit_results: results,
  }
}

export async function hitlApprovalGate(state: MissionState): Promise<Partial<MissionState>> {
  const destructivePatterns = [
    /\bDROP\s+/i, /\bDELETE\s+FROM/i, /\bTRUNCATE\s+/i,
    /\bSHUTDOWN\b/i, /rm\s+-rf/i, /format\s+/i
  ]

  const hasDestructive = state.exploit_results.some(r => 
    destructivePatterns.some(pattern => pattern.test(r.payload || ''))
  )

  if (hasDestructive) {
    return {
      needs_human_approval: true,
    }
  }

  return {
    needs_human_approval: false,
    human_response: 'auto_approved',
  }
}

function selectExploitType(task: TaskAssignment): string {
  for (const vector of OWASP_ARSENAL) {
    if (task.description.toLowerCase().includes(vector)) {
      return vector
    }
  }
  return 'sqli'
}

function generatePayload(exploitType: string, params: Record<string, unknown>): string {
  const payloads: Record<string, string[]> = {
    sqli: ["' OR '1'='1", "'; DROP TABLE users--"],
    xss: ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>"],
    idor: ["../admin", "../../etc/passwd"],
  }
  
  const exploitPayloads = payloads[exploitType] || ['test']
  return exploitPayloads[Math.floor(Math.random() * exploitPayloads.length)]
}

async function evaluateExploit(result: unknown, exploitType: string): Promise<{success: boolean, evidence: string, impact: string}> {
  return {
    success: false,
    evidence: '',
    impact: '',
  }
}
```

### 6.4 Critic Agent

```typescript
// src/agents/critic.ts
import { MissionState } from './state'
import { ExploitResult } from './schemas'

const DETERMINISTIC_RULES = {
  sqli: (result: ExploitResult) => {
    if (result.http_status === 500) {
      const body = result.response_body?.toLowerCase() || ''
      const dbErrors = ['syntax error', 'mysql', 'pg error', 'ora-', 'sqlite']
      return dbErrors.some(e => body.includes(e))
    }
    return false
  },
  xss: (result: ExploitResult) => {
    const body = (result.response_body || '').toLowerCase()
    const payload = result.injected_payload?.toLowerCase() || ''
    return body.includes(payload.replace(/</g, '&lt;'))
  },
  idor: (result: ExploitResult) => {
    return result.http_status === 200 && result.baseline_response !== result.response_body
  },
}

export async function criticEvaluate(state: MissionState): Promise<Partial<MissionState>> {
  const results = []
  let criticalCount = 0
  let highCount = 0

  for (const exploit of state.exploit_results) {
    const verdict = deterministicEvaluate(exploit)
    
    results.push({
      ...exploit,
      success: verdict.success,
      reason: verdict.reason,
    })

    if (verdict.success) {
      if (exploit.severity === 'CRITICAL') criticalCount++
      if (exploit.severity === 'HIGH') highCount++
    }
  }

  return {
    exploit_results: results,
    critical_findings_count: (state.critical_findings_count ?? 0) + criticalCount,
    high_findings_count: (state.high_findings_count ?? 0) + highCount,
  }
}

function deterministicEvaluate(result: ExploitResult): { success: boolean; reason: string } {
  const rule = DETERMINISTIC_RULES[result.vulnerability_type as keyof typeof DETERMINISTIC_RULES]
  
  if (rule) {
    const success = rule(result)
    return {
      success,
      reason: success ? '' : `Deterministic check failed for ${result.vulnerability_type}`,
    }
  }

  return { success: false, reason: 'Unknown vulnerability type' }
}
```

---

## 7. Schema Translation

### 7.1 Pydantic → Zod

**Python (Current)**

```python
class TaskAssignment(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    description: str
    target: str = ""
    tools_allowed: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)

class AuthorizationContext(BaseModel):
    type: Literal['vdp', 'pentest_contract', 'ctf', 'private_lab']
    evidence_url: str | None
    scope_domains: list[str]
    excluded_domains: list[str]
    authorized_by: str
    authorized_at: str
    expiry: str | None
    checksum: str
```

**TypeScript (Target)**

```typescript
// src/agents/schemas.ts
import { z } from 'zod'

export const TaskAssignmentSchema = z.object({
  task_id: z.string().optional(),
  description: z.string(),
  target: z.string().default(''),
  tools_allowed: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
})

export const AuthorizationContextSchema = z.object({
  type: z.enum(['vdp', 'pentest_contract', 'ctf', 'private_lab']),
  evidence_url: z.string().optional(),
  scope_domains: z.array(z.string()),
  excluded_domains: z.array(z.string()).default([]),
  authorized_by: z.string(),
  authorized_at: z.string(),
  expiry: z.string().optional(),
  checksum: z.string(),
})

export const CommanderPlanSchema = z.object({
  strategy: z.string(),
  tasks: z.array(TaskAssignmentSchema).default([]),
  next_phase: z.enum(['recon', 'exploitation', 'complete']),
})

export const ExploitResultSchema = z.object({
  target: z.string(),
  exploit_type: z.string(),
  success: z.boolean(),
  payload: z.string().optional(),
  http_status: z.number().optional(),
  response_body: z.string().optional(),
  evidence: z.string().optional(),
  impact: z.string().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).default('MEDIUM'),
})

export const A2AMessageSchema = z.object({
  msg_id: z.string(),
  sender: z.enum(['commander', 'agent_alpha', 'agent_beta', 'agent_gamma', 'agent_critic']),
  recipient: z.union([z.enum(['commander', 'agent_alpha', 'agent_beta', 'agent_gamma', 'agent_critic']), z.literal('all')]),
  type: z.enum([
    'TASK_ASSIGNMENT', 'STRATEGY_UPDATE', 'INTELLIGENCE_REPORT',
    'EXPLOIT_RESULT', 'STATUS_UPDATE', 'HITL_REQUEST', 'HITL_RESPONSE',
    'MISSION_START', 'MISSION_COMPLETE'
  ]),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  payload: z.record(z.unknown()).default({}),
  timestamp: z.string(),
})

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>
export type AuthorizationContext = z.infer<typeof AuthorizationContextSchema>
export type CommanderPlan = z.infer<typeof CommanderPlanSchema>
export type ExploitResult = z.infer<typeof ExploitResultSchema>
export type A2AMessage = z.infer<typeof A2AMessageSchema>
```

---

## 8. API Migration

### 8.1 FastAPI → Hono

**Python (Current)**

```python
from fastapi import FastAPI, HTTPException

app = FastAPI()

@app.post("/missions")
async def create_mission(request: CreateMissionRequest):
    mission = await create_mission_internal(request)
    return mission

@app.get("/missions/{mission_id}")
async def get_mission(mission_id: str):
    mission = await get_mission_by_id(mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")
    return mission

@app.post("/missions/{mission_id}/execute")
async def execute_mission(mission_id: str):
    await execute_mission_internal(mission_id)
    return {"status": "executing"}
```

**TypeScript (Target)**

```typescript
// src/api/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { missionRoutes } from './routes/missions'
import { executeRoutes } from './routes/execute'
import { eventsRoutes } from './routes/events'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.route('/missions', missionRoutes)
app.route('/missions', executeRoutes)
app.route('/events', eventsRoutes)

app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
```

```typescript
// src/api/routes/missions.ts
import { Hono } from 'hono'
import { createMission, getMissionById, listMissions } from '../../services/mission'

const missions = new Hono()

missions.post('/', async (c) => {
  const body = await c.req.json()
  const mission = await createMission(body)
  return c.json(mission, 201)
})

missions.get('/', async (c) => {
  const missions = await listMissions()
  return c.json(missions)
})

missions.get('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  const mission = await getMissionById(missionId)
  if (!mission) {
    return c.json({ error: 'Mission not found' }, 404)
  }
  return c.json(mission)
})

export default missions
```

```typescript
// src/api/routes/execute.ts
import { Hono } from 'hono'
import { executeMission } from '../../services/executor'

const execute = new Hono()

execute.post('/:missionId', async (c) => {
  const missionId = c.req.param('missionId')
  
  const result = await executeMission(missionId)
  
  return c.json({
    mission_id: missionId,
    status: result.status,
    phase: result.phase,
  })
})

export default execute
```

---

## 9. Implementation Roadmap

| Phase | Duration | Tasks |
|-------|----------|-------|
| **1** | Weeks 1-2 | Set up TS project, StateMachine, Hono, cloud clients |
| **2** | Weeks 3-4 | Implement all agents (Commander, Alpha, Gamma, Critic) |
| **3** | Weeks 5-6 | Tool registry, sandbox, A2A messaging, RAG |
| **4** | Weeks 7-8 | REST API, WebSocket, auth gate, budget tracking |
| **5** | Weeks 9-10 | Unit tests, integration tests, migration |

### 9.1 Phase 1: Foundation

- [ ] Initialize TypeScript project with Bun
- [ ] Configure all cloud clients (Upstash, Qdrant, Neo4j)
- [ ] Implement StateMachine class
- [ ] Set up Hono API server
- [ ] Configure environment variables

### 9.2 Phase 2: Agent Core

- [ ] Implement Commander agent
- [ ] Implement Alpha (Recon) agent
- [ ] Implement Gamma (Exploit) agent
- [ ] Implement Critic (Evaluation) agent
- [ ] Implement HITL Gate
- [ ] Wire up graph execution

### 9.3 Phase 3: Infrastructure

- [ ] Implement tool registry
- [ ] Implement sandbox executor (nsjail)
- [ ] Implement A2A messaging (Upstash)
- [ ] Implement episodic memory (Qdrant)
- [ ] Implement attack graph (Neo4j)

### 9.4 Phase 4: API & Events

- [ ] Implement mission CRUD endpoints
- [ ] Implement mission execution endpoint
- [ ] Add WebSocket event streaming
- [ ] Implement authorization gate
- [ ] Add budget tracking

### 9.5 Phase 5: Testing & Migration

- [ ] Write unit tests for all agents
- [ ] Write integration tests
- [ ] Run parallel with Python version
- [ ] Migrate data if needed
- [ ] Decommission Python version

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// tests/agents/commander.test.ts
import { describe, it, expect, vi } from 'vitest'
import { commanderPlan } from '../../src/agents/commander'
import { createInitialState } from '../../src/agents/graph'

vi.mock('../../src/core/llm-client', () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue(JSON.stringify({
      strategy: 'Test strategy',
      tasks: [{ description: 'Test task', target: 'http://test.com' }],
      next_phase: 'recon'
    }))
  }))
}))

describe('Commander Agent', () => {
  it('should generate task assignments', async () => {
    const state = createInitialState({
      objective: 'Test objective',
      target: 'http://test.com'
    })

    const result = await commanderPlan(state)

    expect(result.strategy).toBeDefined()
    expect(result.current_tasks).toHaveLengthGreaterThan(0)
  })
})
```

### 10.2 Safety Tests

| Test | Expected Behavior |
|------|-------------------|
| Authorization bypass | No auth → Mission rejected at preflight |
| Scope enforcement | Target outside scope → Rejected |
| Checksum tampering | Invalid HMAC → Rejected |
| Budget exceeded | cost_usd >= max_cost_usd → Mission terminated |
| Workspace isolation | Concurrent missions → Separate directories |

---

## 11. Environment Variables

```bash
# Upstash Redis
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxx

# Qdrant Cloud
QDRANT_URL=https://xxx.us-east-1-0.qdrant.cloud
QDRANT_API_KEY=your-api-key

# Neo4j Aura
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:14b

# Application
NODE_ENV=production
LOG_LEVEL=info
AUTHORIZATION_HMAC_SECRET=your-secret-key
```

---

## Appendix A: Key Features from Phase 2 Plan

### A.1 Authorization Gate

```typescript
// src/core/auth.ts
import { createHmac } from 'crypto'

export function computeAuthorizationChecksum(auth: AuthorizationContext): string {
  const fields = [
    auth.type,
    auth.evidence_url || '',
    auth.scope_domains.sort().join(','),
    auth.excluded_domains.sort().join(','),
    auth.authorized_by,
    auth.authorized_at,
    auth.expiry || '',
  ]
  const canonical = fields.join('|')
  
  return createHmac('sha256', process.env.AUTHORIZATION_HMAC_SECRET!)
    .update(canonical)
    .digest('hex')
}

export function verifyChecksum(auth: AuthorizationContext): boolean {
  const expected = computeAuthorizationChecksum(auth)
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(auth.checksum))
}

export function verifyScope(target: string, scope_domains: string[]): boolean {
  try {
    const targetHost = new URL(target).hostname
    return scope_domains.some(domain => {
      const scopeHost = domain.toLowerCase().replace(/^\*\./, '')
      return targetHost === scopeHost || targetHost.endsWith('.' + scopeHost)
    })
  } catch {
    return false
  }
}
```

### A.2 Credential Vault

```typescript
// src/core/credential-vault.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const VAULT_PREFIX = 'vault:credential:'
const DEFAULT_TTL = 3600

export class CredentialVault {
  private fernet: ReturnType<typeof createCipheriv>

  constructor(fernetKey: string) {
    const key = Buffer.from(fernetKey, 'base64')
    this.fernet = createCipheriv('aes-128-cbc', key, key.slice(0, 16))
  }

  async store(redis: Redis, missionId: string, cred: CredentialContext): Promise<string> {
    const handle = randomBytes(8).toString('base64url')
    const key = `${VAULT_PREFIX}${missionId}:${handle}`
    
    const plaintext = JSON.stringify(cred)
    const encrypted = this.fernet.update(plaintext, 'utf8', 'base64') + this.fernet.final('base64')
    
    await redis.setex(key, DEFAULT_TTL, encrypted)
    return handle
  }

  async retrieve(redis: Redis, missionId: string, handle: string): Promise<CredentialContext | null> {
    const key = `${VAULT_PREFIX}${missionId}:${handle}`
    const encrypted = await redis.get(key)
    
    if (!encrypted) return null
    
    try {
      const decipher = createDecipheriv('aes-128-cbc', 
        Buffer.from(process.env.CREDENTIAL_VAULT_KEY!, 'base64'),
        Buffer.from(process.env.CREDENTIAL_VAULT_KEY!, 'base64').slice(0, 16)
      )
      const plaintext = decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
      return JSON.parse(plaintext)
    } catch {
      return null
    }
  }
}
```

### A.3 Mission Throttle

```typescript
// src/core/throttle.ts
import { randomInt } from 'crypto'

const MODES = {
  normal: { rps: 10, jitter_ms: 200 },
  stealth: { rps: 2, jitter_ms: 2000 },
  fast: { rps: 50, jitter_ms: 0 },
}

export class MissionThrottle {
  private limiter: AsyncLimiter
  private config: typeof MODES.normal
  private rng: () => number

  constructor(mode: 'normal' | 'stealth' | 'fast' = 'normal') {
    this.config = MODES[mode]
    this.limiter = new AsyncLimiter(this.config.rps, 1000)
    this.rng = () => randomInt(0, 1000) / 1000
  }

  async acquire(): Promise<ThrottleContext> {
    await this.limiter.acquire()
    
    const jitter = this.config.jitter_ms / 1000 * this.rng()
    await new Promise(r => setTimeout(r, jitter))

    return {
      ua: this.config.jitter_ms > 0 ? this.rotateUA() : undefined,
    }
  }

  private rotateUA(): string {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0',
    ]
    return uas[randomInt(uas.length)]
  }
}

interface ThrottleContext {
  ua?: string
}

class AsyncLimiter {
  private tokens: number
  private last: number
  private readonly maxRate: number
  private readonly timePeriod: number

  constructor(maxRate: number, timePeriod: number) {
    this.maxRate = maxRate
    this.timePeriod = timePeriod
    this.tokens = maxRate
    this.last = Date.now()
  }

  async acquire(): Promise<void> {
    while (this.tokens < 1) {
      await new Promise(r => setTimeout(r, 10))
      this.refill()
    }
    this.tokens--
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.last) / this.timePeriod
    this.tokens = Math.min(this.maxRate, this.tokens + elapsed * this.maxRate)
    this.last = now
  }
}
```

---

*Document Version: 1.0*
*Last Updated: 2026-03-30*
*Status: Implementation Ready*
