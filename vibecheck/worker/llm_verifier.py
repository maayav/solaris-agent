"""
LLM verifier for Project VibeCheck.

Two-tier verification:
- TIER 1: OpenRouter (cloud primary - reliable and fast)
- TIER 2: Ollama (local fallback - when cloud is unavailable)

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

    TIER 1 — OpenRouter (cloud primary):
      - Primary: Fast, reliable cloud LLM via OpenRouter
      - If call fails or returns low confidence, escalate to TIER 2

    TIER 2 — Ollama (local fallback):
      - Fallback: Local Ollama instance when cloud is unavailable
      - Model: qwen2.5-coder:7b-instruct or configured coder model

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

    # TIER 1: Try OpenRouter first (cloud primary)
    logger.info("  >> TIER 1: Calling OpenRouter for verification...")
    tier1_result = await _verify_with_openrouter(
        snippet=snippet,
        vuln_type=vuln_type,
        rule_id=rule_id,
        settings=settings,
    )
    
    # Log TIER 1 result summary
    if tier1_result:
        logger.info(f"  [TIER 1] ✓ OpenRouter → confirmed={tier1_result.get('confirmed')} confidence={tier1_result.get('confidence')}")
    else:
        logger.info("  [TIER 1] ✗ OpenRouter failed")

    # Check if we need to escalate to local fallback
    if tier1_result is None:
        # OpenRouter call failed, escalate to TIER 2 (Ollama fallback)
        logger.info("  [TIER 2] Escalating to Ollama fallback...")
        tier2_result = await _verify_with_ollama(
            snippet=snippet,
            vuln_type=vuln_type,
            rule_id=rule_id,
            settings=settings,
        )
        result = tier2_result
        if tier2_result:
            logger.info(f"  [TIER 2] ✓ Ollama → confirmed={tier2_result.get('confirmed')} confidence={tier2_result.get('confidence')}")
    elif _is_low_confidence(tier1_result.get("confidence")):
        # Low confidence, try Ollama as fallback
        logger.info("  [TIER 2] Low confidence, trying Ollama fallback...")
        tier2_result = await _verify_with_ollama(
            snippet=snippet,
            vuln_type=vuln_type,
            rule_id=rule_id,
            settings=settings,
        )
        result = tier2_result if tier2_result else tier1_result
        if tier2_result:
            logger.info(f"  [TIER 2] ✓ Ollama → confirmed={tier2_result.get('confirmed')} confidence={tier2_result.get('confidence')}")
        else:
            logger.info("  [TIER 2] ✗ Ollama failed, using TIER 1 result")
    else:
        logger.info("  [TIER 1] Using OpenRouter result")
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
        
        # BUG FIX: Handle empty/whitespace verification_reason
        reason = result.get("reason", "").strip()
        merged["verification_reason"] = reason if reason else f"{vuln_type} vulnerability detected in this code pattern"
        
        # BUG FIX: Handle empty/whitespace fix_suggestion
        fix = result.get("fix_suggestion", "").strip()
        if not fix:
            # Generate contextual fix suggestion based on vuln type
            fix = _generate_fallback_fix(vuln_type, snippet)
        merged["fix_suggestion"] = fix
        
        # NOTE: is_test_fixture is NOT set from LLM result - it's pre-set by semgrep_runner
        # Include severity if provided
        if result.get("severity"):
            merged["severity"] = result.get("severity")
    else:
        # Both tiers failed
        merged["confirmed"] = False
        merged["confidence"] = "low"
        merged["verification_reason"] = f"Unable to verify {vuln_type} - LLM analysis unavailable"
        merged["fix_suggestion"] = _generate_fallback_fix(vuln_type, snippet)

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


def _generate_fallback_fix(vuln_type: str, snippet: str) -> str:
    """Generate a contextual fallback fix suggestion when LLM fails to provide one.
    
    Args:
        vuln_type: Type of vulnerability
        snippet: Code snippet for context
        
    Returns:
        Fallback fix suggestion
    """
    fixes = {
        "sql_injection": "Use parameterized queries or prepared statements instead of string concatenation. For Sequelize: use Model.findOne({ where: { id: req.params.id } }). For raw queries: use db.query('SELECT * FROM users WHERE id = ?', [userId]).",
        "nosql_injection": "Sanitize user input before using in MongoDB queries. Avoid using $where with user input. Use explicit field comparisons instead of passing user objects directly to find().",
        "path_traversal": "Validate and sanitize file paths using path.normalize() and ensure the resolved path stays within the allowed directory. Use a whitelist of allowed filenames.",
        "command_injection": "Avoid using exec(), system(), or child_process.exec() with user input. If necessary, use parameterized commands with execFile() and pass arguments as an array.",
        "eval_injection": "Never use eval() with user input. Use JSON.parse() for parsing JSON, or implement a safe expression evaluator if needed.",
        "ssrf": "Validate and sanitize URLs before fetching. Use an allowlist of permitted domains. Avoid passing user-controlled URLs directly to fetch() or request libraries.",
        "open_redirect": "Validate redirect URLs against an allowlist of permitted destinations. Use path-based redirects instead of full URL redirects when possible.",
        "hardcoded_secret": "Move secrets to environment variables or a secure vault. Use process.env.SECRET_KEY instead of hardcoded values. Rotate any exposed credentials immediately.",
        "mass_assignment": "Explicitly whitelist allowed fields when updating models. Use Model.update({ allowedField: req.body.allowedField }) instead of spreading req.body.",
        "prototype_pollution": "Prevent prototype pollution by checking for __proto__, constructor, and prototype keys. Use Object.create(null) for maps or a library like lodash's _.set() with protection.",
        "security_misconfiguration": "Review and harden configuration settings. Disable debug mode in production. Set secure headers and follow security best practices for the framework.",
    }
    
    # Return specific fix or generic advice
    return fixes.get(vuln_type.lower(), "Review the code for security issues. Validate all user inputs, use parameterized queries, and follow the principle of least privilege.")


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
    prompt = f"""You are a security expert analyzing code for the specific vulnerability type: {vuln_type}.

