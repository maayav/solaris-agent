# Streaming Implementation Plan: Real-Time LLM Output for Solaris-Agent

> Goal: Users see LLM tokens, tool calls, and tool results appear in real-time as agents work — not after 30+ seconds of silence.

---

## Current State vs Target State

| Aspect | Current | Target |
|--------|---------|--------|
| Agent output | Shows after full completion | Streams token-by-token |
| Tool calls | Invisible until done | Visible as they're issued |
| Tool results | Invisible until done | Visible as they return |
| Transport | WebSocket (mission events only) | SSE (full LLM stream) |
| Frontend | Polls/waits | Reactive, updates per chunk |

---

## Architecture Overview

```
[LangGraph graph.astream()]
        ↓ each chunk (tokens, tool calls, tool results)
[StreamBridge.publish()]
        ↓ queued by run_id
[FastAPI SSE endpoint]
        ↓ HTTP text/event-stream
[Frontend EventSource / useStream()]
        ↓ updates React state per chunk
[MessageList re-renders]
        ↓
[User sees tokens appearing]
```

---

## Phase 1: Backend StreamBridge (Day 1-2)

### Step 1.1 — Create `stream_bridge.py`

**File:** `swarm module/Red_team/core/stream_bridge.py`

```python
from __future__ import annotations
import asyncio
import json
from dataclasses import dataclass, field
from typing import AsyncIterator
from uuid import uuid4

END_SENTINEL = object()
HEARTBEAT_SENTINEL = object()

@dataclass
class StreamEvent:
    id: str
    event: str   # "messages-tuple" | "values" | "custom" | "error" | "end"
    data: str    # JSON string

@dataclass
class _RunStream:
    events: list[StreamEvent] = field(default_factory=list)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    ended: bool = False

class MemoryStreamBridge:
    def __init__(self):
        self._streams: dict[str, _RunStream] = {}
        self._lock = asyncio.Lock()

    def _get_or_create(self, run_id: str) -> _RunStream:
        if run_id not in self._streams:
            self._streams[run_id] = _RunStream()
        return self._streams[run_id]

    async def publish(self, run_id: str, event: str, data: str) -> None:
        stream = self._get_or_create(run_id)
        ev = StreamEvent(id=uuid4().hex, event=event, data=data)
        stream.events.append(ev)
        await stream.queue.put(ev)

    async def publish_end(self, run_id: str) -> None:
        stream = self._get_or_create(run_id)
        stream.ended = True
        await stream.queue.put(END_SENTINEL)

    async def subscribe(self, run_id: str) -> AsyncIterator[StreamEvent | object]:
        stream = self._get_or_create(run_id)
        # Replay historical events for late joiners
        for ev in list(stream.events):
            yield ev
        # Live events
        while not stream.ended:
            item = await stream.queue.get()
            if item is END_SENTINEL:
                break
            yield item
        yield END_SENTINEL

    async def cleanup(self, run_id: str) -> None:
        self._streams.pop(run_id, None)

# Singleton
_bridge: MemoryStreamBridge | None = None

def get_stream_bridge() -> MemoryStreamBridge:
    global _bridge
    if _bridge is None:
        _bridge = MemoryStreamBridge()
    return _bridge
```

### Step 1.2 — Create `sse_utils.py`

**File:** `swarm module/Red_team/core/sse_utils.py`

```python
from __future__ import annotations
from typing import AsyncIterator
from .stream_bridge import MemoryStreamBridge, END_SENTINEL, HEARTBEAT_SENTINEL, StreamEvent

def format_sse(event: str, data: str, id: str | None = None) -> str:
    lines = []
    if id:
        lines.append(f"id: {id}")
    lines.append(f"event: {event}")
    for line in data.split("\n"):
        lines.append(f"data: {line}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)

async def sse_consumer(run_id: str, bridge: MemoryStreamBridge) -> AsyncIterator[str]:
    async for item in bridge.subscribe(run_id):
        if item is END_SENTINEL:
            yield format_sse("end", "")
            break
        if item is HEARTBEAT_SENTINEL:
            yield ": heartbeat\n\n"
            continue
        ev: StreamEvent = item
        yield format_sse(ev.event, ev.data, id=ev.id)
```

