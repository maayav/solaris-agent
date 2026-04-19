# DeerFlow Integration Master Plan: Solaris-Agent Upgrade Roadmap

> Master roadmap for integrating DeerFlow's best patterns into solaris-agent. Covers streaming, memory, context management, config system, sandbox improvements, and architectural enhancements. Ordered by impact vs effort.

---

## Executive Summary

| Problem | DeerFlow Solution | Impact |
|---------|-----------------|--------|
| LLM output shows only after completion | SSE streaming via StreamBridge | Users see token-by-token output in real-time |
| No cross-mission learning | LLM-extracted fact memory | Agents improve with every mission |
| Context window grows unbounded | SummarizationMiddleware | Long missions stay coherent |
| Hardcoded model names | config.yaml + model factory | Hot-swap models, no code changes |
| No sandbox warm pool | AioSandboxProvider patterns | Faster mission start, no cold-start delay |
| Monolithic 1800-line agents | Middleware chain architecture | Isolated concerns, easier testing |
| No concurrency guard on missions | RunManager | Prevent race conditions on simultaneous missions |

---

## Phase Map

```
Week 1-2: Foundation
    ├── Config System (YAML + auto-reload)
    └── Model Factory (dynamic model loading)

Week 2-3: Real-Time Streaming          ← HIGHEST USER IMPACT
    ├── StreamBridge (backend)
    ├── SSE Endpoints (FastAPI)
    ├── Stream Worker (LangGraph integration)
    └── Frontend streaming hook + UI components

Week 4-5: Memory & Context Intelligence
    ├── Memory Schema + Storage
    ├── Memory Extraction Prompt + Updater
    ├── Debounced Update Queue
    ├── Memory Injection into System Prompts
    └── Context Window Summarization

Week 6: Sandbox & Infrastructure
    ├── Sandbox Warm Pool
    ├── Idle Timeout & Cleanup
    └── Run Manager (concurrency guards)

Week 7+: Architectural (Optional)
    ├── Middleware Chain Refactor
    ├── Dynamic Tool Loading
    └── Skills System
```

---

## Phase 1: Config System (Week 1, Days 1-3)

**Impact:** Medium | **Effort:** Low | **Risk:** Low

### Why First

Everything else depends on a config system. Currently model names are hardcoded in `llm_client.py`, sandbox params are env vars, and changing any config requires code edits and restarts.

### Deliverables

**File:** `config/solaris_config.py`

```python
import os
import json
import yaml
from pathlib import Path
from dataclasses import dataclass
from typing import Any

@dataclass
class ModelConfig:
    use: str           # e.g. "langchain_openai.ChatOpenAI"
    kwargs: dict       # passed to constructor
    when_thinking_enabled: dict | None = None

@dataclass
class SolarisConfig:
    default_model: str
    models: dict[str, ModelConfig]
    sandbox_replicas: int = 3
    sandbox_idle_timeout: int = 300
    memory_enabled: bool = True
    memory_max_facts: int = 150
    memory_debounce_seconds: int = 10
    summarization_enabled: bool = True
    summarization_trigger_tokens: int = 60000

    @classmethod
    def from_file(cls, path: str = "config.yaml") -> "SolarisConfig":
        ...  # parse YAML, resolve $ENV_VAR patterns

_config: SolarisConfig | None = None
_config_mtime: float | None = None

def get_config() -> SolarisConfig:
    global _config, _config_mtime
    path = Path("config.yaml")
    mtime = path.stat().st_mtime if path.exists() else None
    if _config is None or _config_mtime != mtime:
        _config = SolarisConfig.from_file()
        _config_mtime = mtime
    return _config
```

**File:** `config.yaml` (root of swarm module)

