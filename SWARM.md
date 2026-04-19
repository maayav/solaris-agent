# Swarm Module Analysis Report

## Module: `swarm module/`

---

## 1. Current Stack & Dependencies

### Core Framework
| Technology | Version | Notes |
|---|---|---|
| Python | 3.10+ | Runtime |
| LangGraph | latest | Agent orchestration, state machine |
| LangChain | latest | LLM chain abstractions |
| FastAPI | 0.115+ | Web framework |
| Uvicorn | 0.30+ | ASGI server |

### Agent System
| Technology | Purpose |
|---|---|
| LangGraph | State machine with 5 phases |
| LangChain | LLM chain management |
| Custom agents | Commander, Alpha Recon, Gamma Exploit, Critic, HITL Gate |

### LLM Integration
| Technology | Purpose | Cascade Order |
|---|---|---|
| OpenRouter | Primary LLM provider | 1st → 2nd → 3rd |
| Ollama | Local LLM fallback | Last resort |

### Infrastructure
| Technology | Purpose |
|---|---|
| Redis Streams | A2A messaging between agents |
| Supabase | PostgreSQL persistence |
| Docker SDK | Sandbox container management |

### Code Analysis
| Technology | Purpose |
|---|---|---|
| Tree-Sitter | Multi-language code parsing (JS, TS, Python) |
| Semgrep | Static vulnerability analysis |

### Security Research
| Technology | Purpose |
|---|---|---|
| OWASP libraries | Web vulnerability exploitation |
| CVE data | Exploit matching |
| PentAGI | Self-reflection loop for exploit refinement — **Python-only pattern, see warning below** |

### Database Clients
| Technology | Purpose |
|---|---|
| `supabase` (async) | Mission persistence |
| `redis` (async) | Agent messaging |

### Frontend (Sub-project)
| Technology | Notes |
|---|---|
| React | Separate frontend app inside `Red_team/frontend/` |

---

## 2. Processing Pipeline / Data Flow

### LangGraph State Machine (5 Phases)

```
planning → recon → exploitation → reporting → complete
    ↓         ↓           ↓            ↓
 (assign)  (scan)    (exploit)    (compile)
    ↓         ↓           ↓            ↓
 (decide)  (analyze)  (validate)   (deliver)
```

### Phase Details

| Phase | Purpose | Key Operations |
|---|---|---|
| `planning` | Mission initialization | Commander assigns tasks, sets objectives |
| `recon` | Reconnaissance | Alpha Recon: nmap, nuclei, curl scans |
| `exploitation` | Attack execution | Gamma Exploit: OWASP Top 10, token chaining |
| `reporting` | Result compilation | ReportGenerator: JSON/Markdown output |
| `complete` | Mission finalization | Final artifact delivery |

### Agent Responsibilities

| Agent | Lines | Role |
|---|---|---|
| **Commander** | 1096 | Strategic planning, task assignment, phase decisions, Blue Team intel |
| **Alpha Recon** | 661 | Nmap, nuclei, curl reconnaissance |
| **Gamma Exploit** | 1823+ | OWASP exploitation, PentAGI self-reflection, token chaining |
| **Critic** | 1065 | Deterministic + LLM exploit evaluation |
| **HITL Gate** | ~100 | Human-in-the-loop, destructive payload approval |

### A2A Messaging (Redis Streams)

```
Commander
    ↓ (task assignment)
    ↓ a2a_messages stream
Alpha Recon / Gamma Exploit / Critic
    ↓ (results)
    ↓ red_team_events stream
Commander (phase advancement)
    ↓
defense_analytics stream  ← ⚠️ shared contract with VibeCheck — must coordinate versioning
    ↓ (Blue Team findings flow back)
```

### RedTeamState Schema (30+ Fields)

```python
{
    mission_id, phase, messages, blackboard,
    recon_results, exploit_results, discovered_credentials,
    blue_team_findings, llm_calls, token_usage,
    sandbox_id, tools_used, findings, exploit_attempts,
    ...
}
```

