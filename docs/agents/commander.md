# Commander Agent Specification

**Agent:** Commander
**Type:** `commander`
**Tier:** Tier 3 (Cloud)
**Model:** `llama-3.3-70b-versatile` (Groq primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.5
**Poll Interval:** 500ms

---

## 1. Identity & Role

Commander is the **strategic authority** of the Solaris swarm. It governs all mission lifecycle transitions, validates findings, authorizes exploitation, promotes credentials, manages escalation levels, and declares swarm completion.

**Commander DOES:**
- Validate raw findings (scope, duplicates, noise, signal quality)
- Authorize or reject missions (strategic gate, not structural)
- Promote confirmed credentials after MCP probe verification
- Manage escalation levels (baseline → aggressive → evasive)
- Detect drain condition and emit `swarm_complete`
- Monitor agent health and trigger recovery

**Commander DOES NOT:**
- Execute exploit tools
- Generate mission payloads
- Directly communicate with targets
- Bypass Verifier structural checks
- Modify mission payloads or targets

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Commander: DORMANT on init → STANDBY permanently (never goes DORMANT again)
           STANDBY ←→ ACTIVE on event processing
           Any → ERROR on unexpected failure → reset to STANDBY after backoff
```

Commander is the only agent that is **permanently warm** — its model stays loaded from swarm start to swarm complete.

### Init Sequence

```
1. Load system prompt: commander.md + TargetConfig context
2. Connect to FalkorDB (read own section: bridge/ verified credentials)
3. Connect to EventBus (subscribe to: finding_written, mission_verified, exploit_completed,
   exploit_failed, validation_probe_complete, brief_ready)
4. Set state: STANDBY
5. Begin poll loop at 500ms interval
```

### Poll Loop

```
1. Consume all pending events for subscriptions (batch processing)
2. For each finding_written:
     → Run 4 validation checks
     → If PASS: emit finding_validated
     → If FAIL: drop silently (no event)
3. For each mission_verified:
     → Apply strategic authorization
     → If AUTHORIZED: set authorized=true, emit mission_authorized
     → If REJECTED: mark rejected, do not emit
4. For each validation_probe_complete:
     → Read probe result from bridge node
     → If 2xx: promote to recon/, emit credential_promoted
     → If 4xx: mark expired, emit nothing
     → If 5xx: mark probe_error, retry once after 30s
5. For each exploit_completed:
     → Check if all missions done → evaluate drain condition
6. For each exploit_failed:
     → Log failure pattern, update escalation if needed
7. Drain condition check (every 60s heartbeat):
     → If queue empty AND all agents dormant AND no pending findings:
       → Emit swarm_complete
```

### Shutdown Sequence

```
1. Flush any pending graph writes
2. Mark all open missions as 'archived' (graceful stop)
3. Close FalkorDB connection
4. Close EventBus connection
5. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `finding_written` | `{target_id, finding_type, vuln_class, evidence: {request, response, matched_pattern}, source}` | Alpha, OSINT emit when raw finding found |
| `mission_verified` | `{mission_id, verified_by, checks_passed: string[]}` | Verifier emits after structural validation |
| `exploit_completed` | `{mission_id, success, artifacts: [{type, value, node_id}], evidence}` | Gamma, MCP emit on mission finish |
| `exploit_failed` | `{mission_id, failure_class, attempt, error}` | Gamma, MCP emit on mission failure |
| `validation_probe_complete` | `{probe_id, artifact_id, result: "success"\|"expired"\|"error", http_status}` | MCP Agent emits after credential probe |
| `brief_ready` | `{mission_id, brief_node_id}` | OSINT emits when ExploitBrief is written |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `finding_validated` | `{finding_id, target_id, vuln_class, priority_hint: "critical"\|"high"\|"medium"\|"low", escalation_recommendation: "baseline"\|"aggressive"\|"evasive"}` | All 4 validation checks pass |
| `mission_authorized` | `{mission_id, escalation_level, authorized_by}` | Strategic gate passed |
| `credential_promoted` | `{credential_id, bridge_node_id, promoted_by, surface_unlocked: string[]}` | MCP probe returns 2xx |
| `swarm_complete` | `{swarm_id, summary: {mission_count, success_count, failure_count, duration_ms}}` | Drain condition met |
| `enrichment_requested` | `{target_id, enrichment_type, reason}` | Credential found, needs OSINT enrichment |
| `waf_duel_started` | `{duel_id, mission_id, waf_type}` | 3 consecutive waf_blocked on same endpoint |
| `retry_recommended` | `{mission_id, analysis}` | Critic recommends retry with bypass |
| `abandon_recommended` | `{mission_id, reason}` | Critic recommends archiving |

### Collaboration Sequences

**Finding Validation Flow:**
```
Alpha/OSINT emits finding_written
  → Commander reads finding from graph
  → Commander runs: scope_check, duplicate_check, noise_filter, signal_quality
  → If PASS: emit finding_validated → Mission Planner wakes
  → If FAIL: drop silently
```

**Mission Authorization Flow:**
```
Verifier emits mission_verified (structural gate passed)
  → Commander reads mission node
  → Commander applies strategic gate:
      - Is mission worth attempting?
      - Not redundant with failed mission?
      - Target still reachable?
  → If AUTHORIZED: write authorized=true, emit mission_authorized → Gamma wakes
  → If REJECTED: mark rejected, emit nothing
```

**Credential Promotion Flow:**
```
Gamma/MCP emits credential_found (raw artifact in bridge/)
  → Commander reads bridge node
  → Commander emits validation_probe_requested → MCP Agent wakes
  → MCP Agent probes target with artifact
  → MCP Agent emits validation_probe_complete
  → Commander reads probe result from bridge node
  → If HTTP 2xx: write validation_status="confirmed", move to recon/, emit credential_promoted → Chain Planner wakes
  → If HTTP 4xx/timeout: write validation_status="expired"
  → If HTTP 5xx: write validation_status="probe_error", retry once after 30s
```

**Drain Condition Check (every 60s):**
```
All of:
  - Mission queue empty (no missions in queued/active/pending_verification)
  - Alpha Recon is DORMANT
  - Chain Planner is DORMANT
  - OSINT is DORMANT
  - No unconsumed finding_validated events
If ALL TRUE:
  → Emit swarm_complete → Report Agent wakes
```

---

## 4. Memory Schema

### Section Prefix

Commander reads from **all sections**, writes to **bridge/**.

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `FindingNode` | `id, type, source, target_endpoint, vuln_class, evidence` |
| `MissionNode` | `id, exploit_type, target_endpoint, priority, context_nodes, depends_on, status` |
| `CredentialNode` | `id, cred_type, value, scope, validation_status, validated_by` |
| `VulnerabilityNode` | `id, vuln_class, cve, cvss_score, cisa_kev, exploitdb_poc` |
| `EndpointNode` | `id, method, path, url, auth_required` |
| `GammaHandoffNode` | `id, mission_id, hypothesis, confirmed_facts, failed_payloads` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `CredentialNode` (promoted) | `{id, type:"credential", cred_type, value, scope, validation_status:"confirmed", validated_by:"commander", promoted_at}` | MCP probe 2xx |

### Edges Created

Commander does not create edges directly — it updates node properties.

### Lifecycle

- **Finding nodes**: Read-only, never modified by Commander
- **Mission nodes**: `authorized` field toggled to `true` or left `false`
- **Bridge nodes**: `validation_status` updated through probe lifecycle
- **Promoted credentials**: Moved from `bridge/` to `recon/` by updating the node

---

## 5. Tool Usage

### Can Use

Commander has **no tool access** — it is purely a graph-reader and event-emitter.

```
(Intentionally empty — Commander uses only graph operations and event bus)
```

### Cannot Use

All exploit tools are explicitly blocked:
- No nmap, masscan, curl, sqlmap, etc.
- No browser tools (browser_navigate, etc.)
- No credential attacks (john, hashcat, hydra)
- No post-exploitation tools (linpeas, etc.)

This is architecturally enforced via the ToolRegistry role-scoped permissions.

### How Commander Processes

Commander does not call tools directly. Instead:
1. LLM reasons about the event payload
2. LLM generates a graph query or decision
3. Commander executes graph operations directly via FalkorDB client
4. Commander emits events to trigger other agents

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/commander.md
2. Load TargetConfig context:
   - Target name, base_url, scope, out_of_scope patterns
   - Tech stack hints
3. Load current swarm state:
   - Active mission count
   - Queued mission count
   - Findings validated count
   - Recent 5 events
4. Load specific event context (from event payload)
5. Compose final prompt with all above
```

### Context Budget

- **Estimated tokens per validation cycle:** ~800–1200
- **Batch processing:** Up to 20 events per poll cycle
- **Overflow behavior:** Process in FIFO order, log if batch exceeds context

### Session State

What persists across poll cycles:
- `state`: current agent state
- `stateChangedAt`: timestamp of last transition
- `errorMessage`: last error if any
- `drainConditionCheckTimer`: 60s interval handle

What is re-read from graph each wake:
- Pending events (from EventBus)
- Mission nodes referenced in events
- Finding nodes referenced in events
- Credential nodes for promotion decisions

---

## 7. Multi-Agent Communication

### Task Delegation

Commander delegates through events, never direct calls:

```
→ Gamma/MCP:         mission_authorized (triggers exploitation)
→ Mission Planner:    finding_validated (triggers mission generation)
→ Chain Planner:      credential_promoted (triggers attack surface mapping)
→ Report Agent:       swarm_complete (triggers final report)
→ OSINT:             enrichment_requested (triggers intelligence gathering)
→ Critic:             (implicit via exploit_failed event reaching Gamma)
→ MCP Agent:         validation_probe_requested (triggers credential validation)
```

### Information Requests

Commander requests information by emitting events with `request_id` — other agents emit completion events with matching `request_id`.

### Handoff Protocol

Not applicable — Commander does not hand off work mid-flight.

---

## 8. Observability & Debugging

### Key Log Lines

```
[commander] State: DORMANT → STANDBY (initial)
[commander] State: STANDBY → ACTIVE (processing batch of N events)
[commander] Finding validation: PASS | FAIL — finding_id=FINDING_ID
[commander] Mission authorization: AUTHORIZED | REJECTED — mission_id=MISSION_ID
[commander] Credential promoted: BRIDGE_ID → recon/CREDENTIAL_ID
[commander] Credential expired: BRIDGE_ID (http_status=401)
[commander] Drain condition check: NOT MET (reason: N missions queued)
[commander] Drain condition MET — emitting swarm_complete
[commander] State: ACTIVE → COOLDOWN
[commander] State: COOLDOWN → STANDBY
[commander] Error: ERROR_MESSAGE — State: STANDBY → ERROR
```

### Trace Commands

```bash
# Live logs
pm2 logs commander

# Historical events
sqlite3 solaris-events.db "SELECT * FROM events WHERE created_by='commander' ORDER BY created_at DESC LIMIT 50"

# Graph state
redis-cli GRAPH.QUERY solaris "MATCH (m:Mission) WHERE m.authorized=true RETURN m.id, m.status"
```

### Diagnostic Queries

```sql
-- Pending validations
SELECT COUNT(*) FROM events WHERE type='finding_written' AND consumed=false;

-- Mission queue depth
SELECT COUNT(*) FROM events WHERE type='mission_authorized' AND consumed=false;

-- Swarm drain readiness
SELECT
  (SELECT COUNT(*) FROM events WHERE type='mission_authorized' AND consumed=false) AS pending_missions,
  (SELECT COUNT(*) FROM events WHERE type='finding_validated' AND consumed=false) AS pending_findings;
```

---

## 9. Error Handling

### Rate Limit Errors

Commander uses cloud models (Groq/Cerebras) with high rate limits. On 429:
- Exponential backoff: 1s base, max 30s
- Max 5 retries before degrading gracefully
- If Groq rate limited: fallback to Cerebras cascade

### Tool Execution Errors

Not applicable — Commander does not execute tools.

### LLM Generation Errors

```
Malformed output:     Retry with same prompt (max 3 retries)
API error (5xx):      Fallback to next provider in cascade
Timeout (>30s):       Log warning, emit error event, transition to ERROR state
Auth error (401):     Log critical — API key issue, do not retry
```

### Graph Write Errors

```
Connection loss:       Buffer state changes in memory, reconnect with exponential backoff
Conflict (409):       Retry MERGE operation, log conflict
Node not found:       Log warning, skip operation
```

### Error Recovery

```
ERROR state entered:
  → Log error with full context
  → Set 30s backoff timer
  → After backoff: transition to DORMANT → STANDBY
  → Resume poll loop
  → Events are not lost (EventBus preserves unconsumed events)
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 500ms |
| Events processed per cycle | Up to 20 (batch) |
| Validation SLA per finding | < 30s |
| Authorization SLA per mission | < 30s |
| Drain condition check | Every 60s (heartbeat) |

### Mission Completion SLA

Commander does not execute missions — these are Gamma/MCP targets. Commander's SLA is:
- Finding validation: < 30s per batch
- Mission authorization: < 30s per mission
- Drain condition detection: < 60s after conditions met

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
| LLM call (validation) | 30s |
| LLM call (authorization) | 30s |
| Graph query (single node) | 5s |
| Graph query (batch) | 15s |
| EventBus consume (batch) | 2s |
| MCP probe (credential validation) | 60s |

---

*Commander spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Verifier §5](./verifier.md#5-tool-usage) — Tool usage constraints (Commander has no tool access)
- [Gamma §3](./gamma.md#3-event-contract) — Mission authorization flow (Commander authorizes Gamma missions)
- [OSINT §3](./osint.md#3-event-contract) — Enrichment request flow
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