```yaml
default_model: openrouter-llama

models:
  openrouter-llama:
    use: langchain_openai.ChatOpenAI
    kwargs:
      model: meta-llama/llama-3.3-70b-instruct
      base_url: https://openrouter.ai/api/v1
      api_key: $OPENROUTER_API_KEY
      temperature: 0.7

  openrouter-llama-fast:
    use: langchain_openai.ChatOpenAI
    kwargs:
      model: meta-llama/llama-3.2-3b-instruct
      base_url: https://openrouter.ai/api/v1
      api_key: $OPENROUTER_API_KEY

  ollama-local:
    use: langchain_ollama.ChatOllama
    kwargs:
      model: llama3.1:8b
      base_url: http://localhost:11434

  memory-model: openrouter-llama-fast    # lightweight for memory extraction
  summarization-model: openrouter-llama-fast

sandbox:
  replicas: 3
  idle_timeout_seconds: 300

memory:
  enabled: true
  max_facts: 150
  debounce_seconds: 10
  max_injection_tokens: 2000

summarization:
  enabled: true
  trigger_tokens: 60000
  keep_messages: 15
```

### Acceptance Criteria

- [ ] `config.yaml` loads on startup
- [ ] Changing `config.yaml` takes effect without restart (mtime check)
- [ ] `$ENV_VAR` patterns resolve correctly
- [ ] All hardcoded model names in `llm_client.py` replaced with `get_config().default_model`

---

## Phase 2: Real-Time Streaming (Week 2-3, Days 4-10)

**Impact:** Very High | **Effort:** Medium | **Risk:** Medium

### Why Second

This is the most visible improvement for users. 30 seconds of silence while agents work is bad UX. Tokens streaming in real-time transforms the experience.

### Dependencies

None — can be implemented independently of config and memory.

### Deliverables

| File | Purpose |
|------|---------|
| `core/stream_bridge.py` | In-memory event queue per run_id |
| `core/sse_utils.py` | SSE formatting + consumer generator |
| `core/stream_worker.py` | LangGraph → StreamBridge adapter |
| `api/main.py` | SSE FastAPI endpoints added |
| `frontend/hooks/useAgentStream.ts` | React hook consuming SSE |
| `frontend/components/StreamingMessage.tsx` | Token-streaming message component |
| `frontend/components/StreamingIndicator.tsx` | Animated "thinking" dots |

### Key Implementation Notes

1. `asyncio.create_task()` for background agent execution (non-blocking HTTP response)
2. `X-Accel-Buffering: no` header required for nginx
3. `stream_mode="messages"` in LangGraph gives token-level chunks
4. Late-join replay: StreamBridge stores all events, subscribers get history then live
5. Existing WebSocket endpoint preserved for backward compat during transition

### Acceptance Criteria

- [ ] `curl -N .../runs/stream` shows tokens appearing in real-time
- [ ] Frontend shows characters appearing as LLM generates
- [ ] Tool calls visible as issued (not after completion)
- [ ] Tool results visible as returned
- [ ] Stop button aborts stream
- [ ] Error states handled gracefully
- [ ] No regression on existing WebSocket mission events

> **Full plan:** `plans/streaming-implementation-plan.md`

---

## Phase 3: Cross-Mission Memory (Week 4-5, Days 11-18)

**Impact:** High | **Effort:** High | **Risk:** Medium

### Why Third

Once agents stream in real-time, the next biggest gap is that they're amnesiac. Every mission starts from scratch. Memory makes agents progressively better.

### Dependencies

- Phase 1 (Config System) — memory model config
- Optional: Supabase table migration

### Deliverables

| File | Purpose |
|------|---------|
| `core/memory/schema.py` | Red-team memory data structures |
| `core/memory/storage.py` | FileMemoryStorage + SupabaseMemoryStorage |
| `core/memory/prompt.py` | LLM extraction prompt (red-team adapted) |
| `core/memory/updater.py` | LLM extraction + deduplication + max_facts enforcement |
| `core/memory/queue.py` | Debounced async update queue |
| `core/memory/signals.py` | Correction/reinforcement detection |
| `core/memory/injection.py` | Token-aware memory formatting |
| `core/memory/summarizer.py` | Context window compression |

