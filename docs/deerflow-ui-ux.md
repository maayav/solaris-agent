# DeerFlow UI/UX Deep Dive: Every Good Pattern & Nice Detail

> A complete catalog of every UI/UX pattern, animation, nice detail, and polish element in DeerFlow's frontend — with exact file references and adaptation notes for solaris-agent.

---

## Table of Contents

1. [Chat Input Component](#1-chat-input-component)
2. [Message Rendering](#2-message-rendering)
3. [Thinking/Reasoning Section](#3-thinkingreasoning-section)
4. [Tool Call Display](#4-tool-call-display)
5. [Streaming & Loading States](#5-streaming--loading-states)
6. [Scroll Management](#6-scroll-management)
7. [Error States & Toast Notifications](#7-error-states--toast-notifications)
8. [Empty States](#8-empty-states)
9. [Animations & CSS Details](#9-animations--css-details)
10. [Code Block Polish](#10-code-block-polish)
11. [Dark/Light Mode System](#11-darklight-mode-system)
12. [Responsive Design Patterns](#12-responsive-design-patterns)
13. [Message Actions (Copy, Retry)](#13-message-actions-copy-retry)
14. [File/Image Attachments UX](#14-fileimage-attachments-ux)
15. [Keyboard Shortcuts](#15-keyboard-shortcuts)
16. [Adaptation Checklist for Solaris-Agent](#16-adaptation-checklist-for-solaris-agent)

---

## 1. Chat Input Component

**File:** `frontend/src/components/ai-elements/prompt-input.tsx` (1469 lines)

### Auto-Resize Textarea

Uses CSS `field-sizing: content` (not JavaScript) for natural growth:

```css
/* globals.css */
textarea {
  field-sizing: content;
}
```

```tsx
<textarea
  className="max-h-48 min-h-16 w-full resize-none overflow-y-auto"
  // max-h-48 = 12rem cap, min-h-16 = 4rem floor
  // overflow-y-auto adds scroll only when capped
/>
```

**Why better than JS resize:** No layout shift, no `scrollHeight` polling, no ResizeObserver needed.

### Enter to Submit, Shift+Enter for Newline

```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // Prevent submit during IME composition (Chinese/Japanese/Korean input)
  if (e.nativeEvent.isComposing) return

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    if (value.trim()) {
      onSubmit()
    }
  }

  // Backspace on empty textarea removes last attachment
  if (e.key === "Backspace" && value === "" && attachments.length > 0) {
    e.preventDefault()
    removeAttachment(attachments[attachments.length - 1].id)
  }
}
```

**Key insight:** The `isComposing` check is critical for CJK users — without it, pressing Enter to confirm an IME suggestion submits the form.

### Paste File Handling

```tsx
const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const files = Array.from(e.clipboardData.files)
  if (files.length > 0) {
    e.preventDefault()   // Don't paste file path as text
    addFiles(files)      // Add as attachments instead
  }
  // Text paste falls through to default behavior
}
```

### Drag-and-Drop Anywhere

```tsx
// Enabled via globalDrop prop — listens on document, not just textarea
useEffect(() => {
  if (!globalDrop) return
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) addFiles(files)
  }
  document.addEventListener("drop", onDrop)
  document.addEventListener("dragover", e => e.preventDefault())
  return () => document.removeEventListener("drop", onDrop)
}, [globalDrop])
```

### Input Validation

```tsx
const addFiles = (incoming: File[]) => {
  // 1. Check unsupported types
  const { supported, unsupported } = splitUnsupportedUploadFiles(incoming)
  if (unsupported.length) toast.error(`${unsupported.length} file(s) not supported`)

  // 2. Check max files limit
  if (attachments.length + supported.length > maxFiles) {
    toast.error(`Max ${maxFiles} files allowed`)
    return
  }

  // 3. Check individual file size
  const tooBig = supported.filter(f => f.size > maxFileSize)
  if (tooBig.length) {
    toast.error(`Files must be under ${formatBytes(maxFileSize)}`)
    return
  }

  // 4. Create blob URL for local preview (revoked on unmount)
  const withPreviews = supported.map(f => ({
    file: f,
    previewUrl: URL.createObjectURL(f),
    id: crypto.randomUUID(),
  }))
  setAttachments(prev => [...prev, ...withPreviews])
}

// Cleanup on unmount (prevent memory leak)
useEffect(() => {
  return () => attachments.forEach(a => URL.revokeObjectURL(a.previewUrl))
}, [])
```

### Submit Flow (Blob → Data URL → Upload)

```tsx
const handleSubmit = async () => {
  if (!value.trim() && attachments.length === 0) return

  // Convert blob URLs to base64 data URLs before sending
  const uploadedFiles = await Promise.all(
    attachments.map(async a => {
      const dataUrl = await blobToDataUrl(a.previewUrl)
      return { name: a.file.name, type: a.file.type, dataUrl }
    })
  )

  onSubmit({ text: value, files: uploadedFiles })
  setValue("")
  clearAttachments()
}
```

---

## 2. Message Rendering

**File:** `frontend/src/components/ai-elements/message.tsx` (446 lines)

### Streaming-Aware Markdown (`Streamdown`)

```tsx
import { Streamdown } from "streamdown"

function MessageResponse({ content, isStreaming }: Props) {
  return (
    <Streamdown
      content={content}
      parseIncomplete={isStreaming}   // handles partial code blocks, tables
      plugins={[remarkGfm, remarkMath, rehypeKatex, rehypeRaw]}
    />
  )
}
```

`parseIncomplete=true` makes the markdown parser tolerant of:
- Unclosed `` ``` `` code fences
- Incomplete tables (renders partial rows)
- Unclosed bold/italic markers
- Partial links `[text](`

### User Message vs AI Message

```tsx
function Message({ message }: { message: AnyMessage }) {
  if (message.type === "human") {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2">
        {/* Right-aligned bubble, max 80% width */}
        <MessageContent message={message} />
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex-1 min-w-0">
        {/* Left-aligned, full width, with avatar */}
        <MessageContent message={message} />
      </div>
    </div>
  )
}
```

### Multi-Content Handling

Messages can have `content` as `string` or `ContentPart[]`:

```tsx
function MessageContent({ message }) {
  const content = extractContentFromMessage(message)
  // Returns unified string:
  // - "text" parts → raw text
  // - "image_url" parts → "![image](data:image/...)"  (inline markdown)
  return <Streamdown content={content} />
}
```

---

## 3. Thinking/Reasoning Section

**File:** `frontend/src/components/ai-elements/reasoning.tsx` (187 lines)

This is one of DeerFlow's most polished features.

### Architecture

```
Reasoning (Radix Collapsible root)
├── ReasoningTrigger (toggle button)
│   ├── Shimmer animation (while streaming)
│   ├── "Thinking..." text (while streaming)
│   └── "Thought for Xs" text (when done)
└── ReasoningContent (collapsible content)
    └── Streamdown (streaming markdown)
```

### Auto-Open / Auto-Close Behavior

```tsx
const AUTO_CLOSE_DELAY = 1000  // 1 second after stream ends

function Reasoning({ content, isStreaming }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [durationSecs, setDurationSecs] = useState<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  // Auto-OPEN when streaming begins
  useEffect(() => {
    if (isStreaming && !isOpen) {
      setIsOpen(true)
      startTimeRef.current = Date.now()
    }
  }, [isStreaming])

  // Auto-CLOSE 1 second after streaming ends, show duration
  useEffect(() => {
    if (!isStreaming && isOpen && startTimeRef.current) {
      const duration = Math.round((Date.now() - startTimeRef.current) / 1000)
      setDurationSecs(duration)
      const timer = setTimeout(() => setIsOpen(false), AUTO_CLOSE_DELAY)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ReasoningTrigger isStreaming={isStreaming} durationSecs={durationSecs} />
      <CollapsibleContent>
        <ReasoningContent content={content} isStreaming={isStreaming} />
      </CollapsibleContent>
    </Collapsible>
  )
}
```

### Trigger Button with Shimmer

```tsx
function ReasoningTrigger({ isStreaming, durationSecs }) {
  return (
    <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      {isStreaming ? (
        <>
          <Shimmer className="h-4 w-4 rounded-full" />  {/* animated shimmer dot */}
          <span>Thinking...</span>
        </>
      ) : (
        <>
          <BrainIcon className="h-4 w-4" />
          <span>
            {durationSecs != null
              ? `Thought for ${durationSecs} second${durationSecs !== 1 ? "s" : ""}`
              : "Reasoning"}
          </span>
        </>
      )}
      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
    </CollapsibleTrigger>
  )
}
```

### Shimmer Component

**File:** `frontend/src/components/ai-elements/shimmer.tsx`

```tsx
function Shimmer({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block bg-gradient-to-r from-foreground/20 via-foreground/60 to-foreground/20",
        "bg-[length:200%_100%] animate-[shine_1.5s_ease-in-out_infinite]",
        className
      )}
    />
  )
}
```

```css
/* globals.css */
@keyframes shine {
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
}
```

### Parsing `<think>` Tags from LLM Output

**File:** `frontend/src/core/messages/utils.ts`

```tsx
const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g

function splitInlineReasoning(text: string): { content: string; reasoning: string } {
  const reasoning: string[] = []
  const content = text.replace(THINK_TAG_RE, (_, inner) => {
    reasoning.push(inner.trim())
    return ""   // remove <think> block from main content
  })
  return {
    content: content.trim(),
    reasoning: reasoning.join("\n\n"),
  }
}

// Usage:
function extractTextFromMessage(message: AnyMessage) {
  const raw = getRawText(message)
  const { content, reasoning } = splitInlineReasoning(raw)
  return { content, reasoning }
}
```

**What this enables:** A single LLM response like:
```
<think>
Let me analyze the target...
First I'll check for open ports
</think>

I'll start by running a port scan.
```

Gets split into:
- `reasoning`: "Let me analyze the target..." (shown in Reasoning section)
- `content`: "I'll start by running a port scan." (shown in message body)

---

## 4. Tool Call Display

**File:** `frontend/src/components/workspace/messages/message-group.tsx` (486 lines)

### Visual Hierarchy

```
ChainOfThought (accordion/collapsible)
└── ChainOfThoughtStep (per tool call)
    ├── Status icon (spinner | check | x)
    ├── Tool name (human-readable)
    ├── Args preview (condensed)
    └── Result (expandable)
```

### Tool-Specific Renderers

Each tool type has a unique visual treatment:

```tsx
function ToolCallResult({ toolName, args, result }) {
  switch (toolName) {
    case "web_search":
      return <WebSearchResult results={result} />
      // Shows: result cards with title, URL, snippet

    case "image_search":
      return <ImageSearchResult images={result} />
      // Shows: thumbnail grid with hover-expand tooltip

    case "web_fetch":
      return <WebFetchResult url={args.url} content={result} />
      // Shows: URL badge + extracted text preview

    case "bash":
      return <CodeBlock language="bash" code={args.command} output={result} />
      // Shows: command in code block + collapsible output

    case "read_file":
      return <FilePath path={args.path} />
      // Shows: file icon + clickable path

    case "write_file":
    case "str_replace":
      return <ArtifactLink path={args.path} onClick={openArtifactPanel} />
      // Shows: "View file" button that opens artifact side panel

    case "ask_clarification":
      return <ClarificationRequest question={args.question} />
      // Shows: special "I need your help" card with user input

    case "write_todos":
      return <TodoIndicator count={args.todos.length} />
      // Shows: checklist icon with count

    default:
      return (
        <pre className="text-xs overflow-auto max-h-48 rounded bg-muted p-2">
          {JSON.stringify(result, null, 2)}
        </pre>
      )
  }
}
```

### Step Status Icons

```tsx
function StepIcon({ status }: { status: "running" | "done" | "error" }) {
  if (status === "running") return <Loader className="animate-spin h-3 w-3" />
  if (status === "done") return <CheckIcon className="h-3 w-3 text-green-500" />
  return <XIcon className="h-3 w-3 text-red-500" />
}
```

### Tool Name Humanization

```tsx
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: "Searching the web",
  bash: "Running command",
  read_file: "Reading file",
  write_file: "Writing file",
  str_replace: "Editing file",
  web_fetch: "Fetching URL",
  image_search: "Searching images",
  ask_clarification: "Asking for clarification",
  write_todos: "Updating task list",
}

const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName
```

---

## 5. Streaming & Loading States

### The Streaming Indicator (3 Bouncing Dots)

**File:** `frontend/src/components/workspace/streaming-indicator.tsx`

```tsx
function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-foreground/40"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}
```

```css
/* globals.css */
@keyframes bouncing {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.streaming-indicator span {
  animation: bouncing 1s ease-in-out infinite;
}
```

### Skeleton Loading

```css
@keyframes skeleton-entrance {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Used on initial thread load — messages fade+slide in from below.

### Optimistic Messages

While the server processes:
1. User message appears immediately (optimistic)
2. Streaming indicator appears
3. Server message chunks replace optimistic content
4. Streaming indicator disappears

```tsx
// In hooks.ts:
const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])

const submit = (text: string) => {
  // Show immediately
  setOptimisticMessages([{ role: "human", content: text, id: "optimistic" }])
  thread.submit({ messages: [{ role: "human", content: text }] })
}

// Clear when server messages arrive
useEffect(() => {
  if (thread.messages.length > lastKnownLength) {
    setOptimisticMessages([])
  }
}, [thread.messages.length])
```

---

## 6. Scroll Management

**File:** `frontend/src/components/ai-elements/conversation.tsx`

Uses `use-stick-to-bottom` library — the smartest scroll UX pattern:

### Stick-to-Bottom Behavior

```tsx
import { useStickToBottom } from "use-stick-to-bottom"

function MessageList() {
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottom()

  return (
    <div ref={scrollRef} className="overflow-y-auto h-full">
      {/* messages */}
    </div>
  )
}
```

**How it works:**
- If user is at the bottom → auto-scroll as new content arrives
- If user scrolled up (reading history) → stop auto-scrolling (don't interrupt)
- User can manually scroll down → resume auto-scrolling

### Scroll-to-Bottom Button

```tsx
function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  if (isAtBottom) return null  // hide when already at bottom

  return (
    <button
      onClick={scrollToBottom}
      className="absolute bottom-24 right-4 rounded-full bg-background shadow-md p-2
                 animate-[fade-in-up_0.2s_ease-out]"  // fades in when user scrolls up
    >
      <ArrowDownIcon className="h-4 w-4" />
    </button>
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

## 7. Error States & Toast Notifications

### Toast Library: `sonner`

```tsx
import { toast } from "sonner"

// Error (red)
toast.error("Failed to connect to agent. Please retry.")

// Info (neutral)
toast("Mission complete. 3 findings discovered.")

// Success (green)
toast.success("Memory updated successfully.")

// With action button
toast.error("Rate limit hit", {
  action: {
    label: "Retry",
    onClick: () => retry(),
  },
})
```

### `<Toaster />` Setup

```tsx
// In app root layout:
import { Toaster } from "sonner"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  )
}
```

### Stream Error Handling

```tsx
// In useStream onError handler:
onError: (error) => {
  toast.error(error.message ?? "Something went wrong")
  setIsLoading(false)
}
```

### Inline Error States

For persistent errors (not toasts):

```tsx
{thread.error && (
  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
    <AlertTriangleIcon className="mr-2 inline h-4 w-4" />
    {thread.error.message}
    <button onClick={retry} className="ml-4 underline">Try again</button>
  </div>
)}
```

---

## 8. Empty States

**File:** `frontend/src/components/ai-elements/conversation.tsx`

```tsx
function ConversationEmptyState({ title, description, icon: Icon }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <div className="rounded-full bg-muted p-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  )
}

// Usage:
<ConversationEmptyState
  icon={MessageSquareIcon}
  title="Start a conversation"
  description="Ask the agent to begin a mission, run reconnaissance, or analyze a target."
/>
```

### Suggestion Chips (empty state enhancement)

```tsx
function SuggestionChips({ suggestions, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s)}
          className="rounded-full border px-4 py-2 text-sm hover:bg-muted
                     animate-[fade-in-up_0.3s_ease-out]"
          style={{ animationDelay: `${i * 0.05}s` }}  // staggered entrance
        >
          {s}
        </button>
      ))}
    </div>
  )
}
```

---

## 9. Animations & CSS Details

**File:** `frontend/src/styles/globals.css`

### Complete Animation Catalog

```css
/* Scroll-to-bottom button appearance */
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Streaming indicator dots */
@keyframes bouncing {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* Initial message entrance */
@keyframes skeleton-entrance {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Background gradient on homepage */
@keyframes aurora {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* Reasoning shimmer / loading shimmer */
@keyframes shine {
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
}

/* Spinner for tool loading icons */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### CSS Variable Color System (oklch)

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --border: oklch(0.92 0 0);
  --accent: oklch(0.97 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border: oklch(1 0 0 / 10%);
  --accent: oklch(0.269 0 0);
}
```

**Why oklch?** Perceptually uniform — hue shifts feel even across the scale. Better than HSL for design systems.

### Chevron Rotation Animation

```tsx
// Reusable pattern for any collapsible:
<ChevronDown
  className={cn(
    "h-4 w-4 transition-transform duration-200",
    isOpen && "rotate-180"
  )}
/>
```

---

## 10. Code Block Polish

**File:** `frontend/src/components/ai-elements/code-block.tsx` (178 lines)

### Shiki Syntax Highlighting

```tsx
import { codeToHtml } from "shiki"

async function highlight(code: string, lang: string, isDark: boolean) {
  return codeToHtml(code, {
    lang,
    theme: isDark ? "one-dark-pro" : "one-light",
    // Both themes preloaded — instant swap on theme change
  })
}
```

### Copy Button with Feedback

```tsx
function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Fallback for HTTP contexts
      const ta = document.createElement("textarea")
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)  // reset after 2s
  }

  return (
    <button onClick={copy} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
      {copied
        ? <CheckIcon className="h-4 w-4 text-green-500" />
        : <CopyIcon className="h-4 w-4" />
      }
    </button>
  )
}
```

**Nice detail:** The button is `opacity-0` normally, `group-hover:opacity-100` — only visible on hover. Keeps UI clean.

### Language Label

```tsx
<div className="relative group rounded-lg overflow-hidden bg-muted">
  {lang && (
    <div className="absolute top-2 left-3 text-xs text-muted-foreground font-mono">
      {lang}
    </div>
  )}
  <CodeBlockCopyButton code={code} />
  <div
    className="overflow-x-auto p-4 pt-8 text-sm"
    dangerouslySetInnerHTML={{ __html: highlighted }}
  />
</div>
```

---

## 11. Dark/Light Mode System

**File:** `frontend/src/components/theme-provider.tsx`

```tsx
import { ThemeProvider } from "next-themes"

export function Providers({ children }) {
  return (
    <ThemeProvider
      attribute="class"          // adds "dark" class to <html>
      defaultTheme="system"      // respects OS preference
      enableSystem               // watches prefers-color-scheme
      disableTransitionOnChange  // prevents flash during switch
    >
      {children}
    </ThemeProvider>
  )
}
```

### Theme Toggle

```tsx
import { useTheme } from "next-themes"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
```

### Forced Dark on Landing Page

```tsx
// In homepage layout:
const pathname = usePathname()
useEffect(() => {
  if (pathname === "/") {
    document.documentElement.classList.add("dark")
    return () => document.documentElement.classList.remove("dark")
  }
}, [pathname])
```

### Shiki Dual Theme

```tsx
// Syntax highlighting responds to theme
const { resolvedTheme } = useTheme()
const shikiTheme = resolvedTheme === "dark" ? "one-dark-pro" : "one-light"
```

---

## 12. Responsive Design Patterns

```css
/* globals.css — container width tokens */
:root {
  --container-width-sm: calc(144 * var(--spacing));  /* ~576px */
  --container-width-md: calc(204 * var(--spacing));  /* ~816px */
}
```

```tsx
// Message list max width:
<div className="mx-auto w-full max-w-[var(--container-width-md)] px-4">
  {messages.map(...)}
</div>
```

### Input Box Positioning

```tsx
// Sticky bottom input that doesn't overlap messages:
<div className="flex flex-col h-screen">
  <div className="flex-1 overflow-y-auto pb-32">  {/* pb-32 = input height padding */}
    <MessageList />
  </div>
  <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4">
    <PromptInput />
  </div>
</div>
```

---

## 13. Message Actions (Copy, Retry)

### Copy Message Button

**File:** `frontend/src/components/workspace/copy-button.tsx`

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => copyToClipboard(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
      title="Copy message"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  )
}
```

### Message Hover Actions

```tsx
<div className="group relative">
  <MessageContent />
  {/* Appears on hover, hidden otherwise */}
  <div className="absolute -bottom-8 right-0 opacity-0 group-hover:opacity-100
                  flex gap-1 bg-background border rounded-md shadow-sm p-1">
    <CopyButton text={extractText(message)} />
    {/* Could add: RetryButton, EditButton, etc. */}
  </div>
</div>
```

---

## 14. File/Image Attachments UX

### Attachment Thumbnail

```tsx
function AttachmentThumbnail({ attachment, onRemove }) {
  return (
    <HoverCard>
      <HoverCardTrigger>
        <div className="relative group w-16 h-16 rounded-lg overflow-hidden border bg-muted">
          {isImage(attachment.type)
            ? <img src={attachment.previewUrl} className="object-cover w-full h-full" />
            : <FileIcon className="m-auto h-6 w-6 text-muted-foreground" />
          }
          {/* Remove on hover */}
          <button
            onClick={onRemove}
            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100
                       flex items-center justify-center transition-opacity"
          >
            <XIcon className="h-4 w-4 text-white" />
          </button>
        </div>
      </HoverCardTrigger>
      {/* Large preview on hover */}
      <HoverCardContent className="w-64 p-0">
        <img src={attachment.previewUrl} className="w-full rounded-lg" />
        <p className="text-xs text-muted-foreground p-2">{attachment.file.name}</p>
      </HoverCardContent>
    </HoverCard>
  )
}
```

### Upload Progress

```tsx
function UploadingAttachment({ progress }: { progress: number }) {
  return (
    <div className="w-16 h-16 rounded-lg border bg-muted flex items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle
          cx="18" cy="18" r="15"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
        />
        <circle
          cx="18" cy="18" r="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${progress * 0.942} 94.2`}  // circumference = 2π×15
          className="transition-all"
        />
      </svg>
    </div>
  )
}
```

---

## 15. Keyboard Shortcuts

| Shortcut | Action | Where |
|----------|--------|-------|
| `Enter` | Submit message | Prompt input |
| `Shift+Enter` | New line | Prompt input |
| `Backspace` (empty) | Remove last attachment | Prompt input |
| `Escape` | Close modals/popovers | Global |
| `Ctrl/Cmd+K` | Open command palette | (if implemented) |
| `Ctrl/Cmd+C` | Copy selected text | Native |

---

## 16. Adaptation Checklist for Solaris-Agent

### High Impact, Easy Wins

- [ ] **`<think>` tag parsing** — regex split on `<think>...</think>`, show in collapsible section
- [ ] **Reasoning component** — auto-open on stream, auto-close after 1s, show "Thought for Xs"
- [ ] **Streaming indicator** — 3 bouncing dots while agent is working
- [ ] **Scroll-to-bottom button** — appears when user scrolls up, fades in with animation
- [ ] **Code block copy button** — hover-reveal, 2s checkmark feedback
- [ ] **Sonner toasts** — replace any `alert()` / console.log with styled toasts
- [ ] **Enter to submit** — with `isComposing` guard for CJK input
- [ ] **Auto-resize textarea** — `field-sizing: content` CSS only (1 line!)
- [ ] **Optimistic messages** — show user input immediately, don't wait for server echo

### Medium Effort

- [ ] **Tool call display** — per-tool visual treatment (nmap → port table, nuclei → vulnerability cards)
- [ ] **Shiki syntax highlighting** — for command outputs, code in responses
- [ ] **Empty state** — mission ready state with suggestion chips
- [ ] **Dark/light mode** — `next-themes` + CSS variables
- [ ] **File attachment UX** — blob URL preview + hover card + remove on hover
- [ ] **oklch color system** — convert current colors to perceptually uniform oklch

### Mission-Specific Adaptations

- [ ] **HITL Gate UI** — special card like `ask_clarification` renderer
- [ ] **Mission phase indicator** — which agent is currently active (Commander/Alpha/Gamma/Critic)
- [ ] **Finding severity badges** — color-coded Critical/High/Medium/Low
- [ ] **Exploit attempt timeline** — ChainOfThought pattern for OWASP vector sequence
- [ ] **Live terminal output** — for nmap/nuclei tool results (streaming, monospace, scrollable)