---

## Phase 2: LangGraph Streaming Worker (Day 2-3)

### Step 2.1 — Create `stream_worker.py`

**File:** `swarm module/Red_team/core/stream_worker.py`

```python
from __future__ import annotations
import asyncio
import json
from langchain_core.messages import AIMessageChunk, ToolMessage, HumanMessage
from .stream_bridge import MemoryStreamBridge

def _serialize_message(msg) -> dict:
    """Convert LangChain message to JSON-serializable dict."""
    if hasattr(msg, "model_dump"):
        return msg.model_dump()
    return {"type": type(msg).__name__, "content": str(msg)}

async def run_agent_streaming(
    graph,
    graph_input: dict,
    config: dict,
    bridge: MemoryStreamBridge,
    run_id: str,
    thread_id: str,
):
    try:
        # Publish metadata so frontend knows the run_id immediately
        await bridge.publish(run_id, "metadata", json.dumps({
            "run_id": run_id,
            "thread_id": thread_id,
        }))

        # Stream in "messages" mode — yields token-by-token AIMessageChunks
        async for chunk in graph.astream(
            graph_input,
            config={**config, "configurable": {"thread_id": thread_id}},
            stream_mode="messages",
        ):
            # chunk is (message, metadata) tuple in messages mode
            if isinstance(chunk, tuple) and len(chunk) == 2:
                message, metadata = chunk
                payload = json.dumps([_serialize_message(message), metadata])
                await bridge.publish(run_id, "messages-tuple", payload)
            else:
                # "values" mode snapshot
                payload = json.dumps({k: str(v) for k, v in chunk.items()})
                await bridge.publish(run_id, "values", payload)

    except asyncio.CancelledError:
        await bridge.publish(run_id, "error", json.dumps({"error": "run cancelled"}))
        raise
    except Exception as e:
        await bridge.publish(run_id, "error", json.dumps({"error": str(e)}))
    finally:
        await bridge.publish_end(run_id)
```

### Step 2.2 — Multi-mode Streaming (Optional Enhancement)

For full parity with DeerFlow, stream multiple modes simultaneously:

```python
async def run_agent_streaming_multi(graph, graph_input, config, bridge, run_id, thread_id,
                                     modes=("messages", "values")):
    await bridge.publish(run_id, "metadata", json.dumps({"run_id": run_id, "thread_id": thread_id}))

    try:
        async with asyncio.TaskGroup() as tg:
            for mode in modes:
                tg.create_task(_stream_mode(graph, graph_input, config, bridge, run_id, thread_id, mode))
    except Exception as e:
        await bridge.publish(run_id, "error", json.dumps({"error": str(e)}))
    finally:
        await bridge.publish_end(run_id)
```

---

## Phase 3: FastAPI SSE Endpoints (Day 3-4)

### Step 3.1 — Add to existing `api/main.py`

```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from uuid import uuid4
from ..core.stream_bridge import get_stream_bridge
from ..core.sse_utils import sse_consumer
from ..core.stream_worker import run_agent_streaming
from ..agents.graph import build_graph   # your existing graph builder

router = APIRouter(prefix="/api/missions", tags=["streaming"])

@router.post("/{mission_id}/runs/stream")
async def create_and_stream_run(
    mission_id: str,
    body: RunCreateRequest,
    background_tasks: BackgroundTasks,
) -> StreamingResponse:
    run_id = uuid4().hex
    bridge = get_stream_bridge()
    graph = build_graph()

    # Start agent in background (non-blocking)
    asyncio.create_task(run_agent_streaming(
        graph=graph,
        graph_input={"messages": [{"role": "user", "content": body.message}]},
        config={},
        bridge=bridge,
        run_id=run_id,
        thread_id=mission_id,
    ))

    # Return SSE stream immediately
    return StreamingResponse(
        sse_consumer(run_id, bridge),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # critical: disable nginx buffering
        }
    )

@router.get("/{mission_id}/runs/{run_id}/stream")
async def join_run_stream(mission_id: str, run_id: str) -> StreamingResponse:
    bridge = get_stream_bridge()
    return StreamingResponse(
        sse_consumer(run_id, bridge),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
```

