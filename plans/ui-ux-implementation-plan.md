# UI/UX Implementation Plan: Solaris-Agent Frontend Polish

> Step-by-step plan to bring DeerFlow-level UI polish to solaris-agent's frontend — real-time thinking display, tool call visualization, code block polish, scroll management, toast notifications, and mission-specific UI components.

---

## Priority Matrix

| Feature | Effort | Impact | Do First? |
|---------|--------|--------|-----------|
| Auto-resize textarea (1 CSS line) | Trivial | High | Yes |
| Enter-to-submit + isComposing guard | 10 min | High | Yes |
| Streaming indicator (3 dots) | 30 min | Very High | Yes |
| Scroll-to-bottom button | 1 hr | High | Yes |
| `<think>` tag parsing + Reasoning component | 2 hrs | Very High | Yes |
| Sonner toast notifications | 1 hr | High | Yes |
| Code block copy button + Shiki | 2 hrs | High | Yes |
| Optimistic messages | 1 hr | High | Yes |
| Tool call ChainOfThought display | 3 hrs | Very High | Yes |
| Empty state + suggestion chips | 1 hr | Medium | Yes |
| File attachment UX | 3 hrs | Medium | Later |
| Dark/light mode | 2 hrs | Medium | Later |
| Mission-specific components | 4 hrs | High | Later |

---

## Phase 1: Foundation (Day 1 — Quick Wins)

These are 1-line or 30-minute changes with outsized impact.

### Step 1.1 — Auto-Resize Textarea

**File:** `frontend/src/styles/globals.css` (or equivalent)

```css
/* One line. That's it. */
textarea {
  field-sizing: content;
  min-height: 4rem;    /* 64px floor */
  max-height: 12rem;   /* 192px cap */
  overflow-y: auto;    /* scroll when capped */
  resize: none;        /* hide manual resize handle */
}
```

No JavaScript. No ResizeObserver. No `scrollHeight` polling. The browser handles it.

### Step 1.2 — Enter to Submit with isComposing Guard

**File:** `frontend/src/components/ChatInput.tsx` (or equivalent)

```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // CRITICAL: guard for CJK input (Chinese, Japanese, Korean)
  // Without this, pressing Enter to confirm an IME suggestion submits the form
  if (e.nativeEvent.isComposing) return

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      onSubmit()
    }
  }
}
```

```tsx
<textarea
  value={input}
  onChange={e => setInput(e.target.value)}
  onKeyDown={handleKeyDown}
  placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
  disabled={isLoading}
/>
```

### Step 1.3 — Install Sonner Toasts

```bash
npm install sonner
```

```tsx
// In app root:
import { Toaster } from "sonner"

export default function App() {
  return (
    <>
      {/* ... */}
      <Toaster position="bottom-right" richColors />
    </>
  )
}

// Replace all alert() / console.error() with:
import { toast } from "sonner"

toast.error("Failed to connect to agent")
toast.success("Mission complete")
toast("Commander is analyzing the target...")
```

### Step 1.4 — Install Tailwind Animation Utilities

```bash
npm install tw-animate-css
# or: npm install class-variance-authority clsx tailwind-merge
```

```tsx
// src/utils/cn.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## Phase 2: Streaming UI (Day 1-2)

### Step 2.1 — Streaming Indicator Component

**File:** `frontend/src/components/StreamingIndicator.tsx`

```tsx
import { cn } from "../utils/cn"

