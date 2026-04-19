"""
Semgrep subprocess runner for Project VibeCheck.

Runs Semgrep as a subprocess binary (NOT imported as Python package).
Provides:
- run_semgrep(): Execute Semgrep with OWASP, NodeJS, and Secrets rules
- semgrep_to_parsed_nodes(): Convert findings to vulnerability candidates
- Custom taint rule generation for Express.js

Week 3 Implementation.
"""

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Use isolated semgrep venv binary to avoid dependency conflicts with main project venv
# The isolated venv is at .semgrep-venv in the project root
# Platform-agnostic: Use Scripts/semgrep.exe on Windows, bin/semgrep on Unix
import platform

def _get_default_semgrep_path() -> str:
    """Get the default semgrep binary path based on the platform."""
    venv_dir = Path(__file__).parent.parent.parent / ".semgrep-venv"
    if platform.system() == "Windows":
        return str(venv_dir / "Scripts" / "semgrep.exe")
    else:
        return str(venv_dir / "bin" / "semgrep")

_DEFAULT_SEMGREP = _get_default_semgrep_path()
SEMGREP_BIN = os.environ.get("SEMGREP_BIN", _DEFAULT_SEMGREP)

# Fallback to PATH if isolated venv binary doesn't exist
if not Path(SEMGREP_BIN).exists():
    logger.debug(f"Isolated semgrep not found at {SEMGREP_BIN}, falling back to PATH")
    SEMGREP_BIN = "semgrep"

# Semgrep timeout (seconds)
SEMGREP_TIMEOUT = 120

# Custom taint rule for Express.js - loaded from external file
# Path to the taint rule file (relative to this module)
_TAINT_RULE_PATH = Path(__file__).parent.parent / "rules" / "express-taint.yaml"

def _get_taint_rule_path() -> Path | None:
    """Get the path to the Express.js taint rule file if it exists."""
    if _TAINT_RULE_PATH.exists():
        return _TAINT_RULE_PATH
    logger.debug(f"Taint rule file not found at {_TAINT_RULE_PATH}")
    return None

# Mapping from Semgrep check_id to vulnerability type
CHECK_ID_TO_VULN_TYPE = {
    "sql": "sql_injection",
    "sqli": "sql_injection",
    "xss": "xss",
    "secret": "hardcoded_secret",
    "hardcoded": "hardcoded_secret",
    "path": "path_traversal",
    "traversal": "path_traversal",
    "tainted-filename": "path_traversal",  # Custom taint rule for file path injection
    "tainted-file": "path_traversal",      # Variant naming
    "filename": "path_traversal",          # php tainted-filename rule
    "file-read": "path_traversal",         # generic file read rules
    "sendfile": "path_traversal",          # express res.sendFile rules
    "express-res-sendfile": "path_traversal",  # Express.js sendfile taint
    "command": "command_injection",
    "exec": "command_injection",
    "rce": "command_injection",
    "tainted-exec": "command_injection",   # Custom taint rule for command injection
    "tainted-sql": "sql_injection",        # Custom taint rule for SQL injection
    "echoed": "xss",                       # php echoed-request rule → XSS
    "echo": "xss",                         # catch echo variants
    "ssrf": "ssrf",
    "redirect": "open_redirect",
    "jwt": "jwt_issue",
    "crypto": "weak_crypto",
    "hash": "weak_crypto",
    "random": "weak_random",
    "eval": "code_injection",
    "deserialize": "insecure_deserialization",
    "prototype": "prototype_pollution",
    "auth": "missing_auth",
    "cors": "cors_misconfiguration",
}

# Mapping from Semgrep severity to our severity
SEVERITY_MAP = {
    "ERROR": "high",
    "WARNING": "medium",
    "INFO": "low",
}