### Step 3.2 — CORS Headers

Ensure SSE endpoint allows frontend origin:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["*"],
)
```

---

## Phase 4: Frontend Integration (Day 4-6)

### Step 4.1 — Install Dependencies

```bash
npm install @langchain/langgraph-sdk
# or if using the API directly:
npm install eventsource-parser
```

### Step 4.2 — Create `useAgentStream` Hook

**File:** `frontend/src/hooks/useAgentStream.ts`

```typescript
import { useState, useCallback, useRef } from "react"

export interface StreamMessage {
    id: string
    role: "human" | "ai" | "tool"
    content: string
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
    toolName?: string    // for tool result messages
    isStreaming?: boolean
}

export function useAgentStream(apiBaseUrl: string) {
    const [messages, setMessages] = useState<StreamMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const submit = useCallback(async (missionId: string, userMessage: string) => {
        setIsLoading(true)
        setError(null)

        // Add optimistic user message immediately
        const userMsg: StreamMessage = {
            id: crypto.randomUUID(),
            role: "human",
            content: userMessage,
        }
        setMessages(prev => [...prev, userMsg])

        // Placeholder for streaming AI message
        const aiMsgId = crypto.randomUUID()
        setMessages(prev => [...prev, {
            id: aiMsgId,
            role: "ai",
            content: "",
            isStreaming: true,
        }])

        abortRef.current = new AbortController()

        try {
            const response = await fetch(
                `${apiBaseUrl}/api/missions/${missionId}/runs/stream`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: userMessage }),
                    signal: abortRef.current.signal,
                }
            )

            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            if (!response.body) throw new Error("No response body")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const events = buffer.split("\n\n")
                buffer = events.pop() ?? ""  // keep incomplete event

                for (const eventBlock of events) {
                    if (!eventBlock.trim()) continue
                    const parsed = parseSSEEvent(eventBlock)
                    if (!parsed) continue

                    handleSSEEvent(parsed, aiMsgId, setMessages)

                    if (parsed.event === "end") {
                        setIsLoading(false)
                        // Mark AI message as done streaming
                        setMessages(prev => prev.map(m =>
                            m.id === aiMsgId ? { ...m, isStreaming: false } : m
                        ))
                        return
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                setError((err as Error).message)
            }
        } finally {
            setIsLoading(false)
        }
    }, [apiBaseUrl])

    const stop = useCallback(() => {
        abortRef.current?.abort()
        setIsLoading(false)
    }, [])

    return { messages, isLoading, error, submit, stop }
}

function parseSSEEvent(block: string): { event: string; data: string } | null {
    const lines = block.split("\n")
    let event = "message"
    let data = ""
    for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7)
        else if (line.startsWith("data: ")) data += line.slice(6)
    }
    return data ? { event, data } : null
}

function handleSSEEvent(
    parsed: { event: string; data: string },
    aiMsgId: string,
    setMessages: React.Dispatch<React.SetStateAction<StreamMessage[]>>
) {
    if (parsed.event === "messages-tuple") {
        try {
            const [message] = JSON.parse(parsed.data)

            if (message.type === "AIMessageChunk" || message.type === "AIMessage") {
                if (message.content) {
                    // Append token to streaming AI message
                    setMessages(prev => prev.map(m =>
                        m.id === aiMsgId
                            ? { ...m, content: m.content + message.content }
                            : m
                    ))
                }
                if (message.tool_calls?.length) {
                    // Show tool calls
                    setMessages(prev => prev.map(m =>
                        m.id === aiMsgId
                            ? { ...m, toolCalls: message.tool_calls }
                            : m
                    ))
                }
            }

            if (message.type === "ToolMessage") {
                // Add tool result as separate message
                setMessages(prev => [...prev, {
                    id: crypto.randomUUID(),
                    role: "tool",
                    content: message.content,
                    toolName: message.name,
                }])
            }
        } catch {
            // ignore parse errors
        }
    }
}
```

### Step 4.3 — Create `StreamingMessage` Component

**File:** `frontend/src/components/StreamingMessage.tsx`

```tsx
import React from "react"
import ReactMarkdown from "react-markdown"
import { StreamMessage } from "../hooks/useAgentStream"

