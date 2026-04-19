# Solaris-Agent: Unified Graph Memory Architecture

**Version:** 1.0
**Date:** 2026-04-03
**Status:** Draft — For Review

---

## Overview

The graph is the **single source of truth** for all agent state. Agents do not share memory through message passing alone — they read from and write to shared graph nodes. This document describes the unified graph architecture: section ownership, cross-agent access patterns, node lifecycle, and the interaction model between all 12 agents.

---

## Graph Sections

The graph is partitioned into **6 sections** by prefix. Each section has an owner (write access), co-writers, and readers.

```
Section   Owner             Co-Writers          Readers
───────────────────────────────────────────────────────────────────────
recon/    Alpha, OSINT     Commander (promote)  ALL agents
gamma/    Gamma, MCP       —                   ALL agents
bridge/   Gamma, MCP       Commander (probe)    Commander, Chain Planner
intel/    OSINT           —                   ALL agents
lessons/  Critic          —                   ALL agents
events/   (EventBus — not a graph section)
```

---

## Node Type Registry

All node types, their section, owner, and schema source.

### Core Nodes

| Node Type | Section | Owner | Schema Source |
|-----------|---------|-------|--------------|
| `TargetNode` | — (root) | Alpha (init) | `graph/schema.ts:TargetNodeSchema` |
| `EndpointNode` | `recon/` | Alpha | `graph/schema.ts:EndpointNodeSchema` |
| `ComponentNode` | `recon/` | Alpha | `graph/schema.ts:ComponentNodeSchema` |
| `VulnerabilityNode` | `recon/` | Alpha, OSINT | `graph/schema.ts:VulnerabilityNodeSchema` |
| `UserNode` | `recon/` | Alpha | `graph/schema.ts:UserNodeSchema` |
| `CredentialNode` | `recon/` (promoted) | Commander (promote from bridge) | `graph/schema.ts:CredentialNodeSchema` |
| `FindingNode` | `recon/` | Alpha, OSINT, Gamma | `graph/schema.ts:FindingNodeSchema` |
| `PortNode` | `recon/` | Alpha | `graph/schema.ts` |
| `MissionNode` | `gamma/` | All agents that create missions | `graph/schema.ts:MissionNodeSchema` |
| `ExploitNode` | `gamma/` | Gamma, MCP, Specialist | `graph/schema.ts:ExploitNodeSchema` |
| `ArtifactNode` | `bridge/` (raw) | Gamma, MCP | `graph/schema.ts:ArtifactNodeSchema` |
| `GammaHandoffNode` | `gamma/` | Gamma | `graph/schema.ts:GammaHandoffNodeSchema` |
| `WafDuelNode` | `gamma/` | Critic, OSINT | `graph/schema.ts:WafDuelNodeSchema` |
| `IntelNode` | `intel/` | OSINT | `graph/schema.ts:IntelNodeSchema` |
| `ExploitBriefNode` | `intel/` | OSINT | `graph/schema.ts:ExploitBriefNodeSchema` |
| `LessonNode` | `lessons/` | Critic | `graph/schema.ts:LessonNodeSchema` |
| `FailedMissionNode` | `lessons/` | Critic | `graph/schema.ts:FailedMissionNodeSchema` |
| `BeliefNode` | `recon/` | Commander | `graph/schema.ts:BeliefNodeSchema` |
| `SpecialistConfig` | `gamma/` | Commander | `graph/schema.ts:SpecialistConfigNodeSchema` |
| `ChainNode` | `gamma/` | Chain Planner | `graph/schema.ts:ChainNodeSchema` |
| `CrossEngagementLesson` | Supabase (persistent) | Critic | `graph/schema.ts:CrossEngagementLessonNodeSchema` |

---

## Section-by-Section Architecture

### recon/ — Attack Surface

**Owner:** Alpha Recon, OSINT
**Co-Writers:** Commander (credential promotion only)
**Readers:** ALL agents