export function StreamingIndicator({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 px-1 py-2", className)} aria-label="Agent is thinking">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-current opacity-60"
          style={{
            animation: "bouncing 1s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}
```

```css
/* globals.css */
@keyframes bouncing {
  0%, 100% { transform: translateY(0); opacity: 0.6; }
  50% { transform: translateY(-6px); opacity: 1; }
}
```

```tsx
// In MessageList:
{isLoading && <StreamingIndicator />}
```

### Step 2.2 — Optimistic Messages

Show user's message immediately — don't wait for server echo:

```tsx
function ChatBox() {
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])
  const { messages, isLoading, submit } = useAgentStream(...)

  const handleSubmit = (text: string) => {
    // Show immediately
    setOptimisticMessages([{
      id: "optimistic-" + Date.now(),
      role: "human",
      content: text,
    }])
    submit(text)
    setInput("")
  }

  // Clear when real messages arrive
  const prevLengthRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevLengthRef.current) {
      setOptimisticMessages([])
    }
    prevLengthRef.current = messages.length
  }, [messages.length])

  const displayMessages = [...messages, ...optimisticMessages]

  return (
    <div>
      <MessageList messages={displayMessages} isLoading={isLoading} />
      <ChatInput onSubmit={handleSubmit} disabled={isLoading} />
    </div>
  )
}
```

---

## Phase 3: Thinking/Reasoning Display (Day 2-3)

### Step 3.1 — `<think>` Tag Parser

**File:** `frontend/src/utils/messageUtils.ts`

```typescript
const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g

export function splitThinkingContent(text: string): {
  content: string
  thinking: string
} {
  const thinkingParts: string[] = []

  const content = text.replace(THINK_TAG_RE, (_, inner) => {
    thinkingParts.push(inner.trim())
    return ""
  })

  return {
    content: content.trim(),
    thinking: thinkingParts.join("\n\n"),
  }
}
```

### Step 3.2 — Reasoning Component

**File:** `frontend/src/components/Reasoning.tsx`

```tsx
import { useState, useEffect, useRef } from "react"
import { ChevronDown, Brain } from "lucide-react"
import { cn } from "../utils/cn"

const AUTO_CLOSE_DELAY = 1000  // close 1s after stream ends

interface Props {
  content: string
  isStreaming: boolean
}

export function Reasoning({ content, isStreaming }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [durationSecs, setDurationSecs] = useState<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  // Auto-open when streaming begins
  useEffect(() => {
    if (isStreaming && !isOpen) {
      setIsOpen(true)
      startTimeRef.current = Date.now()
    }
  }, [isStreaming])

  // Auto-close after streaming ends
  useEffect(() => {
    if (!isStreaming && isOpen && startTimeRef.current) {
      const secs = Math.round((Date.now() - startTimeRef.current) / 1000)
      setDurationSecs(secs)
      const t = setTimeout(() => setIsOpen(false), AUTO_CLOSE_DELAY)
      return () => clearTimeout(t)
    }
  }, [isStreaming])

  if (!content && !isStreaming) return null

  return (
    <div className="mb-3 rounded-lg border border-border/50 overflow-hidden">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm
                   text-muted-foreground hover:text-foreground hover:bg-muted/50
                   transition-colors"
      >
        {isStreaming ? (
          <Shimmer className="h-3.5 w-3.5 rounded-full" />
        ) : (
          <Brain className="h-3.5 w-3.5" />
        )}
        <span className="flex-1 text-left">
          {isStreaming
            ? "Thinking..."
            : durationSecs != null
              ? `Thought for ${durationSecs}s`
              : "Reasoning"
          }
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Content */}
      {isOpen && (
        <div className="border-t border-border/50 px-3 py-3">
          <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono">
            {content || <ThinkingPlaceholder />}
          </div>
        </div>
      )}
    </div>
  )
}

function ThinkingPlaceholder() {
  return (
    <div className="flex items-center gap-2">
      <Shimmer className="h-3 w-48 rounded" />
    </div>
  )
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block bg-gradient-to-r from-muted via-muted-foreground/30 to-muted",
        "bg-[length:200%_100%]",
        className
      )}
      style={{ animation: "shine 1.5s ease-in-out infinite" }}
    />
  )
}
```

```css
@keyframes shine {
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
}
```

### Step 3.3 — Wire Into Message Component

```tsx
// In your message renderer:
import { splitThinkingContent } from "../utils/messageUtils"
import { Reasoning } from "./Reasoning"

