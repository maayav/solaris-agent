"""
llm_verifier_patch.py — Upgrade patch for existing llm_verifier.py

This file shows the EXACT changes needed to make verify_candidate()
accept and use multi-file context from MultiFileContextBuilder.

HOW TO APPLY:
  1. Add the import at the top of llm_verifier.py
  2. Update the verify_candidate() signature to accept an optional `file_context` param
  3. Replace the prompt building section with the new multi-context prompt
  4. The rest of the two-tier OpenRouter/Ollama logic stays the same

The key change: the LLM now sees the FULL function body + related files,
not just the narrow code_snippet Semgrep extracted.
"""

from __future__ import annotations

# === ADD THIS IMPORT AT TOP OF llm_verifier.py ===
# from worker.multi_file_context_builder import FileContext


# === REPLACE THE verify_candidate() FUNCTION SIGNATURE ===

async def verify_candidate_upgraded(
    candidate: dict,
    file_context=None,  # Optional[FileContext] — pass from scan_worker
) -> dict:
    """
    Drop-in replacement for verify_candidate() with multi-file context support.
    
    If file_context is provided (FileContext from MultiFileContextBuilder),
    the LLM receives:
      - The full function body (not just the snippet)
      - Middleware chain applied before this handler
      - Source of directly related files (importers, imports)
      - Cross-file dataflow hints
    
    If file_context is None, falls back to snippet-only behavior (backward compat).
    """
    # These imports exist in your actual llm_verifier.py already:
    # from core.config import get_settings
    # import httpx, json, logging
    pass


# === REPLACE THE PROMPT BUILDING SECTION IN _build_verification_prompt() ===
# (or wherever you currently build the user prompt)

def build_multi_context_prompt(
    candidate: dict,
    file_context=None,  # Optional[FileContext]
    model_name: str = "unknown",
    model_instructions: str = "",
) -> str:
    """
    Build the LLM verification prompt with full multi-file context.
    
    Replaces the existing single-snippet prompt with a richer context-aware version.
    """
    vuln_type = candidate.get("vuln_type", "unknown")
    rule_id = candidate.get("rule_id", "unknown")
    file_path = candidate.get("file_path", "unknown")
    line_start = candidate.get("line_start", 0)
    source = candidate.get("source", "semgrep")

    # Build the code context section
    if file_context and file_context.full_function_src:
        # Rich multi-file context available
        code_context = f"""FLAGGED LOCATION: {file_path}:{line_start}
DETECTION SOURCE: {source}
RULE: {rule_id}

FULL FUNCTION CONTAINING THE FINDING:
```typescript
{file_context.full_function_src}
```"""

        if file_context.middleware_chain:
            code_context += f"""

MIDDLEWARE CHAIN (applied before this handler):
{chr(10).join(f"  - {mw}" for mw in file_context.middleware_chain)}"""
        else:
            code_context += "\n\nMIDDLEWARE CHAIN: (none detected — may be missing auth/rate-limit)"

        if file_context.related_sources:
            code_context += "\n\nRELATED FILES (imports / callers):"
            for rpath, rsrc in list(file_context.related_sources.items())[:3]:
                code_context += f"\n\n--- {rpath} ---\n```\n{rsrc[:2000]}\n```"

    else:
        # Fallback: snippet-only (existing behavior)
        snippet = candidate.get("code_snippet", "")
        code_context = f"""FLAGGED LOCATION: {file_path}:{line_start}
DETECTION SOURCE: {source}
RULE: {rule_id}

CODE SNIPPET:
```
{snippet}
```"""

    prompt = f"""You are {model_name} — security expert specializing in Node.js/TypeScript vulnerability detection.

{model_instructions}

VULNERABILITY TO VERIFY:
Type: {vuln_type}

{code_context}

CRITICAL VERIFICATION RULES:
1. IDOR/BOLA: req.body.userId used for DB lookup without checking it matches req.user.id → TRUE POSITIVE
2. MongoDB $where with string concatenation → TRUE POSITIVE (server-side JS eval)
3. JSON.parse(req.params.id) fed into ORM → TRUE POSITIVE (operator injection risk)
4. Sequelize {{where: {{field: scalar_value}}}} → FALSE POSITIVE (parameterized)
5. fs.createReadStream(path, {{start, end}}) where path is server-determined → FALSE POSITIVE for path traversal
6. Missing auth middleware: if no verifyToken/isAuthenticated in the middleware chain above → TRUE POSITIVE
7. req.body.UserId passed to multi-record update/delete → CRITICAL (mass data manipulation)

BEHAVIORAL ANALYSIS REQUIRED:
- Trace the data flow from user input to the dangerous sink
- Check if sanitization is complete and cannot be bypassed
- Consider the middleware chain — is auth applied before this handler?
- Consider if the issue exists in a different form than the rule flagged

Respond with ONLY this JSON (no other text):
{{
  "confirmed": true/false,
  "confidence": "high"/"medium"/"low",
  "reason": "precise technical explanation with line references",
  "fix_suggestion": "specific remediation code or approach",
  "severity": "critical"/"high"/"medium"/"low",
  "false_positive_reason": "why this is a false positive (if applicable, else null)",
  "behavioral_notes": "any additional behavioral/logical issues noticed beyond the flagged finding"
}}"""

    return prompt


