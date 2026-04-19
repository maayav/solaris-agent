<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Solaris-Agent: Complete System Plan


***

## 1. System Philosophy

Solaris is a **self-directed, graph-memory-driven offensive security swarm** designed to operate against any web application or codebase. It is not a script — it reasons, adapts, chains findings, and evolves through failure. JuiceShop is the primary test target but every design decision is parameterized, not hardcoded. The swarm receives a `target_config` at launch and derives all behavior from live discovery rather than assumed structure.

```typescript
interface TargetConfig {
  name:         string;        // "JuiceShop", "TargetApp", etc.
  base_url:     string;        // "http://localhost:3000"
  repo_path?:   string;        // optional local codebase for SAST
  tech_stack?:  string[];      // hints: ["node", "express", "sqlite"] — optional
  scope:        string[];       // URL patterns in scope
  out_of_scope: string[];      // patterns to never touch
  auth_hints?:  Record<string, string>; // known test creds if provided
  flags?: {                    // Advanced feature toggles (Section 14)
    adversarial_self_play?:    boolean;  // Enable WAF Duel sub-loop (default: false)
    belief_state?:            boolean;  // Enable POMDP belief layer (default: false)
    cross_engagement_memory?: boolean;  // Enable persistent cross-engagement lessons (default: false)
    semantic_novelty?:        boolean;  // Enable novelty-weighted mission priority (default: false)
    causal_attribution?:      boolean;  // Enable structured causal failure attribution (default: false)
    dynamic_specialists?:      boolean;  // Enable dynamic specialist agent spawning (default: false)
    context_relay?:           boolean;  // Enable Gamma-to-Gamma context handoff (default: false)
  };
}
```


***

## 2. Agent Roster

### Command Layer

**Commander** `[STANDBY — always warm]`
Strategic authority of the swarm. Validates all incoming findings, authorizes missions, promotes verified credentials, deduplicates at the mission level, routes enrichment tasks to OSINT, and emits swarm events. Uses a Tier 3 model (Nemotron-3-super NVIDIA API). Does **not** generate missions or execute tasks — it governs.

**Commander Capacity Management:**
```
Queue depth limit:     50 pending validations (finding_validated events)
                      If queue exceeds 50, new findings are held in a staging table
                      until queue drains below 40 (hysteresis to prevent thrashing)

Processing SLA:       Target validation time: <30s per finding batch
                      If processing time exceeds 60s, Commander emits warning event
                      and continues — no finding is dropped due to SLA miss

Event accumulation:    While Commander is ACTIVE processing a batch, incoming
                      finding_written events accumulate in staging. Commander checks
                      staging queue on each cycle and drains it in FIFO order.

Timeout behavior:       If Commander has been ACTIVE for >300s on a single finding,
                      it is marked ERROR and reset. The finding remains unvalidated;
                      Alpha Recon or OSINT may resubmit it via a new finding_written event.
```

**Finding Validation Criteria (runs on every finding_written event):**
```
1. scope_check      → does the endpoint URL match any pattern in TargetConfig.scope?
                     Does NOT match any pattern in TargetConfig.out_of_scope?
2. duplicate_check  → no existing vulnerability node with same vuln_class + target_endpoint
3. noise_filter     → is this a real finding or an error page / default response?
                     (HTTP status + response body pattern analysis)
4. signal_quality   → does the finding have sufficient supporting evidence?
                     (request, response, matched pattern, extraction where applicable)
```

If any check fails, the finding is dropped silently (no event emitted). If all pass, Commander writes it to its validated queue and emits `finding_validated` for Mission Planner.

**Mission Planner** `[DORMANT → ACTIVE on finding batch]`
Consumes validated finding batches from Commander (as full node ID lists, not full objects — Mission Planner reads nodes from graph on demand). Generates prioritized `MissionNode` objects for the Gamma queue. Understands exploit prerequisites and dependency chains. Does not execute — only plans. Batched activation: waits for 10 nodes or 60 seconds, whichever comes first. Mode-switchable between `standard` and `chain_planning` (see Chain Planner below). Uses a Tier 4 model (Gemini 2.0 Flash).

**Priority Scoring Formula:**
```
priority_score = (CVSS_score × 2) + (CISA_KEV_flag × 10) + (ExploitDB_PoC_flag × 5) + exploit_type_weight

exploit_type_weights:
  RCE/XXE/SSRF:          8
  SQLi/Auth Bypass:       6
  XSS/Stored XSS:        4
  IDOR/CSRF:             3
  Path Traversal:         3
  Information Disclosure: 2

Resulting score maps to priority:
  ≥ 20: critical
  10–19: high
  5–9:  medium
  < 5:  low
```

If the graph has no CVSS or ExploitDB data for a vulnerability, Mission Planner assigns the default weight for that exploit type without the bonus points. CISA KEV flag is binary — if `actively_exploited: true` exists on the node, it always receives `critical` priority regardless of other signals.

**Escalation Levels:**
The `escalation_level` field on `MissionNode` signals how aggressively a mission should be executed given observed defense responses:

```
baseline    → Standard payload set, no WAF signals observed.
              Default for all newly generated missions.

aggressive  → Elevated payload set triggered by:
              - Prior attempt on this endpoint returned WAF/403 without clear block reason
              - OSINT brief notes WAF is present for this vuln class
              Gamma uses known bypass variants first before falling back to baseline payloads.

evasive     → WAF-aware payload generation triggered by:
              - 3 consecutive waf_blocked failures on this endpoint
              - Adversarial Self-Play loop (see Section 14) has generated bypass candidates
              Gamma uses only evasion-optimized payloads; no standard payloads attempted.
```

Escalation is set by Critic after failure classification and updated by the Adversarial Self-Play loop. It is never downgraded — once `evasive`, the mission stays evasive for the remainder of the engagement.

***

### Recon Team

**Alpha Recon** `[DORMANT → ACTIVE on schedule + swarm start]`
Actively scans the target for endpoints, parameters, technologies, and surface-level vulnerabilities. Ingests SAST output from the repo path if provided. Pre-deduplicates findings before writing to its graph section. Fingerprints the technology stack and writes component nodes that OSINT and Mission Planner consume.

If TargetConfig.repo_path provided:
1. codebase_memory/index_repository({repo_path})
2. codebase_memory/get_architecture() → write component nodes
3. codebase_memory/search_graph({name_pattern: ".*upload.*|.*file.*"}) → file upload candidates
4. codebase_memory/search_graph({label: "Route"}) → HTTP endpoints
5. codebase_memory/trace_call_path({function_name: "query|exec"}) → SQLi candidates

**OSINT Agent** `[DORMANT → ACTIVE on enrichment event + mission_queued + feed schedule]`
Uses a Tier 4 model (Gemini 2.0 Flash). Internal task priority (when multiple triggers fire simultaneously):
```
1. enrichment_requested     (Commander's direct enrichment — highest priority)
2. exploit_failed brief      (Critic's supplementary brief — targets specific block)
3. mission_queued brief      (proactive brief for queued mission)
4. feed_refresh              (lowest — runs in background)
```
When 20 `mission_queued` events fire simultaneously, OSINT batches them: reads all 20 mission nodes from graph, generates briefs for all, writes in one batch. Briefs for missions already `active` take priority over those still `queued`. If OSINT is slow or dormant, Gamma proceeds without the brief — it is advisory context, not a hard dependency.
Three responsibilities: continuous feed ingestion on a tiered schedule, event-driven CVE/technique enrichment when Commander emits an enrich task, and proactive exploit brief generation when a mission enters the queue. Writes payload library nodes, technique documentation, CVE detail nodes, exploit availability flags, and `ExploitBriefNode` objects into the `intel/` graph section.

***

### Gamma Team

