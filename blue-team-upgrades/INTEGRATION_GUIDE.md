# Blue Team Pipeline Upgrade — Integration Guide

## What changed and why

### Old pipeline
```
Clone → Tree-Sitter → FalkorDB Graph → N+1 detection → Semgrep → LLM verify (snippet only)
```

### New pipeline
```
Clone → Tree-Sitter → FalkorDB Graph → File Index → N+1 detection
  → Semgrep candidates
  → Semantic Lifting candidates     ← NEW (whole-file category analysis)
  → Merge + dedup
  → LLM verify (full function + cross-file context)   ← UPGRADED
  → Behavioral Flow Analysis        ← NEW (deep reasoning on top N functions)
  → Pattern propagation → Supabase
```

---

## New files to drop into `worker/`

| File | Purpose |
|------|---------|
| `file_index_builder.py` | Builds `{rel_path: content}` dict once per scan |
| `multi_file_context_builder.py` | Builds caller/callee/middleware context per candidate |
| `semantic_lifting_agent.py` | First-layer LLM generates candidates from router/middleware/logic slices |
| `behavioral_flow_analyzer.py` | Deep LLM analysis of full functions with cross-file context |
| `llm_verifier_patch.py` | Drop-in prompt upgrade for `llm_verifier.py` |

---

## Step 1: Build the file index after Tree-Sitter

In `scan_worker.py` (your `main.py`), after Tree-Sitter parsing:

```python
# ADD THIS IMPORT at top
from worker.file_index_builder import build_file_index
from worker.multi_file_context_builder import MultiFileContextBuilder
from worker.semantic_lifting_agent import SemanticLiftingAgent
from worker.behavioral_flow_analyzer import BehavioralFlowAnalyzer

# In your scan pipeline, AFTER tree-sitter parsing (around 15-25% progress):
self.file_index = build_file_index(repo_dir)
logger.info(f"[Pipeline] File index: {len(self.file_index)} files indexed")

# Build cross-file context index (before Semgrep runs)
self.context_builder = MultiFileContextBuilder(
    repo_dir=repo_dir,
    file_index=self.file_index,
)
self.context_builder.build_index()
```

---

## Step 2: Add Semantic Lifting before LLM verification

After your Semgrep stage, before verification:

```python
# After semgrep_candidates is populated:

# Run semantic lifting to generate additional candidates
lifting_agent = SemanticLiftingAgent(
    repo_dir=repo_dir,
    file_index=self.file_index,
)
lifting_candidates = await lifting_agent.run()
logger.info(f"[Pipeline] Semantic lifting: {len(lifting_candidates)} candidates")

# Merge all candidates
all_candidates = semgrep_candidates + lifting_candidates

# Dedup by (file_path, line_start, vuln_type)
seen_keys = set()
deduped_candidates = []
for c in all_candidates:
    key = (c.get("file_path"), c.get("line_start"), c.get("vuln_type"))
    if key not in seen_keys:
        seen_keys.add(key)
        deduped_candidates.append(c)
```

---

## Step 3: Upgrade verify_candidate to accept context

### In `llm_verifier.py`, update the function signature:

```python
# OLD:
async def verify_candidate(candidate: dict[str, Any]) -> dict[str, Any]:

# NEW:
async def verify_candidate(
    candidate: dict[str, Any],
    file_context=None,  # Optional[FileContext] from MultiFileContextBuilder
) -> dict[str, Any]:
```

### Replace the prompt building section:

```python
# ADD this import at top of llm_verifier.py:
from worker.llm_verifier_patch import build_multi_context_prompt

# In verify_candidate(), REPLACE the section where you build `prompt`:
# OLD (builds prompt from snippet only):
#   prompt = f"Verify this {vuln_type}...\n{snippet}"
# 
# NEW:
prompt = build_multi_context_prompt(
    candidate=candidate,
    file_context=file_context,
    model_name=model_name,
    model_instructions=model_instructions,
)
```

### Update the batch call in scan_worker:

```python
# OLD:
tasks = [verify_candidate(c) for c in batch]

# NEW:
tasks = [
    verify_candidate(c, file_context=self.context_builder.get_context(c))
    for c in batch
]
```

