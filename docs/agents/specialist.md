# Specialist Agent Specification

**Agent:** Specialist (Dynamic Gamma Variant)
**Type:** `specialist`
**Tier:** Tier 2 (Local Ollama + Cloud fallback)
**Model:** `llama3-groq-tool-use:8b-q4_K_M` (Ollama primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.85
**Poll Interval:** 2000ms

---

## 1. Identity & Role

Specialist is a **dynamic Gamma variant** spawned when Alpha Recon discovers novel attack surface (GraphQL, WebSocket, JWT, OAuth, etc.). It is not a permanent agent type — it is a short-lived Gamma instance with a specialized system prompt and pre-seeded mission template.

**Specialist DOES:**
- Spawn dynamically when novel surface detected
- Execute surface-specific exploitation missions
- Use specialist overlay prompts (GraphQL, WebSocket, JWT, etc.)
- Consume missions from specialist queue
- Despawn when surface exhausted or all missions complete

**Specialist DOES NOT:**
- Exist at swarm launch (spawned on demand)
- Have a permanent role in the roster
- Bypass standard Verifier/Commander pipeline
- Access tools outside its surface-specific overlay

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Specialist: SPAWNED by Commander → STANDBY on specialist_activated event
           STANDBY → ACTIVE on mission claim
           ACTIVE → COOLDOWN on mission complete
           COOLDOWN → STANDBY if more missions in specialist queue
           COOLDOWN → DESPAWN if queue empty OR despawn_trigger fired
```

### Spawn Sequence

```
Alpha Recon discovers novel surface:
  → Alpha emits component_detected with surface_type
  → Commander recognizes surface_type in SpecialistSurfaceMap
  → Commander creates SpecialistConfig node in graph
  → Commander spawns specialist via PM2:
     pm2.start({
       name: "specialist-{type}-{id}",
       script: "bun",
       args: "run agents/specialist.ts",
       env: { SPECIALIST_CONFIG: specialist_id, AGENT_ROLE: "specialist" }
     })
  → Specialist loads SpecialistConfig from graph
  → Specialist loads specialist-specific overlay prompt
  → Specialist sets state: STANDBY
```

### Specialist Surface Map

| Surface Type | Specialist Prompt | Pre-Loaded Missions |
|---|---|---|
| GraphQL | GraphQL security expert | Introspection → field enum → query batching → alias injection |
| WebSocket | WebSocket security expert | CSWSH test → origin bypass → message injection |
| JWT | JWT security expert | alg:none → weak secret → kid injection → claim tampering |
| File Upload | Upload security expert | MIME bypass → filename traversal → polyglot |
| OAuth | OAuth 2.0 security expert | redirect_uri bypass → state forgery → code replay |
| SAML | SAML security expert | XML signature bypass → assertion injection |
| Redis | Redis security expert | UNMASK → CONFIG GET → SLAVEOF → module execution |
| SMTP | SMTP security expert | Relay test → user enum → mail spoofing |

### Mission Execution

```
Specialist executes same mission loop as Gamma (§2), but:
1. Uses specialist overlay prompt instead of base gamma.md
2. Has surface-specific tool access (from SpecialistConfig)
3. Emits same events as Gamma (exploit_completed, exploit_failed, etc.)
4. All missions go through Verifier → Commander pipeline (no bypass)
```

### Despawn Sequence

```
When specialist queue empty OR surface exhausted:
1. Specialist writes final report to SpecialistConfig node
2. Specialist updates SpecialistConfig status: "despawned"
3. Specialist closes connections
4. PM2 process terminates
5. Commander marks SpecialistConfig as "despawned"
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `specialist_activated` | `{specialist_id, surface_type, parent_mission, system_prompt}` | Commander emits on specialist spawn |
| `mission_authorized` | `{mission_id, executor:"specialist", target_endpoint, exploit_type, ...}` | Commander emits for specialist-targeted missions |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `exploit_completed` | `{mission_id, success, exploit_type, artifacts}` | Specialist mission succeeds |
| `exploit_failed` | `{mission_id, failure_class, attempt, error}` | Specialist mission fails |
| `specialist_complete` | `{specialist_id, result, surface_exhausted: boolean}` | Specialist despawns |

### Collaboration Sequences

**Spawn Flow:**
```
Alpha discovers /graphql endpoint
  → Alpha emits component_detected (surface_type="graphql")
  → Commander reads surface_type, checks SpecialistSurfaceMap
  → Commander creates SpecialistConfig node
  → Commander spawns specialist-gamma-graphql-001
  → specialist-gamma emits specialist_activated
  → Specialist waits for missions
```

**Mission Flow:**
```
Commander emits mission_authorized (executor: specialist, surface_type: graphql)
  → Specialist claims mission
  → Specialist executes with GraphQL overlay
  → On success: emits exploit_completed
  → On failure: emits exploit_failed → Critic analyzes
  → All missions go through Verifier → Commander pipeline (no bypass)
```

**Despawn Flow:**
```
Specialist queue empty:
  → Specialist emits specialist_complete (surface_exhausted: true)
  → Commander updates SpecialistConfig status: "despawned"
  → PM2 process terminates
```

---

## 4. Memory Schema

### Section Prefix

Specialist writes to **gamma/** (mission results) and **bridge/** (artifacts) — same as Gamma.

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `SpecialistConfig` | `id, surface_type, system_prompt, mission_template, spawn_condition, despawn_trigger` |
| `MissionNode` | `id, exploit_type, target_endpoint, context_nodes` |
| `ExploitBriefNode` | `surface-specific techniques, bypass methods` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `ExploitNode` | Same schema as Gamma | Every attempt |
| `ArtifactNode` | Same schema as Gamma | Artifact extracted |
| `SpecialistConfig` (update) | `{status:"despawned", result, completed_at}` | Specialist despawns |

### Lifecycle

- **SpecialistConfig**: Created by Commander on spawn, updated to "despawned" on despawn
- **ExploitNodes/ArtifactNodes**: Same as Gamma — permanent audit trail

---

## 5. Tool Usage

### Tool Access

Specialist uses the same tool set as Gamma, plus surface-specific tools:

| Tool | Added For |
|------|----------|
| `curl` | All specialists (HTTP-based exploitation) |
| Surface-specific tools | Per specialist type (see below) |

#### Per-Surface Tool Additions

| Surface Type | Additional Tools |
|---|---|
| GraphQL | `curl` with graphql body format |
| WebSocket | `curl` (upgrade headers), `browser_navigate` (MCP) |
| JWT | `curl` (token crafting) |
| OAuth | `curl` (redirect URI probing) |
| File Upload | `curl` (multipart upload), `browser_navigate` (MCP) |

### Cannot Use

Same exclusions as Gamma, plus:
- Any tools NOT in the specialist's overlay prompt

### How Specialist Uses Tools

```
Same pattern as Gamma (§5), but with surface-specific overlays:

For GraphQL specialist:
  THOUGHT: Execute GraphQL introspection bypass
    - Send introspection query disguised as legitimate request
    - Parse schema for mutation endpoints
    - Identify exploitable fields

  ACTION: curl with graphql body
  OBSERVATION: Parse JSON response
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/specialist.md
2. Load SpecialistConfig from graph:
   - surface_type
   - system_prompt (specialist seed)
   - mission_template
3. Load surface-specific overlay:
   - prompt-overlays/graphql.md (or websocket.md, jwt.md, etc.)
4. Load mission context (from event payload)
5. Compose specialist prompt:
   ${base_gamma_prompt}
   + ${specialist_system_prompt_seed}
   + ${surface_overlay}
   + ${mission_context}
```

### Context Budget

Same as Gamma (§6) — estimated 3000 tokens per mission.

### Session State

What persists across missions:
- `specialist_config_id`: SpecialistConfig node ID
- `surface_type`: Current surface type
- `missions_completed`: Count of completed missions

What is re-read from graph:
- SpecialistConfig (to check despawn_trigger)
- Mission nodes

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Critic:         exploit_failed (standard failure loop)
→ Commander:      specialist_complete (despawn notification)
→ Chain Planner: (implicit — credential_found triggers Chain Planner)
```

### No Bypass of Standard Pipeline

```
CRITICAL: Specialist missions MUST go through standard pipeline:
  → Verifier structural check (all 6 checks)
  → Commander strategic review
  → NO bypasses, NO exceptions

Specialist is just a Gamma variant with specialized prompts.
It does NOT bypass any swarm gates.
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[specialist-graphql-001] State: SPAWNED → STANDBY
[specialist-graphql-001] Surface type: graphql
[specialist-graphql-001] System prompt loaded: GraphQL security expert
[specialist-graphql-001] Overlay: prompt-overlays/graphql.md
[specialist-graphql-001] Mission claimed: MISSION_ID
[specialist-graphql-001] Executing: GraphQL introspection bypass
[specialist-graphql-001] GraphQL schema extracted: N types, M mutations
[specialist-graphql-001] Mission complete: MISSION_ID (success=true)
[specialist-graphql-001] Queue empty — emitting specialist_complete
[specialist-graphql-001] State: ACTIVE → COOLDOWN
[specialist-graphql-001] Specialist complete: surface_exhausted=true
[specialist-graphql-001] PM2 terminating
```

### Trace Commands

```bash
# Live logs
pm2 logs specialist-graphql-001

# Active specialists
redis-cli GRAPH.QUERY solaris "MATCH (s:specialist_config {status:'active'}) RETURN s.id, s.surface_type"

# Specialist exploits
redis-cli GRAPH.QUERY solaris "MATCH (e:exploit {executed_by: 'specialist-graphql-001'}) RETURN e.mission_id, e.success"
```

---

## 9. Error Handling

### Spawn Failures

```
PM2 start failure:
  → Commander retries once
  → If still failing: log critical, do not spawn specialist
  → Surface remains unhandled (can be Gamma fallback)

Config load failure:
  → Specialist retries graph read once
  → If still failing: emit specialist_complete (surface_exhausted: false)
  → Commander logs warning
```

### Same Error Handling as Gamma

Specialist uses the same error handling patterns as Gamma (§9):
- Rate limit errors: exponential backoff, fallback cascade
- Tool execution errors: retry, classify, emit exploit_failed
- LLM generation errors: retry, fallback, emit exploit_failed
- Graph write errors: buffer, retry, log critical

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 2000ms (same as Gamma) |
| Spawn SLA | < 10s from surface detection to STANDBY |

### Mission Completion SLA

Same as Gamma (§10) — surface-specific missions may be faster or slower depending on complexity.

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~1.5GB (same as Gamma) |
| Ollama model | ~8GB VRAM (shared with Gamma pool) |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~1.5GB RSS + 8GB VRAM** |

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results
- [Gamma §5](./gamma.md#5-tool-usage) — Tool permission matrix (Specialist inherits Gamma's tool set)
- [Alpha §3](./alpha.md#3-event-contract) — Surface detection flow (Alpha → Commander → Specialist)
- [Commander §3](./commander.md#3-event-contract) — Specialist spawning decision
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns

*Specialist spec version 1.0 — 2026-04-03*