# Test fixture patterns to skip (expanded for juice-shop challenge files)
# NOTE: These patterns match against FILE PATH only, never snippet content
_FIXTURE_PATH_PATTERNS = [
    "test",
    "spec",
    "__tests__",
    "fixture",
    "mock",
    "example",
    "sample",
    "demo",
    "codefixes",        # juice-shop: data/static/codefixes/
    "vulncodefixes",    # juice-shop: routes/vulnCodeFixes.ts (intentional vulns)
    "_correct.ts",      # juice-shop "fixed" solution files
    "impossible.php",   # DVWA: hardened "impossible" difficulty files
    "/source/impossible.php",  # DVWA: path variant vulnerabilities/exec/source/impossible.php
    ".min.",            # minified files
    ".test.",
    ".spec.",
]

# Legacy alias for backwards compatibility
TEST_PATTERNS = _FIXTURE_PATH_PATTERNS


def _extract_code_context(file_path: str, start_line: int, end_line: int, context: int = 4) -> str:
    """
    Read actual source lines from file with surrounding context lines.
    
    This fixes the bug where Semgrep's extra.lines only returns the matched line text,
    which for juice-shop files was always "requires login" (a middleware comment at
    the top of every file).
    
    Args:
        file_path: Path to the source file
        start_line: Starting line number (1-based)
        end_line: Ending line number (1-based)
        context: Number of context lines to include before and after
        
    Returns:
        Source code snippet with context, or empty string on error
    """
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        lo = max(0, start_line - 1 - context)
        hi = min(len(all_lines), end_line + context)
        return "".join(all_lines[lo:hi]).strip()
    except Exception as e:
        logger.warning(f"Could not read code context from {file_path}:{start_line}: {e}")
        return ""


