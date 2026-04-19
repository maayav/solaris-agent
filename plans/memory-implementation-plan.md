# Memory & Context Implementation Plan: Cross-Mission Intelligence for Solaris-Agent

> Goal: Swarm agents learn from every mission. Successful exploit patterns, WAF bypass techniques, failed approaches, and target fingerprints persist across sessions and are automatically injected into future missions.

---

## Current State vs Target State

| Aspect | Current | Target |
|--------|---------|--------|
| Cross-mission learning | None | LLM-extracted facts persisted per target type |
| Failed approach memory | None | `correction` facts prevent repeat mistakes |
| Context window | Grows unbounded | Summarized at token limit, key info preserved |
| Agent knowledge | Hardcoded system prompts | Dynamic injection from mission memory |
| Storage | No memory store | Supabase JSON column or file-based |

---

## Architecture Overview

```
Mission ends / turn completes
        ↓
MemoryMiddleware (after_agent hook)
        ↓ filter tool outputs, detect corrections
MemoryUpdateQueue (debounced 10s)
        ↓
MissionMemoryUpdater.aupdate()
        ↓ LLM extracts intelligence facts
FileMemoryStorage / SupabaseMemoryStorage
        ↓ atomic write

Next mission starts
        ↓
format_memory_for_injection(memory, max_tokens=2000)
        ↓
System prompt ← <mission_memory>...</mission_memory>
```

---

## Phase 1: Memory Data Schema (Day 1)

### Step 1.1 — Design Red-Team Memory Schema

**File:** `swarm module/Red_team/core/memory/schema.py`

```python
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

FactCategory = Literal[
    "exploit_pattern",    # successful attack chains and conditions
    "evasion",            # WAF/EDR bypass techniques
    "target_fingerprint", # tech stack indicators and exploitability
    "auth_pattern",       # auth mechanisms and weaknesses
    "correction",         # failed approaches to avoid
    "knowledge",          # general red team knowledge
    "behavior",           # target behavioral patterns
]

@dataclass
class MissionFact:
    id: str
    content: str                    # the fact itself
    category: FactCategory
    confidence: float               # 0.5-1.0
    created_at: str                 # ISO-8601
    source_mission_id: str | None = None
    target_type: str | None = None  # "laravel", "django", "spring", etc.
    source_error: str | None = None # for corrections: what went wrong

EMPTY_MEMORY = {
    "version": "1.0",
    "last_updated": "",
    "mission_context": {
        "target_profile": {
            "summary": "",   # common tech stacks, port ranges, auth types seen
            "updated_at": ""
        },
        "exploit_history": {
            "summary": "",   # what has worked, what hasn't, success rates
            "updated_at": ""
        },
        "blue_team_signatures": {
            "summary": "",   # WAF rules, detection patterns, canary tokens
            "updated_at": ""
        },
        "recon_patterns": {
            "summary": "",   # effective recon strategies, common misconfigs
            "updated_at": ""
        },
    },
    "facts": []  # list of MissionFact dicts
}
```

### Step 1.2 — Memory Storage Interface

**File:** `swarm module/Red_team/core/memory/storage.py`