### Key Differences from DeerFlow

| Aspect | DeerFlow | Solaris-Agent Adaptation |
|--------|----------|------------------------|
| Memory sections | user preferences | mission intelligence (exploits, evasions, targets) |
| Message filtering | drops tool results | preserves tool results (nmap, nuclei output is valuable) |
| Fact categories | preference/knowledge/behavior | exploit_pattern/evasion/target_fingerprint/auth_pattern/correction |
| Storage | filesystem JSON | Supabase JSONB column (or filesystem fallback) |
| Debounce | 30s | 10s (missions are time-bounded) |
| Extra fact fields | source_error | source_error + target_type + source_mission_id |
| Injection | `<memory>` block | `<mission_memory>` block |

### Intelligence That Gets Remembered

```
After mission on Laravel target:
  "SQLi via id parameter effective on Laravel <8.x with debug mode"
  "WAF detected sqlmap default UA, rotate to custom UA"
  "Path traversal on /api/../.env works when debug=true"

After WAF bypass success:
  "space2comment+charunicodeencode tamper bypasses ModSecurity CRS 3.3"

After failed JWT attack:
  "RS256 key confusion failed — server validates iat claim strictly" [correction]
```

### Acceptance Criteria

- [ ] Memory extracted after every mission turn
- [ ] Facts not duplicated across missions
- [ ] Correction facts include `source_error`
- [ ] Memory injected into Commander, Alpha, Gamma system prompts
- [ ] max_facts=150 enforced (evicts lowest confidence)
- [ ] Injection stays under 2000 tokens (tiktoken counted)
- [ ] Atomic writes prevent memory.json corruption
- [ ] 3rd mission shows intelligence from missions 1 and 2

> **Full plan:** `plans/memory-implementation-plan.md`

---

## Phase 4: Context Window Summarization (Week 5, Days 16-18)

**Impact:** Medium-High | **Effort:** Low-Medium | **Risk:** Low

### Why

Long missions generate thousands of tokens of messages. Without summarization, context windows overflow and agents start losing information.

### Dependencies

- Phase 3 (Memory System) — summarization hook must flush to memory before compressing

### Implementation

Wired directly into the LangGraph graph as a preprocessing step before each node:

```python
# In graph.py, before each agent node:
async def preprocess_messages(state: RedTeamState) -> RedTeamState:
    messages = state["messages"]
    new_messages = await maybe_summarize(
        messages=messages,
        llm_client=llm_client,
        memory_queue=get_memory_queue(),
        thread_id=state["mission_id"],
    )
    if new_messages:
        return {**state, "messages": new_messages}
    return state
```

### Trigger Config

```yaml
summarization:
  enabled: true
  trigger_tokens: 60000    # trigger at 60k tokens
  keep_messages: 15        # always keep last 15 messages
  model_name: openrouter-llama-fast
```

### Acceptance Criteria

- [ ] Long missions (50+ turns) don't overflow context
- [ ] Summary message appears in place of compressed messages
- [ ] Key mission state (current target, active vector) preserved in summary
- [ ] Memory queue flushed before compression (nothing lost)

---

## Phase 5: Sandbox Warm Pool (Week 6, Days 19-21)

**Impact:** Medium | **Effort:** Medium | **Risk:** Low

### Current Problem

`SandboxManager` (977 lines) destroys and recreates Docker containers between missions. Cold-start delay is significant (5-15 seconds per container).

### DeerFlow Pattern to Adopt