# === UPDATE scan_worker.py (main.py) — HOW TO PASS CONTEXT ===
# 
# In the LLM verification batch loop, change:
#
#   OLD:
#   tasks = [verify_candidate(c) for c in batch]
#
#   NEW:
#   tasks = [
#       verify_candidate(c, file_context=context_builder.get_context(c))
#       for c in batch
#   ]
#
# And in _verify_with_openrouter / _verify_with_ollama, pass the prompt
# from build_multi_context_prompt() instead of the old single-snippet prompt.


# === UPDATED _verify_with_openrouter SIGNATURE ===
# Change the internal function to accept the pre-built prompt:
#
# async def _verify_with_openrouter(
#     prompt: str,          # ← now accepts full multi-context prompt
#     settings: Any,
# ) -> dict | None:
#     ...
#     messages = [
#         {"role": "system", "content": "You are a security expert..."},
#         {"role": "user", "content": prompt},   # ← use the full prompt
#     ]


# =====================================================================
# CONCRETE INTEGRATION EXAMPLE
# Show the exact code block to replace in scan_worker._run_llm_verification
# =====================================================================

SCAN_WORKER_PATCH = '''
# In scan_worker.py, add these imports at the top:
from worker.multi_file_context_builder import MultiFileContextBuilder
from worker.semantic_lifting_agent import SemanticLiftingAgent
from worker.behavioral_flow_analyzer import BehavioralFlowAnalyzer

# In the scan pipeline, AFTER Tree-Sitter parsing and BEFORE Semgrep:

async def _run_blue_team_pipeline(self, scan_id, repo_dir, file_index):
    """
    Full upgraded blue team pipeline.
    Replaces the old: semgrep → llm_verify flow.
    New flow: semgrep + semantic_lifting → multi-file context → llm_verify → behavioral_analysis
    """
    
    # ── Stage 1: Build cross-file context index (once per scan) ──────────
    logger.info("[Pipeline] Building cross-file context index...")
    context_builder = MultiFileContextBuilder(
        repo_dir=repo_dir,
        file_index=file_index,    # from Tree-Sitter stage
    )
    context_builder.build_index()  # ~0.5-2s
    
    # ── Stage 2: Semgrep static analysis (existing) ───────────────────────
    semgrep_candidates = await self._run_semgrep(repo_dir, scan_id)
    logger.info(f"[Pipeline] Semgrep: {len(semgrep_candidates)} candidates")
    
    # ── Stage 3: Semantic lifting (new) ───────────────────────────────────
    lifting_agent = SemanticLiftingAgent(
        repo_dir=repo_dir,
        file_index=file_index,
    )
    lifting_candidates = await lifting_agent.run()
    logger.info(f"[Pipeline] Semantic lifting: {len(lifting_candidates)} candidates")
    
    # Merge and dedup all candidates
    all_candidates = semgrep_candidates + lifting_candidates
    seen_keys = set()
    deduped = []
    for c in all_candidates:
        key = (c.get("file_path"), c.get("line_start"), c.get("vuln_type"))
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(c)
    logger.info(f"[Pipeline] Total candidates after dedup: {len(deduped)}")
    
    # ── Stage 4: LLM verification with multi-file context (upgraded) ──────
    from worker.llm_verifier import verify_candidate
    from worker.llm_verifier_patch import build_multi_context_prompt
    
    verified_vulns = []
    all_verified = []
    BATCH_SIZE = 5
    
    for i in range(0, len(deduped), BATCH_SIZE):
        batch = deduped[i:i + BATCH_SIZE]
        # Build context for each candidate in the batch
        batch_with_ctx = [
            (c, context_builder.get_context(c)) for c in batch
        ]
        tasks = [
            verify_candidate(c, file_context=ctx) 
            for c, ctx in batch_with_ctx
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"[Pipeline] Verification error: {result}")
                continue
            all_verified.append(result)
            if result.get("confirmed"):
                verified_vulns.append(result)
        
        # Update scan progress
        progress = 50 + int(((i + BATCH_SIZE) / len(deduped)) * 35)
        await self._update_scan_progress(scan_id, min(progress, 85))
    
    logger.info(f"[Pipeline] Verified: {len(verified_vulns)} confirmed / {len(all_verified)} total")
    
    # ── Stage 5: Behavioral flow analysis (new) ───────────────────────────
    behavioral_analyzer = BehavioralFlowAnalyzer(
        repo_dir=repo_dir,
        context_builder=context_builder,
    )
    confirmed_file_paths = {v.get("file_path") for v in verified_vulns}
    behavioral_findings = await behavioral_analyzer.run(
        candidates=all_verified,
        already_confirmed_files=confirmed_file_paths,
    )
    
    # Behavioral findings are already confirmed — add them directly
    verified_vulns.extend(behavioral_findings)
    all_verified.extend(behavioral_findings)
    logger.info(
        f"[Pipeline] Behavioral pass added {len(behavioral_findings)} additional findings. "
        f"Total confirmed: {len(verified_vulns)}"
    )
    
    await self._update_scan_progress(scan_id, 95)
    return verified_vulns, all_verified
'''