```python
import json
import os
from pathlib import Path
from abc import ABC, abstractmethod
from .schema import EMPTY_MEMORY
import copy

class BaseMemoryStorage(ABC):
    @abstractmethod
    def load(self) -> dict: ...
    @abstractmethod
    def save(self, data: dict) -> None: ...

class FileMemoryStorage(BaseMemoryStorage):
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._cache: dict | None = None
        self._cache_mtime: float | None = None

    def load(self) -> dict:
        if not self.path.exists():
            return copy.deepcopy(EMPTY_MEMORY)
        mtime = self.path.stat().st_mtime
        if self._cache is None or self._cache_mtime != mtime:
            self._cache = json.loads(self.path.read_text(encoding="utf-8"))
            self._cache_mtime = mtime
        return self._cache

    def save(self, data: dict) -> None:
        # Atomic write: temp file then rename
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.rename(self.path)
        self._cache = data
        self._cache_mtime = self.path.stat().st_mtime

class SupabaseMemoryStorage(BaseMemoryStorage):
    """Optional: store in Supabase for consistency with existing architecture."""
    def __init__(self, supabase_client, agent_name: str):
        self.client = supabase_client
        self.agent_name = agent_name

    def load(self) -> dict:
        result = self.client.table("agent_memory") \
            .select("memory_data") \
            .eq("agent_name", self.agent_name) \
            .single() \
            .execute()
        if result.data:
            return result.data["memory_data"]
        return copy.deepcopy(EMPTY_MEMORY)

    def save(self, data: dict) -> None:
        self.client.table("agent_memory") \
            .upsert({
                "agent_name": self.agent_name,
                "memory_data": data,
                "updated_at": "now()"
            }) \
            .execute()
```

---

## Phase 2: Memory Update Prompt (Day 1-2)

### Step 2.1 — Red-Team Memory Extraction Prompt

**File:** `swarm module/Red_team/core/memory/prompt.py`

```python
MEMORY_UPDATE_PROMPT = """You are a red team intelligence analyst. Extract mission-relevant intelligence from this conversation.

## Current Intelligence Database
{current_memory_json}

## Mission Conversation
{formatted_conversation}

{correction_hint}

## Structured Analysis (complete before extracting)

1. **Exploit Success Analysis**: What techniques worked? What failed? What conditions enabled success?
2. **Evasion Analysis**: What detection did the agent trigger? What bypassed it?
3. **Target Fingerprinting**: What technology, version, or configuration was identified?
4. **Correction Detection**: Did any approach fail and get corrected? What should be avoided?

## Intelligence Section Guidelines

### mission_context.target_profile (2-3 sentences)
- Common technology stacks, port distributions, auth mechanisms across targets
- Update when: new tech stack identified, new target type encountered

### mission_context.exploit_history (3-4 sentences)
- Which OWASP vectors have highest success rate, in what conditions
- Specific tools and configurations that worked vs failed
- Update every mission

### mission_context.blue_team_signatures (2-3 sentences)
- WAF rules triggered, detection thresholds, canary token placements
- Rate limits, behavioral anomaly triggers
- Update when: detection event occurs

### mission_context.recon_patterns (2-3 sentences)
- Effective reconnaissance sequences, common misconfigurations found
- Parameter enumeration patterns that revealed attack surface

## Fact Guidelines
- Atomic, specific, actionable facts only
- Include specific tool names, CVE numbers, version ranges, payload examples
- confidence: 0.9-1.0 (confirmed in mission) | 0.7-0.8 (strong indicator) | 0.5-0.6 (inferred)
- For corrections: set source_error to the exact failed approach

## Categories
- exploit_pattern: successful attack chains (include conditions/prerequisites)
- evasion: WAF/IDS bypass techniques that worked
- target_fingerprint: tech stack indicators and their exploitability
- auth_pattern: auth weaknesses and bypass methods
- correction: failed approaches (MUST include source_error)
- knowledge: general red team knowledge gained
- behavior: target system behavioral patterns

## CRITICAL RULES
- Do NOT store target IP addresses (use "target" generically)
- Do NOT store credentials or PII found during missions
- ONLY store generalizable intelligence, not mission-specific data
- Corrections with source_error are the most valuable — always capture them

## Output (JSON only)
{{
  "mission_context": {{
    "target_profile": {{"summary": "...", "updated_at": "ISO-8601"}},
    "exploit_history": {{"summary": "...", "updated_at": "ISO-8601"}},
    "blue_team_signatures": {{"summary": "...", "updated_at": "ISO-8601"}},
    "recon_patterns": {{"summary": "...", "updated_at": "ISO-8601"}}
  }},
  "new_facts": [
    {{
      "content": "...",
      "category": "exploit_pattern",
      "confidence": 0.9,
      "target_type": "laravel",
      "source_error": null
    }}
  ],
  "facts_to_remove": ["fact_id_1"]
}}
"""

CORRECTION_HINT_TEMPLATE = """
IMPORTANT: A correction/failed approach was detected in this conversation.
Pay special attention to what went wrong. Extract a high-confidence correction fact
with source_error set to the exact failed approach that should be avoided in future.
"""

REINFORCEMENT_HINT_TEMPLATE = """
IMPORTANT: A successful approach was confirmed in this conversation.
Extract high-confidence facts about what worked and under what conditions.
"""

def format_conversation_for_update(messages: list) -> str:
    """Format messages for the memory update prompt."""
    lines = []
    for msg in messages:
        role = type(msg).__name__.replace("Message", "")
        content = getattr(msg, "content", "")
        if isinstance(content, list):
            content = " ".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
        # Truncate very long tool outputs
        if len(content) > 2000:
            content = content[:2000] + "\n... [truncated]"
        lines.append(f"{role}: {content}")
    return "\n\n".join(lines)
```