function AIMessage({ message, isStreaming }) {
  const { content, thinking } = splitThinkingContent(message.content)

  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex-1 min-w-0">
        {/* Reasoning section (collapsible) */}
        {(thinking || isStreaming) && (
          <Reasoning content={thinking} isStreaming={isStreaming} />
        )}
        {/* Main response */}
        <div className="prose prose-sm max-w-none">
          {content}
        </div>
      </div>
    </div>
  )
}
```

### Step 3.4 — Update Agent Prompts to Use `<think>` Tags

```python
# In agent system prompts (commander.py, gamma_exploit.py, etc.):
THINKING_INSTRUCTION = """
Before each action, think step-by-step inside <think> tags.
Keep thinking concise and focused.
Consider:
- Current mission phase and objectives
- Which OWASP vector to target
- Which tool or agent to use next
- What success looks like for this step

Do not repeat your thinking in your response.
</think>
"""
```

---

## Phase 4: Code Block Polish (Day 3)

### Step 4.1 — Install Shiki

```bash
npm install shiki
```

### Step 4.2 — CodeBlock Component

**File:** `frontend/src/components/CodeBlock.tsx`

```tsx
import { useState, useEffect } from "react"
import { codeToHtml } from "shiki"
import { useTheme } from "next-themes"
import { Check, Copy } from "lucide-react"
import { cn } from "../utils/cn"

interface Props {
  code: string
  lang?: string
  showLineNumbers?: boolean
}

export function CodeBlock({ code, lang = "text", showLineNumbers = false }: Props) {
  const [highlighted, setHighlighted] = useState("")
  const [copied, setCopied] = useState(false)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    codeToHtml(code, {
      lang,
      theme: resolvedTheme === "dark" ? "one-dark-pro" : "one-light",
    }).then(setHighlighted)
  }, [code, lang, resolvedTheme])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Fallback for HTTP
      const el = document.createElement("textarea")
      el.value = code
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative rounded-lg overflow-hidden border border-border bg-muted">
      {/* Language label */}
      {lang && lang !== "text" && (
        <div className="absolute top-2 left-3 z-10 text-xs text-muted-foreground font-mono select-none">
          {lang}
        </div>
      )}

      {/* Copy button — only visible on hover */}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md
                   opacity-0 group-hover:opacity-100 transition-opacity
                   bg-background/80 hover:bg-background border border-border"
        title="Copy code"
      >
        {copied
          ? <Check className="h-3.5 w-3.5 text-green-500" />
          : <Copy className="h-3.5 w-3.5" />
        }
      </button>

      {/* Code content */}
      <div
        className="overflow-x-auto text-sm"
        style={{ paddingTop: lang && lang !== "text" ? "2rem" : "1rem" }}
        dangerouslySetInnerHTML={{ __html: highlighted || `<pre><code>${code}</code></pre>` }}
      />
    </div>
  )
}
```

---

## Phase 5: Scroll Management (Day 3)

### Step 5.1 — Install use-stick-to-bottom

```bash
npm install use-stick-to-bottom
```

### Step 5.2 — Implement Sticky Scroll

```tsx
import { useStickToBottom } from "use-stick-to-bottom"
import { ArrowDown } from "lucide-react"
import { cn } from "../utils/cn"