```python
class WarmPoolSandboxManager:
    _active: dict[str, SandboxInfo] = {}
    _warm_pool: dict[str, tuple[SandboxInfo, float]] = {}
    _max_replicas: int = 3
    _idle_timeout: int = 300  # 5 minutes

    def acquire(self, mission_id: str) -> Sandbox:
        sandbox_id = hashlib.sha256(mission_id.encode()).hexdigest()[:8]

        # Fast path: warm pool
        if sandbox_id in self._warm_pool:
            info, _ = self._warm_pool.pop(sandbox_id)
            self._active[sandbox_id] = info
            return Sandbox(id=sandbox_id, url=info.url)

        # Create new (with LRU eviction if at capacity)
        if len(self._active) + len(self._warm_pool) >= self._max_replicas:
            self._evict_oldest()

        return self._create_new(sandbox_id)

    def release(self, sandbox_id: str) -> None:
        if sandbox_id in self._active:
            info = self._active.pop(sandbox_id)
            self._warm_pool[sandbox_id] = (info, time.time())  # don't destroy

    def _idle_cleanup_loop(self) -> None:
        # Background thread, runs every 60s
        while True:
            now = time.time()
            for sid, (info, released_at) in list(self._warm_pool.items()):
                if now - released_at > self._idle_timeout:
                    self._destroy(sid)
                    del self._warm_pool[sid]
            time.sleep(60)
```

### Acceptance Criteria

- [ ] Second mission on same target reuses warm container (< 1s start)
- [ ] Idle containers cleaned up after 5 minutes
- [ ] No more than `replicas` containers running simultaneously
- [ ] Orphaned containers reconciled on startup

---

## Phase 6: Run Manager / Concurrency Guards (Week 6, Day 22)

**Impact:** Medium | **Effort:** Low | **Risk:** Low

### Current Problem

Two simultaneous mission starts on the same target can race on:
- Redis streams (duplicate A2A messages)
- Supabase writes (overlapping state updates)
- Sandbox allocation (two missions sharing one container)

### Implementation

```python
class MissionRunManager:
    _active: dict[str, str] = {}  # mission_id → run_id
    _lock = asyncio.Lock()

    async def create_or_reject(self, mission_id: str) -> str:
        async with self._lock:
            if mission_id in self._active:
                raise HTTPException(409, "Mission already running")
            run_id = uuid4().hex
            self._active[mission_id] = run_id
            return run_id

    async def complete(self, mission_id: str) -> None:
        async with self._lock:
            self._active.pop(mission_id, None)

    async def cancel(self, mission_id: str) -> None:
        # Cancel active run, clean up resources
        ...
```

### Acceptance Criteria

- [ ] Concurrent mission starts on same target return 409
- [ ] Cancelled missions release sandbox and Redis stream resources
- [ ] Run manager state survives short network interruptions

---

## Phase 7: Middleware Chain Refactor (Week 7+, Optional)

**Impact:** Medium (developer velocity) | **Effort:** Very High | **Risk:** High

### What It Means

Break `commander.py` (1096 lines) and `gamma_exploit.py` (1823 lines) into:

```
agents/
  commander/
    __init__.py
    core.py          # ~200 lines of actual commander logic
    middlewares/
      loop_detection.py
      tool_error_handling.py
      token_usage.py
      context_summarization.py
```

### Why Optional / Later

The monolithic agents work. This is a refactor for maintainability, not correctness. The risk of introducing regressions during a major refactor is significant. Do this only after:
1. Streaming works
2. Memory works
3. Good test coverage exists

### Specific Middlewares to Extract

| Middleware | Currently In | Extract To |
|------------|-------------|-----------|
| Loop detection | Commander logic | `middlewares/loop_detection.py` |
| Tool error normalization | Per-agent try/catch | `middlewares/tool_error.py` |
| Token budget tracking | Implicit | `middlewares/token_usage.py` |
| Context summarization | None | `middlewares/summarization.py` |

---

## Phase 8: Dynamic Tool Loading (Week 8+, Optional)

**Impact:** Low-Medium | **Effort:** Medium | **Risk:** Low

### Current State

Tools (nmap, nuclei, sqlmap, ffuf, etc.) are manually implemented and hardcoded.

### DeerFlow Pattern