**Gamma Exploit** `[DORMANT → ACTIVE, pool of 1-3]`
Executes command-driven, single-request or scripted HTTP exploits. Consumes missions typed `executor: gamma`. Stateless workers — multiple instances run in parallel. Writes results, extracted tokens, cookies, and confirmed vulnerabilities to its graph section. Uses a Tier 2 model (qwen2.5:14b Ollama).

**Pool Scaling:** Managed by the event loop (not a separate pool manager). Gamma instances are PM2 processes (`gamma-1`, `gamma-2`, `gamma-3`). When a third mission becomes `queued` and all current Gammas are ACTIVE, the event loop starts `gamma-3` via `pm2.start()`. Pool is capped at 1 on RTX 4080 due to VRAM constraints (14GB used by always-on models).

**Atomic Mission Claiming:**
graph_get_missions → returns unclaimed missions matching executor.
Atomic claim via Cypher:
```cypher
MATCH (m:Mission {status: 'queued', authorized: true, verified: true})
WHERE NOT EXISTS((m)-[:CLAIMED_BY]->(:Agent))
WITH m LIMIT 1
SET m.status = 'active', m.claimed_by = $agent_id
RETURN m
```
First agent to execute wins.

**MCP Agent** `[DORMANT → ACTIVE on mcp-typed mission]`
Executes interactive, browser-driven, stateful, multi-step exploits that Gamma cannot handle. Uses Puppeteer, session management, JS execution, localStorage injection. Consumes missions typed `executor: mcp`. Handles DOM XSS, CSRF, 2FA bypass, multi-step auth flows. Uses a Tier 2 model (qwen2.5:14b Ollama).

**Verifier** `[STANDBY — nano model, always warm]`
Runs five pre-flight checks on every mission before it enters the authorized queue. Nano model (nemotron-3-nano Ollama). Does not use reasoning — pure pattern matching and one HTTP probe. Rejects with structured reason, allows Mission Planner to fix and resubmit (max 2 resubmissions before escalating to Commander).

**Authorization Sequence (two-step, distinct responsibilities):**
```
Step 1 — Verifier (structural gate):
  → All 5 pre-flight checks pass
  → Writes verified: true on MissionNode
  → Emits mission_verified event
  → Commander is NOT re-consulted for structural validity

Step 2 — Commander (strategic gate):
  → Receives mission_verified event
  → Reviews: is this mission worth attempting given current swarm state?
    (e.g., not redundant with an already-failed similar mission, target still reachable)
  → Writes authorized: true on MissionNode
  → Emits mission_authorized event
  → Gamma picks up from here
```

Verifier is a deterministic structural filter. Commander is a reasoning-based strategic reviewer. They are not conflated — each has a distinct, non-overlapping role.

**Chain Planner** `[DORMANT → ACTIVE on credential/session discovery]`
Activates whenever a valid credential, session token, cookie, or privileged artifact is promoted to the Recon section. Traverses the graph to find all exploits now unlocked by the new asset. Generates **chained mission sequences** — from simple (use admin token to access admin panel) to complex (use admin JWT → dump user table via SQLi → crack hashes → pivot to other services). Handles ALL chain complexity levels, not just RCE/post-exploit chains. Uses a Tier 4 model (Gemini 2.0 Flash).

```
Gamma extracts:  admin JWT
Chain Planner:   What is now unlocked?
                 → Admin Section access
                 → Five-Star Feedback deletion
                 → User credential exfiltration via /api/Users
                 → Product tampering
                 → Any endpoint requiring admin: Bearer auth
                 Emits 4 chained missions in dependency order
```

```
Gamma extracts:  session cookie for user ID 5
Chain Planner:   → IDOR check: can this cookie access other user IDs?
                 → What endpoints accept cookie auth vs JWT?
                 → Is this cookie reusable for CSRF?
                 Emits 3 lateral missions
```

**Critic** `[DORMANT → ACTIVE on exploit failure]`
Analyses failed exploit attempts. Receives the full execution context — command, response, HTTP status, error output. Classifies the failure, sends structured feedback to the executor agent for retry. After 3 failures, writes a `FailedMissionNode` with full evidence and `failure_class`. Also writes to the Lesson Archive if a successful retry occurred. Uses a Tier 1 model (nemotron-3-nano Ollama).

**Post-Exploit Agent** `[DORMANT → ACTIVE on confirmed access/privilege]`
Uses a Tier 5 model (Claude Sonnet API).

**Mode 1 — Server-Side Access** (triggered by RCE/XXE/path traversal/SSRF confirmation):
- Activates on confirmed server-side access
- Uses GTFOBins/LOLBAS from intel section for privilege escalation planning
- Generates missions: file enumeration, config extraction, credential harvesting from server filesystem

**Mode 2 — App-Layer Escalation** (triggered by admin_access_confirmed or privileged_user_confirmed):
- Activates when Gamma/MCP confirms administrative or privileged user access
- Generates missions for: mass account enumeration, business logic abuse, horizontal/vertical privilege escalation, admin panel reconnaissance, API key exfiltration from admin interfaces
- Does NOT run GTFOBins/LOLBAS lookups (no server-side access)

Both modes write missions following the standard pipeline (Verifier → Commander → queue).

**Output Contract:**
```
1. Writes MissionNode objects directly to the graph with:
     created_by: "post_exploit"
     executor: "gamma" or "mcp" as appropriate
     escalation_level: "post_exploit"
     chain_id: links to the parent chain node if applicable

2. These missions go through the standard pipeline:
     → Verifier structural check (no exceptions)
     → Commander strategic review (no exceptions)
     → Enter gamma/ queue

3. No bypass of Verifier or Commander for post-exploit missions.
   The escalation_level field signals context but does not skip gates.
```

**Report Agent** `[DORMANT → ACTIVE once on swarm_complete event]`
Runs exactly once. Traverses the entire graph and generates a structured pentest report with all findings, severity ratings, reproduction steps, evidence, chained attack paths, failed missions with analysis, and lessons learned. Uses the full Lesson Archive as context. Uses a Tier 5 model (Gemini 1.5 Pro).

**Output Specification:**
```
Format:         Markdown (.md) — human-readable, diff-friendly, portable
Output path:    ./reports/swarm-report-{timestamp}.md
                Also written as artifact node: "artifact/report:swarm-{timestamp}"

Required Sections:
  1. Executive Summary        — scope, overall risk rating, key findings count by severity
  2. Methodology              — agents used, coverage, approach
  3. Findings by Severity     — Critical → Low; each finding includes:
                                 - Description
                                 - Evidence (request/response excerpts)
                                 - CVSS score + vector
                                 - Reproduction steps
                                 - Impact analysis
                                 - Remediation recommendation
  4. Attack Chains            — sequential diagrams of chained exploits,
                                 each step linked to finding evidence
  5. Failed Missions          — each includes: target, exploit type, failure_class,
                                 evidence trail, classified as:
                                 confirmed_unexploitable / needs_manual_review / likely_patched
  6. Lesson Learned           — patterns across failures, systemic observations,
                                 recommendations for future engagements
  7. Appendix                 — raw event log summary, agent activity stats,
                                 scope compliance confirmation

Artifact graph node written: type "artifact", subtype "pentest_report"
  - links to all finding nodes, chain nodes, failed_mission nodes
  - enables downstream processing (PDF export, ticket creation, etc.)
```

***

## 3. Knowledge Graph Memory

### Design Principle

Three shared stores, each with a specific purpose:

1. FalkorDB (Railway): Live graph memory — nodes/edges for active engagement only.
   - Clients: falkordb npm package
   - Reset at swarm_complete (archived to Supabase)
   - Sections: recon/, gamma/, bridge/, intel/, lessons/ (per-run only)

