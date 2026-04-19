# Verifier Agent Specification

**Agent:** Verifier
**Type:** `verifier`
**Tier:** Tier 1 (Local Ollama)
**Model:** `phi3:3.8b-mini-128k-instruct-q4_K_M` (Ollama primary) → `llama3.1:8b-instruct-q4_K_M` (Ollama fallback)
**Temperature:** 0.0
**Poll Interval:** 500ms

---

## 1. Identity & Role

Verifier is the **structural gate** of the Solaris swarm. It runs 6 deterministic pre-flight checks on every mission before it enters the authorized queue. It is not a reasoning agent — it is a pure structural filter using pattern matching and one HTTP probe. It rejects with structured reasons, allowing Mission Planner to fix and resubmit.

**Verifier DOES:**
- Run 6 pre-flight checks on every mission (structural gate)
- Probe target endpoints for liveness
- Validate MissionNode schema compliance
- Check for duplicate missions in flight
- Enforce scope compliance
- Write verified/rejected status on MissionNode

**Verifier DOES NOT:**
- Reason about strategic value (Commander's job)
- Generate missions (Mission Planner's job)
- Authorize missions (Commander's job)
- Execute exploits (Gamma's job)
- Make assumptions — if uncertain, reject with reason

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Verifier: DORMANT on init → STANDBY permanently (never goes DORMANT again)
         STANDBY ←→ ACTIVE on mission_queued event
         Any → ERROR on unexpected failure → reset after 30s backoff
```

Verifier is permanently warm (like Commander) because it is a nano model with minimal resource cost.

### Init Sequence

```
1. Load system prompt: agent-system-prompts/verifier.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: mission_queued)
4. Set state: STANDBY
5. Begin poll loop at 500ms interval (fast reaction required)
```

### Pre-Flight Check Execution

```
On mission_queued event:
1. Read MissionNode from graph
2. Run 6 checks in order (stop at first failure)
3. Write check results to MissionNode (verified=true OR rejection reason)
4. If all pass: emit mission_verified
5. If any fails:
   → If fixable: emit mission_rejected with fixable=true and reason
   → If not fixable: emit mission_rejected with fixable=false (escalate to Commander)
```

### Check Execution Order

```
Check 1: endpoint_alive (HTTP probe)
  → Skip if mission.skip_liveness_probe === true
  → curl -s -o /dev/null -w "%{http_code}" TARGET_ENDPOINT
  → Pass: HTTP status < 500
  → Fail: HTTP 5xx or timeout

Check 2: schema_valid (MissionNode structure)
  → Validate all required fields present
  → Validate field types match schema
  → Pass: Zod validation passes
  → Fail: missing or invalid field

Check 3: payload_coherent (exploit_type matches payload)
  → Check: exploit_type field matches expected payload structure
  → Pass: exploit_type is recognized
  → Fail: unknown exploit_type

Check 4: context_satisfied (context_nodes exist)
  → For each node_id in context_nodes and credential_nodes:
    → graph.findNodeById(node_id)
    → If node exists AND status !== "expired": pass
    → If node missing or expired: fail
  → Pass: All nodes exist and valid
  → Fail: N nodes missing or expired

Check 5: not_duplicate (no same mission in flight)
  → graph.findNodesByLabel("mission", {exploit_type, target_endpoint})
  → Filter: status IN ["completed", "active", "queued"]
  → Pass: No duplicates found
  → Fail: Duplicate mission found

Check 6: scope_compliant (URL in scope, not out-of-scope)
  → Match target_endpoint URL against TargetConfig.scope patterns
  → Match against TargetConfig.out_of_scope patterns
  → Pass: matches scope AND does not match out_of_scope
  → Fail: out-of-scope or not in scope
```

### Shutdown Sequence

```
1. Flush any pending check results to graph
2. Close FalkorDB connection
3. Close EventBus connection
4. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `mission_queued` | `{mission_id, executor, exploit_type, target_endpoint, priority, context_nodes, credential_nodes, created_by}` | Mission Planner emits when mission generated |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `mission_verified` | `{mission_id, verified_by:"verifier", checks_passed: ["endpoint_alive", "schema_valid", "payload_coherent", "context_satisfied", "not_duplicate", "scope_compliant"]}` | All 6 checks pass |
| `mission_rejected` | `{mission_id, failed_check: string, reason: string, fixable: boolean}` | Any check fails |

### Collaboration Sequences

**Mission Verification Flow:**
```
Mission Planner emits mission_queued
  → Verifier polls and picks up event
  → Verifier reads MissionNode from graph
  → Verifier runs 6 pre-flight checks
  → If all pass:
      → Write verified=true on MissionNode
      → Emit mission_verified → Commander wakes
  → If check fails (fixable):
      → Write rejection reason on MissionNode
      → Emit mission_rejected (fixable=true)
      → Mission Planner can fix and resubmit (max 2 resubmits)
  → If check fails (not fixable):
      → Write rejection reason on MissionNode
      → Emit mission_rejected (fixable=false)
      → Commander notified (structural issue, not Mission Planner error)
```

**Resubmission Flow:**
```
Mission Planner receives mission_rejected (fixable=true)
  → Mission Planner fixes the issue (e.g., adds missing context node)
  → Mission Planner re-emits mission_queued (with same mission_id, attempt incremented)
  → Verifier runs checks again
  → If fails again (attempt 2): Mission Planner notified, max resubmits reached
```

---

## 4. Memory Schema

### Section Prefix

Verifier reads from **all sections** to validate context_nodes and credential_nodes, but writes only to **gamma/** (MissionNode updates).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `MissionNode` | `id, exploit_type, target_endpoint, context_nodes, credential_nodes, skip_liveness_probe, depends_on` |
| `TargetNode` | `id, scope, out_of_scope` |
| `EndpointNode` | `id, url, method, status` |
| `CredentialNode` | `id, cred_type, value, scope, validation_status` |
| `FindingNode` | `id, type, target_endpoint` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `MissionNode` (update) | `{verified: boolean, verification_reason?: string, verified_by?: string, verified_at?: number}` | After checks run |

### Lifecycle

- **MissionNode updates**: Verifier only updates `verified` and `verification_reason` fields
- No new nodes created by Verifier
- No nodes deleted by Verifier

---

## 5. Tool Usage

### Can Use

| Tool | Description | Expected Output | Timeout |
|------|-------------|-----------------|---------|
| `curl` | HTTP liveness probe | stdout: response body (ignored), exit_code: HTTP status | 10s |

### Cannot Use

| Tool | Reason |
|------|--------|
| All other tools | Verifier is purely structural — no exploitation, no enumeration |

### How Verifier Uses Tools

Verifier uses `curl` only for the `endpoint_alive` check:

```
1. LLM/nano-model decides: "I need to probe TARGET_ENDPOINT"
2. executeTool('curl', { url: TARGET_ENDPOINT, timeout: 10000 })
3. Result: { exit_code: 0, stdout: "...", stderr: "", timed_out: false }
4. Parse exit_code as HTTP status:
   - exit_code 0: HTTP 200-499 (treat as success)
   - exit_code 7: connection refused (fail)
   - exit_code 28: timeout (fail)
   - exit_code > 0: HTTP 500+ (fail)
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/verifier.md
2. Load TargetConfig: scope patterns, out_of_scope patterns
3. Load MissionNode context (from event payload + graph read)
4. Compose final prompt with mission details
```

### Context Budget

- **Estimated tokens per check cycle:** ~200–400 (nano model, minimal context)
- **Batch processing:** Up to 10 missions per poll cycle
- **Overflow behavior:** Not expected — nano model has large context window

### Session State

What persists:
- `state`: current agent state
- `stateChangedAt`: timestamp of last transition

What is re-read from graph each cycle:
- All pending MissionNodes (from event payload + graph query)
- TargetNode for scope patterns
- Context nodes referenced by missions

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Commander:      mission_verified (triggers strategic authorization)
→ Mission Planner: mission_rejected (triggers fix + resubmit)
```

### Information Requests

Verifier requests information by reading graph nodes — no event-based requests to other agents.

### Scope

Verifier does not spawn work for other agents. It only validates and emits pass/fail events.

---

## 8. Observability & Debugging

### Key Log Lines

```
[verifier] State: DORMANT → STANDBY (initial)
[verifier] State: STANDBY → ACTIVE (processing N missions)
[verifier] Checking: MISSION_ID
[verifier] Check 1 (endpoint_alive): PASS (HTTP 200) | FAIL (HTTP 500)
[verifier] Check 2 (schema_valid): PASS | FAIL (missing field: FIELD)
[verifier] Check 3 (payload_coherent): PASS | FAIL (unknown exploit_type: TYPE)
[verifier] Check 4 (context_satisfied): PASS | FAIL (N nodes missing: [ids])
[verifier] Check 5 (not_duplicate): PASS | FAIL (duplicate: MISSION_ID)
[verifier] Check 6 (scope_compliant): PASS | FAIL (URL matches out_of_scope pattern)
[verifier] Mission verified: MISSION_ID (all 6 checks passed)
[verifier] Mission rejected: MISSION_ID (failed: CHECK_NAME, reason: REASON, fixable: true|false)
[verifier] State: ACTIVE → STANDBY
[verifier] Error: ERROR_MESSAGE — State: STANDBY → ERROR
```

### Trace Commands

```bash
# Live logs
pm2 logs verifier

# Pending missions
redis-cli GRAPH.QUERY solaris "MATCH (m:mission {status:'queued'}) RETURN m.id, m.exploit_type, m.verified ORDER BY m.created_at ASC"

# Verified missions
redis-cli GRAPH.QUERY solaris "MATCH (m:mission) WHERE m.verified=true RETURN m.id, m.verified_at ORDER BY m.verified_at DESC"

# Rejection history
SELECT * FROM events WHERE type='mission_rejected' ORDER BY created_at DESC LIMIT 20;
```

### Diagnostic Queries

```sql
-- Mission verification queue
SELECT e.id, e.payload, e.created_at FROM events e
WHERE e.type='mission_queued' AND e.consumed=false
ORDER BY e.created_at ASC LIMIT 10;

-- Recent verifications
SELECT * FROM events WHERE type IN ('mission_verified', 'mission_rejected')
ORDER BY created_at DESC LIMIT 20;

-- Check pass/fail rates
SELECT
  (SELECT COUNT(*) FROM events WHERE type='mission_verified') as verified,
  (SELECT COUNT(*) FROM events WHERE type='mission_rejected') as rejected;
```

---

## 9. Error Handling

### Rate Limit Errors

Verifier uses local Ollama with nano model. Rate limits are not expected. If OpenRouter fallback is used:
```
On 429:
  → Backoff 2s, retry
  → Max 3 retries
  → If still rate limited: log warning, skip that mission
```

### Tool Execution Errors

```
curl timeout (exit_code=28):
  → endpoint_alive check: FAIL (timeout)
  → Proceed to next check

curl connection refused (exit_code=7):
  → endpoint_alive check: FAIL (connection refused)
  → Proceed to next check

curl other error:
  → endpoint_alive check: FAIL (reason: curl error)
  → Proceed to next check
```

### LLM Generation Errors

Verifier uses a nano model (phi3) which rarely fails:
```
Malformed output:
  → Retry with same prompt (max 2 retries)
  → If still malformed: emit mission_rejected with reason="verifier_error"

API error:
  → Retry once
  → If still error: emit mission_rejected with reason="verifier_unavailable"
```

### Graph Write Errors

```
Write failure (verified=true):
  → Retry with exponential backoff
  → If still failing: log critical, do not emit mission_verified
  → Event will be reprocessed on next poll
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 500ms (fast — must react quickly to mission_queued) |
| Missions processed per cycle | Up to 10 (batch) |
| Check SLA per mission | < 5s |
| Liveness probe timeout | 10s |

### Mission Verification SLA

| Check | Target | Max |
|-------|--------|-----|
| endpoint_alive probe | < 10s | 15s |
| schema_valid | < 100ms | 1s |
| payload_coherent | < 100ms | 1s |
| context_satisfied | < 2s | 5s |
| not_duplicate | < 2s | 5s |
| scope_compliant | < 1s | 2s |
| **Total per mission** | **< 15s** | **30s** |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~200MB |
| Ollama model (phi3:3.8b-mini) | ~4GB VRAM |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~200MB RSS + 4GB VRAM** |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Liveness probe (curl) | 10s |
| Graph node read (single) | 2s |
| Graph node read (batch 10) | 5s |
| Graph node update | 2s |
| LLM call (check) | 5s |

---

*Verifier spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Commander §3](./commander.md#3-event-contract) — Mission authorization flow (Verifier → Commander after structural checks)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
