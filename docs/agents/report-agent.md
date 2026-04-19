# Report Agent Specification

**Agent:** Report Agent
**Type:** `report_agent`
**Tier:** Tier 6 (Cloud)
**Model:** `nvidia/nemotron-3-nano-30b-a3b:free` (OpenRouter primary) → `qwen-3-235b-a22b-instruct-2507` (Cerebras fallback)
**Temperature:** 0.3
**Poll Interval:** N/A (runs once on swarm_complete)

---

## 1. Identity & Role

Report Agent is the **final reporting engine** of the Solaris swarm. It runs exactly once — when Commander emits `swarm_complete` — and generates a comprehensive structured pentest report by traversing the entire graph.

**Report Agent DOES:**
- Run exactly once on `swarm_complete` event
- Traverse the entire graph to collect all findings
- Aggregate results by severity
- Document attack chains and failed missions
- Include lessons learned and recommendations
- Write report as artifact node and file

**Report Agent DOES NOT:**
- Execute exploits (Gamma's job)
- Generate missions (Mission Planner's job)
- Trigger swarm events (Commander's job)

---

## 2. Agent Lifecycle & Execution Flow

### State Machine

```
Report Agent: DORMANT on init → STANDBY on swarm_complete event
              STANDBY → ACTIVE on task claim (exactly once)
              ACTIVE → COOLDOWN on report complete
              COOLDOWN → DORMANT (never runs again)
```

### Init Sequence

```
1. Load system prompt: agent-system-prompts/report-agent.md
2. Connect to FalkorDB
3. Connect to EventBus (subscribe to: swarm_complete ONLY)
4. Set state: DORMANT
5. Poll loop NOT started (runs on event trigger only)
```

### Report Generation Flow

```
On swarm_complete event:
1. Set state: ACTIVE
2. Query entire graph:
   - All FindingNodes (validated findings)
   - All MissionNodes (missions by status)
   - All CredentialNodes (promoted credentials)
   - All ChainNodes (attack chains)
   - All FailedMissionNodes (archived failures)
   - All LessonNodes (lessons learned)
   - All ArtifactNodes (extracted artifacts)
3. Group findings by severity (Critical > High > Medium > Low > Info)
4. Generate report sections:
   - Executive Summary
   - Methodology
   - Findings by Severity
   - Attack Chains
   - Failed Missions
   - Lessons Learned
   - Appendix
5. Write report to file: ./reports/swarm-report-{timestamp}.md
6. Write ArtifactNode to graph
7. Emit report_generated event
8. Set state: DORMANT (permanent)
```

### Report Sections

```
1. Executive Summary
   - Scope
   - Overall risk rating
   - Key findings count by severity
   - Engagement duration

2. Methodology
   - Agents used (Commander, Gamma, Alpha, OSINT, etc.)
   - Coverage (endpoints scanned, exploits attempted)
   - Approach

3. Findings by Severity
   For each finding:
   - Description
   - Evidence (request/response excerpts)
   - CVSS score + vector
   - Reproduction steps
   - Impact analysis
   - Remediation recommendation

4. Attack Chains
   For each chain:
   - Sequential diagram of chained exploits
   - Each step linked to finding evidence

5. Failed Missions
   For each failed mission:
   - Target, exploit type
   - Failure class
   - Evidence trail
   - Classified as: confirmed_unexploitable / needs_manual_review / likely_patched

6. Lessons Learned
   - Patterns across failures
   - Systemic observations
   - Recommendations for future engagements

7. Appendix
   - Raw event log summary
   - Agent activity stats
   - Scope compliance confirmation
```

### Shutdown Sequence

```
1. Close FalkorDB connection
2. Close EventBus connection
3. Exit cleanly (process terminates)
```

---

## 3. Event Contract

### Subscribes To

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `swarm_complete` | `{swarm_id, summary: {mission_count, success_count, failure_count, duration_ms}}` | Commander emits when drain condition met |

### Emits

| Event | Payload Schema | Trigger |
|-------|---------------|---------|
| `report_generated` | `{swarm_id, report_node_id, report_path, summary: {finding_count, chain_count, lesson_count}}` | Report written |

### Collaboration Sequences

**Report Generation Flow:**
```
Commander emits swarm_complete
  → Report Agent claims task
  → Report Agent queries entire graph
  → Report Agent generates markdown report
  → Report Agent writes to ./reports/ and graph
  → Report Agent emits report_generated
  → Process terminates
```

---

## 4. Memory Schema

### Section Prefix

Report Agent reads from **all sections** (entire graph traversal).

### Reads

| Node Type | Properties Used |
|-----------|----------------|
| `FindingNode` | `id, vuln_class, evidence, created_at` |
| `MissionNode` | `id, exploit_type, target_endpoint, status, created_by` |
| `CredentialNode` | `id, cred_type, scope, validation_status` |
| `ChainNode` | `id, chain_type, steps, status` |
| `FailedMissionNode` | `id, failure_class, evidence, final_outcome` |
| `LessonNode` | `id, exploit_type, failure_class, successful_payload, tags` |
| `ArtifactNode` | `id, subtype, name, path` |
| `ExploitNode` | `id, mission_id, payload, success, evidence` |

### Writes

| Node Type | Schema | Trigger |
|-----------|--------|---------|
| `ArtifactNode` | `{id, type:"artifact", subtype:"pentest_report", name:"swarm-report-{timestamp}", path:"./reports/...", content_type:"text/markdown", discovered_at, discovered_by:"report_agent"}` | Report generated |

---

## 5. Tool Usage

### Can Use

Report Agent has **no tool access** — it uses LLM reasoning + graph traversal.

```
(Intentionally empty — Report Agent generates text, not executes tools)
```

### Cannot Use

| Tool | Reason |
|------|--------|
| All tools | Report Agent is a reasoning agent — it aggregates and writes text |

### How Report Agent Processes

```
THOUGHT: Traverse entire graph and collect all data
  - Query all FindingNodes
  - Query all MissionNodes by status
  - Query all ChainNodes
  - Query all FailedMissionNodes
  - Query all LessonNodes

ANALYSIS: Group and categorize
  - Sort findings by CVSS severity
  - Map chains to evidence
  - Classify failed missions
  - Extract lessons learned patterns

GENERATION: Write report
  - Use LLM to generate well-formatted markdown
  - Include all required sections
  - Link evidence to findings

WRITE: Report to file + graph
EMIT: report_generated
```

---

## 6. Context Management

### System Prompt Composition

```
1. Load base prompt: agent-system-prompts/report-agent.md
2. Load TargetConfig:
   - Target name, base_url, scope
3. Load graph data:
   - All findings (grouped by severity)
   - All missions (by status)
   - All chains
   - All failed missions
   - All lessons
4. Load report template (from system prompt)
5. Compose final prompt with all graph data
```

### Context Budget

- **Estimated tokens:** ~10,000–50,000 (entire engagement data)
- **Context budget:** 65,536 tokens (nvidia/nemotron-3-nano supports 2M context, but we limit to 65K)
- **Overflow behavior:** Not expected — engagement data fits in context

### Session State

Report Agent is **stateless** — it reads entire graph, generates report, terminates.

---

## 7. Multi-Agent Communication

### Task Delegation

```
Report Agent does NOT delegate — it is the terminal agent.
It communicates only via:
→ report_generated event (informational only)
→ ArtifactNode write (for downstream processing)
```

### Post-Processing

```
After report_generated:
- Report file can be:
  - Converted to PDF
  - Uploaded to Supabase
  - Sent via email
  - Integrated with ticket system
These are OUTSIDE the swarm's scope.
```

---

## 8. Observability & Debugging

### Key Log Lines

```
[report-agent] State: DORMANT → STANDBY (swarm_complete received)
[report-agent] Graph traversal: Collecting all findings
[report-agent] Graph traversal: N findings, M missions, K chains, L failed
[report-agent] Report generation: Starting
[report-agent] Section: Executive Summary
[report-agent] Section: Methodology
[report-agent] Section: Findings (N by severity)
[report-agent] Section: Attack Chains (N chains)
[report-agent] Section: Failed Missions (N failures)
[report-agent] Section: Lessons Learned (N lessons)
[report-agent] Report written: ./reports/swarm-report-{timestamp}.md
[report-agent] Artifact node written: ARTIFACT_ID
[report-agent] Report generated: {finding_count, chain_count, lesson_count}
[report-agent] State: ACTIVE → DORMANT (complete)
[report-agent] Process terminating
```

### Trace Commands

```bash
# Live logs
pm2 logs report-agent

# Report artifact
redis-cli GRAPH.QUERY solaris "MATCH (a:artifact {subtype:'pentest_report'}) RETURN a.id, a.name, a.path"

# All findings by severity
redis-cli GRAPH.QUERY solaris "MATCH (f:finding) RETURN f.vuln_class, count(f) ORDER BY count(f) DESC"
```

---

## 9. Error Handling

### LLM Generation Errors

```
Report generation failure:
  → Retry once with same graph data
  → If still failing: generate simplified report (bullet points only)
  → Log critical, do not terminate silently

API error (OpenRouter):
  → Fallback to Cerebras qwen-3-235b-a22b
  → If Cerebras fails: generate minimal text report
```

### Graph Read Errors

```
Graph traversal failure:
  → Retry once
  → If still failing: generate report with partial data
  → Log critical with missing node types
```

### File Write Errors

```
Report file write failure:
  → Write to graph only (ArtifactNode with embedded content)
  → Log warning, report still available in graph
```

---

## 10. Performance Targets

### Poll Interval

| Metric | Target |
|--------|--------|
| Poll interval | N/A (event-triggered, runs once) |
| Total runtime | < 5 min for typical engagement |

### Report Generation SLA

| Task | Target | Max |
|------|--------|-----|
| Graph traversal | < 30s | 60s |
| LLM report generation | < 2 min | 4 min |
| File write | < 5s | 10s |
| **Total** | < 5 min | 10 min |

### Memory Footprint

| Component | Expected |
|-----------|----------|
| Process RSS | ~500MB |
| Model memory | ~0 (cloud) |
| FalkorDB connection | ~10MB |
| EventBus connection | ~5MB |
| Graph data cache | ~50MB (typical engagement) |
| **Total** | **~565MB** |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Graph query (full traversal) | 60s |
| LLM call (report generation) | 5 min |
| File write | 10s |

---

## See Also

- [MODEL_GUIDE.md](./MODEL_GUIDE.md) — Locked-in model configuration, benchmark results
- [Commander §3](./commander.md#3-event-contract) — Drain condition and swarm_complete emission
- [SPEC-DESIGN.md](./SPEC-DESIGN.md) — Spec template and cross-cutting concerns

*Report Agent spec version 1.0 — 2026-04-03*