export function MessageList({ messages, isLoading }) {
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottom()

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map(msg => (
            <MessageItem key={msg.id} message={msg} />
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <AgentAvatar />
              <StreamingIndicator />
            </div>
          )}
        </div>
      </div>

      {/* Scroll-to-bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className={cn(
            "absolute bottom-6 right-6 z-10",
            "flex h-8 w-8 items-center justify-center",
            "rounded-full bg-background border border-border shadow-md",
            "hover:bg-muted transition-colors",
            "animate-[fade-in-up_0.2s_ease-out]"  // CSS animation
          )}
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
```

```css
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## Phase 6: Tool Call Display (Day 4-5)

### Step 6.1 — ChainOfThought Component

**File:** `frontend/src/components/ChainOfThought.tsx`

```tsx
import { useState } from "react"
import { ChevronDown, CheckCircle, XCircle, Loader2, Terminal, Globe, FileText } from "lucide-react"
import { cn } from "../utils/cn"

export interface ToolStep {
  id: string
  toolName: string
  args: Record<string, unknown>
  result: unknown | null
  status: "running" | "done" | "error"
}

interface Props {
  steps: ToolStep[]
  defaultOpen?: boolean
}

export function ChainOfThought({ steps, defaultOpen = false }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen || steps.some(s => s.status === "running"))

  if (steps.length === 0) return null

  const allDone = steps.every(s => s.status !== "running")

  return (
    <div className="mb-3 rounded-lg border border-border/50 overflow-hidden text-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <StepStatusIcon steps={steps} />
        <span className="flex-1 text-left text-muted-foreground">
          {allDone ? `Used ${steps.length} tool${steps.length > 1 ? "s" : ""}` : "Working..."}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="border-t border-border/50 divide-y divide-border/30">
          {steps.map(step => (
            <ToolStep key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  )
}

function StepStatusIcon({ steps }: { steps: ToolStep[] }) {
  const hasRunning = steps.some(s => s.status === "running")
  const hasError = steps.some(s => s.status === "error")

  if (hasRunning) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  if (hasError) return <XCircle className="h-3.5 w-3.5 text-destructive" />
  return <CheckCircle className="h-3.5 w-3.5 text-green-500" />
}

function ToolStep({ step }: { step: ToolStep }) {
  const [showResult, setShowResult] = useState(false)

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <ToolIcon toolName={step.toolName} />
        <span className="font-medium text-foreground">{humanizeToolName(step.toolName)}</span>
        <span className="text-muted-foreground text-xs ml-auto">
          {step.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
          {step.status === "done" && <CheckCircle className="h-3 w-3 text-green-500" />}
          {step.status === "error" && <XCircle className="h-3 w-3 text-destructive" />}
        </span>
      </div>

      {/* Args preview */}
      <div className="mt-1 text-xs text-muted-foreground font-mono truncate">
        {formatArgsPreview(step.toolName, step.args)}
      </div>

      {/* Result (click to expand) */}
      {step.result != null && (
        <button
          onClick={() => setShowResult(!showResult)}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {showResult ? "Hide output" : "View output"}
        </button>
      )}
      {showResult && step.result != null && (
        <ToolResult toolName={step.toolName} result={step.result} />
      )}
    </div>
  )
}

function ToolResult({ toolName, result }: { toolName: string; result: unknown }) {
  const content = typeof result === "string" ? result : JSON.stringify(result, null, 2)

  // Mission-specific renderers
  if (toolName === "nmap") return <NmapResult output={content} />
  if (toolName === "nuclei") return <NucleiResult output={content} />

  return (
    <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs max-h-48 overflow-y-auto font-mono">
      {content}
    </pre>
  )
}
```

### Step 6.2 — Tool Name Humanization

```typescript
// frontend/src/utils/toolNames.ts
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  nmap: "Port scan",
  nuclei: "Vulnerability scan",
  sqlmap: "SQL injection test",
  ffuf: "Directory fuzzing",
  curl: "HTTP request",
  web_search: "Web search",
  jwt_tool: "JWT analysis",
  python_exec: "Running script",
}

export function humanizeToolName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name.replace(/_/g, " ")
}

