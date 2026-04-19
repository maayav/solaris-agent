"""
LLM verifier for Project VibeCheck.

Two-tier verification:
- TIER 1: Ollama deepseek-coder-v2:16b (local)
- TIER 2: OpenRouter qwen/qwen3-235b-a22b:free (cloud escalation)

Also provides pattern propagation via Qdrant similarity search.

Week 3 Implementation.
"""

import json
import logging
from typing import Any

import httpx

from core.config import get_settings

logger = logging.getLogger(__name__)

# API timeouts
OLLAMA_TIMEOUT = 60.0
OPENROUTER_TIMEOUT = 120.0


async def verify_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    """
    Verify a vulnerability candidate using two-tier LLM verification.

    TIER 1 — Ollama qwen2.5-coder:7b-instruct (local):
      - If confidence == "low", escalate to TIER 2
      - If call fails, escalate to TIER 2

    TIER 2 — OpenRouter qwen/qwen3-235b-a22b:free (cloud):
      - Fallback to deepseek/deepseek-r1-0528:free if Qwen3 fails

    Args:
        candidate: Vulnerability candidate dict with:
            - vuln_type: Type of vulnerability
            - rule_id: Rule that triggered the finding
            - code_snippet: Code to analyze

    Returns:
        Merged candidate dict with:
            - confirmed: bool
            - confidence: "high"|"medium"|"low"
            - verification_reason: str
            - needs_llm_verification: False
            - is_test_fixture: bool (if detected)
    """
    settings = get_settings()

    vuln_type = candidate.get("vuln_type", "unknown")
    rule_id = candidate.get("rule_id", "unknown")
    snippet = candidate.get("code_snippet", "")
    file_path = candidate.get("file_path", "unknown")
    line_start = candidate.get("line_start", 0)

    # DEBUG: Log the incoming candidate
    logger.info("=" * 80)
    logger.info("LLM VERIFIER: Starting verification")
    logger.info(f"  File: {file_path}:{line_start}")
    logger.info(f"  Vuln Type: {vuln_type}")
    logger.info(f"  Rule ID: {rule_id}")
    logger.info(f"  Code Snippet (first 200 chars): {snippet[:200] if snippet else 'EMPTY'}...")
    logger.info("=" * 80)

    if not snippet:
        snippet = f"File: {candidate.get('file_path', 'unknown')}, Line: {candidate.get('line_start', 0)}"
        logger.warning(f"  No code snippet provided, using fallback: {snippet}")

    # TIER 1: Try Ollama first
    logger.info("  >> TIER 1: Calling Ollama for verification...")
    tier1_result = await _verify_with_ollama(
        snippet=snippet,
        vuln_type=vuln_type,
        rule_id=rule_id,
        settings=settings,
    )
    
    # DEBUG: Log TIER 1 result
    logger.info(f"  >> TIER 1 Result: {tier1_result}")

    # Check if we need to escalate
    if tier1_result is None:
        # Ollama call failed, escalate to TIER 2
        logger.info("  >> TIER 1 FAILED - Escalating to OpenRouter (TIER 2)")
        tier2_result = await _verify_with_openrouter(
            snippet=snippet,
            vuln_type=vuln_type,
            rule_id=rule_id,
            settings=settings,
        )
        result = tier2_result
        logger.info(f"  >> TIER 2 Result: {tier2_result}")
    elif _is_low_confidence(tier1_result.get("confidence")):
        # Low confidence, escalate to TIER 2
        logger.info("  >> TIER 1 LOW CONFIDENCE - Escalating to OpenRouter (TIER 2)")
        tier2_result = await _verify_with_openrouter(
            snippet=snippet,
            vuln_type=vuln_type,
            rule_id=rule_id,
            settings=settings,
        )
        result = tier2_result if tier2_result else tier1_result
        logger.info(f"  >> TIER 2 Result: {tier2_result}")
        logger.info(f"  >> Final result (TIER 2 or fallback): {result}")
    else:
        logger.info("  >> TIER 1 SUCCEEDED - Using TIER 1 result")
        result = tier1_result

    # Handle test fixture detection
    # NOTE: We no longer let the LLM determine is_test_fixture because it was
    # incorrectly flagging production code (like challengeUtils.solveIf) as test fixtures.
    # The is_test_fixture field is only set by semgrep_runner._is_test_fixture() 
    # which checks file PATH only, not code content.

    # Merge with original candidate
    merged = {**candidate}
    if result:
        merged["confirmed"] = result.get("confirmed", False)
        # Normalize confidence to string (high/medium/low)
        merged["confidence"] = _normalize_confidence(result.get("confidence"))
        merged["verification_reason"] = result.get("reason", "No reason provided")
        merged["fix_suggestion"] = result.get("fix_suggestion", "")
        # NOTE: is_test_fixture is NOT set from LLM result - it's pre-set by semgrep_runner
        # Include severity if provided
        if result.get("severity"):
            merged["severity"] = result.get("severity")
    else:
        # Both tiers failed
        merged["confirmed"] = False
        merged["confidence"] = "low"
        merged["verification_reason"] = "LLM verification failed"
        merged["fix_suggestion"] = ""

    merged["needs_llm_verification"] = False

    # BUG FIX: Post-verification severity escalation
    # Raw string interpolation into SQL/NoSQL queries = critical severity
    if merged.get("vuln_type") == "sql_injection":
        snippet = merged.get("code_snippet", "")
        # Patterns that indicate raw string interpolation (critical severity)
        critical_patterns = [
            "sequelize.query(`",       # Raw Sequelize query with template literal
            "sequelize.query('",       # Raw Sequelize query with string
            "$where: `",               # MongoDB $where with template literal
            "$where: '",               # MongoDB $where with string
            "db.query(",               # Direct database query
            "models.sequelize.query(", # Sequelize raw query
        ]
        if any(p in snippet for p in critical_patterns):
            merged["severity"] = "critical"
            logger.info(f"  >> ESCALATED severity to CRITICAL for raw SQL/NoSQL injection")

    # DEBUG: Log final merged result
    logger.info("-" * 80)
    logger.info("LLM VERIFIER: Final merged result:")
    logger.info(f"  Confirmed: {merged.get('confirmed')}")
    logger.info(f"  Confidence: {merged.get('confidence')}")
    logger.info(f"  Reason: {merged.get('verification_reason')}")
    logger.info(f"  Is Test Fixture: {merged.get('is_test_fixture')}")
    logger.info("-" * 80)

    return merged