---

## Step 4: Add Behavioral Flow Analyzer after LLM verification

After all candidates are verified, before pattern propagation:

```python
# After LLM verification loop completes:

behavioral_analyzer = BehavioralFlowAnalyzer(
    repo_dir=repo_dir,
    context_builder=self.context_builder,
)

confirmed_file_paths = {v.get("file_path") for v in verified_vulns}
behavioral_findings = await behavioral_analyzer.run(
    candidates=all_verified_results,
    already_confirmed_files=confirmed_file_paths,
)

# Behavioral findings are pre-confirmed — add directly
verified_vulns.extend(behavioral_findings)
all_verified_results.extend(behavioral_findings)

logger.info(
    f"[Pipeline] Behavioral pass: +{len(behavioral_findings)} findings. "
    f"Total confirmed: {len(verified_vulns)}"
)
```

---

## Progress tracking adjustments

Update your progress percentages to account for new stages:

| Stage | Old % | New % |
|-------|--------|--------|
| Clone | 5% | 5% |
| Tree-Sitter + File Index | 15% | 15% |
| Graph + Context Index | 25% | 25% |
| N+1 + Semgrep | 35–50% | 35–45% |
| Semantic Lifting | (none) | 45–50% |
| LLM Verification | 50–90% | 50–82% |
| Behavioral Analysis | (none) | 82–92% |
| Pattern Propagation | 90–95% | 92–97% |
| Complete | 100% | 100% |

---

## Cost model for new stages

| Stage | Model | Avg tokens/scan | Est. cost |
|-------|-------|-----------------|-----------|
| Semantic Lifting | gemini-2.0-flash | ~50k in, ~8k out | ~$0.03 |
| LLM Verify (upgraded prompt) | deepseek-r1-distill | ~80k in, ~15k out | ~$0.05 |
| Behavioral Analysis | deepseek-r1-distill | ~60k in, ~10k out | ~$0.04 |
| **Total added cost** | | | **~$0.10–0.15/scan** |

Using free-tier models (qwen3-coder:free, gemini-2.0-flash-thinking-exp:free): **~$0/scan**.

---

## What the upgrade detects that the old pipeline missed

### Now detected via Semantic Lifting:
- Missing rate limiting on `/login`, `/forgot-password`, `/api/search`
- Missing `verifyToken` on state-changing admin routes
- `req.body.userId` used for DB access (IDOR/privilege escalation)
- Business logic: client-controlled price/quantity in order creation
- JWT `algorithm: 'none'` acceptance
- Mass assignment via `Model.create(req.body)`

### Now detected via Behavioral Analysis:
- Multi-step dataflows: sanitized at line 5 but bypassed at line 12
- Conditional auth bypasses: `if (process.env.NODE_ENV === 'test') { skip auth }`
- Second-order injection: value stored then interpolated in a different route
- Async race conditions in wallet/balance update functions
- Complex $where injection patterns that Semgrep misses (missed in Juice Shop audit)

### Improved accuracy via multi-file context in LLM verifier:
- LLM now sees the FULL function, not just 5 lines around the match
- LLM sees the middleware chain — can confirm "no auth here = real missing_auth"
- LLM sees related files — can trace `req.body.UserId` to how it's actually used

---

## Tuning knobs

### Semantic Lifting
```python
# In semantic_lifting_agent.py:
MAX_SLICE_CHARS = 12000       # ↑ for more complete slice analysis (costs more)
MAX_CANDIDATES_PER_SLICE = 8  # ↑ to get more candidates per slice
```

### Behavioral Analysis
```python
# In behavioral_flow_analyzer.py:
MAX_FUNCTIONS_TO_ANALYZE = 30  # ↑ for more thorough analysis (costs more)
MAX_CONTEXT_CHARS = 16000      # ↑ for larger function context windows
```

### Context Builder
```python
# In multi_file_context_builder.py:
RELATED_FILE_MAX_CHARS = 3000  # ↑ for more related file context per candidate
MAX_RELATED_FILES = 6          # ↑ to include more related files
```
