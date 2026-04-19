# Chain Planner Agent Specification

**Agent:** Chain Planner
**Type:** `chain_planner`
**Tier:** Tier 4 (Cloud)
**Model:** `qwen-3-235b-a22b-instruct-2507` (Cerebras primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.85
**Poll Interval:** 1000ms

---

## 1. Identity & Role

Chain Planner is the **attack chain expansion engine** of the Solaris swarm. It activates whenever a credential, session token, or privileged artifact is promoted to the Recon section, traverses the graph to find all exploits now unlocked by the new asset, and generates chained mission sequences.

**Chain Planner DOES:**
- Activate on credential_found and credential_promoted events
- Traverse the graph to find newly-unlocked attack surface
- Generate chained mission sequences (simple to complex)
- Handle ALL chain complexity levels (IDOR, auth escalation, RCE pivot)
- Emit mission_queued events for chained missions
- Track attack path nodes in the graph

**Chain Planner DOES NOT:**
- Execute exploits (Gamma's job)
- Validate credentials (Commander's job)
- Generate initial missions (Mission Planner's job)

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Chain Planner: DORMANT on init → STANDBY on credential_found or credential_promoted event
               STANDBY → ACTIVE on chain generation task
               ACTIVE → COOLDOWN on chain generation complete
               COOLDOWN → STANDBY if more credential events pending
               COOLDOWN → DORMANT if queue empty
               Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/chain-planner.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: credential_found, credential_promoted, exploit_completed)
4. Set state: DORMANT
5. Begin poll loop at 1000ms interval
```

### Chain Generation Flow

```
On credential_found or credential_promoted:
1. Read credential node from graph
2. Determine credential type and scope
3. Traverse graph to find newly-reachable endpoints
4. For each newly-reachable endpoint:
   → Determine exploit type
   → Check if mission already exists
   → Calculate priority
   → Write ChainNode with steps
   → Write dependent MissionNodes
5. Emit mission_queued for each new chained mission
```

### Chain Type Patterns

```
Admin JWT extracted:
  → What is now unlocked?
  → Admin Section access (/admin/*)
  → User data endpoints (/api/users)
  → Feedback deletion (/api/feedback/{id})
  → Product tampering (/api/products/{id}/price)
  → Any endpoint requiring admin: Bearer auth
  Emits: 4-5 chained missions in dependency order

User session cookie found:
  → IDOR check: can cookie access other user IDs?
  → What endpoints accept cookie auth vs JWT?
  → Is session reusable for CSRF?
  → Can we pivot to admin via password reset?
  Emits: 3-4 lateral missions

Plain-text password found:
  → Login as user
  → Check password reuse across services
  → Forgot-password flow to escalate
  → Session hijacking if httpOnly missing
  Emits: 3-4 escalation missions

API key found in JS:
  → Authenticated endpoint scan
  → Privileged data access
  → Key rotation check
  → Key scope enumeration
  Emits: 3-4 key-specific missions

SSRF/Path traversal confirmed:
  → File enumeration (passwd, /etc/hosts)
  → Internal service discovery
  → Config file extraction
  → Credential harvesting from filesystem
  Emits: 4-5 internal reconnaissance missions
```

### Shutdown Sequence

```
1. Flush any pending chain writes to graph
2. Close FalkorDB connection
3. Close EventBus connection
4. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `credential_found` | `{credential_id, target_id, cred_type, value, bridge_node_id}` | Gamma/MCP emits when raw credential extracted |
| `credential_promoted` | `{credential_id, bridge_node_id, surface_unlocked}` | Commander emits after MCP probe confirms credential |
| `exploit_completed` | `{mission_id, success, exploit_type, artifacts}` | Gamma emits on mission success (may unlock new surface) |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `mission_queued` | `{mission_id, executor, target_endpoint, exploit_type, priority, escalation_level, context_nodes, credential_nodes, chain_id, created_by:"chain_planner"}` | Chained mission generated |
| `attack_path` | `{path_id, chain_id, steps: [{mission_id, endpoint, exploit_type}], target_asset}` | Attack path node written |

### Collaboration Sequences

**Credential Discovery Flow:**
```
Gamma extracts admin JWT → emits credential_found
  → Chain Planner wakes
  → Chain Planner reads credential node
  → Chain Planner traverses graph: "What does admin JWT unlock?"
  → Chain Planner writes ChainNode with ordered steps
  → Chain Planner writes dependent MissionNodes
  → Chain Planner emits mission_queued → Verifier → Commander → Gamma
```

**Post-Exploit Chain Flow:**
```
Gamma confirms RCE → emits rce_confirmed
  → Post-Exploit wakes → generates server-side missions
  → Chain Planner also wakes on rce_confirmed (subscribes to exploit_completed)
  → Chain Planner generates lateral movement chains
```

---

## 4. Memory Schema

### Section Prefix

Chain Planner reads from **all sections**, writes to **gamma/** (ChainNode, MissionNodes).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `CredentialNode` | `id, cred_type, value, scope, validation_status` |
| `EndpointNode` | `id, method, path, url, auth_required` |
| `MissionNode` | `id, exploit_type, target_endpoint, status` |
| `ComponentNode` | `id, name, fingerprint` |
| `ChainNode` | `id, steps, status` |
| `TargetNode` | `id, scope, out_of_scope` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `ChainNode` | `{id, type:"chain", name, chain_type: "credential_abuse"\|"idor"\|"auth_escalation"\|"rce_pivot", steps: [{order, mission_id, action, outcome}], status:"active"\|"completed"\|"failed", created_at, created_by:"chain_planner"}` | Credential unlocks new surface |
| `MissionNode` | `{id, type:"mission", ..., chain_id: CHAIN_ID, created_by:"chain_planner"}` | Chained mission |
| `AttackPathNode` | `{id, type:"attack_path", chain_id, steps: [], target_asset, created_at}` | Attack path discovered |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:CHAINS_INTO` | CredentialNode → ChainNode | New chain from credential |
| `:NEXT_IN_CHAIN` | MissionNode → MissionNode | Ordered chain steps |
| `:LED_TO` | ExploitNode → CredentialNode | Credential extracted from exploit |

### Lifecycle

- **ChainNode**: Created on credential discovery, updated to "completed" or "failed" on chain resolution
- **MissionNodes**: Created as part of chain, tracked via chain_id
- **AttackPathNode**: Created for visual attack chain diagrams in reports

---

## 5. Tool Usage

### Can Use

Chain Planner has **no tool access** — it uses LLM reasoning + graph traversal + graph operations.

```
(Intentionally empty — Chain Planner uses only graph operations and event bus)
```

### Cannot Use

| Tool | Reason |
|------|--------|
| All tools | Chain Planner is a reasoning agent — it analyzes graph relationships, not executes tools |

### How Chain Planner Processes

```
THOUGHT: Analyze this credential
  - What type is it (JWT, cookie, password, API key)?
  - What scope does it have?
  - What endpoints does it authenticate against?
  - What attacks does it enable?

TRAVERSAL: graph.traverse(credential_id, edge_types: [:UNLOCKS, :AUTHENTICATED_VIA], depth: 3)
  - Find all endpoints the credential grants access to
  - Find all missions already targeting those endpoints
  - Determine which are new opportunities

CHAIN: Design attack sequence
  - Step 1: Use credential to access endpoint X
  - Step 2: Extract new credential from response
  - Step 3: Use new credential to access endpoint Y
  - ...

WRITE: ChainNode + dependent MissionNodes
EMIT: mission_queued for each step
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/chain-planner.md
2. Load credential context:
   - Credential node (type, value, scope)
   - Target scope
3. Load graph traversal results:
   - Newly-reachable endpoints
   - Existing missions on those endpoints
4. Load chain templates:
   - Admin JWT chain pattern
   - Session cookie chain pattern
   - Password escalation pattern
   - SSRF lateral movement pattern
5. Compose final prompt with specific credential context
```

### Context Budget

- **Estimated tokens per chain:** ~800–1500
- **Context budget per chain:** ~3000 tokens
- **Overflow behavior:** Not expected — credential context is bounded

### Session State

What persists:
- `pending_credentials`: Queue of credential events to process
- `active_chains`: Map of chain_id → ChainNode

What is re-read from graph:
- Credential node
- Endpoint nodes
- Existing mission states

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Mission Planner: (implicit — chained missions use same pipeline)
→ Verifier:        mission_queued (chained missions go through standard pipeline)
→ Commander:       (implicit — Verifier → Commander flow)
→ Report Agent:    (implicit — attack_path nodes used in final report)
```

### Information Requests

Chain Planner requests information by traversing graph — no event-based requests to other agents.

### Attack Path Modeling

```
Chain generates attack path:
  Step 1: Extract admin JWT from /api/login
  Step 2: Use admin JWT to access /api/admin/users
  Step 3: Extract user list from response
  Step 4: Use user IDs for IDOR on /api/users/{id}/profile
  
ChainNode written with:
  - steps: ordered mission references
  - chain_type: "auth_escalation"
  - status: "active"

AttackPathNode written for report:
  - Links all steps for visual diagram
  - Target asset: "user_data"
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[chain-planner] State: DORMANT → STANDBY
[chain-planner] Credential received: CREDENTIAL_ID (type: TYPE)
[chain-planner] Chain analysis: Analyzing credential scope
[chain-planner] Graph traversal: N endpoints newly reachable
[chain-planner] Chain generated: CHAIN_ID (type: CHAIN_TYPE, steps: N)
[chain-planner] Chain step: MISSION_ID → ENDPOINT (exploit_type: TYPE)
[chain-planner] Mission queued: MISSION_ID (chained, priority: PRIORITY)
[chain-planner] Attack path: PATH_ID → [STEPS] → TARGET_ASSET
[chain-planner] State: ACTIVE → COOLDOWN
[chain-planner] State: COOLDOWN → DORMANT
```

### Trace Commands

```bash
# Live logs
pm2 logs chain-planner

# Active chains
redis-cli GRAPH.QUERY solaris "MATCH (c:chain {status:'active'}) RETURN c.id, c.chain_type, size(c.steps)"

# Chained missions
redis-cli GRAPH.QUERY solaris "MATCH (m:mission) WHERE m.chain_id IS NOT NULL RETURN m.id, m.chain_id, m.exploit_type"

# Attack paths
redis-cli GRAPH.QUERY solaris "MATCH (p:attack_path) RETURN p.id, p.target_asset, size(p.steps)"
```

---

## 9. Error Handling

### Rate Limit Errors

Chain Planner uses Cerebras with high rate limits. On 429:
```
→ Exponential backoff: 2s base, max 60s
→ Max 5 retries before degrading gracefully
→ If Cerebras rate limited: fallback to Groq
```

### LLM Generation Errors

```
Malformed output:
  → Retry with same context (max 2 retries)
  → If still malformed: skip that credential, log warning

API error:
  → Fallback to Groq
  → If Groq also fails: buffer credential, retry next cycle

Timeout:
  → Retry once
  → If still timeout: buffer credential, retry next cycle
```

### Graph Write Errors

```
ChainNode write failure:
  → Buffer in memory
  → Retry with exponential backoff
  → If still failing: log critical, do not emit mission_queued
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 1000ms |
| Chain generation SLA | < 30s per credential |
| Graph traversal SLA | < 5s |

### Chain Generation SLA

| Task | Target | Max |
|------|--------|-----|
| Credential analysis | < 3s | 5s |
| Graph traversal | < 5s | 10s |
| Chain design | < 10s | 20s |
| Mission writing (per step) | < 2s | 5s |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~500MB |
| Model memory | ~0 (cloud) |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~515MB** |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| LLM call (chain design) | 30s |
| Graph traversal | 10s |
| Graph write | 5s |

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results
- [Gamma §3](./gamma.md#3-event-contract) — Credential extraction flow (Gamma → Chain Planner)
- [Commander §3](./commander.md#3-event-contract) — Credential promotion flow (Commander → Chain Planner)
- [Mission Planner §3](./mission-planner.md#3-event-contract) — Mission generation (Chain Planner → Verifier pipeline)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns

*Chain Planner spec version 1.0 — 2026-04-03*
