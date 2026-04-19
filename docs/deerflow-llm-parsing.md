# DeerFlow LLM Output Parsing: Every Pattern & Technique

> How DeerFlow handles raw LLM output — parsing thinking tags, structured JSON, streaming partial content, tool calls, multi-modal responses, and malformed output. With exact code from the source and adaptation notes.

---

## Table of Contents

1. [Thinking Tag Extraction](#1-thinking-tag-extraction)
2. [Streaming Partial Markdown](#2-streaming-partial-markdown)
3. [Tool Call Parsing from Streams](#3-tool-call-parsing-from-streams)
4. [Structured JSON from LLM](#4-structured-json-from-llm)
5. [Multi-Content Messages](#5-multi-content-messages)
6. [Backend Output Parsing Patterns](#6-backend-output-parsing-patterns)
7. [System Prompt Template Structure](#7-system-prompt-template-structure)
8. [Input Sanitization Patterns](#8-input-sanitization-patterns)
9. [Adaptation for Solaris-Agent](#9-adaptation-for-solaris-agent)

---

## 1. Thinking Tag Extraction

**File:** `frontend/src/core/messages/utils.ts`

### The Core Regex

```typescript
const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g
```

Handles:
- Multi-line content (`[\s\S]*?`)
- Whitespace trimming inside tags (`\s*` before and after content)
- Multiple `<think>` blocks in one response
- Non-greedy (`?`) so it stops at first `</think>`

### Full Parsing Function

```typescript
function splitInlineReasoning(text: string): {
  content: string
  reasoning: string
} {
  const reasoningParts: string[] = []

  const content = text.replace(THINK_TAG_RE, (_, inner) => {
    reasoningParts.push(inner.trim())
    return ""  // remove from main content entirely
  })

  return {
    content: content.trim(),
    reasoning: reasoningParts.join("\n\n"),  // multiple blocks joined
  }
}
```

### Where It's Called

```typescript
function extractTextFromMessage(message: AnyMessage): string {
  const raw = getRawTextContent(message)
  const { content, reasoning } = splitInlineReasoning(raw)
  // reasoning → goes to <Reasoning> component
  // content → goes to <Streamdown> message body
  return content
}

function extractReasoningContentFromMessage(message: AnyMessage): string {
  const raw = getRawTextContent(message)
  return splitInlineReasoning(raw).reasoning
}
```

### Streaming Edge Case: Partial `<think>` Tags

During streaming, the LLM might send:
```
<think>
Let me think about thi
```
(incomplete `</think>`)

The regex won't match (non-greedy needs the closing tag). The entire `<think>...</think>` block stays in `content` until complete. Once `</think>` arrives, the regex strips it from content and moves it to reasoning.

**Handling this:** DeerFlow passes the raw text (including partial `<think>` tags) to `Streamdown` with `parseIncomplete=true`. Streamdown renders it as plain text until the closing tag arrives, then the component re-renders with the tags removed.

### Backend System Prompt for Thinking

```
<thinking_style>
Before responding, think step-by-step inside <think> tags.
Be concise — thinking is for your benefit, not the user's.
Focus on: what the user actually needs, what tools to use, what order.
Do not repeat your thinking in your response.
</thinking_style>
```

The backend instructs the model to use `<think>` tags. The frontend parses and visually separates them.

---

## 2. Streaming Partial Markdown

**Library:** `streamdown` v1.4.0

### Why Standard Markdown Renderers Break During Streaming

Standard markdown parsers (remark, marked) are designed for complete documents. During streaming:

| Incomplete Content | Standard Parser | Streamdown |
|-------------------|----------------|-----------|
| `` ```py\nprint( `` | Raw text (no highlighting) | Code block with partial content |
| `| col1 | col2 |` | Raw text | Table header row |
| `**bold text` | Raw `**bold text` | `bold text` (handles unclosed) |
| `[link text](` | Raw `[link text](` | `link text` (graceful degradation) |

### Usage

```tsx
import { Streamdown } from "streamdown"

<Streamdown
  content={streamingContent}        // grows each token
  parseIncomplete={isStreaming}     // tolerant parsing mode
  plugins={[
    remarkGfm,       // GitHub Flavored Markdown (tables, strikethrough)
    remarkMath,      // LaTeX math ($x^2$)
    rehypeKatex,     // Render math with KaTeX
    rehypeRaw,       // Allow raw HTML in markdown
  ]}
/>
```

### Incremental State

Streamdown maintains internal parse state, so it doesn't re-parse the entire content on each token. It incrementally extends the parse tree, making it efficient for long responses.

---

## 3. Tool Call Parsing from Streams

**File:** `frontend/src/core/threads/hooks.ts`

### LangGraph `messages-tuple` Format

Each SSE chunk in `messages` mode is a tuple:

```typescript
type MessagesTuple = [AnyMessage, StreamMetadata]

interface StreamMetadata {
  langgraph_node: string    // which graph node produced this
  langgraph_step: number
  run_id: string
  thread_id: string
}
```

### Detecting Tool Calls in Streaming Chunks

```typescript
// AIMessageChunk carries partial tool calls during streaming
interface AIMessageChunk {
  type: "AIMessageChunk"
  content: string              // text tokens
  tool_call_chunks: Array<{   // partial tool call (accumulates)
    index: number
    id: string | null
    name: string | null       // arrives first
    args: string              // JSON string, arrives as chunks
  }>
}
```

Tool calls are accumulated across chunks:
- Chunk 1: `{ name: "bash", args: "" }`
- Chunk 2: `{ name: "bash", args: '{"co' }`
- Chunk 3: `{ name: "bash", args: '{"command"' }`
- Chunk 4: `{ name: "bash", args: '{"command": "nmap -sV"}' }`

### LangGraph SDK Handles Accumulation

```typescript
// useStream() from @langchain/langgraph-sdk/react handles this automatically:
const thread = useStream<ThreadState>({
  streamMode: ["messages-tuple", "values"],
  onUpdateEvent: (event) => {
    // thread.messages already has accumulated, complete tool calls
    // No need to manually merge chunks
  }
})
```

### Tool Result Detection

```typescript
// ToolMessage arrives after tool execution completes:
interface ToolMessage {
  type: "ToolMessage"
  name: string        // tool name
  content: string     // result (could be JSON string or plain text)
  tool_call_id: string  // matches the AIMessage tool_call.id
}

// In message-group.tsx — parse tool result:
function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content)     // structured result
  } catch {
    return content                 // plain text fallback
  }
}
```

### Building ChainOfThought Steps

```typescript
// Group messages into (tool_call, tool_result) pairs:
function buildSteps(messages: AnyMessage[]): Step[] {
  const steps: Step[] = []
  let currentAI: AIMessage | null = null

  for (const msg of messages) {
    if (msg.type === "ai" && msg.tool_calls?.length) {
      currentAI = msg
      for (const tc of msg.tool_calls) {
        steps.push({
          id: tc.id,
          toolName: tc.name,
          args: tc.args,
          result: null,       // pending
          status: "running",
        })
      }
    }
    if (msg.type === "tool") {
      const step = steps.find(s => s.id === msg.tool_call_id)
      if (step) {
        step.result = parseToolResult(msg.content)
        step.status = "done"
      }
    }
  }
  return steps
}
```

---

## 4. Structured JSON from LLM

### Backend: Parsing LLM JSON Responses (Python)

**File:** `packages/harness/deerflow/agents/memory/updater.py`

The robust JSON extraction pattern:

```python
import json
import re

def parse_llm_json_response(text: str) -> dict:
    """
    Handles:
    1. Clean JSON
    2. JSON wrapped in ```json ... ``` fences
    3. JSON with leading/trailing prose
    4. JSON with Python-style None/True/False (rare)
    """
    # Strip markdown code fences
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text.strip())
        text = text.strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try finding JSON object/array in surrounding prose
    match = re.search(r'\{[\s\S]*\}|\[[\s\S]*\]', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Last resort: return empty dict and log the failure
    return {}
```

### Pydantic Structured Output (Type-Safe)

For critical structured outputs, DeerFlow uses `model.with_structured_output()`:

```python
from pydantic import BaseModel
from langchain_core.language_models import BaseChatModel

class MemoryUpdate(BaseModel):
    user: dict
    history: dict
    new_facts: list[dict]
    facts_to_remove: list[str]

# Forces LLM to return valid JSON matching the schema:
structured_model = llm.with_structured_output(MemoryUpdate)
result: MemoryUpdate = await structured_model.ainvoke(prompt)
# result is always a valid MemoryUpdate — no parsing needed
```

### Frontend: Tool Result JSON Parsing

```typescript
// message-group.tsx — best-effort with raw fallback:
function parseToolResult(rawContent: string): ParsedResult {
  if (!rawContent) return { type: "empty" }

  try {
    const parsed = JSON.parse(rawContent)
    if (Array.isArray(parsed)) return { type: "array", data: parsed }
    if (typeof parsed === "object") return { type: "object", data: parsed }
    return { type: "primitive", data: parsed }
  } catch {
    // Not JSON — treat as plain text or markdown
    return { type: "text", data: rawContent }
  }
}
```

---

## 5. Multi-Content Messages

LangChain messages can have `content` as either `string` or `ContentPart[]`:

```typescript
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }   // base64 or http URL
  | { type: "tool_use"; ... }   // Anthropic format
  | { type: "tool_result"; ... }

type MessageContent = string | ContentPart[]
```

### Unified Extraction

**File:** `frontend/src/core/messages/utils.ts`

```typescript
function extractContentFromMessage(message: AnyMessage): string {
  const content = message.content

  if (typeof content === "string") return content

  // Array of content parts
  return content
    .map(part => {
      switch (part.type) {
        case "text":
          return part.text

        case "image_url":
          // Convert to markdown image for rendering
          return `![image](${part.image_url.url})`

        default:
          return ""
      }
    })
    .filter(Boolean)
    .join("\n")
}
```

### Inline Images in Messages

```typescript
// When message has images, they render inline via markdown:
// "Here is the scan result:\n![image](data:image/png;base64,...)"
// → Streamdown renders as an actual <img> tag
```

---

## 6. Backend Output Parsing Patterns

### `DanglingToolCallMiddleware`

**File:** `packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py`

Handles a common LangGraph failure: LLM emits a tool_call but no corresponding ToolMessage arrives (e.g., tool crashes, graph interrupted). Without patching, LangGraph throws errors on the next turn.

```python
class DanglingToolCallMiddleware:
    def before_model(self, state, config, runtime):
        messages = state["messages"]
        last_ai = next(
            (m for m in reversed(messages) if isinstance(m, AIMessage)),
            None
        )
        if not last_ai or not last_ai.tool_calls:
            return None

        # Check if all tool calls have matching ToolMessages
        tool_message_ids = {
            m.tool_call_id
            for m in messages
            if isinstance(m, ToolMessage)
        }

        missing = [
            tc for tc in last_ai.tool_calls
            if tc["id"] not in tool_message_ids
        ]

        if not missing:
            return None

        # Inject synthetic ToolMessages for missing results
        synthetic = [
            ToolMessage(
                content="[Tool call was interrupted. Please try again.]",
                tool_call_id=tc["id"],
                name=tc["name"],
            )
            for tc in missing
        ]
        return {"messages": synthetic}
```

### `ToolErrorHandlingMiddleware`

```python
class ToolErrorHandlingMiddleware:
    def after_tool(self, output, config, runtime):
        # If tool threw an exception, output is an error ToolMessage
        # Normalize to ensure LLM sees a clear error description
        if isinstance(output, ToolMessage) and output.status == "error":
            output.content = f"Tool error: {output.content}\n\nPlease try a different approach."
        return output
```

### `LoopDetectionMiddleware`

Detects when the agent is stuck in a repetitive tool-call loop:

```python
class LoopDetectionMiddleware:
    LOOP_THRESHOLD = 3   # same tool call 3+ times = loop

    def before_model(self, state, config, runtime):
        messages = state["messages"]
        recent_tool_calls = self._extract_recent_tool_calls(messages, limit=10)

        # Count occurrences of each (tool_name, args_hash) pair
        call_counts: Counter = Counter()
        for tc in recent_tool_calls:
            key = (tc["name"], self._hash_args(tc["args"]))
            call_counts[key] += 1

        if any(count >= self.LOOP_THRESHOLD for count in call_counts.values()):
            # Inject a system message breaking the loop
            return {
                "messages": [
                    SystemMessage(
                        content="You appear to be in a loop. Stop and reconsider your approach. "
                                "Try a completely different strategy or ask the user for guidance."
                    )
                ]
            }
        return None

    def _hash_args(self, args: dict) -> str:
        return hashlib.md5(
            json.dumps(args, sort_keys=True).encode()
        ).hexdigest()[:8]
```

---

## 7. System Prompt Template Structure

**File:** `packages/harness/deerflow/agents/lead_agent/prompt.py` (727 lines)

### Full Template Order

```
<role>
  {agent_name} description, model info, version
</role>

{soul}  ← agent personality, values, communication style

{memory_context}  ← <memory>...</memory> if enabled

<thinking_style>
  Instructions for <think> tag usage
</thinking_style>

<clarification_system>
  When/how to ask for clarification vs proceed
  Use ask_clarification tool, not inline questions
</clarification_system>

{skills_section}  ← <skill_system>...</skill_system> if skills loaded

{deferred_tools_section}  ← instructions for tool_search

{subagent_section}  ← instructions for task delegation if enabled

<working_directory>
  {workspace_path}
</working_directory>

<response_style>
  - Use markdown for formatting
  - Use tables for structured data
  - Code in code blocks with language tag
  - Cite sources with [1], [2] format
  - Be concise but complete
</response_style>

<critical_reminders>
  - Never fabricate tool outputs
  - Always verify before claiming success
  - Ask clarification rather than assume
</critical_reminders>
```

### The "Soul" Block

```python
SOUL = """
You are helpful, curious, and thorough.
You think carefully before acting.
You communicate with clarity and precision.
You admit uncertainty rather than guessing.
You verify your work before claiming it's done.
"""
```

The soul is separate from role so agents can share a soul while having different roles.

### Clarification System

```
<clarification_system>
Ask for clarification ONLY when:
1. The request is ambiguous and proceeding with any interpretation would waste effort
2. The user seems to have conflicting requirements
3. A critical piece of information is genuinely missing

Do NOT ask for clarification when:
1. You can make a reasonable assumption and proceed
2. The request is clear enough to attempt
3. You could just try and iterate

When clarification is needed, use the ask_clarification tool (not inline questions).
</clarification_system>
```

---

## 8. Input Sanitization Patterns

### Stripping Uploaded File References from Memory

```python
# agents/memory/updater.py
_UPLOAD_SENTENCE_RE = re.compile(
    r'[^.!?]*\b(?:upload(?:ed)?|attach(?:ed)?|file|document|image)\b[^.!?]*[.!?]',
    re.IGNORECASE
)

def strip_upload_mentions(text: str) -> str:
    """Remove sentences that mention file uploads (ephemeral, shouldn't be memorized)."""
    return _UPLOAD_SENTENCE_RE.sub("", text).strip()
```

### Conversation Formatting for Memory Updates

```python
def format_conversation_for_update(messages: list) -> str:
    lines = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            content = msg.content
            # Strip <uploaded_files> XML blocks
            content = re.sub(r"<uploaded_files>.*?</uploaded_files>", "", content, flags=re.DOTALL)
            if content.strip():
                lines.append(f"User: {content.strip()}")

        elif isinstance(msg, AIMessage):
            if msg.content:
                # Truncate very long responses
                content = msg.content[:1000] + "..." if len(msg.content) > 1000 else msg.content
                lines.append(f"Assistant: {content}")

    return "\n\n".join(lines)
```

### Frontend: Stripping `<uploaded_files>` Tags

```typescript
// When displaying human messages in the UI:
function displayHumanMessage(content: string): string {
  // Remove the uploaded files XML block (shown as attachment thumbnails instead)
  return content
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, "")
    .trim()
}
```

### Sanitizing File Uploads

```typescript
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const SUPPORTED_DOC_TYPES = ["text/plain", "text/markdown", "application/pdf"]

function splitUnsupportedUploadFiles(files: File[]): {
  supported: File[]
  unsupported: File[]
} {
  const supported: File[] = []
  const unsupported: File[] = []

  for (const file of files) {
    if ([...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOC_TYPES].includes(file.type)) {
      supported.push(file)
    } else {
      unsupported.push(file)
    }
  }

  return { supported, unsupported }
}
```

---

## 9. Adaptation for Solaris-Agent

### Must-Have Parsing Adaptations

#### 1. `<think>` Tag Parsing (Frontend)

```typescript
// Add to frontend/src/utils/messageUtils.ts
const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g

export function splitThinkingContent(text: string) {
  const thinking: string[] = []
  const content = text.replace(THINK_TAG_RE, (_, inner) => {
    thinking.push(inner.trim())
    return ""
  })
  return { content: content.trim(), thinking: thinking.join("\n\n") }
}
```

Add `<thinking>` instructions to agent system prompts:

```python
THINKING_INSTRUCTIONS = """
Before acting, think inside <think> tags. Be concise.
Consider: what vulnerability is being targeted, what tool to use, what the success criteria are.
"""
```

#### 2. Tool Result JSON Parsing (Frontend)

```typescript
// Solaris-agent tool results (nmap, nuclei, sqlmap) are often JSON
export function parseToolResult(raw: string): {
  type: "json" | "text" | "empty"
  data: unknown
} {
  if (!raw?.trim()) return { type: "empty", data: null }
  try {
    return { type: "json", data: JSON.parse(raw) }
  } catch {
    return { type: "text", data: raw }
  }
}
```

#### 3. Robust Backend JSON Parsing

```python
# Add to swarm/core/parsing.py
import json
import re

def parse_llm_json(text: str) -> dict:
    text = text.strip()
    # Strip code fences
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text.strip()).strip()
    # Try direct
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Extract from prose
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}
```

#### 4. Dangling Tool Call Protection

```python
# Add to swarm/core/graph_utils.py
def patch_dangling_tool_calls(messages: list) -> list:
    """
    If the last AI message has tool calls without matching ToolMessages,
    inject synthetic error ToolMessages to prevent LangGraph state corruption.
    """
    from langchain_core.messages import AIMessage, ToolMessage
    last_ai = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
    if not last_ai or not last_ai.tool_calls:
        return messages

    tool_msg_ids = {m.tool_call_id for m in messages if isinstance(m, ToolMessage)}
    missing = [tc for tc in last_ai.tool_calls if tc["id"] not in tool_msg_ids]

    if not missing:
        return messages

    synthetic = [
        ToolMessage(
            content="[Tool was interrupted. Retry with a different approach.]",
            tool_call_id=tc["id"],
            name=tc["name"],
        )
        for tc in missing
    ]
    return messages + synthetic
```

#### 5. Loop Detection (Commander)

```python
# Add to swarm/agents/commander.py or as middleware
from collections import Counter
import hashlib, json

LOOP_THRESHOLD = 3

def detect_exploit_loop(messages: list) -> bool:
    """Returns True if the same exploit vector is being attempted repeatedly."""
    tool_calls = []
    for msg in messages[-20:]:  # check last 20 messages
        if hasattr(msg, "tool_calls"):
            tool_calls.extend(msg.tool_calls or [])

    if len(tool_calls) < LOOP_THRESHOLD:
        return False

    counts = Counter(
        (tc["name"], hashlib.md5(json.dumps(tc.get("args", {}), sort_keys=True).encode()).hexdigest()[:8])
        for tc in tool_calls
    )
    return any(c >= LOOP_THRESHOLD for c in counts.values())
```

### Solaris-Agent Prompt Template Structure

Adapt DeerFlow's template order for red team agents:

```
<role>
  Commander of the Solaris Red Team Swarm
  Coordinates 4 specialized agents: Alpha Recon, Gamma Exploit, Critic, HITL Gate
</role>

<mission_memory>
  {injected cross-mission intelligence}
</mission_memory>

<thinking_style>
  Think step-by-step inside <think> tags before each action.
  Consider: current mission phase, OWASP vector selection, agent to delegate to.
  Keep thinking concise — actions are what matter.
</thinking_style>

<owasp_rotation_policy>
  {current vector rotation constraints}
</owasp_rotation_policy>

<hitl_gate_policy>
  Always escalate destructive operations (rm -rf, DROP TABLE, etc.)
</hitl_gate_policy>

<response_style>
  Use markdown for reports and findings.
  Use severity badges: [CRITICAL], [HIGH], [MEDIUM], [LOW]
  Tool outputs in code blocks with language: bash, json, xml
</response_style>
```
