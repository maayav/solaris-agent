# Blue Team Pipeline Upgrade Plan — v4 (Merged)

## Overview

This document outlines the plan to integrate the `blue-team-upgrades/` package into the existing `vibecheck` Blue Team pipeline.

**Document Version:** 4.0 (merged from v3 and PLAN.MD)  
**Status:** Planning  
**Supersedes:** v3 and PLAN.MD

---

## Table of Contents

1. [What This Version Improves](#1-what-this-version-improves)
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

## 1. What This Version Improves

### From v3 (UPGRADE_PLAN.md):
- Fixed dedup key bug (source not in key)
- Fixed `needs_llm_verification` bypass code path
- Implemented CostTracker with runtime enforcement
- Fixed IaC regex (checkov-first approach)
- Corrected behavioral analyzer scope
- Added timeouts to all LLM stages
- Corrected model references (OpenRouter stack)
- Properly specified Stage 0.5 call resolution

### From PLAN.MD:
- Tier-based structure (Tier 0-4)
- PoC generation for confirmed high/critical findings
- Git history scanning for committed-and-deleted secrets
- Authorization graph as first-class report
- ReDoS detection (Semgrep YAML rules)
- Race condition / TOCTOU detection
- Developer feedback loop schema + API
- Incremental scanning via git diff
- Scan result diffing (new/fixed/unchanged)
- LLM verifier meta-layer (consensus for critical/high)
- Confidence score calibration
- Honest assessment of what current pipeline does/doesn't do well

---

## 2. Honest Assessment of Current State

Before planning additions, this is what the current pipeline actually does and doesn't do well.

### What works:
- **Semgrep rules** are well-chosen. OWASP + NodeJS + custom express rules cover the major syntactic vulnerability classes.
- **N+1 detection via FalkorDB Cypher** is elegant and correct for the structural pattern.
- **Two-tier LLM fallback** (OpenRouter → Ollama) is the right resilience model.
- **Real-time Supabase progress updates** give the frontend something useful to display.

### What doesn't work well:
- **LLM verifier sees 5-10 lines.** Most vulnerabilities require 20-50 lines of context to assess correctly. The verifier is making decisions without enough information.
- **No middleware awareness.** IDOR and missing-auth findings can't be properly confirmed without knowing the middleware chain. The verifier will both over-confirm (Semgrep found a pattern, LLM agrees even though auth middleware exists) and under-confirm (auth exists but is conditionally bypassed).
- **Pattern propagation precision is unknown.** The Qdrant similarity search for "similar vulnerable patterns" has never been evaluated. Code similarity in embedding space is mostly structural — a batched query and an N+1 look similar. There's a real chance this stage produces mostly noise.
- **Zero feedback loop.** Developers cannot mark findings as false positives. No signal flows back to improve detection. Confidence scores are uncalibrated.
- **Every scan is a full rescan.** A one-line change rescans all 500 files. This is a blocker for CI integration.

### What's genuinely hard and shouldn't be oversold:
- **Semantic lifting** (LLM-as-detector) is non-deterministic. Same code, different run, potentially different findings. Treat it as supplement, not primary detection.
- **LLM verifier** has known failure modes: sycophancy (biased toward confirming if the candidate says it's vulnerable), context window middle loss, hallucinated fix suggestions.
- **Second-order vulnerabilities** (value stored, later retrieved and interpolated) are beyond what this architecture can reliably catch.

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
  → Git History Scan (optional pass for committed-deleted secrets)
  → Semantic Lifting (LLM first-pass, non-fatal)
  → Merge + Dedup (source-priority, fixed key)
  → Split: skip_verify (auto-confirm) | needs_verify
  → LLM Verify with full function + middleware context (batch, non-fatal)
  → IaC Scanner (checkov subprocess, non-fatal, parallel)
  → Authorization Graph (Cypher-based auth coverage report)
  → Behavioral Flow Analyzer (non-fatal, dynamic cap, correct priority)
  → Pattern Propagation (Qdrant)
  → Supabase persist
  → Scan Diff (new/fixed/unchanged vs previous scan)
  → PoC Generation for confirmed high/critical (LLM, non-fatal)
  → Report with scan diff + PoC payloads
```

### With Tier 3 (Trust Infrastructure)

```
[All above]
  → Developer feedback ingestion (FP/TP/won't-fix)
  → Per-rule precision tracking
  → Incremental scan (git diff → only changed files)
  → LLM verifier meta-layer (two independent calls, confirm on agreement)
```

---

## 5. Tier 1 — Core Upgrade (High Impact, Low Risk)

These are the `blue-team-upgrades/` package integrations, corrected per Tier 0.

---

### Stage 0.5: Knowledge Graph Schema Migration

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
| `:IMPORTED_BY` | `File` → `File` | Reverse of static import |
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
- **Auth propagation gaps:** query all routes → walk `MIDDLEWARE_BEFORE` → flag any state-mutating route reachable without `is_auth_middleware: true`
- **Taint source-to-sink:** mark `req.body.*` tainted → follow `DEPENDS_ON` edges → flag when tainted data reaches `TOUCHES_MODEL` without sanitizer node in path
- **Blast radius:** functions with high incoming `CALLS` count get higher behavioral analysis priority
- **Dead code deprioritization:** no `IMPORTED_BY` + no incoming `CALLS` = low-value scan target

---

### New Files to Add to `vibecheck/worker/`

| File | Purpose | Effort |
|------|---------|--------|
| `file_index_builder.py` | `{rel_path: content}` dict once per scan | Low |
| `multi_file_context_builder.py` | Cross-file context per candidate; migrates to Cypher after Stage 0.5 | Medium |
| `semantic_lifting_agent.py` | First-pass LLM candidate generation | Medium |
| `behavioral_flow_analyzer.py` | Deep function analysis post-verification | Medium |
| `llm_verifier_patch.py` | Full-function + middleware context prompts for existing verifier | Low |

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
    file_context: Optional[FileContext] = None,
) -> dict[str, Any]:
```

**Critical verification rules added to prompt:**
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
| IaC Scanner | 82–85% | Non-fatal, checkov subprocess |
| Authorization Graph | 85–87% | |
| Behavioral Analysis | 87–92% | Non-fatal |
| Pattern Propagation | 92–95% | |
| Scan Diff + PoC | 95–98% | |
| Save + Report | 98–100% | |

---

## 6. Tier 2 — Detection Expansion (High Impact, Medium Risk)

### Priority 1: PoC Generation

**Why this first:** The difference between a scanner developers act on and one they ignore is whether findings come with proof. A confirmed IDOR with a curl command that demonstrates data leakage is categorically more actionable than a confirmed IDOR with "use ownership checks."

**What it produces:**

For each confirmed high/critical vulnerability:
```
IDOR — GET /api/orders/:id
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
curl -s -X GET "http://TARGET/api/orders/1337" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

Expected: 200 OK with order data belonging to a different user.
Confirm: Check that user_id in response != your user_id.
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

**Schema change:** Add `poc_payload TEXT` column to `vulnerabilities` table.

---

### Priority 2: Secrets Scanner (Git History Aware)

**Why git history matters:** Secrets committed and deleted are still in history and still live. This is the most common real-world credential exposure path. Scanning HEAD only misses it entirely.

**Two-pass approach:**

**Pass 1: Current HEAD** (pattern + entropy, no LLM, fast) — see Tier 1 secrets scanner.

**Pass 2: Git history scan** (subprocess, optional, bounded):
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
```

**Tuning knobs:**
```python
HIGH_ENTROPY_THRESHOLD = 4.5
MIN_SECRET_LENGTH = 20
GIT_HISTORY_MAX_COMMITS = 200
GIT_HISTORY_ENABLED = True
```

---

### Priority 3: IaC Scanner (Checkov-First)

Use `checkov` as the primary engine. Custom regex as fallback only.

```python
async def run_iac_scan(repo_dir: str) -> list[dict]:
    try:
        result = subprocess.run(
            ["checkov", "--directory", repo_dir, "--output", "json", "--quiet", "--compact"],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode in (0, 1):
            data = json.loads(result.stdout)
            return _parse_checkov_output(data)
    except FileNotFoundError:
        logger.warning("[IaC] checkov not available, falling back to Dockerfile scan")
        return await _fallback_dockerfile_scan(repo_dir)
    except subprocess.TimeoutExpired:
        logger.warning("[IaC] checkov timed out after 300s")
        return []
    return []
```

**Note:** `checkov` is an optional install. The pipeline degrades to Dockerfile-only without it.

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

**Implementation (after Stage 0.5 graph is built):**
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

---

### Priority 5: ReDoS Detection

Absent from the current detection matrix. Easy to detect statically, easy to exploit, zero current coverage.

**Pattern:** User-controlled input flows into `RegExp` constructor or `.test()` / `.match()` with a complex pattern.

**Detection:** Add to Semgrep custom rules:
1. `new RegExp(req.*)` — user-controlled regex construction
2. `str.match(userPattern)` — user-supplied pattern
3. Known catastrophic regex structures: `(a+)+`, `([a-zA-Z]+)*`, etc.

**File:** `vibecheck/rules/redos.yaml`

---

### Priority 6: Race Condition / TOCTOU Detection

Common in financial and inventory endpoints. Static detection is imperfect but useful as a candidate generator.

**Detection heuristic:**
```python
# Flag functions matching ALL of:
# 1. async function
# 2. reads from DB (ORMCall with .find/.get/.findOne)
# 3. writes to same model (ORMCall with .update/.save)
# 4. no transaction wrapper (no BEGIN/COMMIT or Sequelize.transaction())
# 5. financial/inventory signal words (balance, wallet, inventory, stock, order)
```

---

## 7. Tier 3 — Trust Infrastructure (Highest Long-Term Value)

These determine whether the scanner is trusted over time. Without them, every other enhancement is optimization of a black box.

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

**Downstream use:**
- Per-rule false positive rate: `COUNT(verdict=false_positive) / COUNT(*)` grouped by `rule_id`
- Rules with FP rate > 40% get flagged for review
- High-FP rules get a warning in the verifier prompt

---

### 7.2 Incremental / Diff Scanning

**Problem:** Every scan is a full rescan. For a 500-file repo, this is expensive and slow, and makes CI integration impractical.

**Implementation:**
```python
async def get_changed_files(repo_dir: str, previous_commit: Optional[str]) -> Optional[list[str]]:
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
```

**Schema addition:**
```sql
ALTER TABLE scan_queue ADD COLUMN is_incremental BOOLEAN DEFAULT FALSE;
ALTER TABLE scan_queue ADD COLUMN base_commit TEXT;
ALTER TABLE scan_queue ADD COLUMN head_commit TEXT;
ALTER TABLE scan_queue ADD COLUMN changed_file_count INTEGER;
```

---

### 7.3 Scan Result Diffing

When a repo is scanned twice, the output should clearly show what changed:
```
SCAN DIFF vs previous scan (2026-03-20)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 New:      3 findings
✅ Fixed:    2 findings  
📌 Unchanged: 8 findings
⚠️  Regression: 1 finding (was marked FP, reappeared)
```

---

### 7.4 LLM Verifier Meta-Layer

For critical/high findings, run two independent verification calls and only confirm on agreement.

```python
async def verify_candidate_with_consensus(candidate, file_context=None) -> dict:
    severity = candidate.get("severity", "medium")
    
    if severity not in ("critical", "high"):
        return await verify_candidate(candidate, file_context)
    
    result_a, result_b = await asyncio.gather(
        verify_candidate(candidate, file_context),
        verify_candidate(candidate, file_context),
    )
    
    if result_a["confirmed"] == result_b["confirmed"]:
        result_a["consensus"] = True
        return result_a
    else:
        return {
            **result_a,
            "confirmed": False,
            "confidence_score": 0.4,
            "verification_reason": "LLM verifiers disagreed — manual review recommended",
            "consensus": False,
        }
```

---

### 7.5 Confidence Score Calibration

After sufficient feedback data (>100 verdicts), compute empirical precision per confidence bucket:
```python
async def compute_calibration():
    """
    For each confidence bucket (0.0-0.1, 0.1-0.2, ..., 0.9-1.0):
    Compute: confirmed_by_developer / total_in_bucket
    Emit a calibration curve to Supabase.
    """
```

Display calibration curve in the dashboard: "When we say 90% confidence, we're right X% of the time."

---

## 8. Tier 4 — Advanced Detection (Medium Impact, High Effort)

### 8.1 Sanitizer-Aware Taint Tracking

A sanitizer registry in Semgrep taint rules:
```yaml
# In express-taint.yaml
pattern-sanitizers:
  - pattern: parseInt($X, 10)
  - pattern: parseFloat($X)
  - pattern: Number($X)
  - pattern: validator.isInt($X)
  - pattern: $X.replace(/[^a-zA-Z0-9]/g, '')
  - pattern: encodeURIComponent($X)
  - pattern: $SCHEMA.parse($X)  # zod/yup
```

---

### 8.2 Second-Order Vulnerability Detection

1. Tag all `INSERT`/`UPDATE` ORM calls that store user-controlled input with `taints_db=True`
2. In a second pass, find `SELECT` calls on the same model where the result is used in a sink
3. Flag as second-order candidate if the chain is found

This will have high FP rate. Surface candidates with low confidence and explicit "second-order candidate — manual review recommended" label.

---

### 8.3 Dependency / CVE Scanner

Parse `package.json` and `requirements.txt`, query OSV.dev for known CVEs:
```python
async def run_dependency_scan(repo_dir: str) -> list[dict]:
    # 1. Parse package.json → {name: version_constraint}
    # 2. POST to https://api.osv.dev/v1/querybatch with all packages
    # 3. Parse response → CVE findings with CVSS scores
    ...
```

Use OSV.dev (free, no API key required) over npm audit or Snyk.

---

## 9. Deferred / Skipped

| Feature | Reason |
|---------|--------|
| **CodeQL integration** | Requires full compilation (30-60 min/language). Incompatible with scan worker model. Semgrep taint + behavioral LLM covers ~80% of relevant findings. |
| **SBOM generation** | Low vulnerability detection value. Compliance/audit concern, not security scanning. |
| **Pattern propagation via Qdrant** | Needs evaluation before expanding. Current similarity search likely produces <30% precision. Evaluate first. |
| **Semantic lifting as primary detector** | Non-deterministic. Treat as supplement, instrument it and track confirmed-vs-rejected rate before expanding. |

---

## 10. Integration Order

```
Step 0: Tier 0 bug fixes (dedup key, needs_llm_verification split, timeouts)
Step 1: File index builder + context builder (no LLM changes yet)
Step 2: LLM verifier patch (full function + middleware context)
Step 3: Semantic lifting agent (with fixed dedup)
Step 4: Behavioral flow analyzer (with fixed priority, explicit timeouts)
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

### Degradation Modes

| Stage Failure | Mode Label | Impact |
|--------------|------------|--------|
| Semantic Lifting fails | `semgrep-only` | Lose logical vuln classes (missing auth, rate limit) |
| LLM Verification fails | `unverified` | Candidates saved `confirmed=False`, flagged for manual review |
| Behavioral Analysis fails | `verifier-only` | Lose deep dataflow findings |
| IaC Scanner fails | `no-iac` | No infrastructure findings |
| Secrets Scanner fails | `no-secrets-scan` | No secrets findings |
| PoC Generation fails | `no-poc` | Findings confirmed but no proof payload |
| All LLM stages fail | `semgrep-raw` | Raw Semgrep findings, no LLM filtering |

---

## 12. Cost Model

### CostTracker Implementation

```python
@dataclass
class CostTracker:
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
            logger.warning(f"[Cost] {stage} cap reached. Skipping.")
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
| **Total average** | | | **~$0.12-0.18/scan** |

### Worst-Case Ceiling

| Stage | Scenario | Tokens (max) | Ceiling |
|-------|----------|--------------|---------|
| Semantic Lifting | 10 max-size slices | ~140k | ~$0.14 |
| LLM Verify | 50 candidates, full context | ~3M | ~$3.00 |
| Behavioral | 60 functions, max context | ~960k | ~$0.96 |
| PoC Generation | 20 critical findings | ~500k | ~$0.50 |
| **Total ceiling** | | | **~$4.60/scan** |

---

## 13. Regression Test Fixture

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

### Test Suite

```python
# tests/test_regression.py

import pytest
import asyncio
from pathlib import Path

FIXTURE_DIR = Path("vibecheck/fixtures/toy-vulnerable-app")
EXPECTED = json.loads((FIXTURE_DIR / "expected_findings.json").read_text())

@pytest.fixture(scope="session")
def scan_results():
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
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    semgrep_findings = [v for v in confirmed if v.get("detector") == "semgrep"]
    for expected in EXPECTED["semgrep"]:
        matching = [v for v in semgrep_findings
            if v["vuln_type"] == expected["vuln_type"]
            and expected["file"] in v["file_path"]]
        assert matching, f"REGRESSION: Expected semgrep finding missing: {expected}"

def test_semantic_lifting_new_findings(scan_results):
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    for expected in EXPECTED["semantic_lifting"]:
        matching = [v for v in confirmed
            if v["vuln_type"] == expected["vuln_type"]
            and expected["file"] in v["file_path"]]
        assert matching, f"MISSING: Expected semantic finding: {expected}"

def test_secrets_scanner_findings(scan_results):
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    secrets_findings = [v for v in confirmed if v.get("source") == "secrets_scan"]
    assert len(secrets_findings) >= len(EXPECTED["secrets_scanner"])

def test_no_duplicates(scan_results):
    confirmed = [v for v in scan_results["vulnerabilities"] if v["confirmed"]]
    keys = [(v["file_path"], v["line_start"], v["vuln_type"]) for v in confirmed]
    assert len(keys) == len(set(keys)), "Duplicate confirmed findings detected"

def test_cost_within_ceiling(scan_results):
    actual_cost_cents = scan_results["metrics"]["total_cost_usd"] * 100
    assert actual_cost_cents <= 200, f"Scan exceeded cost ceiling: ${actual_cost_cents/100:.2f}"
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
- [ ] `test_cost_within_ceiling` passes