### LLM Cascade

```
OpenRouter (primary)
    ↓ (failure)
OpenRouter (fallback 1)
    ↓ (failure)
OpenRouter (fallback 2)
    ↓ (failure)
Ollama (local)
```

### Sandbox Execution

```
Gamma Exploit request
    ↓
SandboxManager (Docker SDK)
    ↓
Kali container (vibecheck-sandbox)
    ↓ (host network mode)
Target environment
```

---

## 3. Architecture

### Directory Structure

```
swarm module/
├── Red_team/
│   ├── agents/
│   │   ├── graph.py              # LangGraph state machine (365 lines)
│   │   ├── state.py              # RedTeamState TypedDict (144 lines)
│   │   ├── commander.py          # Commander agent (1096 lines)
│   │   ├── alpha_recon.py        # Alpha Recon agent (661 lines)
│   │   ├── gamma_exploit.py      # Gamma Exploit agent (1823+ lines)
│   │   ├── critic_agent.py       # Critic agent (1065 lines)
│   │   ├── report_generator.py   # Report generator (932 lines)
│   │   ├── a2a/
│   │   │   ├── messages.py        # A2AMessage schemas (134 lines)
│   │   │   └── blackboard.py     # Blackboard (50 lines)
│   │   └── tools/                 # 9 tool implementations
│   │       ├── nmap.py
│   │       ├── nuclei.py
│   │       ├── curl.py
│   │       ├── python_exec.py
│   │       ├── sqlmap.py
│   │       ├── ffuf.py
│   │       ├── jwt_tool.py
│   │       ├── web_search.py
│   │       └── sandbox.py
│   ├── core/
│   │   ├── llm_client.py         # Unified LLM client (122 lines)
│   │   ├── openrouter_client.py   # OpenRouter (165 lines)
│   │   ├── ollama_client.py       # Ollama (85 lines)
│   │   ├── redis_bus.py           # Redis Streams A2A (391 lines)
│   │   ├── supabase_client.py    # Supabase persistence (970 lines)
│   │   ├── blue_team_bridge.py    # Blue → Red intel (808 lines)
│   │   ├── qdrant_client.py
│   │   ├── falkordb_client.py
│   │   ├── parsing.py
│   │   ├── banners.py
│   │   └── platform_compat.py
│   ├── sandbox/
│   │   ├── sandbox_manager.py     # Docker lifecycle (977 lines)
│   │   └── Dockerfile.sandbox     # Kali-based image
│   ├── api/
│   │   └── main.py                # FastAPI endpoints (779 lines)
│   ├── frontend/                   # React sub-project
│   ├── scripts/
│   │   ├── run_combined_engine.py # Red+Blue launcher (465 lines)
│   │   ├── run_blue_team.py
│   │   ├── battle_drill.py        # Integration test (174 lines)
│   │   └── swarm_worker*.py
│   ├── tests/
│   └── Docs/
├── Blue_team/                     # VibeCheck Blue Team agent
│   └── ... (same as vibecheck/)
└── shared/
    ├── requirements.txt
    └── setup.sh
```

### Database Schema (Supabase)

| Table | Purpose |
|---|---|
| `swarm_missions` | Mission metadata and status |
| `swarm_agent_states` | Per-agent state snapshots |
| `swarm_events` | Mission event log |
| `swarm_findings` | Discovered vulnerabilities |
| `swarm_exploit_attempts` | Exploit attempt records |

### Tool Registry (9 Tools)

| Tool | Purpose |
|---|---|
| nmap | Network scanning |
| nuclei | Vulnerability scanning |
| curl | HTTP requests |
| python_exec | Code execution in sandbox |
| sqlmap | SQL injection |
| ffuf | Fuzzing |
| jwt_tool | JWT manipulation |
| web_search | OSINT |
| sandbox | Docker container management |