2. Supabase: Persistent relational data — engagements, lessons (cross-run), reports.
   - Client: Supabase JS client
   - Tables: engagements, run_reports, target_configs, cross_engagement_lessons

3. SQLite (local): Event bus only — append-only activation triggers.
   - Client: better-sqlite3
   - File: ./solaris-events.db (per-run)

### Node Types

```typescript
type NodeType =
  | "target"              // The application being tested
  | "endpoint"            // Discovered URL, method, parameters
  | "component"           // Tech/library fingerprint (express@4.18, sqlite3, etc.)
  | "vulnerability"       // CVE, weakness class, CVSS score
  | "user"                // Discovered user account
  | "credential"          // Password, JWT, cookie, API key, session token
  | "mission"             // Task for Gamma/MCP to execute
  | "exploit"             // Executed payload with result
  | "artifact"            // File, backup, coupon, NFT, config
  | "finding"             // Raw observation from any agent
  | "chain"               // Multi-step attack sequence
  | "lesson"              // Archived problem/solution pair
  | "failed_mission"      // Archived failed attempt with evidence
  | "intel"               // Feed data: CVE details, payloads, techniques
  | "event"               // Swarm event bus entries
  | "belief"              // Probabilistic target state (POMDP layer)
  | "gamma_handoff"       // Structured mid-exploit context relay between Gamma instances
  | "cross_engagement_lesson" // Persistent lesson keyed to tech stack fingerprint
  | "specialist_config"    // Dynamic specialist agent spawn configuration
  | "waf_duel"            // Adversarial self-play WAF modeling session
  | "causal_attribution"  // Structured failure cause + bypass hypothesis from Critic
```


### Edge Types

```typescript
type EdgeType =
  | "PART_OF"             // endpoint → target
  | "DEPENDS_ON"          // mission → mission (prerequisite)
  | "UNLOCKS"             // credential → mission/endpoint
  | "AUTHENTICATED_VIA"   // user → exploit
  | "HAS_CREDENTIAL"      // user → credential
  | "FOUND_AT"            // exploit/finding → endpoint
  | "LED_TO"              // exploit → artifact/credential
  | "EXPLOITS"            // exploit → vulnerability
  | "EXTRACTED_FROM"      // credential → exploit
  | "CHAINS_INTO"         // exploit/credential → chain
  | "NEXT_IN_CHAIN"       // mission → mission (ordered sequence)
  | "ENRICHES"            // intel → vulnerability/endpoint
  | "IMPERSONATES"        // credential → user
  | "ESCALATES_TO"        // credential → credential
  | "FAILED_WITH"         // mission → failed_mission
  | "RESOLVED_BY"         // failed_mission → lesson
  | "AFFECTS"             // vulnerability → component
```


### Memory Sections (Permission Map)

```
recon/
  Owner:      Alpha Recon (write), OSINT (write)
  Promoted to by: Commander (valid credentials, confirmed vulns)
  Contains:   endpoints, components, vulnerabilities, users, confirmed credentials
  Read by:    ALL agents

gamma/
  Owner:      Gamma Exploit (write), MCP Agent (write)
  Contains:   mission queue, active missions, completed exploits, raw extracted artifacts
  Read by:    Commander, Chain Planner, Critic, Mission Planner

bridge/
  Owner:      Gamma Exploit (write), MCP Agent (write)
  Contains:   raw tokens, cookies, passwords — unvalidated, pending Commander review
  Read by:    Commander, Chain Planner
  Lifecycle:
    1. bridge node written → Commander sets validation_status: "pending"
    2. MCP Agent probes target with the artifact (e.g., test JWT against protected endpoint)
    3. MCP Agent writes probe result back to bridge node
    4. Commander reads probe result:
         → HTTP 200/2xx: promotes to recon/ as confirmed credential
         → HTTP 401/403/timeout: marks validation_status: "expired"
         → HTTP 5xx: marks validation_status: "probe_error", retries once after 30s

intel/
  Owner:      OSINT Agent (write)
  Contains:   payload libraries, CVE details, technique docs, feed data, nuclei templates
  Read by:    Mission Planner, Chain Planner, Gamma, Post-Exploit

lessons/
  Owner:      Critic (write)
  Contains:   lesson nodes (success cases), failed_mission nodes (failure archives)
  Read by:    Gamma, MCP Agent, Mission Planner, Report Agent

events/
  Owner:      ALL agents (append-only write)
  Contains:   swarm event bus — activation triggers, state transitions
  Read by:    ALL agents (each consumes only subscribed event types)


### Cross-Engagement Lessons

At swarm_complete:
1. Report Agent exports all LessonNode from FalkorDB lessons/ → Supabase cross_engagement_lessons
2. Includes tech stack fingerprint for future matching
3. Future engagements query Supabase for matching lessons → preload into FalkorDB intel/

OSINT preloads top 20 matching lessons on engagement start via:
Supabase query: SELECT * FROM cross_engagement_lessons
WHERE stack_fingerprint OVERLAPS current_stack ORDER BY relevance LIMIT 20


***

## 4. OSINT Feed Architecture

### Batch/Static Feeds *(ingest on swarm start, refresh weekly)*

| Feed | Graph Output | Used By |
| :-- | :-- | :-- |
| PayloadsAllTheThings | `intel/payload_library` nodes by vuln class | Gamma, Mission Planner |
| HackTricks | `intel/technique_doc` nodes by attack category | Mission Planner, Chain Planner |
| MITRE ATT\&CK | `intel/tactic` + `intel/technique` taxonomy nodes | Post-Exploit, Chain Planner |
| PortSwigger WSA | `intel/technique_doc` clean reference nodes | Mission Planner, Critic |
| GTFOBins + LOLBAS | `intel/privesc_vector` nodes by binary/env | Post-Exploit |
| Exploit-DB CSV | `intel/poc_available` flags linked to CVE nodes | Mission Planner (priority scoring) |

### Live/Polled Feeds *(check every 6-24 hours)*

| Feed | Graph Output | Used By |
| :-- | :-- | :-- |
| CISA KEV | `vulnerability` nodes flagged `actively_exploited: true` | Commander (raises mission priority to critical) |
| NVD API | CVE→CVSS→affected component enrichment on existing `component` nodes | Mission Planner |
| HackerOne Reports | `intel/attack_pattern` nodes for similar app types | Mission Planner, OSINT enrichment |

### Triggered/Operational Feeds *(activate on specific graph events)*

| Feed | Trigger | Action |
| :-- | :-- | :-- |
| Nuclei Templates | Alpha Recon writes a `component` node | OSINT pulls matching Nuclei templates, writes as `mission` nodes with `status: "pending_verification"` and `executor: gamma`, then emits `mission_queued` event — follows standard Verifier → Commander pipeline, NOT bypassed |
| NVD API (targeted) | Commander emits `enrich` event for a specific CVE | OSINT pulls full CVE detail, CVSS vector, affected versions, links to `vulnerability` node |
| Exploit Briefs | Mission Planner emits `mission_queued` event | OSINT generates an `ExploitBriefNode` with working examples, bypass techniques, and Lesson Archive cross-references (non-blocking) |
| Supplementary Briefs | Critic emits `exploit_failed` event | OSINT researches specific `failure_class` and writes a supplementary brief targeting the exact blocking mechanism |


## 4b. Exploit Brief System

OSINT generates `ExploitBriefNode` objects as pre-execution context for Gamma — giving Gamma a **pre-read cheat sheet** written specifically for the target, not a generic payload list. Brief generation is **non-blocking**: Gamma proceeds without it if unavailable.

### Non-Blocking Flow

```
Mission queued → Verifier checks → mission authorized → enters Gamma queue
                      ↓ (parallel, not blocking)
              OSINT generates brief → writes to intel/
                      ↓
              Gamma claims mission → reads brief IF available
                                   → proceeds without it IF not ready