**Nodes:**
- `EndpointNode` — URLs, methods, parameters discovered by Alpha
- `ComponentNode` — Tech fingerprinting (Express@4.18, sqlite3, etc.)
- `VulnerabilityNode` — CVEs, weakness classes with CVSS scores
- `UserNode` — Discovered user accounts
- `CredentialNode` — **Promoted** credentials (moved here from bridge/ by Commander)
- `FindingNode` — Raw findings from Alpha, OSINT, Gamma
- `PortNode` — Open ports discovered by Alpha
- `BeliefNode` — POMDP beliefs (if belief_state flag enabled)

**Access Patterns:**

```
Alpha → recon/
  Write: EndpointNode, ComponentNode, PortNode, FindingNode
  Read: TargetNode scope patterns

OSINT → recon/
  Write: VulnerabilityNode (from CVE feeds), FindingNode
  Read: ComponentNode (to match CVEs to tech stack)

Commander → recon/
  Write: CredentialNode (promote from bridge/)
  Read: All recon/ nodes for validation

Gamma → recon/
  Read: CredentialNode, EndpointNode (for exploit context)

Mission Planner → recon/
  Read: FindingNode, EndpointNode, VulnerabilityNode (for mission generation)

Chain Planner → recon/
  Read: CredentialNode, EndpointNode (for chain expansion)

Critic → recon/
  Read: EndpointNode, ComponentNode (for failure analysis)

Report Agent → recon/
  Read: All recon/ nodes (for final report)
```

### gamma/ — Mission Execution

**Owner:** Gamma, MCP, Specialist
**Co-Writers:** Mission Planner, Chain Planner, Post-Exploit (mission creation)
**Readers:** Commander, Gamma pool, Chain Planner, Critic

**Nodes:**
- `MissionNode` — Tasks for Gamma/MCP to execute
- `ExploitNode` — Every exploit attempt (immutable audit trail)
- `GammaHandoffNode` — Context relay when Gamma context budget exceeded
- `WafDuelNode` — WAF bypass modeling sessions
- `SpecialistConfig` — Dynamic specialist spawn configuration
- `ChainNode` — Multi-step attack sequences

**Access Patterns:**

```
Gamma → gamma/
  Write: ExploitNode (every attempt), GammaHandoffNode (on context overflow)
  Read: MissionNode (claim), GammaHandoffNode (on receive)

MCP → gamma/
  Write: ExploitNode, ArtifactNode (bridge/)
  Read: MissionNode

Mission Planner → gamma/
  Write: MissionNode (new missions)
  Read: MissionNode (to check duplicates)

Chain Planner → gamma/
  Write: ChainNode
  Read: MissionNode (to check chain status)

Post-Exploit → gamma/
  Write: MissionNode (post-exploit missions)
  Read: MissionNode

Commander → gamma/
  Read: MissionNode (for queue depth, drain condition)
```

### bridge/ — Pending Validation

**Owner:** Gamma, MCP
**Co-Writers:** Commander (writes probe result)
**Readers:** Commander, Chain Planner

**Nodes:**
- `ArtifactNode` (unvalidated) — Raw tokens, cookies, passwords extracted by Gamma/MCP

**Lifecycle:**

```
1. Gamma extracts JWT from response
   → Writes ArtifactNode to bridge/ with validation_status="pending"
   → Emits credential_found

2. Commander reads bridge node
   → Emits validation_probe_requested

3. MCP Agent probes target with JWT
   → Writes probe result (http_status) to bridge node

4. Commander reads probe result:
   → If 2xx: promotes to recon/ as CredentialNode, validation_status="confirmed"
   → If 4xx/timeout: validation_status="expired"
   → If 5xx: validation_status="probe_error", retry once
```

**Access Patterns:**

```
Gamma → bridge/
  Write: ArtifactNode (raw credentials)
  Read: None

MCP → bridge/
  Write: ArtifactNode (validation probe result update)
  Read: ArtifactNode (to probe)

Commander → bridge/
  Write: validation_status update after probe
  Read: ArtifactNode (to decide promotion)

Chain Planner → bridge/
  Read: ArtifactNode (pending credentials for chain expansion)
  Note: Chain Planner reads from bridge/ only for context, not for promotion decisions
```