def run_semgrep(repo_path: Path, scan_id: str) -> list[dict[str, Any]]:
    """
    Run Semgrep on a repository and return findings.

    Semgrep is called as a subprocess binary (NOT imported as Python package).
    Runs with:
    - p/owasp-top-ten: OWASP Top 10 security rules
    - p/nodejs: Node.js specific rules
    - p/secrets: Hardcoded secrets detection

    Args:
        repo_path: Path to the repository to scan
        scan_id: Unique scan identifier

    Returns:
        List of raw Semgrep findings
    """
    logger.info("=" * 80)
    logger.info("SEMGREP RUNNER: Starting Semgrep scan")
    logger.info(f"  Repo path: {repo_path}")
    logger.info(f"  Scan ID: {scan_id}")
    logger.info("=" * 80)

    # Get custom taint rule path (if available)
    taint_rule_path = _get_taint_rule_path()
    logger.info(f"  Taint rule path: {taint_rule_path}")

    try:
        # Build Semgrep command using isolated binary
        # Note: --no-git-ignore is required to scan files not tracked by git
        # (e.g., extracted source code, downloaded repos without .git)
        cmd = [
            SEMGREP_BIN,
            "--config", "p/owasp-top-ten",
            "--config", "p/nodejs",
            "--config", "p/secrets",
        ]
        
        # Add custom taint rule if available
        if taint_rule_path:
            cmd.extend(["--config", str(taint_rule_path)])
        
        cmd.extend([
            "--json",
            "--quiet",
            "--no-git-ignore",  # Scan all files, not just git-tracked
            "--timeout", str(60),  # Per-file timeout
            "--max-memory", "4096",  # Increased memory limit for faster processing
            "--jobs", str(4),  # Use multiple cores for parallel scanning
            str(repo_path),
        ])

        logger.info(f"  Semgrep binary: {SEMGREP_BIN}")
        logger.info(f"  Command: {' '.join(cmd)}")

        # Run Semgrep with UTF-8 encoding to handle special characters in source files
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=SEMGREP_TIMEOUT,
            encoding='utf-8',
            errors='replace',  # Replace undecodable bytes instead of crashing
        )

        logger.info(f"  Return code: {result.returncode}")

        # returncode 1 means findings exist (not an error)
        # returncode 0 means no findings
        # returncode 7 means OOM (out of memory) - partial results may exist
        # returncode > 1 (except 7) is an error
        SEMGREP_OOM_CODE = 7
        if result.returncode > 1:
            if result.returncode == SEMGREP_OOM_CODE:
                logger.warning(
                    "  Semgrep hit memory limit (OOM) — partial results only. "
                    "Consider increasing --max-memory or scanning a subset of files."
                )
                # Continue to parse whatever partial JSON was written
            else:
                logger.error(f"  Semgrep FAILED with returncode {result.returncode}")
                logger.error(f"  stderr: {result.stderr}")
                return []

        # Log stderr for any warnings
        if result.stderr:
            logger.warning(f"  Semgrep stderr: {result.stderr[:500]}...")

        # Parse JSON output
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            logger.error(f"  Failed to parse Semgrep JSON output: {e}")
            logger.error(f"  stdout (first 500 chars): {result.stdout[:500]}...")
            return []

        findings = output.get("results", [])
        logger.info(f"  Semgrep found {len(findings)} raw findings")
        
        # Log detailed findings for debugging
        if findings:
            logger.info("  SAMPLE FINDINGS (first 5):")
            for i, f in enumerate(findings[:5]):
                check_id = f.get("check_id", "unknown")
                path = f.get("path", "unknown")
                start = f.get("start", {})
                line = start.get("line", 0) if isinstance(start, dict) else 0
                extra = f.get("extra", {})
                message = extra.get("message", "")[:100] if isinstance(extra, dict) else ""
                logger.info(f"    [{i}] {check_id}")
                logger.info(f"        File: {path}:{line}")
                logger.info(f"        Message: {message}...")
        
        # Log errors if any
        errors = output.get("errors", [])
        if errors:
            logger.warning(f"  Semgrep reported {len(errors)} errors:")
            for e in errors[:3]:
                logger.warning(f"    - {e}")

        logger.info("=" * 80)
        return findings

    except subprocess.TimeoutExpired:
        logger.error(f"  Semgrep TIMED OUT after {SEMGREP_TIMEOUT}s")
        return []
    except FileNotFoundError:
        logger.error("  Semgrep binary NOT FOUND. Please install Semgrep: pip install semgrep")
        return []
    except Exception as e:
        logger.error(f"  Semgrep execution FAILED: {e}", exc_info=True)
        return []
    # Note: We do NOT delete the taint rule file - it's a persistent rule file, not a temporary one