```

### ExploitBriefNode Schema

```typescript
interface ExploitBriefNode {
  id:             string;        // "intel/brief:mission:sqli-login-003"
  type:           "intel";
  subtype:        "exploit_brief";
  mission_id:     string;        // links directly to the mission it serves
  exploit_type:   string;
  target_component?: string;     // e.g. "express@4.18", "sequelize@6.x"
  
  technique_summary:  string;    // 2-3 sentence plain explanation of the vuln
  working_examples:   {          // concrete payloads pulled from feeds
    source:   string;            // "PayloadsAllTheThings", "HackTricks", "HackerOne"
    payload:  string;
    context:  string;            // when/why this payload works
  }[];
  known_waf_bypasses: string[];  // if WAF detected, relevant bypass techniques
  common_failures:    string[];  // what typically goes wrong for this exploit type
  lesson_refs:        string[];  // matching lesson node IDs from Lesson Archive
                                 // "this same SQLi was tried on a similar target,
                                 //  whitespace bypass worked"
  osint_confidence:   "high" | "medium" | "low";
}
```

The `lesson_refs` field is the key link — OSINT consults the Lesson Archive and surfaces any previously successful pattern that matches the current mission's exploit type + failure class. Gamma gets institutional memory baked into its context before it even starts.

### OSINT Trigger Map for Briefs

```
Trigger: mission_queued
  → OSINT reads mission node
  → Looks up exploit_type in intel/ payload library
  → Looks up target component in intel/ CVE/technique nodes
  → Queries Lesson Archive for matching exploit_type patterns
  → Pulls 2-3 concrete working examples from feeds
  → Writes ExploitBriefNode linked to mission
  → Sets brief_node_id on MissionNode
  → Emits brief_ready event

Trigger: exploit_failed (new, light version)
  → Critic classifies failure_class
  → OSINT specifically researches that failure_class for the exploit type
  → Writes a supplementary brief: "here's how others bypassed this specific block"
  → Gamma gets this before attempt 2 and 3
```

Gamma **queries the Lesson Archive first** on every mission — if a lesson exists with matching `exploit_type` + `failure_class` pattern, it starts from the successful payload rather than baseline.


***

## 5. Agent States and Lifecycle

```
DORMANT   → model not loaded, entry exists only in agent registry
STANDBY   → model loaded, subscribed to event bus, waiting for trigger
ACTIVE    → currently processing a task, consuming tokens
COOLDOWN  → task complete, flushing writes to graph, brief pause before DORMANT/STANDBY
ERROR     → task failed unexpectedly, Commander notified, agent reset to DORMANT
```


### Transition Rules

```
Commander:       DORMANT on init → STANDBY permanently (never goes DORMANT)
Verifier:        DORMANT on init → STANDBY permanently (nano model, cheap)
All others:      DORMANT → STANDBY on matching event → ACTIVE on task claim
                 → COOLDOWN on task complete → DORMANT if queue empty
                 → STANDBY if more tasks queued
```


### Process Management

All agents run as named PM2 processes. DORMANT state = PM2 process exists but is idle in poll loop. ACTIVE state = process is executing an LLM call or tool operation. PM2 handles crash recovery and restart automatically.
```
PM2 ecosystem.config.js declares all agents with:
  - name:   agent identifier (e.g. "gamma-1", "commander")
  - script: "bun"
  - args:   "run agents/{agent}.ts"
  - env:    AGENT_ROLE, INSTANCE_ID, TURSO_URL, TURSO_TOKEN,
            GROQ_API_KEY, CEREBRAS_API_KEY, GOOGLE_AI_KEY,
            NVIDIA_API_KEY, ANTHROPIC_API_KEY

Gamma pool scaling:
  PM2 starts gamma-1 at launch (always available).
  Event loop spawns gamma-2 and gamma-3 via pm2.start() when second/third
  missions become queued and all current Gammas are ACTIVE.
  Pool cap of 3 is enforced by event loop, not PM2.
  Cerebras rate limits (not VRAM) are the practical pool ceiling.

Always-running processes:   commander, verifier, mcp-server
On-demand processes:        all others — started on first event trigger,
                            set to DORMANT poll after task completion

### VRAM Management (RTX 4080, 16GB):
```
Always loaded: Verifier (nemotron-3-nano, ~4GB) + Gamma/Alpha/MCP (qwen2.5:14b, ~10GB)
Peak concurrent: 14GB total → 2GB headroom
Overflow: Gamma pool capped at 1 during Tier 2 execution
          Cloud fallback for Report Agent (2M context)
```


***

## 6. Mission Node Schema

```typescript
interface MissionNode {
  id:               string;         // "mission:sqli-login-003"
  type:             "mission";
  executor:         "gamma" | "mcp";
  exploit_type:     string;         // "sqli", "xss", "idor", "auth_bypass", etc.
  escalation_level: "baseline" | "aggressive" | "evasive";
  priority:         "critical" | "high" | "medium" | "low";
  target_endpoint:  string;         // node ID of the endpoint being targeted
  context_nodes:    string[];       // graph node IDs providing mission context
  credential_nodes: string[];       // valid credential node IDs to use if needed
  chain_id?:        string;         // chain node ID if part of a sequence
  depends_on:       string[];       // mission IDs that must complete first
  status:           "pending_verification" | "queued" | "active" |
                    "completed" | "failed" | "archived";
  authorized:       boolean;        // Commander must set true
  verified:         boolean;        // Verifier must set true
  attempt_count:    number;         // incremented by Critic on retry
  created_by:       "mission_planner" | "chain_planner" | "post_exploit";
  skip_liveness_probe?: boolean;   // true for Post-Exploit missions targeting internal IPs,
                                    // filesystem paths, or non-HTTP resources
  brief_node_id?:   string | null; // OSINT sets when ExploitBriefNode is ready, null if not yet available
  created_at:       number;
}
```


***

## 7. Verifier Pre-Flight Checks

Runs on every mission before `authorized: true` is set. All 6 must pass:

```
1. endpoint_alive       → HTTP probe to target endpoint, expect non-5xx response
                          SKIPPED if mission.skip_liveness_probe === true
                          (set by Post-Exploit for internal IPs, filesystem targets,
                           or non-HTTP resources discovered via SSRF/path traversal)
2. schema_valid         → MissionNode matches schema exactly, all required fields present
3. payload_coherent     → exploit_type matches payload structure
                          (XSS payload in XSS mission, SQLi payload in SQLi mission)
                          catches Mission Planner hallucinations early
4. context_satisfied    → all node IDs in context_nodes and credential_nodes
                          exist in graph with status != "expired"
5. not_duplicate        → no mission with same exploit_type + target_endpoint
                          in status: completed | active | queued
6. scope_compliant      → target_endpoint URL matches TargetConfig.scope patterns
                          AND does NOT match TargetConfig.out_of_scope patterns
                          prevents hallucinated missions against out-of-scope targets
```

Failure response:

```typescript
interface VerifierRejection {
  mission_id:   string;
  failed_check: string;
  reason:       string;
  fixable:      boolean;  // true = Mission Planner can correct and resubmit
                          // false = structural issue, escalate to Commander
}
```


***

## 8. Critic Failure Loop

```
Attempt 1 fails
  → Critic analyses: classifies failure_class, sends corrective feedback to executor
  → Mission replanned with feedback attached, requeued

Attempt 2 fails
  → Critic requests OSINT enrichment: "find documentation for this failure_class"
  → OSINT enriches, mission replanned with enrichment context

Attempt 3 fails
  → Critic writes FailedMissionNode to lessons/ section
  → Mission status set to "archived"
  → Swarm continues — no blocking

Post-swarm (Report Agent phase):
  → Report Agent reads all FailedMissionNodes
  → Classifies as "confirmed_unexploitable", "needs_manual_review", or "likely_patched"
  → Included in final report with full evidence trail
```