### intel/ — Intelligence

**Owner:** OSINT
**Co-Writers:** None
**Readers:** ALL agents

**Nodes:**
- `IntelNode` — CVE details, payload libraries, technique docs
- `ExploitBriefNode` — Pre-execution cheat sheet for specific missions

**Access Patterns:**

```
OSINT → intel/
  Write: IntelNode (from feeds), ExploitBriefNode (for missions)
  Read: IntelNode (to avoid duplicates)

Gamma → intel/
  Read: ExploitBriefNode (for mission context), IntelNode (lesson refs)

Mission Planner → intel/
  Read: IntelNode (for priority scoring, ExploitDB PoC flags)

Chain Planner → intel/
  Read: IntelNode (for technique documentation)

Critic → intel/
  Read: IntelNode (for bypass techniques on failure)

Alpha → intel/
  Read: IntelNode (for nuclei templates)
```

### lessons/ — Archive

**Owner:** Critic
**Co-Writers:** None
**Readers:** ALL agents

**Nodes:**
- `LessonNode` — Success after failure (pattern learned)
- `FailedMissionNode` — Archived failure with full evidence

**Access Patterns:**

```
Critic → lessons/
  Write: LessonNode (on success after failure), FailedMissionNode (after 3 failures)
  Read: LessonNode (for causal attribution)

Gamma → lessons/
  Read: LessonNode (for retry guidance, bypass payloads)

MCP → lessons/
  Read: LessonNode (for session/context reuse)

Commander → lessons/
  Read: FailedMissionNode (for audit trail)

Report Agent → lessons/
  Read: LessonNode, FailedMissionNode (for final report)

Post-Exploit → lessons/
  Read: LessonNode (for GTFOBins/LOLBAS references)
```

---

## Cross-Agent Memory Interaction Patterns

### Pattern 1: Sequential Handoff

```
Agent A writes node → Event → Agent B reads node → processes → writes output

Example: Alpha discovers endpoint
Alpha → recon/EndpointNode → endpoint_discovered event → Gamma reads → executes exploit → ExploitNode
```

### Pattern 2: Validation Gate

```
Agent A writes to bridge/ → Event → Commander reads → validates → promotes to recon/

Example: Gamma extracts JWT
Gamma → bridge/ArtifactNode → credential_found event → Commander reads → validation_probe_requested → MCP probes → validation_probe_complete → Commander promotes to recon/CredentialNode
```

### Pattern 3: Context Enrichment

```
Agent A reads from graph → enriches with external data → writes back

Example: OSINT enrichment
OSINT reads VulnerabilityNode → queries NVD API → updates VulnerabilityNode with CVSS
```

### Pattern 4: Chain Expansion

```
Agent A writes credential → Chain Planner reads → expands graph → writes new MissionNodes

Example: JWT promotion
Commander promotes JWT → recon/CredentialNode → credential_promoted event → Chain Planner reads → expands graph → ChainNode + MissionNodes
```

### Pattern 5: Handoff Relay

```
Gamma instance A context overflow → writes GammaHandoffNode → Gamma instance B reads → continues

Example: Long-running exploit
Gamma-1 → gamma/GammaHandoffNode → handoff_requested event → Gamma-2 reads → continues mission
```

### Pattern 6: Batch Read → Write

```
Agent A reads multiple nodes → processes batch → writes multiple nodes

Example: Mission Planner batch
Mission Planner reads 10 FindingNodes → generates 10 MissionNodes → writes all to gamma/
```

---

## Node Lifecycle State Machine

### FindingNode Lifecycle

```
Alpha/OSINT writes FindingNode (status: raw)
  ↓
Commander validates finding
  ↓ (if valid)
FindingNode status: validated
  ↓
Mission Planner generates MissionNode
  ↓ (if exploit succeeds)
Gamma writes ExploitNode
  ↓ (if finding confirmed)
FindingNode linked to ExploitNode via :EXPLOITS edge
  ↓ (report generation)
Report Agent reads FindingNode for final report
```

