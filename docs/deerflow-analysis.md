# DeerFlow Analysis: What We Can Use in Solaris-Agent & Swarm

> DeerFlow is a production-grade multi-agent orchestration framework by ByteDance built on LangGraph + LangChain. This document catalogs every useful pattern, system, and implementation detail relevant to solaris-agent's swarm module.

---

## Table of Contents

1. [Project Comparison](#1-project-comparison)
2. [Subagent Execution Engine](#2-subagent-execution-engine)
3. [Middleware Chain Architecture](#3-middleware-chain-architecture)
4. [LLM Integration & Model Factory](#4-llm-integration--model-factory)
5. [Memory System](#5-memory-system)
6. [Context Window Management](#6-context-window-management)
7. [Streaming Architecture](#7-streaming-architecture)
8. [Sandbox Architecture](#8-sandbox-architecture)
9. [Tool System](#9-tool-system)
10. [Configuration System](#10-configuration-system)
11. [Run Manager](#11-run-manager)
12. [Skills System](#12-skills-system)
13. [What Solaris-Agent Does Better](#13-what-solaris-agent-does-better)
14. [Priority Integration Matrix](#14-priority-integration-matrix)

---

## 1. Project Comparison

| Aspect | DeerFlow | Solaris-Agent Swarm |
|--------|----------|---------------------|
| Framework | LangGraph + LangChain | LangGraph |
| Agent Count | 1 lead + N subagents (dynamic) | 5 fixed (Commander, Alpha, Gamma, Critic, HITL) |
| Agent Communication | In-process thread pools | Redis Streams A2A |
| Persistence | SQLite / PostgreSQL checkpoints | Supabase (full mission history) |
| Memory | LLM-extracted facts, cross-session | None |
| Context Compression | SummarizationMiddleware | None |
| Streaming | SSE (Server-Sent Events) real-time | Batch only (shows after completion) |
| Sandbox | Docker + warm pool + idle timeout | Docker (no warm pool) |
| Config | config.yaml with auto-reload | Environment variables only |
| Model Loading | Dynamic factory + resolve_class | Hardcoded in llm_client.py |
| Tool Loading | Dynamic via config + MCP | Manual per-tool implementation |
| Domain | General purpose assistant | Red team penetration testing |

---

## 2. Subagent Execution Engine

**DeerFlow location:** `packages/harness/deerflow/subagents/executor.py` (611 lines)

### Architecture

```
SubagentExecutor
├── _scheduler_pool  (3 ThreadPoolExecutor workers)
│   └── submits to _execution_pool with timeout enforcement
└── _execution_pool  (3 ThreadPoolExecutor workers)
    └── runs SubagentExecutor._aexecute() via asyncio.run()
```

### Lifecycle States

```
PENDING → RUNNING → COMPLETED
                 → FAILED
                 → TIMED_OUT
                 → CANCELLED
```

### Key Pattern: `execute_async()`

```python
def execute_async(self, task: str, task_id: str | None = None) -> str:
    result = SubagentResult(task_id=task_id or uuid4(), status=SubagentStatus.PENDING)
    self._scheduler_pool.submit(self._schedule, result, task)
    return result.task_id  # caller polls this

# Polling:
while True:
    result = self.get_result(task_id)
    if result.status in (COMPLETED, FAILED, TIMED_OUT, CANCELLED):
        break
    await asyncio.sleep(5)
```

### Key Pattern: Streaming Collection in `_aexecute()`

```python
async for chunk in agent.astream(state, config=run_config, stream_mode="values"):
    messages = chunk.get("messages", [])
    if messages:
        last_message = messages[-1]
        if isinstance(last_message, AIMessage):
            result.ai_messages.append(last_message.model_dump())
```

### Config: `SubagentConfig`

```python
@dataclass
class SubagentConfig:
    name: str
    description: str
    system_prompt: str
    tools: list[str]               # allowlist
    disallowed_tools: list[str]    # denylist
    model: str | None
    max_turns: int
    timeout_seconds: int
```

### Relevance to Solaris-Agent

- Replace or complement Redis Streams A2A with in-process thread pools for parallel agent execution
- Timeout enforcement prevents runaway agents (Gamma Exploit can run for very long)
- CANCELLED status maps cleanly to HITL gate abort

---

## 3. Middleware Chain Architecture

**DeerFlow location:** `packages/harness/deerflow/agents/middlewares/` + `factory.py` (372 lines)

### Full Middleware Chain (in order)

| Position | Middleware | Always? | Purpose |
|----------|-----------|---------|---------|
| 0 | ThreadDataMiddleware | Yes | Per-thread workspace/uploads/outputs dirs |
| 1 | UploadsMiddleware | Yes | Inject uploaded file context |
| 2 | SandboxMiddleware | If sandbox | Docker container lifecycle |
| 3 | DanglingToolCallMiddleware | Yes | Patch missing ToolMessages |
| 4 | LLMErrorHandlingMiddleware | Yes | Convert LLM errors to recoverable state |
| 5 | GuardrailMiddleware | If configured | Pre-tool-call authorization |
| 6 | SandboxAuditMiddleware | If sandbox | Audit logging |
| 7 | ToolErrorHandlingMiddleware | Yes | Convert exceptions to ToolMessages |
| 8 | SummarizationMiddleware | If enabled | Token-based context compression |
| 9 | TodoListMiddleware | If plan_mode | Task tracking |
| 10 | TokenUsageMiddleware | If enabled | Token counting per turn |
| 11 | TitleMiddleware | Yes | Auto-generate thread title |
| 12 | MemoryMiddleware | If enabled | Queue conversation for memory update |
| 13 | ViewImageMiddleware | If vision | Base64 image injection |
| 14 | DeferredToolFilterMiddleware | Yes | Hide deferred tool schemas |
| 15 | SubagentLimitMiddleware | If subagent | Truncate excess task calls |
| 16 | LoopDetectionMiddleware | Yes | Break repetitive tool loops |
| 17 | ClarificationMiddleware | Yes | Intercept ask_clarification |

### Factory Pattern

```python
@dataclass
class RuntimeFeatures:
    sandbox: bool = False
    memory: bool = False
    summarization: bool = False
    subagent: bool = False
    vision: bool = False
    auto_title: bool = False
    guardrail: bool = False
    plan_mode: bool = False

def create_deerflow_agent(features: RuntimeFeatures, extra_middleware=None) -> Agent:
    chain = _assemble_from_features(features)
    if extra_middleware:
        _insert_extra(chain, extra_middleware)  # @Next/@Prev anchors
    return Agent(chain)
```

### `@Next` / `@Prev` Decorator Pattern

```python
@dataclass
class Next:
    anchor: type[AgentMiddleware]  # insert AFTER this middleware

@dataclass
class Prev:
    anchor: type[AgentMiddleware]  # insert BEFORE this middleware
```

### Relevance to Solaris-Agent

The current agents (Commander: 1096 lines, Gamma Exploit: 1823+ lines) have all concerns merged. Middleware would cleanly extract:
- **LoopDetectionMiddleware** — break repetitive nmap/nuclei loops
- **ToolErrorHandlingMiddleware** — normalize exploit tool failures
- **SummarizationMiddleware** — compress long mission contexts
- **TokenUsageMiddleware** — track costs per mission

---

## 4. LLM Integration & Model Factory

**DeerFlow location:** `packages/harness/deerflow/models/factory.py` (123 lines)

### `create_chat_model()`

```python
def create_chat_model(
    name: str | None = None,
    thinking_enabled: bool = False,
    **kwargs
) -> BaseChatModel:
    config = get_app_config()
    model_config = config.models[name or config.default_model]

    # Dynamic class loading
    cls = resolve_class(model_config.use, BaseChatModel)

    # thinking_enabled toggle with per-model overrides
    if thinking_enabled and model_config.when_thinking_enabled:
        kwargs.update(model_config.when_thinking_enabled)

    return cls(**{**model_config.kwargs, **kwargs})
```

### Supported Providers (via `resolve_class`)

| Provider | Class Path |
|----------|-----------|
| OpenAI | `langchain_openai.ChatOpenAI` |
| Anthropic | `langchain_anthropic.ChatAnthropic` |
| OpenRouter | `langchain_openai.ChatOpenAI` (custom base_url) |
| Ollama | `langchain_ollama.ChatOllama` |
| vLLM | `langchain_openai.ChatOpenAI` (custom base_url) |
| Claude Code | OAuth-based |

### Config Example (`config.yaml`)

```yaml
models:
  default: openrouter-llama
  openrouter-llama:
    use: langchain_openai.ChatOpenAI
    kwargs:
      model: meta-llama/llama-3.3-70b-instruct
      base_url: https://openrouter.ai/api/v1
      api_key: $OPENROUTER_API_KEY
    when_thinking_enabled:
      model: meta-llama/llama-3.1-70b-instruct:thinking
```

### Current Solaris-Agent Problem

`swarm module/Red_team/core/llm_client.py`:
```python
# Hardcoded cascade — brittle, no config-driven fallback
async def chat(model="llama3.1:8b", fallback_model="llama3.2:3b", ...):
    try:
        response = await ollama_client.chat(model=model, ...)
    except:
        response = await openrouter_client.chat(model=fallback_model, ...)
```

### Relevance to Solaris-Agent

Replace hardcoded model names with config.yaml + `create_chat_model()`. Supports:
- Multiple OpenRouter fallback models
- Model-specific thinking/reasoning toggles
- Tracing callbacks (LangSmith / Langfuse)
- Hot-swap models without restart

---

## 5. Memory System

> Covered in depth in `docs/deerflow-memory-context.md`

**DeerFlow location:** `packages/harness/deerflow/agents/memory/`

### Summary

| File | Lines | Purpose |
|------|-------|---------|
| `updater.py` | 561 | LLM-based fact extraction + deduplication |
| `queue.py` | 266 | Debounced async update queue |
| `storage.py` | 206 | File persistence with mtime cache |
| `prompt.py` | 363 | Update & injection prompts |
| `message_processing.py` | 109 | Message filtering + signal detection |
| `summarization_hook.py` | 31 | Flush memory before summarization |

### What Solaris-Agent Could Store

```json
{
  "facts": [
    { "content": "SQLi via parameter 'id' highly effective on Laravel targets", "category": "knowledge", "confidence": 0.9 },
    { "content": "Target range 192.168.1.0/24 uses Nginx with WAF blocking SQLMap", "category": "context", "confidence": 0.85 },
    { "content": "JWT RS256 rotation failed — target validates exp strictly", "category": "correction", "confidence": 0.95 }
  ]
}
```

---

## 6. Context Window Management

> Covered in depth in `docs/deerflow-memory-context.md`

**DeerFlow location:** `packages/harness/deerflow/agents/middlewares/summarization_middleware.py`

### Trigger Config

```yaml
summarization:
  enabled: true
  trigger:
    type: tokens
    value: 80000       # trigger at 80k tokens
  keep:
    type: messages
    value: 20          # always keep last 20 messages
  trim_tokens_to_summarize: 4000
  model_name: llama3.2:3b  # lightweight model for summarization
```

### Flush-Before-Compress Guarantee

Before compressing, `memory_flush_hook()` is called — ensuring about-to-be-lost messages are extracted into persistent memory first. Nothing is lost.

---

## 7. Streaming Architecture

> Covered in depth in `docs/deerflow-streaming.md`

**Short summary:**

```
LangGraph graph.astream()
    ↓ StreamBridge.publish()  (MemoryStreamBridge)
    ↓ SSE endpoint (FastAPI StreamingResponse)
    ↓ Frontend useStream() hook (@langchain/langgraph-sdk/react)
    ↓ Incremental render via MarkdownContent
```

Solaris-agent currently shows LLM output only after full completion. Zero real-time streaming for agent runs.

---

## 8. Sandbox Architecture

**DeerFlow location:** `packages/harness/deerflow/community/aio_sandbox/aio_sandbox_provider.py` (704 lines)

### Warm Pool Pattern

```python
_sandboxes: dict[str, SandboxInfo]        # active sandboxes
_warm_pool: dict[str, tuple[SandboxInfo, float]]  # released but still running

# Acquire: check warm pool first (fast path)
if sandbox_id in self._warm_pool:
    info, _ = self._warm_pool.pop(sandbox_id)
    return AioSandbox(id=sandbox_id, base_url=info.sandbox_url)

# Release: move to warm pool instead of destroy
self._warm_pool[sandbox_id] = (info, time.time())
```

### Idle Timeout (background thread)

```python
# Every 60s, check warm pool
for sid, (info, released_at) in list(self._warm_pool.items()):
    if time.time() - released_at > self.idle_timeout:
        self._destroy_sandbox(sid)
        del self._warm_pool[sid]
```

### Deterministic Sandbox IDs

```python
sandbox_id = hashlib.sha256(thread_id.encode()).hexdigest()[:8]
# Same thread_id → same container → cross-process discovery
```

### Cross-Process File Locking

```python
with FileLock(f"/tmp/sandbox_{sandbox_id}.lock"):
    # atomic check-and-create
```

### What Solaris-Agent Is Missing

`swarm module/Red_team/sandbox/sandbox_manager.py` (977 lines):
- No warm pool (cold-start delay on every mission)
- No idle timeout (containers leak)
- No cross-process coordination (race conditions possible)
- No LRU eviction under replica limits

---

## 9. Tool System

**DeerFlow location:** `packages/harness/deerflow/tools/tools.py` (137 lines)

### Dynamic Tool Loading

```python
def get_available_tools(groups, include_mcp, model_name, subagent_enabled):
    tools = []
    for tool_config in config.tools:
        tool = resolve_variable(tool_config.use, BaseTool)  # dynamic import
        tools.append(tool)
    if include_mcp:
        tools.extend(get_mcp_tools())   # lazy, mtime-cached
    if subagent_enabled:
        tools.append(task_tool)
    return tools
```

### Deferred Tool Registry

MCP tools are hidden until the agent calls `tool_search` — prevents bloating the tool schema for every call:

```python
# DeferredToolRegistry
registry.register(tool)       # hide from schema
result = registry.reveal(name) # expose on demand
```

### Relevance to Solaris-Agent

Current tools (nmap, nuclei, curl, sqlmap, ffuf, jwt_tool, web_search) are all manually implemented. Dynamic loading via config would allow:
- Hot-adding new exploit tools without code changes
- Per-mission tool allowlists (only give Gamma the tools it needs for this vector)
- MCP server integration for specialized tooling

---

## 10. Configuration System

**DeerFlow location:** `packages/harness/deerflow/config/app_config.py` (397 lines)

### Auto-Reload Pattern

```python
_app_config: AppConfig | None = None
_app_config_mtime: float | None = None

def get_app_config() -> AppConfig:
    current_mtime = os.path.getmtime(config_path)
    if _app_config is None or _app_config_mtime != current_mtime:
        _load_and_cache_app_config(config_path)
    return _app_config
```

### Environment Variable Resolution

```python
# In config.yaml:
api_key: $OPENROUTER_API_KEY

# Resolved recursively at load time
cls.resolve_env_variables(config)
```

### Runtime Context Override (thread-local)

```python
with push_current_app_config(test_config):
    result = run_agent(...)  # uses test_config within this block
# restored to previous config
```

### Relevance to Solaris-Agent

Currently zero config.yaml. All config is env vars hardcoded in docker-compose or `.env`. Adding `config.yaml` enables:
- Hot-swapping models per agent role
- Enabling/disabling swarm features per deployment
- Per-mission config overrides (test vs production targets)

---

## 11. Run Manager

**DeerFlow location:** `packages/harness/deerflow/runtime/runs/manager.py` (210 lines)

### Concurrency Guards

```python
class RunManager:
    _runs: dict[str, RunRecord]
    _lock: asyncio.Lock

    async def create_or_reject(self, thread_id, ...) -> RunRecord:
        async with self._lock:
            if await self.has_inflight(thread_id):
                raise ConflictError("run already in progress")
            return await self.create(...)

    async def cancel(self, run_id, action="interrupt"):
        # action: "interrupt" | "rollback"
```

### Multitask Strategies

| Strategy | Behavior |
|----------|---------|
| `reject` | Return 409 conflict if run in progress |
| `interrupt` | Cancel existing run, start new one |
| `rollback` | Cancel existing, revert checkpoint, start new |

### Delayed Cleanup

```python
async def cleanup(run_id, delay=300):
    await asyncio.sleep(delay)   # 5 min grace period
    del self._runs[run_id]
```

### Relevance to Solaris-Agent

Currently no concurrency guard on mission runs. Two concurrent missions on the same target could race on Redis streams and Supabase writes.

---

## 12. Skills System

**DeerFlow location:** `packages/harness/deerflow/skills/`

### SKILL.md Format

```markdown
---
name: web-recon
description: Optimized workflow for web application reconnaissance
license: mit
---
# Web Recon Skill

## OWASP Top 10 Checklist
...
## Tool Selection by Target Type
...
```

### Loading

```python
def load_skills(skills_dir: Path) -> list[Skill]:
    for skill_md in skills_dir.rglob("SKILL.md"):
        frontmatter = parse_frontmatter(skill_md)
        skills.append(Skill(name=frontmatter["name"], path=skill_md, ...))
    return skills
```

### Injection into System Prompt

```xml
<skill_system>
Available skills:
- web-recon: Optimized workflow for web application reconnaissance
  Location: /skills/web-recon/SKILL.md

Load a skill when task matches its description using the read_skill tool.
</skill_system>
```

### Relevance to Solaris-Agent

All exploit knowledge is currently hardcoded in agent system prompts. Skills would allow:
- OWASP Top 10 playbooks as loadable files
- Per-CVE exploit guides
- Target-type specific reconnaissance templates
- Dynamic loading only when needed (keeps base prompt lean)

---

## 13. What Solaris-Agent Does Better

These are unique to solaris-agent — do NOT replace them with DeerFlow patterns:

| Feature | Why It's Better |
|---------|----------------|
| Redis Streams A2A | Actual distributed messaging across processes/containers. DeerFlow is in-process only |
| PentAGI self-reflection loop | LLM-conditioned retry on failed exploits — unique to gamma_exploit.py |
| OWASP vector rotation policy | Commander-enforced diversity across 10 exploit categories |
| HITL safety gate | Destructive pattern detection with human-in-the-loop approval |
| Auth chaining | `discovered_credentials` + `contextual_memory` propagated across exploit attempts |
| Supabase persistence | Full structured mission history, findings, exploit attempts with relational queries |
| Blue team bridge | Static analysis findings → reconnaissance enrichment |
| Domain-specific agents | Commander, Alpha Recon, Gamma Exploit, Critic — purpose-built for red teaming |

---

## 14. Priority Integration Matrix

### Tier 1 — High Impact, Low Invasiveness (do first)

| Feature | Files to Copy/Adapt | Estimated Effort |
|---------|-------------------|-----------------|
| Config YAML + auto-reload | `config/app_config.py` | 2-3 days |
| Model factory | `models/factory.py` | 1-2 days |
| SSE streaming | `runtime/stream_bridge/`, gateway routes | 3-4 days |
| Frontend streaming hook | `useStream`, `MessageList`, `StreamingIndicator` | 2-3 days |

### Tier 2 — High Impact, Medium Effort

| Feature | Files to Copy/Adapt | Estimated Effort |
|---------|-------------------|-----------------|
| Cross-mission memory | `agents/memory/` (all files) | 4-5 days |
| Summarization middleware | `middlewares/summarization_middleware.py` | 2-3 days |
| Sandbox warm pool | `aio_sandbox_provider.py` patterns | 3-4 days |
| Run manager concurrency | `runtime/runs/manager.py` | 1-2 days |

### Tier 3 — Lower Priority, Architectural

| Feature | Files to Copy/Adapt | Estimated Effort |
|---------|-------------------|-----------------|
| Middleware chain refactor | `agents/factory.py` pattern | 5-7 days |
| Dynamic tool loading | `tools/tools.py` + config | 3-4 days |
| Skills system | `skills/` directory | 3-4 days |
| Subagent executor | `subagents/executor.py` | 3-4 days |

---

*See `plans/deerflow-integration-master-plan.md` for the full roadmap with phases and dependencies.*
*See `docs/deerflow-streaming.md` for streaming deep dive.*
*See `docs/deerflow-memory-context.md` for memory deep dive.*