interface Props {
    message: StreamMessage
}

export function StreamingMessage({ message }: Props) {
    if (message.role === "human") {
        return (
            <div className="message message-human">
                <div className="message-content">{message.content}</div>
            </div>
        )
    }

    if (message.role === "tool") {
        return (
            <div className="message message-tool">
                <div className="tool-name">{message.toolName}</div>
                <pre className="tool-output">{message.content}</pre>
            </div>
        )
    }

    // AI message
    return (
        <div className="message message-ai">
            {message.toolCalls?.map((tc, i) => (
                <div key={i} className="tool-call">
                    <span className="tool-call-name">{tc.name}</span>
                    <pre>{JSON.stringify(tc.args, null, 2)}</pre>
                </div>
            ))}
            <div className="message-content">
                <ReactMarkdown>{message.content}</ReactMarkdown>
                {message.isStreaming && <StreamingCursor />}
            </div>
        </div>
    )
}

function StreamingCursor() {
    return <span className="streaming-cursor">▋</span>
}
```

### Step 4.4 — Create `StreamingIndicator` Component

**File:** `frontend/src/components/StreamingIndicator.tsx`

```tsx
export function StreamingIndicator() {
    return (
        <div className="streaming-indicator" aria-label="Agent is thinking">
            <span />
            <span />
            <span />
        </div>
    )
}
```

```css
/* StreamingIndicator.css */
.streaming-indicator {
    display: flex;
    gap: 4px;
    padding: 12px;
}

.streaming-indicator span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-color);
    animation: bounce 1.4s infinite ease-in-out;
}

.streaming-indicator span:nth-child(1) { animation-delay: -0.32s; }
.streaming-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
    0%, 80%, 100% { transform: scale(0); }
    40% { transform: scale(1); }
}

.streaming-cursor {
    display: inline-block;
    animation: blink 1s step-end infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
```

### Step 4.5 — Wire Into Mission View

```tsx
import { useAgentStream } from "../hooks/useAgentStream"
import { StreamingMessage } from "../components/StreamingMessage"
import { StreamingIndicator } from "../components/StreamingIndicator"

export function MissionView({ missionId }: { missionId: string }) {
    const { messages, isLoading, error, submit, stop } = useAgentStream(
        process.env.REACT_APP_API_URL ?? "http://localhost:8000"
    )
    const [input, setInput] = useState("")

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isLoading) return
        submit(missionId, input)
        setInput("")
    }

    return (
        <div className="mission-view">
            <div className="message-list">
                {messages.map(msg => (
                    <StreamingMessage key={msg.id} message={msg} />
                ))}
                {isLoading && <StreamingIndicator />}
            </div>

            {error && <div className="error">{error}</div>}

            <form onSubmit={handleSubmit} className="input-form">
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Send message to commander..."
                    disabled={isLoading}
                />
                {isLoading
                    ? <button type="button" onClick={stop}>Stop</button>
                    : <button type="submit">Send</button>
                }
            </form>
        </div>
    )
}
```

---

## Phase 5: Existing Agent Graph Integration (Day 5-6)

### Step 5.1 — Update `graph.py` to Support Streaming

The existing `graph.py` likely uses `graph.invoke()` or `graph.ainvoke()`. Update the mission start endpoint to call `run_agent_streaming()` instead:

```python
# Before (api/main.py or similar):
result = await graph.ainvoke(input, config=config)