```yaml
# config.yaml
tools:
  - use: swarm.tools.nmap:nmap_tool
  - use: swarm.tools.nuclei:nuclei_tool
  - use: swarm.tools.sqlmap:sqlmap_tool

  # Per-agent allowlists
  agents:
    gamma_exploit:
      tools: [nmap_tool, nuclei_tool, sqlmap_tool, ffuf_tool]
    alpha_recon:
      tools: [nmap_tool, web_search_tool, curl_tool]
```

### Benefit

- Hot-add new exploit tools without code changes
- Per-agent tool allowlists (don't expose destructive tools to Critic/HITL)
- MCP server integration for specialized tooling

---

## Phase 9: Skills System (Week 9+, Optional)

**Impact:** Low-Medium | **Effort:** Low | **Risk:** Very Low**

### What It Enables

OWASP exploit playbooks and target-type guides as loadable markdown files:

```
agent-system-prompts/
  skills/
    owasp-sqli/SKILL.md          # SQL injection methodology
    owasp-auth-bypass/SKILL.md   # broken auth playbook
    target-laravel/SKILL.md      # Laravel-specific attack surface
    target-spring/SKILL.md       # Spring Boot attack surface
    jwt-attacks/SKILL.md         # JWT attack techniques
```

Agents load skills on demand → keeps base system prompt lean, detailed guidance available when needed.

---

## Dependency Graph

```
Phase 1 (Config)
    └── Phase 2 (Streaming)    ← independent, but config helps model selection
    └── Phase 3 (Memory)       ← needs config for model selection
        └── Phase 4 (Summarization)  ← needs memory for flush hook

Phase 5 (Sandbox)             ← fully independent
Phase 6 (Run Manager)         ← fully independent

Phase 7 (Middleware)          ← needs Phase 3+4 (to wrap them as middleware)
Phase 8 (Tool Loading)        ← needs Phase 1 (config drives tool list)
Phase 9 (Skills)              ← fully independent
```

---

## Effort & Timeline Summary

| Phase | Feature | Effort | Timeline | Impact |
|-------|---------|--------|----------|--------|
| 1 | Config System | 2-3 days | Week 1 | Enabler |
| 2 | Streaming | 6-7 days | Week 2-3 | Very High |
| 3 | Memory | 7-8 days | Week 4-5 | High |
| 4 | Summarization | 2-3 days | Week 5 | Medium-High |
| 5 | Sandbox Warm Pool | 3-4 days | Week 6 | Medium |
| 6 | Run Manager | 1-2 days | Week 6 | Medium |
| 7 | Middleware Refactor | 7-10 days | Week 7+ | Dev velocity |
| 8 | Dynamic Tool Loading | 3-4 days | Week 8+ | Low-Medium |
| 9 | Skills System | 2-3 days | Week 9+ | Low-Medium |

---

## What NOT to Change (Preserve These)

| Feature | Reason |
|---------|--------|
| Redis Streams A2A | Only distributed inter-agent messaging. DeerFlow is in-process only |
| PentAGI self-reflection loop | Unique gamma_exploit.py intelligence. No DeerFlow equivalent |
| OWASP vector rotation | Commander-enforced diversity. Core red team logic |
| HITL safety gate | Destructive pattern detection. Critical safety mechanism |
| Auth chaining | `discovered_credentials` propagation. Core exploit capability |
| Supabase structured mission data | Relational mission history with SQL queries |
| Blue team bridge | Static analysis → recon enrichment. Unique capability |

---

## Documentation Index

| Document | Contents |
|----------|---------|
| `docs/deerflow-analysis.md` | Full feature comparison, all DeerFlow systems |
| `docs/deerflow-streaming.md` | Streaming architecture deep dive |
| `docs/deerflow-memory-context.md` | Memory & context management deep dive |
| `plans/streaming-implementation-plan.md` | Step-by-step streaming integration |
| `plans/memory-implementation-plan.md` | Step-by-step memory integration |
| `plans/deerflow-integration-master-plan.md` | This document |
