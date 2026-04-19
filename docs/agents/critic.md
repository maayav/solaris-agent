# Critic Agent Specification

**Agent:** Critic
**Type:** `critic`
**Tier:** Tier 1 (Local Ollama)
**Model:** `phi3:3.8b-mini-128k-instruct-q4_K_M` (Ollama primary) → `llama3.1:8b-instruct-q4_K_M` (Ollama fallback)
**Temperature:** 0.15
**Poll Interval:** 1000ms

---

## 1. Identity & Role

Critic is the **failure analysis and corrective feedback engine** of the Solaris swarm. It analyzes failed exploit attempts, classifies the failure, generates structured feedback for retry, requests OSINT enrichment on repeated failures, and writes FailedMissionNode to the Lesson Archive after 3 attempts.

**Critic DOES:**
- Classify failure patterns (waf_blocked, wrong_endpoint, auth_required, etc.)
- Generate corrective feedback for the executor (Gamma/MCP)
- Request OSINT enrichment on second failure
- Write FailedMissionNode after 3 failures
- Trigger WAF Duel (adversarial_self_play flag) after 3 waf_blocked failures
- Write LessonNode if retry succeeds (success after failure)

**Critic DOES NOT:**
- Execute exploits (Gamma's job)
- Authorize missions (Commander's job)
- Make strategic decisions about target priority
- Bypass gates or modify mission parameters

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Critic: DORMANT on init → STANDBY on exploit_failed event
       STANDBY → ACTIVE on task claim
       ACTIVE → COOLDOWN on analysis complete
       COOLDOWN → STANDBY if more failures pending
       COOLDOWN → DORMANT if queue empty
       Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/critic.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: exploit_failed, exploit_completed)
4. Set state: DORMANT
5. Begin poll loop at 1000ms interval
```

### Failure Analysis Loop

```
On exploit_failed event:
1. Read failure context from event payload:
   - mission_id, failure_class, attempt, error
   - failed_payloads array
2. Read MissionNode from graph (to get exploit_type, target_endpoint)
3. Read ExploitNode history for this mission (all previous attempts)
4. Run failure classification:
   - Confirm or update failure_class
   - If causal_attribution flag enabled: run causal attribution pass
5. Determine next action based on attempt number:

Attempt 1:
   → Generate corrective feedback (what to change)
   → Emit retry_recommended event with feedback
   → Do NOT write FailedMissionNode yet

Attempt 2:
   → Generate corrective feedback
   → Request OSINT enrichment (emit enrichment_requested targeting failure_class)
   → Emit retry_recommended with OSINT context
   → Do NOT write FailedMissionNode yet

Attempt 3 (final):
   → Write FailedMissionNode to lessons/ section
   → Update MissionNode status to "archived"
   → Emit exploit_failed with final failure context
   → If failure_class="waf_blocked" AND adversarial_self_play flag:
       → Emit waf_duel_started (trigger WAF Duel loop)
```

### Causal Attribution Pass (when flag enabled)

```
After classifying failure_class, run causal attribution:

1. Analyze response for specific signals:
   - "SQL keyword detected" → keyword_match
   - "encoding" in response → encoding_mismatch
   - "Origin" in response → header_anomaly (CORS)
   - Prior attempts > 10 in 60s → rate_trigger
   - payload.length > 2000 → size_trigger
   - No cookie in request → session_mismatch
   - Generic "blocked"/"forbidden" → waf_signature

2. Generate bypass_hypothesis:
   - keyword_match → "Try whitespace substitution: admin'/**/OR/**/1=1--"
   - encoding_mismatch → "Try URL encoding: %27%20OR%201%3D1--"
   - header_anomaly → "Try without Origin header or with spoofed Origin"
   - rate_trigger → "Wait 30s and retry with fewer attempts"

3. Write bypass_hypothesis to feedback payload for next attempt
```

### Success After Failure (Lesson Learned)

```
On exploit_completed event (for mission that previously failed):
1. Read MissionNode and ExploitNode history
2. If any previous exploit_failed events exist for this mission:
   → Write LessonNode to lessons/ section
   → Fields: exploit_type, failure_class, failed_payloads, successful_payload, delta
   → Tags: ["waf-bypass", "encoding", etc.]
   → reusable: true (if generalization possible)
```

### Shutdown Sequence

```
1. Flush any pending analysis to graph
2. Close FalkorDB connection
3. Close EventBus connection
4. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `exploit_failed` | `{mission_id, failure_class: "waf_blocked"\|"timeout"\|"auth_required"\|"wrong_endpoint"\|"payload_rejected"\|"target_patched"\|"wrong_method"\|"encoding_needed"\|"session_required"\|"unknown", attempt: 1-3, error, failed_payloads: [{payload, response_snippet, waf_triggered}]}` | Gamma/MCP emit on failure |
| `exploit_completed` | `{mission_id, success:true, exploit_type, payload_used, evidence}` | Gamma/MCP emit on success (to check if previous failure exists) |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `retry_recommended` | `{mission_id, corrective_feedback: string, bypass_hypothesis?: string, attribution?: AttributionDimension}` | After analysis, before retry |
| `abandon_recommended` | `{mission_id, reason: string, failure_class, final_outcome: "confirmed_unexploitable"\|"needs_manual_review"\|"likely_patched"}` | After 3 failures |
| `waf_duel_started` | `{duel_id, mission_id, waf_type: string, failure_context}` | After 3 waf_blocked failures (when adversarial_self_play enabled) |
| `enrichment_requested` | `{target_id, enrichment_type: "technique", reason: "critic_failure_analysis", failure_class, exploit_type}` | After 2nd failure, requesting OSINT research |
| `lesson_written` | `{lesson_id, mission_id, exploit_type, failure_class}` | Success after previous failure |

### Collaboration Sequences

**Failure Loop Flow:**
```
Gamma emits exploit_failed (attempt 1)
  → Critic analyzes failure
  → Critic generates corrective feedback
  → Critic emits retry_recommended → Gamma wakes with feedback
  → Gamma retries with updated payload

Gamma emits exploit_failed (attempt 2)
  → Critic analyzes second failure
  → Critic requests OSINT enrichment (emit enrichment_requested)
  → Critic emits retry_recommended with OSINT context
  → Gamma retries with enriched context

Gamma emits exploit_failed (attempt 3)
  → Critic writes FailedMissionNode to lessons/
  → Critic marks mission "archived"
  → Critic emits abandon_recommended
  → If waf_blocked + adversarial_self_play:
      → Critic emits waf_duel_started → triggers WAF Duel loop
```

**Lesson Learned Flow:**
```
Gamma emits exploit_completed (for mission that had previous failures)
  → Critic detects prior exploit_failed events for this mission
  → Critic reads successful payload and previous failed payloads
  → Critic calculates delta (what changed between failure and success)
  → Critic writes LessonNode to lessons/ section
  → Critic emits lesson_written
```

---

## 4. Memory Schema

### Section Prefix

Critic writes to **lessons/** section (FailedMissionNode, LessonNode).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `MissionNode` | `id, exploit_type, target_endpoint, attempt_count, status` |
| `ExploitNode` | `id, mission_id, payload, success, response_body, http_status` |
| `ComponentNode` | `id, name, fingerprint` |
| `EndpointNode` | `id, method, path, url` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `FailedMissionNode` | `{id, type:"failed_mission", mission_id, exploit_type, failure_class, evidence: {failed_payloads, response_snippets, waf_signatures}, final_outcome: "confirmed_unexploitable"\|"needs_manual_review"\|"likely_patched", created_at}` | After 3 failures |
| `LessonNode` | `{id, type:"lesson", mission_id, exploit_type, failure_class, failed_payloads: string[], successful_payload: string, delta: string, reusable: boolean, tags: string[], created_at}` | Success after prior failure |
| `CausalAttributionNode` | `{id, type:"causal_attribution", mission_id, failure_class, attributed_to: AttributionDimension, evidence: string, bypass_hypothesis: string, confidence: "high"\|"medium"\|"low", created_at}` | Causal attribution pass (when flag enabled) |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:FAILED_WITH` | FailedMissionNode → MissionNode | 3 failures |
| `:RESOLVED_BY` | FailedMissionNode → LessonNode | Success after failure |
| `:CAUSED_BY` | LessonNode → CausalAttributionNode | Attribution written |

### Lifecycle

- **FailedMissionNode**: Created once after 3 failures, never deleted (archive)
- **LessonNode**: Created on success after failure, never deleted (accumulating knowledge)
- **CausalAttributionNode**: Created if causal_attribution flag enabled, linked to FailedMissionNode

---

## 5. Tool Usage

### Can Use

Critic does **not execute tools directly**. It uses LLM reasoning + graph operations.

### Cannot Use

| Tool | Reason |
|------|--------|
| All tools | Critic is a reasoning agent — it analyzes failures and generates feedback, not executes exploits |

### How Critic Processes

Critic's LLM analyzes failure context and generates structured feedback:

```
THOUGHT: Analyze the failure
  - What was the failure_class?
  - What payload was used?
  - What was the response?
  - What patterns are visible in the failure?

ANALYSIS:
  - failure_class confirmed or updated
  - causal attribution (if flag enabled)
  - bypass_hypothesis generated
  - corrective_feedback written

ACTION: graph.writeNode() or graph.updateNode()
  - Write FailedMissionNode (if attempt 3)
  - Write LessonNode (if success after failure)
  - Update MissionNode status

EMIT: event with structured feedback
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/critic.md
2. Load failure context:
   - MissionNode (exploit_type, target_endpoint, attempt_count)
   - ExploitNode history (all previous attempts, payloads, responses)
   - failed_payloads from event
3. If causal_attribution flag:
   → Load response snippets for attribution
4. Compose final prompt with failure context
```

### Context Budget

- **Estimated tokens per analysis:** ~600–1000
- **Context budget per task:** ~2000 tokens
- **Overflow behavior:** Not expected — failure context is bounded

### Session State

What persists:
- `pending_failures`: Queue of exploit_failed events to process
- `analyzed_missions`: Set of mission_ids already analyzed (prevent duplicate work)

What is re-read from graph:
- All ExploitNodes for the failing mission
- MissionNode for context

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Gamma:           retry_recommended (corrective feedback for next attempt)
→ Gamma:           abandon_recommended (mission archived, stop retrying)
→ Commander:       (implicit — retry/abandon events trigger state updates)
→ OSINT:           enrichment_requested (research failure pattern)
→ Specialist:      waf_duel_started (trigger WAF Duel)
```

### Information Requests

```
Critic requests OSINT enrichment by emitting enrichment_requested:
  → enrichment_type: "technique"
  → reason: "critic_failure_analysis"
  → failure_class: specific block type
  → exploit_type: the vulnerability class
  → OSINT researches bypass techniques for this specific failure
```

### WAF Duel Trigger

```
After 3 waf_blocked failures:
1. Critic reads all responses containing WAF block patterns
2. Critic emits waf_duel_started with:
   - duel_id
   - mission_id
   - waf_type (inferred from block patterns)
   - failure_context (response snippets)
3. OSINT (as Defender model) infers WAF rules
4. Mission Planner (as Attacker model) generates bypass candidates
5. Gamma executes bypass variants
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[critic] State: DORMANT → STANDBY
[critic] Failure received: MISSION_ID (attempt: N, class: FAILURE_CLASS)
[critic] Analyzing: MISSION_ID (exploit_type: TYPE, endpoint: ENDPOINT)
[critic] Failure classification confirmed: FAILURE_CLASS
[critic] Causal attribution: ATTRIBUTION_DIMENSION (confidence: high|medium|low)
[critic] Bypass hypothesis: HYPOTHESIS
[critic] Generating corrective feedback: ...
[critic] Retry recommended: MISSION_ID (feedback: ...)
[critic] OSINT enrichment requested: failure_class=FAILURE_CLASS
[critic] Writing FailedMissionNode: MISSION_ID → lessons/FAILED_MISSION_ID
[critic] Mission archived: MISSION_ID (final_outcome: OUTCOME)
[critic] WAF Duel triggered: MISSION_ID (waf_type: TYPE)
[critic] Lesson learned: MISSION_ID (delta: "...")
[critic] State: ACTIVE → COOLDOWN
[critic] State: COOLDOWN → DORMANT
```

### Trace Commands

```bash
# Live logs
pm2 logs critic

# Failed missions
redis-cli GRAPH.QUERY solaris "MATCH (f:failed_mission) RETURN f.id, f.failure_class, f.final_outcome ORDER BY f.created_at DESC"

# Lesson archive
redis-cli GRAPH.QUERY solaris "MATCH (l:lesson) RETURN l.id, l.exploit_type, l.failure_class, l.reusable ORDER BY l.created_at DESC"

# Causal attributions
redis-cli GRAPH.QUERY solaris "MATCH (c:causal_attribution) RETURN c.mission_id, c.attributed_to, c.bypass_hypothesis"

# WAF duels
redis-cli GRAPH.QUERY solaris "MATCH (w:waf_duel) RETURN w.id, w.status, w.waf_model"
```

### Diagnostic Queries

```sql
-- Failure analysis queue
SELECT * FROM events WHERE type='exploit_failed' AND consumed=false;

-- Failure class distribution
SELECT
  JSONExtractString(payload, 'failure_class') as failure_class,
  COUNT(*) as count
FROM events
WHERE type='exploit_failed'
GROUP BY failure_class;

-- Lessons learned
SELECT * FROM events WHERE type='lesson_written' ORDER BY created_at DESC;

-- WAF duel triggers
SELECT * FROM events WHERE type='waf_duel_started';
```

---

## 9. Error Handling

### Rate Limit Errors

Critic uses local Ollama. Rate limits not expected. If OpenRouter fallback:
```
On 429:
  → Backoff 2s, retry
  → Max 3 retries
  → If still rate limited: log warning, emit retry_recommended with basic feedback
```

### LLM Generation Errors

```
Malformed output (not valid feedback format):
  → Retry with same context (max 2 retries)
  → If still malformed: emit retry_recommended with generic feedback "try different payload"

API error:
  → Retry once
  → If still error: emit retry_recommended with generic feedback

Timeout:
  → Retry once
  → If still timeout: emit retry_recommended with generic feedback
```

### Graph Write Errors

```
FailedMissionNode write failure:
  → Buffer in memory
  → Retry with exponential backoff
  → If still failing: log critical, mission may be re-processed on restart

LessonNode write failure:
  → Buffer in memory
  → Retry with exponential backoff
  → If still failing: lesson may be lost (less critical than FailedMissionNode)
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 1000ms |
| Failures processed per cycle | Up to 5 |
| Analysis SLA per failure | < 10s |

### Analysis SLA

| Task | Target | Max |
|------|--------|-----|
| Failure classification | < 3s | 5s |
| Causal attribution | < 5s | 10s |
| Corrective feedback generation | < 5s | 10s |
| FailedMissionNode write | < 2s | 5s |
| LessonNode write | < 2s | 5s |

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
| LLM call (classification) | 10s |
| LLM call (causal attribution) | 15s |
| LLM call (feedback generation) | 10s |
| Graph write (FailedMissionNode) | 5s |
| Graph write (LessonNode) | 5s |

---

## Appendix: Failure Class Definitions

| Failure Class | Description | Typical Bypass |
|---------------|-------------|----------------|
| `waf_blocked` | WAF/Cloud proxy blocked the request | Bypass payload variants |
| `timeout` | Request timed out | Increase timeout, simpler payload |
| `auth_required` | Endpoint requires authentication | Use credential, find session |
| `wrong_endpoint` | Payload sent to wrong endpoint | Target correct endpoint |
| `payload_rejected` | Payload rejected by application | Modify payload encoding/structure |
| `target_patched` | Target has been fixed/patched | Document as patched, move on |
| `wrong_method` | Wrong HTTP method used | Try GET/POST/PUT/DELETE |
| `encoding_needed` | Payload needs different encoding | URL encode, Base64, Unicode |
| `session_required` | Session/State needed | Obtain session first |
| `unknown` | Unclassified failure | Generic retry, escalate to human |

---

*Critic spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Gamma §3](./gamma.md#3-event-contract) — Failure loop (Gamma emits exploit_failed → Critic analyzes)
- [OSINT §3](./osint.md#3-event-contract) — Enrichment request flow (Critic → OSINT for failure research)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