### CredentialNode Lifecycle

```
Gamma/MCP extracts credential → writes ArtifactNode to bridge/ (validation_status: pending)
  ↓
Commander reads bridge/ArtifactNode → emits validation_probe_requested
  ↓
MCP probes target → writes probe result to bridge/ArtifactNode
  ↓
Commander reads probe result:
  ├─ If 2xx: promotes ArtifactNode to recon/CredentialNode (validation_status: confirmed)
  ├─ If 4xx/timeout: bridge/ArtifactNode validation_status: expired
  └─ If 5xx: bridge/ArtifactNode validation_status: probe_error → retry once
  ↓ (if confirmed)
Chain Planner reads CredentialNode → expands attack surface
```

### MissionNode Lifecycle

```
Mission Planner writes MissionNode (status: pending_verification)
  ↓
Verifier runs 6 pre-flight checks
  ↓ (if all pass)
MissionNode status: queued, verified: true
  ↓
Commander authorizes (or rejects)
  ↓ (if authorized)
MissionNode status: queued, authorized: true, mission_authorized event
  ↓
Gamma/MCP claims mission
  ↓ (claim)
MissionNode status: active, claimed_by: agent_id
  ↓ (exploit completes)
Gamma/MCP writes ExploitNode → emits exploit_completed/exploit_failed
  ↓ (if failed, attempt < 3)
Critic analyzes → retry (attempt++)
  ↓ (if failed, attempt >= 3)
MissionNode status: archived
  ↓ (if success)
MissionNode status: completed
```

### GammaHandoffNode Lifecycle

```
Gamma-1 context budget exceeds threshold (3000 tokens)
  ↓
Gamma-1 writes GammaHandoffNode with:
  - hypothesis
  - confirmed_facts
  - failed_payloads
  - next_action
  - context_budget
  ↓
Gamma-1 emits handoff_requested event
  ↓
Gamma-2 (or next available) reads GammaHandoffNode
  ↓
Gamma-2 continues from next_action
  ↓
GammaHandoffNode consumed_at set to timestamp
```

---

## FalkorDB Client Interface

All graph operations go through `FalkorDBClient` in `infra/falkordb.ts`.

### Core Operations

```typescript
// Node operations
createNode(label: string, id: string, properties: Record<string, unknown>): Promise<Record>
updateNode(id: string, properties: Record<string, unknown>): Promise<Record | null>
deleteNode(id: string): Promise<boolean>
findNodeById<T>(id: string): Promise<T | null>
findNodesByLabel<T>(label: string, filter?: Record<string, unknown>): Promise<T[]>

// Edge operations
createEdge(fromId: string, toId: string, edgeType: string, properties?: Record): Promise<void>
findEdges(fromId: string, edgeType?: string): Promise<string[]>
findEdgeWithProps(fromId: string, toId: string, edgeType: string): Promise<Record | null>

// Traversal
traverse(startId: string, edgeTypes: string[], depth?: number): Promise<string[]>
getContext(nodeId: string, depth?: number): Promise<Record>

// Mission queue
claimMission(executorType: string, agentId: string): Promise<string | null>

// KV operations (for TTL, state, locks)
setKV(key: string, value: unknown, ttl?: number): Promise<void>
getKV<T>(key: string): Promise<T | null>
delKV(key: string): Promise<void>
```

### Gamma Handoff Pattern

```typescript
// When context overflows
await graph.createNode('gamma_handoff', `handoff:${missionId}:${attempt}:${agentId}`, {
  mission_id: missionId,
  from_instance: agentId,
  hypothesis: currentHypothesis,
  confirmed_facts: confirmedFacts,
  failed_payloads: failedPayloads,
  next_action: nextAction,
  context_budget: estimatedTokens,
  written_at: Date.now(),
});

// When next Gamma instance picks up
const handoff = await graph.findNodeById<GammaHandoffNode>(handoffId);
if (handoff) {
  await graph.updateNode(handoffId, { consumed_at: Date.now() });
  // Resume from handoff.next_action
}
```