### Lesson Node Schema

```typescript
interface LessonNode {
  id:             string;
  type:           "lesson";
  mission_id:     string;
  exploit_type:   string;
  failure_class:  "waf_blocked" | "wrong_endpoint" | "auth_required" |
                  "payload_rejected" | "target_patched" | "wrong_method" |
                  "encoding_needed" | "session_required" | "unknown";
  failed_payloads:  string[];
  successful_payload: string;
  delta:          string;   // exact difference between last failure and success
  reusable:       boolean;  // Commander tags: does this generalize to other missions?
  tags:           string[];  // ["sqli", "waf-bypass", "whitespace-encoding"]
}
```

***

## 9. Chain Planner Activation Patterns

Activates on **any** credential or privileged artifact discovery — not just RCE:


| Trigger | Example Chains Generated |
| :-- | :-- |
| Admin JWT extracted | Access /administration → delete feedback → tamper products → dump users |
| User session cookie | IDOR enumerate other users → basket view → profile data |
| Plain-text password | Login as user → check password reuse → forgot-password flow |
| API key found in JS | Authenticated endpoint scan → privileged data access |
| CSRF token extracted | Forged requests as authenticated user |
| File path discovered | Path traversal variants → sibling file enumeration |
| Internal IP via SSRF | Port scan internal range → access internal services |

The Chain Planner is what separates Solaris from a dumb scanner — every credential discovery fans out into a new attack surface.

***

## 10. MCP Server Tool Map

**Transport:** The MCP server is a Hono application running on Railway, handling HTTP/SSE connections from all agents. Each agent connects as a persistent SSE client. The `AGENT_ROLE` header is set at connection time and persists for the session. Hono middleware enforces the role-to-tool permission matrix before any tool handler executes.

```
http_tools/
  http_request          → all standard HTTP exploit execution
  http_request_raw      → base64 body for XXE, null byte, exact byte control
  http_fuzz             → IDOR enumeration, directory discovery

browser_tools/
  browser_navigate      → Puppeteer with alert capture, token injection
  browser_execute_js    → arbitrary JS in page context
  browser_intercept     → capture/modify requests mid-flight (CSRF, token theft)

osint_tools/
  extract_exif          → exiftool on downloaded image
  vision_analyze        → multimodal LLM call (Claude Haiku) on image
  scrape_js_bundle      → pattern match main/runtime/vendor.js for secrets

file_tools/
  upload_file           → multipart upload with type/size bypass options
  download_artifact     → fetch and store discovered files to artifact nodes

codebase_tools/
  index_repository    → index repo_path for SAST intelligence (Alpha Recon only)
  search_graph        → structural search: functions, routes, hotspots
  trace_call_path     → call graph traversal (Alpha Recon only)
  get_architecture    → languages, packages, entry points, routes (Alpha Recon only)

graph_tools/
  graph_add_node        → typed node creation
  graph_add_edge        → named relationship creation
  graph_traverse        → BFS from node ID, configurable depth
  graph_query           → filter nodes by type + properties
  graph_context_for     → 2-hop neighborhood as agent-readable string
  graph_get_missions    → unblocked, authorized, verified missions for executor type

event_tools/
  event_emit            → write to event bus
  event_consume         → read unconsumed events for this agent's subscriptions

state_tools/
  state_get_token       → retrieve valid credential by email/role
  state_mark_completed  → mark mission/challenge complete
```

Agent role-scoped visibility enforced via `AGENT_ROLE` env var — Gamma never sees `vision_analyze`, OSINT never sees `http_fuzz`.

**MCP Tool Permission Enforcement:**
```
The MCP server maintains a role-to-tools permission matrix:

  gamma:     [http_request, http_request_raw, http_fuzz, graph_add_node,
              graph_add_edge, graph_traverse, graph_query, graph_context_for,
              graph_get_missions, event_emit, event_consume, state_mark_completed]

  mcp:       [http_request, http_request_raw, browser_navigate, browser_execute_js,
              browser_intercept, graph_add_node, graph_add_edge, graph_traverse,
              graph_query, graph_context_for, graph_get_missions, event_emit,
              event_consume, state_get_token, state_mark_completed]

  alpha:     [http_request, http_fuzz, graph_add_node, graph_add_edge, graph_traverse,
               graph_query, event_emit, event_consume,
               codebase_memory/index_repository, codebase_memory/search_graph,
               codebase_memory/trace_call_path, codebase_memory/get_architecture]

  osint:     [extract_exif, vision_analyze, scrape_js_bundle, download_artifact,
              graph_add_node, graph_traverse, graph_query, event_emit, event_consume]

  commander: [graph_add_node, graph_add_edge, graph_traverse, graph_query,
              graph_context_for, event_emit, event_consume, state_mark_completed]

  verifier:  [graph_query, graph_context_for, event_emit, event_consume]

  post_exploit: [http_request, http_request_raw, browser_navigate, browser_execute_js,
                 graph_add_node, graph_traverse, graph_query, event_emit, event_consume,
                 state_get_token]

On every MCP request:
  1. Server reads AGENT_ROLE from request headers
  2. Server looks up allowed tool list for that role
  3. If requested tool not in allowed list → returns error: "Tool not available for role: {role}"
  4. No tool name fallback, no partial matching — explicit whitelist only
  5. The MCP server has a single route table; all agents connect to same server
     but see different tool subsets based on role

This prevents a hallucinating Gamma from calling vision_analyze, or an OSINT agent
from directly issuing HTTP exploit requests.
```

***

## 11. Event Bus

SQLite-backed, append-only. Agents subscribe to event types, not specific emitters.

**Polling Intervals (explicit per agent tier):**
```
Commander (STANDBY):     500ms  — must react quickly to finding_written events
Verifier (STANDBY):      500ms  — must react quickly to mission_queued events
Mission Planner:         1000ms — batches findings, slight delay acceptable
Chain Planner:           1000ms — activated on credential events, not time-critical
Critic:                   1000ms — activated on exploit_failed, retry loop non-urgent
Gamma (ACTIVE):          2000ms — in execution; polls for brief_ready and abort signals only
OSINT:                   2000ms — background enrichment, latency-tolerant
Alpha Recon:              5000ms — scheduled scan intervals dominate, event poll is secondary
Report Agent:             N/A    — runs exactly once on swarm_complete, no poll loop
```
All polling uses `setInterval` within each agent's main process loop.
Poll queries are lightweight: `SELECT id FROM events WHERE consumed=false AND type IN (?) LIMIT 20`.
All event reads are wrapped in a transaction to prevent double-consumption across Gamma instances.

**At-Least-Once Delivery Guarantee:**
```
Event lifecycle:
  1. Agent calls event_emit() → event written with status: "pending", consumed: false
  2. Consumer agent calls event_consume() → reads pending events for its subscriptions
  3. Consumer writes its graph output (node creation, status update, etc.)
  4. Consumer marks event as consumed: consumed: true, consumed_by: agent_id, consumed_at: timestamp

Crash recovery:
  If consumer crashes after consuming but before marking consumed:
    → Event remains consumed: false
    → Heartbeat monitor (runs every 30s) detects consumer in ERROR state
    → Events owned by that consumer are re-marked: consumed: false
    → Re-queued for another available agent of the same type, or
      if no agent available, left for the original consumer to pick up on restart

If consumer crashes before writing graph output:
  → No event state change occurs (event was never marked consumed)
  → Consumer's own writes (if any partial) are rolled back via SQLite transaction
  → Event is re-delivered on next consume call

Timeout behavior:
  Events with status: "pending" and created_at > 600s ago are marked "orphaned"
  and logged. If the originating agent is still ACTIVE, the event is kept.
  If the agent is ERROR/DORMANT, the event is dropped and an error is logged.
```

