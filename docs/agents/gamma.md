# Gamma Agent Specification

**Agent:** Gamma Exploit
**Type:** `gamma`
**Pool:** `gamma-1`, `gamma-2`, `gamma-3` (pool size 1–3, PM2 managed)
**Tier:** Tier 2 (Local Ollama + Cloud fallback)
**Model:** `llama3-groq-tool-use:8b-q4_K_M` (Ollama primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.85
**Poll Interval:** 2000ms

---

## 1. Identity & Role

Gamma is the **exploit execution engine** of the Solaris swarm. It consumes authorized missions, executes single-request or scripted HTTP exploits, extracts credentials and artifacts, and reports results. Multiple Gamma instances run as stateless workers in parallel.

**Gamma DOES:**
- Execute authorized missions from the mission queue
- Select and try payloads based on escalation level
- Extract credentials, tokens, cookies, artifacts from successful exploits
- Write raw findings to bridge/ section
- Emit exploit_completed or exploit_failed events
- Trigger handoff when context budget exceeded

**Gamma DOES NOT:**
- Validate findings (Commander's job)
- Generate missions (Mission Planner's job)
- Authorize missions (Commander's job)
- Execute browser-based or multi-step flows (MCP Agent's job)
- Access tools outside its role-scoped permission set

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Gamma: DORMANT on init → STANDBY on first mission_authorized event
       STANDBY → ACTIVE on mission claim
       ACTIVE → COOLDOWN on mission complete
       COOLDOWN → STANDBY if more missions queued
       COOLDOWN → DORMANT if queue empty
       Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/gamma.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: mission_authorized, brief_ready, abort_requested)
4. Set state: DORMANT
5. Begin poll loop at 2000ms interval
6. Poll for missions: claimMission('gamma', agentId) if STANDBY
```

### Mission Execution Loop (ReAct Pattern)

```
THOUGHT: Analyze current situation
  - What is the exploit type?
  - What is the target endpoint?
  - What payload should I try given escalation level?
  - What will success look like?
  - What will failure look like?

ACTION: executeTool(tool_name, args)
  - LLM generates full command string
  - Shim executes via Bun.spawn
  - Returns { stdout, stderr, exit_code, timed_out }

OBSERVATION: Parse response
  - Did exploit succeed?
  - HTTP status code?
  - Response body content?
  - Credentials or artifacts extracted?

[Repeat until: exploit succeeds, all reasonable payloads exhausted, or 3 attempts fail]
```

### Escalation Level Behavior

```
baseline:
  - Standard payload set for exploit type
  - Simple/plausible payloads first
  - No evasion attempted

aggressive:
  - Elevated payload set: encoded, case-varied, comment-injected
  - Known WAF bypass variants first
  - Fall back to baseline payloads if aggressive fail

evasive:
  - Evasion-optimized payloads only
  - Case normalization bypass, whitespace substitution
  - Comment injection, encoding variation
  - NO standard payloads attempted
```

### Shutdown Sequence

```
1. If mission active: write gamma_handoff node with current state
2. Flush any pending graph writes
3. Close FalkorDB connection
4. Close EventBus connection
5. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `mission_authorized` | `{mission_id, executor:"gamma", target_endpoint, exploit_type, escalation_level, priority, context_nodes, credential_nodes}` | Commander emits when mission authorized |
| `brief_ready` | `{mission_id, brief_node_id}` | OSINT emits when ExploitBrief written |
| `abort_requested` | `{mission_id, reason}` | Commander emits on swarm_complete |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `exploit_completed` | `{mission_id, success:true, exploit_type, payload_used, evidence: {request_snippet, response_code, response_snippet}, artifacts_extracted: [{type, value, bridge_node_id}]}` | Exploit succeeds |
| `exploit_failed` | `{mission_id, failure_class: "waf_blocked"\|"timeout"\|"auth_required"\|"wrong_endpoint"\|"payload_rejected"\|"unknown", attempt: 1-3, error, failed_payloads: [payload_strings]}` | Exploit fails after all attempts |
| `credential_found` | `{credential_id, target_id, cred_type: "bearer"\|"cookie"\|"api_key"\|"password", value, bridge_node_id}` | Credentials extracted from response |
| `rce_confirmed` | `{mission_id, target_id, session_id, artifact_path}` | RCE confirmed — stop immediately |
| `handoff_requested` | `{handoff_id, mission_id, from_instance, hypothesis, confirmed_facts, failed_payloads, next_action, context_budget}` | Context budget > 3000 tokens |

### Collaboration Sequences

**Mission Execution Flow:**
```
Commander emits mission_authorized
  → Gamma polls and claims mission via claimMission()
  → Gamma reads mission node + context nodes from graph
  → Gamma checks for ExploitBrief (brief_ready event)
  → Gamma executes exploit with ReAct loop
  → On success:
      → Write artifacts to bridge/ section
      → Emit credential_found for each artifact
      → Emit exploit_completed
  → On failure (after 3 attempts):
      → Emit exploit_failed → Critic wakes
      → Mission marked archived
```

**Brief Check Flow:**
```
OSINT emits brief_ready
  → Gamma may have already claimed mission
  → Gamma reads brief node from graph
  → Uses brief context (working examples, bypass techniques)
  → If brief not ready when Gamma claims, Gamma proceeds without it
```

**RCE Emergency Stop:**
```
On any response confirming RCE (shell spawn, ping back, etc.):
  → Immediately stop exploitation loop
  → Do NOT try more payloads
  → Emit rce_confirmed → Post-Exploit wakes
  → Emit exploit_completed with RCE evidence
  → Do NOT emit credential_found (Post-Exploit handles further extraction)
```

---

## 4. Memory Schema

### Section Prefix

Gamma writes to **gamma/** (mission results) and **bridge/** (raw artifacts).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `MissionNode` | `id, exploit_type, target_endpoint, context_nodes, credential_nodes, escalation_level, attempt_count, depends_on` |
| `ExploitBriefNode` | `technique_summary, working_examples, known_waf_bypasses, common_failures, lesson_refs` |
| `LessonNode` | `exploit_type, failure_class, successful_payload, delta, reusable` |
| `CredentialNode` | `id, cred_type, value, scope` |
| `EndpointNode` | `id, method, path, url, parameters` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `ExploitNode` | `{id, type:"exploit", mission_id, exploit_type, payload, target_endpoint, http_status, response_body, success, evidence, executed_by, executed_at}` | Every exploit attempt |
| `ArtifactNode` (bridge) | `{id, type:"artifact", subtype, name, content_type, discovered_at, discovered_by, mission_id}` | Artifact extracted |
| `GammaHandoffNode` | `{id, type:"gamma_handoff", mission_id, from_instance, hypothesis, confirmed_facts, failed_payloads, next_action, context_budget, written_at}` | Context budget exceeded |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:EXECUTED` | ExploitNode → MissionNode | Every attempt |
| `:FOUND_AT` | ArtifactNode → EndpointNode | Artifact extracted |
| `:EXTRACTED_FROM` | CredentialNode → ExploitNode | Credential found |

### Lifecycle

- **ExploitNode**: Created on every attempt (never updated, immutable audit trail)
- **ArtifactNode**: Created on successful extraction, in bridge/ section
- **GammaHandoffNode**: Created when context budget exceeded, consumed by next Gamma instance

---

## 5. Tool Usage

### Can Use

| Tool | Description | Expected Output | Timeout |
|------|-------------|-----------------|---------|
| `curl` | HTTP requests with any method, headers, body | stdout: response body, stderr: curl errors | 10s |
| `wget` | File download from target | stdout: download output | 30s |
| `gobuster` | Directory/file enumeration | stdout: found paths | 60s |
| `ffuf` | Web fuzzer for routes, parameters | stdout: fuzz results | 60s |
| `nikto` | Web server misconfiguration scan | stdout: nikto output | 120s |
| `nuclei` | Template-based vulnerability scan | stdout: nuclei results | 120s |
| `sqlmap` | SQL injection detection/exploitation | stdout: sqlmap output | 120s |
| `john` | Hash cracking | stdout: cracked hashes | 300s |
| `hashcat` | GPU hash cracking | stdout: cracked hashes | 300s |
| `hydra` | Online credential brute force | stdout: hydra results | 300s |
| `searchsploit` | Exploit-DB search | stdout: exploit results | 30s |
| `msfconsole` | Metasploit framework | stdout: module output | 120s |
| `nmap` | Port/service scan | stdout: nmap results | 60s |
| `masscan` | Fast TCP scan | stdout: masscan results | 60s |
| `netcat` | Banner grab, port probe | stdout: banner | 10s |
| `linpeas` | Linux privilege escalation | stdout: enum results | 120s |
| `winpeas` | Windows privilege escalation | stdout: enum results | 120s |
| `enum4linux` | SMB/SAMBA enumeration | stdout: enum results | 60s |
| `smbclient` | SMB share access | stdout: share listing | 30s |
| `ldapsearch` | LDAP query | stdout: query results | 30s |

### Cannot Use

| Tool | Reason |
|------|--------|
| `browser_navigate` | Browser tools are MCP-only |
| `browser_execute_js` | Browser tools are MCP-only |
| `browser_intercept` | Browser tools are MCP-only |
| `upload_file` | Multi-step flow — MCP-only |
| `codebase_memory/*` | SAST tools are Alpha-only |

### How LLM Uses Tools

```
LLM generates: "curl -s -X POST 'http://target:3000/api/login' -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin\"}'"
Shim: executeTool('curl', { method: 'POST', url: '...', headers: {...}, body: '...' })
Result: { exit_code: 0, stdout: '{"token":"..."}', stderr: '', timed_out: false, duration_ms: 234 }
LLM interprets stdout to determine success/failure
```

### Rate Limits

- Max 10 tool calls per mission without Critic feedback
- If > 3 consecutive tool failures: emit exploit_failed, let Critic analyze
- Tool timeouts: hard kill after timeout, count as failure

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/gamma.md
2. Load overlay: prompt-overlays/{exploit_type}.md (if exists)
3. Load TargetConfig: scope, out_of_scope, auth_hints
4. Load mission context:
   - Mission ID, target URL, method, endpoint, parameters
   - Exploit type, escalation level, priority
   - Credential nodes to use (if any)
   - Context nodes (prior findings, related endpoints)
5. Load attempt history (from graph: all ExploitNodes for this mission)
6. Load Lesson Archive matches (lesson_refs from ExploitBrief)
7. Load ExploitBrief if available (brief_ready already received)
8. Compose final prompt
```

### Context Budget

- **Estimated tokens per ReAct iteration:** ~600–1000
- **Context budget per mission:** ~3000 tokens (monitored via `context_budget`)
- **Overflow behavior:**
  ```
  If context_budget > 3000:
    → Write gamma_handoff node with current state
    → Emit handoff_requested → Commander notified
    → Mission re-queued for next available Gamma
    → Current Gamma stops processing this mission
  ```

### Session State

What persists across ReAct iterations:
- `current_mission_id`: active mission being executed
- `attempt_count`: number of payloads tried
- `failed_payloads`: array of `{payload, response_snippet, waf_triggered}`
- `context_budget`: estimated tokens consumed

What is re-read from graph each iteration:
- ExploitBrief if updated by OSINT
- Lesson nodes for retry guidance
- Any new credentials that became available

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Critic:        exploit_failed (after 3 attempts, or if failure pattern unclear)
→ Commander:     handoff_requested (context budget exceeded)
→ Post-Exploit:  (implicit — rce_confirmed event triggers Post-Exploit wake)
→ Chain Planner:  (implicit — credential_found event triggers Chain Planner wake)
```

### Information Requests

```
→ OSINT (indirect): Read ExploitBriefNode from graph (OSINT writes it)
→ Commander (indirect): Emit handoff_requested, Commander spawns new Gamma
```

### Handoff Protocol (Context Relay)

When Gamma's context budget exceeds threshold:

```
1. Gamma writes GammaHandoffNode to graph:
   {
     id: "handoff:mission:MISSION_ID:attempt-ATTEMPT:gamma-INSTANCE",
     mission_id: MISSION_ID,
     from_instance: "gamma-1",
     hypothesis: "Login form is vulnerable to SQLi via username param",
     confirmed_facts: ["POST /api/login", "username param reflected in error message"],
     failed_payloads: [
       { payload: "admin' OR 1=1--", response_snippet: "...", waf_triggered: false },
       { payload: "admin' UNION SELECT NULL--", response_snippet: "403 Forbidden", waf_triggered: true }
     ],
     next_action: "try time-based: admin' OR SLEEP(5)--",
     context_budget: 3200
   }

2. Gamma re-queues mission via EventBus
3. Next available Gamma reads GammaHandoffNode
4. Next Gamma continues from next_action
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[gamma-1] State: DORMANT → STANDBY
[gamma-1] State: STANDBY → ACTIVE (claiming mission: MISSION_ID)
[gamma-1] Executing: METHOD ENDPOINT (exploit_type: TYPE, escalation: LEVEL)
[gamma-1] THOUGHT: ... (what LLM reasoned)
[gamma-1] ACTION: tool_name → exit_code=0 duration_ms=234
[gamma-1] OBSERVATION: HTTP 200, response contains token
[gamma-1] Artifact extracted: TYPE=credential VALUE=****
[gamma-1] Mission complete: MISSION_ID (success=true, attempts=1)
[gamma-1] State: ACTIVE → COOLDOWN
[gamma-1] State: COOLDOWN → STANDBY (N missions queued)
[gamma-1] Context budget exceeded: 3200 tokens, emitting handoff_requested
[gamma-1] Error: Connection timeout after 10s — State: ACTIVE → ERROR
```

### Trace Commands

```bash
# Live logs
pm2 logs gamma-1

# Mission history from graph
redis-cli GRAPH.QUERY solaris "MATCH (e:exploit {mission_id:'mission:sqli-login-003'}) RETURN e.payload, e.success, e.executed_at"

# Pending missions
redis-cli GRAPH.QUERY solaris "MATCH (m:mission {status:'queued', executor:'gamma'}) RETURN m.id ORDER BY m.priority DESC"

# Handoff nodes
redis-cli GRAPH.QUERY solaris "MATCH (h:gamma_handoff) WHERE h.consumed_at IS NULL RETURN h.id, h.mission_id, h.next_action"
```

### Diagnostic Queries

```sql
-- Active exploits by gamma instance
SELECT * FROM events WHERE type='exploit_completed' AND consumed=false;

-- Failed missions with failure classification
SELECT * FROM events WHERE type='exploit_failed' ORDER BY created_at DESC LIMIT 20;

-- Handoff requests pending
SELECT * FROM events WHERE type='handoff_requested' AND consumed=false;
```

---

## 9. Error Handling

### Rate Limit Errors

Not expected on local Ollama. If Groq fallback is used:
- Exponential backoff: 2s base, max 60s
- Max 5 retries before emitting exploit_failed

### Tool Execution Errors

```
Non-zero exit code:
  → Parse stderr for error message
  → If timeout (timed_out=true): count as waf_blocked or timeout failure_class
  → If connection refused: count as wrong_endpoint
  → If auth error: count as auth_required
  → Continue to next payload or fail mission

Tool not found:
  → Log critical error
  → Emit exploit_failed with failure_class="unknown"
  → Do not retry
```

### LLM Generation Errors

```
Malformed output (no <r>/<t>/<c> tags):
  → Retry with same prompt (max 2 retries)
  → If still malformed: emit exploit_failed with failure_class="unknown"

API error:
  → Fallback to Groq if using Ollama
  → If Groq fails: emit exploit_failed, let Commander re-queue

Timeout (>60s for generation):
  → Retry once
  → If still timeout: emit exploit_failed
```

### Graph Write Errors

```
Write failure after successful exploit:
  → Buffer result in memory
  → Retry write with exponential backoff
  → If still failing after 3 retries: emit exploit_failed, log critical
  → Exploit result is NOT emitted unless graph write succeeds
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 2000ms |
| Mission claim SLA | < 5s from event emit |
| Tool execution start | < 1s from decision |

### Mission Completion SLA

| Mission Type | Target | Max |
|---------------|--------|------|
| Single-request exploit | < 2 min | 5 min |
| Scripted multi-step exploit | < 10 min | 15 min |
| Fuzzing mission (gobuster/ffuf) | < 15 min | 30 min |
| Credential attack (hydra) | < 20 min | 30 min |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~1.5GB |
| Ollama model (qwen2.5-coder:14b) | ~8GB VRAM |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~1.5GB RSS + 8GB VRAM** |

### Tool Timeouts

| Tool | Default Timeout | Notes |
|------|----------------|-------|
| `curl` | 10s | Increase for time-based exploits |
| `wget` | 30s | |
| `gobuster` | 60s | |
| `ffuf` | 60s | |
| `nikto` | 120s | |
| `nuclei` | 120s | |
| `sqlmap` | 120s | |
| `john` | 300s | |
| `hashcat` | 300s | |
| `hydra` | 300s | |
| `nmap` | 60s | |
| `masscan` | 60s | |
| `netcat` | 10s | |
| `linpeas/winpeas` | 120s | |
| `enum4linux` | 60s | |
| `smbclient` | 30s | |
| `ldapsearch` | 30s | |

---

*Gamma spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Critic §3](./critic.md#3-event-contract) — Failure loop (Gamma emits exploit_failed → Critic analyzes)
- [Alpha §5](./alpha.md#5-tool-usage) — Tool exclusions (Gamma vs Alpha tool sets differ)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
