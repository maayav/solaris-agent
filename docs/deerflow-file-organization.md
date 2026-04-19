# DeerFlow File & Dependency Organization

> Complete reference for how DeerFlow structures its frontend and backend code — directory layout, component organization, state management, dependency management, typing patterns, environment variables, and testing structure.

---

## Table of Contents

1. [Frontend Directory Structure](#1-frontend-directory-structure)
2. [Frontend Component Organization](#2-frontend-component-organization)
3. [Frontend State Management](#3-frontend-state-management)
4. [Frontend Dependency Inventory](#4-frontend-dependency-inventory)
5. [Environment Variables](#5-environment-variables)
6. [API Client Structure](#6-api-client-structure)
7. [TypeScript Typing Patterns](#7-typescript-typing-patterns)
8. [Backend Directory Structure](#8-backend-directory-structure)
9. [Backend Module Organization](#9-backend-module-organization)
10. [Backend Dependency Management](#10-backend-dependency-management)
11. [FastAPI Dependency Injection](#11-fastapi-dependency-injection)
12. [Configuration File Locations](#12-configuration-file-locations)
13. [Testing Organization](#13-testing-organization)
14. [Solaris-Agent File Org Assessment](#14-solaris-agent-file-org-assessment)

---

## 1. Frontend Directory Structure

```
frontend/
├── src/
│   ├── app/                          # Next.js App Router (pages)
│   │   ├── (home)/
│   │   │   └── page.tsx              # Landing page
│   │   ├── workspace/
│   │   │   ├── layout.tsx            # Sidebar + main layout
│   │   │   ├── page.tsx              # Redirect to /workspace/chats
│   │   │   ├── chats/
│   │   │   │   └── [thread_id]/
│   │   │   │       └── page.tsx      # Chat view for a thread
│   │   │   ├── agents/
│   │   │   │   └── [agent_name]/
│   │   │   │       └── chats/
│   │   │   │           └── [thread_id]/
│   │   │   │               └── page.tsx
│   │   │   └── settings/
│   │   │       └── page.tsx
│   │   └── api/                      # Next.js API routes (proxy/auth)
│   │       └── auth/
│   │           └── [...all]/
│   │               └── route.ts
│   │
│   ├── components/
│   │   ├── ai-elements/              # Reusable AI chat components
│   │   │   ├── message.tsx           # Core message bubble component
│   │   │   ├── reasoning.tsx         # <think> collapsible section
│   │   │   ├── prompt-input.tsx      # Full-featured chat input (1469 lines)
│   │   │   ├── code-block.tsx        # Shiki-highlighted code + copy button
│   │   │   ├── conversation.tsx      # Empty state + scroll-to-bottom
│   │   │   ├── chain-of-thought.tsx  # Tool call accordion
│   │   │   ├── task.tsx              # Subagent task card
│   │   │   ├── shimmer.tsx           # Animated shimmer component
│   │   │   ├── loader.tsx            # SVG spinner
│   │   │   └── input-group.tsx       # Form input primitives
│   │   │
│   │   ├── ui/                       # shadcn/ui components (generated)
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── collapsible.tsx
│   │   │   ├── hover-card.tsx
│   │   │   ├── tooltip.tsx
│   │   │   └── ...
│   │   │
│   │   ├── workspace/                # Page-specific compositions
│   │   │   ├── messages/
│   │   │   │   ├── message-list.tsx      # Message list with streaming indicator
│   │   │   │   ├── message-list-item.tsx # Single message row
│   │   │   │   ├── message-group.tsx     # Groups AI message + tool calls (486 lines)
│   │   │   │   ├── markdown-content.tsx  # Streamdown wrapper
│   │   │   │   └── context.ts            # Message context provider
│   │   │   ├── chats/
│   │   │   │   └── chat-box.tsx          # Chat layout (input + messages)
│   │   │   ├── artifacts/
│   │   │   │   ├── artifact-panel.tsx    # Side panel for file artifacts
│   │   │   │   └── artifact-viewer.tsx   # File content viewer
│   │   │   ├── input-box.tsx             # Input area with attachment strip
│   │   │   ├── streaming-indicator.tsx   # 3 bouncing dots
│   │   │   └── copy-button.tsx           # Hover-reveal copy button
│   │   │
│   │   ├── theme-provider.tsx            # next-themes wrapper
│   │   ├── sidebar.tsx                   # Left navigation sidebar
│   │   └── thread-list.tsx               # Thread history list
│   │
│   ├── core/                         # Business logic (no UI)
│   │   ├── threads/
│   │   │   ├── hooks.ts              # useThreadStream, useThread (531 lines)
│   │   │   ├── types.ts              # AgentThread, ThreadState types
│   │   │   └── index.ts              # Re-exports
│   │   ├── messages/
│   │   │   ├── utils.ts              # extractText, splitInlineReasoning (392 lines)
│   │   │   └── index.ts
│   │   ├── uploads/
│   │   │   └── index.ts              # File upload utilities
│   │   ├── streamdown/
│   │   │   └── plugins.ts            # remarkGfm, remarkMath, rehypeKatex config
│   │   ├── api/
│   │   │   ├── api-client.ts         # LangGraph SDK client singleton
│   │   │   ├── stream-mode.ts        # sanitizeRunStreamOptions
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── cn.ts                 # Tailwind class merger (clsx + tailwind-merge)
│   │       └── format.ts             # formatBytes, formatDate, etc.
│   │
│   ├── styles/
│   │   └── globals.css               # CSS variables, animations, base styles (392 lines)
│   │
│   └── env.js                        # Type-safe environment variables (t3-env)
│
├── public/                           # Static assets
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.ts
└── .env.local                        # Local secrets (gitignored)
```

---

## 2. Frontend Component Organization

### Three-Layer Architecture

```
ai-elements/        → Generic, reusable, domain-agnostic
                      Could be extracted to a UI library
                      No knowledge of threads/missions/agents

workspace/          → Page-specific compositions
                      Knows about threads, agents, missions
                      Combines ai-elements into full features

ui/                 → Primitive building blocks (shadcn/ui)
                      No business logic
                      Pure visual primitives
```

### Naming Conventions

| Pattern | Example | Meaning |
|---------|---------|---------|
| `*.tsx` | `message.tsx` | React component |
| `*.ts` | `utils.ts` | Pure logic, no JSX |
| `hooks.ts` | `threads/hooks.ts` | Custom React hooks |
| `types.ts` | `threads/types.ts` | TypeScript type definitions |
| `context.ts` | `messages/context.ts` | React context providers |
| `index.ts` | `core/api/index.ts` | Re-export barrel |

### Component File Structure Pattern

Each component file follows:

```tsx
// 1. Imports (external → internal → types)
import { useState, useEffect } from "react"
import { cn } from "@/core/utils/cn"
import type { Message } from "./types"

// 2. Types/interfaces for this component
interface Props {
  message: Message
  isStreaming?: boolean
}

// 3. Constants
const AUTO_CLOSE_DELAY = 1000

// 4. Main export (usually default)
export function MessageItem({ message, isStreaming }: Props) {
  // ...
}

// 5. Sub-components (used only within this file)
function MessageActions({ onCopy }: { onCopy: () => void }) {
  // ...
}
```

---

## 3. Frontend State Management

### Three Categories of State

```
Server State (React Query)
├── Thread list (GET /threads)
├── Thread messages (GET /threads/:id/messages)
├── Agent config (GET /agents)
└── Memory data (GET /memory)

Stream State (useStream hook)
├── thread.messages (live, updates per token)
├── thread.isLoading (boolean)
├── thread.values (full ThreadState snapshots)
└── thread.error

UI State (React useState / Context)
├── PromptInputContext (value, attachments, isSubmitting)
├── ArtifactsContext (selected artifact, panel open/closed)
├── ThreadContext (current thread_id)
└── Local component state (isOpen, copied, etc.)
```

### React Query Setup

```tsx
// app/providers.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s before refetch
      gcTime: 5 * 60_000,    // 5min cache retention
    },
  },
})

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
```

### Context Pattern

```tsx
// core/threads/context.ts
const ThreadContext = createContext<ThreadContextValue | null>(null)

export function ThreadProvider({ threadId, children }) {
  const thread = useThreadStream(threadId)
  return (
    <ThreadContext.Provider value={thread}>
      {children}
    </ThreadContext.Provider>
  )
}

export function useThreadContext() {
  const ctx = useContext(ThreadContext)
  if (!ctx) throw new Error("useThreadContext must be inside ThreadProvider")
  return ctx
}
```

### No Global State Library

DeerFlow deliberately avoids Redux/Zustand for global state. Rationale:
- Server state → React Query (eliminates 90% of global state needs)
- Stream state → LangGraph SDK's `useStream`
- Remaining UI state → Context API is sufficient

---

## 4. Frontend Dependency Inventory

**File:** `frontend/package.json` (key dependencies)

### AI/Agent

```json
{
  "@langchain/core": "1.1.15",
  "@langchain/langgraph-sdk": "1.5.3",
  "ai": "6.0.33"
}
```

### UI Framework

```json
{
  "next": "16.1.7",
  "react": "19.1.0",
  "react-dom": "19.1.0"
}
```

### UI Components

```json
{
  "@radix-ui/react-collapsible": "1.1.11",
  "@radix-ui/react-dialog": "1.1.14",
  "@radix-ui/react-hover-card": "1.1.14",
  "@radix-ui/react-tooltip": "1.2.7",
  "@radix-ui/react-popover": "1.1.14",
  "class-variance-authority": "0.7.1",
  "clsx": "2.1.1",
  "tailwind-merge": "3.4.0",
  "lucide-react": "0.511.0"
}
```

### Markdown & Syntax

```json
{
  "streamdown": "1.4.0",
  "shiki": "3.15.0",
  "remark-gfm": "4.0.1",
  "remark-math": "6.0.0",
  "rehype-katex": "7.0.1",
  "rehype-raw": "7.0.0"
}
```

### Scroll & Animation

```json
{
  "use-stick-to-bottom": "1.1.1",
  "tw-animate-css": "1.2.5"
}
```

### State & Data Fetching

```json
{
  "@tanstack/react-query": "5.90.17",
  "@tanstack/react-query-devtools": "5.90.17"
}
```

### Notifications

```json
{
  "sonner": "2.0.3"
}
```

### Code Editor (for artifact viewing)

```json
{
  "@uiw/react-codemirror": "4.25.4",
  "@codemirror/lang-python": "*",
  "@codemirror/lang-javascript": "*"
}
```

### Theming

```json
{
  "next-themes": "0.4.6"
}
```

### Token Counting

```json
{
  "tokenlens": "0.0.9"
}
```

### Dev Dependencies

```json
{
  "typescript": "5.x",
  "tailwindcss": "4.0.15",
  "@types/react": "19.x",
  "eslint": "9.x",
  "@typescript-eslint/eslint-plugin": "*"
}
```

### Package Manager

```
pnpm (lockfile: pnpm-lock.yaml)
```

---

## 5. Environment Variables

**File:** `frontend/src/env.js` (using `@t3-oss/env-nextjs`)

### Pattern: Type-Safe Env Validation

```javascript
import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    // Not exposed to browser bundle
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_GITHUB_CLIENT_ID: z.string().optional(),
    BETTER_AUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
    GITHUB_OAUTH_TOKEN: z.string().optional(),
  },
  client: {
    // Exposed to browser (NEXT_PUBLIC_ prefix required)
    NEXT_PUBLIC_BACKEND_BASE_URL: z.string().url().default("http://localhost:2024"),
    NEXT_PUBLIC_LANGGRAPH_BASE_URL: z.string().url().default("http://localhost:2024"),
    NEXT_PUBLIC_STATIC_WEBSITE_ONLY: z.coerce.boolean().default(false),
  },
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    NEXT_PUBLIC_BACKEND_BASE_URL: process.env.NEXT_PUBLIC_BACKEND_BASE_URL,
    // ...
  },
})
```

**Why `@t3-oss/env-nextjs`?**
- Throws at startup if required variables are missing (not at runtime)
- Type inference — `env.NEXT_PUBLIC_BACKEND_BASE_URL` is typed as `string`
- Validates format (`z.string().url()` ensures it's a valid URL)
- Prevents accidentally using server vars in client code

### `.env.local` vs `.env`

```
.env               # committed defaults (no secrets)
.env.local         # gitignored, local overrides
.env.production    # production values (CI/CD sets these)
```

---

## 6. API Client Structure

**File:** `frontend/src/core/api/api-client.ts`

```typescript
import { Client } from "@langchain/langgraph-sdk"

let _client: Client | null = null

export function getAPIClient(): Client {
  if (!_client) {
    _client = new Client({
      apiUrl: env.NEXT_PUBLIC_LANGGRAPH_BASE_URL,
      // apiKey: env.LANGGRAPH_API_KEY,  // if auth required
    })
  }
  return _client
}

// Mock mode for static website deployment
export function isStaticMode(): boolean {
  return env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY
}
```

### API Layer Organization

```
core/api/
├── api-client.ts     # LangGraph SDK client singleton
├── stream-mode.ts    # Stream mode validation
└── index.ts          # Re-exports

# Direct HTTP calls (non-LangGraph endpoints):
core/threads/hooks.ts  # Uses React Query for REST + useStream for SSE
```

---

## 7. TypeScript Typing Patterns

### Strict Mode

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,    // arr[0] is T | undefined
    "exactOptionalPropertyTypes": true,   // optional ≠ undefined assignable
    "noImplicitOverride": true
  }
}
```

### Message Types (LangChain-aligned)

```typescript
// Mirrors LangChain Python message types:
type AnyMessage =
  | HumanMessage
  | AIMessage
  | SystemMessage
  | ToolMessage

interface AIMessage {
  type: "ai"
  id: string
  content: string | ContentPart[]
  tool_calls: ToolCall[]
  tool_call_chunks?: ToolCallChunk[]   // only in streaming
  response_metadata: Record<string, unknown>
}

interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}
```

### State Types

```typescript
// Mirrors LangGraph Python state TypedDict:
interface ThreadState {
  messages: AnyMessage[]
  sandbox: SandboxState | null
  thread_data: ThreadDataState | null
  title: string | null
  artifacts: string[]
  todos: TodoItem[] | null
  uploaded_files: UploadedFile[]
  viewed_images: Record<string, ViewedImageData>
}
```

### Discriminated Unions for Tool Results

```typescript
type ParsedToolResult =
  | { type: "json"; data: Record<string, unknown> }
  | { type: "array"; data: unknown[] }
  | { type: "text"; data: string }
  | { type: "empty"; data: null }

// Exhaustive switch required by TypeScript:
function renderResult(result: ParsedToolResult) {
  switch (result.type) {
    case "json": return <JsonView data={result.data} />
    case "array": return <ArrayView data={result.data} />
    case "text": return <pre>{result.data}</pre>
    case "empty": return null
    // TypeScript errors if a case is missing
  }
}
```

---

## 8. Backend Directory Structure

```
backend/
├── app/
│   ├── gateway/                      # FastAPI application
│   │   ├── app.py                    # App factory (create_app())
│   │   ├── config.py                 # Gateway-level config
│   │   ├── deps.py                   # FastAPI Depends() providers
│   │   ├── services.py               # Business logic orchestration
│   │   ├── lifespan.py               # Startup/shutdown lifecycle
│   │   └── routers/                  # Route handlers (thin)
│   │       ├── threads.py            # Thread CRUD
│   │       ├── thread_runs.py        # Streaming run endpoints
│   │       ├── models.py             # Model listing
│   │       ├── memory.py             # Memory CRUD
│   │       ├── skills.py             # Skills management
│   │       ├── artifacts.py          # Artifact files
│   │       ├── uploads.py            # File uploads
│   │       ├── agents.py             # Agent config
│   │       └── suggestions.py        # Message suggestions
│   │
│   └── channels/                     # IM integrations
│       ├── telegram/
│       │   ├── router.py
│       │   └── handlers.py
│       ├── slack/
│       └── discord/
│
├── packages/
│   └── harness/
│       └── deerflow/                 # Core agent package
│           ├── agents/
│           │   ├── lead_agent/
│           │   │   ├── agent.py      # Agent class
│           │   │   └── prompt.py     # System prompt (727 lines)
│           │   ├── middlewares/      # 17 middleware classes
│           │   │   ├── memory_middleware.py
│           │   │   ├── summarization_middleware.py
│           │   │   ├── loop_detection_middleware.py
│           │   │   ├── tool_error_handling_middleware.py
│           │   │   ├── dangling_tool_call_middleware.py
│           │   │   └── ...
│           │   ├── memory/           # Memory system
│           │   │   ├── updater.py
│           │   │   ├── queue.py
│           │   │   ├── storage.py
│           │   │   ├── prompt.py
│           │   │   ├── message_processing.py
│           │   │   └── summarization_hook.py
│           │   ├── checkpointer/
│           │   │   ├── provider.py   # Sync checkpointer factory
│           │   │   └── async_provider.py
│           │   ├── thread_state.py   # ThreadState TypedDict
│           │   ├── factory.py        # Agent factory (372 lines)
│           │   └── features.py       # RuntimeFeatures dataclass
│           │
│           ├── config/               # Configuration system
│           │   ├── app_config.py     # Main config with auto-reload (397 lines)
│           │   ├── model_config.py   # ModelConfig dataclass
│           │   ├── agents_config.py  # Agent-specific config
│           │   ├── memory_config.py  # MemoryConfig
│           │   ├── summarization_config.py
│           │   ├── skills_config.py
│           │   └── paths.py          # Path resolution
│           │
│           ├── models/
│           │   └── factory.py        # create_chat_model() (123 lines)
│           │
│           ├── tools/
│           │   └── tools.py          # Dynamic tool loading (137 lines)
│           │
│           ├── skills/               # Skills system
│           │   ├── loader.py
│           │   ├── parser.py
│           │   ├── types.py
│           │   ├── manager.py
│           │   └── installer.py
│           │
│           ├── subagents/            # Subagent execution
│           │   ├── executor.py       # SubagentExecutor (611 lines)
│           │   ├── registry.py
│           │   ├── config.py
│           │   └── builtins/
│           │
│           ├── community/            # Community integrations
│           │   ├── aio_sandbox/      # Docker sandbox
│           │   │   ├── aio_sandbox_provider.py  # (704 lines)
│           │   │   └── sandbox.py
│           │   ├── ddg_search/
│           │   ├── tavily/
│           │   └── mcp/              # MCP server integration
│           │
│           ├── runtime/
│           │   ├── runs/
│           │   │   ├── manager.py    # RunManager (210 lines)
│           │   │   └── worker.py     # Streaming worker
│           │   ├── stream_bridge/
│           │   │   ├── base.py
│           │   │   └── memory.py
│           │   └── serialization.py  # LangGraph chunk serialization
│           │
│           ├── sandbox/
│           │   └── sandbox.py        # Sandbox abstract base class
│           │
│           └── client.py             # Python client library
│
├── tests/
│   ├── test_client.py
│   └── test_serialization.py
│
├── pyproject.toml
├── Makefile
├── config.yaml                       # Main app configuration
└── .env                              # Secrets (gitignored)
```

---

## 9. Backend Module Organization

### Separation of Concerns

```
Routers (app/gateway/routers/)
│   ↓ receive HTTP request, validate with Pydantic
│   ↓ call service functions
│
Services (app/gateway/services.py)
│   ↓ business logic, orchestration
│   ↓ calls agent runtime
│
Agent Runtime (packages/harness/deerflow/runtime/)
│   ↓ manages run lifecycle
│   ↓ runs LangGraph graph
│
Core Agent (packages/harness/deerflow/agents/)
    ↓ middleware chain
    ↓ LLM calls
    ↓ tool execution
```

### Router Pattern (Thin)

```python
# routers/thread_runs.py
@router.post("/threads/{thread_id}/runs/stream")
async def stream_run(
    thread_id: str,
    body: RunCreateRequest,                    # Pydantic validation
    checkpointer = Depends(get_checkpointer),  # DI
    store = Depends(get_store),                # DI
) -> StreamingResponse:
    # Delegate immediately to service layer
    return await services.create_and_stream_run(
        thread_id=thread_id,
        body=body,
        checkpointer=checkpointer,
        store=store,
    )
```

### Service Layer

```python
# services.py
async def create_and_stream_run(thread_id, body, checkpointer, store):
    run = await run_manager.create(thread_id=thread_id, ...)
    agent = create_deerflow_agent(features=get_runtime_features())

    asyncio.create_task(
        run_agent(agent, input, config, bridge=stream_bridge, run_id=run.run_id)
    )

    return StreamingResponse(
        sse_consumer(run.run_id, stream_bridge),
        media_type="text/event-stream",
    )
```

---

## 10. Backend Dependency Management

**File:** `backend/pyproject.toml`

### Tool: `uv`

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "deerflow"
version = "2.0.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.32",
    "langgraph>=0.4",
    "langchain-core>=0.3",
    "langchain-openai>=0.3",
    "langchain-anthropic>=0.3",
    "langchain-ollama>=0.3",
    "pydantic>=2.10",
    "python-multipart>=0.0.20",
    "aiofiles>=24",
    "httpx>=0.28",
    "tiktoken>=0.8",
    "filelock>=3.17",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8",
    "pytest-asyncio>=0.25",
    "httpx>=0.28",
]
```

### Package Structure (Monorepo)

```
backend/
├── pyproject.toml          # Root package (app)
└── packages/harness/       # Nested package (deerflow)
    └── pyproject.toml      # Separate installable package
```

```bash
# Install both:
uv pip install -e .
uv pip install -e packages/harness

# Run:
uv run uvicorn app.gateway.app:app --reload
```

### Makefile Shortcuts

```makefile
install:
    uv sync --all-extras

dev:
    uv run uvicorn app.gateway.app:app --reload --port 2024

test:
    uv run pytest tests/ -v

lint:
    uv run ruff check .
    uv run ruff format --check .

format:
    uv run ruff format .
```

---

## 11. FastAPI Dependency Injection

**File:** `app/gateway/deps.py`

```python
from functools import lru_cache
from fastapi import Depends, Request
from langgraph.checkpoint.base import BaseCheckpointSaver

def get_checkpointer(request: Request) -> BaseCheckpointSaver:
    """Get checkpointer from app state (set during lifespan startup)."""
    return request.app.state.checkpointer

def get_store(request: Request):
    """Get key-value store from app state."""
    return request.app.state.store

def get_stream_bridge(request: Request) -> MemoryStreamBridge:
    return request.app.state.stream_bridge

# Usage in routers:
@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    checkpointer: BaseCheckpointSaver = Depends(get_checkpointer)
):
    ...
```

### Lifespan (Startup/Shutdown)

```python
# app/gateway/lifespan.py
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    async with make_checkpointer() as checkpointer:
        app.state.checkpointer = checkpointer
        app.state.stream_bridge = MemoryStreamBridge()
        app.state.store = InMemoryStore()

        yield  # app runs here

        # SHUTDOWN (handled by context manager exit)
```

---

## 12. Configuration File Locations

```
backend/
├── config.yaml          # Main app config (models, sandbox, memory, etc.)
├── .env                 # API keys (gitignored)
├── .env.example         # Template with placeholder values (committed)
└── .deer-flow/          # Runtime data (gitignored)
    ├── memory.json      # Global agent memory
    ├── agents/
    │   └── {name}/
    │       └── memory.json
    ├── threads/
    │   └── {thread_id}/
    │       └── user-data/
    └── checkpoints.db   # SQLite checkpoints (if configured)
```

### Config Resolution Order

```python
# In AppConfig.resolve_config_path():
1. DEER_FLOW_CONFIG env var  → absolute path to config.yaml
2. ./config.yaml             → local (dev)
3. ~/.deer-flow/config.yaml  → user global
```

---

## 13. Testing Organization

### Backend Tests

```
backend/tests/
├── conftest.py                    # Shared fixtures (test checkpointer, mock LLM)
├── test_client.py                 # Python client library tests
├── test_serialization.py          # LangGraph chunk serialization tests
└── integration/                   # (planned) Full stack tests
```

### Test Patterns

```python
# conftest.py
import pytest
from langgraph.checkpoint.memory import InMemorySaver

@pytest.fixture
def checkpointer():
    return InMemorySaver()

@pytest.fixture
def mock_llm():
    # Returns a mock that yields predictable token streams
    return MockChatModel(responses=["Test response"])

# Test pattern:
@pytest.mark.asyncio
async def test_agent_response(checkpointer, mock_llm):
    agent = create_deerflow_agent(features=RuntimeFeatures(), model=mock_llm)
    result = await agent.ainvoke({"messages": [HumanMessage(content="Hello")]})
    assert result["messages"][-1].content == "Test response"
```

### Frontend Tests

```
frontend/
└── (no tests currently — uses Playwright for E2E)
```

---

## 14. Solaris-Agent File Org Assessment

### Current Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| `commander.py` at 1096 lines | High | Split into `commander/core.py` + `commander/prompts.py` |
| `gamma_exploit.py` at 1823+ lines | High | Split into `gamma/exploit.py` + `gamma/reflection.py` + `gamma/tools.py` |
| No `core/` vs `api/` separation | Medium | Move business logic out of route handlers |
| No `types.py` files | Medium | Create typed interfaces for state, events, findings |
| `swarm module/` name has a space | Low | Rename to `swarm_module/` or `swarm/` |
| No `pyproject.toml` | Medium | Add with `uv` — enables reproducible environments |
| Config in env vars only | High | Add `config.yaml` with auto-reload |
| No `Makefile` or `scripts/` | Low | Add common dev commands |

### Recommended Structure for Solaris-Agent

```
solaris-agent/
├── swarm/                          # Renamed from "swarm module"
│   ├── config/
│   │   ├── solaris_config.py      # AppConfig equivalent
│   │   └── config.yaml            # Main config
│   │
│   ├── agents/
│   │   ├── commander/
│   │   │   ├── __init__.py
│   │   │   ├── core.py            # Commander logic (~300 lines max)
│   │   │   ├── prompts.py         # System prompts separated
│   │   │   └── rotation.py        # OWASP vector rotation logic
│   │   ├── alpha_recon/
│   │   │   ├── core.py
│   │   │   └── prompts.py
│   │   ├── gamma_exploit/
│   │   │   ├── core.py
│   │   │   ├── reflection.py      # PentAGI self-reflection loop
│   │   │   └── prompts.py
│   │   ├── critic/
│   │   │   ├── core.py
│   │   │   └── prompts.py
│   │   └── hitl/
│   │       ├── core.py
│   │       └── patterns.py        # Destructive pattern detection
│   │
│   ├── core/
│   │   ├── llm_client.py          # Model factory (config-driven)
│   │   ├── stream_bridge.py       # SSE streaming
│   │   ├── sse_utils.py
│   │   ├── stream_worker.py
│   │   ├── redis_bus.py           # A2A messaging (keep)
│   │   ├── parsing.py             # JSON parsing, <think> extraction
│   │   └── loop_detection.py      # Loop detection utility
│   │
│   ├── memory/
│   │   ├── schema.py
│   │   ├── storage.py
│   │   ├── updater.py
│   │   ├── queue.py
│   │   ├── signals.py
│   │   ├── injection.py
│   │   └── summarizer.py
│   │
│   ├── sandbox/
│   │   ├── manager.py             # Warm pool sandbox manager
│   │   └── tools.py               # Sandbox tool wrappers
│   │
│   ├── tools/
│   │   ├── nmap.py
│   │   ├── nuclei.py
│   │   ├── sqlmap.py
│   │   ├── ffuf.py
│   │   ├── jwt_tool.py
│   │   └── web_search.py
│   │
│   ├── api/
│   │   ├── main.py                # FastAPI app factory
│   │   ├── deps.py                # Dependency injection
│   │   ├── lifespan.py            # Startup/shutdown
│   │   └── routers/
│   │       ├── missions.py        # Mission CRUD + streaming
│   │       ├── memory.py          # Memory CRUD
│   │       └── websocket.py       # WebSocket events
│   │
│   ├── graph/
│   │   ├── state.py               # RedTeamState TypedDict
│   │   └── graph.py               # LangGraph graph assembly
│   │
│   └── types/
│       ├── mission.py             # Mission, Finding, ExploitAttempt types
│       ├── agent.py               # Agent message types
│       └── events.py              # Redis event types
│
├── frontend/                      # (existing)
├── vibecheck/                     # (existing)
├── docs/                          # All documentation
├── plans/                         # All implementation plans
├── pyproject.toml                 # NEW: proper package management
├── Makefile                       # NEW: dev shortcuts
└── config.yaml                    # NEW: main configuration
```

### `pyproject.toml` Template

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "solaris-agent"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.32",
    "langgraph>=0.4",
    "langchain-core>=0.3",
    "langchain-openai>=0.3",
    "langchain-ollama>=0.3",
    "redis>=5",
    "supabase>=2",
    "pydantic>=2.10",
    "tiktoken>=0.8",
    "python-dotenv>=1",
    "httpx>=0.28",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8",
    "pytest-asyncio>=0.25",
    "ruff>=0.9",
]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP"]
```

### `Makefile` Template

```makefile
.PHONY: install dev test lint format

install:
    uv sync

dev:
    uv run uvicorn swarm.api.main:app --reload --port 8000

test:
    uv run pytest tests/ -v

lint:
    uv run ruff check swarm/
    uv run ruff format --check swarm/

format:
    uv run ruff format swarm/
```