```typescript
type SwarmEventType =
  | "finding_written"       // Alpha/OSINT → Commander wakes
  | "finding_validated"     // Commander → Mission Planner wakes
  | "credential_found"      // Gamma/MCP → Chain Planner wakes
  | "credential_promoted"   // Commander → Chain Planner + Mission Planner wake
  | "mission_queued"        // Mission Planner → Verifier + OSINT wake (parallel)
  | "mission_verified"      // Verifier → Commander wakes (strategic review)
  | "mission_authorized"    // Commander → Gamma/MCP wake
  | "exploit_completed"     // Gamma/MCP → Commander + Chain Planner wake
  | "exploit_failed"        // Gamma/MCP → Critic wakes
  | "enrichment_requested"  // Commander → OSINT wakes
  | "rce_confirmed"         // Gamma/MCP → Post-Exploit wakes
  | "swarm_complete"        // Commander → Report Agent wakes
  | "brief_ready"           // OSINT → Gamma wake (brief available)
  | "waf_duel_started"      // Critic → OSINT + Mission Planner wake (WAF Duel triggered)
  | "waf_duel_complete"      // OSINT + Mission Planner → Commander wake (bypass candidates ready)
  | "handoff_requested"     // Gamma → Commander wake (context budget exceeded)
  | "specialist_activated"  // Commander → specialist Gamma variant wakes
  | "specialist_complete"   // specialist Gamma → Commander wakes
  | "belief_updated"        // Commander → Mission Planner wake (p_exploitable changed)
```


***

## 12. Infrastructure Stack

```
Runtime:        Bun (TypeScript, all agents + MCP server)
MCP Protocol:   @modelcontextprotocol/sdk
Graph DB:       FalkorDB on Railway (Cypher queries, per-run memory)
Relational DB:  Supabase (persistent engagements, lessons, reports, auth)
Event Bus:      SQLite (better-sqlite3, local per-run, append-only)
Browser:        Puppeteer (MCP Agent)
LLM Routing (hybrid local/cloud):
  Local (Ollama, RTX 4080): always-on + high-frequency agents
    Verifier:           nemotron-3-nano (4B MoE) — sub-second structural checks
    Gamma + Alpha Recon: qwen2.5:14b-instruct — execution-heavy, rate-limit burner
    MCP Agent:          qwen2.5:14b-instruct — browser flows
    Critic:             nemotron-3-nano — failure classification
  Cloud (Tier 3+ reasoning, low-frequency):
    Commander:          Nemotron-3-super (NVIDIA API)
    Mission Planner:    Gemini 2.0 Flash (Google, free tier, 1M context)
    Chain Planner:      Gemini 2.0 Flash (Google, free tier, 1M context)
    OSINT:              Gemini 2.0 Flash (Google, free tier, 1M context)
    Post-Exploit:       Claude Sonnet (Anthropic, paid)
    Report Agent:       Gemini 1.5 Pro (Google, free tier, 2M context)
  Fallback chain:       Groq/Cerebras 429 → OpenRouter paid → Anthropic API

LLM Rate Limiting:
  LLMRouter module (shared Bun module):
    - Tracks requests-per-minute per provider
    - Queues/retries on 429 (base 1s, max 30s)
    - Automatic fallback routing
    - All agents call LLMRouter.complete() — no direct provider APIs

Model Tier Map (RTX 4080 optimized):
  Tier 1 (Nano, 4GB):   nemotron-3-nano (Ollama) → Verifier, Critic
  Tier 2 (Mid, 10GB):   qwen2.5:14b-instruct (Ollama) → Gamma, Alpha Recon, MCP Agent
  Always-on (14GB total): Tier 1 + Tier 2 → fits 4080 with 2GB headroom

  Tier 3 (Reasoning):   Nemotron-3-super (NVIDIA API) → Commander
  Tier 4 (Planning):    Gemini 2.0 Flash (Google) → Mission Planner, Chain Planner, OSINT
  Tier 5 (Output):      Claude Sonnet (Anthropic) → Post-Exploit
                        Gemini 1.5 Pro (Google) → Report Agent

Code Intelligence: codebase-memory-mcp (repo_path indexing for Alpha Recon)
```


***

## 13. Swarm Execution Flow

```
INIT
  Load TargetConfig → write target node to graph
  PM2 starts Commander (STANDBY) + Verifier (STANDBY) + MCP server (Hono)
  OSINT ingests batch feeds → writes intel/ section
  Alpha Recon activates → scans target → writes recon/ section
  Commander validates findings → emits finding_validated events

RECON PHASE
  Mission Planner activates → consumes finding batch
  Generates prioritized mission queue → Verifier checks each
  Authorized missions enter gamma/ queue

EXPLOITATION PHASE
  Gamma pool (1-3) + MCP Agent consume missions by executor type
  On credential found → Chain Planner wakes → fans out new missions
  On failure → Critic wakes → feedback loop (max 3 attempts)
  On RCE/file-read → Post-Exploit wakes → generates priv-esc missions
  Recon continues in background on interval
  OSINT enriches on Commander events

WIND-DOWN
  Drain condition (all must be true simultaneously):
    - Mission queue empty (no missions in status: queued | active | pending_verification)
    - Alpha Recon is DORMANT (no pending scan intervals)
    - Chain Planner is DORMANT (no unconsumed credential_promoted events pending)
    - OSINT is DORMANT (no in-progress enrichment tasks)
    - No unconsumed finding_validated events in the event bus
  If all conditions met → Commander emits swarm_complete
  Report Agent activates → traverses full graph
  Generates final report with all findings, chains, failures, lessons

  Race condition prevention:
    Recon writes to graph can trigger Chain Planner mid-wind-down.
    Chain Planner missions entering queue reset the drain condition.
    Commander re-evaluates drain condition on every finding_validated,
    mission_queued, and every 60s heartbeat from active agents.

  - Clear FalkorDB graph (archive JSON to Supabase run_reports)
  - Clear local SQLite event bus
  - Engagement record written to Supabase engagements

POST-SWARM
  Failed missions re-analysed with full graph context
  Lesson Archive consulted for patterns across all failures
  Report finalized
```


***

## 14. Advanced Research Features

The following features go beyond the current published literature on LLM-based pentest swarms. They are optional extensions to the core swarm — each can be enabled or disabled independently per engagement via `TargetConfig.flags`.

---

### 14a. Probabilistic Belief State (POMDP Layer for Commander)

**Problem:** Commander holds a binary view of each endpoint — "vulnerable" or "not yet tested." This causes the swarm to waste missions on endpoints that have accumulated strong evidence of protection (WAF, auth, rate limiting), and under-test endpoints with high uncertainty.

**Solution:** Commander maintains a probability distribution over each `(endpoint, vuln_class)` pair:

```typescript
interface TargetBeliefNode {
  id:             string;   // "belief:endpoint:login:sql_injection"
  endpoint_id:    string;
  vuln_class:    string;   // "sql_injection", "xss", "auth_bypass"
  p_vulnerable:   number;   // 0.0–1.0, updated on every Gamma probe result
  p_protected:   number;   // WAF / auth / rate-limit probability
  p_exploitable: number;   // p_vulnerable × (1 - p_protected)
  evidence_log:   BeliefUpdate[];
  last_updated:  number;
}

interface BeliefUpdate {
  timestamp:    number;
  mission_id:   string;
  action:      "probe" | "exploit_success" | "exploit_fail" | "waf_block" | "auth_block";
  response:    string;   // HTTP status + snippet
  delta_p_v:   number;   // Bayesian update to p_vulnerable
  delta_p_p:   number;   // Bayesian update to p_protected
}
```

