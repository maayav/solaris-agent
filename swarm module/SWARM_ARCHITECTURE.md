# Swarm Module - Comprehensive Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Agent System](#agent-system)
4. [State Management](#state-management)
5. [A2A Messaging](#a2a-messaging)
6. [Tool System](#tool-system)
7. [Sandbox Execution](#sandbox-execution)
8. [LLM Integration](#llm-integration)
9. [Database Schema](#database-schema)
10. [Execution Flow](#execution-flow)
11. [API Endpoints](#api-endpoints)
12. [Configuration](#configuration)

---

## Overview

The **Swarm Module** is an autonomous red team penetration testing system built on LangGraph. It implements a multi-agent swarm architecture where specialized agents collaborate to conduct security assessments against target systems.

### Key Features

- **Multi-Agent Orchestration**: Commander, Alpha (Recon), Gamma (Exploit), and Critic agents working in concert
- **LangGraph State Machine**: Graph-based workflow orchestration with cycle detection
- **Real-time A2A Messaging**: Redis Streams for agent-to-agent communication
- **Docker Sandbox**: Isolated tool execution environment
- **LLM Cascade**: OpenRouter → Ollama fallback for AI reasoning
- **PentAGI Loop**: Self-reflection on failed exploits with retry logic
- **HITL Safety Gate**: Human-in-the-loop approval for destructive payloads
- **Blue Team Bridge**: Integration with defensive analytics

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VibeCheck Platform                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     Swarm Module (Red Team)                          │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │                                                                     │  │
│  │  ┌────────────┐    ┌────────────┐    ┌────────────┐                 │  │
│  │  │ Commander  │───▶│   Alpha    │───▶│   Gamma    │                 │  │
│  │  │  (Plan)   │    │   Recon    │    │  Exploit   │                 │  │
│  │  └─────┬──────┘    └────────────┘    └──────┬─────┘                 │  │
│  │        │                                      │                        │  │
│  │        │                                      ▼                        │  │
│  │        │                             ┌────────────┐                  │  │
│  │        │                             │    HITL    │                  │  │
│  │        │                             │    Gate    │                  │  │
│  │        │                             └──────┬─────┘                  │  │
│  │        │                                    │                         │  │
│  │        │◀───────────────────────────────────┘                         │  │
│  │        │              (loop until complete)                          │  │
│  │        │                                                              │  │
│  │        │                             ┌────────────┐                  │  │
│  │        │                      ┌─────│   Critic   │─────┐            │  │
│  │        │                      │     │ (Evaluate) │     │            │  │
│  │        │                      │     └────────────┘     │            │  │
│  │        │                      ▼                       ▼            │  │
│  │        │                 ┌──────────────────────────────┐           │  │
│  │        │                 │      Report Generator        │           │  │
│  │        │                 └──────────────────────────────┘           │  │
│  │        │                                                              │  │
│  │        └─────────────────────────────┐                                │  │
│  │                                      ▼                                │  │
│  │                        ┌───────────────────────┐                     │  │
│  │                        │   Blue Team Bridge    │                     │  │
│  │                        │  (Static Analysis)    │                     │  │
│  │                        └───────────────────────┘                     │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                      Infrastructure Layer                             │  │
│  ├─────────────────────────────────────────────────────────────────────┤  │
│  │                                                                     │  │
│  │   Redis Streams          │         Supabase (PostgreSQL)           │  │
│  │   ┌──────────────────┐   │   ┌────────────────────────────────┐   │  │
│  │   │  a2a_messages    │   │   │  swarm_missions                │   │  │
│  │   │  swarm_events   │   │   │  swarm_agent_events             │   │  │
│  │   │  defense_analytics│   │   │  swarm_findings                 │   │  │
│  │   │  blackboard:{id} │   │   │  swarm_agent_states             │   │  │
│  │   │  findings:{id}:* │   │   │  swarm_exploit_attempts         │   │  │
│  │   └──────────────────┘   │   │  swarm_timeline                 │   │  │
│  │                          │   └────────────────────────────────┘   │  │
│  │   Docker Sandbox         │         LLM Providers                    │  │
│  │   ┌──────────────────┐   │   ┌────────────────────────────────┐   │  │
│  │   │ vibecheck-sandbox│   │   │ OpenRouter (Cloud)            │   │  │
│  │   │ Kali-based       │   │   │ Ollama (Local)                 │   │  │
│  │   │ --network host   │   │   └────────────────────────────────┘   │  │
│  │   └──────────────────┘   │                                          │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent System

### Agent Roles

| Agent | Role | Primary Function | LLM Model |
|-------|------|------------------|-----------|
| **Commander** | Orchestrator | Strategic planning, task assignment, phase decisions | OpenRouter Qwen3-235B → Ollama |
| **Alpha** | Reconnaissance | Network scanning, vulnerability discovery, intelligence gathering | Ollama qwen2.5-coder |
| **Gamma** | Exploitation | Exploit execution, self-reflection, payload generation | Ollama qwen2.5-coder |
| **Critic** | Evaluator | Exploit result analysis, success/failure determination | Ollama qwen2.5-coder |
| **HITL Gate** | Safety | Destructive payload detection, human approval | N/A (pattern matching) |

### 1. Commander Agent (`agents/commander.py`)

The **Commander** is the brain of the operation. It uses an LLM to:
- Decompose mission objectives into task assignments
- Evaluate intelligence from field agents
- Decide next phase (recon → exploitation → complete)
- Adapt strategy based on Blue Team defensive analytics
- Enforce vector rotation (OWASP Top 10 diversity)

**Key Methods:**
- `commander_plan()`: Generates initial task assignments
- `commander_observe()`: Evaluates results, decides next actions

**Prompts:**
- `PLAN_PROMPT`: Strategic planning based on objective and target
- `OBSERVE_PROMPT`: Result evaluation with PentAGI v4.0 enhancements

**Vector Rotation Policy (Mandated):**
1. Rotate through 3+ distinct OWASP categories before mission end
2. If SQLi works → pivot to XSS, IDOR, Auth Bypass
3. Mark compromised endpoints, never repeat on same endpoint
4. Track successful vectors in `blackboard[SUCCESSFUL_VECTORS]`

### 2. Alpha Recon Agent (`agents/alpha_recon.py`)

**Alpha** performs reconnaissance using real tools:
- Port scanning (nmap)
- HTTP fingerprinting (curl)
- Vulnerability scanning (nuclei)
- Web search (OSINT)

**Modes:**
- **Live Mode**: Network reconnaissance against running targets
- **Static Mode**: Code analysis for GitHub repos/local paths

**Execution Flow:**
1. Receives task assignments from Commander
2. Uses LLM to decide which tools to run
3. Executes tools in Docker sandbox
4. Analyzes output with LLM
5. Emits `INTELLIGENCE_REPORT` messages

### 3. Gamma Exploit Agent (`agents/gamma_exploit.py`)

**Gamma** is the exploitation specialist with self-reflection capabilities:

**OWASP Top 10 Arsenal:**
1. IDOR (Insecure Direct Object Reference)
2. Broken Access Control
3. Sensitive Data Exposure
4. XSS (Cross-Site Scripting)
5. SQL Injection
6. Authentication Bypass
7. XXE (XML External Entity)
8. File Upload
9. Client-Side Bypass
10. SSRF (Server-Side Request Forgery)
11. Path Traversal/LFI
12. Prototype Pollution
13. Open Redirect
14. Command Injection

**Two-Phase Execution:**
- **Phase 1**: Token-generating exploits (SQLi, Auth, XSS)
- **Phase 2**: Token-consuming exploits (IDOR, Auth Bypass) - only if tokens available

**PentAGI Self-Reflection Loop:**
```
Gamma → Execute → Critic Evaluate → (if failed) → Self-Reflect → Retry
```

**Destructive Pattern Detection:**
```python
DESTRUCTIVE_PATTERNS = [
    r"\bDROP\s+",
    r"\bDELETE\s+FROM",
    r"\bTRUNCATE\s+",
    r"\bSHUTDOWN\b",
    r"rm\s+-rf",
    r"format\s+",
]
```

### 4. Critic Agent (`agents/critic_agent.py`)

**Critic** evaluates exploit results with deterministic pre-checks + LLM:

**Deterministic Rules:**
- HTTP 500 on injection = server crash = **success**
- HTTP 401/403 = auth wall, not failure
- HTTP 404 = endpoint doesn't exist
- IDOR: 200 + JSON with `id` field = **success**

**Error Types:**
- `syntax_error`: Fix Python/curl syntax
- `waf_block`: Try encoding, obfuscation
- `auth_failure`: Try different credentials/tokens
- `timeout`: Use time-based blind injection
- `not_found`: Verify endpoint path
- `rate_limit`: Add delays

**Success Criteria by Exploit Type:**
| Type | Success Indicators |
|------|-------------------|
| SQLi | Boolean-based true/false, UNION works, SQLite errors |
| XSS | Script tags in response, 200/201 with confirmation |
| Auth Bypass | Admin access, JWT in response, elevated privileges |
| IDOR | Access to other users' data, different IDs |
| XXE | File contents retrieved, error messages showing filesystem |

### 5. HITL Safety Gate

The **HITL Gate** pauses missions for human approval when destructive patterns are detected:
- Pattern matching against `DESTRUCTIVE_PATTERNS`
- Sets `needs_human_approval = True`
- Waits for `human_response` (approve/deny/modify)

---

## State Management

### RedTeamState Schema (`agents/state.py`)

```python
class RedTeamState(TypedDict):
    # Mission Identity
    mission_id: str
    objective: str
    target: str

    # Phase Tracking
    phase: Literal["planning", "recon", "exploitation", "reporting", "complete"]

    # Message Accumulator (operator.add = appends to list)
    messages: Annotated[list[A2AMessage], operator.add]

    # Shared Intelligence
    blackboard: dict[str, Any]  # Aggregated findings from all agents

    # Agent Outputs
    recon_results: list[dict[str, Any]]   # Alpha's intelligence reports
    exploit_results: list[dict[str, Any]]  # Gamma's exploit results

    # Commander Strategy
    current_tasks: list[dict[str, Any]]  # Active task assignments
    strategy: str  # Commander's current strategy text

    # Control Flow
    iteration: int  # Loop counter
    max_iterations: int  # Safety limit
    needs_human_approval: bool  # HITL gate flag
    human_response: str | None  # Human's decision

    # Self-Reflection (Phase 3)
    reflection_count: int  # Number of self-correction attempts
    max_reflections: int  # Max retries for failed exploits
    pending_exploit: dict[str, Any] | None  # Exploit awaiting HITL approval

    # Global Auth Chaining
    discovered_credentials: dict[str, dict]  # JWT, cookies, tokens
    contextual_memory: dict[str, Any]  # Session tokens, cookies

    # Mission Report
    report: dict[str, Any] | None
    report_path: str | None

    # Blue Team Integration
    blue_team_findings: list[Any]
    blue_team_recon_results: list[dict[str, Any]]
    blue_team_intelligence_brief: str

    # Error Handling
    errors: list[str]

    # Mode Configuration
    mode: str | None  # "live" or "static" (auto-detected)
    fast_mode: bool  # Skip recon tools
    repo_url: str | None
```

### Target Type Detection

```python
def detect_target_type(target: str) -> str:
    """
    Auto-detect target mode:
    - "live": http/https URLs (web applications)
    - "static": GitHub repos, local paths (code analysis)
    """
    if "github.com" in target:
        return "static"
    if target.startswith(("http://", "https://")):
        return "live"
    if Path(target).exists():
        return "static"
    return "live"  # Default
```

---

## A2A Messaging

### Message Types (`agents/a2a/messages.py`)

```python
class MessageType(Enum):
    TASK_ASSIGNMENT = "task_assignment"      # Commander → Agents
    INTELLIGENCE_REPORT = "intel_report"     # Alpha → Commander
    EXPLOIT_RESULT = "exploit_result"        # Gamma → Commander
    STATUS_UPDATE = "status_update"          # Agent → Blackboard
    ERROR = "error"                          # Any → Error handler
    HITL_REQUEST = "hitl_request"            # Gamma → Human
    HITL_RESPONSE = "hitl_response"          # Human → Gamma
```

### A2AMessage Schema

```python
class A2AMessage(TypedDict):
    id: str                    # UUID
    type: MessageType          # Message category
    sender: AgentRole          # COMMANDER, ALPHA, GAMMA, CRITIC
    recipient: AgentRole       # Target agent or ALL
    priority: Priority         # LOW, MEDIUM, HIGH, CRITICAL
    payload: dict[str, Any]    # Message content
    timestamp: str             # ISO 8601
    mission_id: str            # Mission reference
```

### Redis Streams Architecture

**Streams:**
- `a2a_messages`: Inter-agent communications
- `red_team_events`: Kill chain monitoring
- `defense_analytics`: Blue Team → Red Team intel

**Blackboard Keys:**
```
redteam:blackboard:{mission_id}:*     # Mission state
redteam:findings:{mission_id}:*       # Shared findings
redteam:payload_attempts:{mission_id} # Retry tracking
```

---

## Tool System

### Available Tools (`agents/tools/`)

| Tool | File | Purpose | Sandbox |
|------|------|---------|---------|
| **nmap** | `nmap_tool.py` | Port scanning, service detection | Kali |
| **nuclei** | `nuclei_tool.py` | Vulnerability scanning with templates | Kali |
| **curl** | `curl_tool.py` | HTTP requests, API probing | Kali |
| **python** | `python_exec.py` | Custom script execution | Kali |
| **sqlmap** | `sqlmap_tool.py` | SQL injection detection | Kali |
| **ffuf** | `ffuf_tool.py` | Web fuzzing | Kali |
| **jwt_tool** | `jwt_tool.py` | JWT manipulation | Kali |
| **web_search** | `web_search_tool.py` | OSINT (Google, Shodan, CVE) | N/A |

### Tool Registry (`agents/tools/registry.py`)

```python
class ToolRegistry:
    """Dynamic tool registry for runtime discovery."""
    
    def register(self, tool: ToolSpec) -> None
    def get(self, name: str) -> ToolSpec | None
    def list_tools() -> list[ToolSpec]
    def execute(self, tool_name: str, **kwargs) -> ExecResult
```

### Tool Specification

```python
@dataclass
class ToolSpec:
    name: str
    description: str
    args_schema: dict[str, str]  # arg_name -> description
    execute: Callable[..., Awaitable[ExecResult]]
```

---

## Sandbox Execution

### Docker Sandbox (`sandbox/sandbox_manager.py`)

**Image:** `vibecheck-sandbox:latest` (Kali-based)

**Two Modes:**
1. **SharedSandboxManager**: Single container for all missions (recommended)
   - Uses `--network host` on Linux
   - Uses `host.docker.internal` on Windows/Mac

2. **SandboxManager**: Per-mission containers (legacy)

### Execution Result

```python
@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str
    command: str
    timed_out: bool = False
    
    @property
    def success(self) -> bool:
        return self.exit_code in (0, 18) and not self.timed_out
```

### Keep-Alive Rule

If exit code is `-1`, the container is automatically restarted and the command is retried once.

---

## LLM Integration

### Unified LLM Client (`core/llm_client.py`)

**Cascade Order:**
1. OpenRouter primary model (`google/gemini-2.0-flash-exp:free`)
2. OpenRouter fallback chain (`deepseek-r1:free` → `qwq-32b:free`)
3. Ollama local (`qwen2.5-coder:7b-instruct`)

**Configuration:**
```python
# Environment variables
OPENROUTER_API_KEY=your_key_here
OLLAMA_BASE_URL=http://localhost:11434
COMMANDER_MODEL=openrouter:deepseek/deepseek-r1-0528:free
ALPHA_MODEL=ollama:qwen2.5-coder:7b-instruct
GAMMA_MODEL=ollama:qwen2.5-coder:7b-instruct
```

### Model Routing

```python
async def chat(model, messages, temperature, fallback_model, **kwargs):
    # Ollama models (no "/") → direct Ollama
    # OpenRouter models (with "/") → OpenRouter cascade → Ollama fallback
```

---

## Database Schema

### Supabase Tables

```sql
-- Mission records
swarm_missions (
    id UUID PRIMARY KEY,
    target TEXT,
    objective TEXT,
    status TEXT,  -- running, completed, failed, cancelled
    progress INTEGER,
    current_phase TEXT,
    iteration INTEGER,
    created_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
)

-- Agent state snapshots
swarm_agent_states (
    id UUID PRIMARY KEY,
    mission_id UUID REFERENCES swarm_missions,
    agent_id TEXT,
    agent_name TEXT,
    agent_team TEXT,  -- red, blue
    status TEXT,
    iteration INTEGER,
    task TEXT,
    last_updated TIMESTAMP
)

-- Kill chain events
swarm_events (
    id UUID PRIMARY KEY,
    mission_id UUID REFERENCES swarm_missions,
    event_type TEXT,
    agent_name TEXT,
    stage TEXT,  -- planning, reconnaissance, exploitation, reporting
    title TEXT,
    description TEXT,
    target TEXT,
    success BOOLEAN,
    iteration INTEGER,
    created_at TIMESTAMP
)

-- Discovered vulnerabilities
swarm_findings (
    id UUID PRIMARY KEY,
    mission_id UUID REFERENCES swarm_missions,
    title TEXT,
    severity TEXT,  -- critical, high, medium, low, info
    description TEXT,
    finding_type TEXT,
    confirmed BOOLEAN,
    agent_name TEXT,
    target TEXT,
    endpoint TEXT,
    evidence JSONB
)

-- Exploit attempts
swarm_exploit_attempts (
    id UUID PRIMARY KEY,
    mission_id UUID REFERENCES swarm_missions,
    event_id UUID REFERENCES swarm_events,
    exploit_type TEXT,
    target_url TEXT,
    method TEXT,
    payload TEXT,
    payload_hash TEXT,
    tool_used TEXT,
    success BOOLEAN,
    response_code INTEGER,
    error_type TEXT,
    stdout TEXT,
    evidence JSONB,
    execution_time_ms INTEGER,
    created_at TIMESTAMP
)
```

---

## Execution Flow

### LangGraph State Machine (`agents/graph.py`)

```
┌─────────────────────────────────────────────────────────────────┐
│                    build_red_team_graph()                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Entry: blue_team_enrichment                                    │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              blue_team_enrichment                        │   │
│  │  (Query static analysis findings, inject into state)      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              commander_plan                              │   │
│  │  (Generate task assignments based on objective)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              alpha_recon                                 │   │
│  │  (Execute recon tools, generate intel reports)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              gamma_exploit                               │   │
│  │  (Execute exploits with two-phase token chaining)        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              hitl_gate                                   │   │
│  │  (Check for destructive patterns, request approval)     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              commander_observe                           │   │
│  │  (Evaluate results, decide next phase)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│            ┌─────────────┴─────────────┐                       │
│            │                           │                       │
│            ▼                           ▼                       │
│   ┌──────────────────┐        ┌──────────────────┐             │
│   │     continue     │        │      report      │             │
│   │  (next cycle)    │        │   (complete)     │             │
│   └────────┬─────────┘        └────────┬─────────┘             │
│            │                             │                       │
│            │    ┌───────────────────────┘                       │
│            │    │                                               │
│            ▼    ▼                                               │
│   ┌──────────────────┐                                         │
│   │  alpha_recon     │ (loop back)                             │
│   │  (next iteration)│                                         │
│   └──────────────────┘                                         │
│                                                                  │
│            If phase == "complete" OR iteration >= max:          │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              generate_report                             │   │
│  │  (Create mission report, save to files)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│                         END                                      │
└─────────────────────────────────────────────────────────────────┘
```

### should_continue() Routing Logic

```python
def should_continue(state: RedTeamState) -> str:
    phase = state.get("phase")
    iteration = state.get("iteration", 0)
    max_iter = state.get("max_iterations", 5)

    if phase == "complete":
        return "report"      # Generate report and end
    if iteration >= max_iter:
        return "report"      # Max iterations reached
    if phase == "exploitation":
        return "exploit_only"  # Skip recon, go to exploit
    return "continue"        # Normal cycle: recon → exploit
```

### Mission Initialization

```python
from agents.graph import build_red_team_graph, create_initial_state

# Create initial state
state = create_initial_state(
    objective="Assess security of web application",
    target="http://localhost:3000",
    max_iterations=5,
    mission_id=None,  # Auto-generated UUID
    max_reflections=3,
    fast_mode=False,
    mode=None,  # Auto-detected
)

# Build and run graph
graph = build_red_team_graph()
result = await graph.ainvoke(state)
```

---

## API Endpoints

### FastAPI Application (`api/main.py`)

**Base URL:** `http://localhost:8000`

#### Mission Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/mission/start` | Start a new mission |
| `GET` | `/api/mission/{mission_id}/status` | Get mission status |
| `GET` | `/api/mission/{mission_id}/report` | Get full mission report |
| `POST` | `/api/mission/{mission_id}/cancel` | Cancel running mission |
| `GET` | `/api/missions` | List all missions |

#### WebSocket Real-time Updates

| Endpoint | Description |
|----------|-------------|
| `WS /ws/missions/{mission_id}` | Real-time mission event stream |

**WebSocket Events:**
- `connection_established`: Initial connection confirmation
- `exploit_result`: Gamma completed an exploit
- `intelligence_report`: Alpha discovered information
- `critic_analysis`: Critic evaluated an exploit
- `phase_transition`: Mission phase changed

#### Supabase Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/swarm/missions` | List swarm missions from Supabase |
| `GET` | `/api/swarm/mission/{mission_id}` | Get specific mission |
| `GET` | `/api/swarm/mission/{mission_id}/agents` | Get agent states |
| `GET` | `/api/swarm/mission/{mission_id}/events` | Get mission events |
| `GET` | `/api/swarm/mission/{mission_id}/findings` | Get vulnerabilities found |
| `GET` | `/api/swarm/mission/{mission_id}/exploits` | Get exploit attempts |

---

## Configuration

### Environment Variables (`.env`)

```bash
# LLM Configuration
OPENROUTER_API_KEY=sk-or-v1-...
OLLAMA_BASE_URL=http://localhost:11434

# Model Selection
COMMANDER_MODEL=openrouter:deepseek/deepseek-r1-0528:free
COMMANDER_MODEL_FALLBACK=ollama:qwen2.5-coder:7b-instruct
ALPHA_MODEL=ollama:qwen2.5-coder:7b-instruct
GAMMA_MODEL=ollama:qwen2.5-coder:7b-instruct
EXPLOIT_MODEL=ollama:qwen2.5-coder:7b-instruct
CRITIC_MODEL=ollama:qwen2.5-coder:7b-instruct

# Redis
REDIS_URL=redis://localhost:6379

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Sandbox
SANDBOX_IMAGE=vibecheck-sandbox:latest
SANDBOX_TIMEOUT=300

# Mission Defaults
MAX_ITERATIONS=5
MAX_REFLECTIONS=3
```

### Docker Compose Services

```yaml
# From docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  juiceshop:
    image: bkimminich/juice-shop:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
```

---

## Key Features Deep Dive

### 1. PentAGI Self-Reflection Loop

When an exploit fails, Gamma enters a self-reflection cycle:

```python
async def _self_reflect_and_retry(state, failed_exploit):
    # Get Critic feedback
    feedback = analyze_exploit_result(failed_exploit)
    
    # Generate corrected payload
    corrected = await llm.chat(
        model=REFLECTION_PROMPT.format(
            error_type=feedback.error_type,
            feedback=feedback,
            original_payload=failed_exploit.payload
        )
    )
    
    # Retry with corrected payload
    if corrected.corrected:
        return await gamma_execute(corrected.new_tool_call)
```

### 2. Global Token Chaining

Discovered tokens propagate across exploits via Redis:

```python
# When Gamma finds a valid JWT
await redis_bus.findings_store(mission_id, "tokens", "admin_jwt", token_value)

# Subsequent exploits automatically receive tokens
shared_tokens = await redis_bus.findings_read(mission_id, "tokens")
# → {"admin_jwt": "eyJ...", "session_cookie": "..."}
```

### 3. Blue Team Bridge

Static analysis findings from Blue Team enrich Red Team reconnaissance:

```python
async def enrich_state_with_blue_team_findings(state, target, repo_url):
    # Query Blue Team's static analysis
    findings = await blue_team_client.query_findings(repo_url)
    
    # Convert to reconnaissance format
    recon_results = [
        {
            "asset": f"Line {f['line_number']}: {f['file_path']}",
            "finding": f["title"],
            "confidence": f["severity"] == "critical" and 0.95 or 0.8,
            "evidence": f["description"],
            "recommended_action": f["remediation"]
        }
        for f in findings
    ]
    
    return {"blue_team_recon_results": recon_results, ...}
```

### 4. WAF Adaptation

When blocked by WAF, Gamma automatically tries encoding:

```python
# Original payload blocked
payload = "admin' OR 1=1--"

# Retry with URL encoding
encoded = quote(payload)  # admin%27%20OR%201%3D1--

# Retry with double encoding
double_encoded = quote(encoded)  # admin%2527%2520OR%25201%253D1%252D%252D
```

### 5. Vector Rotation Enforcement

Commander enforces OWASP category diversity:

```python
# In OBSERVE_PROMPT
VECTOR_ROTATION_POLICY = """
1. You MUST rotate through at least 3 distinct OWASP categories
2. If SQLi was successful, pivot to XSS, IDOR, Auth Bypass
3. Mark compromised endpoints, never repeat on same endpoint
4. Prioritize unexplored OWASP Top 10: A01-A10
"""
```

---

## Security Considerations

### Sandbox Isolation

- All tools execute in Docker containers
- Network access controlled via Docker networking
- No direct host filesystem access
- Memory limit: 2GB per container

### HITL Safety Gate

- Pattern detection for destructive commands
- Human approval required before execution
- Audit trail of all approvals/denials

### Rate Limiting

- Nuclei: `-rl 50` (50 requests/second)
- LLM API: Built-in retry with exponential backoff

---

## Troubleshooting

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Nuclei OOM** | Process killed | Use `-bs 25` to reduce bulk size |
| **OpenRouter 429** | Rate limit error | Automatic fallback to Ollama |
| **Docker Connection** | Tools can't reach target | Use `--network host` on Linux |
| **Ollama Model** | Model not found | `ollama pull qwen2.5-coder:7b-instruct` |

### Health Check

```bash
python scripts/health_check.py
```

### Debug Mode

```bash
# Run single mission
python scripts/swarm_worker.py --once

# Verbose logging
export LOG_LEVEL=DEBUG
python scripts/run_mission.py --target http://localhost:3000
```

---

## File Structure

```
swarm module/
├── README.md
│
├── Red_team/
│   ├── README.md
│   ├── pyproject.toml
│   ├── docker-compose.yml
│   ├── .env
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── commander.py          # Mission orchestrator (1083 lines)
│   │   ├── alpha_recon.py        # Reconnaissance agent
│   │   ├── gamma_exploit.py      # Exploitation agent (1823 lines)
│   │   ├── critic_agent.py       # Exploit evaluator
│   │   ├── report_generator.py   # Mission reports
│   │   ├── graph.py              # LangGraph state machine
│   │   ├── state.py              # TypedDict schema
│   │   ├── schemas.py            # Pydantic models
│   │   │
│   │   ├── tools/
│   │   │   ├── registry.py       # Dynamic tool registry
│   │   │   ├── nmap_tool.py
│   │   │   ├── nuclei_tool.py
│   │   │   ├── curl_tool.py
│   │   │   ├── python_exec.py
│   │   │   ├── sqlmap_tool.py
│   │   │   ├── ffuf_tool.py
│   │   │   ├── jwt_tool.py
│   │   │   └── web_search_tool.py
│   │   │
│   │   └── a2a/
│   │       ├── messages.py       # A2AMessage schemas
│   │       └── blackboard.py     # Shared knowledge base
│   │
│   ├── core/
│   │   ├── config.py             # Settings from env
│   │   ├── llm_client.py         # Unified LLM interface
│   │   ├── openrouter_client.py  # OpenRouter API
│   │   ├── ollama_client.py      # Ollama local LLM
│   │   ├── redis_bus.py          # Redis Streams A2A
│   │   ├── supabase_client.py    # PostgreSQL persistence
│   │   ├── blue_team_bridge.py   # Blue → Red intel
│   │   ├── qdrant_memory.py      # Vector memory
│   │   ├── falkordb_client.py    # Graph database
│   │   ├── parsing.py            # JSON parsing utilities
│   │   ├── banners.py           # CLI banners
│   │   └── platform_compat.py    # Cross-platform utils
│   │
│   ├── sandbox/
│   │   ├── sandbox_manager.py    # Docker container lifecycle
│   │   ├── executor_api.py       # Tool execution API
│   │   └── Dockerfile.sandbox    # Kali-based image
│   │
│   ├── scripts/
│   │   ├── swarm_worker.py       # Redis consumer worker
│   │   ├── swarm_worker_new.py   # Newer worker version
│   │   ├── run_mission.py        # Mission launcher
│   │   ├── health_check.py       # Service verification
│   │   └── submit_mission.py     # Mission submission
│   │
│   ├── api/
│   │   └── main.py               # FastAPI endpoints
│   │
│   ├── frontend/
│   │   ├── package.json
│   │   └── src/
│   │
│   ├── tests/
│   │   ├── pytest.ini
│   │   ├── conftest.py
│   │   ├── test_agents.py
│   │   ├── test_swarm_pipeline.py
│   │   └── test_live_integration.py
│   │
│   ├── Docs/
│   │   ├── RED_TEAM.md
│   │   ├── PRD.md
│   │   └── REALTIME_REPORTING_SETUP.md
│   │
│   └── reports/                   # Mission reports
│       └── mission_*.{json,txt}
│
└── shared/
    ├── requirements.txt
    └── setup.sh
```

---

## Dependencies

### Core
- `langgraph>=0.0.50` - State machine orchestration
- `langchain>=0.1.0` - LLM framework
- `redis>=5.0.0` - Message bus
- `openai>=1.0.0` - OpenRouter API
- `ollama>=0.1.0` - Local LLM
- `docker>=6.1.0` - Container management
- `supabase>=2.0.0` - Database
- `pydantic>=2.5.0` - Data validation
- `fastapi>=0.100.0` - API framework
- `uvicorn>=0.22.0` - ASGI server

---

## Future Enhancements

1. **Multi-Target Missions**: Parallel assessment of multiple targets
2. **Custom Tool Plugins**: User-defined tool integration
3. **Web Dashboard**: Real-time 3D mission visualization
4. **Report Templates**: Customizable report formats
5. **Continuous Vulnerability Scanning**: Scheduled reassessment
6. **Integration with CVE Databases**: Automatic exploit verification