### Key Files

| File | Lines | Purpose |
|---|---|---|
| `agents/graph.py` | 365 | LangGraph state machine |
| `agents/state.py` | 144 | RedTeamState TypedDict |
| `agents/commander.py` | 1096 | Commander agent |
| `agents/gamma_exploit.py` | 1823+ | Gamma Exploit agent |
| `agents/critic_agent.py` | 1065 | Critic agent |
| `agents/report_generator.py` | 932 | Report generation |
| `core/redis_bus.py` | 391 | A2A messaging |
| `core/supabase_client.py` | 970 | Persistence |
| `core/blue_team_bridge.py` | 808 | Blue→Red intel |
| `sandbox/sandbox_manager.py` | 977 | Docker lifecycle |
| `api/main.py` | 779 | FastAPI endpoints |
| `scripts/run_combined_engine.py` | 465 | Launcher |

---

## 4. Refactoring Notes: TypeScript + Hono + Bun

### 🔄 Full Rewrite Required — Ground-Up Design, Not a Port

| Current | Target | Notes |
|---|---|---|
| Python 3.10 | TypeScript | Entire codebase needs rewriting |
| **LangGraph** | XState / Custom | **No JS equivalent — ground-up design problem, not a port**. LangGraph's graph compilation + checkpointing + memory are deeply coupled to Python. XState is not equivalent. This requires a full state machine design from scratch. |
| **LangChain** | Custom LLM orchestration | **No JS equivalent — ground-up design problem, not a port**. LangChain's chain composition, output parsers, and tool binding have no direct TS analogue. The LLM cascade (3 OpenRouter fallbacks + Ollama) must be designed as a custom service. |
| FastAPI | Hono | REST API framework replacement |

### ⚠️ Critical Gaps

| Dependency | Problem | Recommendation |
|---|---|---|
| **LangGraph** | No TypeScript equivalent — ground-up design | Build custom state machine. **Do not attempt to port LangGraph logic directly.** |
| **LangChain** | No TypeScript equivalent — ground-up design | Build custom LLM orchestration service. |
| **LangGraph/LangChain** | Deep Python coupling | These are not wrapper candidates — they are architectural paradigms that must be redesigned from first principles in TypeScript |

### ⚠️ Load-Bearing Early Decisions (Wrong = Expensive Rework)

| Decision | Why It's Load-Bearing |
|---|---|
| **Phase 1: State machine design** | The 5-phase `planning → recon → exploitation → reporting → complete` flow is the backbone of the entire swarm. Getting phase transitions, state fields, and checkpoint strategy wrong in Phase 1 invalidates all downstream agent work. |
| **Phase 5: LLM cascade service design** | The 3-tier OpenRouter → OpenRouter → Ollama fallback cascade is mission-critical for reliability. If the cascade is poorly designed (wrong retry logic, no circuit breaker, no token tracking), the swarm becomes unreliable in production. These two phases must be validated with integration tests before Phase 6 begins. |

### ✅ Portable Dependencies

| Dependency | TypeScript/Bun Alternative | Status |
|---|---|---|
| Redis Streams | `ioredis` | Direct port — same Streams API |
| Supabase | `@supabase/supabase-js` | Already used in frontend |
| OpenRouter | `openrouter` npm package | Official JS client |
| Ollama | `ollama` npm package | Official JS client |
| Docker SDK | `dockerode` | Node.js Docker client |
| Tree-Sitter | `@tree-sitter/` packages | Works with Bun |
| httpx | Native fetch / `ofetch` | Replace async HTTP |

### ⚠️ PentAGI Self-Reflection: Python-Only Pattern

The `gamma_exploit.py` (1823+ lines) includes a **PentAGI-style self-reflection loop** — after initial exploit attempts, the agent loops back to re-evaluate and refine its approach. This is a **Python-only pattern** with no TypeScript equivalent.