**Update rule (per Gamma result):**
```
exploit_success  → p_vulnerable += 0.4, cap at 0.99
exploit_fail     → p_vulnerable -= 0.1, floor at 0.01
waf_block        → p_protected += 0.3, cap at 0.95
auth_block       → p_protected += 0.5, cap at 0.99
rate_limit       → p_protected += 0.2
```

**Priority override:** Commander uses `p_exploitable` as the primary priority signal for mission scheduling. Missions targeting high-`p_exploitable` endpoints are promoted above static CVSS-ranked missions when the queue is long. Endpoints with `p_protected > 0.8` are deprioritized automatically — the swarm stops wasting attempts on protected surface.

**Novelty:** No published LLM web pentest swarm maintains a probabilistic belief state. Research (EPPTA, CHECKMATE) applies POMDPs to network pentest RL agents; this applies the formalism to web application exploitation via a simple Bayesian layer in Commander.

---

### 14b. Adversarial Self-Play for WAF Bypass (Intra-Engagement Curriculum)

**Problem:** When Critic classifies a failure as `waf_blocked` after attempt 3, the mission is archived and the WAF-specific failure mode is lost. The swarm doesn't learn from the WAF — it just gives up.

**Solution — WAF Duel Sub-Loop:**

Triggered when a mission is archived with `failure_class: "waf_blocked"` and `TargetConfig.flags.adversarial_self_play === true`:

```
WAF Duel ( Critic + OSINT协同):
  Step 1 — Defender Model (OSINT, LLM call):
    Input: all Gamma responses from this endpoint that contained WAF block patterns
    Output: "WAF inference: this WAF appears to block [keyword_match | encoding | header_pattern | size_limit]
            Specific rule signal: [extracted pattern]"

  Step 2 — Attacker Generation (Mission Planner, LLM call):
    Input: Defender's WAF model + Lesson Archive (all lessons tagged waf_bypass)
    Output: 3 bypass variant missions, each with:
      - evasion_level: "evasive"
      - bypass_hypothesis: "why this variant should bypass"
      - modified payload with delta from blocked payload

  Step 3 — Execution:
    Each bypass variant runs through Verifier → Commander (no bypass of gates)
    If bypass succeeds → write LessonNode:
      failure_class: "waf_blocked"
      waf_model: "{Defender's inferred rule}"
      bypass_delta: "{what was changed}"
      reusable: true
    If all 3 fail → FailedMissionNode gets waf_model attached as evidence for Report Agent
```

**Lesson Archive enrichment:** The reusable `waf_bypass` lessons written by successful WAF Duels accumulate across engagements. The Defender model benefits from every engagement the swarm runs — it gets progressively better at inferring WAF rules from block responses.

**Novelty:** No existing web pentest LLM system has a structured adversarial loop that explicitly models the defender before generating bypass attempts. HPTSA uses parallel specialist agents but doesn't model the WAF. Active Attacks does adversarial fine-tuning but not within a live engagement loop.

---

### 14c. Context Relay Protocol Between Gamma Instances (CHAP-Inspired)

**Problem:** When a Gamma instance works on a multi-step exploit (browser flow, chained SQLi, CSRF with session state), its context window fills over time. Currently the mission fails or the agent hallucinates continuation. No mechanism exists for checkpointing and handing off mid-exploit state.

**Solution — Structured Handoff Node:**

```typescript
interface GammaHandoffNode {
  id:              string;   // "handoff:mission:sqli-login-003:attempt-2:gamma-1"
  mission_id:      string;
  from_instance:   string;   // "gamma-1"
  to_instance:     string;   // "gamma-2" (null if re-queued to pool)

  hypothesis:      string;   // "Login form is vulnerable to time-based SQLi via username param"
  confirmed_facts: string[]; // ["POST /api/login", "username param reflected in error message"]
  failed_payloads: {          // what was tried and what came back
    payload: string;
    response_snippet: string;
    waf_triggered: boolean;
  }[];
  next_action:     string;   // "try: ' OR SLEEP(5)-- with Content-Type: application/json"
  context_budget:  number;   // estimated tokens consumed (~3500 per mid-exploit Gamma)

  written_at:      number;   // Unix timestamp
  consumed_at?:    number;   // set when next instance reads it
}
```

**Handoff trigger:** Commander monitors `context_budget` via Gamma heartbeat events. When `context_budget > 3000 tokens`, Commander triggers a handoff rather than waiting for context overflow. The active Gamma writes a HandoffNode, its mission is re-queued, and the next available Gamma reads the HandoffNode as its starting context.

**Guarantee:** HandoffNode is written atomically with the Gamma's final status update in the same transaction. No state is lost between instances.

**Novelty:** CHAP addresses context handoff for network pentest agents. This applies structured handoff to web exploit Gamma instances — which is harder because HTTP session state, cookies, and browser context must all be transferred explicitly. No existing web pentest swarm has this.

---

### 14d. Cross-Engagement Persistent Memory with Tech Stack Matching

**Problem:** The Lesson Archive is scoped to a single engagement run. Lessons learned on an Express/JSQLite target aren't available when testing a Django/MySQL target — even if the vulnerability class and auth mechanism are similar.

**Solution — Persistent Cross-Engagement Store:**

```typescript
interface CrossEngagementLesson extends LessonNode {
  // All existing LessonNode fields...

  // Tech stack fingerprint of the engagement where this was learned
  stack_fingerprint: {
    framework:   string[];   // ["express", "sequelize"]
    auth_type:   string;     // "jwt" | "session" | "oauth2" | "api_key"
    db_hints:    string[];   // ["sqlite", "mysql", "postgres"]
    server:      string;     // "nginx" | "apache" | "iis"
  };
  engagement_id:  string;   // "swarm-2024-10-15-juiceshop"
  target_class:   string;   // "ecommerce" | "cms" | "api-gateway" | "unknown"
  lesson_id:     string;   // original LessonNode.id
}
```

**Pre-Engagement Bootstrap (Alpha Recon init flow):**
```
Alpha Recon fingerprints tech stack
  → Commander classifies target_class
  → OSINT queries cross-engagement store:
      "SELECT * FROM cross_engagement_lessons
       WHERE stack_fingerprint OVERLAPS with current_stack
       ORDER BY relevance_score DESC LIMIT 20"
  → Top 20 matching lessons pre-loaded into intel/ section
  → Gamma reads them before attempting first exploit
```

**Stack overlap query:** Uses simple keyword overlap scoring — lessons with higher overlap on `framework + auth_type + db_hints` rank higher. No embedding model required for matching; embeddings are used only for novelty scoring (Section 14e).

**Persistence:** Cross-engagement lessons are stored in Turso and never deleted unless manually expunged. They accumulate across all engagements the swarm has run, building institutional memory.

**Novelty:** Co-RedTeam does within-engagement memory reuse. Cross-engagement tech-stack-keyed memory is not in any published system. Burp, Nuclei, XBOW — none accumulate structured exploit memory keyed to tech fingerprints for pre-seeding future engagements.

---

### 14e. Semantic Novelty Scoring in Mission Prioritization

**Problem:** The static priority formula `(CVSS × 2) + (KEV × 10) + (PoC × 5) + type_weight` will cause the swarm to spam RCE/SSRF missions and underexplore other attack surface. Pure reward maximization collapses to a few high-confidence modes — documented failure in autonomous red-teaming literature.

**Solution — Novelty Component in Mission Planner:**

