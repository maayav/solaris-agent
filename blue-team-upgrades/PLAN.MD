# Blue Team Pipeline Upgrade Plan — v3

**Document Version:** 3.0  
**Status:** Planning  
**Supersedes:** v2 (addresses all review findings + adds new enhancement tiers)

---

## Table of Contents

1. [What This Plan Fixes vs v2](#1-what-this-plan-fixes-vs-v2)
2. [Honest Assessment of Current State](#2-honest-assessment-of-current-state)
3. [Tier 0 — Bug Fixes (Do First, Non-Negotiable)](#3-tier-0--bug-fixes-do-first-non-negotiable)
4. [Target Pipeline Architecture](#4-target-pipeline-architecture)
5. [Tier 1 — Core Upgrade (High Impact, Low Risk)](#5-tier-1--core-upgrade-high-impact-low-risk)
6. [Tier 2 — Detection Expansion (High Impact, Medium Risk)](#6-tier-2--detection-expansion-high-impact-medium-risk)
7. [Tier 3 — Trust Infrastructure (Highest Long-Term Value)](#7-tier-3--trust-infrastructure-highest-long-term-value)
8. [Tier 4 — Advanced Detection (Medium Impact, High Effort)](#8-tier-4--advanced-detection-medium-impact-high-effort)
9. [Deferred / Skipped](#9-deferred--skipped)
10. [Integration Order](#10-integration-order)
11. [Error Handling & Degradation](#11-error-handling--degradation)
12. [Cost Model](#12-cost-model)
13. [Regression Test Fixture](#13-regression-test-fixture)
14. [Verification Checklist](#14-verification-checklist)

---

## 1. What This Plan Fixes vs v2

The following are **concrete errors or omissions** in v2 that are corrected here.

### Bug: Dedup Key Includes `source` Field

**v2 code:**
```python
def _dedup_key(c):
    return (c.get("file_path"), c.get("line_start"), c.get("vuln_type"), c.get("source"))
```

**Problem:** This means a Semgrep finding and a semantic lifting finding at the same `(file, line, type)` have *different* keys and both get added to `seen`. They are never merged — they both proceed to LLM verification as separate candidates, doubling cost and potentially producing conflicting confirmed/rejected results for identical code.

**Fix:**
```python
def _dedup_key(c):
    # Source is stored as a field, NOT part of the merge key
    return (c.get("file_path"), c.get("line_start"), c.get("vuln_type"))

def merge_candidates(semgrep_candidates: list[dict], lifting_candidates: list[dict]) -> list[dict]:
    seen: dict[tuple, dict] = {}

    # Pass 1: Semgrep is higher priority (structured metadata, line precision)
    for c in semgrep_candidates:
        key = _dedup_key(c)
        c["sources"] = [c.get("source", "semgrep")]
        seen[key] = c

    # Pass 2: Lifting supplements or adds
    for c in lifting_candidates:
        key = _dedup_key(c)
        if key not in seen:
            c["sources"] = [c.get("source", "semantic_lifting")]
            seen[key] = c
        else:
            existing = seen[key]
            existing["sources"].append(c.get("source", "semantic_lifting"))
            # Supplement fields that semgrep typically lacks
            if not existing.get("description") and c.get("description"):
                existing["description"] = c["description"]
            if not existing.get("fix_suggestion") and c.get("fix_suggestion"):
                existing["fix_suggestion"] = c["fix_suggestion"]

    return list(seen.values())
```

---

### Bug: `needs_llm_verification: False` Has No Code Path

**Problem:** The secrets scanner emits candidates with `needs_llm_verification: False`. The scan worker sends *all* candidates through LLM verification unconditionally. High-confidence pattern-matched secrets will (a) cost money to verify and (b) risk being spuriously rejected if the snippet is masked.

**Fix — add split before verification loop in `scan_worker.py`:**
```python
all_candidates = merge_candidates(semgrep_candidates, lifting_candidates)

# Split: skip LLM for high-confidence rule-based findings
needs_verify   = [c for c in all_candidates if c.get("needs_llm_verification", True)]
skip_verify    = [c for c in all_candidates if not c.get("needs_llm_verification", True)]

# Auto-confirm high-confidence findings
for c in skip_verify:
    c["confirmed"]        = True
    c["confidence_score"] = 0.95
    c["verification_reason"] = f"Auto-confirmed by {c.get('source')} rule — high confidence, LLM verification skipped"

verified_vulns       = list(skip_verify)
all_verified_results = list(skip_verify)
# ... then run LLM verification on needs_verify only
```

---

### Underspecification: Stage 0.5 Call Resolution

**Problem:** The plan says "extend Tree-Sitter to emit `CALLS` edges" without addressing the hard part: call resolution across files. Tree-Sitter tells you `findUser()` is called on line 42. It does not tell you *which* `findUser` — the one imported from `./users.service.ts`, a local closure, or a re-export via an index barrel. Writing a `CALLS` edge to the wrong target function corrupts every downstream query that traverses it.

**`MIDDLEWARE_BEFORE` is similarly underspecified.** Detecting that `router.use(authMiddleware)` appears before `router.get('/admin', handler)` in the same file requires understanding the execution ordering semantics of Express router registration, not just AST proximity.

**Fix:** Stage 0.5 explicitly requires two sub-steps before writing edges:

1. **Import resolution pass** — build a `{symbol_name → (source_file, exported_name)}` map per file from import statements, then resolve each call-expression target against that map.
2. **Router ordering pass** — for files containing `router.use()` / `app.use()`, extract the registration order of middleware and handlers as a sequence, then emit `MIDDLEWARE_BEFORE` edges based on that sequence.

See Stage 0.5 expanded spec in [Tier 1](#5-tier-1--core-upgrade-high-impact-low-risk).

---

### Bug: IaC Regex Fails on Multi-Line HCL

**v2 patterns:**
```python
"tf:open_port": r'ingress.*from_port.*0\.0\.0\.0/0',
"tf:permissive_iam": r'Effect.*Allow.*\*.*\*',
```

**Problem:** HCL spreads these across multiple lines:
```hcl
ingress {
  from_port   = 0
  cidr_blocks = ["0.0.0.0/0"]
}
```

Single-line regex misses this entirely. The alternative (`re.DOTALL` with unbounded `.*`) will produce false positives by matching across unrelated blocks.

**Fix:** Use `checkov` as a subprocess — it has a proper HCL parser. Treat the custom regex patterns as a fallback only when `checkov` is unavailable. See [Priority 2: IaC Scanner](#priority-2-iac-scanner).

---

### Omission: Cost Caps Have No Runtime Enforcement

**Problem:** `MAX_BEHAVIORAL_COST_CENTS = 50` is declared as a config constant but there is no running cost accumulator in the worker, no pre-call budget check, and no per-response token tracking. The caps are aspirational.

**Fix:** See [Cost Model](#12-cost-model) for the required `CostTracker` implementation.

---

### Omission: Behavioral Analyzer Filters to Already-Confirmed Files

**Problem:** The behavioral analyzer receives `already_confirmed_files` and focuses there. But the most impactful behavioral findings — missing auth middleware, rate limiting gaps — are in *clean-looking* route files that Semgrep found nothing in. The filter may skip exactly the files that need behavioral analysis most.

**Fix:** Behavioral analyzer priority should be:
1. Route files (highest value regardless of prior findings)
2. Middleware files
3. Files with confirmed findings (for deeper dataflow)
4. Everything else up to dynamic cap

---

### Omission: No Timeouts on New LLM Stages

**Problem:** The existing verifier has explicit 120s/60s timeouts. The new semantic lifting and behavioral analysis also call LLMs but specify no timeouts. On a slow Ollama instance or a network issue, this blocks indefinitely.

**Fix:** All new LLM calls must include explicit `timeout=` parameters. Semantic lifting: 90s. Behavioral analysis: 120s per function.

---

### Omission: Smoke Test Script Is a Stub

The v2 bash script contains `python -c "..."` blocks that reference undefined classes (`UpgradedScanWorker`). It will not run. See [Regression Test Fixture](#13-regression-test-fixture) for a proper pytest-based replacement.

---

## 2. Honest Assessment of Current State

Before planning additions, this is what the current pipeline actually does and doesn't do well.

**What works:**
- Semgrep rules are well-chosen. OWASP + NodeJS + custom express rules cover the major syntactic vulnerability classes.
- N+1 detection via FalkorDB Cypher is elegant and correct for the structural pattern.
- Two-tier LLM fallback (OpenRouter → Ollama) is the right resilience model.
- Real-time Supabase progress updates give the frontend something useful.

**What doesn't work well:**
- **LLM verifier sees 5-10 lines.** Most vulnerabilities require 20-50 lines of context to assess correctly. The verifier is making decisions it doesn't have enough information to make.
- **No middleware awareness.** IDOR and missing-auth findings can't be properly confirmed without knowing the middleware chain. The verifier will both over-confirm (Semgrep found a pattern, LLM agrees even though auth middleware exists) and under-confirm (auth exists but is conditionally bypassed).
- **Pattern propagation precision is unknown.** The Qdrant similarity search for "similar vulnerable patterns" has never been evaluated. Code similarity in embedding space is mostly structural — a batched query and an N+1 look similar. There's a real chance this stage produces mostly noise.
- **Zero feedback loop.** Developers cannot mark findings as false positives. No signal flows back to improve detection. Confidence scores are uncalibrated.
- **Every scan is a full rescan.** A one-line change rescans all 500 files. This is a blocker for CI integration.

**What's genuinely hard and shouldn't be oversold:**
- Semantic lifting (LLM-as-detector) is non-deterministic. Same code, different run, potentially different findings. Treat it as supplement, not primary detection.
- The LLM verifier has known failure modes: sycophancy (biased toward confirming if the candidate says it's vulnerable), context window middle loss, hallucinated fix suggestions.
- Second-order vulnerabilities (value stored, later retrieved and interpolated) are beyond what this architecture can reliably catch.

---

## 3. Tier 0 — Bug Fixes (Do First, Non-Negotiable)

These must land before any other work. They are correctness issues, not enhancements.

| # | Fix | File | Risk |
|---|-----|------|------|
| 0.1 | Fix dedup key — remove `source` from key | `scan_worker.py` | Low |
| 0.2 | Add `needs_llm_verification` split before verify loop | `scan_worker.py` | Low |
| 0.3 | Add timeouts to all new LLM calls | New stage files | Low |
| 0.4 | Fix behavioral analyzer priority ordering | `behavioral_flow_analyzer.py` | Low |

None of these require new dependencies. All are surgical edits.

---

## 4. Target Pipeline Architecture

### Core Upgrade (Tiers 0–2)

```
Clone → Tree-Sitter + File Index
  → FalkorDB Graph (EXTENDED: CALLS, MIDDLEWARE_BEFORE, EXPORTED_BY edges)
  → Context Index (MultiFileContextBuilder → Cypher after Stage 0.5)
  → N+1 Detection (Cypher)
  → Semgrep
  → Secrets Scanner (pattern + entropy, no LLM needed)
  → Semantic Lifting (LLM first-pass, non-fatal)
  → Merge + Dedup (source-priority, fixed key)
  → Split: skip_verify (auto-confirm) | needs_verify
  → LLM Verify with full function + middleware context (batch, non-fatal)
  → IaC Scanner (checkov subprocess, non-fatal, parallel)
  → Behavioral Flow Analyzer (non-fatal, dynamic cap, correct priority)
  → Pattern Propagation (Qdrant)
  → Supabase persist
  → Diff against previous scan (new/fixed/unchanged)
  → PoC generation for confirmed high/critical (LLM, non-fatal)
  → Report with scan diff + PoC payloads
```

### With Tier 3 (Trust Infrastructure)

```
[All above]
  → Developer feedback ingestion (FP/TP/won't-fix)
  → Per-rule precision tracking
  → Incremental scan (git diff → only changed files)
  → Scan result diffing (new/fixed/unchanged vs prior scan)
  → LLM verifier meta-layer (two independent calls, confirm on agreement)
```

---

## 5. Tier 1 — Core Upgrade (High Impact, Low Risk)

These are the `blue-team-upgrades/` package integrations from v2, corrected per Tier 0.

---

### Stage 0.5: Knowledge Graph Schema Migration (Extended Spec)

**Goal:** Replace in-memory dict-based context building with FalkorDB Cypher queries.

**New node types:**

| Node | Properties |
|------|-----------|
| `:ImportStatement` | `module`, `specifier`, `alias`, `file` |
| `:Variable` | `name`, `file`, `line_start`, `is_exported` |

**New edge types:**

| Edge | From → To | Meaning |
|------|-----------|---------|
| `:CALLS` | `Function` → `Function` | Resolved cross-file call |
| `:DEPENDS_ON` | `Function` → `Variable/Function` | Destructures or uses symbol |
| `:EXPORTED_BY` | `Function` → File path string | Named/default export |
| `:IMPORTED_BY` | File → File | Reverse of static import |
| `:MIDDLEWARE_BEFORE` | `Function` → `Function` | This middleware runs before this handler |
| `:TOUCHES_MODEL` | `Function` → String | DB model name |

**Sub-step 1: Import resolution pass**

For each file, after Tree-Sitter parsing:
1. Extract all import statements → build `{local_name → (source_file, exported_name)}` per file
2. Resolve barrel/index re-exports recursively (up to depth 3 to prevent infinite loops)
3. For each call expression `foo()`, look up `foo` in the import map
4. If resolved → emit `CALLS` edge to the resolved function node
5. If unresolved (dynamic import, third-party, local closure) → skip edge, log as `unresolved_call`

**Sub-step 2: Router ordering pass**

For files containing Express/Hono router registration:
1. Extract all `router.use(fn)` and `router.METHOD(path, fn)` calls in source order
2. Build a registration sequence: `[(type, fn_ref, path?), ...]`
3. For each `use()` entry, emit `MIDDLEWARE_BEFORE` edges to every handler registered *after* it in the same sequence
4. A `use()` at the top level (before any routes) applies to all routes in that router

**Replacement Cypher query for context building:**
```cypher
MATCH (f:Function {name: $fn_name, file: $file_path})
OPTIONAL MATCH (f)<-[:CALLS]-(caller:Function)
OPTIONAL MATCH (f)-[:CALLS]->(callee:Function)
OPTIONAL MATCH (mw:Function)-[:MIDDLEWARE_BEFORE]->(f)
OPTIONAL MATCH (f)-[:TOUCHES_MODEL]->(model)
RETURN f,
       collect(DISTINCT caller) AS callers,
       collect(DISTINCT callee) AS callees,
       collect(DISTINCT mw) AS middleware,
       collect(DISTINCT model) AS models
```

**What this unlocks:**
- Auth propagation gaps: query all routes → walk `MIDDLEWARE_BEFORE` → flag any state-mutating route reachable without `is_auth_middleware: true`
- Taint source-to-sink: mark `req.body.*` tainted → follow `DEPENDS_ON` edges → flag when tainted data reaches `TOUCHES_MODEL` without sanitizer node in path
- Blast radius: functions with high incoming `CALLS` count get higher behavioral analysis priority
- Dead code deprioritization: no `IMPORTED_BY` + no incoming `CALLS` = low-value scan target

---

### New Files to Add to `vibecheck/worker/`

| File | Purpose | Effort |
|------|---------|--------|
| `file_index_builder.py` | `{rel_path: content}` dict once per scan, shared by all stages | Low |
| `multi_file_context_builder.py` | Cross-file context per candidate; migrates to Cypher after Stage 0.5 | Medium |
| `semantic_lifting_agent.py` | First-pass LLM candidate generation for logical/behavioral vulns | Medium |
| `behavioral_flow_analyzer.py` | Deep function analysis post-verification, fixed priority ordering | Medium |
| `llm_verifier_patch.py` | Full-function + middleware context prompts for existing verifier | Low |

**No new Python dependencies required.** All use existing `httpx`, `falkordb`, standard library.

---

### LLM Verifier Upgrade

The most impactful single change. The verifier currently sees 5-10 lines. After upgrade it sees:
- Full function body (up to `FULL_FUNCTION_MAX_CHARS = 6000`)
- Middleware chain (which auth/rate-limit middleware runs before this handler)
- Directly related files (callers, callees, up to `MAX_RELATED_FILES = 6`)

**Updated `verify_candidate()` signature:**
```python
async def verify_candidate(
    candidate: dict[str, Any],
    file_context: Optional[FileContext] = None,  # From MultiFileContextBuilder
    cost_tracker: Optional[CostTracker] = None,  # From CostTracker (see §12)
) -> dict[str, Any]:
```

**Critical verification rules added to prompt:**

The prompt must explicitly instruct the LLM on common false-positive patterns:
```
CRITICAL RULES:
- If a middleware auth function appears in the middleware_chain, the route IS protected.
  Do NOT confirm missing_auth if auth middleware is present.
- parseInt(req.params.id, 10) with NaN check IS a sanitizer for numeric IDs.
  Do NOT confirm SQLi if the value is properly cast to integer.
- JSON.stringify(userInput) before use in a query IS sanitization for structural injection.
- ONLY confirm if you can trace the unsanitized value from source to sink.
  Suspicion is not confirmation.
```

---

### Progress Percentages

| Stage | % Range | Notes |
|-------|---------|-------|
| Clone | 5% | |
| Tree-Sitter + File Index | 15% | |
| Graph + Context Index | 25% | Includes Stage 0.5 edges |
| N+1 Detection | 30% | |
| Semgrep | 40% | |
| Secrets Scanner | 45% | Fast, parallel with Semgrep |
| Semantic Lifting | 50% | Non-fatal |
| Merge + Split | 52% | |
| LLM Verification | 52–82% | Real-time per batch |
| Behavioral Analysis | 82–90% | Non-fatal |
| IaC Scanner | 90–92% | Non-fatal, checkov subprocess |
| Pattern Propagation | 92–95% | |
| PoC Generation | 95–98% | Non-fatal |
| Save + Diff + Report | 98–100% | |

---

## 6. Tier 2 — Detection Expansion (High Impact, Medium Risk)

### Priority 1: PoC Generation

**Why this first:** This is the highest-ROI feature that doesn't exist anywhere in the plan. The difference between a scanner developers act on and one they ignore is whether findings come with proof. A confirmed IDOR with a curl command that demonstrates data leakage is categorically more actionable than a confirmed IDOR with "use ownership checks."

**What it produces:**

For each confirmed high/critical vulnerability, a PoC payload:

```
IDOR — GET /api/orders/:id
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
curl -s -X GET "http://TARGET/api/orders/1337" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

Expected: 200 OK with order data belonging to a different user.
Confirm: Check that user_id in response != your user_id.
```

For SQL injection:
```
SQLi — POST /api/search
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
curl -s -X POST "http://TARGET/api/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "test'\'' OR 1=1 --"}'

Expected: Returns all records or a DB error revealing query structure.
```

**Implementation:**

New stage after LLM verification, before pattern propagation. Runs only on `confirmed=True` and `severity in (critical, high)`.

```python
# poc_generator.py
async def generate_poc(
    vuln: dict[str, Any],
    file_context: Optional[FileContext] = None,
    cost_tracker: Optional[CostTracker] = None,
) -> Optional[str]:
    """
    Generate a concrete PoC payload for a confirmed vulnerability.
    Returns a markdown string with curl command + exploitation steps.
    Non-fatal: returns None on any failure.
    """
    prompt = build_poc_prompt(vuln, file_context)
    try:
        result = await call_llm(prompt, timeout=60, cost_tracker=cost_tracker)
        return result.get("poc_payload")
    except Exception as e:
        logger.warning(f"[PoC] Generation failed for {vuln.get('type')}: {e}")
        return None
```

**Prompt requirements:**
- Include full endpoint path, HTTP method, parameter names
- Include the vulnerable code snippet
- Instruct LLM to output only the PoC, not explanation
- For unknown endpoint paths: generate template with `TARGET` placeholder
- Include a "Confirm exploitation" step so developers can verify it works

**File:** `vibecheck/worker/poc_generator.py`

**Effort:** Low-Medium — reuses existing LLM infrastructure. New prompt, new output field in vulnerability schema.

**Schema change:** Add `poc_payload TEXT` column to `vulnerabilities` table.

---

### Priority 2: Secrets Scanner (Git History Aware)

**Why git history matters:** Secrets committed and deleted are still in history and still live. This is the most common real-world credential exposure path. Scanning HEAD only misses it entirely.

**Two-pass approach:**

**Pass 1: Current HEAD** (pattern + entropy, no LLM, fast)

```python
# secrets_scanner.py

SECRET_PATTERNS = {
    "aws_access_key":      r'AKIA[0-9A-Z]{16}',
    "aws_secret_key":      r'(?i)aws.{0,20}secret.{0,20}["\'][A-Za-z0-9/+=]{40}["\']',
    "github_token":        r'gh[pousr]_[A-Za-z0-9_]{36,251}',
    "stripe_live":         r'sk_live_[0-9a-zA-Z]{24,}',
    "stripe_test":         r'sk_test_[0-9a-zA-Z]{24,}',
    "jwt_secret":          r'(?i)(jwt.secret|secret.key)\s*[=:]\s*["\'][^"\']{8,}["\']',
    "generic_password":    r'(?i)password\s*[=:]\s*["\'][^"\']{6,}["\']',
    "private_key":         r'-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----',
    "google_api_key":      r'AIza[0-9A-Za-z_-]{35}',
    "sendgrid":            r'SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}',
    "slack_token":         r'xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*',
    "twilio":              r'SK[0-9a-fA-F]{32}',
    "mapbox":              r'pk\.[A-Za-z0-9_-]{24,}',
    "pg_url":              r'postgres://[^:]+:[^@]+@',
    "generic_api_key":     r'(?i)api.key\s*[=:]\s*["\'][A-Za-z0-9_\-]{20,}["\']',
}

HIGH_ENTROPY_THRESHOLD = 4.5
MIN_SECRET_LENGTH = 20

# Returns candidates with needs_llm_verification=False (pattern) or True (entropy)
```

**Pass 2: Git history scan** (subprocess, optional, bounded)

```python
async def scan_git_history(repo_dir: str, max_commits: int = 200) -> list[dict]:
    """
    Scan recent git history for secrets that were committed and deleted.
    Bounded to max_commits to prevent runaway on old repos.
    """
    result = subprocess.run(
        ["git", "log", f"-{max_commits}", "--all", "-p", "--diff-filter=A",
         "--", "*.env", "*.env.*", "*.json", "*.ts", "*.js", "*.py"],
        cwd=repo_dir, capture_output=True, text=True, timeout=60
    )
    # Scan the diff output with the same pattern matcher
    # Tag findings with source="git_history", include commit hash
    ...
```

**Tuning knobs:**
```python
HIGH_ENTROPY_THRESHOLD = 4.5  # Lower = more findings, more FPs
MIN_SECRET_LENGTH = 20
GIT_HISTORY_MAX_COMMITS = 200  # Prevent runaway on large repos
GIT_HISTORY_ENABLED = True    # Can disable for speed
```

**File:** `vibecheck/worker/secrets_scanner.py`

**Effort:** Medium.

---

### Priority 3: IaC Scanner (Checkov-First)

Use `checkov` as the primary engine. Custom regex as fallback only.

```python
# iac_scanner.py

async def run_iac_scan(repo_dir: str) -> list[dict]:
    """
    Primary: checkov subprocess (proper HCL/YAML parser).
    Fallback: custom regex for Dockerfile basics only (simple enough to be correct).
    """
    try:
        result = subprocess.run(
            ["checkov", "--directory", repo_dir, "--output", "json",
             "--quiet", "--compact"],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode in (0, 1):  # 1 = findings found, not an error
            data = json.loads(result.stdout)
            return _parse_checkov_output(data)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        logger.warning("[IaC] checkov not available or timed out, falling back to basic Dockerfile check")
        return await _fallback_dockerfile_scan(repo_dir)
    
    return []

def _fallback_dockerfile_scan(repo_dir: str) -> list[dict]:
    # Only Dockerfiles — simple enough that line-by-line regex is correct
    # Pattern: USER root, chmod 777, no HEALTHCHECK
    ...
```

**Note:** `checkov` is an optional install. The pipeline degrades to Dockerfile-only without it. Document as: "install checkov for full IaC coverage."

**File:** `vibecheck/worker/iac_scanner.py`

---

### Priority 4: Authorization Graph

Rather than per-finding IDOR detection, build a complete authorization model for the API surface and flag gaps structurally.

**What it produces:**

```
AUTH COVERAGE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total routes:       47
Authenticated:      44
Unauthenticated:     3

STATE-MUTATING ROUTES WITHOUT AUTH:
  POST /api/admin/delete-user     routes/admin.ts:34
  PUT  /api/orders/:id/cancel     routes/orders.ts:89
  DELETE /api/users/:id           routes/users.ts:112

RATE-LIMITED LOGIN ENDPOINTS:    0/1
  POST /api/login                 routes/auth.ts:23   ← no rate limiter
```

**Implementation:**

After Stage 0.5 graph is built, run a dedicated Cypher-based authorization analysis:

```cypher
-- Find all routes without auth middleware in their MIDDLEWARE_BEFORE chain
MATCH (e:Endpoint)
WHERE NOT EXISTS {
    MATCH (mw:Function {is_auth_middleware: true})-[:MIDDLEWARE_BEFORE]->(e)
}
AND e.method IN ['POST', 'PUT', 'PATCH', 'DELETE']
RETURN e.path, e.method, e.file, e.line_start
ORDER BY e.severity_hint DESC
```

This is categorically more useful than per-finding IDOR detection — it answers "what is the auth coverage of this API?" as a first-class question.

**File:** `vibecheck/worker/auth_graph_analyzer.py`

**Effort:** Medium. Requires Stage 0.5 `MIDDLEWARE_BEFORE` edges to be accurate.

---

### Priority 5: ReDoS Detection

Absent from the current detection matrix. Easy to detect statically, easy to exploit, zero current coverage.

**Pattern:** User-controlled input flows into `RegExp` constructor or `.test()` / `.match()` with a complex pattern.

**Detection:** Add to Semgrep custom rules. Flag:
1. `new RegExp(req.*)` — user-controlled regex construction
2. `str.match(userPattern)` — user-supplied pattern
3. Known catastrophic regex structures on fixed patterns: `(a+)+`, `([a-zA-Z]+)*`, etc.

**File:** `vibecheck/rules/redos.yaml`

**Effort:** Low — YAML rule addition only.

---

### Priority 6: Race Condition / TOCTOU Detection

Common in financial and inventory endpoints. Static detection is imperfect but useful as a candidate generator.

**Detection heuristic:**
```python
# In semantic_lifting_agent.py or new dedicated analyzer
# Flag functions matching ALL of:
# 1. async function
# 2. reads from DB (ORMCall with .find/.get/.findOne)
# 3. writes to same model (ORMCall with .update/.save)
# 4. no transaction wrapper (no BEGIN/COMMIT or Sequelize.transaction())
# 5. financial/inventory signal words in function name or model (balance, wallet, inventory, stock, order)
```

LLM verifier then confirms whether the read-check-write pattern is actually exploitable.

**Effort:** Low-Medium. Can be added to semantic lifting agent's detection categories.

---

## 7. Tier 3 — Trust Infrastructure (Highest Long-Term Value)

These are the things that determine whether the scanner is trusted over time. Without them, every other enhancement is optimization of a black box.

---

### 7.1 Developer Feedback Loop

**Schema addition:**
```sql
ALTER TABLE vulnerabilities ADD COLUMN developer_verdict TEXT 
    CHECK (developer_verdict IN ('confirmed', 'false_positive', 'wont_fix', 'fixed'));
ALTER TABLE vulnerabilities ADD COLUMN developer_note TEXT;
ALTER TABLE vulnerabilities ADD COLUMN verdict_at TIMESTAMPTZ;
```

**API addition:**
```
PATCH /report/{scan_id}/vulnerabilities/{vuln_id}/verdict
Body: { "verdict": "false_positive", "note": "sanitized via parseInt" }
```

**Frontend:** Add verdict buttons on each finding card. "Mark FP", "Confirmed", "Won't Fix."

**Downstream use:**
- Per-rule false positive rate: `COUNT(verdict=false_positive) / COUNT(*)` grouped by `rule_id`
- Rules with FP rate > 40% get flagged for review in a weekly report
- High-FP rules get a warning in the verifier prompt: "Note: this rule has a 52% historical FP rate. Apply extra scrutiny."

---

### 7.2 Incremental / Diff Scanning

**Problem:** Every scan is a full rescan. For a 500-file repo, this is expensive and slow, and makes CI integration impractical.

**Implementation:**

```python
# In scan_worker.py, before Tree-Sitter parsing
async def get_changed_files(repo_dir: str, previous_commit: Optional[str]) -> Optional[list[str]]:
    """
    If previous_commit is known, return list of changed files.
    Returns None if full scan required (no previous commit, or git error).
    """
    if not previous_commit:
        return None
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", previous_commit, "HEAD"],
            cwd=repo_dir, capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip().splitlines()
    except Exception:
        return None  # Full scan as fallback

# If changed_files is not None:
#   - Only parse changed files
#   - Update FalkorDB graph for changed files only (delete old nodes, insert new)
#   - Carry forward existing vulnerabilities for unchanged files
#   - Mark scan as incremental in scan_queue
```

**Schema addition:**
```sql
ALTER TABLE scan_queue ADD COLUMN is_incremental BOOLEAN DEFAULT FALSE;
ALTER TABLE scan_queue ADD COLUMN base_commit TEXT;
ALTER TABLE scan_queue ADD COLUMN head_commit TEXT;
ALTER TABLE scan_queue ADD COLUMN changed_file_count INTEGER;
```

**Expected impact:** 5–10x cost and time reduction for repos scanned repeatedly (CI use case).

---

### 7.3 Scan Result Diffing

When a repo is scanned twice, the output should clearly show what changed.

```python
# In report generation
async def diff_scans(
    current_scan_id: str, 
    previous_scan_id: Optional[str]
) -> dict:
    """
    Compare vulnerabilities between two scans.
    Returns:
      - new_findings: confirmed in current, not in previous
      - fixed_findings: confirmed in previous, not in current  
      - unchanged: confirmed in both
      - regression: previously FP, now confirmed again
    """
    ...
```

**Report section:**
```
SCAN DIFF vs previous scan (2026-03-20)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 New:      3 findings
✅ Fixed:    2 findings  
📌 Unchanged: 8 findings
⚠️  Regression: 1 finding (was marked FP, reappeared)
```

---

### 7.4 LLM Verifier Meta-Layer

**Problem:** The verifier has known failure modes — sycophancy (biased toward confirming), context window middle loss, hallucinated fix suggestions. A single LLM call is not a reliable oracle.

**Solution:** For critical findings, run two independent verification calls and only confirm on agreement.

```python
async def verify_candidate_with_consensus(
    candidate: dict[str, Any],
    file_context: Optional[FileContext] = None,
    cost_tracker: Optional[CostTracker] = None,
) -> dict[str, Any]:
    """
    For critical/high severity: run two independent verifications.
    Confirm only if both agree. On disagreement, use lower confidence score.
    Fallback to single-call for medium/low (cost control).
    """
    severity = candidate.get("severity", "medium")
    
    if severity not in ("critical", "high"):
        return await verify_candidate(candidate, file_context, cost_tracker)
    
    result_a, result_b = await asyncio.gather(
        verify_candidate(candidate, file_context, cost_tracker),
        verify_candidate(candidate, file_context, cost_tracker),
        return_exceptions=True
    )
    
    if isinstance(result_a, Exception) or isinstance(result_b, Exception):
        # Fallback to single result
        return result_a if not isinstance(result_a, Exception) else result_b
    
    if result_a["confirmed"] == result_b["confirmed"]:
        # Agreement: average confidence, keep result_a's reason
        result_a["confidence_score"] = (result_a["confidence_score"] + result_b["confidence_score"]) / 2
        result_a["consensus"] = True
        return result_a
    else:
        # Disagreement: don't confirm, flag for manual review
        return {
            **result_a,
            "confirmed": False,
            "confidence_score": 0.4,
            "verification_reason": "LLM verifiers disagreed — manual review recommended",
            "consensus": False,
        }
```

**Cost impact:** ~2x verification cost for critical/high findings only. For a typical scan with 10 critical/high findings, this is negligible.

---

### 7.5 Confidence Score Calibration

Right now confidence scores are raw LLM outputs and are uncalibrated. A 0.85 confidence might mean 60% precision or 95% — there's no way to know.

**Implementation:**

After sufficient feedback data (>100 verdicts), compute calibration:

```python
# calibration.py — run as a periodic job
async def compute_calibration():
    """
    For each confidence bucket (0.0-0.1, 0.1-0.2, ..., 0.9-1.0):
    Compute: confirmed_by_developer / total_in_bucket
    This is the empirical precision at that confidence level.
    Emit a calibration curve to Supabase.
    """
    ...
```

Display calibration curve in the dashboard: "When we say 90% confidence, we're right X% of the time."

---

## 8. Tier 4 — Advanced Detection (Medium Impact, High Effort)

These are worth doing eventually but require significant investment. Not blocking anything else.

---

### 8.1 Sanitizer-Aware Taint Tracking

**Why it matters:** Without explicit sanitizer declarations, the verifier will flag `parseInt(req.params.id, 10)` as SQLi. This is a false positive. High FP rates on injection vulns are the primary reason developers stop trusting scanners.

**What to add:**

A sanitizer registry in Semgrep taint rules:

```yaml
# In express-taint.yaml
pattern-sanitizers:
  - pattern: parseInt($X, 10)
  - pattern: parseFloat($X)
  - pattern: Number($X)
  - pattern: validator.escape($X)
  - pattern: validator.isInt($X)
  - pattern: $X.replace(/[^a-zA-Z0-9]/g, '')
  - pattern: JSON.stringify($X)         # Structural injection only
  - pattern: escape($X)
  - pattern: encodeURIComponent($X)
  - pattern: xss($X)                    # xss npm package
  - patterns:
      - pattern: $SCHEMA.parse($X)      # zod/yup schema validation
      - pattern-inside: |
          const $SCHEMA = $LIB.object({...})
          ...
```

This is Semgrep configuration work, not Python code. The LLM verifier prompt should also be updated with the sanitizer-awareness critical rules noted in Tier 1.

**Effort:** Medium. Requires enumerating sanitizers for each vuln class.

---

### 8.2 Second-Order Vulnerability Detection

Genuinely hard. Do not attempt without a proper data provenance model.

**Minimum viable approach:**
1. Tag all `INSERT`/`UPDATE` ORM calls that store user-controlled input with a `taints_db=True` marker on the model
2. In a second pass, find `SELECT` calls on the same model where the result is used in a sink (query string, file path, shell)
3. Flag as second-order candidate if the chain is found — LLM verifier then assesses

This will have high FP rate. Surface candidates with low confidence and explicit "second-order candidate — manual review recommended" label.

**Effort:** High. Requires cross-scan state or a per-scan provenance pass.

---

### 8.3 Dependency / CVE Scanner

Parse `package.json` and `requirements.txt`, query npm audit API or OSV.dev for known CVEs.

```python
# dependency_scanner.py
async def run_dependency_scan(repo_dir: str) -> list[dict]:
    # 1. Parse package.json → {name: version_constraint}
    # 2. POST to https://api.osv.dev/v1/querybatch with all packages
    # 3. Parse response → CVE findings with CVSS scores
    # 4. Map to internal vuln schema
    ...
```

Use OSV.dev (free, no API key required) over npm audit (requires npm install) or Snyk (requires account).

**Effort:** Medium.

---

## 9. Deferred / Skipped

| Feature | Reason |
|---------|--------|
| **CodeQL integration** | Requires full compilation (30-60 min/language). Incompatible with the scan worker model. Semgrep taint + behavioral LLM covers ~80% of CodeQL's relevant findings. |
| **SBOM generation** | Low vulnerability detection value. Compliance/audit concern, not security scanning. |
| **Pattern propagation via Qdrant** | Needs evaluation before expanding. Current similarity search likely produces <30% precision. Evaluate first: run on 3 real codebases, manually check top-20 results from a confirmed vuln. If precision >50%, keep and tune. If <50%, disable or replace with structural clone detection. |
| **Semantic lifting as primary detector** | Non-deterministic LLM detection is a supplement, not a primary. Use it, but instrument it and track its confirmed-vs-rejected rate before expanding its role. |

---

## 10. Integration Order

Work in this order. Each step should be mergeable and testable independently.

```
Step 0: Tier 0 bug fixes (dedup key, needs_llm_verification split, timeouts)
Step 1: File index builder + context builder (no LLM changes yet)
Step 2: LLM verifier patch (full function + middleware context)
         → Run regression test fixture, confirm no detection loss
Step 3: Semantic lifting agent (with fixed dedup)
         → Run regression test fixture, confirm new findings added
Step 4: Behavioral flow analyzer (with fixed priority, explicit timeouts)
         → Run regression test fixture
Step 5: Secrets scanner (HEAD pass only first, git history as follow-up)
Step 6: PoC generator
Step 7: Stage 0.5 graph migration (parallel track, can merge independently)
Step 8: Authorization graph analyzer (requires Stage 0.5 MIDDLEWARE_BEFORE edges)
Step 9: IaC scanner (checkov)
Step 10: Developer feedback loop (schema + API + frontend)
Step 11: Incremental scanning + scan diffing
Step 12: LLM verifier meta-layer (consensus for critical/high)
Step 13: Sanitizer-aware taint rules (Semgrep YAML updates)
Step 14: ReDoS detection rules
Step 15: Race condition / TOCTOU detection
```

---

## 11. Error Handling & Degradation

Every new async stage is wrapped in try/except. The pipeline **must complete with partial results** under any single stage failure.

```python
# Template for all new stages
try:
    results = await new_stage.run(...)
    logger.info(f"[Pipeline] {stage_name}: {len(results)} results")
except asyncio.TimeoutError:
    logger.warning(f"[Pipeline] {stage_name} timed out. Continuing without results.")
    results = []
except Exception as e:
    logger.warning(f"[Pipeline] {stage_name} failed: {e}. Continuing without results.")
    results = []
```

### Degradation Modes

| Stage Failure | Mode Label | Impact |
|--------------|------------|--------|
| Semantic Lifting fails | `semgrep-only` | Lose logical vuln classes (missing auth, rate limit) |
| LLM Verification fails | `unverified` | Candidates saved `confirmed=False`, flagged for manual review |
| Behavioral Analysis fails | `verifier-only` | Lose deep dataflow findings |
| IaC Scanner fails | `no-iac` | No infrastructure findings |
| Secrets Scanner fails | `no-secrets-scan` | No secrets findings (Semgrep p/secrets still runs) |
| PoC Generation fails | `no-poc` | Findings confirmed but no proof payload |
| All LLM stages fail | `semgrep-raw` | Raw Semgrep findings, no LLM filtering, flagged as unverified |

---

## 12. Cost Model

### CostTracker Implementation

```python
# core/cost_tracker.py

@dataclass
class CostTracker:
    """
    Running cost accumulator. Passed through pipeline stages.
    All LLM calls must check budget before executing.
    """
    # Caps in USD cents
    MAX_SEMANTIC_CENTS:   int = 30
    MAX_VERIFY_CENTS:     int = 100
    MAX_BEHAVIORAL_CENTS: int = 50
    MAX_POC_CENTS:        int = 20
    MAX_TOTAL_CENTS:      int = 200
    
    spent: dict[str, float] = field(default_factory=lambda: {
        "semantic": 0.0, "verify": 0.0, "behavioral": 0.0, "poc": 0.0
    })
    
    def record(self, stage: str, input_tokens: int, output_tokens: int, model: str):
        cost = _calculate_cost(input_tokens, output_tokens, model)
        self.spent[stage] = self.spent.get(stage, 0.0) + cost
        logger.info(f"[Cost] {stage}: +${cost:.4f} (total: ${self.total:.4f})")
    
    def can_spend(self, stage: str, estimated_cents: float) -> bool:
        stage_cap = getattr(self, f"MAX_{stage.upper()}_CENTS", 999999)
        if self.spent.get(stage, 0.0) * 100 + estimated_cents > stage_cap:
            logger.warning(f"[Cost] {stage} cap reached. Skipping remaining calls.")
            return False
        if self.total * 100 + estimated_cents > self.MAX_TOTAL_CENTS:
            logger.warning(f"[Cost] Total scan cap reached. Halting LLM calls.")
            return False
        return True
    
    @property
    def total(self) -> float:
        return sum(self.spent.values())
```

### Average Case Estimates

| Stage | Model | Est. Tokens | Est. Cost |
|-------|-------|-------------|-----------|
| Secrets Scanner | None | 0 | $0.00 |
| Semantic Lifting | deepseek-r1-distill | ~50k in, ~8k out | ~$0.03 |
| LLM Verify (upgraded) | deepseek-r1-distill | ~80k in, ~15k out | ~$0.05 |
| Behavioral Analysis | deepseek-r1-distill | ~60k in, ~10k out | ~$0.04 |
| PoC Generation | deepseek-r1-distill | ~20k in, ~5k out | ~$0.01 |
| **Total average** | | | **~$0.12–0.18/scan** |

### Worst-Case Ceiling

| Stage | Scenario | Tokens (max) | Ceiling |
|-------|----------|--------------|---------|
| Semantic Lifting | 10 max-size slices | ~140k | ~$0.14 |
| LLM Verify | 50 candidates, full context | ~3M | ~$3.00 |
| Behavioral | 60 functions, max context | ~960k | ~$0.96 |
| PoC Generation | 20 critical findings | ~500k | ~$0.50 |
| **Total ceiling** | | | **~$4.60/scan** |

### Cost Tiering (User-Facing)

| Repo Size | Est. Avg | Est. Ceiling | Notes |
|-----------|----------|--------------|-------|
| <100 files | $0.05 | $0.25 | |
| 100–500 files | $0.15 | $1.50 | |
| 500+ files | $0.30 | $4.60 | Recommend incremental scanning |

### Free Tier Path

With `qwen2.5-coder:7b-instruct` (local Ollama) for all stages except reasoning-intensive behavioral:
- **~$0/scan average**
- Quality reduction on complex behavioral findings — acceptable for personal projects

---

## 13. Regression Test Fixture

Replace the v2 bash stub with a proper pytest fixture.

### Fixture Structure

```
vibecheck/fixtures/toy-vulnerable-app/
├── src/
│   ├── routes/
│   │   ├── auth.ts          # MISSING_AUTH on POST /admin/delete-user
│   │   ├── login.ts         # MISSING_RATE_LIMIT on POST /login
│   │   └── orders.ts        # IDOR: findOne({where: {id: req.body.orderId}})
│   ├── middleware/
│   │   └── auth.ts          # JWT verification — present but routes/auth.ts bypasses it
│   ├── config/
│   │   └── secrets.ts       # HARDCODED: AWS key + JWT secret
│   └── app.ts               # Express app, registers routes
├── infrastructure/
│   └── main.tf              # open 0.0.0.0/0, permissive IAM (needs checkov)
├── Dockerfile               # USER root, chmod 777
├── package.json             # Intentionally vulnerable dep entry (mock)
└── expected_findings.json   # Ground truth per stage
```

**`expected_findings.json`:**
```json
{
  "semgrep": [
    {"vuln_type": "hardcoded_secret", "file": "src/config/secrets.ts", "rule_id": "secrets.aws_access_key"}
  ],
  "semantic_lifting": [
    {"vuln_type": "missing_auth", "file": "src/routes/auth.ts"},
    {"vuln_type": "missing_rate_limit", "file": "src/routes/login.ts"},
    {"vuln_type": "idor", "file": "src/routes/orders.ts"}
  ],
  "behavioral": [
    {"vuln_type": "idor", "file": "src/routes/orders.ts"}
  ],
  "secrets_scanner": [
    {"vuln_type": "hardcoded_secret", "file": "src/config/secrets.ts", "rule_id": "secrets:aws_access_key"},
    {"vuln_type": "hardcoded_secret", "file": "src/config/secrets.ts", "rule_id": "secrets:jwt_secret"}
  ],
  "iac": [
    {"vuln_type": "iac_misconfiguration", "file": "infrastructure/main.tf"},
    {"vuln_type": "iac_misconfiguration", "file": "Dockerfile"}
  ]
}
```

### Test Suite

```python
# tests/test_regression.py

import pytest
import asyncio
import json
from pathlib import Path

FIXTURE_DIR = Path("vibecheck/fixtures/toy-vulnerable-app")
EXPECTED = json.loads((FIXTURE_DIR / "expected_findings.json").read_text())

@pytest.fixture(scope="session")
def scan_results():
    """Run the full pipeline on the fixture and cache results."""
    # Use mocked Redis/Supabase — pipeline writes to in-memory dict
    from tests.mocks import MockRedis, MockSupabase
    from worker.scan_worker import run_scan_pipeline
    
    results = asyncio.run(run_scan_pipeline(
        repo_dir=str(FIXTURE_DIR),
        scan_id="test-fixture-001",
        redis=MockRedis(),
        supabase=MockSupabase(),
    ))
    return results

def test_semgrep_no_regression(scan_results):
    """Semgrep findings from v1 must still appear."""
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    semgrep_findings = [v for v in confirmed if v.get("detector") == "semgrep"]
    
    for expected in EXPECTED["semgrep"]:
        matching = [
            v for v in semgrep_findings
            if v["vuln_type"] == expected["vuln_type"]
            and expected["file"] in v["file_path"]
        ]
        assert matching, f"REGRESSION: Expected semgrep finding missing: {expected}"

def test_semantic_lifting_new_findings(scan_results):
    """Semantic lifting must surface logical vulns Semgrep misses."""
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    
    for expected in EXPECTED["semantic_lifting"]:
        matching = [
            v for v in confirmed
            if v["vuln_type"] == expected["vuln_type"]
            and expected["file"] in v["file_path"]
        ]
        assert matching, f"MISSING: Expected semantic finding: {expected}"

def test_secrets_scanner_findings(scan_results):
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    secrets_findings = [v for v in confirmed if v.get("source") == "secrets_scan"]
    
    assert len(secrets_findings) >= len(EXPECTED["secrets_scanner"]), \
        f"Expected at least {len(EXPECTED['secrets_scanner'])} secrets findings"

def test_no_duplicates(scan_results):
    """No two confirmed findings should share (file, line, type)."""
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    keys = [(v["file_path"], v["line_start"], v["vuln_type"]) for v in confirmed]
    assert len(keys) == len(set(keys)), f"Duplicate confirmed findings detected"

def test_needs_verify_false_skips_llm(scan_results):
    """High-confidence pattern findings must not go through LLM."""
    assert scan_results["metrics"]["secrets_llm_calls"] == 0, \
        "Secrets scanner findings should not trigger LLM verification"

def test_cost_within_ceiling(scan_results):
    """Total scan cost must be within configured ceiling."""
    actual_cost_cents = scan_results["metrics"]["total_cost_usd"] * 100
    assert actual_cost_cents <= 200, f"Scan exceeded cost ceiling: ${actual_cost_cents/100:.2f}"

def test_graceful_degradation_semantic_fail(monkeypatch):
    """Pipeline must complete if semantic lifting raises."""
    from worker import semantic_lifting_agent
    monkeypatch.setattr(semantic_lifting_agent, "run", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("simulated failure")))
    
    # Should not raise — should complete with semgrep-only mode
    from tests.mocks import MockRedis, MockSupabase
    from worker.scan_worker import run_scan_pipeline
    results = asyncio.run(run_scan_pipeline(
        repo_dir=str(FIXTURE_DIR),
        scan_id="test-degrade-001",
        redis=MockRedis(),
        supabase=MockSupabase(),
    ))
    assert results["scan_mode"] == "semgrep-only"
    assert len(results["vulnerabilities"]) > 0  # Semgrep still fires
```

---

## 14. Verification Checklist

### Tier 0 (Bug Fixes)

- [ ] Dedup key is `(file_path, line_start, vuln_type)` — no `source` field
- [ ] Semgrep + lifting candidates at same location merge correctly — one candidate reaches LLM
- [ ] `needs_llm_verification=False` candidates are auto-confirmed and bypass LLM
- [ ] All new LLM calls have explicit `timeout=` parameter
- [ ] Behavioral analyzer prioritizes route files regardless of prior findings

### Tier 1 (Core Upgrade)

- [ ] File index built once, shared by context builder and semantic lifting
- [ ] `context_builder.get_context()` returns full function body (>5 lines)
- [ ] LLM verifier prompt includes middleware chain
- [ ] LLM verifier prompt includes critical FP rules (sanitizer awareness)
- [ ] Semantic lifting candidates have `source: "semantic_lifting"` field
- [ ] Stage 0.5: `CALLS` edges only written for resolved (not unresolved) calls
- [ ] Stage 0.5: `MIDDLEWARE_BEFORE` edges reflect registration order, not proximity
- [ ] Regression test: all v1 Semgrep findings still confirmed after upgrade

### Tier 2 (Detection Expansion)

- [ ] PoC payloads appear on confirmed critical/high findings
- [ ] PoC payloads include `TARGET` placeholder and exploitation steps
- [ ] Secrets scanner fires on AWS keys, GitHub tokens, JWT secrets
- [ ] Git history scan bounded to `GIT_HISTORY_MAX_COMMITS`
- [ ] IaC scanner uses checkov when available, Dockerfile fallback when not
- [ ] Auth graph report appears in scan output with route coverage stats
- [ ] ReDoS rules fire on `new RegExp(req.*)` pattern
- [ ] Race condition candidates flagged on async read-check-write without transaction

### Tier 3 (Trust Infrastructure)

- [ ] Developer can mark finding as FP/TP/won't-fix via API and frontend
- [ ] Per-rule FP rate tracked and logged after 100+ verdicts
- [ ] Incremental scan runs git diff, only processes changed files
- [ ] Incremental scan carries forward unchanged-file findings
- [ ] Scan diff report shows new/fixed/unchanged vs prior scan
- [ ] Consensus verifier runs two calls for critical/high, confirms only on agreement
- [ ] Disagreement findings saved as `confirmed=False` with manual review flag

### Cost and Operations

- [ ] `CostTracker` passed through all pipeline stages
- [ ] Each LLM call checks `can_spend()` before executing
- [ ] Cost cap triggers halt remaining calls, not crash
- [ ] Actual cost logged per stage and total
- [ ] Actual cost within 20% of estimate on regression fixture

### Regression Test Suite

- [ ] `test_semgrep_no_regression` passes
- [ ] `test_semantic_lifting_new_findings` passes
- [ ] `test_secrets_scanner_findings` passes
- [ ] `test_no_duplicates` passes
- [ ] `test_needs_verify_false_skips_llm` passes
- [ ] `test_cost_within_ceiling` passes
- [ ] `test_graceful_degradation_semantic_fail` passes
- [ ] All tests pass in CI without live LLM calls (mocked)

---

## Appendix: New Files Summary

### Tier 0 (Edits, Not New Files)

| File | Changes |
|------|---------|
| `worker/scan_worker.py` | Fix dedup key, add needs_verify split, add CostTracker |
| `worker/behavioral_flow_analyzer.py` | Fix priority ordering, add timeouts |

### Tier 1 (from blue-team-upgrades, corrected)

| File | Purpose |
|------|---------|
| `worker/file_index_builder.py` | `{path: content}` index, shared by all stages |
| `worker/multi_file_context_builder.py` | Cross-file context; migrates to Cypher after Stage 0.5 |
| `worker/semantic_lifting_agent.py` | First-pass LLM logical vuln detection |
| `worker/behavioral_flow_analyzer.py` | Deep function analysis, fixed priority |
| `worker/llm_verifier_patch.py` | Full context prompts, critical FP rules |
| `core/cost_tracker.py` | Running cost accumulator with per-stage caps |

### Tier 2 (New)

| File | Purpose |
|------|---------|
| `worker/poc_generator.py` | PoC payload generation for confirmed findings |
| `worker/secrets_scanner.py` | Pattern + entropy + git history secrets detection |
| `worker/iac_scanner.py` | IaC misconfiguration via checkov + Dockerfile fallback |
| `worker/auth_graph_analyzer.py` | API auth coverage model from MIDDLEWARE_BEFORE graph |
| `rules/redos.yaml` | ReDoS detection Semgrep rules |

### Tier 3 (New)

| File | Purpose |
|------|---------|
| `worker/incremental_scanner.py` | Git diff → changed files, carry-forward logic |
| `worker/scan_differ.py` | Compare two scan results, produce diff report |
| `core/calibration.py` | Confidence score calibration against feedback data |

### Schema Migrations

| File | Changes |
|------|---------|
| `migrations/005_poc_and_verdict.sql` | Add `poc_payload`, `developer_verdict`, `verdict_at` to vulnerabilities |
| `migrations/006_incremental_scan.sql` | Add `is_incremental`, `base_commit`, `head_commit` to scan_queue |

---

*End of Plan — v3*