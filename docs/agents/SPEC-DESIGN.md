# Solaris-Agent: Per-Agent Specification Design

**Version:** 1.0
**Date:** 2026-04-03
**Status:** Approved — Implementation Pending

---

## Overview

This document defines the specification format for each Solaris-Agent agent. Each agent receives a standalone spec file at `docs/agents/{agent-name}.md`. All specs follow a common structure to ensure consistency and completeness.

---

## Agent Spec Files

| File | Agent | Priority |
|------|-------|----------|
| `docs/agents/commander.md` | Commander | 1 |
| `docs/agents/gamma.md` | Gamma Exploit | 1 |
| `docs/agents/alpha.md` | Alpha Recon | 1 |
| `docs/agents/osint.md` | OSINT Agent | 1 |
| `docs/agents/verifier.md` | Verifier | 1 |
| `docs/agents/critic.md` | Critic | 1 |
| `docs/agents/mission-planner.md` | Mission Planner | 2 |
| `docs/agents/chain-planner.md` | Chain Planner | 2 |
| `docs/agents/mcp.md` | MCP Agent | 2 |
| `docs/agents/post-exploit.md` | Post-Exploit Agent | 2 |
| `docs/agents/report-agent.md` | Report Agent | 2 |
| `docs/agents/specialist.md` | Specialist | 2 |

Priority 1 = Top 6 first (this document). Priority 2 = deferred.

---

## Common Spec Structure

Every agent spec follows this 10-section template:

### 1. Identity & Role

```
- Agent name and type identifier
- Tier and model assignment
- Swarm role in 2-3 sentences
- Clear scope: what it DOES and DOES NOT do
```

### 2. Agent Lifecycle & Execution Flow

```
State Machine:
  DORMANT → STANDBY → ACTIVE → COOLDOWN → DORMANT
            ↑
          ERROR (backoff reset)

Init sequence: what happens on startup (connect graph, subscribe events, etc.)
Shutdown sequence: graceful cleanup (flush writes, close connections)
Poll loop: wake interval, consume-events logic, sleep behavior
```

### 3. Event Contract

```
SUBSCRIBES TO:
  EventType: { payload schema }

EMITS:
  EventType: { payload schema }

COLLABORATION SEQUENCE:
  1. Receives X event → reads Y from graph
  2. Does Z work
  3. Writes result to graph
  4. Emits A event → triggers next agent
```

### 4. Memory Schema

```
SECTION PREFIX: recon/ | gamma/ | bridge/ | intel/ | lessons/

READS:
  - NodeType: { properties used }

WRITES:
  - NodeType: { required fields, optional fields, schema }

EDGES CREATED:
  - :FOUND_AT, :UNLOCKS, :DEPENDS_ON, etc.

LIFECYCLE:
  - Created when: ...
  - Updated when: ...
  - Archived when: ...
```

### 5. Tool Usage

```
CAN USE (role-scoped):
  - tool_name: description, expected output shape, timeout

CANNOT USE:
  - tool_name: reason for exclusion

HOW LLM USES TOOLS:
  - Thin CLI shim pattern: LLM generates full command string
  - Shim executes via Bun.spawn, returns stdout/stderr/exit_code
  - LLM interprets output, decides next action

RATE LIMITS:
  - Max N tool calls per mission before backoff
```

### 6. Context Management

```
SYSTEM PROMPT COMPOSITION:
  base_prompt = loadAgentPrompt(agentType)           // from agent-system-prompts/
  overlay = loadOverlay(exploit_type)                // from prompt-overlays/
  context = graph.getContext(missionId)              // from FalkorDB

CONTEXT BUDGET:
  - Estimated tokens per operation
  - Overflow behavior: handoff_node write + re-queue

SESSION STATE:
  - What persists across poll cycles
  - What is re-read from graph each wake
```

### 7. Multi-Agent Communication

```
TASK DELEGATION:
  - How it spawns work for other agents (emit event with payload)

INFORMATION REQUEST:
  - How it asks other agents for data (event + graph read)

HANDOFF PROTOCOL:
  - Context relay node schema (if applicable)
  - Gamma-to-Gamma handoff via gamma_handoff node
```

### 8. Observability & Debugging

```
KEY LOG LINES:
  - [AGENT_ID] State: DORMANT → STANDBY
  - [AGENT_ID] Processing event: EVENT_TYPE
  - [AGENT_ID] Mission complete: MISSION_ID
  - [AGENT_ID] Error: ERROR_MESSAGE

TRACE COMMANDS:
  - pm2 logs AGENT_NAME
  - grep "AGENT_ID" solaris-events.db

DIAGNOSTIC ENDPOINTS:
  - Event bus pending count: sqlite query
  - Graph node count by section: cypher query
```

### 9. Error Handling

```
RATE LIMIT ERRORS:
  - Detection: 429, rate limit, TPM in error message
  - Behavior: exponential backoff, max 5 retries

TOOL EXECUTION ERRORS:
  - Non-zero exit: parse stderr, classify failure
  - Timeout: kill process, emit exploit_failed

LLM GENERATION ERRORS:
  - Malformed output: retry with same prompt
  - API error: cascade to fallback provider

GRAPH WRITE ERRORS:
  - Conflict: retry MERGE operation
  - Connection loss: buffer writes, reconnect
```