Redesign required: The reflection loop involves:
1. Running an exploit attempt
2. Evaluating the result (via LLM)
3. Adjusting parameters based on evaluation
4. Re-attempting

This is fundamentally a `while loop with LLM-conditioned exit` — must be designed from scratch in TypeScript, likely as a dedicated `ReflectionService` with a configurable max-iterations and convergence check.

### ⚠️ Implicit Agent Behaviors Not Covered by Tests

The swarm has **only one integration test** (`battle_drill.py`, 174 lines). The following behaviors are implicit in the ~5,000+ lines of agent code and have **no automated test coverage**:

- Commander task assignment logic under partial Blue Team intel
- Alpha Recon tool selection strategy (when to use nmap vs nuclei vs curl)
- Gamma Exploit token chaining sequences
- Critic agent scoring algorithm (deterministic + LLM blend)
- HITL Gate approval/rejection patterns
- LLM cascade failover behavior at each tier
- Sandbox container reuse vs teardown decisions
- Phase transition guards (what causes `planning → recon` to fail)

**Before refactoring**, document these behavioral specifications. After refactoring, every behavioral spec must have a corresponding test. Behavioral regressions in this codebase are high-risk because it drives an actual red team attack pipeline.

### 🚨 Cross-Module Stream Contract Coordination

Two Redis Streams are shared between Swarm and VibeCheck:

| Stream | Direction | Contract Owner | Warning |
|---|---|---|---|
| `defense_analytics` | Blue → Red | VibeCheck (producer), Swarm (consumer) | Schema changes in VibeCheck will break `blue_team_bridge.py` in Swarm. Lock the contract first. |
| `red_team_events` | Red → External | Swarm (producer) | If Swarm changes event shape, any consumer (dashboard, logging) breaks. |

Before Phase 3 (Redis Streams port) in either module:
1. Document all field names, types, and producer/consumer roles for both streams
2. Add a stream contract validation test in both modules
3. Agree on a versioning strategy (e.g., `defense_analytics:v2` prefixed stream names)

### Architecture Translation

| Python/LangGraph Pattern | TypeScript/Target |
|---|---|
| LangGraph State Machine | XState or custom state machine — **ground-up design** |
| LangChain LLM chains | Custom LLM orchestration service — **ground-up design** |
| TypedDict state | TypeScript interfaces |
| Python agents | TypeScript services with methods |
| Redis Streams A2A | `ioredis` Streams (direct port) |
| Docker SDK | `dockerode` (direct port) |
| FastAPI + Pydantic | Hono + Zod |

### State Machine Redesign

The 5-phase LangGraph state machine must be rebuilt from scratch (Phase 1):

```typescript
// Phase: planning → recon → exploitation → reporting → complete
type Phase = 'planning' | 'recon' | 'exploitation' | 'reporting' | 'complete';

interface SwarmState {
  missionId: string;
  phase: Phase;
  blackboard: Record<string, unknown>;
  messages: A2AMessage[];
  reconResults: ReconResult[];
  exploitResults: ExploitResult[];
  findings: Finding[];
  // ... 30+ fields
}
```

### Agent Translation

| Python Agent | TypeScript Service | Complexity | Behavioral Risk |
|---|---|---|---|
| Commander | `CommanderService` | High — strategic planning, task assignment | **HIGH** — task assignment logic implicit, needs behavioral spec |
| Alpha Recon | `AlphaReconService` | Medium — nmap, nuclei, curl | **HIGH** — tool selection strategy implicit |
| Gamma Exploit | `GammaExploitService` | Very High — OWASP, PentAGI, token chaining | **CRITICAL** — PentAGI reflection loop is Python-only, needs ground-up redesign |
| Critic | `CriticService` | High — deterministic + LLM evaluation | **HIGH** — scoring algorithm implicit |
| HITL Gate | `HitlGateService` | Medium — pattern matching + approval | **MEDIUM** — approval patterns implicit |