TASK: Verify if the following code contains a {vuln_type} vulnerability.

Rule that detected this: {rule_id}

Code to analyze:
```
{snippet}
```

VULNERABILITY TYPE DEFINITIONS:
- sql_injection: User input directly used in SQL queries without parameterization
- nosql_injection: User input used in MongoDB/NoSQL queries in a dangerous way (e.g., $where with string concatenation, JSON.parse in where)
- nosql_where_injection: MongoDB $where with string concatenation - allows arbitrary JavaScript execution (e.g., {{$where: 'this.product == ' + req.body.id}})
- orm_operator_injection: JSON.parse(user_input) passed directly to where clause - allows operators like {{$gt: 0}} to bypass auth
- idor: Insecure Direct Object Reference - UserId from req.body/params used in query without ownership verification (e.g., {{where: UserId: req.body.UserId, UserId: req.body.UserId}} - simplified from {{where: {{UserId: {{UserId: req.body.UserId}}}}}})
- insecure_cookie: Cookie set without httpOnly flag - vulnerable to XSS theft
- weak_random_secret: Math.random() used for JWT secrets - not cryptographically secure
- prototype_pollution: User input used as object key allowing __proto__ or constructor injection
- path_traversal: User-controlled file paths that could access files outside intended directory (path.resolve with req.body)
- command_injection: User input passed to shell commands or exec functions
- eval_injection: User input passed to eval() or similar dynamic code execution
- ssrf: User-controlled URLs fetched by the server
- open_redirect: User-controlled redirect URLs without validation
- hardcoded_secret: API keys, passwords, or tokens in source code
- mass_assignment: User input spread directly into model updates without field whitelist
- security_misconfiguration: eval() usage, insecure configurations, debug mode in production

CRITICAL PATTERNS - Set confirmed=true for these:
1. IDOR: req.body.UserId OR req.body.id in where clauses without ownership verification (e.g., findOne({{where: {{UserId: req.body.UserId}}}}))
2. NoSQL $where: $where with string concatenation (e.g., {{$where: 'this.product == ' + req.body.id}})
3. JSON.parse in where: JSON.parse(req.params.id) passed directly to where clause
4. Insecure cookies: res.cookie('token', value) without httpOnly: true
5. Weak random for secrets: Math.random() used as JWT secret (e.g., secret: '' + Math.random())
6. Basket/Order IDOR: findOne({{where: {{id: req.params.id}}}}) without UserId ownership check

IMPORTANT INSTRUCTIONS:
1. ONLY confirm this finding if it ACTUALLY matches the {vuln_type} type above
2. If the code shows a DIFFERENT vulnerability type, set confirmed=false
3. If the code is SAFE (e.g., uses parameterized queries, validates input), set confirmed=false
4. Provide a SPECIFIC explanation referencing the exact code pattern found
5. Include a DETAILED fix suggestion with actual code examples

Respond with ONLY this JSON format:
{{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "reason": "Detailed explanation of what vulnerability was found or why it's safe",
  "fix_suggestion": "Specific code changes needed to fix this vulnerability",
  "severity": "critical/high/medium/low"
}}"""

    # DEBUG: Log summary only
    logger.debug(f"  [OLLAMA] Verifying with {settings.ollama_coder_model}")

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

            # Parse JSON response
            parsed = _parse_json_response(response_text)
            
            # Log summary only
            if parsed:
                logger.info(f"  [OLLAMA] ✓ {settings.ollama_coder_model} → confirmed={parsed.get('confirmed')} confidence={parsed.get('confidence')}")
            else:
                logger.info("  [OLLAMA] ✗ Failed to parse response")
            
            return parsed

    except httpx.HTTPStatusError as e:
        logger.warning(f"  [OLLAMA] API error: {e}")
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

    prompt = f"""You are a security expert analyzing code for the specific vulnerability type: {vuln_type}.

TASK: Verify if the following code contains a {vuln_type} vulnerability.

Rule that detected this: {rule_id}

Code to analyze:
```
{snippet}
```

VULNERABILITY TYPE DEFINITIONS:
- sql_injection: User input directly used in SQL queries without parameterization
- nosql_injection: User input used in MongoDB/NoSQL queries in a dangerous way (e.g., $where with string concatenation, JSON.parse in where)
- nosql_where_injection: MongoDB $where with string concatenation - allows arbitrary JavaScript execution (e.g., {{$where: 'this.product == ' + req.body.id}})
- orm_operator_injection: JSON.parse(user_input) passed directly to where clause - allows operators like {{$gt: 0}} to bypass auth
- idor: Insecure Direct Object Reference - UserId from req.body/params used in query without ownership verification (e.g., {{where: UserId: req.body.UserId, UserId: req.body.UserId}} - simplified from {{where: {{UserId: {{UserId: req.body.UserId}}}}}})
- insecure_cookie: Cookie set without httpOnly flag - vulnerable to XSS theft
- weak_random_secret: Math.random() used for JWT secrets - not cryptographically secure
- prototype_pollution: User input used as object key allowing __proto__ or constructor injection
- path_traversal: User-controlled file paths that could access files outside intended directory (path.resolve with req.body)
- command_injection: User input passed to shell commands or exec functions
- eval_injection: User input passed to eval() or similar dynamic code execution
- ssrf: User-controlled URLs fetched by the server
- open_redirect: User-controlled redirect URLs without validation
- hardcoded_secret: API keys, passwords, or tokens in source code
- mass_assignment: User input spread directly into model updates without field whitelist
- security_misconfiguration: eval() usage, insecure configurations, debug mode in production

CRITICAL PATTERNS - Set confirmed=true for these:
1. IDOR: req.body.UserId OR req.body.id in where clauses without ownership verification (e.g., findOne({{where: {{UserId: req.body.UserId}}}}))
2. NoSQL $where: $where with string concatenation (e.g., {{$where: 'this.product == ' + req.body.id}})
3. JSON.parse in where: JSON.parse(req.params.id) passed directly to where clause
4. Insecure cookies: res.cookie('token', value) without httpOnly: true
5. Weak random for secrets: Math.random() used as JWT secret (e.g., secret: '' + Math.random())
6. Basket/Order IDOR: findOne({{where: {{id: req.params.id}}}}) without UserId ownership check

IMPORTANT INSTRUCTIONS:
1. ONLY confirm this finding if it ACTUALLY matches the {vuln_type} type above
2. If the code shows a DIFFERENT vulnerability type, set confirmed=false
3. If the code is SAFE (e.g., uses parameterized queries, validates input), set confirmed=false
4. Provide a SPECIFIC explanation referencing the exact code pattern found
5. Include a DETAILED fix suggestion with actual code examples

Respond with ONLY this JSON format:
{{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "reason": "Detailed explanation of what vulnerability was found or why it's safe",
  "fix_suggestion": "Specific code changes needed to fix this vulnerability",
  "severity": "critical/high/medium/low"
}}"""

    # DEBUG: Log summary only
    logger.debug(f"  [OPENROUTER] Verifying with {settings.openrouter_primary_model}")

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
                            {"role": "system", "content": "You are a security expert. Respond only with valid JSON."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.0,
                        "max_tokens": 500,
                        "provider": {
                            "order": ["Together", "DeepInfra", "Fireworks", "Nebius"],
                            "allow_fallbacks": True,
                            "ignore": ["Cloudflare"]
                        }
                    },
                )
                response.raise_for_status()
                result = response.json()

                # Debug: Log the full response structure
                logger.debug(f"  [OPENROUTER] Response keys: {list(result.keys())}")
                
                # Check for errors in response
                if "error" in result:
                    logger.warning(f"  [OPENROUTER] API error with {model}: {result['error']}")
                    continue

                # Extract content from response
                choices = result.get("choices", [])
                if not choices:
                    logger.warning(f"  [OPENROUTER] No choices in response for {model}")
                    continue
                    
                message = choices[0].get("message", {})
                content = message.get("content", "")
                
                # Debug log
                logger.debug(f"  [OPENROUTER] Content length: {len(content)}, content preview: {content[:200] if content else 'EMPTY'}")
                
                if not content or not content.strip():
                    logger.warning(f"  [OPENROUTER] Empty response from {model}")
                    continue
                
                parsed = _parse_json_response(content)

                if parsed:
                    logger.info(f"  [OPENROUTER] ✓ {model} → confirmed={parsed.get('confirmed')} confidence={parsed.get('confidence')}")
                    return parsed
                else:
                    logger.warning(f"  [OPENROUTER] ✗ {model} - failed to parse response (content: {content[:200]}...)")

            except httpx.HTTPStatusError as e:
                logger.warning(f"  [OPENROUTER] API error with {model}: {e}")
                if e.response:
                    try:
                        error_body = e.response.json()
                        logger.warning(f"  [OPENROUTER] Error response: {error_body}")
                    except:
                        logger.warning(f"  [OPENROUTER] Error response text: {e.response.text[:500]}")
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
    if not text or not text.strip():
        logger.debug(f"  [JSON_PARSE] Empty text provided")
        return None
    
    text = text.strip()
    
    # Try direct parse
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Try to extract JSON from markdown code blocks
    try:
        # Match JSON in ```json ... ``` blocks
        import re
        # Try with explicit json tag first
        json_block_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', text)
        if not json_block_match:
            # Try without json tag
            json_block_match = re.search(r'```\s*(\{[\s\S]*?\})\s*```', text)
        if json_block_match:
            json_str = json_block_match.group(1)
            result = json.loads(json_str)
            if isinstance(result, dict):
                return result
    except (json.JSONDecodeError, AttributeError):
        pass

    # Try to extract JSON object boundaries
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            json_str = text[start:end]
            result = json.loads(json_str)
            if isinstance(result, dict):
                return result
    except json.JSONDecodeError:
        pass
    
    # Try to fix common JSON issues
    try:
        # Replace single quotes with double quotes
        fixed_text = text.replace("'", '"')
        result = json.loads(fixed_text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    logger.debug(f"  [JSON_PARSE] Failed to parse JSON (length: {len(text)}, preview: {text[:200]}...)")
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


async def embed_with_openrouter(text: str, settings: Any) -> list[float] | None:
    """
    Generate embedding using OpenRouter cloud API.
    
    Uses sentence-transformers/all-MiniLM-L6-v2 which is efficient
    and has broad provider support on OpenRouter.
    
    Args:
        text: Text to embed
        settings: Application settings
    
    Returns:
        Embedding vector or None if failed
    """
    if not settings.openrouter_api_key:
        logger.debug("OpenRouter API key not configured, skipping cloud embedding")
        return None
    
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": settings.openrouter_http_referer,
        "Content-Type": "application/json",
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/embeddings",
                headers=headers,
                json={
                    "model": "sentence-transformers/all-MiniLM-L6-v2",
                    "input": text,
                    "provider": {
                        "order": ["DeepInfra", "Novita", "Fireworks"],
                        "allow_fallbacks": True
                    }
                },
            )
            response.raise_for_status()
            result = response.json()
            
            # OpenAI-compatible response format
            embedding = result.get("data", [{}])[0].get("embedding")
            if embedding:
                logger.debug(f"Cloud embedding generated, dimensions: {len(embedding)}")
                return embedding
    except Exception as e:
        logger.debug(f"Cloud embedding failed: {e}")
    
    return None


async def embed_with_ollama(text: str) -> list[float]:
    """
    Generate embedding using Ollama nomic-embed-text with cloud fallback.

    Supports both old and new Ollama API endpoints:
    - New (Ollama 0.1.27+): POST /api/embed with {"model": ..., "input": ...}
    - Old: POST /api/embeddings with {"model": ..., "prompt": ...}
    
    Falls back to OpenRouter cloud embedding if Ollama is unavailable.

    Args:
        text: Text to embed

    Returns:
        Embedding vector (empty list if all methods fail)
    """
    settings = get_settings()

    # First try Ollama local embedding
    try:
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
                embedding = result.get("embedding", [])
                if embedding:
                    return embedding
    except Exception as e:
        logger.debug(f"Ollama embedding failed: {e}")

    # Fallback to cloud embedding via OpenRouter
    logger.debug("Ollama embedding unavailable, trying cloud fallback...")
    cloud_embedding = await embed_with_openrouter(text, settings)
    if cloud_embedding:
        logger.info("Pattern propagation using cloud embedding fallback")
        return cloud_embedding
    
    logger.warning("All embedding methods failed, pattern propagation skipped")
    return []