export function formatArgsPreview(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "nmap") return `${args.target} ${args.flags ?? ""}`
  if (toolName === "nuclei") return `${args.target}`
  if (toolName === "sqlmap") return `${args.url}`
  if (toolName === "ffuf") return `${args.url}`
  if (toolName === "curl") return `${args.method ?? "GET"} ${args.url}`
  return JSON.stringify(args).slice(0, 60) + "..."
}
```

### Step 6.3 — Mission-Specific Tool Renderers

```tsx
// Nmap port table
function NmapResult({ output }: { output: string }) {
  const lines = output.split("\n").filter(l => l.includes("/tcp") || l.includes("/udp"))
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="text-xs font-mono w-full">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1 pr-4">PORT</th>
            <th className="text-left py-1 pr-4">STATE</th>
            <th className="text-left py-1">SERVICE</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const [port, state, service] = line.trim().split(/\s+/)
            return (
              <tr key={i} className="border-b border-border/30">
                <td className="py-1 pr-4 text-blue-400">{port}</td>
                <td className={cn("py-1 pr-4", state === "open" ? "text-green-400" : "text-muted-foreground")}>
                  {state}
                </td>
                <td className="py-1 text-foreground">{service}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Nuclei finding severity badges
function NucleiResult({ output }: { output: string }) {
  const findings = parseNucleiOutput(output)
  const SEVERITY_COLORS = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    info: "bg-muted text-muted-foreground border-border",
  }

  return (
    <div className="mt-2 space-y-1">
      {findings.map((f, i) => (
        <div key={i} className={cn("flex items-center gap-2 rounded px-2 py-1 border text-xs", SEVERITY_COLORS[f.severity])}>
          <span className="font-semibold uppercase">{f.severity}</span>
          <span>{f.name}</span>
          <span className="ml-auto text-muted-foreground font-mono truncate max-w-[200px]">{f.url}</span>
        </div>
      ))}
    </div>
  )
}
```

---

## Phase 7: Empty State & Suggestions (Day 5)

### Step 7.1 — Empty State Component

```tsx
// frontend/src/components/MissionEmptyState.tsx
import { Shield, Crosshair, Radar, Bug } from "lucide-react"

const SUGGESTIONS = [
  "Start a full penetration test on 192.168.1.10",
  "Run a quick reconnaissance scan on the target",
  "Test for OWASP Top 10 vulnerabilities",
  "Analyze the authentication mechanisms",
]

export function MissionEmptyState({ onSelect }: { onSelect: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
      <div className="flex gap-3">
        {[Shield, Crosshair, Radar, Bug].map((Icon, i) => (
          <div key={i} className="rounded-xl bg-muted p-3">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-xl font-semibold">Solaris Agent Ready</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          Describe your target and mission objectives. The swarm will coordinate reconnaissance, exploitation, and reporting.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s)}
            className="rounded-full border border-border px-4 py-2 text-sm
                       hover:bg-muted hover:border-muted-foreground/50
                       transition-colors text-left"
            style={{
              animation: "fade-in-up 0.3s ease-out both",
              animationDelay: `${i * 0.05}s`,
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
```

---

## Phase 8: Mission-Specific Components (Day 6-7)

### Step 8.1 — HITL Gate UI

```tsx
// frontend/src/components/HITLGate.tsx
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react"

interface Props {
  pattern: string
  agent: string
  command: string
  onApprove: () => void
  onReject: () => void
}

export function HITLGate({ pattern, agent, command, onApprove, onReject }: Props) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-destructive font-semibold">
        <AlertTriangle className="h-4 w-4" />
        Human Approval Required
      </div>

      <div className="text-sm text-muted-foreground">
        <span className="font-mono bg-muted px-1 rounded">{agent}</span> wants to execute a destructive operation:
      </div>

      <pre className="rounded bg-muted p-3 text-xs font-mono text-foreground overflow-x-auto">
        {command}
      </pre>

      <div className="text-xs text-muted-foreground">
        Detected pattern: <span className="font-mono text-destructive">{pattern}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700
                     px-3 py-1.5 text-sm font-medium text-white transition-colors"
        >
          <CheckCircle className="h-3.5 w-3.5" />
          Approve
        </button>
        <button
          onClick={onReject}
          className="flex items-center gap-1.5 rounded-md bg-destructive hover:bg-destructive/90
                     px-3 py-1.5 text-sm font-medium text-white transition-colors"
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  )
}
```

### Step 8.2 — Mission Phase Indicator

```tsx
// frontend/src/components/MissionPhase.tsx
const PHASES = [
  { id: "recon", label: "Reconnaissance", agent: "alpha_recon" },
  { id: "exploit", label: "Exploitation", agent: "gamma_exploit" },
  { id: "critique", label: "Critique", agent: "critic" },
] as const

export function MissionPhaseBar({ activeAgent }: { activeAgent: string | null }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground px-4 py-1.5 border-b border-border bg-muted/30">
      {PHASES.map((phase, i) => (
        <div key={phase.id} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 opacity-30" />}
          <span className={cn(
            "px-2 py-0.5 rounded-full transition-colors",
            activeAgent === phase.agent
              ? "bg-primary/10 text-primary font-medium"
              : "opacity-50"
          )}>
            {phase.label}
          </span>
        </div>
      ))}
    </div>
  )
}
```

### Step 8.3 — Finding Severity Badge

```tsx
// frontend/src/components/FindingBadge.tsx
type Severity = "critical" | "high" | "medium" | "low" | "info"

const COLORS: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30 ring-red-500/20",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  info: "bg-muted text-muted-foreground border-border",
}

export function FindingBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
      COLORS[severity]
    )}>
      {severity}
    </span>
  )
}
```

---

## Complete Rollout Checklist

### Phase 1 — Foundation
- [ ] `field-sizing: content` on textarea
- [ ] `isComposing` guard on Enter key
- [ ] Sonner `<Toaster />` in app root
- [ ] All `alert()`/`console.error()` replaced with `toast()`
- [ ] `cn()` utility from clsx + tailwind-merge

### Phase 2 — Streaming
- [ ] `StreamingIndicator` component (3 bouncing dots)
- [ ] Optimistic messages (show immediately on submit)
- [ ] `isLoading` state wired to streaming indicator
- [ ] Streaming indicator cleared on stream end

### Phase 3 — Thinking Display
- [ ] `splitThinkingContent()` utility
- [ ] `<Reasoning>` component with auto-open/auto-close
- [ ] Shimmer animation for "Thinking..." state
- [ ] "Thought for Xs" duration display
- [ ] Agent system prompts updated with `<think>` instructions
- [ ] Reasoning wired into AIMessage render

### Phase 4 — Code Blocks
- [ ] Shiki installed and configured
- [ ] `<CodeBlock>` component with language label
- [ ] Copy button (hover-reveal, 2s feedback)
- [ ] Dual theme (one-dark-pro / one-light)

### Phase 5 — Scroll
- [ ] `use-stick-to-bottom` installed
- [ ] Auto-scroll only when user is at bottom
- [ ] Scroll-to-bottom button with fade-in-up animation
- [ ] Button hidden when at bottom

### Phase 6 — Tool Calls
- [ ] `<ChainOfThought>` accordion component
- [ ] Per-step status icons (spinner / check / x)
- [ ] Tool name humanization map
- [ ] Nmap port table renderer
- [ ] Nuclei severity badge renderer
- [ ] Expandable raw output

### Phase 7 — Empty State
- [ ] `<MissionEmptyState>` with icons
- [ ] Suggestion chips with staggered animation
- [ ] Clicking suggestion fills input

### Phase 8 — Mission UI
- [ ] `<HITLGate>` approval card
- [ ] `<MissionPhaseBar>` phase indicator
- [ ] `<FindingBadge>` severity badges
- [ ] HITL gate wired to custom SSE events

---

*Reference: `docs/deerflow-ui-ux.md` for full pattern catalog.*
*Reference: `docs/deerflow-llm-parsing.md` for `<think>` tag and output parsing details.*
*Reference: `plans/deerflow-integration-master-plan.md` for overall sequencing.*
