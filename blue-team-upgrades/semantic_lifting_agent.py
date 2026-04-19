"""
semantic_lifting_agent.py — Blue Team Pipeline Stage 3 (new)

First-layer LLM pass that generates STRUCTURED candidates from high-level
code topology: routers, controllers, middleware, auth, and business logic.

This is NOT a free-form whole-codebase analysis — it operates over
focused slices (routers, middleware files, auth modules) and emits
structured candidate dicts compatible with the existing verifier schema.

The agent detects things Semgrep CANNOT:
  - Missing rate limiting on sensitive endpoints
  - Missing auth middleware on state-changing routes
  - Missing CSRF protection
  - Insecure JWT handling patterns across multiple files
  - Unsafe deserialization in business logic
  - Privilege escalation paths (e.g., userId comes from body not session)
  - Business logic flaws (e.g., quantity/price manipulation)
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

LIFTING_TIMEOUT = 180.0
MAX_SLICE_CHARS = 12000   # characters per slice sent to LLM — ~3k tokens
MAX_CANDIDATES_PER_SLICE = 8


# Vulnerability types this agent is specialized to find
SEMANTIC_VULN_TYPES = [
    "missing_auth",
    "missing_rate_limit",
    "missing_csrf",
    "privilege_escalation",
    "business_logic_flaw",
    "insecure_deserialization",
    "mass_assignment",
    "idor",
    "broken_object_level_auth",
    "ssrf_via_redirect",
    "jwt_algorithm_confusion",
    "insecure_direct_object_reference",
]

LIFTING_SYSTEM_PROMPT = """\
You are a senior application security engineer performing a BLUE TEAM code review.
Your job is to find LOGICAL and BEHAVIORAL vulnerabilities that static rules miss.
Focus on:
- Missing security controls (auth, rate limiting, CSRF, input validation)
- Privilege escalation (user-controlled fields that should come from session/JWT)
- Business logic flaws (quantity/price tampering, order manipulation, resource exhaustion)
- IDOR (direct use of user-supplied IDs to access objects without ownership check)
- Broken authentication flows across multiple middleware/handler combinations
- Unsafe data flows that span multiple files

Be PRECISE and CONSERVATIVE. Only report what you are confident is a real risk.
Avoid reporting things that are intentionally public or already protected upstream.
"""

LIFTING_USER_PROMPT_TEMPLATE = """\
You are reviewing a slice of a {language} codebase for security vulnerabilities.

SLICE TYPE: {slice_type}
FILES IN SLICE: {file_list}

CODE:
```
{code}
```

{extra_context}

Find security vulnerabilities of these types ONLY:
{vuln_types}

For each vulnerability you find, respond with a JSON array of candidates:
[
  {{
    "vuln_type": "missing_auth",
    "file_path": "routes/admin.ts",
    "line_start": 42,
    "line_end": 55,
    "description": "POST /admin/delete-user has no authentication middleware",
    "code_snippet": "// relevant code here",
    "severity": "critical",
    "confidence": "high",
    "fix_suggestion": "Add auth middleware: router.use(verifyToken)",
    "source": "semantic_lifting"
  }}
]

