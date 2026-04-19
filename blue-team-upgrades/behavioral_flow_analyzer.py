"""
behavioral_flow_analyzer.py — Blue Team Pipeline Stage 4.5 (new)

Performs WHOLE-FUNCTION dataflow LLM analysis on a targeted subset of files:
the top-N most complex/sensitive functions that Semgrep and semantic lifting
may have already flagged, plus unexplored high-risk areas.

Unlike the per-candidate verifier (which sees only a small snippet),
the behavioral analyzer gets:
  1. The COMPLETE function body
  2. All transitive imports used within that function
  3. The middleware chain applied before the handler
  4. Key type definitions relevant to the function's parameters

This lets the LLM reason about:
  - Multi-step dataflows across lines (e.g., value sanitized in line 5 but bypassed in line 12)
  - Conditional security bypasses (e.g., if (dev) { skip auth })
  - Race conditions in async flows
  - State mutation side effects
  - Second-order injection (value stored, then interpolated later)
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

import httpx

from core.config import get_settings
from worker.multi_file_context_builder import MultiFileContextBuilder, FileContext

logger = logging.getLogger(__name__)

BEHAVIORAL_TIMEOUT = 180.0
MAX_FUNCTIONS_TO_ANALYZE = 30   # cap total behavioral analyses per scan
MAX_CONTEXT_CHARS = 16000       # per function analysis — ~4k tokens

BEHAVIORAL_SYSTEM_PROMPT = """\
You are a world-class application security engineer performing deep behavioral analysis.
You have been given the COMPLETE source of a function along with all relevant context:
imports, middleware, type definitions, and callers.

Your task: identify security vulnerabilities that require understanding the FULL
control flow and dataflow of the function — not just pattern matching.

Focus on:
1. DATAFLOW ISSUES: user-controlled data that reaches a dangerous sink through
   multiple intermediate steps, with incomplete or bypassable sanitization
2. CONDITIONAL BYPASSES: security checks that can be skipped under specific conditions
3. RACE CONDITIONS: async operations that modify shared state insecurely
4. SECOND-ORDER FLAWS: data stored to DB then used unsafely later in a different path
5. STATE-BASED VULNERABILITIES: issues that depend on the order of operations
6. TYPE CONFUSION: mismatched type expectations allowing unexpected payloads

Be PRECISE. Explain the EXACT exploit path. Avoid generic observations.
"""

BEHAVIORAL_USER_PROMPT_TEMPLATE = """\
Perform deep behavioral security analysis on the following function.

FUNCTION UNDER ANALYSIS:
File: {file_path}
Lines: {line_start}–{line_end}
Vulnerability hint (from static analysis): {vuln_hint}

FULL FUNCTION SOURCE:
```typescript
{full_function_src}
```

MIDDLEWARE APPLIED BEFORE THIS HANDLER:
{middleware_chain}

KEY IMPORTS AND RELATED FILES:
{related_sources}

Analyze the complete dataflow through this function. Identify:
1. Is the static analysis finding a TRUE POSITIVE, FALSE POSITIVE, or INCOMPLETE (real but more severe than flagged)?
2. Are there ADDITIONAL vulnerabilities in this function not caught by static analysis?
3. What is the precise exploit scenario?

Respond with this JSON structure:
{{
  "static_finding_verdict": "confirmed" | "false_positive" | "incomplete",
  "static_finding_reason": "explanation",
  "additional_findings": [
    {{
      "vuln_type": "...",
      "description": "precise exploit scenario",
      "line_start": 0,
      "severity": "critical|high|medium|low",
      "confidence": "high|medium|low",
      "fix_suggestion": "...",
      "exploit_path": "step-by-step how an attacker exploits this"
    }}
  ],
  "dataflow_notes": "brief summary of the data flow through this function"
}}