def _is_low_confidence(confidence: Any) -> bool:
    """Check if confidence value indicates low confidence.
    
    Handles both float (0.0-1.0) and string (high/medium/low) formats.
    """
    if confidence is None:
        return True
    if isinstance(confidence, (int, float)):
        return float(confidence) < 0.5
    if isinstance(confidence, str):
        return confidence.lower() in ("low", "very low")
    return False


def _normalize_confidence(confidence: Any) -> str:
    """Normalize confidence to string format (high/medium/low).
    
    Handles both float (0.0-1.0) and string formats.
    """
    if confidence is None:
        return "medium"
    if isinstance(confidence, (int, float)):
        val = float(confidence)
        if val >= 0.8:
            return "high"
        elif val >= 0.5:
            return "medium"
        else:
            return "low"
    if isinstance(confidence, str):
        conf_lower = confidence.lower()
        if conf_lower in ("high", "very high"):
            return "high"
        elif conf_lower in ("low", "very low"):
            return "low"
        else:
            return "medium"
    return "medium"


async def _verify_with_ollama(
    snippet: str,
    vuln_type: str,
    rule_id: str,
    settings: Any,
) -> dict[str, Any] | None:
    """
    Verify using Ollama local LLM.

    Args:
        snippet: Code snippet to analyze
        vuln_type: Vulnerability type
        rule_id: Rule that triggered
        settings: Application settings

    Returns:
        Verification result dict or None on error
    """
    # Use "penetration tester" role for more aggressive analysis
    # Include severity field for better prioritization
    # NOTE: Removed is_test_fixture - the LLM was incorrectly flagging production code
    # as test fixtures based on patterns like "challengeUtils" in snippets
    prompt = f"""You are a penetration tester analyzing potential security vulnerabilities.

Analyze this code for security issues:

Vulnerability Type: {vuln_type}
Rule: {rule_id}
Code:
```
{snippet}
```

IMPORTANT CONTEXT FOR JUICE-SHOP CODE:
- Code containing "challengeUtils.solveIf()" or similar is PRODUCTION CODE, not a test fixture
- Sequelize/ORM queries with user-controlled WHERE clauses ARE vulnerable to SQL/NoSQL injection
- MongoDB $where clauses with string concatenation ARE NoSQL injection vulnerabilities
- User input includes: req.body, req.params, req.query, req.headers, req.cookies

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "fix_suggestion": "how to fix this vulnerability",
  "severity": "critical/high/medium/low"
}}"""

    # DEBUG: Log the prompt being sent
    logger.info("  [OLLAMA] Sending verification request...")
    logger.info(f"  [OLLAMA] Model: {settings.ollama_coder_model}")
    logger.info(f"  [OLLAMA] URL: {settings.ollama_base_url}/api/generate")
    logger.info(f"  [OLLAMA] Prompt (first 500 chars):\n{prompt[:500]}...")

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            response = await client.post(
                f"{settings.ollama_base_url}/api/generate",
                json={
                    "model": settings.ollama_coder_model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {
                        "temperature": 0.0,
                        "num_predict": 200,
                    },
                },
            )
            response.raise_for_status()
            result = response.json()
            response_text = result.get("response", "")

            # DEBUG: Log the raw response
            logger.info(f"  [OLLAMA] Raw response text (first 500 chars):\n{response_text[:500] if response_text else 'EMPTY'}...")

            # Parse JSON response
            parsed = _parse_json_response(response_text)
            
            # DEBUG: Log the parsed result
            logger.info(f"  [OLLAMA] Parsed result: {parsed}")
            
            return parsed

    except httpx.HTTPStatusError as e:
        logger.warning(f"  [OLLAMA] API error: {e}")
        logger.warning(f"  [OLLAMA] Response body: {e.response.text if hasattr(e, 'response') else 'N/A'}")
        return None
    except Exception as e:
        logger.warning(f"  [OLLAMA] Verification failed: {e}")
        return None


