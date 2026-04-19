# MCP Agent Specification

**Agent:** MCP Agent
**Type:** `mcp`
**Tier:** Tier 2 (Local Ollama + Cloud fallback)
**Model:** `llama3-groq-tool-use:8b-q4_K_M` (Ollama primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.65
**Poll Interval:** 2000ms

---

## 1. Identity & Role

MCP Agent is the **multi-step, stateful exploitation engine** of the Solaris swarm. It handles interactive, browser-driven, stateful exploits that Gamma cannot handle — DOM XSS, CSRF, 2FA bypass, multi-step auth flows, and WebSocket-based attacks.

**MCP Agent DOES:**
- Execute browser-based exploits using Puppeteer
- Handle multi-step flows requiring session state
- Perform CSRF token capture and forgery
- Execute 2FA bypass sequences
- Probe bridge/ artifacts for Commander (validation_probe_requested)
- Extract credentials from browser contexts

**MCP Agent DOES NOT:**
- Execute single-request HTTP exploits (Gamma's job)
- Scan targets (Alpha's job)
- Generate missions (Mission Planner's job)

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
MCP Agent: DORMANT on init → STANDBY on mission_authorized (executor:mcp) or validation_probe_requested
           STANDBY → ACTIVE on task claim
           ACTIVE → COOLDOWN on task complete
           COOLDOWN → STANDBY if more tasks pending
           COOLDOWN → DORMANT if queue empty
           Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/mcp-agent.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: mission_authorized, validation_probe_requested)
4. Set state: DORMANT
5. Begin poll loop at 2000ms interval
6. Puppeteer browser instance ready (lazy-loaded on first mission)
```

### Browser Execution Loop

```
On mission_authorized (executor: mcp):
1. Read MissionNode from graph
2. Load browser context (Puppeteer)
3. Execute multi-step flow:
   Step 1: Navigate to initial URL, capture CSRF token
   Step 2: Submit form with CSRF token + payload
   Step 3: Capture response, determine success/failure
   Step 4: Extract credentials/artifacts if successful
4. Write results to graph
5. Emit exploit_completed or exploit_failed

On validation_probe_requested:
1. Read bridge node (credential artifact)
2. Probe target with artifact (test JWT against protected endpoint)
3. Write probe result to bridge node
4. Emit validation_probe_complete
```

### Validation Probe Flow

```
Commander emits validation_probe_requested
  → MCP Agent reads bridge node
  → MCP Agent uses artifact (JWT/cookie) to probe target endpoint
  → MCP Agent writes probe result to bridge node:
      - http_status: HTTP response code
      - probe_result: "success" | "expired" | "error"
  → MCP Agent emits validation_probe_complete
  → Commander reads probe result, promotes or expires credential
```

### Shutdown Sequence

```
1. Close Puppeteer browser instance
2. Flush any pending results to graph
3. Close FalkorDB connection
4. Close EventBus connection
5. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `mission_authorized` | `{mission_id, executor:"mcp", target_endpoint, exploit_type, escalation_level, priority, context_nodes, credential_nodes}` | Commander emits when mission authorized for MCP |
| `validation_probe_requested` | `{probe_id, artifact_id, target_id, probe_type: "jwt"\|"cookie"\|"api_key"}` | Commander emits to probe bridge artifacts |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `exploit_completed` | `{mission_id, success, exploit_type, payload_used, evidence, artifacts_extracted}` | Multi-step exploit succeeds |
| `exploit_failed` | `{mission_id, failure_class, attempt, error}` | Multi-step exploit fails after all attempts |
| `credential_found` | `{credential_id, target_id, cred_type, value, bridge_node_id}` | Credentials extracted from browser context |
| `validation_probe_complete` | `{probe_id, artifact_id, result: "success"\|"expired"\|"error", http_status}` | Probe completed |

### Collaboration Sequences

**Multi-Step Exploit Flow:**
```
Commander emits mission_authorized (executor: mcp)
  → MCP Agent claims mission
  → MCP Agent executes browser-based exploit
  → On success:
      → MCP Agent emits credential_found (if credentials extracted)
      → MCP Agent emits exploit_completed
  → On failure:
      → MCP Agent emits exploit_failed → Critic wakes
```

**Credential Validation Flow:**
```
Gamma extracts JWT → writes bridge node → emits credential_found
Commander reads bridge node → emits validation_probe_requested
  → MCP Agent probes target with JWT
  → MCP Agent writes probe result to bridge node
  → MCP Agent emits validation_probe_complete
  → Commander reads result:
      → If 2xx: promote to recon/, emit credential_promoted
      → If 4xx/timeout: mark validation_status="expired"
      → If 5xx: retry once
```

---

## 4. Memory Schema

### Section Prefix

MCP Agent writes to **bridge/** (raw artifacts) and **gamma/** (mission results).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `MissionNode` | `id, exploit_type, target_endpoint, context_nodes, credential_nodes, escalation_level` |
| `CredentialNode` | `id, cred_type, value, scope` (for session context) |
| `ArtifactNode` | `id, type, name, content_type` (from bridge/) |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `ArtifactNode` (bridge) | `{id, type:"artifact", subtype, name, content_type, discovered_at, discovered_by:"mcp", mission_id}` | Artifact extracted |
| `ExploitNode` | `{id, type:"exploit", mission_id, exploit_type, payload, success, evidence, executed_by:"mcp", executed_at}` | Every attempt |
| Bridge node update | `{probe_result, http_status, probed_at}` | Validation probe result |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:EXTRACTED_FROM` | ArtifactNode → ExploitNode | Artifact extracted from exploit |
| `:EXECUTED` | ExploitNode → MissionNode | Every attempt |

---

## 5. Tool Usage

### Can Use (Browser Tools)

| Tool | Description | Expected Output | Timeout |
|------|-------------|----------------|---------|
| `browser_navigate` | Puppeteer navigation with alert capture, token injection | Page HTML, console logs | 30s |
| `browser_execute_js` | Arbitrary JS execution in page context | JS return value | 15s |
| `browser_intercept` | Request/response interception (CSRF token theft) | Captured tokens/headers | 30s |
| `http_request` | Standard HTTP request (fallback) | Response body | 15s |
| `http_request_raw` | Base64 body for XXE, null byte control | Response body | 15s |
| `upload_file` | Multipart upload with MIME/size bypass | Upload response | 30s |
| `download_artifact` | Fetch and store discovered files | File content | 30s |

### Cannot Use

| Tool | Reason |
|------|--------|
| Recon tools (nmap, masscan, etc.) | Not Alpha's job |
| Exploitation tools (sqlmap, john, etc.) | Gamma's job |
| SAST tools | Alpha's job |

### How LLM Uses Tools

```
MCP Agent uses browser tools for multi-step flows:

THOUGHT: Execute multi-step CSRF exploit
  - Step 1: Navigate to form page, capture CSRF token
  - Step 2: Inject payload with stolen CSRF token
  - Step 3: Submit and capture response

ACTION: browser_navigate({url: TARGET_URL})
  → Returns: {html, console_logs, cookies}

ACTION: browser_execute_js({script: "return document.querySelector('[name=csrf]').value"})
  → Returns: CSRF_TOKEN

ACTION: browser_intercept({filter: "csrf_token"})
  → Returns: {captured_tokens: [...]}

ACTION: browser_navigate({url: TARGET_URL + "/submit", postData: {...}})
  → Returns: {html, status}

WRITE: Results to graph
EMIT: exploit_completed or exploit_failed
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/mcp-agent.md
2. Load overlay: prompt-overlays/{exploit_type}.md (if exists)
3. Load mission context:
   - Mission ID, target URL, method, endpoint
   - Exploit type (dom_xss, csrf, auth_bypass, etc.)
   - Credential nodes to use (session cookies, etc.)
4. Load session context:
   - Browser cookies from prior steps
   - CSRF tokens captured
   - LocalStorage/sessionStorage values
5. Compose final prompt
```

### Context Budget

- **Estimated tokens per step:** ~600–1000
- **Context budget per mission:** ~4000 tokens
- **Overflow behavior:** Write browser state to graph, continue from checkpoint

### Session State

What persists across steps:
- `browser_context`: Cookies, localStorage, sessionStorage
- `captured_tokens`: CSRF tokens, session IDs
- `current_step`: Step number in multi-step flow

What is re-read from graph:
- Mission node
- Credential nodes for session context

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Commander:      validation_probe_complete (probe result ready)
→ Gamma:          (implicit — credential_found triggers Chain Planner)
→ Critic:         exploit_failed (failure analysis)
→ Post-Exploit:  (implicit — rce_confirmed triggers Post-Exploit)
```

### Browser State Handoff

```
If browser context exceeds budget:
  → Write current browser state to graph (cookies, tokens, localStorage)
  → Store as ArtifactNode with type="browser_state"
  → Mission can resume from checkpoint
  → Next MCP instance reads browser_state artifact, restores context
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[mcp] State: DORMANT → STANDBY
[mcp] Mission claimed: MISSION_ID (exploit_type: TYPE)
[mcp] Browser launch: Starting Puppeteer
[mcp] Step N: browser_navigate → URL
[mcp] CSRF token captured: TOKEN_VALUE
[mcp] Step N: browser_execute_js → RESULT
[mcp] Artifact extracted: TYPE=credential VALUE=****
[mcp] Validation probe: ARTIFACT_ID → http_status=HTTP_CODE
[mcp] Probe result: RESULT (success|expired|error)
[mcp] Mission complete: MISSION_ID (success=true)
[mcp] Browser closed
[mcp] State: ACTIVE → COOLDOWN
```

### Trace Commands

```bash
# Live logs
pm2 logs mcp

# Bridge artifacts pending validation
redis-cli GRAPH.QUERY solaris "MATCH (a:artifact) WHERE a.discovered_by='mcp' RETURN a.id, a.subtype, a.discovered_at"

# MCP exploit history
redis-cli GRAPH.QUERY solaris "MATCH (e:exploit {executed_by:'mcp'}) RETURN e.mission_id, e.success, e.executed_at"
```

---

## 9. Error Handling

### Browser Errors

```
Puppeteer launch failure:
  → Retry once
  → If still failing: emit exploit_failed with failure_class="browser_error"

Navigation timeout:
  → Retry once with longer timeout
  → If still timeout: emit exploit_failed with failure_class="timeout"

CSRF token not found:
  → Retry page analysis once
  → If still not found: emit exploit_failed with failure_class="auth_required"
```

### Tool Execution Errors

```
browser_navigate failure:
  → Retry once
  → If still failing: emit exploit_failed

browser_execute_js failure:
  → Log error, try next step
  → If critical step failed: emit exploit_failed
```

### LLM Generation Errors

```
Malformed output:
  → Retry with same context (max 2 retries)
  → If still malformed: emit exploit_failed

API error:
  → Fallback to Groq if using Ollama
  → If Groq fails: emit exploit_failed
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 2000ms |
| Browser launch | < 5s |
| Navigation SLA | < 30s |
| Mission completion SLA | < 30 min (multi-step flows are complex) |

### Mission Completion SLA

| Mission Type | Target | Max |
|---------------|--------|------|
| CSRF token capture | < 2 min | 5 min |
| DOM XSS confirmation | < 5 min | 15 min |
| 2FA bypass flow | < 10 min | 30 min |
| Validation probe | < 1 min | 2 min |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~2GB (Puppeteer headless) |
| Ollama model | ~8GB VRAM |
| Puppeteer/Chromium | ~500MB |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~2.5GB RSS + 8GB VRAM** |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Browser launch | 10s |
| browser_navigate | 30s |
| browser_execute_js | 15s |
| browser_intercept | 30s |
| http_request | 15s |
| upload_file | 30s |

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results
- [Gamma §5](./gamma.md#5-tool-usage) — Tool permission matrix (MCP vs Gamma tools)
- [Commander §3](./commander.md#3-event-contract) — Validation probe flow (Commander → MCP → Commander)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns

*MCP spec version 1.0 — 2026-04-03*