```typescript
interface MissionNovelty {
  mission_id:        string;
  embedding:         number[];  // Gemini text-embedding-002 of mission description
  max_similarity:    number;    // max cosine similarity to all completed/failed missions
  novelty_score:    number;    // 1 - max_similarity (higher = more novel)
  embedding_model:  "gemini-embedding-002";
  embedded_at:      number;
}
```

**Novelty-weighted priority formula:**
```
novelty_score = 1 - max_cosine_similarity(new_mission.embedding, [completed_missions.embeddings])

final_priority = static_score + (novelty_score × novelty_weight)

novelty_weight:
  queue_depth < 5  → novelty_weight = 3   (explore aggressively)
  queue_depth ≥ 5   → novelty_weight = 1   (exploit what's queued)
```

**Implementation:** Mission Planner generates a 1-sentence mission description at planning time, calls Gemini embedding API, stores the embedding on the MissionNode. Embedding computation is cheap (~50ms) and happens at planning time, not at Gamma execution time.

**Effect:** When the queue is empty, the swarm picks the most semantically novel untested attack vector. When the queue is full, it prioritizes high-CVSS已知 vulnerabilities. The swarm balances exploration and exploitation without requiring a separate diversity reward signal.

**Novelty:** AutoRedTeamer uses cosine distance for memory selection. Applied to mission scheduling (not just attack selection) within an LLM swarm is not in any published system.

---

### 14f. Causal Failure Attribution (Beyond Classification)

**Problem:** Critic classifies failures into `failure_class` categories, but classification only tells you *what* failed — not *why*. The bypass hypothesis that Critic generates for retry is vague ("try a different payload"). This causes retry missions to be random rather than targeted.

**Solution — Structured Causal Attribution in Critic:**

After classifying `failure_class`, Critic runs a causal attribution pass:

```typescript
interface CausalChain {
  mission_id:       string;
  failure_class:   string;
  attributed_to:    AttributionDimension;
  evidence:        string;     // exact text from response that led to this attribution
  bypass_hypothesis: string;  // specific change to try, grounded in the cause
  confidence:      "high" | "medium" | "low";
}

type AttributionDimension =
  | "keyword_match"    // specific word in payload (SELECT, UNION, <script>)
  | "encoding_mismatch" // URL-encoded vs raw, UTF-8 vs GB2312
  | "header_anomaly"   // Content-Type, User-Agent, Origin triggered block
  | "rate_trigger"     // rapid prior requests triggered rate-based block
  | "size_trigger"     // payload size exceeded threshold
  | "session_mismatch" // cookie/session state inconsistent with request
  | "waf_signature"   // no specific signal identified, pattern matched generically
  | "unknown";
```

**Attribution rules:**
```
waf_block + response contains "SQL keyword detected" → keyword_match
waf_block + response contains "encoding"             → encoding_mismatch
waf_block + response contains "Origin"              → header_anomaly (CORS)
waf_block + prior attempts > 10 in 60s             → rate_trigger
waf_block + payload.length > 2000                   → size_trigger
waf_block + no specific pattern identifiable        → waf_signature
auth_required + no cookie in request                → session_mismatch
```

**Bypass hypothesis written to mission payload field:**
The `bypass_hypothesis` is written directly into the retry mission's payload context — Gamma doesn't have to infer what to try next. Example:
```
Original payload: "admin' OR 1=1--"
Blocked: "SQL keyword detected"
Attribution: keyword_match
Bypass hypothesis: "Try whitespace substitution: admin'/**/OR/**/1=1--"
```

**Novelty:** Causal reasoning applied to WAF evasion domain is novel. The general causal AI literature (Pearl, DoWhy) is established; applying structured causal attribution to penetration testing failure analysis is a domain application that research calls for but hasn't delivered.

---

### 14g. Dynamic Specialist Agent Spawning on Surface Discovery

**Problem:** The current agent roster is fixed at launch. When Alpha Recon discovers a novel attack surface (GraphQL, WebSocket, OAuth flow), the general-purpose Gamma/MCP agents attempt it with generic payloads. A specialist seeded with domain-specific context would be significantly more effective.

**Solution — Dynamic Specialist Mini-Agents:**

When Alpha Recon writes a `component` node with a recognized surface type, Commander spawns a short-lived specialist:

```typescript
interface SpecialistConfig {
  id:              string;   // "specialist:graphql:gamma-1"
  surface_type:    SpecialistType;
  parent_mission:  string;   // the mission that triggered specialist activation
  system_prompt:   string;   // specialist seed — see table below
  mission_template: MissionNode; // pre-defined mission skeleton for this surface type
  spawn_condition: string;   // graph event that triggered this
  despawn_trigger: string;   // "surface exhausted" or "all missions in template completed"
  created_at:      number;
}

type SpecialistType =
  | "graphql"    | "websocket"  | "jwt"       | "upload"
  | "oauth"      | "saml"      | "redis"     | "smtp";
```

**Specialist Surface Map:**

| Discovery Trigger | Specialist | System Prompt Seed | Pre-Loaded Missions |
|---|---|---|---|
| `/graphql` endpoint found | GraphQL Specialist | "You are a GraphQL security expert. Focus on introspection enumeration, batching attacks, alias-based auth bypass, and query complexity attacks." | Introspection dump → field enum → query batching → alias injection |
| WebSocket upgrade found | WebSocket Specialist | "You are a WebSocket security expert. Focus on CSWSH, origin validation, message injection, and stateful abuse." | CSWSH test → origin bypass → message injection |
| JWT in response | JWT Specialist | "You are a JWT security expert. Focus on alg:none, weak secret brute, kid injection, jku/x5u tampering." | alg:none → weak secret → kid injection → claim tampering |
| File upload endpoint | Upload Specialist | "You are a file upload security expert. Focus on MIME bypass, path traversal in filename, polyglot payloads." | MIME type bypass → filename traversal → polyglot |
| OAuth flow discovered | OAuth Specialist | "You are an OAuth 2.0 security expert. Focus on redirect_uri manipulation, state parameter forgery, code interception." | redirect_uri bypass → state forgery → code replay |

**Spawn flow:**
```
Alpha Recon writes component node with known surface_type
  → Commander recognizes surface_type match in SpecialistSurfaceMap
  → Commander creates SpecialistConfig node in graph
  → Commander starts specialist Gamma variant:
      pm2.start({ name: "specialist-{type}-{id}", script: "bun", args: "run agents/specialist.ts", env: { SPECIALIST_CONFIG: specialist_id } })
  → Specialist reads its SpecialistConfig, executes mission template
  → On completion or surface exhaustion → specialist writes FinalReportNode → despawns
```

**Specialist is not a new agent type in the roster** — it is a Gamma variant with a specialized system prompt and pre-seeded mission template. It uses the same `gamma` executor tools, the same `graph/` sections, and the same event bus. Commander owns the lifecycle.

**Novelty:** AutoAgents (2024) identifies dynamic agent generation as an open research problem. HPTSA has fixed specialist agents (SQLi agent, XSS agent) but they're not dynamically spawned based on surface discovery. Burp has specialist scanners but they're static and rule-based. Dynamic surface-type → specialist activation in an LLM swarm is not in any published system.

---

### Feature Dependency Graph

```
14a Belief State         → informs: 14e Novelty Scoring, 14b WAF Duel trigger
14b WAF Duel            → feeds:   14d Cross-Engagement Lessons (waf_bypass tag)
14c Context Relay       → enables:  long-running multi-step Gamma exploits
14d Cross-Engagement    → feeds:   14b WAF Duel (bypass candidates), 14a Belief priors
14e Novelty Scoring     → balances: 14a Belief (high-p_exploitable vs novel targets)
14f Causal Attribution  → feeds:   14b WAF Duel (bypass_hypothesis per attempt)
14g Specialist Spawning → triggers: surface-specific 14a/14e/14f behavior
```