async def _verify_with_openrouter(
    snippet: str,
    vuln_type: str,
    rule_id: str,
    settings: Any,
) -> dict[str, Any] | None:
    """
    Verify using OpenRouter cloud LLM.

    Falls back to deepseek/deepseek-r1-0528:free if primary model fails.

    Args:
        snippet: Code snippet to analyze
        vuln_type: Vulnerability type
        rule_id: Rule that triggered
        settings: Application settings

    Returns:
        Verification result dict or None on error
    """
    if not settings.openrouter_api_key:
        logger.warning("  [OPENROUTER] API key not configured")
        return None

    prompt = f"""You are a penetration tester analyzing potential security vulnerabilities.

Analyze this code for security issues:

Vulnerability Type: {vuln_type}
Rule: {rule_id}
Code:
```
{snippet}
```

IMPORTANT CONTEXT FOR JUICE-SHOP CODE:
- Code containing "challengeUtils.solveIf()" or similar is PRODUCTION CODE, not a test fixture
- Sequelize/ORM queries with user-controlled WHERE clauses ARE vulnerable to SQL/NoSQL injection
- MongoDB $where clauses with string concatenation ARE NoSQL injection vulnerabilities
- User input includes: req.body, req.params, req.query, req.headers, req.cookies

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "fix_suggestion": "how to fix this vulnerability",
  "severity": "critical/high/medium/low"
}}"""

    # DEBUG: Log the prompt being sent
    logger.info("  [OPENROUTER] Sending verification request...")
    logger.info(f"  [OPENROUTER] URL: {settings.openrouter_base_url}/chat/completions")
    logger.info(f"  [OPENROUTER] Prompt (first 500 chars):\n{prompt[:500]}...")

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": settings.openrouter_http_referer,
        "Content-Type": "application/json",
    }

    # Try primary model first, then fallback (from config)
    models_to_try = [
        settings.openrouter_primary_model,
        settings.openrouter_fallback_model,
    ]
    
    logger.info(f"  [OPENROUTER] Models to try: {models_to_try}")

    async with httpx.AsyncClient(timeout=OPENROUTER_TIMEOUT) as client:
        for model in models_to_try:
            logger.info(f"  [OPENROUTER] Trying model: {model}")
            try:
                response = await client.post(
                    f"{settings.openrouter_base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [
                            {"role": "user", "content": prompt}
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.0,
                        "max_tokens": 200,
                    },
                )
                response.raise_for_status()
                result = response.json()

                # DEBUG: Log the raw response
                logger.info(f"  [OPENROUTER] Raw response: {result}")

                # Extract content from response
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                logger.info(f"  [OPENROUTER] Extracted content (first 500 chars):\n{content[:500] if content else 'EMPTY'}...")
                
                parsed = _parse_json_response(content)
                logger.info(f"  [OPENROUTER] Parsed result: {parsed}")

                if parsed:
                    logger.info(f"  [OPENROUTER] SUCCESS with model: {model}")
                    return parsed

            except httpx.HTTPStatusError as e:
                logger.warning(f"  [OPENROUTER] API error with {model}: {e}")
                logger.warning(f"  [OPENROUTER] Response body: {e.response.text if hasattr(e, 'response') else 'N/A'}")
                continue
            except Exception as e:
                logger.warning(f"  [OPENROUTER] Verification failed with {model}: {e}")
                continue

    logger.warning("  [OPENROUTER] All models failed")
    return None