Respond with ONLY the JSON, no other text.
"""


class BehavioralFlowAnalyzer:
    """
    Runs deep LLM behavioral analysis on high-value functions.

    Call after Semgrep and SemanticLiftingAgent have run so we have
    a prioritized list of candidates to deep-analyze.

    Args:
        repo_dir: Absolute path to cloned repo.
        context_builder: Already-indexed MultiFileContextBuilder instance.
        settings: App settings.
    """

    def __init__(
        self,
        repo_dir: str,
        context_builder: MultiFileContextBuilder,
        settings=None,
    ):
        self.repo_dir = Path(repo_dir)
        self.context_builder = context_builder
        self.settings = settings or get_settings()

    async def run(
        self,
        candidates: list[dict],
        already_confirmed_files: set[str],
    ) -> list[dict]:
        """
        Run behavioral analysis on the highest-priority candidates.

        Priority order:
          1. High/critical Semgrep findings not yet confirmed (LLM may have missed)
          2. Semantic lifting candidates (need deeper verification)
          3. Files with multiple candidates (hot spots)
          4. Files that are imported by many others (high-impact)

        Returns: list of additional candidate dicts (new findings from behavioral pass).
                 The verdicts on existing candidates are attached to the original
                 candidate dicts in-place via 'behavioral_verdict' field.
        """
        if not candidates:
            return []

        # Score candidates for prioritization
        scored = _score_candidates(candidates, already_confirmed_files)
        top_candidates = scored[:MAX_FUNCTIONS_TO_ANALYZE]

        logger.info(
            f"[BehavioralAnalyzer] Analyzing {len(top_candidates)} high-priority functions"
        )

        new_findings: list[dict] = []
        analyzed_functions: set[tuple] = set()  # (file_path, fn_start_line)

        for candidate in top_candidates:
            file_path = candidate.get("file_path", "")
            line_start = int(candidate.get("line_start", 0))

            # Build full context for this function
            ctx = self.context_builder.get_context(candidate)

            # Dedup by function (multiple candidates may be in the same function)
            fn_key = (file_path, _snap_to_function_key(ctx.full_function_src))
            if fn_key in analyzed_functions:
                continue
            analyzed_functions.add(fn_key)

            if not ctx.full_function_src:
                logger.debug(f"[BehavioralAnalyzer] No function source for {file_path}:{line_start}")
                continue

            try:
                result = await self._analyze_function(candidate, ctx)
                if not result:
                    continue

                # Attach behavioral verdict to original candidate
                candidate["behavioral_verdict"] = result.get("static_finding_verdict")
                candidate["behavioral_reason"] = result.get("static_finding_reason")
                candidate["dataflow_notes"] = result.get("dataflow_notes")

                # Collect additional findings
                for finding in result.get("additional_findings", []):
                    finding["file_path"] = file_path
                    finding.setdefault("line_start", line_start)
                    finding["source"] = "behavioral_analysis"
                    finding["rule_id"] = f"behavioral:{finding.get('vuln_type', 'unknown')}"
                    finding["needs_llm_verification"] = False  # already LLM-analyzed
                    finding["confirmed"] = True
                    finding["confidence"] = finding.get("confidence", "medium")
                    new_findings.append(finding)

                logger.info(
                    f"[BehavioralAnalyzer] {file_path}:{line_start} → "
                    f"verdict={result.get('static_finding_verdict')} "
                    f"additional={len(result.get('additional_findings', []))}"
                )

            except Exception as e:
                logger.warning(f"[BehavioralAnalyzer] Failed for {file_path}:{line_start}: {e}")

        logger.info(f"[BehavioralAnalyzer] Found {len(new_findings)} additional behavioral findings")
        return new_findings

    async def _analyze_function(
        self, candidate: dict, ctx: FileContext
    ) -> Optional[dict]:
        """Send a single function + context to the LLM for behavioral analysis."""

        vuln_hint = (
            f"{candidate.get('vuln_type', 'unknown')} "
            f"(rule: {candidate.get('rule_id', 'n/a')}, "
            f"source: {candidate.get('source', 'semgrep')})"
        )

        middleware_str = (
            "\n".join(f"  - {mw}" for mw in ctx.middleware_chain)
            if ctx.middleware_chain
            else "  (none detected — verify manually)"
        )

        # Build related sources summary, capped to context budget
        related_str = ""
        remaining_budget = MAX_CONTEXT_CHARS - len(ctx.full_function_src) - 2000
        for rpath, rsrc in ctx.related_sources.items():
            chunk = f"\n--- {rpath} ---\n{rsrc[:min(remaining_budget, 2000)]}\n"
            if len(related_str) + len(chunk) > remaining_budget:
                break
            related_str += chunk

        prompt = BEHAVIORAL_USER_PROMPT_TEMPLATE.format(
            file_path=candidate.get("file_path", ""),
            line_start=candidate.get("line_start", 0),
            line_end=candidate.get("line_end", candidate.get("line_start", 0)),
            vuln_hint=vuln_hint,
            full_function_src=ctx.full_function_src[:MAX_CONTEXT_CHARS // 2],
            middleware_chain=middleware_str,
            related_sources=related_str or "(no related files found)",
        )

        raw = await self._call_llm(prompt)
        if not raw:
            return None

        return _parse_behavioral_response(raw)

    async def _call_llm(self, prompt: str) -> Optional[str]:
        """
        Call OpenRouter with the behavioral analysis prompt.
        Prefers reasoning-capable models for complex dataflow analysis.
        """
        if not self.settings.openrouter_api_key:
            return None

        # Prefer reasoning models for behavioral analysis — they're better at
        # multi-step dataflow tracing
        models_to_try = [
            "deepseek/deepseek-r1",                   # best reasoning, if budget allows
            "deepseek/deepseek-chat-v3-0324",          # strong code + reasoning
            "google/gemini-2.0-flash-thinking-exp:free",
            "deepseek/deepseek-r1-distill-qwen-32b",  # reliable fallback
        ]

        for model in models_to_try:
            try:
                async with httpx.AsyncClient(timeout=BEHAVIORAL_TIMEOUT) as client:
                    response = await client.post(
                        f"{self.settings.openrouter_base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                            "HTTP-Referer": self.settings.openrouter_http_referer,
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": model,
                            "messages": [
                                {"role": "system", "content": BEHAVIORAL_SYSTEM_PROMPT},
                                {"role": "user", "content": prompt},
                            ],
                            "temperature": 0.05,
                            "max_tokens": 2048,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    content = data["choices"][0]["message"]["content"]
                    logger.debug(f"[BehavioralAnalyzer] {model} responded ({len(content)} chars)")
                    return content
            except Exception as e:
                logger.debug(f"[BehavioralAnalyzer] Model {model} failed: {e}")
                continue

        return None


# ------------------------------------------------------------------
# Pure helpers
# ------------------------------------------------------------------

def _score_candidates(candidates: list[dict], confirmed_files: set[str]) -> list[dict]:
    """
    Score and sort candidates for behavioral analysis priority.
    Higher score = analyzed first.
    """
    file_candidate_count: dict[str, int] = {}
    for c in candidates:
        fp = c.get("file_path", "")
        file_candidate_count[fp] = file_candidate_count.get(fp, 0) + 1

    def score(c: dict) -> int:
        s = 0
        sev = c.get("severity", "").lower()
        if sev == "critical":
            s += 40
        elif sev == "high":
            s += 30
        elif sev == "medium":
            s += 10

        # Semantic lifting candidates not yet verified get priority
        if c.get("source") == "semantic_lifting" and not c.get("confirmed"):
            s += 25

        # Files with multiple findings are hotspots
        fp = c.get("file_path", "")
        s += min(file_candidate_count.get(fp, 0) * 5, 20)

        # Route and controller files are higher impact
        if re.search(r"(routes?|controllers?|handlers?)", fp, re.I):
            s += 15

        # Already confirmed files: behavioral pass finds additional issues
        if fp in confirmed_files:
            s += 10

        return s

    return sorted(candidates, key=score, reverse=True)


def _snap_to_function_key(fn_src: str) -> str:
    """Generate a short dedup key from function source."""
    # Use first 100 chars (enough to distinguish functions)
    return fn_src[:100].strip()


def _parse_behavioral_response(raw: str) -> Optional[dict]:
    """Parse behavioral LLM response into a structured dict."""
    raw = raw.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    # Try direct JSON parse
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "static_finding_verdict" in data:
            return data
    except json.JSONDecodeError:
        pass

    # Try to extract JSON object from prose
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

    logger.debug(f"[BehavioralAnalyzer] Could not parse response: {raw[:300]}")
    return None