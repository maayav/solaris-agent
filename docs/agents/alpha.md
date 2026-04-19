# Alpha Recon Agent Specification

**Agent:** Alpha Recon
**Type:** `alpha`
**Tier:** Tier 2 (Local Ollama + Cloud fallback)
**Model:** `qwen2.5-coder:7b-instruct-q4_K_M` (Ollama primary) → `moonshotai/kimi-k2-instruct` (Groq fallback)
**Temperature:** 0.65
**Poll Interval:** 5000ms

---

## 1. Identity & Role

Alpha Recon is the **active reconnaissance engine** of the Solaris swarm. It discovers the attack surface by actively scanning the target — endpoints, parameters, technologies, and surface-level vulnerabilities. It fingerprints the technology stack and writes component nodes that OSINT and Mission Planner consume.

**Alpha DOES:**
- Actively scan targets (port scan, web discovery, endpoint enumeration)
- Fingerprint technology stack from responses
- Write discovered endpoints, components, and surface findings to graph
- Pre-deduplicate findings before writing (reduce noise in pipeline)
- Ingest SAST output from repo_path if provided
- Trigger Specialist spawning when novel surface is discovered

**Alpha DOES NOT:**
- Execute exploitation (Gamma's job)
- Authorize missions (Commander's job)
- Generate payloads (Gamma's job)
- Make strategic decisions about what to scan next (data-driven from graph)

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Alpha: DORMANT on init → STANDBY on scan schedule or swarm start
       STANDBY → ACTIVE on scheduled scan trigger or mission_authorized
       ACTIVE → COOLDOWN on scan complete
       COOLDOWN → STANDBY if more scan work pending
       COOLDOWN → DORMANT if scan queue empty
       Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/alpha-recon.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: scanInitiated, mission_authorized)
4. Set state: DORMANT
5. If repo_path provided:
     → codebase_memory/index_repository(repo_path)
     → codebase_memory/get_architecture() → write component nodes
6. Begin scan schedule (configurable: default every 30min)
7. Begin poll loop at 5000ms interval
```

### Scan Schedule

```
On swarm start:
  1. Quick port scan: nmap TARGET -p 1-10000 --open (5 min)
  2. Web discovery: gobuster + ffuf on discovered HTTP services (ongoing)
  3. Technology fingerprint: whatweb on all web endpoints (ongoing)
  4. SAST scan: nuclei on repo_path if provided (ongoing)

Every 30 minutes (configurable):
  1. Re-scan new/changed endpoints
  2. Quick port re-scan (delta from previous)
  3. nuclei update scan for new CVE templates
```

### SAST Ingestion (if repo_path provided)

```
1. index_repository(repo_path):
   → Index all source files
   → Extract routes, functions, patterns

2. get_architecture():
   → Languages detected
   → Frameworks (Express, Django, Rails, etc.)
   → Database (SQLite, PostgreSQL, MySQL, etc.)
   → Auth mechanism (JWT, session, OAuth, etc.)

3. search_graph({name_pattern: ".*upload.*|.*file.*|.*exec.*|.*query.*"}):
   → File upload candidates
   → Command injection candidates
   → SQL query functions

4. trace_call_path({function_name: "query|exec|evaluate|render"}):
   → SQL injection candidates
   → XSS candidates
   → Command injection candidates
   → Template injection candidates

5. Write findings to graph:
   → ComponentNode for each detected tech
   → EndpointNode for each HTTP route
   → FindingNode for each SAST candidate
```

### Shutdown Sequence

```
1. Flush any pending scan results to graph
2. Mark current scan session complete
3. Close FalkorDB connection
4. Close EventBus connection
5. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `scanInitiated` | `{target_id, scan_type: "full"\|"delta"\|"targeted", options}` | Commander or manual trigger |
| `mission_authorized` | `{mission_id, executor:"alpha", ...}` | (future: Alpha handles specialized recon missions) |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `port_discovered` | `{target_id, port, protocol: "tcp"\|"udp", service, state: "open"\|"closed"}` | Port scan result |
| `service_identified` | `{target_id, service, version, port, fingerprint_method}` | Service detection |
| `endpoint_discovered` | `{target_id, method, path, parameters, discovered_by}` | Web enumeration result |
| `component_detected` | `{target_id, component_name, version, component_type: "framework"\|"library"\|"database"\|"server"}` | Technology fingerprint |
| `finding_written` | `{target_id, finding_type: "sast_candidate"\|"misconfiguration"\|"info_disclosure", evidence, source: "alpha"}` | SAST finding |
| `recon_complete` | `{target_id, scan_type, ports_found, endpoints_found, components_found, duration_ms}` | Scan phase complete |
| `specialist_activated` | `{specialist_id, surface_type: "graphql"\|"websocket"\|"jwt"\|"upload"\|"oauth", parent_mission, spawned_by}` | Novel surface discovered |

### Collaboration Sequences

**Initial Recon Flow:**
```
Swarm start
  → Alpha begins port scan (nmap)
  → Alpha discovers open HTTP services
  → Alpha begins web enumeration (gobuster + ffuf)
  → Alpha fingerprints technologies (whatweb, curl for headers)
  → Alpha writes all findings to graph
  → Alpha emits endpoint_discovered, component_detected events
  → Commander validates → Mission Planner generates missions
```

**SAST + Dynamic Hybrid (if repo_path provided):**
```
Alpha reads repo_path
  → index_repository() → find all source files
  → trace_call_path("query") → SQLi candidates
  → trace_call_path("exec") → command injection candidates
  → search_graph(".*upload.*") → file upload endpoints
  → Write findings to graph with source="alpha+sast"
  → Mission Planner picks up SAST findings → generates missions
  → Gamma executes missions against running app
  → Results compared with SAST predictions (feedback loop)
```

**Specialist Trigger Flow:**
```
Alpha discovers /graphql endpoint
  → Emit component_detected with surface_type="graphql"
  → Commander reads surface_type, recognizes GraphQL specialist trigger
  → Commander creates SpecialistConfig node
  → Commander spawns specialist-gamma variant
  → Specialist begins GraphQL-specific enumeration
```

---

## 4. Memory Schema

### Section Prefix

Alpha writes to **recon/** section exclusively.

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `TargetNode` | `id, base_url, scope, out_of_scope, tech_stack` |
| `EndpointNode` | `id, method, path, url, discovered_by` |
| `ComponentNode` | `id, name, version, fingerprint` |
| `MissionNode` | `id, status, context_nodes` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `EndpointNode` | `{id, type:"endpoint", method, path, url, parameters, headers, auth_required, discovered_by:"alpha", created_at}` | Web enumeration |
| `ComponentNode` | `{id, type:"component", name, version, fingerprint, discovered_at}` | Technology fingerprint |
| `FindingNode` | `{id, type:"finding", source:"alpha", target_endpoint, vuln_class, evidence, created_at}` | SAST candidate |
| `PortNode` | `{id, type:"port", port, protocol, service, state, discovered_by:"alpha", created_at}` | Port scan |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:PART_OF` | EndpointNode → TargetNode | Endpoint discovered |
| `:PART_OF` | ComponentNode → TargetNode | Component detected |
| `:RUNS_ON` | ComponentNode → PortNode | Technology fingerprint |
| `:DISCOVERED_BY` | EndpointNode → MissionNode | SAST candidate linked to endpoint |

### Lifecycle

- **EndpointNode**: Created on discovery, updated if re-scanned with new info
- **ComponentNode**: Created on detection, version updated if different
- **FindingNode**: Created on SAST finding, never deleted (audit trail)
- **PortNode**: Created on port scan, state updated on re-scan

---

## 5. Tool Usage

### Can Use

| Tool | Description | Expected Output | Timeout |
|------|-------------|-----------------|---------|
| `nmap` | Port/service scan with version detection | stdout: port list with services | 60s |
| `masscan` | Fast TCP scan for large ranges | stdout: open ports | 60s |
| `netcat` | Banner grab, port probe | stdout: banner | 10s |
| `rustscan` | Fast port scanner | stdout: open ports | 30s |
| `gobuster` | Directory/file enumeration (dir, dns, vhost) | stdout: found paths | 60s |
| `ffuf` | Fast web fuzzer for routes, parameters | stdout: fuzz results | 60s |
| `dirsearch` | Web path enumeration | stdout: found paths | 60s |
| `nikto` | Web server misconfiguration scan | stdout: nikto findings | 120s |
| `nuclei` | Template-based vulnerability scan | stdout: nuclei results | 120s |
| `whatweb` | Technology fingerprint | stdout: detected technologies | 30s |
| `curl` | HTTP requests for headers, responses | stdout: response | 10s |

### Cannot Use

| Tool | Reason |
|------|--------|
| `sqlmap` | Exploitation tool — Gamma's job |
| `john` | Credential attack — Gamma's job |
| `hashcat` | Credential attack — Gamma's job |
| `hydra` | Credential attack — Gamma's job |
| `msfconsole` | Exploitation — Gamma's job |
| `browser_navigate` | Browser tools — MCP only |
| `browser_execute_js` | Browser tools — MCP only |
| `linpeas/winpeas` | Post-exploitation — Gamma/Post-Exploit only |

### How LLM Uses Tools

Alpha's LLM operates in a **scan planning loop**:

```
THOUGHT: What should I scan next?
  - What ports are open?
  - What web services are running?
  - What endpoints have been discovered?
  - What surface remains unexplored?

ACTION: executeTool(tool_name, args)

OBSERVATION: Parse scan output
  - What was found?
  - Any new services?
  - Any new endpoints?
  - Any credentials or tokens in responses?

WRITE: Write findings to graph
  - Create EndpointNode for each new path
  - Create ComponentNode for each detected tech
  - Emit discovery events

[Continue until scan complete or context budget exceeded]
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/alpha-recon.md
2. Load TargetConfig: base_url, scope, out_of_scope, tech_stack hints
3. Load current graph state:
   - All known endpoints for this target
   - All known components
   - Scan progress (last scan time, coverage percentage)
4. Load scan objectives:
   - Priority: ports → web → SAST
   - Time budget for this scan cycle
   - Delta from last scan (what's new since last run)
5. Compose final prompt
```

### Context Budget

- **Estimated tokens per scan iteration:** ~400–800
- **Context budget per scan cycle:** ~5000 tokens
- **Overflow behavior:**
  ```
  If context_budget > 5000:
    → Write current scan progress to graph
    → Emit scanInitiated with resume=true
    → Transition to DORMANT
    → Next scan cycle picks up where left off
  ```

### Session State

What persists across scan iterations:
- `scan_session_id`: current scan session identifier
- `discovered_endpoints`: Set of endpoint IDs found this session
- `discovered_components`: Set of component IDs found this session
- `scan_progress`: percentage of target covered

What is re-read from graph each iteration:
- Updated TargetNode (in case scope changed)
- Current endpoint/component state
- Last scan timestamp

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Commander:      finding_written (raw findings for validation)
→ Mission Planner: (implicit — finding_written triggers Commander → Mission Planner flow)
→ Specialist:     (implicit — specialist_activated triggers Commander to spawn specialist)
```

### Information Requests

```
Alpha does not request information from other agents.
Alpha reacts to its own discoveries and the scan schedule.
```

### Specialist Spawning Trigger

```
Alpha discovers /graphql endpoint
  → Writes ComponentNode with surface_type="graphql"
  → Emits component_detected
  → Commander reads surface_type="graphql"
  → Commander checks SpecialistSurfaceMap
  → Commander creates SpecialistConfig node
  → Commander spawns specialist-gamma-{id} via PM2
  → Specialist begins GraphQL-specific exploitation
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[alpha] State: DORMANT → STANDBY (repo indexed, scan ready)
[alpha] Starting scan: TARGET (type: full|delta)
[alpha] Port scan: nmap TARGET -p 1-10000 --open → N ports found
[alpha] Service detected: PORT/SERVICE (version: VERSION)
[alpha] Web enumeration started: TARGET (gobuster + ffuf)
[alpha] Endpoint discovered: METHOD /path (parameters: ...)
[alpha] Component detected: COMPONENT@VERSION (fingerprint: ...)
[alpha] SAST candidate found: /path:function (vuln_class: SQLI|XSS|RCE)
[alpha] Scan complete: TARGET (N ports, N endpoints, N components, duration: Xs)
[alpha] State: ACTIVE → COOLDOWN
[alpha] State: COOLDOWN → DORMANT (scan complete, schedule next in 30min)
```

### Trace Commands

```bash
# Live logs
pm2 logs alpha

# All discovered endpoints
redis-cli GRAPH.QUERY solaris "MATCH (e:endpoint) RETURN e.id, e.method, e.path, e.url ORDER BY e.created_at DESC"

# Technology components
redis-cli GRAPH.QUERY solaris "MATCH (c:component) RETURN c.name, c.version ORDER BY c.discovered_at DESC"

# Scan coverage
redis-cli GRAPH.QUERY solaris "MATCH (e:endpoint) WITH e.target_id as tid, count(e) as ec MATCH (p:port) WHERE p.target_id=tid RETURN tid, ec, count(p) as pc"
```

### Diagnostic Queries

```sql
-- Endpoints discovered this session
SELECT * FROM events WHERE type='endpoint_discovered' AND created_at > (now() - interval '1 hour');

-- Components detected
SELECT * FROM events WHERE type='component_detected' ORDER BY created_at DESC;

-- Specialist spawning events
SELECT * FROM events WHERE type='specialist_activated';
```

---

## 9. Error Handling

### Rate Limit Errors

Not applicable — Alpha uses local Ollama or direct tool execution.

### Tool Execution Errors

```
Non-zero exit code:
  → Log stderr
  → If tool is nmap/masscan: retry once, then skip that port range
  → If tool is gobuster/ffuf: retry once with different wordlist
  → If tool is curl: log warning, continue to next endpoint

Timeout:
  → Kill process
  → If timeout on critical scan: retry once
  → If persistent timeout: skip that target, log error

Tool not found:
  → Log critical — required tool missing
  → Emit recon_complete with partial results
  → Do not block on missing tools
```

### LLM Generation Errors

```
Malformed output:
  → Retry with same context (max 2 retries)
  → If still malformed: proceed with deterministic scan (no LLM planning)

API error (Ollama):
  → Fallback to Groq cloud model
  → If Groq fails: run deterministic scan without LLM planning

Timeout:
  → Retry once
  → If still timeout: proceed with deterministic scan
```

### Graph Write Errors

```
Write failure:
  → Buffer findings in memory
  → Retry with exponential backoff
  → If still failing: emit recon_complete with warning, findings buffered locally
  → On reconnect: flush buffered findings
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 5000ms |
| Scan scheduling | Every 30min (configurable) |
| Tool call start | < 1s from decision |

### Scan SLA

| Scan Type | Target | Max |
|-----------|--------|------|
| Quick port scan (top 1000 ports) | < 2 min | 5 min |
| Full port scan (all ports) | < 10 min | 15 min |
| Web enumeration (gobuster) | < 10 min per host | 15 min |
| Technology fingerprint | < 5 min | 10 min |
| SAST scan (nuclei on repo) | < 15 min | 30 min |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~1GB |
| Ollama model (qwen2.5-coder:14b) | ~8GB VRAM |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| **Total** | **~1GB RSS + 8GB VRAM** |

### Tool Timeouts

| Tool | Default Timeout | Notes |
|------|----------------|-------|
| `nmap` (quick) | 30s | Top 1000 ports |
| `nmap` (full) | 120s | All ports |
| `masscan` | 60s | |
| `netcat` | 10s | Per port |
| `rustscan` | 30s | |
| `gobuster` | 60s | Per target |
| `ffuf` | 60s | |
| `dirsearch` | 60s | |
| `nikto` | 120s | |
| `nuclei` | 120s | |
| `whatweb` | 30s | |
| `curl` | 10s | |

---

*Alpha spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Gamma §5](./gamma.md#5-tool-usage) — Tool exclusions (Alpha vs Gamma tool sets differ)
- [OSINT §3](./osint.md#3-event-contract) — Component detection flow (Alpha → OSINT for specialist spawning)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