def _parse_json_response(text: str) -> dict[str, Any] | None:
    """
    Parse JSON from LLM response.

    Handles cases where the response might have extra text.

    Args:
        text: Raw response text

    Returns:
        Parsed dict or None
    """
    logger.info(f"  [JSON_PARSE] Attempting to parse response (length: {len(text)})")
    
    try:
        # Try direct parse
        result = json.loads(text)
        logger.info(f"  [JSON_PARSE] Direct parse succeeded")
        logger.info(f"  [JSON_PARSE] Parsed keys: {list(result.keys()) if isinstance(result, dict) else 'not a dict'}")
        return result
    except json.JSONDecodeError as e:
        logger.warning(f"  [JSON_PARSE] Direct parse failed: {e}")

    # Try to extract JSON from text
    try:
        # Find JSON object boundaries
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = text[start:end]
            logger.info(f"  [JSON_PARSE] Extracted JSON substring (length: {len(json_str)})")
            result = json.loads(json_str)
            logger.info(f"  [JSON_PARSE] Extracted parse succeeded")
            logger.info(f"  [JSON_PARSE] Parsed keys: {list(result.keys()) if isinstance(result, dict) else 'not a dict'}")
            return result
    except json.JSONDecodeError as e:
        logger.warning(f"  [JSON_PARSE] Extracted parse failed: {e}")

    logger.warning(f"  [JSON_PARSE] FAILED - Could not parse JSON from response")
    logger.warning(f"  [JSON_PARSE] Response text (first 200 chars): {text[:200]}...")
    return None


async def propagate_pattern(
    confirmed_candidate: dict[str, Any],
    qdrant_client: Any,
    embed_fn: Any,
) -> list[dict[str, Any]]:
    """
    Propagate a confirmed vulnerability pattern to find similar functions.

    1. Embeds the confirmed candidate's code_snippet
    2. Searches Qdrant function_summaries collection, top_k=20
    3. Returns list of similar function locations for follow-up verification

    Args:
        confirmed_candidate: Confirmed vulnerability dict
        qdrant_client: QdrantClient instance
        embed_fn: Async embedding function

    Returns:
        List of similar function locations with scores
    """
    from qdrant_client.http import models
    from qdrant_client.http.exceptions import UnexpectedResponse

    snippet = confirmed_candidate.get("code_snippet", "")
    if not snippet:
        logger.warning("No code snippet to propagate")
        return []

    try:
        # Get embedding for the snippet
        vector = await embed_fn(snippet)

        # Check if collection exists first
        try:
            collection_info = qdrant_client.get_collection("function_summaries")
            if collection_info.points_count == 0:
                logger.debug("function_summaries collection is empty, skipping propagation")
                return []
        except UnexpectedResponse as e:
            if "Not found" in str(e) or "doesn't exist" in str(e):
                logger.debug("function_summaries collection doesn't exist, skipping propagation")
                return []
            raise

        # Search for similar functions
        results = qdrant_client.search(
            collection_name="function_summaries",
            query_vector=vector,
            limit=20,
            score_threshold=0.75,
        )

        similar_functions = []
        for result in results:
            # Skip if it's the same file/line
            if (
                result.payload.get("file") == confirmed_candidate.get("file_path")
                and result.payload.get("line_start") == confirmed_candidate.get("line_start")
            ):
                continue

            similar_functions.append({
                "file_path": result.payload.get("file"),
                "line_start": result.payload.get("line_start"),
                "line_end": result.payload.get("line_end"),
                "function_name": result.payload.get("name"),
                "similarity_score": result.score,
                "source_vuln_type": confirmed_candidate.get("vuln_type"),
            })

        logger.info(f"Found {len(similar_functions)} similar functions for pattern propagation")
        return similar_functions

    except Exception as e:
        # Log at debug level since propagation is optional enhancement
        logger.debug(f"Pattern propagation skipped: {e}")
        return []


async def embed_with_ollama(text: str) -> list[float]:
    """
    Generate embedding using Ollama nomic-embed-text.

    Supports both old and new Ollama API endpoints:
    - New (Ollama 0.1.27+): POST /api/embed with {"model": ..., "input": ...}
    - Old: POST /api/embeddings with {"model": ..., "prompt": ...}

    Args:
        text: Text to embed

    Returns:
        Embedding vector
    """
    settings = get_settings()

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Try new /api/embed endpoint first (Ollama 0.1.27+)
        try:
            response = await client.post(
                f"{settings.ollama_base_url}/api/embed",
                json={
                    "model": settings.ollama_embed_model,
                    "input": text,
                },
            )
            response.raise_for_status()
            result = response.json()
            # New API returns {"embeddings": [[...], ...]}
            embeddings = result.get("embeddings", [])
            if embeddings and len(embeddings) > 0:
                return embeddings[0]
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                raise
            # Fall back to old /api/embeddings endpoint
            logger.debug("/api/embed not available, falling back to /api/embeddings")
            response = await client.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={
                    "model": settings.ollama_embed_model,
                    "prompt": text,
                },
            )
            response.raise_for_status()
            result = response.json()
            # Old API returns {"embedding": [...]}
            return result.get("embedding", [])
        
        return []
