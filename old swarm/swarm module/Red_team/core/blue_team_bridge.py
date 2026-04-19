"""
Blue Team Bridge — Integrates Blue Team static analysis into Red Team operations.

This module provides the connection between:
- Blue Team: Static analysis, vulnerability detection (Semgrep, FalkorDB, etc.)
- Red Team: Live exploitation, kill chain execution

Flow:
1. Blue Team scans a repo → stores findings in Supabase (vulnerabilities table)
2. Red Team starts mission → queries Blue Team findings for same target
3. Commander uses findings to prioritize exploits
4. Gamma uses vulnerability details to craft targeted payloads

Usage:
    bridge = BlueTeamBridge()
    findings = await bridge.get_findings_for_target("https://github.com/user/repo")
    # or for live URL that maps to a repo
    findings = await bridge.get_findings_for_url("http://localhost:3000")
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class BlueTeamFinding:
    """A vulnerability finding from Blue Team static analysis."""

    # Required fields (identification)
    finding_id: str
    scan_id: str
    vuln_type: str  # sql_injection, xss, hardcoded_secret, etc.
    severity: str  # critical, high, medium, low
    file_path: str

    # Optional fields with defaults
    category: str | None = None
    line_start: int | None = None
    line_end: int | None = None
    title: str | None = None
    description: str | None = None
    code_snippet: str | None = None
    confirmed: bool = False
    confidence_score: float | None = None
    false_positive: bool = False
    fix_suggestion: str | None = None
    reproduction_test: str | None = None
    created_at: datetime | None = None
    repo_url: str | None = None
    exploit_suggestions: list[str] = field(default_factory=list)

    def to_recon_result(self) -> dict[str, Any]:
        """Convert to Red Team recon result format."""
        return {
            "source": "blue_team_static_analysis",
            "finding_id": self.finding_id,
            "vuln_type": self.vuln_type,
            "severity": self.severity,
            "file_path": self.file_path,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "title": self.title or f"{self.vuln_type} in {self.file_path}",
            "description": self.description,
            "code_snippet": self.code_snippet,
            "confidence": self.confidence_score or 0.8,
            "confirmed": self.confirmed,
            "exploit_suggestions": self.exploit_suggestions,
            "endpoint": self._extract_endpoint(),
        }

    def _extract_endpoint(self) -> str | None:
        """Extract API endpoint from file path for Red Team targeting.
        
        Converts Blue Team file paths like:
          /tmp/vibecheck/repos/xxx/routes/profileImageUrlUpload.ts
        To Red Team endpoints like:
          /api/profile-image-url-upload
        """
        if not self.file_path:
            return None
        
        # Extract filename from path
        filename = self.file_path.split('/')[-1].split('\\')[-1]
        if not filename:
            return None
            
        # Remove .ts extension
        filename = filename.replace('.ts', '').replace('.js', '')
        
        # Convert camelCase/PascalCase to kebab-case
        import re
        # Insert hyphens before capitals
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1-\2', filename)
        endpoint = re.sub('([a-z0-9])([A-Z])', r'\1-\2', s1).lower()
        
        # Map common route patterns
        if endpoint.startswith('profile'):
            return f'/api/{endpoint}'
        elif endpoint.startswith('address'):
            return f'/api/Addresss'
        elif 'upload' in endpoint:
            return f'/api/{endpoint}'
        elif endpoint.startswith('redirect'):
            return '/redirect'
        elif endpoint.startswith('recycles'):
            return '/api/Recycles'
        elif endpoint.startswith('quarantine'):
            return '/api/Products'
        elif endpoint.startswith('logfile'):
            return '/api/Logs'
        elif endpoint.startswith('key'):
            return '/api/Key'
        elif endpoint.startswith('data-erasure'):
            return '/api/Users'
        elif endpoint.startswith('update-user-profile'):
            return '/profile'
        elif endpoint.startswith('update-product-reviews'):
            return '/api/Products'
        elif endpoint.startswith('memory'):
            return '/api/Memory'
        elif endpoint.startswith('vuln-code-snippet'):
            return '/api/VulnCode'
        elif 'insecurity' in endpoint:
            return '/'  # Library file, no specific endpoint
        else:
            return f'/api/{endpoint}'

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "finding_id": self.finding_id,
            "scan_id": self.scan_id,
            "vuln_type": self.vuln_type,
            "severity": self.severity,
            "category": self.category,
            "file_path": self.file_path,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "title": self.title,
            "description": self.description,
            "code_snippet": self.code_snippet,
            "confirmed": self.confirmed,
            "confidence_score": self.confidence_score,
            "false_positive": self.false_positive,
            "fix_suggestion": self.fix_suggestion,
            "reproduction_test": self.reproduction_test,
            "repo_url": self.repo_url,
            "exploit_suggestions": self.exploit_suggestions,
        }

    def compute_exploit_suggestions(self) -> list[str]:
        """Generate exploitation suggestions based on vulnerability type."""
        suggestions = []

        vuln_type_lower = self.vuln_type.lower()

        if "sql" in vuln_type_lower or "sqli" in vuln_type_lower:
            suggestions = [
                f"Test SQL injection at lines {self.line_start}-{self.line_end}",
                "Try: ' OR '1'='1", "Try: UNION SELECT * FROM users",
                "Look for error-based SQLi in error messages",
            ]
        elif "xss" in vuln_type_lower:
            suggestions = [
                f"Test XSS at lines {self.line_start}-{self.line_end}",
                "Try: <script>alert(1)</script>",
                "Try: '><img src=x onerror=alert(1)>",
                "Check for CSP bypass opportunities",
            ]
        elif "path" in vuln_type_lower or "traversal" in vuln_type_lower:
            suggestions = [
                f"Test path traversal at lines {self.line_start}-{self.line_end}",
                "Try: ../../../etc/passwd",
                "Try: ....//....//etc/passwd (bypass filters)",
            ]
        elif "command" in vuln_type_lower or "rce" in vuln_type_lower:
            suggestions = [
                f"Test command injection at lines {self.line_start}-{self.line_end}",
                "Try: ; cat /etc/passwd",
                "Try: `whoami`",
                "Try: $(id)",
            ]
        elif "secret" in vuln_type_lower or "hardcoded" in vuln_type_lower:
            endpoint = self._extract_endpoint()
            suggestions = [
                f"Check hardcoded secrets in source code (affects {endpoint})",
                "Look for API keys, passwords, tokens in code",
                "Try these credentials against login endpoints",
            ]
        elif "auth" in vuln_type_lower or "jwt" in vuln_type_lower:
            suggestions = [
                f"Test authentication bypass at lines {self.line_start}-{self.line_end}",
                "Look for JWT weaknesses (none algorithm, weak signing)",
                "Test for IDOR vulnerabilities",
            ]
        elif "deserialize" in vuln_type_lower:
            suggestions = [
                f"Test deserialization at lines {self.line_start}-{self.line_end}",
                "Look for pickle, yaml.load, or JSON.parse vulnerabilities",
                "Try prototype pollution payloads",
            ]
        else:
            suggestions = [
                f"Investigate {self.vuln_type} at lines {self.line_start}-{self.line_end}",
                "Review code snippet for exploitation opportunities",
            ]

        return suggestions


class BlueTeamBridge:
    """
    Bridge between Blue Team static analysis and Red Team exploitation.

    Retrieves Blue Team findings and converts them to actionable intelligence
    for Red Team agents.
    """

    def __init__(self):
        self._supabase = None
        self._qdrant = None
        self._enabled = True

    async def _get_supabase(self):
        """Lazy load Supabase client."""
        if self._supabase is None:
            from core.supabase_client import get_supabase_client
            self._supabase = get_supabase_client()
        return self._supabase

    async def _get_qdrant(self):
        """Lazy load Qdrant client."""
        if self._qdrant is None:
            try:
                from core.qdrant_memory import qdrant_memory
                self._qdrant = qdrant_memory
            except Exception as e:
                logger.warning(f"Qdrant not available: {e}")
                self._qdrant = None
        return self._qdrant

    async def get_findings_for_target(
        self,
        target: str,
        min_severity: str = "medium",
        include_unconfirmed: bool = False,
    ) -> list[BlueTeamFinding]:
        """
        Retrieve Blue Team findings for a target.

        Args:
            target: Target URL, GitHub repo, or repo name
            min_severity: Minimum severity to include (critical, high, medium, low)
            include_unconfirmed: Whether to include unconfirmed findings

        Returns:
            List of BlueTeamFinding objects sorted by severity
        """
        logger.info(f"Querying Blue Team findings for target: {target}")

        findings = []

        # Try Supabase first
        supabase_findings = await self._get_from_supabase(
            target, min_severity, include_unconfirmed
        )
        findings.extend(supabase_findings)

        # If no Supabase results, try to match by repo URL patterns
        if not findings:
            findings = await self._get_by_repo_pattern(target, min_severity)
        
        # If still no findings and target looks like a repo, trigger Blue Team scan
        if not findings and self._looks_like_repo(target):
            logger.warning(f"No Blue Team findings for {target}, triggering auto-scan...")
            scan_triggered = await self._trigger_blue_team_scan(target)
            if scan_triggered:
                logger.info(f"Blue Team scan triggered for {target}, proceeding without findings for now")
                # Optionally wait a bit for scan to start populating
                await asyncio.sleep(2)
                # Try fetching again
                findings = await self._get_from_supabase(
                    target, min_severity, include_unconfirmed
                )

        # Sort by severity (critical first)
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        findings.sort(
            key=lambda f: (severity_order.get(f.severity, 4), -(f.confidence_score or 0))
        )

        # Compute exploitation suggestions
        for finding in findings:
            finding.exploit_suggestions = finding.compute_exploit_suggestions()

        logger.info(f"Retrieved {len(findings)} Blue Team findings for {target}")
        return findings

    async def _get_from_supabase(
        self,
        target: str,
        min_severity: str,
        include_unconfirmed: bool,
    ) -> list[BlueTeamFinding]:
        """Query Supabase for Blue Team findings."""
        try:
            supabase = await self._get_supabase()
        except RuntimeError as e:
            logger.debug(f"Supabase not initialized: {e}")
            return []

        if not supabase or not getattr(supabase, '_enabled', True):
            logger.debug("Supabase not available for Blue Team query")
            return []

        try:
            # Map severity to numeric filter
            severity_levels = {"critical": 4, "high": 3, "medium": 2, "low": 1}
            min_level = severity_levels.get(min_severity.lower(), 2)

            # Build query
            # First, find scans matching this target/repo
            import asyncio

            loop = asyncio.get_event_loop()

            # Extract repo name from target for filtering
            repo_name = self._extract_repo_name(target)
            logger.info(f"Extracted repo name '{repo_name}' from target '{target}'")
            
            # First, find matching scan_ids from scan_queue
            scan_ids = []
            if repo_name:
                # Query scan_queue for matching repos - get ALL matching scans
                scan_query = (
                    supabase.table("scan_queue")
                    .select("id, repo_url")
                    .ilike("repo_url", f"%{repo_name}%")
                    .limit(500)  # Increased limit to get more scans
                )
                scan_result = await loop.run_in_executor(None, lambda: scan_query.execute())
                if scan_result and hasattr(scan_result, 'data'):
                    scan_ids = [row['id'] for row in scan_result.data]
                    logger.info(f"Found {len(scan_ids)} matching scans for repo: {repo_name}")
            
            # For Juice Shop targets, try to find Juice Shop scans
            if not scan_ids and ("juice" in target.lower() or "3000" in target or "8080" in target):
                logger.info(f"[DEBUG] Searching for Juice Shop scans in Supabase for target: {target}")
                try:
                    scan_query = (
                        supabase.table("scan_queue")
                        .select("id, repo_url, created_at")
                        .ilike("repo_url", "%juice%")
                        .order("created_at", desc=True)
                        .limit(50)  # Get up to 50 scans
                    )
                    scan_result = await loop.run_in_executor(None, lambda: scan_query.execute())
                    if scan_result and hasattr(scan_result, 'data') and scan_result.data:
                        scan_ids = [row['id'] for row in scan_result.data]
                        logger.info(f"[DEBUG] Found {len(scan_ids)} Juice Shop scans")
                except Exception as e:
                    logger.error(f"[ERROR] Error querying scan_queue: {e}")
            
            # Query vulnerabilities table
            logger.info("Querying vulnerabilities table...")
            findings = []
            
            try:
                # Strategy 1: Filter by scan_ids if we found matching scans
                if scan_ids:
                    query = (
                        supabase.table("vulnerabilities")
                        .select("*")
                        .in_("scan_id", scan_ids)
                        .order("severity", desc=True)
                        .limit(500)
                    )
                    result = await loop.run_in_executor(None, lambda: query.execute())
                    if result and hasattr(result, 'data'):
                        findings = result.data
                        logger.info(f"Found {len(findings)} vulnerabilities matching scan_ids")
                
                # Strategy 2: If no findings, search by file_path containing repo name
                if not findings and repo_name:
                    logger.info(f"No scan_id matches, trying file_path search for: {repo_name}")
                    query = (
                        supabase.table("vulnerabilities")
                        .select("*")
                        .ilike("file_path", f"%juice-shop%")
                        .order("severity", desc=True)
                        .limit(500)
                    )
                    result = await loop.run_in_executor(None, lambda: query.execute())
                    if result and hasattr(result, 'data'):
                        findings = result.data
                        logger.info(f"Found {len(findings)} vulnerabilities by file_path pattern")
                
                # Strategy 3: Last resort - fetch recent high-severity vulnerabilities
                if not findings:
                    logger.info("No specific matches, fetching recent high-severity vulnerabilities")
                    query = (
                        supabase.table("vulnerabilities")
                        .select("*")
                        .in_("severity", ["critical", "high"])
                        .order("created_at", desc=True)
                        .limit(50)
                    )
                    result = await loop.run_in_executor(None, lambda: query.execute())
                    if result and hasattr(result, 'data'):
                        findings = result.data
                        logger.info(f"Found {len(findings)} recent high-severity vulnerabilities")
                
                if not findings:
                    logger.warning("No vulnerabilities found in database")
                    return []
                    
            except Exception as e:
                logger.error(f"Error querying vulnerabilities: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return []
            
            if not findings:
                logger.warning(f"Supabase query returned no data for target: {target}")
                return []
            
            logger.info(f"Supabase query returned {len(findings)} vulnerabilities")

            # Convert to BlueTeamFinding objects with deduplication
            findings_map = {}  # key: (file_path, vuln_type) -> finding
            
            for row in findings:
                # Filter by severity level
                row_severity = row.get("severity", "low").lower()
                if severity_levels.get(row_severity, 0) < min_level:
                    continue

                finding = BlueTeamFinding(
                    finding_id=str(row.get("id", "")),
                    scan_id=str(row.get("scan_id", "")),
                    vuln_type=row.get("type", "unknown"),
                    severity=row.get("severity", "low"),
                    category=row.get("category"),
                    file_path=row.get("file_path", ""),
                    line_start=row.get("line_start"),
                    line_end=row.get("line_end"),
                    title=row.get("title"),
                    description=row.get("description"),
                    code_snippet=row.get("code_snippet"),
                    confirmed=row.get("confirmed", False),
                    confidence_score=row.get("confidence_score"),
                    false_positive=row.get("false_positive", False),
                    fix_suggestion=row.get("fix_suggestion"),
                    reproduction_test=row.get("reproduction_test"),
                    repo_url=row.get("repo_url"),
                )

                # Parse created_at
                created_at_str = row.get("created_at")
                if created_at_str:
                    try:
                        finding.created_at = datetime.fromisoformat(
                            created_at_str.replace("Z", "+00:00")
                        )
                    except:
                        pass

                # Deduplication: use (endpoint, vuln_type, line_start) as key
                # This handles same vuln in same endpoint at same location
                endpoint = finding._extract_endpoint()
                dedup_key = (endpoint, finding.vuln_type, finding.line_start)
                if dedup_key in findings_map:
                    existing = findings_map[dedup_key]
                    severity_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
                    if severity_order.get(row_severity, 0) > severity_order.get(existing.severity, 0):
                        findings_map[dedup_key] = finding
                else:
                    findings_map[dedup_key] = finding

            findings = list(findings_map.values())
            logger.info(f"Deduplicated {len(result.data)} vulnerabilities to {len(findings)} unique findings")

            return findings

        except Exception as e:
            logger.error(f"Failed to query Supabase for Blue Team findings: {e}")
            return []

    async def _get_by_repo_pattern(self, target: str, min_severity: str) -> list[BlueTeamFinding]:
        """Try to match findings by repo URL pattern."""
        # Extract repo name from various URL formats
        repo_name = self._extract_repo_name(target)
        if not repo_name:
            return []

        logger.debug(f"Trying to match by repo name: {repo_name}")

        # Query with repo name pattern
        supabase = await self._get_supabase()
        if not supabase:
            return []

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            # Query by repo_url pattern
            result = await loop.run_in_executor(
                None,
                lambda: supabase.table("vulnerabilities")
                .select("*, scans!inner(repo_url)")
                .ilike("scans.repo_url", f"%{repo_name}%")
                .limit(50)
                .execute()
            )

            if not result or not hasattr(result, 'data'):
                return []

            findings = []
            for row in result.data:
                finding = BlueTeamFinding(
                    finding_id=str(row.get("id", "")),
                    scan_id=str(row.get("scan_id", "")),
                    vuln_type=row.get("type", "unknown"),
                    severity=row.get("severity", "low"),
                    file_path=row.get("file_path", ""),
                    line_start=row.get("line_start"),
                    line_end=row.get("line_end"),
                    title=row.get("title"),
                    description=row.get("description"),
                    code_snippet=row.get("code_snippet"),
                    confirmed=row.get("confirmed", False),
                    confidence_score=row.get("confidence_score"),
                )
                findings.append(finding)

            return findings

        except Exception as e:
            logger.error(f"Failed repo pattern query: {e}")
            return []

    def _extract_repo_name(self, target: str) -> str | None:
        """Extract repo name from various URL formats."""
        import re

        # GitHub HTTPS: https://github.com/user/repo
        match = re.search(r'github\.com/[^/]+/([^/]+)', target)
        if match:
            return match.group(1).replace('.git', '')

        # Git SSH: git@github.com:user/repo.git
        match = re.search(r'github\.com:([^/]+)/([^/]+)', target)
        if match:
            return match.group(2).replace('.git', '')

        # Localhost with port - check for known app patterns
        localhost_match = re.search(r'localhost:(\d+)', target.lower())
        if localhost_match:
            port = localhost_match.group(1)
            # Map common ports to app names
            port_to_app = {
                '3000': 'juice-shop',
                '8080': 'juice-shop',
                '8000': 'app',
            }
            return port_to_app.get(port)

        # Just repo name
        if '/' not in target and len(target) > 0:
            return target

        return None

    def _looks_like_repo(self, target: str) -> bool:
        """Check if target looks like a repository URL or name."""
        import re
        # GitHub URL patterns
        if re.search(r'github\.com/[^/]+/[^/]+', target):
            return True
        # Git SSH pattern
        if re.search(r'git@github\.com:', target):
            return True
        # Simple repo name (no slashes, reasonable length)
        if '/' not in target and len(target) > 0 and len(target) < 100:
            return True
        return False

    async def _trigger_blue_team_scan(self, target: str) -> bool:
        """
        Trigger a Blue Team scan for the target.
        
        Returns:
            True if scan was triggered successfully
        """
        import os
        import httpx
        
        # Get Blue Team API URL from environment or use default
        blue_team_api = os.getenv("BLUE_TEAM_API_URL", "http://localhost:8000")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{blue_team_api}/api/v1/scan/trigger",
                    json={
                        "repo_url": target,
                        "project_name": target.split('/')[-1].replace('.git', '') if '/' in target else target,
                        "triggered_by": "red_team_auto",
                        "priority": "high"
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Blue Team scan triggered: {result.get('scan_id')}")
                    return True
                else:
                    logger.error(f"Failed to trigger Blue Team scan: HTTP {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"Error triggering Blue Team scan: {e}")
            return False

    def get_prioritized_attack_surface(
        self,
        findings: list[BlueTeamFinding],
    ) -> dict[str, list[BlueTeamFinding]]:
        """
        Organize findings into attack surface categories.

        Returns:
            Dict mapping attack categories to relevant findings
        """
        attack_surface = {
            "injection_points": [],  # SQLi, XSS, Command Injection
            "authentication": [],    # Auth bypass, JWT issues, hardcoded secrets
            "sensitive_data": [],    # Secrets, PII exposure
            "access_control": [],    # IDOR, path traversal
            "configuration": [],     # CORS, security headers
            "business_logic": [],    # Logic flaws, race conditions
        }

        for finding in findings:
            vuln_type = finding.vuln_type.lower()

            if any(t in vuln_type for t in ["sql", "xss", "command", "inject"]):
                attack_surface["injection_points"].append(finding)
            elif any(t in vuln_type for t in ["auth", "jwt", "session"]):
                attack_surface["authentication"].append(finding)
            elif any(t in vuln_type for t in ["secret", "hardcoded", "password"]):
                attack_surface["sensitive_data"].append(finding)
            elif any(t in vuln_type for t in ["path", "traversal", "idor"]):
                attack_surface["access_control"].append(finding)
            elif any(t in vuln_type for t in ["cors", "header", "config"]):
                attack_surface["configuration"].append(finding)
            else:
                attack_surface["business_logic"].append(finding)

        return attack_surface

    def format_for_commander(self, findings: list[BlueTeamFinding]) -> str:
        """
        Format Blue Team findings as intelligence brief for Commander agent.

        Returns:
            Formatted intelligence brief string
        """
        if not findings:
            return "No Blue Team static analysis findings available. Proceed with standard reconnaissance."

        attack_surface = self.get_prioritized_attack_surface(findings)

        brief_lines = [
            "═" * 60,
            "BLUE TEAM STATIC ANALYSIS INTELLIGENCE BRIEF",
            "═" * 60,
            f"Total Findings: {len(findings)}",
            "",
            "ATTACK SURFACE ANALYSIS:",
            "",
        ]

        for category, cat_findings in attack_surface.items():
            if cat_findings:
                brief_lines.append(f"  {category.upper().replace('_', ' ')}:")
                for f in cat_findings[:5]:  # Top 5 per category
                    brief_lines.append(f"    • [{f.severity.upper()}] {f.title or f.vuln_type}")
                    # Show endpoint instead of file path
                    endpoint = f._extract_endpoint()
                    if endpoint:
                        brief_lines.append(f"      Endpoint: {endpoint}")
                    # Also show line info if available
                    if f.line_start:
                        brief_lines.append(f"      Code Location: Line {f.line_start}")
                    if f.exploit_suggestions:
                        brief_lines.append(f"      Suggested: {f.exploit_suggestions[0]}")
                if len(cat_findings) > 5:
                    brief_lines.append(f"    ... and {len(cat_findings) - 5} more")
                brief_lines.append("")

        brief_lines.extend([
            "EXPLOITATION PRIORITIES:",
            "1. Start with confirmed high/critical findings",
            "2. Use code snippets to craft targeted payloads",
            "3. Test injection points with context-aware payloads",
            "4. Try hardcoded credentials against login endpoints",
            "",
            "═" * 60,
        ])

        return "\n".join(brief_lines)


# Global bridge instance
_blue_team_bridge: BlueTeamBridge | None = None


def get_blue_team_bridge() -> BlueTeamBridge:
    """Get or create global Blue Team bridge instance."""
    global _blue_team_bridge
    if _blue_team_bridge is None:
        _blue_team_bridge = BlueTeamBridge()
    return _blue_team_bridge


async def enrich_state_with_blue_team_findings(
    state: dict[str, Any],
    target: str,
) -> dict[str, Any]:
    """
    Enrich Red Team state with Blue Team findings.

    This function is called at mission start to inject Blue Team intelligence
    into the Red Team workflow.

    Args:
        state: Current Red Team state
        target: Target being analyzed

    Returns:
        Updated state with blue_team_findings key
    """
    bridge = get_blue_team_bridge()

    # Get findings
    findings = await bridge.get_findings_for_target(target)

    # Convert to recon results format
    recon_results = [f.to_recon_result() for f in findings]

    # Add to state
    state["blue_team_findings"] = findings
    state["blue_team_recon_results"] = recon_results
    state["blue_team_intelligence_brief"] = bridge.format_for_commander(findings)

    # Also add to blackboard for cross-agent visibility
    if findings:
        from agents.a2a.blackboard import Blackboard

        mission_id = state.get("mission_id", "unknown")
        blackboard = Blackboard(mission_id)

        await blackboard.write("blue_team_findings_count", len(findings))
        
        # Convert attack surface to serializable format
        attack_surface = bridge.get_prioritized_attack_surface(findings)
        serializable_surface = {
            category: [f.to_dict() for f in findings_list]
            for category, findings_list in attack_surface.items()
        }
        await blackboard.write("blue_team_attack_surface", serializable_surface)

        # Store high-confidence findings individually
        high_conf = [f for f in findings if f.confidence_score and f.confidence_score > 0.8]
        for i, finding in enumerate(high_conf[:10]):
            await blackboard.write(f"blue_finding_{i}", finding.to_recon_result())

    logger.info(f"Enriched state with {len(findings)} Blue Team findings")

    return state
