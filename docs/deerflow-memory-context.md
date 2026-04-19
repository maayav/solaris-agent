# DeerFlow Memory & Context Management: Deep Dive

> How DeerFlow extracts facts from conversations, persists them across sessions, compresses context windows, and injects memory back into every new turn.

---

## Table of Contents

1. [The Full Memory Pipeline](#1-the-full-memory-pipeline)
2. [Memory Data Structure](#2-memory-data-structure)
3. [Fact Categories & Confidence Scoring](#3-fact-categories--confidence-scoring)
4. [Message Processing & Signal Detection](#4-message-processing--signal-detection)
5. [The Memory Update Prompt](#5-the-memory-update-prompt)
6. [Memory Updater Logic](#6-memory-updater-logic)
7. [Debounced Update Queue](#7-debounced-update-queue)
8. [File Storage & Caching](#8-file-storage--caching)
9. [Context Window Compression](#9-context-window-compression)
10. [Memory Injection into Prompts](#10-memory-injection-into-prompts)
11. [Memory REST API](#11-memory-rest-api)
12. [Configuration Reference](#12-configuration-reference)
13. [LangGraph Checkpointer](#13-langgraph-checkpointer)
14. [Per-Thread File Isolation](#14-per-thread-file-isolation)
15. [Adaptation for Solaris-Agent](#15-adaptation-for-solaris-agent)

---

## 1. The Full Memory Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│                       TURN N STARTS                              │
│                                                                  │
│  FileMemoryStorage.load(agent_name)                              │
│       │  reads memory.json (mtime-cached)                        │
│       ▼                                                          │
│  format_memory_for_injection(memory_data, max_tokens=2000)       │
│       │  token-aware, sorts facts by confidence                  │
│       ▼                                                          │
│  System Prompt ← <memory>...</memory> block injected             │
│       │                                                          │
│       ▼                                                          │
│  LangGraph AgentState.messages (full history)                    │
│       │                                                          │
│       ▼                                                          │
│  SummarizationMiddleware checks token count                      │
│       ├── UNDER LIMIT → continue                                 │
│       └── OVER LIMIT  → fire memory_flush_hook() FIRST           │
│                          then compress old messages              │
│                                                                  │
│  Agent runs, LLM responds                                        │
│       │                                                          │
│       ▼                                                          │
│  MemoryMiddleware (after_agent hook)                             │
│       │  filter_messages_for_memory()                            │
│       │  detect_correction() / detect_reinforcement()            │
│       │  enqueue ConversationContext                             │
│       ▼                                                          │
│  MemoryUpdateQueue (debounced 30s, dedup by thread_id)           │
│       │                                                          │
│       ▼                                                          │
│  MemoryUpdater.aupdate_memory()                                  │
│       │  LLM call with MEMORY_UPDATE_PROMPT                      │
│       │  parse JSON response                                     │
│       │  _apply_updates() with deduplication                     │
│       ▼                                                          │
│  FileMemoryStorage.save() — atomic write (temp + rename)         │
│                                                                  │
│  ┌─────────────────────────────────────────┐                     │
│  │           TURN N+1 STARTS               │                     │
│  │  New memory.json loaded → injected      │                     │
│  └─────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Memory Data Structure

**File:** `agents/memory/storage.py:24-40`

Full JSON schema stored at `{base_dir}/agents/{agent_name}/memory.json`:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-04-15T10:30:00Z",

  "user": {
    "workContext": {
      "summary": "2-3 sentences: professional role, active projects, tech stack",
      "updatedAt": "2026-04-15T10:30:00Z"
    },
    "personalContext": {
      "summary": "1-2 sentences: language preferences, working style, interests",
      "updatedAt": "2026-04-15T10:28:00Z"
    },
    "topOfMind": {
      "summary": "3-5 sentences: multiple ongoing priorities and current goals",
      "updatedAt": "2026-04-15T10:26:00Z"
    }
  },

  "history": {
    "recentMonths": {
      "summary": "4-6 sentences: detailed recent activities and accomplishments",
      "updatedAt": "2026-04-15T10:24:00Z"
    },
    "earlierContext": {
      "summary": "3-5 sentences: patterns from 3-12 months ago",
      "updatedAt": "2026-04-15T10:22:00Z"
    },
    "longTermBackground": {
      "summary": "2-4 sentences: foundational context and long-term patterns",
      "updatedAt": "2026-04-15T10:20:00Z"
    }
  },

  "facts": [
    {
      "id": "fact_abc123",
      "content": "User prefers concise Python with type hints over verbose Java",
      "category": "preference",
      "confidence": 0.95,
      "createdAt": "2026-04-15T09:50:00Z",
      "source": "thread_xyz",
      "sourceError": null
    },
    {
      "id": "fact_def456",
      "content": "Claude is better for reasoning tasks than GPT-4 for this user's use case",
      "category": "correction",
      "confidence": 0.90,
      "createdAt": "2026-04-15T09:55:00Z",
      "source": "thread_abc",
      "sourceError": "Used GPT-4 for complex reasoning task, got poor results"
    }
  ]
}
```

### Storage Paths

| Scope | Path |
|-------|------|
| Global (shared across agents) | `{base_dir}/memory.json` |
| Per-agent | `{base_dir}/agents/{agent_name}/memory.json` |
| Thread workspace | `{base_dir}/threads/{thread_id}/user-data/workspace/` |
| Thread uploads | `{base_dir}/threads/{thread_id}/user-data/uploads/` |
| Thread outputs | `{base_dir}/threads/{thread_id}/user-data/outputs/` |

`base_dir` resolution priority:
1. Constructor argument
2. `$DEER_FLOW_HOME` environment variable
3. `{backend_dir}/.deer-flow` (repo-local fallback)

---

## 3. Fact Categories & Confidence Scoring

**File:** `agents/memory/prompt.py`

### Categories

| Category | Description | Example |
|----------|-------------|---------|
| `preference` | Tools, styles, approaches, formats | "Prefers TypeScript over JavaScript" |
| `knowledge` | Domain expertise, tech familiarity | "Expert in LangGraph framework" |
| `context` | Role, employer, project background | "Works at Acme Corp on the data platform" |
| `behavior` | Working patterns, habits | "Typically asks for solutions, not explanations" |
| `goal` | Objectives, learning targets | "Learning Kubernetes for production deployment" |
| `correction` | Agent mistakes + correct approach | "My suggestion to use X was wrong; correct approach is Y" |

### Confidence Levels

| Range | Meaning | Trigger |
|-------|---------|---------|
| 0.9 – 1.0 | Explicitly stated by user | "I always use..." |
| 0.7 – 0.8 | Strongly implied | Consistent tool choices across sessions |
| 0.5 – 0.6 | Inferred pattern | Behavioral signals, indirect hints |

### `correction` Category Special Fields

When `category == "correction"`:
- `content`: The correct approach to remember
- `sourceError`: The wrong approach to AVOID (injected as "avoid: ..." in prompts)

---

## 4. Message Processing & Signal Detection

**File:** `agents/memory/message_processing.py`

### `filter_messages_for_memory()`

Before queuing for memory update, messages are filtered:

```python
def filter_messages_for_memory(messages: list[AnyMessage]) -> list[AnyMessage]:
    result = []
    skip_next_ai = False

    for msg in messages:
        if isinstance(msg, HumanMessage):
            # Strip <uploaded_files> blocks (ephemeral, session-specific)
            content = re.sub(r"<uploaded_files>.*?</uploaded_files>", "", msg.content, flags=re.DOTALL)
            if content.strip():
                result.append(HumanMessage(content=content))
                skip_next_ai = False
            else:
                skip_next_ai = True   # upload-only message: skip corresponding AI response too

        elif isinstance(msg, AIMessage):
            if not skip_next_ai:
                result.append(msg)   # keep final AI response only (skip tool calls/results)
            skip_next_ai = False

        # ToolMessages, ToolCallMessages etc. are dropped entirely

    return result
```

### Correction Detection Patterns

```python
CORRECTION_PATTERNS = (
    r"\bthat(?:'s| is) (?:wrong|incorrect)\b",
    r"\byou misunderstood\b",
    r"\btry again\b",
    r"\bredo\b",
    r"\bno[,.]?\s+(?:actually|that's not|you should)\b",
    # Chinese patterns:
    "不对", "你理解错了", "你理解有误", "重试", "重新来", "换一种", "改用",
)
```

### Reinforcement Detection Patterns

```python
REINFORCEMENT_PATTERNS = (
    r"\byes[,.]?\s+(?:exactly|perfect|that(?:'s| is) (?:right|correct|it))\b",
    r"\bperfect(?:[.!?]|$)",
    r"\bexactly\s+(?:right|correct)\b",
    r"\bthat(?:'s| is)\s+(?:exactly\s+)?(?:right|correct|what i (?:wanted|needed|meant))\b",
    # Chinese patterns:
    "对[，,]?\s*就是这样(?:[。！？!?.]|$)", "完全正确(?:[。！？!?.]|$)",
)
```

When correction detected → memory updater adds special hint to prompt:
```
IMPORTANT: The user has indicated a correction/mistake. Pay special attention
to what went wrong and ensure the correct approach is captured with high confidence.
```

When reinforcement detected → hint:
```
IMPORTANT: The user confirmed the approach was correct. Reinforce this pattern
in memory with high confidence.
```

---

## 5. The Memory Update Prompt

**File:** `agents/memory/prompt.py:15-131`

The actual prompt sent to the LLM for memory extraction:

```
You are a memory management system. Analyze this conversation and update the user's memory.

## Current Memory State
{current_memory_json}

## New Conversation
{formatted_conversation}

{correction_hint}

## Structured Reflection (do this before updating)

1. Error/Retry Detection: Did the user have to retry or correct the agent?
2. User Correction Detection: Did the user explicitly say something was wrong?
3. Project Constraint Discovery: Did you learn any constraints about the user's project?

## Memory Section Guidelines

### user.workContext (2-3 sentences)
- Professional role, active projects, tech stack being used
- Update when: new project mentioned, role change, tech stack shift

### user.personalContext (1-2 sentences)
- Language preferences, working style, personal interests
- Update when: language preference stated, style preference expressed

### user.topOfMind (3-5 sentences)
- Multiple ongoing priorities and what they're actively trying to accomplish
- Update every conversation if there's new relevant information

### history.recentMonths (4-6 sentences)
- Detailed recent activities, specific accomplishments, concrete outcomes
- Include version numbers, specific metrics, proper nouns

### history.earlierContext (3-5 sentences)
- Patterns from 3-12 months ago

### history.longTermBackground (2-4 sentences)
- Foundational context that rarely changes

## Facts Guidelines
- Prefer atomic, specific facts over vague summaries
- Include specific metrics, version numbers, proper nouns
- confidence: 0.9-1.0 (explicit) | 0.7-0.8 (implied) | 0.5-0.6 (inferred)
- Categories: preference | knowledge | context | behavior | goal | correction
- For corrections: set sourceError to what went wrong

## CRITICAL RULES
- DO NOT record file upload events in memory (they are ephemeral)
- Only record information that will be useful in FUTURE sessions
- Prefer updating existing summaries over adding redundant facts

## Output Format (JSON only, no other text)
{
  "user": {
    "workContext": {"summary": "...", "updatedAt": "ISO-8601"},
    "personalContext": {"summary": "...", "updatedAt": "ISO-8601"},
    "topOfMind": {"summary": "...", "updatedAt": "ISO-8601"}
  },
  "history": {
    "recentMonths": {"summary": "...", "updatedAt": "ISO-8601"},
    "earlierContext": {"summary": "...", "updatedAt": "ISO-8601"},
    "longTermBackground": {"summary": "...", "updatedAt": "ISO-8601"}
  },
  "newFacts": [
    {"content": "...", "category": "preference", "confidence": 0.9, "source": "{thread_id}", "sourceError": null}
  ],
  "factsToRemove": ["fact_id_1", "fact_id_2"]
}
```

---

## 6. Memory Updater Logic

**File:** `agents/memory/updater.py`

### `_apply_updates()` (lines 454-538)

```python
def _apply_updates(self, current_memory: dict, llm_response: dict) -> dict:
    updated = copy.deepcopy(current_memory)

    # Update user sections
    for section in ("workContext", "personalContext", "topOfMind"):
        if section in llm_response.get("user", {}):
            updated["user"][section] = llm_response["user"][section]

    # Update history sections
    for section in ("recentMonths", "earlierContext", "longTermBackground"):
        if section in llm_response.get("history", {}):
            updated["history"][section] = llm_response["history"][section]

    # Remove outdated facts
    facts_to_remove = set(llm_response.get("factsToRemove", []))
    updated["facts"] = [f for f in updated["facts"] if f["id"] not in facts_to_remove]

    # Add new facts with deduplication
    existing_fact_keys = {
        _fact_content_key(f.get("content"))
        for f in updated["facts"]
    }

    for new_fact in llm_response.get("newFacts", []):
        fact_key = _fact_content_key(new_fact.get("content"))
        if fact_key is not None and fact_key in existing_fact_keys:
            continue  # skip duplicate
        new_fact["id"] = f"fact_{uuid4().hex[:8]}"
        new_fact["createdAt"] = datetime.utcnow().isoformat()
        updated["facts"].append(new_fact)
        existing_fact_keys.add(fact_key)

    # Enforce max_facts limit: keep highest confidence
    if len(updated["facts"]) > self.max_facts:
        updated["facts"].sort(key=lambda f: f.get("confidence", 0), reverse=True)
        updated["facts"] = updated["facts"][:self.max_facts]

    updated["lastUpdated"] = datetime.utcnow().isoformat()
    return updated
```

### Deduplication Key

```python
def _fact_content_key(content: Any) -> str | None:
    if not content:
        return None
    return str(content).strip().casefold()
    # Case-insensitive, whitespace-stripped comparison
```

### Upload Mention Stripping

```python
_UPLOAD_SENTENCE_RE = re.compile(
    r'[^.!?]*\b(?:upload(?:ed)?|attach(?:ed)?|file|document|image)\b[^.!?]*[.!?]',
    re.IGNORECASE
)

def _strip_upload_mentions_from_memory(memory_text: str) -> str:
    return _UPLOAD_SENTENCE_RE.sub("", memory_text)
```

Applied to summaries before saving to prevent ghost references to uploaded files.

---

## 7. Debounced Update Queue

**File:** `agents/memory/queue.py`

### `ConversationContext` Dataclass

```python
@dataclass
class ConversationContext:
    thread_id: str
    messages: list[AnyMessage]
    timestamp: datetime
    agent_name: str | None = None
    correction_detected: bool = False
    reinforcement_detected: bool = False
```

### Queue Behavior

```python
class MemoryUpdateQueue:
    _queue: dict[str, ConversationContext]  # keyed by thread_id (dedup)
    _timer: threading.Timer | None
    _debounce_seconds: int = 30

    def add(self, context: ConversationContext):
        with self._lock:
            self._queue[context.thread_id] = context  # overwrite = dedup
            self._reset_timer()   # restart 30s countdown

    def _process_queue(self):
        # Called when timer fires (or flush() called)
        contexts = list(self._queue.values())
        self._queue.clear()
        for ctx in contexts:
            updater = MemoryUpdater()
            updater.update_memory(ctx)  # sync, runs in thread pool
```

### Why Debounce?

Multiple rapid messages in one conversation don't each trigger an LLM call. The queue waits 30s of inactivity, then processes once. Multiple messages from the same `thread_id` are deduplicated — only the latest snapshot is processed.

### Immediate Flush

```python
queue.add_nowait(context)    # adds AND processes immediately (bypasses debounce)
# Used by: memory_flush_hook() before summarization
```

### Global Singleton

```python
_queue: MemoryUpdateQueue | None = None
_lock = threading.Lock()

def get_memory_queue() -> MemoryUpdateQueue:
    global _queue
    with _lock:
        if _queue is None:
            _queue = MemoryUpdateQueue()
    return _queue
```

---

## 8. File Storage & Caching

**File:** `agents/memory/storage.py`

### `FileMemoryStorage`

```python
class FileMemoryStorage:
    _memory_cache: dict | None = None
    _cache_mtime: float | None = None

    def load(self) -> dict:
        current_mtime = self.path.stat().st_mtime
        if self._memory_cache is None or self._cache_mtime != current_mtime:
            self._memory_cache = json.loads(self.path.read_text())
            self._cache_mtime = current_mtime
        return self._memory_cache

    def save(self, data: dict) -> None:
        # Atomic write: write to temp file, then rename
        tmp_path = self.path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        tmp_path.rename(self.path)   # atomic on POSIX
        self._memory_cache = data
        self._cache_mtime = self.path.stat().st_mtime
```

**Why atomic write?** Multiple agents or threads could write simultaneously. The temp→rename pattern is atomic on Linux (POSIX rename syscall). Prevents partial writes that corrupt `memory.json`.

---

## 9. Context Window Compression

**File:** `agents/middlewares/summarization_middleware.py`

### How It Works

```python
class DeerFlowSummarizationMiddleware(SummarizationMiddleware):

    async def abefore_model(self, state, config, runtime):
        result = await self._amaybe_summarize(state, config, runtime)
        if result:
            return result    # replaces messages in state
        return None          # no change needed

    async def _amaybe_summarize(self, state, config, runtime):
        messages = state["messages"]
        total_tokens = self.token_counter(messages)

        if not self._should_summarize(messages, total_tokens):
            return None  # under limit, skip

        # CRITICAL: flush memory BEFORE losing messages
        cutoff_index = self._find_cutoff_index(messages, total_tokens)
        messages_to_summarize = messages[:cutoff_index]
        preserved_messages = messages[cutoff_index:]

        await self._fire_hooks(SummarizationEvent(
            messages_to_summarize=tuple(messages_to_summarize),
            preserved_messages=tuple(preserved_messages),
            thread_id=config.get("configurable", {}).get("thread_id"),
            agent_name=runtime.agent_name,
            runtime=runtime,
        ))

        # Now compress
        summary = await self._summarize(messages_to_summarize)

        return {
            "messages": [
                RemoveMessage(id=REMOVE_ALL_MESSAGES),   # clear entire history
                summary,                                  # insert compression
                *preserved_messages,                      # keep recent N messages
            ]
        }
```

### `_fire_hooks()` — Memory Flush Before Compression

```python
async def _fire_hooks(self, event: SummarizationEvent):
    for hook in self._before_summarization_hooks:
        await hook(event)
    # hooks include: memory_flush_hook (from summarization_hook.py)
```

### `memory_flush_hook()` — Save Before Compression

```python
# agents/memory/summarization_hook.py
async def memory_flush_hook(event: SummarizationEvent):
    all_messages = list(event.messages_to_summarize) + list(event.preserved_messages)
    filtered = filter_messages_for_memory(all_messages)

    if not any(isinstance(m, HumanMessage) for m in filtered):
        return  # nothing useful to save
    if not any(isinstance(m, AIMessage) for m in filtered):
        return

    correction = detect_correction(all_messages)
    reinforcement = detect_reinforcement(all_messages)

    context = ConversationContext(
        thread_id=event.thread_id,
        messages=filtered,
        timestamp=datetime.utcnow(),
        agent_name=event.agent_name,
        correction_detected=correction,
        reinforcement_detected=reinforcement,
    )

    get_memory_queue().add_nowait(context)  # immediate, not debounced
```

### Summarization Config

```yaml
# config.yaml
summarization:
  enabled: true
  model_name: llama3.2:3b      # use lightweight model
  trigger:
    type: tokens
    value: 80000               # trigger at 80k context
  keep:
    type: messages
    value: 20                  # always keep last 20 messages
  trim_tokens_to_summarize: 4000  # max tokens in summary message
```

---

## 10. Memory Injection into Prompts

**File:** `agents/memory/prompt.py:201-317, 510-539`

### `format_memory_for_injection()`

```python
def format_memory_for_injection(memory_data: dict, max_tokens: int = 2000) -> str:
    lines = []

    # User context sections
    user = memory_data.get("user", {})
    if user.get("workContext", {}).get("summary"):
        lines.append(f"Work Context: {user['workContext']['summary']}")
    if user.get("personalContext", {}).get("summary"):
        lines.append(f"Personal: {user['personalContext']['summary']}")
    if user.get("topOfMind", {}).get("summary"):
        lines.append(f"Current Focus: {user['topOfMind']['summary']}")

    # History sections
    history = memory_data.get("history", {})
    for key, label in [("recentMonths","Recent"), ("earlierContext","Earlier"), ("longTermBackground","Background")]:
        if history.get(key, {}).get("summary"):
            lines.append(f"{label}: {history[key]['summary']}")

    # Facts (sorted by confidence, added until token budget exhausted)
    facts = sorted(memory_data.get("facts", []), key=lambda f: f.get("confidence", 0), reverse=True)
    fact_lines = []
    for fact in facts:
        line = f"- [{fact['category']} | {fact['confidence']}] {fact['content']}"
        if fact.get("sourceError"):
            line += f" (avoid: {fact['sourceError']})"
        fact_lines.append(line)

    # Token-aware truncation using tiktoken
    content = "\n".join(lines)
    encoder = tiktoken.get_encoding("cl100k_base")
    token_count = len(encoder.encode(content))

    for fact_line in fact_lines:
        fact_tokens = len(encoder.encode(fact_line))
        if token_count + fact_tokens > max_tokens:
            break   # budget exhausted
        content += f"\n{fact_line}"
        token_count += fact_tokens

    return content
```

### Injection into System Prompt

```python
# agents/lead_agent/prompt.py
def _get_memory_context(agent_name: str | None = None) -> str:
    config = get_memory_config()
    if not config.enabled or not config.injection_enabled:
        return ""

    memory_data = get_memory_data(agent_name)   # FileMemoryStorage.load()
    memory_content = format_memory_for_injection(memory_data, max_tokens=config.max_injection_tokens)

    if not memory_content.strip():
        return ""

    return f"""<memory>
{memory_content}
</memory>
"""

# Template:
SYSTEM_PROMPT = f"""
<role>
You are {agent_name}, a super agent.
</role>

{soul}
{_get_memory_context(agent_name)}   ← injected here

<thinking_style>
...
```

### What the Injected Block Looks Like

```xml
<memory>
Work Context: Senior engineer working on DeerFlow, a LangGraph-based multi-agent framework.
Personal: Prefers Python, values clean architecture.
Current Focus: Implementing memory and streaming features for production release.
Recent: Merged 5 PRs this month covering sandbox warm pool and SSE streaming.
Facts:
- [preference | 0.95] Prefers concise Python with type hints
- [knowledge | 0.90] Expert in LangGraph framework and async Python
- [correction | 0.90] GPT-4 gave poor results for complex reasoning; use Claude (avoid: using GPT-4 for reasoning tasks)
- [goal | 0.80] Planning to add PostgreSQL checkpointer for production deployment
</memory>
```

---

## 11. Memory REST API

**File:** `app/gateway/routers/memory.py`

```
GET    /api/memory              → returns full memory.json
PUT    /api/memory              → replace entire memory
DELETE /api/memory              → clear (reset to empty)
POST   /api/memory/facts        → create single fact
PUT    /api/memory/facts/{id}   → update fact fields
DELETE /api/memory/facts/{id}   → delete fact by ID
POST   /api/memory/import       → bulk import from external source
```

All endpoints are authenticated and scoped to the authenticated user.

---

## 12. Configuration Reference

**File:** `config/memory_config.py`

```python
class MemoryConfig(BaseModel):
    enabled: bool = True
    storage_path: str = ""               # relative to base_dir, or absolute
    storage_class: str = "deerflow.agents.memory.storage.FileMemoryStorage"
    debounce_seconds: int = 30           # 1-300 range
    model_name: str | None = None        # None = use default model
    max_facts: int = 100                 # 10-500 range
    fact_confidence_threshold: float = 0.7  # 0.0-1.0, facts below this are discarded
    injection_enabled: bool = True
    max_injection_tokens: int = 2000     # 100-8000 range
```

**config.yaml example:**

```yaml
memory:
  enabled: true
  debounce_seconds: 30
  model_name: llama3.2:3b       # lightweight extraction model
  max_facts: 100
  fact_confidence_threshold: 0.7
  max_injection_tokens: 2000

summarization:
  enabled: true
  model_name: llama3.2:3b
  trigger:
    type: tokens
    value: 80000
  keep:
    type: messages
    value: 20
```

---

## 13. LangGraph Checkpointer

**File:** `agents/checkpointer/provider.py`

### Backend Options

```python
# Memory (dev only — lost on restart)
checkpointer = InMemorySaver()

# SQLite (single-server persistent)
checkpointer = SqliteSaver.from_conn_string(".deer-flow/checkpoints.db")

# PostgreSQL (production distributed)
checkpointer = PostgresSaver.from_conn_string(os.environ["DATABASE_URL"])
```

### What Gets Checkpointed

Every LangGraph checkpoint stores a full `ThreadState` snapshot:

```python
class ThreadState(AgentState):
    messages: list[AnyMessage]      # full conversation history (until summarized)
    sandbox: SandboxState | None
    thread_data: ThreadDataState    # workspace/uploads/outputs paths
    title: str | None               # auto-generated thread title
    artifacts: list[str]            # list of generated file paths
    todos: list | None              # task list
    uploaded_files: list[dict]      # uploaded file metadata
    viewed_images: dict             # base64 image cache
```

Checkpoints are per `(thread_id, checkpoint_id)` — full history preserved, enabling rollback.

### Async Factory

```python
# In FastAPI lifespan:
async with make_checkpointer() as checkpointer:
    app.state.checkpointer = checkpointer
    yield
# Connection closed on shutdown
```

---

## 14. Per-Thread File Isolation

**File:** `agents/middlewares/thread_data_middleware.py`

```python
class ThreadDataMiddleware:
    def before_agent(self, state, config, runtime):
        thread_id = config["configurable"]["thread_id"]
        base = Path(get_base_dir()) / "threads" / thread_id / "user-data"

        dirs = {
            "workspace": base / "workspace",   # agent working dir
            "uploads":   base / "uploads",     # user file uploads
            "outputs":   base / "outputs",     # generated artifacts
        }

        if not self.lazy_init:
            for d in dirs.values():
                d.mkdir(parents=True, exist_ok=True)

        return {"thread_data": {
            "workspace_path": str(dirs["workspace"]),
            "uploads_path":   str(dirs["uploads"]),
            "outputs_path":   str(dirs["outputs"]),
        }}
```

These paths are mounted into the sandbox container so the agent can read/write files persistently across turns within the same thread.

---

## 15. Adaptation for Solaris-Agent

### Red-Team Specific Memory Schema

Instead of DeerFlow's user-centric sections, solaris-agent needs mission-intelligence sections:

```json
{
  "version": "1.0",
  "missionContext": {
    "targetProfile": {
      "summary": "Common target characteristics: Laravel + Nginx + WAF, port ranges 22/80/443/8080",
      "updatedAt": "..."
    },
    "exploitHistory": {
      "summary": "SQLi via unsanitized GET params most effective. JWT RS256 attacks low success rate",
      "updatedAt": "..."
    },
    "blueTeamSignatures": {
      "summary": "WAF blocks sqlmap default payloads. Detection triggers at >100 req/s. Canary tokens on admin endpoints",
      "updatedAt": "..."
    }
  },
  "facts": [
    {
      "id": "fact_001",
      "content": "Laravel targets with debug mode on expose .env via /api/v1/../.env path traversal",
      "category": "knowledge",
      "confidence": 0.95,
      "targetType": "laravel",
      "missionCount": 3
    },
    {
      "id": "fact_002",
      "content": "OWASP A03 injection vectors most effective when preceded by A01 recon to enumerate parameters",
      "category": "behavior",
      "confidence": 0.85
    },
    {
      "id": "fact_003",
      "content": "SQLMap tamper scripts charunicodeencode+space2comment bypass this WAF profile",
      "category": "correction",
      "confidence": 0.90,
      "sourceError": "Default SQLMap payload was detected and blocked within 3 requests"
    }
  ]
}
```

### Additional Fact Categories for Red Team

| Category | Description |
|----------|-------------|
| `exploit_pattern` | Successful attack chains and their conditions |
| `evasion` | WAF/EDR bypass techniques that worked |
| `target_fingerprint` | Technology stack indicators and their exploitability |
| `auth_pattern` | Auth mechanisms and their weaknesses |
| `correction` | Failed approaches to avoid |

### Memory Injection for Red Team Agents

For Commander:
```xml
<mission_memory>
Target Profile: Laravel + Nginx setups commonly expose debug endpoints. JWT auth used in 60% of API-first targets.
Exploit History: Path traversal most reliable first vector. SQLi effective after parameter enumeration via recon.
Blue Team: WAF triggers on >100 req/s and sqlmap default user-agent. Canary tokens common on admin routes.
Facts:
- [exploit_pattern | 0.95] .env exposure via path traversal effective on Laravel debug builds
- [evasion | 0.90] space2comment+charunicodeencode SQLMap tamper bypasses common WAF profiles
- [correction | 0.90] JWT RS256 attacks ineffective when server validates iat strictly (avoid: RS256 key confusion)
</mission_memory>
```

### Implementation Notes

1. Memory update prompt needs domain adaptation — replace "user preferences" framing with "mission intelligence" framing
2. `filter_messages_for_memory()` needs to preserve tool results (nmap output, nuclei findings) — DeerFlow drops them
3. Debounce timer can be shorter (5-10s) since missions are time-bounded
4. `fact_confidence_threshold` should be higher (0.8+) — false intelligence is dangerous in red team context
5. Storage can be Supabase JSON column instead of filesystem JSON for consistency with existing architecture

---

*See `plans/memory-implementation-plan.md` for step-by-step integration instructions.*