### 10. Performance Targets

```
POLL INTERVAL:
  - Commander: 500ms
  - Verifier: 500ms
  - Mission Planner: 1000ms
  - Chain Planner: 1000ms
  - Critic: 1000ms
  - Gamma: 2000ms
  - OSINT: 2000ms
  - Alpha: 5000ms

MISSION COMPLETION SLA:
  - Gamma (single request): < 5 min
  - Gamma (scripted): < 15 min
  - MCP (multi-step): < 30 min

MEMORY FOOTPRINT:
  - Verifier: ~200MB
  - Critic: ~200MB
  - OSINT: ~500MB
  - Alpha: ~1GB
  - Commander: ~500MB
  - Gamma: ~2GB
  - MCP: ~2GB
  - Post-Exploit: ~1GB

TOOL TIMEOUTS:
  - curl: 10s
  - nmap (quick): 30s
  - gobuster: 60s
  - sqlmap: 120s
  - john: 300s
  - hashcat: 300s
```

---

## Cross-Cutting Concerns

### Memory Section Prefixes

All graph nodes use a section prefix to partition by owner:

```
recon/     — Alpha Recon (write), OSINT (write)
             Contains: endpoints, components, vulnerabilities, users, confirmed credentials

gamma/     — Gamma Exploit (write), MCP Agent (write)
             Contains: mission queue, active missions, exploits, artifacts

bridge/    — Gamma Exploit (write), MCP Agent (write)
             Contains: raw tokens, cookies, passwords — pending Commander review

intel/     — OSINT Agent (write)
             Contains: CVE details, payload libraries, technique docs, ExploitBrief nodes

lessons/  — Critic (write)
             Contains: lesson nodes, failed_mission nodes
```

### Event Payload Schemas

All event payloads follow this naming convention for consistency:

```
finding_written:         { target_id, finding_type, vuln_class, evidence, source }
finding_validated:      { finding_id, priority_hint, escalation_recommendation }
credential_found:       { credential_id, target_id, cred_type, value, bridge_node_id }
credential_promoted:    { credential_id, validated_by, probe_result }
mission_queued:         { mission_id, target_endpoint, exploit_type, priority, executor }
mission_verified:       { mission_id, verified_by, checks_passed }
mission_authorized:     { mission_id, authorized_by, escalation_level }
exploit_completed:      { mission_id, success, artifacts: [], evidence }
exploit_failed:         { mission_id, failure_class, attempt: 1-3, error }
rce_confirmed:          { mission_id, target_id, session_id }
swarm_complete:         { swarm_id, summary: { mission_count, success_count, ... } }
brief_ready:            { mission_id, brief_node_id }
waf_duel_started:       { duel_id, mission_id, waf_type }
waf_duel_complete:      { duel_id, bypass_candidates: [] }
handoff_requested:      { handoff_id, mission_id, from_instance, context_budget }
specialist_activated:   { specialist_id, surface_type, parent_mission }
specialist_complete:    { specialist_id, result, surface_exhausted }
belief_updated:         { belief_id, p_vulnerable, p_protected, p_exploitable }
validation_probe_requested: { probe_id, target_id, artifact_id }
validation_probe_complete:  { probe_id, result: "success|expired|error", http_status }
```

### Tool Shim Pattern

All tools follow the thin CLI shim pattern:

```typescript
// LLM generates: "nmap 192.168.1.1 -p 80,443 -sV"
// Shim executes via Bun.spawn
// Returns: { exit_code, stdout, stderr, timed_out, duration_ms }

// Shim does NOT:
  - Parse output (LLM does this)
  - Validate structure (LLM handles this)
  - Retry on failure (caller handles this)
```

---

## Implementation Notes

### System Prompt Loading

Each agent's system prompt is composed at runtime:

```
full_prompt = `
${loadBasePrompt(agentType)}
${loadOverlay(exploit_type)}    // if applicable
---
Context: ${graphContext}
Target: ${targetConfig}
---`
```

Base prompts: `agent-swarm/src/agent-system-prompts/{agent}.md`
Overlays: `agent-swarm/src/prompt-overlays/{exploit_type}.md`

### LLM-Driven Tool Execution

Tools are NOT wrapper classes with structured I/O. The LLM:
1. Reasons about the situation
2. Selects a tool and generates the full command string
3. Calls `executeTool(toolName, args)` which runs the thin shim
4. Parses stdout/stderr to decide next action

### State Machine Enforcement

Base agent class enforces valid transitions. Invalid transitions log a warning and are ignored.

```
VALID_TRANSITIONS[state] = [allowed_next_states]
canTransition(from, to) → boolean
```

### Agent Registry

All agents are declared in `ecosystem.config.js` (PM2). Agent type is passed via `AGENT_ROLE` env var.

---

## Next Steps

1. Write specs for Priority 1 agents (Commander, Gamma, Alpha, OSINT, Verifier, Critic)
2. Write specs for Priority 2 agents (Mission Planner, Chain Planner, MCP, Post-Exploit, Report Agent, Specialist)
3. Review specs with user
4. Implement agents to spec

---

*Design approved: 2026-04-03*