### Tool System Translation

| Python Tool | TypeScript |
|---|---|---|
| nmap | `nmap` CLI wrapper |
| nuclei | `nuclei` CLI wrapper |
| curl | Native fetch |
| python_exec | Bun runtime execution |
| sqlmap | `sqlmap` CLI wrapper |
| ffuf | `ffuf` CLI wrapper |
| jwt_tool | `jsonwebtoken` npm |
| web_search | Fetch API |
| sandbox | `dockerode` |

### LLM Cascade Translation

```typescript
// OpenRouter → OpenRouter fallbacks → Ollama
const llmCascade = {
  primary: new OpenRouterClient(),
  fallbacks: [openRouterBackup1, openRouterBackup2],
  final: new OllamaClient()
};
```

### Gaps

| Gap | Problem | Recommendation |
|---|---|---|
| LangGraph replacement | Core orchestration — **ground-up design** | Build custom phase controller in Phase 1. Validate with tests before Phase 2. |
| LangChain replacement | LLM chain management — **ground-up design** | Build `LlmService` with cascade logic in Phase 5. Validate cascade failover behavior. |
| PentAGI self-reflection | Python-only pattern | Design `ReflectionService` with configurable max-iterations and convergence check |
| OWASP/CVE libraries | Python security libraries | May need CLI wrappers or API calls |
| `defense_analytics` stream | Cross-module coordination | Coordinate versioning with VibeCheck before Phase 3 |
| `red_team_events` stream | Schema stability | Document field contract before Phase 3 |
| Agent behavioral specs | Implicit behaviors, no test coverage | Document all agent decision-making before writing TS code |
| LLM cascade service | Load-bearing Phase 5 decision | Prototype cascade with actual failures (rate limits, timeouts) before Phase 5 is considered complete |

### 🚨 Testing Gap Warning

Swarm has **severely insufficient test coverage**:
1. Only `battle_drill.py` (174 lines) — a single integration test
2. No unit tests for any agent (Commander, Alpha Recon, Gamma Exploit, Critic, HITL Gate)
3. No unit tests for `blue_team_bridge.py`, `supabase_client.py`, `redis_bus.py`
4. No tests for LLM cascade failover behavior
5. No tests for sandbox container lifecycle
6. Agent behavioral decisions are encoded in ~5,000 lines with zero test coverage

**Before refactoring**, establish behavioral specifications for all 5 agents and their key decision paths. After the TS rewrite, every behavioral spec needs a corresponding test. The risk of silent behavioral regression is **very high** given the complexity of the agent orchestration.

### Migration Order

1. **Phase 1** (LOAD-BEARING): Design and validate XState/custom state machine for 5-phase flow — **do not proceed past Phase 1 without passing integration tests for phase transitions**
2. **Phase 2**: Set up Hono + Zod API structure — **Phase 2 must wait for VIBECHECK.md Phase 2 to complete stream contract locking**
3. **Phase 3**: Port Redis Streams (`ioredis`) for A2A — **coordinate `defense_analytics` schema with VibeCheck first** — see VIBECHECK.md Phase 2 for contract locking steps
4. **Phase 4**: Port Supabase persistence
5. **Phase 5** (LOAD-BEARING): Build LLM orchestration service with cascade — **prototype failover behavior with actual rate limits/timeouts before declaring done**
6. **Phase 6**: Port tool wrappers (nmap, nuclei, sqlmap, ffuf)
7. **Phase 7**: Build Docker sandbox manager (`dockerode`)
8. **Phase 8**: Implement 5 TypeScript agent services — **each agent needs behavioral spec before coding**
9. **Phase 9**: Build Blue Team bridge — **coordinate `defense_analytics` schema with VibeCheck**
10. **Phase 10**: Port report generator
11. **Phase 11**: Replace React sub-frontend with shared frontend module
