# DeerFlow Streaming Architecture: Deep Dive

> How DeerFlow streams LLM tokens to the frontend in real-time, and exactly what solaris-agent needs to do the same.

---

## Table of Contents

1. [The Problem: What Solaris-Agent Currently Does](#1-the-problem)
2. [DeerFlow Full Data Flow](#2-deerflow-full-data-flow)
3. [Backend: StreamBridge](#3-backend-streambridge)
4. [Backend: LangGraph Stream Modes](#4-backend-langgraph-stream-modes)
5. [Backend: SSE Worker](#5-backend-sse-worker)
6. [Backend: FastAPI Routes](#6-backend-fastapi-routes)
7. [Backend: SSE Consumer & Formatting](#7-backend-sse-consumer--formatting)
8. [Frontend: useStream Hook](#8-frontend-usestream-hook)
9. [Frontend: Message Rendering](#9-frontend-message-rendering)
10. [Event Type Reference](#10-event-type-reference)
11. [Gap Analysis: Solaris-Agent vs DeerFlow](#11-gap-analysis)

---

## 1. The Problem

### Solaris-Agent Current Behavior

**Vibecheck chat** (`vibecheck/api/routes/chat.py:350-404`):
- Has basic token streaming via `ollama.chat_stream_async()`
- Yields raw text chunks as `text/plain`
- Works for simple vibecheck chat only

**Swarm agent runs** (`swarm module/Red_team/api/main.py:472-544`):
- WebSocket `/ws/missions/{mission_id}` exists
- Only broadcasts Redis events: `EXPLOIT_RESULT`, `INTELLIGENCE_REPORT`
- **No LLM token streaming** — the frontend sees nothing until the entire agent response is done
- No SSE endpoint for agent run output

**LangGraph usage** (`swarm module/Red_team/agents/graph.py`):
- Calls `graph.astream()` internally but **discards the token events**
- Only publishes final results to Redis

**User experience:**
```
User: "Start mission on 192.168.1.10"
[30 seconds of silence while agents run]
Frontend: "Mission complete. Found 3 vulnerabilities."
```

### DeerFlow Behavior

```
User: "Analyze this target"
[token 1] "I'll"
[token 2] "I'll start"
[token 3] "I'll start by"
[token 4] "I'll start by running"
... tokens stream in real-time as LLM generates them
[tool call visible] → Running: nmap -sV 192.168.1.10
[tool result visible] → PORT 22/tcp open ssh
[next tokens] "The scan shows..."
```

---

## 2. DeerFlow Full Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                              │
│                                                              │
│  LangGraph graph.astream(stream_mode=["messages", "values"]) │
│       │                                                      │
│       ▼                                                      │
│  worker.py: run_agent()                                      │
│       │  publishes each chunk immediately                    │
│       ▼                                                      │
│  StreamBridge.publish(run_id, event_type, data)              │
│       │  (MemoryStreamBridge: asyncio.Queue per run_id)      │
│       ▼                                                      │
│  sse_consumer(run_id) → async generator                      │
│       │  pulls from StreamBridge queue                       │
│       ▼                                                      │
│  format_sse(event, data) → "event: messages\ndata: {...}\n\n"│
│       │                                                      │
│  FastAPI StreamingResponse(media_type="text/event-stream")   │
└─────────────────────────────────────────────────────────────┘
                           │ HTTP SSE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                              │
│  useStream() hook (@langchain/langgraph-sdk/react)           │
│       │  EventSource reads SSE events                        │
│       ▼                                                      │
│  onUpdateEvent(event) → updates thread.messages state        │
│  onCustomEvent(event) → handles task_running, etc.           │
│  onFinish() → marks loading complete                         │
│       │                                                      │
│       ▼                                                      │
│  MessageList renders thread.messages                         │
│       │  re-renders on every new token chunk                 │
│       ▼                                                      │
│  MarkdownContent (streaming-aware markdown renderer)         │
│  StreamingIndicator (animated dots while loading)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Backend: StreamBridge

**Files:**
- `packages/harness/deerflow/runtime/stream_bridge/base.py`
- `packages/harness/deerflow/runtime/stream_bridge/memory.py`

### Abstract Interface (`base.py`)

```python
@dataclass
class StreamEvent:
    id: str         # unique event ID
    event: str      # event type: "messages", "values", "error", "end"
    data: str       # JSON-serialized payload

HEARTBEAT_SENTINEL = object()   # keep-alive signal
END_SENTINEL = object()         # stream complete signal

class StreamBridge(Protocol):
    async def publish(self, run_id: str, event: str, data: str) -> None: ...
    async def publish_end(self, run_id: str) -> None: ...
    def subscribe(self, run_id: str) -> AsyncIterator[StreamEvent | object]: ...
    async def cleanup(self, run_id: str) -> None: ...
```

### In-Memory Implementation (`memory.py`)

```python
@dataclass
class _RunStream:
    events: list[StreamEvent]         # accumulated event log
    queue: asyncio.Queue              # live stream queue
    condition: asyncio.Condition      # notify subscribers
    ended: bool = False

class MemoryStreamBridge:
    _streams: dict[str, _RunStream]   # keyed by run_id

    async def publish(self, run_id: str, event: str, data: str) -> None:
        stream = self._get_or_create(run_id)
        ev = StreamEvent(id=uuid4(), event=event, data=data)
        stream.events.append(ev)
        await stream.queue.put(ev)
        async with stream.condition:
            stream.condition.notify_all()

    async def subscribe(self, run_id: str) -> AsyncIterator:
        stream = self._get_or_create(run_id)
        idx = 0
        # First: replay historical events (for late joiners)
        while idx < len(stream.events):
            yield stream.events[idx]
            idx += 1
        # Then: live events from queue
        while not stream.ended:
            ev = await stream.queue.get()
            if ev is END_SENTINEL:
                break
            yield ev
        yield END_SENTINEL
```

**Key design:** Late subscribers automatically receive all historical events (replay), then switch to live. This allows the `GET /runs/{run_id}/stream` endpoint to join an already-running stream.

---

## 4. Backend: LangGraph Stream Modes

**File:** `packages/harness/deerflow/runtime/runs/worker.py`

### Supported Modes

```python
SUPPORTED_MODES = {"values", "updates", "checkpoints", "tasks", "debug", "messages", "custom"}
# "messages-tuple" is an alias → maps to LangGraph's "messages" mode
```

### Streaming Loop

```python
async def run_agent(graph, input, config, bridge: StreamBridge, run_id: str, modes: list[str]):
    # Publish metadata first
    await bridge.publish(run_id, "metadata", json.dumps({
        "run_id": run_id,
        "thread_id": config["configurable"]["thread_id"]
    }))

    for single_mode in modes:
        lg_mode = "messages" if single_mode == "messages-tuple" else single_mode
        sse_event = _lg_mode_to_sse_event(single_mode)  # maps mode → event name

        async for chunk in graph.astream(input, config=config, stream_mode=lg_mode):
            serialized = serialize(chunk, mode=single_mode)
            await bridge.publish(run_id, sse_event, serialized)

    await bridge.publish_end(run_id)
```

### Mode → SSE Event Mapping

| LangGraph Mode | SSE Event Name | What It Contains |
|---------------|---------------|-----------------|
| `messages` | `messages-tuple` | `[message_chunk, metadata]` — individual tokens |
| `values` | `values` | Full state snapshot after each node |
| `updates` | `updates` | Only changed fields after each node |
| `custom` | `custom` | Custom events from `adispatch_custom_event()` |
| `debug` | `debug` | Internal graph execution steps |

### Token-Level Streaming (most important for UI)

The `messages` mode yields `AIMessageChunk` objects as they arrive from the LLM:

```python
# Each chunk in messages mode:
[
    AIMessageChunk(content="I'll"),        # token 1
    {"langgraph_node": "agent", ...}       # metadata
]
# → SSE: event: messages-tuple\ndata: [{"content":"I'll",...}, {...}]\n\n

[
    AIMessageChunk(content=" start"),      # token 2
    {"langgraph_node": "agent", ...}
]
# → SSE: event: messages-tuple\ndata: [{"content":" start",...}, {...}]\n\n
```

---

## 5. Backend: SSE Worker

**File:** `packages/harness/deerflow/runtime/runs/worker.py:155-181`

```python
async def run_agent(agent, graph_input, runnable_config, bridge, run_id, stream_modes):
    try:
        # Publish run metadata
        await bridge.publish(run_id, "metadata", json.dumps({
            "run_id": run_id,
            "thread_id": runnable_config["configurable"]["thread_id"]
        }))

        for mode in stream_modes:
            lg_mode = "messages" if mode == "messages-tuple" else mode
            async for chunk in agent.astream(graph_input, config=runnable_config, stream_mode=lg_mode):
                await bridge.publish(run_id, _lg_mode_to_sse_event(mode), serialize(chunk, mode=mode))

    except Exception as e:
        await bridge.publish(run_id, "error", json.dumps({"error": str(e)}))
    finally:
        await bridge.publish_end(run_id)
```

The worker runs as an `asyncio.create_task()` so it doesn't block the HTTP response.

---

## 6. Backend: FastAPI Routes

**File:** `app/gateway/routers/thread_runs.py`

### Stream Run (create + stream)

```python
@router.post("/threads/{thread_id}/runs/stream")
async def stream_run(
    thread_id: str,
    body: RunCreateRequest,
    request: Request,
) -> StreamingResponse:
    run = await run_manager.create(thread_id=thread_id, ...)

    # Start agent in background task
    asyncio.create_task(
        run_agent(agent, input, config, bridge=stream_bridge, run_id=run.run_id, ...)
    )

    # Return SSE stream immediately (agent runs in background)
    return StreamingResponse(
        sse_consumer(run.run_id, stream_bridge),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        }
    )
```

### Join Existing Stream (late join)

```python
@router.get("/threads/{thread_id}/runs/{run_id}/stream")
async def join_stream(thread_id: str, run_id: str) -> StreamingResponse:
    # Uses StreamBridge replay: subscriber gets historical + live events
    return StreamingResponse(
        sse_consumer(run_id, stream_bridge),
        media_type="text/event-stream",
    )
```

---

## 7. Backend: SSE Consumer & Formatting

**File:** `app/gateway/services.py:42-55, 336-367`

### `format_sse()`

```python
def format_sse(event: str, data: str, id: str | None = None) -> str:
    lines = []
    if id:
        lines.append(f"id: {id}")
    lines.append(f"event: {event}")
    # Split data on newlines (SSE spec requires one data: per line)
    for line in data.split("\n"):
        lines.append(f"data: {line}")
    lines.append("")  # blank line = event delimiter
    lines.append("")
    return "\n".join(lines)

# Output:
# id: abc123
# event: messages-tuple
# data: [{"content":"I'll",...},{"langgraph_node":"agent"}]
#
#
```

### `sse_consumer()`

```python
async def sse_consumer(run_id: str, bridge: StreamBridge) -> AsyncIterator[str]:
    async for event in bridge.subscribe(run_id):
        if event is END_SENTINEL:
            yield format_sse("end", "")
            break
        if event is HEARTBEAT_SENTINEL:
            yield ": heartbeat\n\n"   # SSE comment = keep-alive
            continue
        yield format_sse(event.event, event.data, id=event.id)
```

---

## 8. Frontend: useStream Hook

**File:** `frontend/src/core/threads/hooks.ts`

### Setup

```typescript
import { useStream } from "@langchain/langgraph-sdk/react"

const thread = useStream<ThreadState>({
    apiUrl: "http://localhost:2024",
    assistantId: "agent",
    threadId: currentThreadId,
    streamMode: ["values", "messages-tuple"],
    onUpdateEvent: handleUpdateEvent,
    onCustomEvent: handleCustomEvent,
    onFinish: handleFinish,
    onError: handleError,
})
```

### Submitting a Message

```typescript
thread.submit({
    messages: [{ role: "human", content: userInput }]
})
// → POST /threads/{thread_id}/runs/stream
// → SSE events start flowing
```

### Handling Events

```typescript
// State update (after each node completes)
const handleUpdateEvent = (event: UpdateEvent) => {
    // thread.messages is automatically updated by useStream
    // custom fields from ThreadState accessible here
}

// Custom events (e.g. task_running, progress updates)
const handleCustomEvent = (event: CustomEvent) => {
    if (event.type === "task_running") {
        setRunningTasks(prev => [...prev, event.task_id])
    }
}

// Stream complete
const handleFinish = () => {
    setIsStreaming(false)
    clearOptimisticMessages()
}
```

### Optimistic Messages

```typescript
// Before server messages arrive, show optimistic (local) messages
const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])

// On submit:
setOptimisticMessages([{ role: "human", content: userInput }])

// When server messages arrive:
useEffect(() => {
    if (thread.messages.length > 0) {
        setOptimisticMessages([])  // clear optimistic
    }
}, [thread.messages])
```

### State Available from `thread`

```typescript
thread.messages        // AnyMessage[] — updates per token chunk
thread.isLoading       // boolean — true while streaming
thread.isThreadLoading // boolean — true during initial load
thread.values          // ThreadState — full state snapshot
thread.submit()        // send message + start stream
thread.stop()          // interrupt current run
```

---

## 9. Frontend: Message Rendering

**Files:**
- `frontend/src/components/workspace/messages/message-list.tsx`
- `frontend/src/components/workspace/messages/message-list-item.tsx`
- `frontend/src/components/workspace/messages/markdown-content.tsx`
- `frontend/src/components/workspace/streaming-indicator.tsx`

### MessageList

```tsx
function MessageList({ thread }) {
    const messages = thread.messages   // re-renders on every token chunk

    return (
        <div className="message-list">
            {messages.map((msg, i) => (
                <MessageListItem
                    key={msg.id || i}
                    message={msg}
                    isLoading={thread.isLoading && i === messages.length - 1}
                />
            ))}
            {thread.isLoading && <StreamingIndicator />}
        </div>
    )
}
```

### Streaming-Aware Markdown

```tsx
// markdown-content.tsx
import { streamdownPlugins } from "streamdown"

function MarkdownContent({ content, isStreaming }) {
    return (
        <ReactMarkdown
            remarkPlugins={isStreaming ? streamdownPlugins : []}
        >
            {content}
        </ReactMarkdown>
    )
}
// streamdownPlugins handles partial markdown gracefully:
// e.g. "```py\nprint(" renders as code block even before closing ```
```

### StreamingIndicator

```tsx
function StreamingIndicator() {
    return (
        <div className="streaming-indicator">
            <span className="dot dot-1" />
            <span className="dot dot-2" />
            <span className="dot dot-3" />
        </div>
    )
}
// CSS: animated dots with staggered animation-delay
```

---

## 10. Event Type Reference

### Complete SSE Event Types

| SSE Event | Trigger | Payload Shape |
|-----------|---------|--------------|
| `metadata` | Start of every run | `{"run_id": "...", "thread_id": "..."}` |
| `messages-tuple` | Each LLM token | `[AIMessageChunk, {langgraph_node, ...}]` |
| `values` | After each graph node | Full `ThreadState` snapshot |
| `updates` | After each graph node | Partial state (only changed keys) |
| `custom` | `adispatch_custom_event()` | Arbitrary JSON |
| `error` | Exception in worker | `{"error": "message"}` |
| `end` | Stream complete | `""` |
| `: heartbeat` | Every 30s (SSE comment) | Keep-alive (not a real event) |

### Tool Call Events (within `messages-tuple`)

When the agent calls a tool, `messages-tuple` carries:
```json
[
    {
        "type": "AIMessageChunk",
        "tool_calls": [{"name": "nmap", "args": {"target": "192.168.1.10"}}],
        "content": ""
    },
    {"langgraph_node": "agent"}
]
```

Then tool result:
```json
[
    {
        "type": "ToolMessage",
        "name": "nmap",
        "content": "PORT 22/tcp open ssh\nPORT 80/tcp open http"
    },
    {"langgraph_node": "tools"}
]
```

---

## 11. Gap Analysis: Solaris-Agent vs DeerFlow

### Backend Gaps

| Component | DeerFlow | Solaris-Agent | File to Create |
|-----------|----------|---------------|----------------|
| StreamBridge | `runtime/stream_bridge/` | Missing | `swarm/core/stream_bridge.py` |
| SSE worker | `runtime/runs/worker.py` | Missing | adapt `graph.py` |
| SSE endpoint | `routers/thread_runs.py` | Missing | add to `api/main.py` |
| SSE consumer | `services.py:sse_consumer()` | Missing | `swarm/core/sse_consumer.py` |
| SSE formatter | `services.py:format_sse()` | Missing | same file |

### Frontend Gaps

| Component | DeerFlow | Solaris-Agent | File to Create |
|-----------|----------|---------------|----------------|
| Streaming hook | `useStream` from langgraph-sdk | Missing | adapt in `frontend/src/hooks/` |
| Message list | `message-list.tsx` | Static display | `frontend/src/components/MessageList.tsx` |
| Streaming indicator | `streaming-indicator.tsx` | Missing | `frontend/src/components/StreamingIndicator.tsx` |
| Streaming markdown | `markdown-content.tsx` | Missing | `frontend/src/components/MarkdownContent.tsx` |

### npm Package Needed

```bash
npm install @langchain/langgraph-sdk
# Provides: useStream, Client, Thread types
```

---

*See `plans/streaming-implementation-plan.md` for step-by-step integration instructions.*