def semgrep_to_parsed_nodes(findings: list[dict], scan_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Convert Semgrep findings to vulnerability candidate records.

    Filters:
    - Skip secret findings if file path contains test/spec/__tests__/fixture/mock

    Maps:
    - check_id to vuln_type
    - severity to our severity scale

    Args:
        findings: List of raw Semgrep findings
        scan_id: Unique scan identifier

    Returns:
        Tuple of (candidates, stats) where:
        - candidates: List of vulnerability candidate dictionaries
        - stats: Dictionary with conversion statistics
    """
    logger.info("=" * 80)
    logger.info("SEMGREP TO PARSED NODES: Converting findings to candidates")
    logger.info(f"  Input findings: {len(findings)}")
    logger.info("=" * 80)
    
    candidates = []
    skipped_test_fixtures = 0
    skipped_non_dict = 0

    for finding in findings:
        try:
            # Defensive type check - ensure finding is a dict
            if not isinstance(finding, dict):
                logger.warning(f"  Skipping non-dict finding: {type(finding)}")
                skipped_non_dict += 1
                continue
            
            # Extract fields from finding
            check_id = finding.get("check_id", "")
            path = finding.get("path", "")
            
            # Safely extract line numbers from nested dicts
            start_obj = finding.get("start", {})
            if not isinstance(start_obj, dict):
                start_obj = {}
            start_line = start_obj.get("line", 0)
            
            end_obj = finding.get("end", {})
            if not isinstance(end_obj, dict):
                end_obj = {}
            end_line = end_obj.get("line", 0)
            
            extra = finding.get("extra", {})
            if not isinstance(extra, dict):
                extra = {}
            # BUG FIX: Ensure proper UTF-8 encoding for message to prevent mojibake
            message = extra.get("message", "")
            if message:
                # Normalize Unicode and ensure UTF-8 encoding
                import unicodedata
                message = unicodedata.normalize('NFKC', str(message))
            severity = extra.get("severity", "INFO")
            # BUG FIX: Read actual source code with context instead of using extra.lines
            # which only returns the matched line text (e.g., "requires login" for juice-shop)
            code_snippet = _extract_code_context(path, start_line, end_line)
            # Debug log to verify we're getting real code, not "requires login"
            logger.debug(f"  Snippet preview [{start_line}]: {repr(code_snippet[:80]) if code_snippet else 'EMPTY'}")
            # BUG FIX: Capture fingerprint with fallback to generated hash
            fingerprint = finding.get("fingerprint", "")
            if not fingerprint:
                # Generate fingerprint from finding content if semgrep doesn't provide one
                import hashlib
                fp_content = f"{check_id}:{path}:{start_line}:{code_snippet[:100]}"
                fingerprint = hashlib.md5(fp_content.encode('utf-8')).hexdigest()

            # Skip test fixtures for secrets
            if _is_test_fixture(path, check_id):
                logger.debug(f"  Skipping test fixture: {path}")
                skipped_test_fixtures += 1
                continue

            # Map check_id to vulnerability type
            vuln_type = _map_check_id_to_vuln_type(check_id)

            # Map severity
            mapped_severity = SEVERITY_MAP.get(severity, "medium")

            # Build candidate record
            candidate = {
                "scan_id": scan_id,
                "detector": "semgrep",
                "rule_id": check_id,
                "vuln_type": vuln_type,
                "severity": mapped_severity,
                "file_path": path,
                "line_start": start_line,
                "line_end": end_line,
                "code_snippet": code_snippet,
                "message": message,
                "fingerprint": fingerprint,
                "needs_llm_verification": True,
                "confirmed": False,
                "confidence": None,
                "verification_reason": None,
            }

            candidates.append(candidate)
            
            # Log each candidate being created
            logger.info(f"  Created candidate: {vuln_type} in {path}:{start_line}")
            logger.info(f"    Rule: {check_id}")
            logger.info(f"    Severity: {mapped_severity}")
            logger.info(f"    Snippet (first 100 chars): {code_snippet[:100] if code_snippet else 'EMPTY'}...")

        except Exception as e:
            logger.warning(f"  Failed to process finding: {e}")
            continue

    # BUG FIX: Deduplicate candidates by (file_path, line_start)
    # When both a custom taint rule (rules.*) AND a built-in semgrep rule fire
    # on the same line, prefer the custom taint rule
    original_count = len(candidates)
    seen: dict[tuple, dict] = {}
    for candidate in candidates:
        key = (candidate["file_path"], candidate["line_start"])
        if key not in seen:
            seen[key] = candidate
        else:
            existing = seen[key]
            # Prefer custom taint rules over built-in ones
            if (candidate["rule_id"].startswith("rules.") and 
                not existing["rule_id"].startswith("rules.")):
                seen[key] = candidate
                logger.debug(f"  Replaced duplicate: {existing['rule_id']} → {candidate['rule_id']}")

    candidates = list(seen.values())
    
    # BUG FIX #8: Second-pass dedup for adjacent findings
    # Collapses findings from same file+rule within a window of lines
    # Example: view_source_all.php has 4 file_get_contents() calls with same tainted $id
    # at lines 14, 18, 22, 26 - these are the same root vulnerability
    after_first_dedup = len(candidates)
    candidates = _dedup_adjacent_findings(candidates, window=30)
    after_second_dedup = len(candidates)

    # Calculate unique files affected
    unique_files = set(c["file_path"] for c in candidates if isinstance(c, dict) and c.get("file_path"))
    
    logger.info("-" * 80)
    logger.info(f"SEMGREP CONVERSION SUMMARY:")
    logger.info(f"  Total findings: {len(findings)}")
    logger.info(f"  Before dedup: {original_count} candidates")
    logger.info(f"  After line dedup: {after_first_dedup} candidates")
    logger.info(f"  After adjacent dedup: {after_second_dedup} unique candidates")
    logger.info(f"  Skipped (test fixtures): {skipped_test_fixtures}")
    logger.info(f"  Skipped (non-dict): {skipped_non_dict}")
    logger.info(f"  Unique files affected: {len(unique_files)}")
    logger.info("=" * 80)
    
    # Build stats dictionary for reporting
    stats = {
        "total_findings": len(findings),
        "before_dedup": original_count,
        "after_line_dedup": after_first_dedup,
        "after_adjacent_dedup": after_second_dedup,
        "final_candidates": len(candidates),
        "skipped_test_fixtures": skipped_test_fixtures,
        "skipped_non_dict": skipped_non_dict,
        "unique_files": len(unique_files),
        "deduped_count": len(findings) - len(candidates),
    }
    
    return candidates, stats


def _dedup_adjacent_findings(candidates: list[dict], window: int = 30) -> list[dict]:
    """
    Collapse findings from same file+rule within `window` lines into one.
    
    This handles the case where Semgrep fires multiple times on sequential lines
    for the same root vulnerability (e.g., same tainted variable used in multiple
    file_get_contents() calls in a single function block).
    
    IMPORTANT: This function is function-boundary-aware. It will NOT collapse
    findings that are separated by a function declaration boundary, even if
    they're within the line window. This prevents over-collapsing findings from
    different exported handlers in routes files.
    
    Args:
        candidates: List of vulnerability candidates
        window: Maximum line distance to consider as same finding (default 30)
        
    Returns:
        Deduplicated list of candidates
    """
    if not candidates:
        return candidates
    
    # Sort by file_path, rule_id, then line_start for consistent processing
    sorted_candidates = sorted(
        candidates,
        key=lambda c: (c.get("file_path", ""), c.get("rule_id", ""), c.get("line_start", 0))
    )
    
    # File content cache for boundary detection (avoids repeated file reads)
    _file_cache: dict[str, list[str]] = {}
    
    # Track clusters: each cluster has its own representative
    # Key: (file_path, rule_id, cluster_id) where cluster_id is the line_start of the cluster's first finding
    # This fixes the bug where a third finding D that should collapse with C couldn't
    # because we only tracked one representative per file+rule
    clusters: dict[tuple, dict] = {}
    # Track the most recent finding per file+rule for comparison
    last_finding: dict[tuple, dict] = {}
    
    for candidate in sorted_candidates:
        file_path = candidate.get("file_path", "")
        rule_id = candidate.get("rule_id", "")
        line_start = candidate.get("line_start", 0)
        
        file_rule_key = (file_path, rule_id)
        
        if file_rule_key not in last_finding:
            # First finding for this file+rule - start a new cluster
            cluster_key = (file_path, rule_id, line_start)
            clusters[cluster_key] = candidate
            last_finding[file_rule_key] = candidate
            logger.debug(f"  Adjacent dedup: New cluster {file_path}:{line_start} (rule={rule_id})")
        else:
            prev = last_finding[file_rule_key]
            prev_line = prev.get("line_start", 0)
            
            # Check if there's a function boundary between the two findings
            has_function_boundary = _has_function_boundary_between(
                file_path, prev_line, line_start, _file_cache
            )
            
            if abs(line_start - prev_line) <= window and not has_function_boundary:
                # Within window AND same function - collapse into previous cluster
                # Find the cluster key for the previous finding
                prev_cluster_key = (file_path, rule_id, prev.get("_cluster_start", prev_line))
                
                # Keep the one with lower line number (root of taint)
                if line_start < prev_line:
                    # Replace the cluster representative
                    new_cluster_key = (file_path, rule_id, line_start)
                    clusters[new_cluster_key] = candidate
                    candidate["_cluster_start"] = line_start
                    # Remove old cluster key
                    if prev_cluster_key in clusters:
                        del clusters[prev_cluster_key]
                    logger.info(f"  Adjacent dedup: Collapsed {file_path}:{line_start} " +
                               f"(was {prev_line}, rule={rule_id})")
                else:
                    logger.info(f"  Adjacent dedup: Collapsed {file_path}:{line_start} " +
                               f"(keeping {prev_line}, rule={rule_id})")
                
                # Update last finding but keep it pointing to the cluster start
                candidate["_cluster_start"] = prev.get("_cluster_start", prev_line)
                last_finding[file_rule_key] = candidate
            else:
                # Far apart OR separated by function boundary - start a new cluster
                cluster_key = (file_path, rule_id, line_start)
                clusters[cluster_key] = candidate
                candidate["_cluster_start"] = line_start
                last_finding[file_rule_key] = candidate
                reason = "function boundary" if has_function_boundary else f"{line_start - prev_line} lines apart"
                logger.info(f"  Adjacent dedup: New cluster at {file_path}:{line_start} " +
                           f"({reason})")
    
    # Remove internal _cluster_start field before returning
    result = []
    for c in clusters.values():
        c_clean = {k: v for k, v in c.items() if k != "_cluster_start"}
        result.append(c_clean)
    
    if len(result) < len(candidates):
        logger.info(f"  Adjacent dedup: {len(candidates)} → {len(result)} candidates")
    
    return result


# Function boundary patterns for different languages
# Compiled once at module load for performance
_FUNCTION_BOUNDARY_PATTERNS = [
    # TypeScript/JavaScript
    r"export\s+function\s+\w+",           # export function name(
    r"export\s+const\s+\w+\s*=",          # export const name = 
    r"export\s+async\s+function",         # export async function
    r"export\s+default\s+function",       # export default function
    r"^\s*function\s+\w+",                # function name(
    r"^\s*async\s+function\s+\w+",        # async function name(
    r"^\s*const\s+\w+\s*=\s*\(",          # const name = (
    r"^\s*const\s+\w+\s*=\s*async",       # const name = async
    # PHP
    r"function\s+\w+\s*\(",               # function name(
    r"public\s+function\s+\w+",           # public function name(
    r"private\s+function\s+\w+",          # private function name(
    r"protected\s+function\s+\w+",        # protected function name(
    r"static\s+function\s+\w+",           # static function name(
    # Python
    r"^\s*def\s+\w+\s*\(",                # def name(
    r"^\s*async\s+def\s+\w+\s*\(",        # async def name(
    r"^\s*class\s+\w+",                   # class name:
]

# Pre-compiled regex for function boundary detection (performance optimization)
_FUNCTION_BOUNDARY_RE = re.compile(
    "|".join(f"({p})" for p in _FUNCTION_BOUNDARY_PATTERNS),
    re.IGNORECASE
)


def _has_function_boundary_between(
    file_path: str, 
    line1: int, 
    line2: int, 
    _file_cache: dict | None = None
) -> bool:
    """
    Check if there's a function boundary between two line numbers.
    
    This reads the file and checks for function declaration patterns between
    the two lines. Used to prevent over-collapsing findings from different
    functions in the same file.
    
    Args:
        file_path: Path to the source file
        line1: First line number (1-based)
        line2: Second line number (1-based)
        _file_cache: Optional cache dict for file contents (keyed by file_path)
        
    Returns:
        True if a function boundary exists between the lines
    """
    # Ensure line1 < line2
    if line1 > line2:
        line1, line2 = line2, line1
    
    try:
        # Use cached file contents if available
        if _file_cache is not None and file_path in _file_cache:
            all_lines = _file_cache[file_path]
        else:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()
            # Cache for future calls
            if _file_cache is not None:
                _file_cache[file_path] = all_lines
        
        # Check lines between the two findings (exclusive of both finding lines)
        # line1 and line2 are 1-based, all_lines is 0-indexed
        # We want lines strictly between: from line1 (exclusive) to line2 (exclusive)
        # In 0-indexed terms: range(line1, line2 - 1) where line1 is already the line after finding 1
        # Actually: finding at line 21 means all_lines[20], finding at line 41 means all_lines[40]
        # We want to check all_lines[21] through all_lines[39] (lines 22-40 in 1-based)
        # That's range(line1, line2 - 1) in 0-indexed = range(21, 40)
        for line_num in range(line1, min(line2 - 1, len(all_lines))):
            line = all_lines[line_num]
            if _FUNCTION_BOUNDARY_RE.search(line):
                logger.debug(f"  Function boundary found at {file_path}:{line_num + 1}: {line.strip()[:50]}")
                return True
        
        return False
        
    except Exception as e:
        logger.warning(f"  Could not check function boundaries in {file_path}: {e}")
        # On error, be conservative - don't collapse
        return True


def _is_test_fixture(file_path: str, check_id: str = "") -> bool:
    """
    Check if a finding is in a test fixture file.

    IMPORTANT: This function checks FILE PATH only, never snippet content.
    The code_snippet is NOT passed to this function to prevent false positives
    from patterns like "challenge" matching code like "challengeUtils.solveIf()".

    Args:
        file_path: File path (will be normalized to forward slashes)
        check_id: Semgrep check ID (unused, kept for backwards compatibility)

    Returns:
        True if this is a test fixture that should be skipped
    """
    # Normalize path separators to forward slashes for consistent matching
    path_lower = file_path.lower().replace("\\", "/")
    for pattern in _FIXTURE_PATH_PATTERNS:
        if pattern.lower() in path_lower:
            return True

    return False


def _map_check_id_to_vuln_type(check_id: str) -> str:
    """
    Map Semgrep check_id to vulnerability type.

    Args:
        check_id: Semgrep check ID (e.g., "javascript.lang.security.audit.xss")

    Returns:
        Vulnerability type string
    """
    check_id_lower = check_id.lower()

    # Match longest pattern first to avoid short patterns shadowing specific ones
    # Example: "tainted-sql" should match before "sql" to ensure correct mapping
    # Example: "express-res-sendfile" should match before "sendfile"
    for pattern, vuln_type in sorted(CHECK_ID_TO_VULN_TYPE.items(), key=lambda x: -len(x[0])):
        if pattern in check_id_lower:
            return vuln_type

    # Default to security_misconfiguration
    return "security_misconfiguration"


def merge_semgrep_with_n_plus_one(
    semgrep_candidates: list[dict],
    n_plus_one_candidates: list[dict],
) -> list[dict]:
    """
    Merge Semgrep findings with N+1 detection results.

    Deduplicates by file_path and line_start.

    Args:
        semgrep_candidates: Candidates from Semgrep
        n_plus_one_candidates: Candidates from N+1 detection

    Returns:
        Merged list of unique candidates
    """
    seen = set()
    merged = []

    for candidate in semgrep_candidates + n_plus_one_candidates:
        key = (candidate.get("file_path", ""), candidate.get("line_start", 0))
        if key not in seen:
            seen.add(key)
            merged.append(candidate)

    logger.info(
        f"Merged {len(semgrep_candidates)} Semgrep + {len(n_plus_one_candidates)} N+1 "
        f"= {len(merged)} unique candidates"
    )
    return merged