# After:
run_id = uuid4().hex
asyncio.create_task(run_agent_streaming(
    graph=graph,
    graph_input=input,
    config=config,
    bridge=get_stream_bridge(),
    run_id=run_id,
    thread_id=mission_id,
))
return {"run_id": run_id}  # client connects to SSE with this run_id
```

### Step 5.2 — Handle Both Old and New Clients

Keep the existing WebSocket endpoint for backward compat during transition:

```python
# Keep: ws/missions/{mission_id}  ← existing WebSocket (mission events)
# Add:  /api/missions/{mission_id}/runs/stream  ← new SSE (LLM tokens)
```

### Step 5.3 — Emit Custom Events from Agents

For mission-specific events (HITL gate, phase transitions), emit custom SSE events:

```python
# Inside any LangGraph node:
from langchain_core.callbacks import adispatch_custom_event

await adispatch_custom_event("hitl_gate", {
    "pattern": "rm -rf",
    "agent": "gamma_exploit",
    "requires_approval": True,
})
```

Frontend handles:
```typescript
if (parsed.event === "custom") {
    const data = JSON.parse(parsed.data)
    if (data.type === "hitl_gate") {
        setHITLRequest(data)  // show approval modal
    }
}
```

---

## Phase 6: Testing & Validation (Day 6-7)

### Backend Tests

```python
# test_stream_bridge.py
import asyncio
import pytest
from swarm.core.stream_bridge import MemoryStreamBridge, END_SENTINEL

@pytest.mark.asyncio
async def test_publish_subscribe():
    bridge = MemoryStreamBridge()
    await bridge.publish("run1", "messages-tuple", '{"content":"hello"}')
    await bridge.publish_end("run1")

    events = []
    async for item in bridge.subscribe("run1"):
        if item is END_SENTINEL:
            break
        events.append(item)

    assert len(events) == 1
    assert events[0].event == "messages-tuple"

@pytest.mark.asyncio
async def test_late_subscriber_gets_replay():
    bridge = MemoryStreamBridge()
    await bridge.publish("run2", "values", '{"state":"x"}')
    await bridge.publish_end("run2")

    # Subscribe AFTER events published
    events = []
    async for item in bridge.subscribe("run2"):
        if item is END_SENTINEL:
            break
        events.append(item)

    assert len(events) == 1  # replayed
```

### Manual SSE Testing

```bash
# Start backend
cd "swarm module/Red_team"
uvicorn api.main:app --reload --port 8000

# Test SSE endpoint with curl
curl -N -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -X POST \
     -d '{"message":"Run nmap on 192.168.1.1"}' \
     http://localhost:8000/api/missions/test-mission/runs/stream

# Expected output (real-time):
# event: metadata
# data: {"run_id":"abc123","thread_id":"test-mission"}
#
# event: messages-tuple
# data: [{"type":"AIMessageChunk","content":"I'll"},{"langgraph_node":"commander"}]
#
# event: messages-tuple
# data: [{"type":"AIMessageChunk","content":" start"},{"langgraph_node":"commander"}]
# ...
```

### Nginx Config (if behind reverse proxy)

```nginx
location /api/missions/ {
    proxy_pass http://backend:8000;
    proxy_buffering off;            # CRITICAL for SSE
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
}
```

---

## Rollout Checklist

- [ ] `core/stream_bridge.py` created and tested
- [ ] `core/sse_utils.py` created and tested
- [ ] `core/stream_worker.py` created and tested
- [ ] SSE endpoints added to `api/main.py`
- [ ] CORS headers configured for SSE
- [ ] `useAgentStream` hook created and tested
- [ ] `StreamingMessage` component created
- [ ] `StreamingIndicator` component created
- [ ] `MissionView` updated to use streaming hook
- [ ] Nginx/proxy buffering disabled
- [ ] Existing WebSocket endpoint preserved
- [ ] Manual curl test passes
- [ ] Frontend shows tokens in real-time
- [ ] Tool calls visible as issued
- [ ] Tool results visible as returned
- [ ] Stop button cancels stream correctly
- [ ] Error states handled gracefully

---

*Reference: `docs/deerflow-streaming.md` for full DeerFlow streaming architecture.*
*Reference: `plans/deerflow-integration-master-plan.md` for sequencing with other integrations.*