---

## Graph Prefix Conventions

All node IDs use section prefixes for ownership clarity:

```
recon/target:juiceshop          — TargetNode
recon/endpoint:api/login        — EndpointNode
recon/credential:jwt-001         — CredentialNode (promoted)
recon/finding:sqli-login-001    — FindingNode
bridge/artifact:jwt-raw-001      — ArtifactNode (unvalidated)
bridge/artifact:cookie-raw-001  — ArtifactNode (unvalidated)
gamma/mission:sqli-login-003   — MissionNode
gamma/exploit:attempt-001      — ExploitNode
gamma/handoff:mission:sqli-001 — GammaHandoffNode
gamma/specialist:graphql-001     — SpecialistConfig
intel/cve:CVE-2024-1234         — VulnerabilityNode (from OSINT)
intel/brief:mission:sqli-003   — ExploitBriefNode
lessons/lesson:sqli-bypass-001 — LessonNode
lessons/failed:sqli-login-003  — FailedMissionNode
```

---

## Event-Driven vs Graph-Driven

### Event-Driven (Asynchronous, Fire-and-Forget)

Use events when:
- Action doesn't require reading graph state
- Multiple agents should react to same trigger
- No transactional guarantee needed

```
Gamma emits exploit_completed
  → Commander wakes, validates
  → Chain Planner wakes, expands chains
  → OSINT wakes, updates briefs
```

### Graph-Driven (Synchronous, Read-Process-Write)

Use graph when:
- Need current state before acting
- Need transactional consistency
- Need to read multiple nodes

```
Mission Planner:
1. Read: all FindingNodes in batch (graph)
2. Process: calculate priorities (LLM)
3. Write: all MissionNodes (graph)
4. Emit: mission_queued events
```

### Hybrid (Most Common)

Most operations are hybrid — read graph, process, write graph, emit event:

```
Commander validates finding:
1. Read: FindingNode from graph
2. Read: TargetNode scope patterns from graph
3. Process: run 4 validation checks (LLM)
4. Write: nothing (if FAIL) OR emit finding_validated (if PASS)
5. Emit: finding_validated event
```

---

## Consistency Rules

### 1. Atomic Mission Claim

```cypher
// Atomic claim with Redis lock
MATCH (m:Mission {status: 'queued', verified: true, authorized: true})
WHERE m.executor = 'gamma'
WITH m ORDER BY m.priority DESC, m.created_at ASC LIMIT 1
SET m.status = 'active', m.claimed_by = $agentId
RETURN m.id
// Redis NX ensures only one agent wins
```

### 2. Credential Promotion is Atomic

```cypher
// Move from bridge/ to recon/ with single query
MATCH (a:ArtifactNode {id: $bridgeId, validation_status: 'pending'})
MATCH (a)-[:FOUND_AT]->(e:EndpointNode)
CREATE (c:CredentialNode {
  id: 'recon/credential:' + a.id,
  cred_type: a.cred_type,
  value: a.value,
  scope: [e.url],
  validation_status: 'confirmed',
  validated_at: $now
})
SET a.validation_status = 'promoted'
RETURN c
```

### 3. Handoff is Atomic

```typescript
// Write handoff + update mission status in same transaction
await graph.createNode('gamma_handoff', handoffId, handoffData);
await graph.updateNode(missionId, { status: 'queued', claimed_by: null });
```

---

## Supabase (Persistent Storage)

FalkorDB is **per-engagement** (reset after swarm_complete). Supabase stores **cross-engagement** data.

### Supabase Tables

| Table | Written By | Read By | Content |
|-------|-----------|---------|---------|
| `engagements` | Commander (on swarm_complete) | All agents (on start) | Engagement metadata |
| `cross_engagement_lessons` | Critic (on swarm_complete) | OSINT (on start) | Persistent lessons keyed by stack fingerprint |
| `run_reports` | Report Agent (on swarm_complete) | External systems | Final pentest reports |
| `target_configs` | Commander (on init) | All agents (on start) | Target configuration history |