---

## Phase 3: Memory Updater (Day 2-3)

### Step 3.1 — `MissionMemoryUpdater`

**File:** `swarm module/Red_team/core/memory/updater.py`

```python
from __future__ import annotations
import copy
import json
import re
from datetime import datetime, timezone
from uuid import uuid4
from .storage import BaseMemoryStorage
from .prompt import MEMORY_UPDATE_PROMPT, CORRECTION_HINT_TEMPLATE, REINFORCEMENT_HINT_TEMPLATE, format_conversation_for_update

FACT_MAX_DEFAULT = 150

def _fact_key(content: str) -> str:
    return content.strip().casefold()

class MissionMemoryUpdater:
    def __init__(self, storage: BaseMemoryStorage, llm_client, max_facts: int = FACT_MAX_DEFAULT):
        self.storage = storage
        self.llm = llm_client
        self.max_facts = max_facts

    async def aupdate(
        self,
        messages: list,
        correction_detected: bool = False,
        reinforcement_detected: bool = False,
    ) -> None:
        current = self.storage.load()

        correction_hint = ""
        if correction_detected:
            correction_hint = CORRECTION_HINT_TEMPLATE
        elif reinforcement_detected:
            correction_hint = REINFORCEMENT_HINT_TEMPLATE

        formatted = format_conversation_for_update(messages)

        prompt = MEMORY_UPDATE_PROMPT.format(
            current_memory_json=json.dumps(current, indent=2),
            formatted_conversation=formatted,
            correction_hint=correction_hint,
        )

        response = await self.llm.chat(
            model="llama3.2:3b",   # use lightweight model
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,       # low temp for factual extraction
        )

        try:
            # Strip markdown code fences if present
            text = response.strip()
            if text.startswith("```"):
                text = re.sub(r"^```\w*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            llm_response = json.loads(text)
        except (json.JSONDecodeError, AttributeError):
            return  # failed parse, skip update

        updated = self._apply_updates(current, llm_response)
        self.storage.save(updated)

    def _apply_updates(self, current: dict, llm_response: dict) -> dict:
        updated = copy.deepcopy(current)

        # Update summary sections
        mc = llm_response.get("mission_context", {})
        for section in ("target_profile", "exploit_history", "blue_team_signatures", "recon_patterns"):
            if section in mc and mc[section].get("summary"):
                updated["mission_context"][section] = mc[section]

        # Remove outdated facts
        to_remove = set(llm_response.get("facts_to_remove", []))
        updated["facts"] = [f for f in updated["facts"] if f.get("id") not in to_remove]

        # Add new facts with deduplication
        existing_keys = {_fact_key(f["content"]) for f in updated["facts"]}

        for new_fact in llm_response.get("new_facts", []):
            key = _fact_key(new_fact.get("content", ""))
            if not key or key in existing_keys:
                continue  # skip duplicate

            # Skip low-confidence facts
            if new_fact.get("confidence", 0) < 0.5:
                continue

            new_fact["id"] = f"fact_{uuid4().hex[:8]}"
            new_fact["created_at"] = datetime.now(timezone.utc).isoformat()
            updated["facts"].append(new_fact)
            existing_keys.add(key)

        # Enforce max_facts: keep highest confidence
        if len(updated["facts"]) > self.max_facts:
            updated["facts"].sort(key=lambda f: f.get("confidence", 0), reverse=True)
            updated["facts"] = updated["facts"][:self.max_facts]

        updated["last_updated"] = datetime.now(timezone.utc).isoformat()
        return updated
```

---

## Phase 4: Debounced Update Queue (Day 3)

### Step 4.1 — `MemoryUpdateQueue`

**File:** `swarm module/Red_team/core/memory/queue.py`

```python
from __future__ import annotations
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .updater import MissionMemoryUpdater

@dataclass
class ConversationContext:
    thread_id: str
    messages: list
    timestamp: datetime = field(default_factory=datetime.utcnow)
    agent_name: str | None = None
    correction_detected: bool = False
    reinforcement_detected: bool = False

class MemoryUpdateQueue:
    def __init__(self, debounce_seconds: int = 10):
        self._queue: dict[str, ConversationContext] = {}
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._debounce = debounce_seconds
        self._updater: MissionMemoryUpdater | None = None

    def set_updater(self, updater: MissionMemoryUpdater) -> None:
        self._updater = updater

    def add(self, context: ConversationContext) -> None:
        with self._lock:
            self._queue[context.thread_id] = context  # dedup by thread_id
            self._reset_timer()

    def add_nowait(self, context: ConversationContext) -> None:
        with self._lock:
            self._queue[context.thread_id] = context
        self._process_queue()

    def _reset_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(self._debounce, self._process_queue)
        self._timer.daemon = True
        self._timer.start()

    def _process_queue(self) -> None:
        with self._lock:
            contexts = list(self._queue.values())
            self._queue.clear()

        if not self._updater or not contexts:
            return

        import asyncio
        for ctx in contexts:
            try:
                loop = asyncio.new_event_loop()
                loop.run_until_complete(self._updater.aupdate(
                    messages=ctx.messages,
                    correction_detected=ctx.correction_detected,
                    reinforcement_detected=ctx.reinforcement_detected,
                ))
                loop.close()
            except Exception as e:
                print(f"[MemoryQueue] Update failed for {ctx.thread_id}: {e}")

    def flush(self) -> None:
        if self._timer:
            self._timer.cancel()
        self._process_queue()

# Global singleton
_queue: MemoryUpdateQueue | None = None
_lock = threading.Lock()

def get_memory_queue() -> MemoryUpdateQueue:
    global _queue
    with _lock:
        if _queue is None:
            _queue = MemoryUpdateQueue(debounce_seconds=10)
    return _queue
```

---

## Phase 5: Signal Detection (Day 3)

### Step 5.1 — `signals.py`

**File:** `swarm module/Red_team/core/memory/signals.py`

```python
import re
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

CORRECTION_PATTERNS = (
    r"\bthat(?:'s| is) (?:wrong|incorrect|not right)\b",
    r"\btry (?:again|a different)\b",
    r"\bfailed\b.*\btry\b",
    r"\bblocked\b.*\bavoid\b",
    r"\bdetected\b.*\bchange\b",
    r"\bnot working\b",
)

REINFORCEMENT_PATTERNS = (
    r"\bsuccess(?:ful)?\b",
    r"\bexploit(?:ed)?\b.*\bworks?\b",
    r"\bgot (?:a shell|access|RCE|LFI|SQLi)\b",
    r"\bbypass(?:ed)?\b.*\bWAF\b",
    r"\bconfirm(?:ed)?\b",
)

def detect_correction(messages) -> bool:
    for msg in messages:
        if isinstance(msg, (HumanMessage, ToolMessage)):
            content = str(getattr(msg, "content", "")).lower()
            if any(re.search(p, content, re.I) for p in CORRECTION_PATTERNS):
                return True
    return False

def detect_reinforcement(messages) -> bool:
    for msg in messages:
        if isinstance(msg, (AIMessage, ToolMessage)):
            content = str(getattr(msg, "content", "")).lower()
            if any(re.search(p, content, re.I) for p in REINFORCEMENT_PATTERNS):
                return True
    return False

def filter_messages_for_memory(messages) -> list:
    """Keep human inputs, AI responses, and tool results. Drop tool call schemas."""
    result = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            result.append(msg)
        elif isinstance(msg, AIMessage):
            # Keep if it has text content (not just tool_calls with no text)
            if msg.content:
                result.append(msg)
        elif isinstance(msg, ToolMessage):
            # Tool results are valuable for red team memory
            result.append(msg)
    return result
```

---

## Phase 6: Memory Injection (Day 4)

### Step 6.1 — `injection.py`

**File:** `swarm module/Red_team/core/memory/injection.py`

```python
from __future__ import annotations
import tiktoken

def format_memory_for_injection(memory_data: dict, max_tokens: int = 2000) -> str:
    if not memory_data or not any(memory_data.get("mission_context", {}).values()):
        return ""

    lines = []
    mc = memory_data.get("mission_context", {})

    if mc.get("target_profile", {}).get("summary"):
        lines.append(f"Target Profile: {mc['target_profile']['summary']}")
    if mc.get("exploit_history", {}).get("summary"):
        lines.append(f"Exploit History: {mc['exploit_history']['summary']}")
    if mc.get("blue_team_signatures", {}).get("summary"):
        lines.append(f"Blue Team Signatures: {mc['blue_team_signatures']['summary']}")
    if mc.get("recon_patterns", {}).get("summary"):
        lines.append(f"Recon Patterns: {mc['recon_patterns']['summary']}")

    # Facts sorted by confidence, token-budget-aware
    facts = sorted(memory_data.get("facts", []), key=lambda f: f.get("confidence", 0), reverse=True)

    try:
        encoder = tiktoken.get_encoding("cl100k_base")
        budget = max_tokens - len(encoder.encode("\n".join(lines)))
    except Exception:
        budget = 1000  # fallback if tiktoken not available

    fact_lines = []
    for fact in facts:
        line = f"- [{fact['category']} | {fact.get('confidence', 0):.2f}] {fact['content']}"
        if fact.get("source_error"):
            line += f" (avoid: {fact['source_error']})"
        if fact.get("target_type"):
            line += f" [target: {fact['target_type']}]"

        try:
            cost = len(encoder.encode(line))
        except Exception:
            cost = len(line) // 4
        if budget - cost < 0:
            break
        fact_lines.append(line)
        budget -= cost

    if fact_lines:
        lines.append("Intelligence Facts:")
        lines.extend(fact_lines)

    return "\n".join(lines)

def get_mission_memory_block(storage, max_tokens: int = 2000) -> str:
    try:
        memory_data = storage.load()
        content = format_memory_for_injection(memory_data, max_tokens=max_tokens)
        if not content.strip():
            return ""
        return f"<mission_memory>\n{content}\n</mission_memory>"
    except Exception:
        return ""
```

### Step 6.2 — Inject into Commander System Prompt

In `agents/commander.py`, update the system prompt assembly:

```python
from ..core.memory.storage import FileMemoryStorage
from ..core.memory.injection import get_mission_memory_block

MEMORY_STORAGE = FileMemoryStorage(".deer-flow/agents/commander/memory.json")

def build_commander_system_prompt() -> str:
    memory_block = get_mission_memory_block(MEMORY_STORAGE, max_tokens=2000)

    return f"""You are the Commander agent of the Solaris red team swarm.

{memory_block}

## Your Role
...
"""
```

---

## Phase 7: LangGraph Middleware Hook (Day 4-5)

### Step 7.1 — `MemoryMiddleware`

Wire memory update into the LangGraph graph as a post-agent hook:

```python
# In agents/graph.py — add after each agent node

from ..core.memory.queue import get_memory_queue, ConversationContext
from ..core.memory.signals import filter_messages_for_memory, detect_correction, detect_reinforcement

def make_memory_hook(agent_name: str):
    def memory_hook(state: dict) -> dict:
        messages = state.get("messages", [])
        filtered = filter_messages_for_memory(messages)

        if not filtered:
            return state

        ctx = ConversationContext(
            thread_id=state.get("mission_id", "unknown"),
            messages=filtered,
            agent_name=agent_name,
            correction_detected=detect_correction(filtered),
            reinforcement_detected=detect_reinforcement(filtered),
        )
        get_memory_queue().add(ctx)
        return state
    return memory_hook
```

---

## Phase 8: Context Window Summarization (Day 5-6)

### Step 8.1 — Token Counter

**File:** `swarm module/Red_team/core/memory/summarizer.py`

```python
from __future__ import annotations
import tiktoken
from langchain_core.messages import AnyMessage, RemoveMessage

MAX_TOKENS = 60000       # trigger summarization at 60k
KEEP_MESSAGES = 15       # always preserve last 15 messages

def count_tokens(messages: list) -> int:
    try:
        encoder = tiktoken.get_encoding("cl100k_base")
        total = 0
        for msg in messages:
            content = getattr(msg, "content", "")
            if isinstance(content, list):
                content = " ".join(str(c) for c in content)
            total += len(encoder.encode(str(content)))
        return total
    except Exception:
        return sum(len(str(getattr(m, "content", ""))) // 4 for m in messages)

async def maybe_summarize(
    messages: list[AnyMessage],
    llm_client,
    memory_queue,
    thread_id: str,
) -> list[AnyMessage] | None:
    """Returns new message list if summarization occurred, None otherwise."""
    if count_tokens(messages) < MAX_TOKENS:
        return None

    to_summarize = messages[:-KEEP_MESSAGES]
    preserved = messages[-KEEP_MESSAGES:]

    if not to_summarize:
        return None

    # Flush to memory BEFORE losing these messages
    from .signals import filter_messages_for_memory, detect_correction, detect_reinforcement
    from .queue import ConversationContext
    filtered = filter_messages_for_memory(to_summarize)
    if filtered:
        ctx = ConversationContext(
            thread_id=thread_id,
            messages=filtered,
            correction_detected=detect_correction(filtered),
            reinforcement_detected=detect_reinforcement(filtered),
        )
        memory_queue.add_nowait(ctx)  # immediate flush

    # Summarize old messages
    summary_prompt = f"""Summarize the following red team agent conversation into 3-5 sentences.
Focus on: what was attempted, what succeeded, what failed, and current mission state.

{chr(10).join(f"{type(m).__name__}: {m.content}" for m in to_summarize[:20])}
"""
    response = await llm_client.chat(
        model="llama3.2:3b",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.1,
    )

    from langchain_core.messages import SystemMessage
    summary_msg = SystemMessage(content=f"[Conversation Summary]: {response}")
    return [summary_msg, *preserved]
```

---

## Phase 9: Supabase Schema (Day 6)

### Step 9.1 — Migration

**File:** `plans/memory-supabase-migration.sql`

```sql
-- Agent memory table
CREATE TABLE agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL UNIQUE,
    memory_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast fact queries
CREATE INDEX idx_agent_memory_facts ON agent_memory USING GIN ((memory_data->'facts'));

-- RLS: memory readable by authenticated users only
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memory_read" ON agent_memory
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "agent_memory_write" ON agent_memory
    FOR ALL TO service_role USING (true);

-- Per-mission intelligence log (optional, for analytics)
CREATE TABLE mission_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES missions(id),
    facts_extracted JSONB DEFAULT '[]'::jsonb,
    sections_updated TEXT[] DEFAULT '{}',
    extraction_model TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Phase 10: Testing (Day 7)

### Unit Tests

```python
# test_memory_updater.py
import pytest
from unittest.mock import AsyncMock
from swarm.core.memory.updater import MissionMemoryUpdater
from swarm.core.memory.storage import FileMemoryStorage
import tempfile, os

@pytest.mark.asyncio
async def test_extract_exploit_pattern():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        tmp = f.name

    storage = FileMemoryStorage(tmp)
    mock_llm = AsyncMock()
    mock_llm.chat.return_value = '''{
        "mission_context": {
            "exploit_history": {"summary": "SQLi via GET params worked", "updated_at": "2026-04-15T00:00:00Z"}
        },
        "new_facts": [
            {"content": "SQLi via id param effective on Laravel targets", "category": "exploit_pattern", "confidence": 0.9}
        ],
        "facts_to_remove": []
    }'''

    updater = MissionMemoryUpdater(storage=storage, llm_client=mock_llm)
    from langchain_core.messages import HumanMessage, AIMessage
    await updater.aupdate(
        messages=[HumanMessage(content="try sqli"), AIMessage(content="SQLi successful!")],
        reinforcement_detected=True,
    )

    memory = storage.load()
    assert len(memory["facts"]) == 1
    assert memory["facts"][0]["category"] == "exploit_pattern"
    assert memory["mission_context"]["exploit_history"]["summary"] != ""

    os.unlink(tmp)

@pytest.mark.asyncio
async def test_deduplication():
    # Same fact content should not be added twice
    ...

@pytest.mark.asyncio
async def test_max_facts_enforced():
    # Facts beyond max_facts should be trimmed by confidence
    ...
```

---

## Rollout Checklist

### Backend
- [ ] `core/memory/schema.py` — data structures
- [ ] `core/memory/storage.py` — FileMemoryStorage + SupabaseMemoryStorage
- [ ] `core/memory/prompt.py` — extraction prompt (red-team adapted)
- [ ] `core/memory/updater.py` — LLM extraction + deduplication
- [ ] `core/memory/queue.py` — debounced update queue
- [ ] `core/memory/signals.py` — correction/reinforcement detection
- [ ] `core/memory/injection.py` — token-aware memory formatting
- [ ] `core/memory/summarizer.py` — context window compression
- [ ] Commander prompt updated to inject `<mission_memory>`
- [ ] Alpha Recon prompt updated (recon patterns)
- [ ] Gamma Exploit prompt updated (exploit patterns + corrections)
- [ ] LangGraph hooks wired for post-agent memory queuing

### Database
- [ ] `agent_memory` table created in Supabase
- [ ] RLS policies applied
- [ ] `mission_intelligence` log table created (optional)

### Tests
- [ ] `test_memory_updater.py` passing
- [ ] `test_memory_queue.py` passing
- [ ] `test_memory_signals.py` passing
- [ ] `test_memory_injection.py` passing
- [ ] Manual test: run mission → verify memory.json updated
- [ ] Manual test: second mission shows injected memory in prompt logs

### Validation
- [ ] Facts not duplicated after 3+ missions
- [ ] Correction facts include source_error
- [ ] max_facts=150 enforced (evicts lowest confidence)
- [ ] Memory injection stays under 2000 tokens
- [ ] Atomic writes prevent corruption
- [ ] Supabase upsert doesn't create duplicate rows

---

*Reference: `docs/deerflow-memory-context.md` for full DeerFlow memory architecture.*
*Reference: `plans/deerflow-integration-master-plan.md` for sequencing.*