If you find NO issues, respond with an empty array: []
Respond with ONLY the JSON array, no other text.
"""


class SemanticLiftingAgent:
    """
    Generates structured vulnerability candidates by showing focused code slices
    to an LLM. Operates BEFORE the per-candidate verifier so its candidates
    flow through the same verification pipeline.

    Args:
        repo_dir: Absolute path to cloned repo.
        file_index: dict mapping rel_path → full file content (from scan_worker).
        settings: App settings (for OpenRouter key, models, etc).
    """

    def __init__(self, repo_dir: str, file_index: dict[str, str], settings=None):
        self.repo_dir = Path(repo_dir)
        self.file_index = file_index
        self.settings = settings or get_settings()

    async def run(self) -> list[dict[str, Any]]:
        """
        Run semantic lifting across all relevant file slices.
        Returns a list of candidate dicts ready to be added to all_candidates.
        """
        slices = self._build_slices()
        logger.info(f"[SemanticLifting] Built {len(slices)} code slices for LLM analysis")

        all_candidates: list[dict] = []
        for slice_info in slices:
            try:
                candidates = await self._analyze_slice(slice_info)
                for c in candidates:
                    c["needs_llm_verification"] = True
                    c["rule_id"] = f"semantic_lifting:{c.get('vuln_type', 'unknown')}"
                    c.setdefault("source", "semantic_lifting")
                all_candidates.extend(candidates)
                logger.info(
                    f"[SemanticLifting] Slice '{slice_info['slice_type']}' → {len(candidates)} candidates"
                )
            except Exception as e:
                logger.warning(f"[SemanticLifting] Slice failed: {e}")

        # Dedup: same file + line
        seen = set()
        deduped = []
        for c in all_candidates:
            key = (c.get("file_path", ""), c.get("line_start", 0), c.get("vuln_type", ""))
            if key not in seen:
                seen.add(key)
                deduped.append(c)

        logger.info(f"[SemanticLifting] Total unique candidates: {len(deduped)}")
        return deduped

    # ------------------------------------------------------------------
    # Slice building — each slice is a focused chunk of related code
    # ------------------------------------------------------------------

    def _build_slices(self) -> list[dict]:
        """
        Build focused code slices by file role:
          - router/route files
          - middleware files
          - auth/session/jwt files
          - controller files
          - payment/order/business logic files
        """
        slices: list[dict] = []

        # Categorize all TS/JS files by role
        categorized = _categorize_files(self.repo_dir, self.file_index)

        for category, files in categorized.items():
            if not files:
                continue

            # Aggregate source, stay within token budget
            combined_src = ""
            included_files = []
            for rel_path in files:
                src = self._get_src(rel_path)
                if not src:
                    continue
                addition = f"\n\n// === FILE: {rel_path} ===\n{src}"
                if len(combined_src) + len(addition) > MAX_SLICE_CHARS:
                    # Start a new slice
                    if combined_src:
                        slices.append({
                            "slice_type": category,
                            "files": included_files[:],
                            "code": combined_src,
                        })
                    combined_src = addition
                    included_files = [rel_path]
                else:
                    combined_src += addition
                    included_files.append(rel_path)

            if combined_src:
                slices.append({
                    "slice_type": category,
                    "files": included_files,
                    "code": combined_src,
                })

        return slices

    def _get_src(self, rel_path: str) -> str:
        if rel_path in self.file_index:
            return self.file_index[rel_path]
        try:
            full = self.repo_dir / rel_path
            if full.exists():
                return full.read_text(errors="replace")
        except Exception:
            pass
        return ""

    # ------------------------------------------------------------------
    # LLM call
    # ------------------------------------------------------------------

    async def _analyze_slice(self, slice_info: dict) -> list[dict]:
        slice_type = slice_info["slice_type"]
        files = slice_info["files"]
        code = slice_info["code"]

        # Add extra context hints for specific slice types
        extra_ctx = _get_extra_context_hint(slice_type)

        prompt = LIFTING_USER_PROMPT_TEMPLATE.format(
            language="TypeScript/JavaScript",
            slice_type=slice_type,
            file_list="\n".join(f"  - {f}" for f in files),
            code=code,
            extra_ctx=extra_ctx,
            extra_context=extra_ctx,
            vuln_types="\n".join(f"  - {vt}" for vt in _relevant_vuln_types(slice_type)),
        )

        raw = await self._call_llm(prompt)
        if not raw:
            return []

        return _parse_lifting_response(raw, files)

    async def _call_llm(self, user_prompt: str) -> Optional[str]:
        """
        Call OpenRouter with the semantic lifting prompt.
        Uses a larger context model since slices can be big.
        """
        if not self.settings.openrouter_api_key:
            logger.warning("[SemanticLifting] No OpenRouter API key, skipping")
            return None

        # Prefer models with large context and strong code reasoning
        models_to_try = [
            "google/gemini-2.0-flash-001",          # fast, large context, good code
            "deepseek/deepseek-chat-v3-0324",        # strong code reasoning
            "qwen/qwen3-coder:free",                 # free tier fallback
            "deepseek/deepseek-r1-distill-qwen-32b", # reliable fallback
        ]

        for model in models_to_try:
            try:
                async with httpx.AsyncClient(timeout=LIFTING_TIMEOUT) as client:
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
                                {"role": "system", "content": LIFTING_SYSTEM_PROMPT},
                                {"role": "user", "content": user_prompt},
                            ],
                            "temperature": 0.1,
                            "max_tokens": 2048,
                            "response_format": {"type": "json_object"},
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    content = data["choices"][0]["message"]["content"]
                    logger.debug(f"[SemanticLifting] {model} → {len(content)} chars")
                    return content
            except Exception as e:
                logger.debug(f"[SemanticLifting] Model {model} failed: {e}")
                continue

        return None


# ------------------------------------------------------------------
# Pure helpers
# ------------------------------------------------------------------

def _categorize_files(repo_dir: Path, file_index: dict[str, str]) -> dict[str, list[str]]:
    """
    Classify all TS/JS files in the repo into security-relevant categories.
    """
    categories: dict[str, list[str]] = {
        "routes_and_controllers": [],
        "middleware_and_auth": [],
        "business_logic": [],
        "data_access": [],
        "config_and_secrets": [],
    }

    all_files = list(file_index.keys())
    if not all_files:
        # Fallback: walk disk
        all_files = [
            str(f.relative_to(repo_dir))
            for f in repo_dir.rglob("*.ts")
            if "node_modules" not in f.parts and ".git" not in f.parts
        ]
        all_files += [
            str(f.relative_to(repo_dir))
            for f in repo_dir.rglob("*.js")
            if "node_modules" not in f.parts and ".git" not in f.parts
        ]

    route_patterns = re.compile(
        r"(routes?|controllers?|handlers?|endpoints?|api)", re.I
    )
    middleware_patterns = re.compile(
        r"(middleware|auth|session|jwt|token|passport|guard|interceptor)", re.I
    )
    business_patterns = re.compile(
        r"(order|payment|cart|basket|checkout|invoice|billing|price|discount|coupon|wallet|transfer)", re.I
    )
    data_patterns = re.compile(
        r"(model|repository|dao|service|database|db|query|schema)", re.I
    )
    config_patterns = re.compile(
        r"(config|settings?|secret|env|constant|key)", re.I
    )

    for rel in all_files:
        rel_lower = rel.lower()
        if "node_modules" in rel_lower or ".git" in rel_lower or "test" in rel_lower or "spec" in rel_lower:
            continue

        if route_patterns.search(rel_lower):
            categories["routes_and_controllers"].append(rel)
        elif middleware_patterns.search(rel_lower):
            categories["middleware_and_auth"].append(rel)
        elif business_patterns.search(rel_lower):
            categories["business_logic"].append(rel)
        elif data_patterns.search(rel_lower):
            categories["data_access"].append(rel)
        elif config_patterns.search(rel_lower):
            categories["config_and_secrets"].append(rel)

    return categories


def _relevant_vuln_types(slice_type: str) -> list[str]:
    mapping = {
        "routes_and_controllers": [
            "missing_auth", "missing_rate_limit", "missing_csrf",
            "idor", "privilege_escalation", "broken_object_level_auth",
            "mass_assignment", "ssrf_via_redirect",
        ],
        "middleware_and_auth": [
            "missing_auth", "jwt_algorithm_confusion",
            "broken_object_level_auth", "missing_rate_limit",
        ],
        "business_logic": [
            "business_logic_flaw", "privilege_escalation", "idor",
            "missing_auth", "mass_assignment", "insecure_deserialization",
        ],
        "data_access": [
            "idor", "broken_object_level_auth", "mass_assignment",
            "insecure_deserialization",
        ],
        "config_and_secrets": [
            "jwt_algorithm_confusion",
        ],
    }
    return mapping.get(slice_type, SEMANTIC_VULN_TYPES)


def _get_extra_context_hint(slice_type: str) -> str:
    hints = {
        "routes_and_controllers": (
            "Pay special attention to: routes without verifyToken/isAuthenticated middleware, "
            "POST/PUT/DELETE routes that accept req.body.userId (should come from session/JWT), "
            "and any route that does a DB lookup directly from req.params.id without verifying ownership."
        ),
        "middleware_and_auth": (
            "Look for JWT implementations that accept 'none' algorithm, "
            "missing CSRF token validation on state-changing routes, "
            "and middleware that can be bypassed with specific headers."
        ),
        "business_logic": (
            "Look for places where price/quantity comes from the request body (client-controlled), "
            "where discount codes can be applied multiple times, "
            "and where userId from req.body is used to access resources instead of session user."
        ),
        "data_access": (
            "Look for findById(req.params.id) without checking req.user.id === record.userId, "
            "bulk update/delete operations where the scope is user-controlled, "
            "and direct object references that expose other users' data."
        ),
        "config_and_secrets": (
            "Look for hardcoded secrets, weak JWT signing keys, "
            "and JWT verification that accepts multiple algorithms including 'none'."
        ),
    }
    return hints.get(slice_type, "")


def _parse_lifting_response(raw: str, files: list[str]) -> list[dict]:
    """
    Parse the LLM's JSON response into candidate dicts.
    Handles both array responses and wrapped {"candidates": [...]} responses.
    """
    raw = raw.strip()

    # Try to extract JSON array from the response
    # The LLM might wrap it or add prose
    for pattern in [
        r"\[\s*\{.*\}\s*\]",   # JSON array
        r"\{\s*\"candidates\"\s*:\s*(\[.*\])\s*\}",  # wrapped
        r"\{\s*\"vulnerabilities\"\s*:\s*(\[.*\])\s*\}",
    ]:
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            try:
                json_str = match.group(1) if match.lastindex else match.group(0)
                candidates = json.loads(json_str)
                if isinstance(candidates, list):
                    return _validate_candidates(candidates, files)
            except json.JSONDecodeError:
                pass

    # Last resort: try parsing the whole string
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return _validate_candidates(data, files)
        if isinstance(data, dict):
            for key in ("candidates", "vulnerabilities", "findings", "issues"):
                if key in data and isinstance(data[key], list):
                    return _validate_candidates(data[key], files)
    except json.JSONDecodeError:
        logger.debug(f"[SemanticLifting] Could not parse response: {raw[:200]}")

    return []


def _validate_candidates(raw_list: list, files: list[str]) -> list[dict]:
    """
    Validate and normalize candidate dicts from the LLM.
    Drops candidates with missing required fields.
    """
    valid = []
    for item in raw_list[:MAX_CANDIDATES_PER_SLICE]:
        if not isinstance(item, dict):
            continue
        if not item.get("vuln_type") or not item.get("file_path"):
            continue
        if not item.get("description"):
            continue

        # Normalize
        item.setdefault("line_start", 1)
        item.setdefault("line_end", item["line_start"])
        item.setdefault("severity", "medium")
        item.setdefault("confidence", "medium")
        item.setdefault("code_snippet", "")
        item.setdefault("fix_suggestion", "")
        item["source"] = "semantic_lifting"
        item["needs_llm_verification"] = True

        valid.append(item)
    return valid