### Cross-Engagement Lesson Flow

```
On swarm_complete:
  Critic → Supabase: INSERT cross_engagement_lessons
    (stack_fingerprint, exploit_type, failure_class, lesson_id)

On next engagement start:
  OSINT → Supabase: SELECT * FROM cross_engagement_lessons
    WHERE stack_fingerprint OVERLAPS current_stack
    ORDER BY relevance_score DESC LIMIT 20
  OSINT → FalkorDB intel/: Write top 20 as LessonNodes
```

---

## Light RAG — Sectional Vector Indexes

**Purpose:** Replace slow graph traversals with fast 50ms vector similarity searches.

### The Problem

```
Commander: MATCH (f:Finding) WHERE f.source='alpha' RETURN f → 1000s latency
Alpha: MATCH (e:endpoint {scanned:false}) RETURN e → 5000ms poll killer
```

### The Solution: Per-Section Vector Indexes

FalkorDB Native Vector Support:
```cypher
CALL db.idx.vector.createNodeIndex('recon_endpoints', 'recon_node', 'embedding', 1024, 'COS')
CALL db.idx.vector.createNodeIndex('intel_briefs', 'intel_node', 'payload_embedding', 1024, 'COS')
```

### Light RAG Architecture

```
Graph (FalkorDB)
├── recon/ ──→ recon_rag_index (endpoints, components, findings)
├── intel/ ──→ intel_rag_index (briefs, payloads, CVE)
├── bridge/ ──→ bridge_rag_index (credentials, handoffs)
├── lessons/ ─→ lessons_rag_index (deltas, patterns)
└── gamma/ ──→ gamma_rag_index (exploits, missions)
```

### Vector Index Configuration

| Section | Index Name | Label | Embedding Property | Dimensions |
|---------|-----------|-------|-------------------|------------|
| `recon/` | `recon_rag_index` | `recon_node` | `embedding` | 1024 |
| `gamma/` | `gamma_rag_index` | `gamma_node` | `embedding` | 1024 |
| `bridge/` | `bridge_rag_index` | `bridge_node` | `embedding` | 1024 |
| `intel/` | `intel_rag_index` | `intel_node` | `payload_embedding` | 1024 |
| `lessons/` | `lessons_rag_index` | `lessons_node` | `embedding` | 1024 |

### Text Properties for Embedding

| Section | Text Properties |
|---------|----------------|
| `recon/` | `url`, `path`, `description`, `vuln_class`, `name` |
| `gamma/` | `exploit_type`, `payload`, `target_endpoint`, `evidence` |
| `bridge/` | `name`, `content_type`, `path` |
| `intel/` | `name`, `data`, `technique_summary`, `exploit_type` |
| `lessons/` | `exploit_type`, `failure_class`, `delta`, `tags` |

### Hybrid Query Pattern

Agents query RAG + Cypher for fast, filtered results:

```typescript
// Alpha: Unscanned endpoints (RAG + Cypher)
const results = await lightRAG.queryHybrid(
  'recon',
  'SQL injection endpoints with authentication',
  'n.scanned = false AND n.method = "POST"',
  limit: 10
);

// Commander: Recent SQLi findings
const findings = await lightRAG.queryHybrid(
  'recon',
  'SQL injection vulnerabilities with high CVSS',
  "n.vuln_class = 'SQLi' AND n.created_at > 1709500000000",
  limit: 20
);
```

### LightRAG API (`src/infra/light-rag.ts`)

```typescript
class LightRAG {
  async initialize(): Promise<void>;
  async indexNode(section, nodeId, properties): Promise<void>;
  async query(query: RAGQuery): Promise<RAGResult[]>;
  async queryHybrid(section, queryText, cypherFilter, limit): Promise<RAGResult[]>;
  async reindexSection(section): Promise<number>;
}

interface RAGQuery {
  section: 'recon' | 'gamma' | 'bridge' | 'intel' | 'lessons';
  queryText: string;
  limit?: number;
  filter?: Record<string, unknown>;
}

interface RAGResult {
  nodeId: string;
  score: number;
  node: Record<string, unknown>;
}
```

