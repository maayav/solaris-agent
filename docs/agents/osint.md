# OSINT Agent Specification

**Agent:** OSINT Agent
**Type:** `osint`
**Tier:** Tier 5 (Cloud)
**Model:** `llama-3.1-8b` (Cerebras primary) → `qwen-3-235b-a22b-instruct-2507` (Cerebras fallback)
**Temperature:** 0.65
**Poll Interval:** 2000ms

---

## 1. Identity & Role

OSINT is the **intelligence and enrichment engine** of the Solaris swarm. It collects external intelligence (CVEs, payloads, techniques), generates ExploitBriefs for missions, enriches findings with context, and researches failure patterns when Critic requests it.

**OSINT DOES:**
- Ingest batch feeds on swarm start (PayloadsAllTheThings, HackTricks, MITRE ATT&CK, Exploit-DB)
- Poll live feeds on schedule (CISA KEV, NVD API, HackerOne)
- Generate ExploitBriefNode for queued missions (pre-execution cheat sheet)
- Enrich specific targets on Commander's request (enrichment_requested)
- Research failure patterns when Critic requests supplementary briefs
- Write CVE details, payload libraries, technique docs to intel/ section

**OSINT DOES NOT:**
- Execute exploits (Gamma's job)
- Scan targets (Alpha's job)
- Authorize missions (Commander's job)
- Generate missions (Mission Planner's job)

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
OSINT: DORMANT on init → STANDBY on enrichment_requested, feed refresh, or mission_queued
       STANDBY → ACTIVE on task claim
       ACTIVE → COOLDOWN on task complete
       COOLDOWN → STANDBY if more enrichment tasks pending
       COOLDOWN → DORMANT if queue empty
       Any → ERROR on unexpected failure → reset after 30s backoff
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/osint.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: enrichment_requested, exploit_failed, mission_queued, brief_ready)
4. Set state: DORMANT
5. Load cross-engagement lessons from Supabase (matching current tech stack)
6. Begin feed ingestion:
   → Batch feeds (on start): PayloadsAllTheThings, HackTricks, MITRE ATT&CK, GTFOBins, Exploit-DB
   → Write all to intel/ section
7. Begin feed polling schedule (CISA KEV: every 6h, NVD: every 24h, HackerOne: every 24h)
8. Set state: STANDBY
9. Begin poll loop at 2000ms interval
```

### Task Priority (when multiple triggers fire simultaneously)

```
1. enrichment_requested     (Commander's direct enrichment — highest priority)
2. exploit_failed brief      (Critic's supplementary brief — targets specific block)
3. mission_queued brief      (proactive brief for queued mission — lower priority)
4. feed_refresh             (lowest — runs in background, non-blocking)
```

### Batch Processing

When 20+ `mission_queued` events fire simultaneously:
```
1. OSINT reads all 20 mission nodes from graph in one batch query
2. Generates briefs for all 20 missions
3. Writes all ExploitBriefNodes in one batch
4. Emits brief_ready for each
```

Priority within batch: missions already `active` > missions still `queued`

### Shutdown Sequence

```
1. Flush any pending feed updates to graph
2. Mark feed polling state (last check timestamps)
3. Close FalkorDB connection
4. Close EventBus connection
5. Exit cleanly
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `enrichment_requested` | `{target_id, enrichment_type: "cve"\|"technique"\|"exploitdb"\|"osint", reason, priority}` | Commander emits for specific target |
| `exploit_failed` | `{mission_id, failure_class, exploit_type, target_id}` | Gamma/MCP emit after failure |
| `mission_queued` | `{mission_id, exploit_type, target_endpoint}` | Mission Planner emits |
| `brief_ready` | `{mission_id, brief_node_id}` | (OSINT emits this itself — for tracing) |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `finding_written` | `{target_id, finding_type: "osint"\|"cve"\|"technique", vuln_class, evidence: {source, data}, source: "osint"}` | CVE or technique finding written |
| `brief_ready` | `{mission_id, brief_node_id}` | ExploitBriefNode written and linked to mission |
| `enrichment_complete` | `{target_id, enrichment_type, nodes_written: number}` | Enrichment task complete |

### Collaboration Sequences

**Enrichment Request Flow:**
```
Commander emits enrichment_requested
  → OSINT reads target and enrichment_type
  → OSINT queries external source (NVD API, Exploit-DB, etc.)
  → OSINT writes IntelNode to graph (intel/ section)
  → OSINT emits finding_written with enrichment data
  → OSINT emits enrichment_complete
```

**ExploitBrief Generation Flow:**
```
Mission Planner emits mission_queued
  → OSINT reads mission node from graph
  → OSINT queries exploit_type in intel/ payload library
  → OSINT queries target component in intel/ CVE/technique nodes
  → OSINT queries Lesson Archive for matching patterns
  → OSINT pulls 2-3 working examples from feeds
  → OSINT writes ExploitBriefNode to graph (intel/ section)
  → OSINT updates MissionNode.brief_node_id
  → OSINT emits brief_ready → Gamma wakes if waiting
```

**Failure Enrichment Flow:**
```
Critic (via exploit_failed event) triggers OSINT
  → OSINT reads failure_class and exploit_type
  → OSINT researches that specific failure pattern
  → OSINT writes supplementary brief: "here's how others bypassed this specific block"
  → Gamma receives supplementary brief before attempts 2 and 3
```

---

## 4. Memory Schema

### Section Prefix

OSINT writes to **intel/** section exclusively.

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `MissionNode` | `id, exploit_type, target_endpoint, brief_node_id, context_nodes` |
| `ComponentNode` | `id, name, version, fingerprint` |
| `LessonNode` | `exploit_type, failure_class, successful_payload, delta, tags` |
| `CrossEngagementLesson` | `stack_fingerprint, exploit_type, failure_class, successful_payload` (from Supabase) |
| `TargetNode` | `id, tech_stack` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `IntelNode` | `{id, type:"intel", subtype: "payload_library"\|"technique_doc"\|"cve_detail"\|"exploit_brief"\|"tactic"\|"technique"\|"privesc_vector"\|"attack_pattern", name, data, linked_vuln_class, source, created_at, updated_at}` | Feed ingestion |
| `ExploitBriefNode` | `{id, type:"intel", subtype:"exploit_brief", mission_id, exploit_type, target_component, technique_summary, working_examples: [{source, payload, context}], known_waf_bypasses, common_failures, lesson_refs: string[], osint_confidence: "high"\|"medium"\|"low", created_at}` | Mission brief generation |
| `VulnerabilityNode` | `{id, type:"vulnerability", vuln_class, cve, cvss_score, cvss_vector, cisa_kev, exploitdb_poc, created_at}` | CVE ingestion |

### Edges Created

| Edge | From → To | Trigger |
|------|-----------|---------|
| `:ENRICHES` | IntelNode → VulnerabilityNode | CVE detail linked to vuln |
| `:ENRICHES` | IntelNode → EndpointNode | Payload library linked to endpoint |
| `:REFERENCE` | ExploitBriefNode → LessonNode | Lesson refs from archive |

### Lifecycle

- **IntelNode**: Created on feed ingestion, updated on new data (daily refresh)
- **ExploitBriefNode**: Created on mission_queued, immutable once written
- **VulnerabilityNode**: Created on CVE ingestion, updated if CVSS changes

---

## 5. Tool Usage

### Can Use

| Tool | Description | Expected Output | Timeout |
|------|-------------|-----------------|---------|
| `curl` | Targeted scraping of public data, CVE APIs | stdout: API response | 15s |
| `wget` | Download exploit files, exploit-db archives | stdout: download status | 30s |
| `searchsploit` | Exploit-DB local search | stdout: exploit results | 30s |

### Cannot Use

| Tool | Reason |
|------|--------|
| All recon tools (nmap, masscan, etc.) | Not Alpha's job |
| All exploitation tools (sqlmap, john, etc.) | Not Gamma's job |
| All browser tools | Not MCP's job |

### How OSINT Uses Tools

OSINT primarily uses **LLM reasoning + external API calls** rather than CLI tools:

```
THOUGHT: What enrichment does this target need?
  - What CVE IDs are relevant to its tech stack?
  - What exploit types are likely for this component?
  - What payload patterns work for this vulnerability class?

ACTION: Call external API (NVD, HackerOne, Exploit-DB)
  - NVD API: fetch CVE details by ID or component
  - HackerOne: search similar reports
  - Exploit-DB: search PoC by CVE

OBSERVATION: Parse API response
  - Extract relevant CVE details
  - Extract working PoC if available
  - Extract bypass techniques if documented

WRITE: Write IntelNode to graph
  - CVE details → VulnerabilityNode
  - Payload patterns → IntelNode (payload_library)
  - Exploit notes → ExploitBriefNode
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/osint.md
2. Load current intel/ state:
   - All IntelNodes by subtype
   - Recent CVE updates
   - ExploitBriefs already generated
3. Load target context (if enrichment_requested):
   - Target tech stack
   - Specific enrichment type needed
4. Load lesson archive (cross-engagement + current session)
5. Compose final prompt
```

### Context Budget

- **Estimated tokens per enrichment task:** ~600–1200
- **Context budget per task:** ~2000 tokens
- **Overflow behavior:**
  ```
  If enrichment is complex (> 2000 tokens context):
    → Split into multiple IntelNode writes
    → Process in priority order
    → Log partial completion
  ```

### Session State

What persists across enrichment iterations:
- `pending_enrichments`: Queue of enrichment tasks
- `feed_state`: Last refresh timestamps for each feed
- `generated_briefs`: Set of mission_ids with briefs already generated

What is re-read from graph each task:
- Target node (for tech stack)
- Current intel/ state (to avoid duplicates)
- Mission node (for brief generation)

---

## 7. Multi-Agent Communication

### Task Delegation

```
→ Commander:        enrichment_complete (confirms enrichment done)
→ Gamma:            brief_ready (ExploitBrief available)
→ Mission Planner:  (implicit — brief_ready event triggers Gamma if waiting)
```

### Information Requests

```
OSINT requests information via:
→ Supabase: Cross-engagement lessons by stack fingerprint
→ External APIs: NVD, HackerOne, Exploit-DB, CISA KEV
→ Graph: Current intel/ state to avoid duplicates
```

### Feed Update Protocol

```
On schedule (every 6-24h):
1. Query each feed source
2. Diff against current intel/ state
3. Write only new/updated nodes
4. Log: "Feed update: N new CVEs, M updated"
5. Emit enrichment_complete with count
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[osint] State: DORMANT → STANDBY (feeds ingested, ready)
[osint] Feed ingestion: N nodes written to intel/
[osint] Feed update: SOURCE (N new, M updated, duration: Xs)
[osint] Enrichment requested: TARGET_ID type=ENRICHMENT_TYPE
[osint] Enrichment complete: TARGET_ID (N nodes written)
[osint] ExploitBrief generation: MISSION_ID (confidence: high|medium|low)
[osint] Brief written: MISSION_ID → brief=BRIEF_ID
[osint] Failure enrichment: MISSION_ID failure_class=FAILURE_CLASS
[osint] State: ACTIVE → COOLDOWN
[osint] State: COOLDOWN → DORMANT (queue empty)
```

### Trace Commands

```bash
# Live logs
pm2 logs osint

# Intel nodes by type
redis-cli GRAPH.QUERY solaris "MATCH (i:intel) RETURN i.subtype, count(i) GROUP BY i.subtype"

# ExploitBriefs by mission
redis-cli GRAPH.QUERY solaris "MATCH (b:intel {subtype:'exploit_brief'}) RETURN b.mission_id, b.exploit_type, b.osint_confidence"

# CVE coverage
redis-cli GRAPH.QUERY solaris "MATCH (v:vulnerability) RETURN v.cve, v.cvss_score ORDER BY v.cvss_score DESC LIMIT 20"

# Feed freshness
redis-cli GRAPH.QUERY solaris "MATCH (i:intel) RETURN i.source, max(i.updated_at) ORDER BY max DESC"
```

### Diagnostic Queries

```sql
-- Enrichment requests pending
SELECT * FROM events WHERE type='enrichment_requested' AND consumed=false;

-- Briefs needed
SELECT * FROM events WHERE type='mission_queued' AND consumed=false;

-- Feed update history
SELECT * FROM events WHERE type='enrichment_complete' ORDER BY created_at DESC LIMIT 10;
```

---

## 9. Error Handling

### Rate Limit Errors

OSINT uses cloud models (Google/Cerebras) which have rate limits:
```
On 429:
  → Exponential backoff: 2s base, max 60s
  → Max 5 retries
  → If rate limited on external API (NVD, etc.):
     → Log warning, continue with cached data
     → Retry on next feed refresh cycle
```

### Tool Execution Errors

```
curl/wget failure:
  → Log error with URL
  → Retry once after 5s
  → If still failing: skip that source, log critical
  → Do not block on single feed failure

searchsploit failure:
  → Log error
  → Retry once
  → If still failing: skip Exploit-DB for this cycle
```

### LLM Generation Errors

```
Malformed output (not valid IntelNode schema):
  → Retry with same prompt (max 2 retries)
  → If still malformed: log warning, skip that enrichment

API error (external feeds):
  → On NVD API error: use cached CVE data, log warning
  → On HackerOne error: skip, log info
  → On CISA KEV error: skip, retry in 6h

Timeout:
  → Retry once
  → If still timeout: skip that enrichment task, log error
```

### Graph Write Errors

```
Write failure:
  → Buffer IntelNode in memory
  → Retry with exponential backoff
  → If still failing: log critical, data may be lost (feed can re-fetch)
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | 2000ms |
| Feed ingestion (batch, on start) | < 5 min |
| Feed refresh (CISA KEV) | Every 6h |
| Feed refresh (NVD, HackerOne) | Every 24h |
| ExploitBrief generation | < 30s per mission |

### Task SLA

| Task Type | Target | Max |
|-----------|--------|------|
| CVE enrichment (per target) | < 10s | 30s |
| ExploitBrief generation | < 30s | 60s |
| Failure supplementary brief | < 30s | 60s |
| Feed batch ingestion | < 5 min | 10 min |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~500MB |
| Model memory | ~0 (cloud) |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| Supabase connection | ~5MB |
| **Total** | **~520MB** |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| NVD API call | 15s |
| HackerOne API call | 30s |
| CISA KEV feed | 30s |
| Exploit-DB search | 30s |
| File download | 60s |
| LLM call (brief generation) | 60s |
| LLM call (enrichment) | 30s |

---

*OSINT spec version 1.0 — 2026-04-03*

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results, provider recommendations
- [Gamma §3](./gamma.md#3-event-contract) — Brief ready flow (OSINT → Gamma for ExploitBrief delivery)
- [Critic §3](./critic.md#3-event-contract) — Failure enrichment flow (Critic → OSINT for supplementary briefs)
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns
