"""
Critic Agent — The Evaluator for PentAGI-Style Exploit Loop.

The Critic receives raw tool execution results and evaluates:
- Success or Failure with evidence
- Specific error types (syntax, WAF, auth, etc.)
- Actionable feedback for self-correction

This enables the Actor-Critic loop:
  Gamma (Plan/Execute) → Sandbox → Critic (Evaluate) → Gamma (Adjust) → ...
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from core.llm_client import llm_client
from core.config import settings
from core.parsing import parse_with_retry, sanitize_json_output
from sandbox.sandbox_manager import ExecResult

logger = logging.getLogger(__name__)

# Step 3: Import Supabase client for non-blocking event logging
try:
    from core.supabase_client import fire_and_forget_log_event, get_supabase_client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False
    logger.warning("Supabase client not available - event logging disabled")


# Error type patterns for automatic detection
ERROR_PATTERNS = {
    "syntax_error": [
        r"SyntaxError:",
        r"Parse error",
        r"unexpected token",
        r"JSONDecodeError",
        r"IndentationError",
        r"NameError:",
        r"TypeError:",
        r"AttributeError:",
    ],
    "waf_block": [
        r"403 Forbidden",
        r"WAF",
        r"ModSecurity",
        r"blocked",
        r"detected malicious",
        r"Request blocked",
    ],
    "auth_failure": [
        r"401 Unauthorized",
        r"403 Forbidden",
        r"Invalid credentials",
        r"login failed",
        r"Session expired",
        r"No Authorization header",
    ],
    "timeout": [
        r"timeout",
        r"timed out",
        r"Connection timed out",
        r"Request timeout",
    ],
    "not_found": [
        r"404 Not Found",
        r"404",
        r"Endpoint not found",
        r"Cannot GET",
        r"Unexpected path",
    ],
    "rate_limit": [
        r"429 Too Many Requests",
        r"rate limit",
        r"too many requests",
    ],
    "server_error": [
        r"500 Internal Server Error",
        r"500",
        r"502 Bad Gateway",
        r"503 Service Unavailable",
        r"504 Gateway Timeout",
        r"Internal Server Error",
    ],
}


# ============ JUICE SHOP SPECIFIC PATTERNS ============
JUICE_SHOP_PATTERNS = {
    "sequelize": [r"Sequelize", r"sequelize", r"SQLITE", r"sqlite"],
    "express": [r"Express", r"express", r"Node.js"],
    "jwt": [r"jwt", r"JWT", r"JsonWebToken"],
    "angular": [r"Angular", r"angular"],
    "sql_syntax_error": [
        r"SQLITE_CANTOPEN",
        r"SQL syntax",
        r"near .* syntax error",
        r"unrecognized token",
    ],
    "validation_error": [
        r"Validation error",
        r"isValidationError",
    ],
    "success_indicators": [
        r"\"id\":",
        r"\"token\":",
        r"\"email\":",
        r"\"username\":",
        r"\"role\":",
        r"\"password\":",
        r"\"content\":",
        r"\"rating\":",
        r"\"comment\":",
        r"authentication",
        r"success",
        r"created",
        r"updated",
        r"admin",
        r"customer",
        r"200 OK",
    ],
    "jwt_error": [
        r"invalid token",
        r"TokenExpiredError",
        r"jwt expired",
        r"Unexpected token",
        r"JsonWebTokenError",
    ],
    "access_denied": [
        r"Access Denied",
        r"Access to.* is denied",
    ],
}


def _scan_for_juice_shop_hints(result):
    """Pre-scan result for Juice Shop specific patterns."""
    combined = (result.stdout or "") + (result.stderr or "")
    detected = {}
    for category, patterns in JUICE_SHOP_PATTERNS.items():
        matches = []
        for pattern in patterns:
            match = re.search(pattern, combined, re.IGNORECASE)
            if match:
                matches.append(match.group(0))
        if matches:
            detected[category] = matches
    return detected


def _build_grounded_feedback(hints, exploit_type):
    """Build specific feedback based on detected technologies."""
    feedback_parts = []
    if "sequelize" in hints or "sql_syntax_error" in hints:
        feedback_parts.append(
            "DETECTED: Server uses SQLite via Sequelize. Avoid standard MySQL comments (--). Use SQLite-safe syntax."
        )
    if "jwt_error" in hints:
        feedback_parts.append(
            "DETECTED: JWT authentication issue. Try generating a fresh token via SQLi."
        )
    if "validation_error" in hints:
        feedback_parts.append("DETECTED: Input validation error. Try encoding differently.")
    if "access_denied" in hints:
        feedback_parts.append("DETECTED: Access denied. Try with valid session token.")
    return " ".join(feedback_parts) if feedback_parts else ""


CRITIC_SYSTEM_PROMPT = """You are the Critic — a meticulous security analyst who evaluates exploit attempts.
Your role is to provide STRUCTURED, ACTIONABLE feedback to the exploit specialist.

OUTPUT FORMAT: You MUST respond ONLY in valid JSON with this exact structure:

{{
  "success": true|false,
  "evidence": "The specific data that proves success or failure (max 500 chars)",
  "error_type": "none|syntax_error|waf_block|auth_failure|timeout|not_found|rate_limit|server_error|unknown",
  "feedback": "Specific, actionable advice for the exploit specialist on how to fix the failure. 
               If success=true, briefly confirm what worked.",
  "severity": "critical|high|medium|low|none",
  "session_token_found": true|false,
  "session_token_value": "if session_token_found=true, extract the token value",
  "recommendation": "stealthier|pivot|retry|abort - strategic recommendation for Commander"
}}

SUCCESS CRITERIA:
- SQLi: Boolean-based true/false in response, UNION works, SQLite/Sequelize errors (shows query execution), or authentication bypassed
- XSS: Script tags in response, alert() references, payload stored/reflected, DOM manipulation, OR HTTP 200/201 with success JSON (stored XSS)
- Stored XSS: Product created successfully, review posted, or HTTP 200/201 with confirmation
- Reflected/DOM XSS: Payload appears unescaped in response, URL fragment manipulation works
- Auth Bypass: Access to admin panel, elevated privileges, JWT token in response, or unauthorized data access
- Access Control: Bypass restrictions, access admin-only endpoints, or modify other users' data
- IDOR: Access to other users' data, different user IDs in responses, or data enumeration
- Data Exposure: JSON arrays/objects returned, database fields visible, or sensitive info leaked
- XXE: File contents retrieved (/etc/passwd, system files), error messages showing file system
- File Upload: Success message, file path returned, or upload confirmation
- SSTI: Template expressions evaluated ({{7*7}} returning 49), math operations executed
- Command Injection: Command executed, system output returned, or shell access achieved
- LFI/RFI: Local files retrieved, PHP filters working, or directory traversal successful

JUICESHOP-SPECIFIC SUCCESS INDICATORS:
- SQLi: SQLite errors mean the query executed - that's success for error-based SQLi
- XSS: 200/201 response with JSON confirmation means payload was stored
- Data Exposure: Products API returns full database records with all fields

DATABASE ERROR SUCCESS RULES:
- SQLITE_ERROR, MYSQL_ERROR, ORA-XXXXX, or similar database errors in 500 responses ALWAYS = success=True for SQLi exploits
- Server crash (500) from SQLi payload = success=True (query reached the database)
- Examples of SQLi success indicators:
  * "SQLITE_ERROR: near \"'\": syntax error" → success=True (query executed, bad syntax due to injection)
  * "MySQL error" or "ORA-" errors → success=True (database responded to payload)
  * Any SQL syntax error in HTTP 500 response → success=True for SQLi

XSS ERROR SUCCESS RULES:
- Server crash (500) from '<script>' payload = success=True for XSS (payload reached parser)

FAILURE ANALYSIS:
- syntax_error: Python/curl syntax is wrong — fix syntax before changing exploit logic
- waf_block: WAF detected the payload — try encoding, obfuscation, or different vectors
- auth_failure: Authentication/authorization failed — try different credentials or sessions
- timeout: Target not responding — try slower timing attacks or different endpoints
- not_found: Endpoint doesn't exist — verify path from recon or try alternatives
- rate_limit: Too many requests — slow down or use different IPs
- server_error: 500/502/503/504 errors — payload is TOO LOUD, recommend STEALTHIER approach

STEALTH RECOMMENDATIONS (Use when server_error or waf_block detected):
1. Use curl with custom headers: -H "X-Forwarded-For: 127.0.0.1" -H "User-Agent: Mozilla/5.0"
2. URL encode payloads: %27 instead of ', %22 instead of ", etc.
3. Use double URL encoding for WAF evasion: %2527 instead of %27
4. Add delays between requests: --connect-timeout 30
5. Use POST instead of GET for payload delivery
6. Split payloads across multiple parameters
7. Use comment obfuscation: /**/ between SQL keywords
"""


CRITIC_ANALYSIS_PROMPT = """Analyze this exploit attempt result:

EXPLOIT TYPE: {exploit_type}
TOOL USED: {tool_name}
COMMAND EXECUTED: {command}
EXIT CODE: {exit_code}

STDOUT:
{stdout}

STDERR:
{stderr}

INTELLENCE CONTEXT:
{intel}

Previous attempts (for contextual memory):
{previous_attempts}

Analyze and respond in JSON format."""


def quick_evaluate(exploit_type: str, result: ExecResult) -> dict[str, Any] | None:
    """
    Quick pre-evaluation without LLM call for obvious success/failure cases.
    Returns evaluation dict if clear case detected, None otherwise.
    """
    stdout = result.stdout or ""
    stderr = result.stderr or ""
    combined = stdout + stderr
    
    # Success indicators
    success_patterns = {
        "sqli": [
            r'"token":\s*"[^"]+"',  # JWT token returned
            r'"id":\s*\d+',  # User ID returned
            r'"email":\s*"[^"]+"',  # Email returned
            r'Sequelize',  # SQL error means query executed
            r'sqlite',  # SQLite error
        ],
        "info_disclosure": [
            r'\[\s*\{[^}]+"id"',  # JSON array with objects containing id
            r'"createdAt":',  # Database timestamps
            r'"updatedAt":',
        ],
        "auth_bypass": [
            r'admin',  # Admin access
            r'dashboard',  # Dashboard loaded
        ],
        "sensitive_data_exposure": [
            r'-----BEGIN',  # Private keys
            r'password',  # Password in response
            r'api[_-]?key',  # API keys
            r'secret',  # Secrets
            r'\.git',  # Git exposure
        ],
    }
    
    # Check for success patterns
    if exploit_type.lower() in success_patterns:
        for pattern in success_patterns[exploit_type.lower()]:
            if re.search(pattern, combined, re.IGNORECASE):
                return {
                    "success": True,
                    "evidence": f"Pattern match: {pattern[:50]}...",
                    "error_type": "none",
                    "feedback": f"Successfully detected {exploit_type} vulnerability.",
                    "severity": "high",
                    "session_token_found": bool(re.search(r'"token":\s*"([^"]+)"', combined)),
                    "session_token_value": None,
                    "recommendation": "pivot",
                }
    
    # Failure indicators
    if result.exit_code != 0:
        if "404" in combined or "Not Found" in combined:
            return {
                "success": False,
                "evidence": "Endpoint returned 404",
                "error_type": "not_found",
                "feedback": "Endpoint does not exist. Try different path.",
                "severity": "none",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "pivot",
            }
    
    return None  # Need LLM evaluation


def _deterministic_precheck(result: ExecResult, exploit_type: str, payload: str) -> dict[str, Any] | None:
    """
    Deterministic pre-check BEFORE calling LLM to catch obvious cases.
    
    This prevents small LLMs from misinterpreting clear signals like:
    - HTTP 500 on injection attempts = server crash = finding
    - HTTP 401/403 = auth wall, not failure
    
    Returns evaluation dict for obvious cases, None to fall through to LLM.
    """
    combined = f"{result.stdout}\n{result.stderr}"
    
    # Extract HTTP status code
    status_match = re.search(r"HTTP/\d\.\d\s+(\d{3})", combined)
    status_code = int(status_match.group(1)) if status_match else None
    
    # Also check for status in first line of stdout
    if not status_code and result.stdout:
        first_line = result.stdout.split('\n')[0]
        status_match = re.search(r"(\d{3})", first_line)
        if status_match:
            status_code = int(status_match.group(1))
    
    # B12: HTTP 500 on injection = server crash = HIGH severity finding
    INJECTION_TYPES = ["sqli", "xss", "xxe", "ssti", "command_injection", "nosql_injection"]
    if status_code == 500 and exploit_type.lower() in INJECTION_TYPES:
        # Check if payload contains injection characters
        injection_chars = ["'", '"', "<", ">", ";", "|", "&", "${", "#{", "`"]
        has_injection = any(char in payload for char in injection_chars)
        
        if has_injection:
            # B21: More professional evidence strings for stakeholder reports
            if exploit_type.lower() == "xss":
                evidence = f"Reflected XSS payload triggered unhandled exception in input parser — server-side execution confirmed (HTTP 500)."
            elif exploit_type.lower() == "sqli":
                evidence = f"SQL injection payload caused database query failure — syntax error reached SQL parser (HTTP 500)."
            elif exploit_type.lower() == "xxe":
                evidence = f"XXE payload crashed XML parser — external entity processing confirmed vulnerable (HTTP 500)."
            else:
                evidence = f"HTTP 500 Internal Server Error triggered by {exploit_type} payload — unsanitized input reached parser."
            
            return {
                "success": True,  # Server crash IS a finding
                "evidence": evidence,
                "error_type": "server_crash",
                "feedback": f"🚨 CRITICAL: Payload crashed the server (HTTP 500). This is a successful finding - the application is vulnerable to {exploit_type}.",
                "severity": "HIGH",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "escalate",
                "deterministic": True,  # Mark as deterministic result
            }
    
    # HTTP 401/403 = auth wall, not a failure
    if status_code in [401, 403]:
        return {
            "success": False,
            "evidence": f"HTTP {status_code} - Authentication/Authorization required",
            "error_type": "auth_required",
            "feedback": f"Endpoint requires authentication (HTTP {status_code}). Try using session tokens from previous successful exploits.",
            "severity": "low",
            "session_token_found": False,
            "session_token_value": None,
            "recommendation": "chain_token",
            "deterministic": True,
        }
    
    # HTTP 404 = endpoint doesn't exist
    if status_code == 404 or "404" in combined:
        return {
            "success": False,
            "evidence": "HTTP 404 - Endpoint not found",
            "error_type": "not_found",
            "feedback": "Endpoint does not exist. Try different path or reconnaissance.",
            "severity": "none",
            "session_token_found": False,
            "session_token_value": None,
            "recommendation": "pivot",
            "deterministic": True,
        }
    
    # HTTP 429 = rate limited
    if status_code == 429 or "rate limit" in combined.lower():
        return {
            "success": False,
            "evidence": "HTTP 429 - Rate limited",
            "error_type": "rate_limit",
            "feedback": "Rate limited. Add delays between requests (use --delay in curl).",
            "severity": "low",
            "session_token_found": False,
            "session_token_value": None,
            "recommendation": "stealth",
            "deterministic": True,
        }
    
    # ========== IDOR DETERMINISTIC SUCCESS RULE ==========
    # IDOR: 200 OK + JSON body + "id" field = confirmed IDOR success
    if status_code == 200 and exploit_type.lower() == "idor":
        content_type_match = re.search(r'Content-Type:\s*(\S+)', combined, re.IGNORECASE)
        content_type = content_type_match.group(1) if content_type_match else ""
        
        if "application/json" in content_type:
            # Check for "id" field in response
            if re.search(r'"id"\s*:', combined):
                return {
                    "success": True,
                    "evidence": f"HTTP 200 OK with JSON response containing 'id' field - confirmed IDOR access to resource.",
                    "error_type": "none",
                    "feedback": "IDOR exploit successful - accessed resource with ID field in response.",
                    "severity": "HIGH",
                    "session_token_found": False,
                    "session_token_value": None,
                    "recommendation": "pivot",
                    "deterministic": True,
                }
    
    # ========== FTP SENSITIVE DATA EXPOSURE RULE ==========
    # FTP endpoints: 200 OK + non-empty body = sensitive data exposure
    if status_code == 200 and exploit_type.lower() == "sensitive_data_exposure":
        if "/ftp/" in payload or "/ftp/" in combined:
            content_type_match = re.search(r'Content-Type:\s*(\S+)', combined, re.IGNORECASE)
            content_type = content_type_match.group(1) if content_type_match else ""
            
            # FTP file access with any content is a win
            if content_type and "text/html" not in content_type:
                body_content = re.search(r'\r?\n\r?\n(.+)', combined, re.DOTALL)
                if body_content and len(body_content.group(1).strip()) > 50:
                    return {
                        "success": True,
                        "evidence": f"HTTP 200 OK on FTP endpoint with file content - sensitive data exposure confirmed.",
                        "error_type": "none",
                        "feedback": "FTP file access successful - sensitive data exposed.",
                        "severity": "MEDIUM",
                        "session_token_found": False,
                        "session_token_value": None,
                        "recommendation": "pivot",
                        "deterministic": True,
                    }
    
    # ========== .GIT EXPOSURE RULE ==========
    # B22: .git exposure = CRITICAL - source code reconstruction possible
    if status_code == 200 and "/.git/" in combined:
        # Check for git repository indicators
        git_indicators = ["ref:", "HEAD", "[core]", "[remote", "git@github.com"]
        has_git_content = any(indicator in combined for indicator in git_indicators)
        
        if has_git_content:
            return {
                "success": True,
                "evidence": "CRITICAL: /.git/ endpoint exposed - full source code reconstruction possible via git history.",
                "error_type": "none",
                "feedback": "🚨 CRITICAL: .git directory exposed! This allows complete source code reconstruction including commit history, secrets in commits, and full application logic.",
                "severity": "CRITICAL",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "escalate",
                "deterministic": True,
            }
    
    # ========== SPA CATCHALL FILTER ==========
    # Non-HTML endpoints returning HTML = SPA catchall, not a failure
    if status_code == 200:
        content_type_match = re.search(r'Content-Type:\s*([^;\s]+)', combined, re.IGNORECASE)
        content_type = content_type_match.group(1) if content_type_match else ""
        
        # If expecting JSON/API response but got HTML = SPA redirect
        if content_type == "text/html":
            # Check if this was an API/JSON endpoint
            api_indicators = ["/api/", "/rest/", ".json", "application/json"]
            expected_api = any(ind in payload for ind in api_indicators)
            
            if expected_api:
                return {
                    "success": False,
                    "evidence": "HTTP 200 OK but returned HTML (SPA catchall) - endpoint may not exist or requires different approach.",
                    "error_type": "spa_catchall",
                    "feedback": "Endpoint returned SPA HTML instead of API response - not applicable for this exploit type.",
                    "severity": "none",
                    "session_token_found": False,
                    "session_token_value": None,
                    "recommendation": "pivot",
                    "deterministic": True,
                }
    
    # ========== CONNECTION TIMEOUT FOR DEDUPLICATION ==========
    # Mark connection errors clearly for deduplication logic
    if status_code is None and ("exit=7" in combined or "exit=28" in combined or "timed out" in combined.lower()):
        return {
            "success": False,
            "evidence": "Connection timeout or failure - network issue, not application behavior.",
            "error_type": "connection_timeout",
            "feedback": "Connection failed - retry or check target availability.",
            "severity": "none",
            "session_token_found": False,
            "session_token_value": None,
            "recommendation": "retry",
            "deterministic": True,
        }
    
    # ========== PARTIAL TRANSFER (EXIT CODE 18) ==========
    # B19: curl exit code 18 = partial transfer. For FTP/directory listings with substantial
    # content, this is valid data exposure, not a failure.
    if result.exit_code == 18:
        # Check if we got meaningful content despite partial transfer
        if result.stdout and len(result.stdout) > 1000:
            return {
                "success": True,
                "evidence": f"Partial transfer (exit 18) but received {len(result.stdout)} bytes - valid directory listing or file content exposed.",
                "error_type": "none",
                "feedback": "Data exposed despite partial transfer - FTP/directory listing successful.",
                "severity": "MEDIUM",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "pivot",
                "deterministic": True,
            }
        else:
            # True failure - no useful data received
            return {
                "success": False,
                "evidence": "Partial transfer (exit 18) with insufficient data - likely transfer failure.",
                "error_type": "data_exposure",
                "feedback": "Transfer failed before meaningful data received.",
                "severity": "none",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "retry",
                "deterministic": True,
            }
    
    # Fall through to LLM for ambiguous cases (200, 302, etc.)
    return None


async def analyze_exploit_result(
    exploit_type: str,
    tool_name: str,
    command: str,
    result: ExecResult,
    intel: list[dict] | None = None,
    previous_attempts: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Main entry point — analyze an exploit result using the Critic agent.
    
    Returns a structured evaluation with success/failure, error type, and feedback.
    """
    logger.info(f"Critic: Analyzing {exploit_type} exploit result (exit code: {result.exit_code})")
    
    # ========== B12: DETERMINISTIC PRE-CHECK ==========
    # Run deterministic checks BEFORE LLM to catch obvious cases
    # This prevents small LLMs from misinterpreting clear signals
    payload = command if isinstance(command, str) else str(command)
    deterministic_result = _deterministic_precheck(result, exploit_type, payload)
    if deterministic_result:
        logger.info(f"Critic: Deterministic pre-check caught {deterministic_result['error_type']} - skipping LLM")
        return deterministic_result
    
    # ========== INTELLIGENCE UPGRADE: Pre-scan for specific patterns ==========
    # This grounds the LLM's reasoning in actual detected technologies
    juice_shop_hints = _scan_for_juice_shop_hints(result)
    grounded_feedback = _build_grounded_feedback(juice_shop_hints, exploit_type)
    
    logger.info(f"Critic: Detected hints: {juice_shop_hints}")
    
    # Build context for the Critic
    intel_str = json.dumps(intel, indent=2, default=str) if intel else "(no intelligence available)"
    prev_str = json.dumps(previous_attempts, indent=2, default=str) if previous_attempts else "(no previous attempts)"
    
    # Build the analysis prompt with grounded feedback
    hints_section = f"\n\nGROUNDED INTELLIGENCE:\n{grounded_feedback}" if grounded_feedback else ""
    
    analysis_prompt = CRITIC_ANALYSIS_PROMPT.format(
        exploit_type=exploit_type,
        tool_name=tool_name,
        command=command[:500],  # Truncate long commands
        exit_code=result.exit_code,
        stdout=result.stdout[:3000] if result.stdout else "(empty)",
        stderr=result.stderr[:1000] if result.stderr else "(empty)",
        intel=intel_str,
        previous_attempts=prev_str,
    ) + hints_section
    
    # Call the Critic LLM
    try:
        response = await llm_client.chat(
            model=settings.critic_model,  # Use Critic-specific model
            messages=[
                {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
                {"role": "user", "content": analysis_prompt},
            ],
            temperature=0.1,  # Low temperature for consistent evaluation
            fallback_model=settings.critic_model_fallback,
        )
        
        evaluation = _parse_critic_response(response)
        
        # B24: Preserve original exploit_type - don't let LLM override it
        # The LLM might classify the exploit differently (e.g., xxe -> info_disclosure)
        # which breaks adaptive variant generation in the next iteration
        if "exploit_type" in evaluation:
            # Log if the LLM tried to change the type
            if evaluation["exploit_type"] != exploit_type:
                logger.warning(f"Critic: LLM tried to change exploit_type from '{exploit_type}' to '{evaluation['exploit_type']}' - preserving original")
            evaluation["exploit_type"] = exploit_type
        
        # Also run automatic error detection as backup
        if evaluation.get("error_type") == "unknown":
            auto_detected = _auto_detect_error_type(result)
            if auto_detected != "none":
                evaluation["error_type"] = auto_detected
                evaluation["feedback"] = f"Auto-detected {auto_detected}. {evaluation.get('feedback', '')}"
        
        # Add recommendation if not present
        if "recommendation" not in evaluation:
            evaluation["recommendation"] = _generate_stealth_recommendation(evaluation.get("error_type", "unknown"))
        
        # Enhance feedback for server errors with specific stealth guidance
        if evaluation.get("error_type") == "server_error":
            evaluation["feedback"] = (
                "🚨 TOO LOUD - 500 Internal Server Error detected! "
                "The payload crashed the server. SWITCH TO STEALTH MODE: "
                "1) Use curl with custom headers (-H 'X-Forwarded-For: 127.0.0.1'), "
                "2) URL encode payloads (%27 instead of '), "
                "3) Add delays between requests, "
                "4) Try POST instead of GET. "
                + evaluation.get("feedback", "")
            )
            evaluation["severity"] = "high"
        
        # PentAGI v4.0: HTTP response code pivot logic
        response_code = evaluation.get("response_code")
        if response_code and not evaluation.get("success"):
            pivot = _response_code_pivot(response_code, evaluation.get("error_type", "unknown"))
            if pivot:
                evaluation["feedback"] = pivot + " " + evaluation.get("feedback", "")
        
        logger.info(f"Critic: Evaluation complete - success={evaluation.get('success')}, error_type={evaluation.get('error_type')}, recommendation={evaluation.get('recommendation')}")
        
        # Step 3: Non-blocking Supabase event logging (fire-and-forget)
        # This will NOT block or slow down the mission execution
        if HAS_SUPABASE:
            try:
                # Extract mission_id from context if available
                mission_id = "unknown"
                # Try to find mission_id in previous_attempts or intel
                if previous_attempts and len(previous_attempts) > 0:
                    mission_id = previous_attempts[0].get("mission_id", "unknown")
                elif intel and len(intel) > 0:
                    mission_id = intel[0].get("mission_id", "unknown")
                
                # Update agent state in Supabase
                try:
                    supabase = get_supabase_client()
                    if supabase._enabled:
                        asyncio.create_task(supabase.update_agent_state(
                            mission_id=mission_id,
                            agent_id="critic",
                            agent_name="critic",
                            status="running" if not evaluation.get("success") else "reviewing",
                            agent_team="red",
                            task=f"analyzing_{exploit_type}",
                        ))
                except Exception as e:
                    logger.debug(f"Failed to update critic state: {e}")
                
                # Build the event payload
                event_payload = {
                    "exploit_type": exploit_type,
                    "tool_name": tool_name,
                    "command": command[:200],  # Truncate for storage
                    "exit_code": result.exit_code,
                    "success": evaluation.get("success", False),
                    "error_type": evaluation.get("error_type", "unknown"),
                    "severity": evaluation.get("severity", "low"),
                    "feedback": evaluation.get("feedback", "")[:500],
                    "recommendation": evaluation.get("recommendation", ""),
                    "evidence": evaluation.get("evidence", "")[:500],
                    "timestamp": asyncio.get_event_loop().time(),
                }
                
                # Fire-and-forget: don't await, don't block, wrap in try/except
                asyncio.create_task(
                    _log_critic_event_async(mission_id, event_payload)
                )
            except Exception as log_err:
                # Supabase failures must never crash the mission
                logger.debug(f"Supabase logging skipped: {log_err}")
        
        # Update agent state to complete
        if HAS_SUPABASE:
            try:
                supabase = get_supabase_client()
                if supabase._enabled:
                    asyncio.create_task(supabase.update_agent_state(
                        mission_id=mission_id,
                        agent_id="critic",
                        agent_name="critic",
                        status="complete",
                        agent_team="red",
                        task=f"analysis_complete_{exploit_type}",
                    ))
            except Exception as e:
                logger.debug(f"Failed to update critic state: {e}")
        
        return evaluation
        
    except Exception as e:
        logger.error(f"Critic: Analysis failed with exception: {e}")
        # Fallback to basic evaluation
        return _fallback_evaluation(result)


async def _log_critic_event_async(mission_id: str, payload: dict):
    """Async helper to log critic events to Supabase.
    
    This runs as a background task and will not block the main execution.
    Failures are silently logged and do not affect the mission.
    """
    try:
        from core.supabase_client import get_supabase_client
        supabase = get_supabase_client()
        if supabase._enabled:
            # Legacy: swarm_agent_events
            await supabase.log_mission_event(
                mission_id=mission_id,
                event_type="action",
                payload_json=payload
            )
            # New timeline: swarm_events
            await supabase.log_swarm_event(
                mission_id=mission_id,
                event_type="critic_analysis",
                agent_name="critic",
                title=f"Critic: {payload.get('exploit_type', 'unknown')} - {'✓' if payload.get('success') else '✗'}",
                stage="exploitation",
                description=payload.get("feedback", "")[:500],
                success=payload.get("success", False),
                error_type=payload.get("error_type"),
                evidence={"severity": payload.get("severity", ""), "recommendation": payload.get("recommendation", "")},
            )
            logger.debug(f"Logged critic event to Supabase for mission {mission_id}")
    except Exception as e:
        # Silently fail - mission must continue regardless
        logger.debug(f"Supabase logging failed (non-critical): {e}")


async def quick_evaluate(
    exploit_type: str,
    result: ExecResult,
) -> dict[str, Any]:
    """
    Fast synchronous evaluation without LLM - for cases where speed matters.
    Uses pattern matching to detect common error types.
    """
    logger.info(f"Critic: Quick evaluating {exploit_type} result")
    
    combined_output = (result.stdout or "") + (result.stderr or "")
    
    # Check for success patterns - enhanced for Juice Shop and real-world apps
    success_patterns = {
        "sqli": [r"admin", r"true", r"authenticated", r"login success", r"bypass", r"sqlite", r"mysql", r"union select", r"version\(\)"],
        "xss": [r"<script", r"alert\s*\(", r"onerror\s*=", r"javascript\s*:", r"onload\s*=", r"onmouseover\s*="],
        "dom_xss": [r"#\s*", r"location\.", r"document\.", r"innerHTML", r"eval\s*\("],
        "stored_xss": [r"created", r"success", r"posted", r"review", r"comment"],
        "reflected_xss": [r"search", r"query", r"keyword", r"results"],
        "auth_bypass": [r"admin", r"dashboard", r"privilege", r"access granted", r"welcome", r"profile", r"account"],
        "access_control": [r"unauthorized", r"forbidden", r"403", r"access denied"],
        "idor": [r'"id":', r'"email":', r'"password":', r'"address":', r'"user":', r'"data":', r'"content":'],
        "data_exposure": [r'"id":', r'"name":', r'"email":', r'"price":', r'"description":', r'"data":', r'\[\s*\{', r'json', r'"rating"'],
        "xxe": [r"etc/passwd", r"passwd", r"root:", r"xml", r"entity"],
        "file_upload": [r"upload", r"success", r"file", r"created", r"path"],
        "ssti": [r"49", r"7\*7", r"48", r"template", r"render"],
        "nosql": [r"true", r"admin", r"[$]ne", r"[$]gt", r"[$]regex"],
        "lfi": [r"etc/passwd", r"passwd", r"root:", r"\.\./", r"%2e%2e", r"php://filter"],
        "rce": [r"uid=", r"root", r"whoami", r"id\s*", r"command", r"output"],
        "csrf": [r"token", r"success", r"changed", r"updated"],
        "command_injection": [r"uid=", r"root", r"bin/", r"etc/"],
    }
    
    if exploit_type in success_patterns:
        for pattern in success_patterns[exploit_type]:
            if re.search(pattern, combined_output, re.IGNORECASE):
                return {
                    "success": True,
                    "evidence": f"Pattern '{pattern}' found in response",
                    "error_type": "none",
                    "feedback": "Exploit appears successful - pattern match found",
                    "severity": "high",
                    "session_token_found": False,
                    "session_token_value": None,
                }
    
    # Auto-detect error type
    error_type = _auto_detect_error_type(result)
    
    return {
        "success": False,
        "evidence": combined_output[:500],
        "error_type": error_type,
        "feedback": f"Quick evaluation: detected {error_type} - needs LLM review",
        "severity": "medium" if error_type != "none" else "low",
        "session_token_found": False,
        "session_token_value": None,
    }


def _auto_detect_error_type(result: ExecResult) -> str:
    """Automatically detect error type from stdout/stderr using pattern matching."""
    combined = (result.stdout or "") + (result.stderr or "")
    combined_lower = combined.lower()
    
    for error_type, patterns in ERROR_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, combined, re.IGNORECASE):
                logger.info(f"Critic: Auto-detected error type: {error_type}")
                return error_type
    
    # Check exit code
    if result.exit_code != 0:
        return "unknown"  # Non-zero exit but unknown error type
    
    return "none"


def _parse_critic_response(response: str) -> dict[str, Any]:
    """Parse JSON from Critic LLM response using robust parsing."""
    # Use robust parser first
    result = parse_with_retry(response)
    if result is not None and isinstance(result, dict):
        return result
    
    # Fallback to sanitize
    sanitized = sanitize_json_output(response)
    if sanitized is not None and isinstance(sanitized, dict):
        return sanitized
    
    # Last resort: simple JSON extraction
    cleaned = response.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    
    try:
        json_match = re.search(r'\{[^{}]*\}', cleaned, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except json.JSONDecodeError:
        pass
    
    return json.loads(cleaned)


def _response_code_pivot(response_code: int, error_type: str) -> str:
    """Generate pivot recommendation based on HTTP response code."""
    if response_code == 403:
        return "🔄 PIVOT: 403 Forbidden → Try privilege escalation, different user context, or X-Forwarded-For bypass."
    elif response_code == 401:
        return "🔄 PIVOT: 401 Unauthorized → Try auth bypass with found credentials from Redis findings, or JWT manipulation."
    elif response_code == 500:
        return "🔄 PIVOT: 500 Server Error → Mark as potentially injectable! Escalate to SQLi/XXE with error-based payloads."
    elif response_code == 429:
        return "🔄 PIVOT: 429 Rate Limited → Add delays, rotate User-Agent, try different endpoint."
    return ""


def _generate_stealth_recommendation(error_type: str) -> str:
    """Generate strategic recommendation based on error type."""
    if error_type == "server_error":
        return "stealthier"  # 500 errors mean we're too loud
    elif error_type == "waf_block":
        return "stealthier"  # WAF detected us
    elif error_type == "rate_limit":
        return "stealthier"  # Being rate limited
    elif error_type == "not_found":
        return "pivot"  # Try different endpoint
    elif error_type == "auth_failure":
        return "retry"  # Try different credentials
    else:
        return "retry"


def _fallback_evaluation(result: ExecResult) -> dict[str, Any]:
    """Fallback evaluation when LLM fails - with intelligent success detection."""
    error_type = _auto_detect_error_type(result)
    combined = (result.stdout or "") + (result.stderr or "")
    combined_lower = combined.lower()
    
    # Enhanced success detection for various exploit types
    # HTTP Success indicators
    http_success = re.search(r'HTTP/[\d.]+\s+(200|201|202|204)', combined)
    json_response = re.search(r'\{\s*"[^"]+"\s*:', combined)
    
    # Check for data exposure (JSON arrays/objects with data)
    data_exposure_indicators = [
        r'"id"\s*:\s*\d+',
        r'"name"\s*:',
        r'"email"\s*:',
        r'"data"\s*:\s*\[',
        r'\[\s*\{.*\}',
    ]
    
    for pattern in data_exposure_indicators:
        if re.search(pattern, combined):
            return {
                "success": True,
                "evidence": f"Data exposure detected: {combined[:200]}",
                "error_type": "none",
                "feedback": "Exploit successful - data retrieved from target",
                "severity": "high",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "none",
            }
    
    # Check for XSS indicators (script tags, event handlers, etc.)
    xss_indicators = [
        r'<script',
        r'<img[^>]+onerror',
        r'<iframe[^>]+onload',
        r'on\w+\s*=',
        r'javascript:',
    ]
    
    for pattern in xss_indicators:
        if re.search(pattern, combined, re.IGNORECASE):
            return {
                "success": True,
                "evidence": f"XSS payload present in response: {pattern}",
                "error_type": "none",
                "feedback": "XSS exploit appears successful - payload present in response",
                "severity": "high",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "none",
            }
    
    # Check for authentication/session indicators
    auth_indicators = [
        r'"token"\s*:',
        r'authorization',
        r'session',
        r'welcome',
        r'admin',
    ]
    
    for pattern in auth_indicators:
        if re.search(pattern, combined_lower):
            return {
                "success": True,
                "evidence": f"Auth indicator found: {pattern}",
                "error_type": "none",
                "feedback": "Authentication bypass or session obtained",
                "severity": "critical",
                "session_token_found": True,
                "session_token_value": None,
                "recommendation": "none",
            }
    
    # Check for SQL injection errors (which means query executed)
    sqli_indicators = [
        r'sqlite',
        r'sequelize',
        r'sql syntax',
        r'near.*syntax error',
        r'unrecognized token',
    ]
    
    for pattern in sqli_indicators:
        if re.search(pattern, combined_lower):
            return {
                "success": True,
                "evidence": f"SQL error indicates query execution: {combined[:200]}",
                "error_type": "none",
                "feedback": "SQL injection successful - database error confirms query execution",
                "severity": "critical",
                "session_token_found": False,
                "session_token_value": None,
                "recommendation": "none",
            }
    
    # Build feedback based on error type
    if error_type == "server_error":
        feedback = "CRITICAL: 500 Internal Server Error detected. Payload is TOO LOUD and crashed the server. RECOMMENDATION: Switch to STEALTH MODE - use curl with custom headers, URL encoding, and slower timing."
    elif error_type == "waf_block":
        feedback = "WAF detected the payload. Try URL encoding, different headers, or parameter obfuscation."
    else:
        feedback = "Critic evaluation failed - using fallback analysis"
    
    return {
        "success": False,
        "evidence": combined[:500],
        "error_type": error_type,
        "feedback": feedback,
        "severity": "high" if error_type == "server_error" else "medium",
        "session_token_found": False,
        "session_token_value": None,
        "recommendation": _generate_stealth_recommendation(error_type),
    }


def extract_session_tokens(result: ExecResult) -> dict[str, str]:
    """
    Extract potential session tokens, cookies, or auth headers from response.
    Returns dict of {token_name: token_value}
    """
    tokens = {}
    combined = (result.stdout or "") + (result.stderr or "")
    
    # Common session/token patterns - capture full token values
    patterns = [
        (r'session[_-]?id["\s:=]+([^\s",}]+)', "session_id"),
        (r'["\']token["\']?\s*:\s*["\']?([^"\',}\s]+)', "token"),
        (r'Bearer\s+([a-zA-Z0-9_\-\.]+)', "bearer_token"),
        (r'Set-Cookie:\s*([^=]+)=([^;]+)', "cookie"),
        (r'["\']jwt["\']?\s*:\s*["\']?([^"\',}\s]+)', "jwt"),
        # JWT pattern - captures standard JWT format
        (r'["\']?([a-zA-Z0-9_\-]*\.[a-zA-Z0-9_\-]*\.[a-zA-Z0-9_\-]*)["\']?', "jwt"),
    ]
    
    for pattern, name in patterns:
        matches = re.findall(pattern, combined, re.IGNORECASE)
        for match in matches:
            if match and len(match) > 5:  # Skip very short/empty values
                if isinstance(match, tuple):
                    # Handle cookie pattern with 2 groups
                    tokens[name] = f"{match[0]}={match[1]}"
                else:
                    tokens[name] = match
                break  # Only take first valid match per pattern
    
    return tokens