### Embedding Service (`src/infra/embeddings.ts`)

```typescript
class EmbeddingService {
  async embed(text: string): Promise<EmbeddingResult>;
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  cosineSimilarity(a: number[], b: number[]): number;
}

interface EmbeddingResult {
  embedding: number[];
  model: string;  // 'mxbai-embed-large'
  tokens: number;
}
```

### Section Prefix Enforcement

All node IDs use section prefixes per the GRAPH_ARCHITECTURE:

```typescript
import { sectionNodeId, parseSectionNodeId } from 'infra/falkordb.ts';

const nodeId = sectionNodeId('recon', 'endpoint:api/login');
// → 'recon/endpoint:api/login'

const parsed = parseSectionNodeId('recon/endpoint:api/login');
// → { section: 'recon', nodeId: 'endpoint:api/login' }
```

### Usage Examples

```typescript
// Agent Alpha: Find unscanned endpoints for a specific target
const unscanned = await lightRAG.query({
  section: 'recon',
  queryText: `endpoints on example.com with parameters`,
  limit: 50,
  filter: { scanned: false }
});

// Agent Gamma: Get relevant exploit briefs for mission
const briefs = await lightRAG.query({
  section: 'intel',
  queryText: `SQL injection with time-based blind techniques`,
  limit: 5
});

// Agent Critic: Find similar past failures
const failures = await lightRAG.query({
  section: 'lessons',
  queryText: `SQL injection WAF blocked payload rejected`,
  limit: 10
});

// Agent Commander: Hybrid query with graph filter
const findings = await lightRAG.queryHybrid(
  'recon',
  'critical vulnerabilities with proof of concept',
  "n.cvss_score >= 9.0 AND n.exploitdb_poc = true",
  25
);
```

---

## Observability

### Graph Diagnostics

```bash
# Node counts by section
redis-cli GRAPH.QUERY solaris "MATCH (n) RETURN labels(n)[0], count(n) GROUP BY labels(n)[0]"

# Active missions
redis-cli GRAPH.QUERY solaris "MATCH (m:Mission) WHERE m.status IN ['queued','active'] RETURN m.id, m.executor, m.priority ORDER BY m.priority DESC"

# Unvalidated bridge artifacts
redis-cli GRAPH.QUERY solaris "MATCH (a:artifact) WHERE a.validation_status = 'pending' RETURN a.id, a.subtype"

# Failed missions
redis-cli GRAPH.QUERY solaris "MATCH (f:failed_mission) RETURN f.failure_class, count(f) GROUP BY f.failure_class"

# Handoff nodes pending
redis-cli GRAPH.QUERY solaris "MATCH (h:gamma_handoff) WHERE h.consumed_at IS NULL RETURN h.mission_id, h.next_action"
```

### Event Bus Diagnostics

```sql
-- Pending events by type
SELECT type, COUNT(*) FROM events WHERE consumed = false GROUP BY type;

-- Events by source agent
SELECT created_by, COUNT(*) FROM events GROUP BY created_by;

-- Oldest unconsumed events
SELECT id, type, created_at, created_by FROM events WHERE consumed = false ORDER BY created_at ASC LIMIT 20;
```

---

## See Also

- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Model configuration
- [commander.md](./commander.md#4-memory-schema) — Commander memory operations
- [gamma.md](./gamma.md#4-memory-schema) — Gamma memory operations
- [alpha.md](./alpha.md#4-memory-schema) — Alpha memory operations
- [osint.md](./osint.md#4-memory-schema) — OSINT memory operations
- [SPEC-DESIGN.md#4-memory-schema] — All agent memory schemas
- `src/infra/light-rag.ts` — Light RAG implementation
- `src/infra/embeddings.ts` — Embedding generation service
- `src/infra/falkordb.ts` — FalkorDB client with vector index support

*Graph Memory Architecture version 1.1 — 2026-04-03*
