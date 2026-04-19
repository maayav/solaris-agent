"""
Mission Report Generator — Creates comprehensive reports after mission completion.

Generates JSON and text reports summarizing:
- Mission objectives and targets
- Reconnaissance findings
- Exploitation results
- Kill chain progress
- Recommendations
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents.a2a.messages import A2AMessage, MessageType, AgentRole
from agents.state import RedTeamState

logger = logging.getLogger(__name__)

# Impact labels mapping for kill chain narrative
IMPACT_LABELS = {
    "sqli": "Database Access / Auth Bypass",
    "idor": "Unauthorized Data Access",
    "sensitive_data_exposure": "Sensitive File Exposure",
    "xss": "Script Injection (DOM/Stored)",
    "auth_bypass": "Authentication Bypass",
    "info_disclosure": "Information Leakage",
    "xxe": "XML External Entity Injection",
    "authentication": "Authentication Weakness",
    "client_side_bypass": "Client-Side Security Bypass",
    "lfi": "Local File Inclusion",
    "rfi": "Remote File Inclusion",
    "rce": "Remote Code Execution",
    "broken_access_control": "Access Control Violation",
    "security_misconfiguration": "Security Misconfiguration",
}


def _deduplicate_findings(findings: list[dict[str, Any]], key_fields: list[str] = None) -> list[dict[str, Any]]:
    """
    Deduplicate findings based on specified key fields.
    
    Args:
        findings: List of finding dicts
        key_fields: Fields to use for deduplication (default: ['asset', 'finding'])
    
    Returns:
        Deduplicated list of findings
    """
    if key_fields is None:
        key_fields = ["asset", "finding"]
    
    seen = set()
    deduplicated = []
    
    for finding in findings:
        # Create a unique key from the specified fields
        key = tuple(finding.get(field, "") for field in key_fields)
        
        if key not in seen:
            seen.add(key)
            deduplicated.append(finding)
    
    logger.info(f"Deduplicated {len(findings)} findings to {len(deduplicated)}")
    return deduplicated


def _deduplicate_exploits(exploits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Deduplicate exploitation results keeping the BEST outcome per endpoint+vector.
    
    Priority: success=True > connection_timeout > auth_required > other failures
    This prevents reporting both WIN and FAIL for the same endpoint.
    """
    from collections import defaultdict
    
    # Group exploits by (target, exploit_type) - ignore success flag for grouping
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    
    for exploit in exploits:
        key = (exploit.get("target", ""), exploit.get("exploit_type", ""))
        grouped[key].append(exploit)
    
    # Keep the best result from each group
    deduplicated = []
    for key, group in grouped.items():
        # Sort by priority: success=True first, then by error type
        def sort_priority(exploit):
            if exploit.get("success"):
                return (0, 0)  # Success always wins
            error_type = exploit.get("error_type", "").lower()
            if error_type == "connection_timeout":
                return (1, 0)  # Network issues are "soft" failures
            if error_type == "auth_required":
                return (2, 0)  # Auth failures might be retryable
            return (3, 0)  # Other failures
        
        # Get the best (lowest priority number) exploit
        best = min(group, key=sort_priority)
        deduplicated.append(best)
    
    logger.info(f"Deduplicated {len(exploits)} exploits to {len(deduplicated)} (kept best per endpoint)")
    return deduplicated


def generate_mission_report(state: RedTeamState) -> dict[str, Any]:
    """
    Generate a comprehensive mission report from the final state.
    
    Returns a dict containing the full report data.
    """
    report = {
        "report_metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mission_id": state.get("mission_id", "unknown"),
            "report_version": "1.0",
        },
        "mission_summary": {
            "objective": state.get("objective", ""),
            "target": state.get("target", ""),
            "final_phase": state.get("phase", "unknown"),
            "iterations_completed": state.get("iteration", 0),
            "max_iterations": state.get("max_iterations", 0),
            "strategy": state.get("strategy", ""),
        },
        "reconnaissance_findings": _extract_recon_findings(state),
        "exploitation_results": _extract_exploit_results(state),
        "kill_chain_progress": _analyze_kill_chain(state),
        "statistics": _compute_statistics(state),
        "recommendations": _generate_recommendations(state),
        "errors": state.get("errors", []),
    }
    
    return report


def _extract_recon_findings(state: RedTeamState) -> list[dict[str, Any]]:
    """Extract and format reconnaissance findings with deduplication."""
    findings = []
    
    for msg in state.get("messages", []):
        if isinstance(msg, A2AMessage) and msg.type == MessageType.INTELLIGENCE_REPORT:
            payload = msg.payload
            findings.append({
                "asset": payload.get("asset", "unknown"),
                "finding": payload.get("finding", ""),
                "confidence": payload.get("confidence", 0.0),
                "evidence": payload.get("evidence", ""),
                "cve_hint": payload.get("cve_hint"),
                "recommended_action": payload.get("recommended_action", ""),
                "priority": msg.priority.value if hasattr(msg.priority, 'value') else str(msg.priority),
            })
    
    # Also include recon_results from state
    for result in state.get("recon_results", []):
        if result not in findings:
            findings.append(result)
    
    # Deduplicate findings
    return _deduplicate_findings(findings)


def _extract_exploit_results(state: RedTeamState) -> list[dict[str, Any]]:
    """Extract and format exploitation results with deduplication."""
    results = []
    
    for msg in state.get("messages", []):
        if isinstance(msg, A2AMessage) and msg.type == MessageType.EXPLOIT_RESULT:
            payload = msg.payload
            results.append({
                "target": payload.get("target", "unknown"),
                "exploit_type": payload.get("exploit_type", "unknown"),
                "success": payload.get("success", False),
                "payload_used": payload.get("payload_used", ""),
                "response_code": payload.get("response_code"),
                "evidence": payload.get("evidence", ""),
                "impact": payload.get("impact", ""),
                "priority": msg.priority.value if hasattr(msg.priority, 'value') else str(msg.priority),
            })
    
    # Also include exploit_results from state
    for result in state.get("exploit_results", []):
        if result not in results:
            results.append(result)
    
    # Deduplicate exploits
    return _deduplicate_exploits(results)


def _build_kill_chain_narrative(state: RedTeamState) -> list[dict[str, Any]]:
    """
    Build the kill chain narrative showing how exploits chain together.
    Format: Finding A → Asset B → Exploit C
    """
    narrative = []
    
    # Get discovered credentials for chaining context
    credentials = state.get("discovered_credentials", {})
    
    # Build narrative from exploit results
    exploit_results = state.get("exploit_results", [])
    recon_results = state.get("recon_results", [])
    
    for i, exploit in enumerate(exploit_results):
        if exploit.get("success"):
            # Find related recon finding
            related_finding = None
            for finding in recon_results:
                if finding.get("asset") in exploit.get("target", ""):
                    related_finding = finding
                    break
            
            # Get proper impact label based on exploit type
            exploit_type = exploit.get("exploit_type", "unknown")
            impact_label = IMPACT_LABELS.get(exploit_type, "Security Weakness Exploited")
            
            narrative.append({
                "step": i + 1,
                "phase": "exploitation",
                "finding": related_finding.get("finding", "Unknown vulnerability") if related_finding else "Discovered weakness",
                "asset": exploit.get("target", "Unknown"),
                "exploit_type": exploit_type,
                "impact": impact_label,
                "evidence": exploit.get("evidence", "")[:200],
                "credentials_discovered": bool(credentials),
            })
    
    return narrative


def _analyze_kill_chain(state: RedTeamState) -> dict[str, Any]:
    """Analyze kill chain progress based on findings."""
    phases_completed = []
    
    # Reconnaissance
    if state.get("recon_results") or any(
        isinstance(msg, A2AMessage) and msg.type == MessageType.INTELLIGENCE_REPORT
        for msg in state.get("messages", [])
    ):
        phases_completed.append("reconnaissance")
    
    # Weaponization (exploit planning)
    if state.get("current_tasks"):
        phases_completed.append("weaponization")
    
    # Exploitation
    if state.get("exploit_results") or any(
        isinstance(msg, A2AMessage) and msg.type == MessageType.EXPLOIT_RESULT
        for msg in state.get("messages", [])
    ):
        phases_completed.append("exploitation")
    
    # Installation (credentials/token discovery)
    if state.get("discovered_credentials"):
        phases_completed.append("installation")
    
    # Command & Control (pivot to admin/data endpoints)
    if any(
        e.get("exploit_type") in ["idor", "auth_bypass", "data_exfiltration"]
        for e in state.get("exploit_results", [])
        if e.get("success")
    ):
        phases_completed.append("c2")
    
    # Check for successful exploits
    successful_exploits = [
        e for e in state.get("exploit_results", [])
        if e.get("success", False)
    ]
    
    if successful_exploits:
        phases_completed.append("actions_on_objectives")
    
    # Build narrative
    narrative = _build_kill_chain_narrative(state)
    
    return {
        "phases_completed": phases_completed,
        "total_phases": 7,  # Standard cyber kill chain
        "progress_percentage": round(len(phases_completed) / 7 * 100, 1),
        "successful_exploits": len(successful_exploits),
        "narrative": narrative,
    }


def _compute_statistics(state: RedTeamState) -> dict[str, Any]:
    """Compute mission statistics."""
    messages = state.get("messages", [])
    
    intel_reports = sum(
        1 for msg in messages
        if isinstance(msg, A2AMessage) and msg.type == MessageType.INTELLIGENCE_REPORT
    )
    
    exploit_results = sum(
        1 for msg in messages
        if isinstance(msg, A2AMessage) and msg.type == MessageType.EXPLOIT_RESULT
    )
    
    # Count successful exploits from both state and messages (like _extract_exploit_results does)
    successful_exploits = sum(
        1 for e in state.get("exploit_results", [])
        if e.get("success", False)
    )
    # Also count from messages
    for msg in messages:
        if isinstance(msg, A2AMessage) and msg.type == MessageType.EXPLOIT_RESULT:
            if msg.payload.get("success", False):
                successful_exploits += 1
    
    high_confidence_findings = sum(
        1 for f in state.get("recon_results", [])
        if f.get("confidence", 0) >= 0.8
    )
    
    return {
        "total_messages": len(messages),
        "intel_reports": intel_reports,
        "exploit_attempts": exploit_results,
        "successful_exploits": successful_exploits,
        "high_confidence_findings": high_confidence_findings,
        "reflection_count": state.get("reflection_count", 0),
        "errors_count": len(state.get("errors", [])),
    }


def _generate_recommendations(state: RedTeamState) -> list[str]:
    """Generate recommendations based on findings."""
    recommendations = []
    
    # Check for CVE hints
    cve_hints = set()
    for finding in state.get("recon_results", []):
        if finding.get("cve_hint"):
            cve_hints.add(finding["cve_hint"])
    
    if cve_hints:
        recommendations.append(f"Review and patch identified CVEs: {', '.join(cve_hints)}")
    
    # Check for successful exploits
    successful = [e for e in state.get("exploit_results", []) if e.get("success")]
    if successful:
        recommendations.append("CRITICAL: Successful exploits detected - immediate remediation required")
        for exp in successful:
            recommendations.append(f"  - {exp.get('exploit_type', 'Unknown')} on {exp.get('target', 'unknown')}")
    
    # Check for high confidence findings
    high_conf = [f for f in state.get("recon_results", []) if f.get("confidence", 0) >= 0.8]
    if high_conf:
        recommendations.append(f"Review {len(high_conf)} high-confidence reconnaissance findings")
    
    # Check for open ports/services
    for finding in state.get("recon_results", []):
        if "port" in finding.get("asset", "").lower() or "open" in finding.get("finding", "").lower():
            recommendations.append("Review exposed services and close unnecessary ports")
            break
    
    # General recommendations if no specific ones
    if not recommendations:
        recommendations.append("Continue monitoring and periodic security assessments")
    
    return recommendations


def format_report_text(report: dict[str, Any]) -> str:
    """Format the report as human-readable text."""
    lines = []
    
    # ═══════════════════════════════════════════════════════════════════════
    # VIBECHECK ENTERPRISE SECURITY - PROFESSIONAL REPORT HEADER
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("╔" + "═" * 78 + "╗")
    lines.append("║" + " " * 20 + "VIBECHECK ENTERPRISE SECURITY" + " " * 29 + "║")
    lines.append("║" + " " * 18 + "AUTONOMOUS RED TEAM ASSESSMENT" + " " * 28 + "║")
    lines.append("╠" + "═" * 78 + "╣")
    lines.append("║  CONFIDENTIAL - PROPRIETARY SECURITY INTELLIGENCE" + " " * 38 + "║")
    lines.append("╚" + "═" * 78 + "╝")
    lines.append("")
    
    # Metadata
    meta = report.get("report_metadata", {})
    summary = report.get("mission_summary", {})
    lines.append(f"Report ID:      {meta.get('mission_id', 'unknown')}")
    lines.append(f"Generated:      {meta.get('generated_at', 'unknown')}")
    lines.append(f"Target:         {summary.get('target', 'N/A')}")
    lines.append(f"Classification: CONFIDENTIAL - EXECUTIVE REVIEW")
    lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # CYBER-THREAT LANDSCAPE SUMMARY
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("┌" + "─" * 78 + "┐")
    lines.append("│" + " " * 25 + "CYBER-THREAT LANDSCAPE" + " " * 31 + "│")
    lines.append("└" + "─" * 78 + "┘")
    lines.append("")
    
    kc = report.get("kill_chain_progress", {})
    stats = report.get("statistics", {})
    
    lines.append(f"  ► Mission Objective: {summary.get('objective', 'N/A')}")
    lines.append(f"  ► Kill Chain Progress: {kc.get('progress_percentage', 0)}% ({', '.join(kc.get('phases_completed', []))})")
    lines.append(f"  ► Attack Vectors Tested: {stats.get('exploit_attempts', 0)}")
    lines.append(f"  ► Successful Compromises: {stats.get('successful_exploits', 0)}")
    lines.append(f"  ► Critical Findings: {stats.get('high_confidence_findings', 0)}")
    lines.append(f"  ► Risk Level: {'HIGH' if stats.get('successful_exploits', 0) > 0 else 'MEDIUM' if stats.get('exploit_attempts', 0) > 0 else 'LOW'}")
    lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # EXECUTIVE SUMMARY
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("=" * 80)
    lines.append("EXECUTIVE SUMMARY")
    lines.append("=" * 80)
    lines.append("")
    successful_exploits = stats.get('successful_exploits', 0)
    if successful_exploits > 0:
        lines.append(f"⚠️  CRITICAL: {successful_exploits} successful exploitation(s) confirmed. Immediate")
        lines.append("   remediation is required to prevent unauthorized access and data exfiltration.")
    else:
        lines.append("✓  No successful exploitations detected during this assessment period.")
        lines.append("   However, continued vigilance and defense hardening are recommended.")
    lines.append("")
    strategy = summary.get('strategy', 'N/A') or 'N/A'
    lines.append(f"Strategy: {str(strategy)[:250]}...")
    lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # DETAILED FINDINGS
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("-" * 80)
    lines.append("MISSION DETAILS")
    lines.append("-" * 80)
    lines.append(f"Final Phase: {summary.get('final_phase', 'unknown')}")
    lines.append(f"Iterations Completed: {summary.get('iterations_completed', 0)}/{summary.get('max_iterations', 0)}")
    lines.append("")
    
    # Kill Chain
    lines.append("-" * 80)
    lines.append("KILL CHAIN PROGRESS")
    lines.append("-" * 80)
    kc = report.get("kill_chain_progress", {})
    lines.append(f"  Reconnaissance:     {'✓ COMPLETE' if 'reconnaissance' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  Weaponization:      {'✓ COMPLETE' if 'weaponization' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  Exploitation:       {'✓ COMPLETE' if 'exploitation' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  Installation:       {'✓ COMPLETE' if 'installation' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  C2:                 {'✓ COMPLETE' if 'c2' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  Actions on Obj:     {'✓ COMPLETE' if 'actions_on_objectives' in kc.get('phases_completed', []) else '○ PENDING'}")
    lines.append(f"  Overall Progress:   {kc.get('progress_percentage', 0)}%")
    lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # KILL CHAIN NARRATIVE
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("=" * 80)
    lines.append("KILL CHAIN NARRATIVE (Attack Progression)")
    lines.append("=" * 80)
    lines.append("")
    
    narrative = kc.get("narrative", [])
    if narrative:
        lines.append("  Attack Chain: Finding → Asset → Exploit → Impact")
        lines.append("")
        for step in narrative:
            lines.append(f"  Step {step['step']}: {step['phase'].upper()}")
            lines.append(f"    ├─ Finding: {step['finding'][:80]}...")
            lines.append(f"    ├─ Asset:   {step['asset']}")
            lines.append(f"    ├─ Vector:  {step['exploit_type'].upper()}")
            # Show impact label based on exploit type
            impact = step.get('impact', 'Security Weakness Exploited')
            lines.append(f"    └─ Result:  ✓ SUCCESS ({impact})")
            lines.append("")
        
        # Show chain summary
        if len(narrative) > 1:
            chain = " → ".join([s['exploit_type'].upper() for s in narrative])
            lines.append(f"  Chain Summary: {chain}")
            lines.append("")
    else:
        lines.append("  No successful kill chain progression recorded.")
    lines.append("")
    
    # Recon Findings
    lines.append("-" * 80)
    lines.append("RECONNAISSANCE FINDINGS")
    lines.append("-" * 80)
    for i, finding in enumerate(report.get("reconnaissance_findings", []), 1):
        lines.append(f"\n  [{i}] ASSET: {finding.get('asset', 'unknown')}")
        lines.append(f"      Finding:     {finding.get('finding', 'N/A')}")
        lines.append(f"      Confidence:  {finding.get('confidence', 0):.0%}")
        if finding.get('cve_hint'):
            lines.append(f"      ⚠️ CVE:       {finding['cve_hint']}")
        if finding.get('recommended_action'):
            lines.append(f"      Action:      {finding['recommended_action']}")
    
    if not report.get("reconnaissance_findings"):
        lines.append("  No reconnaissance findings recorded.")
    lines.append("")
    
    # Exploitation Results
    lines.append("-" * 80)
    lines.append("EXPLOITATION RESULTS")
    lines.append("-" * 80)
    
    # Summary Table
    exploit_results = report.get("exploitation_results", [])
    if exploit_results:
        lines.append("")
        lines.append("┌─────────────────────────┬─────────┬──────┬──────────┐")
        lines.append("│ Exploit                 │ Status  │ Time │ Severity │")
        lines.append("├─────────────────────────┼─────────┼──────┼──────────┤")
        
        for result in exploit_results:
            exploit = result.get("exploit_type", "unknown")[:23].ljust(23)
            status = ("✅ WIN" if result.get("success") else "❌ FAIL").ljust(7)
            exec_time = result.get("execution_time", 0.0)
            time_val = f"{exec_time:.1f}s".ljust(4)
            severity = result.get("severity", "N/A").upper().ljust(8)
            lines.append(f"│ {exploit} │ {status} │ {time_val} │ {severity} │")
        
        lines.append("└─────────────────────────┴─────────┴──────┴──────────┘")
        
        # Calculate stats
        total = len(exploit_results)
        wins = sum(1 for r in exploit_results if r.get("success"))
        lines.append(f"\n📊 SUMMARY: {wins}/{total} exploits successful ({100*wins/total:.0f}% success rate)")
        lines.append("")
    
    for i, result in enumerate(exploit_results, 1):
        status = "✓ SUCCESS" if result.get("success") else "✗ FAILED"
        lines.append(f"\n  [{i}] [{status}] {result.get('exploit_type', 'unknown').upper()}")
        lines.append(f"      Target:   {result.get('target', 'unknown')}")
        if result.get('impact'):
            lines.append(f"      Impact:   {result['impact']}")
        if result.get('evidence'):
            lines.append(f"      Evidence: {result['evidence'][:200]}...")
    
    if not exploit_results:
        lines.append("  No exploitation attempts recorded.")
    lines.append("")
    
    # Statistics
    lines.append("-" * 80)
    lines.append("MISSION STATISTICS")
    lines.append("-" * 80)
    stats = report.get("statistics", {})
    lines.append(f"  Total Messages:          {stats.get('total_messages', 0)}")
    lines.append(f"  Intelligence Reports:    {stats.get('intel_reports', 0)}")
    lines.append(f"  Exploit Attempts:        {stats.get('exploit_attempts', 0)}")
    lines.append(f"  Successful Exploits:     {stats.get('successful_exploits', 0)}")
    lines.append(f"  High Confidence Findings: {stats.get('high_confidence_findings', 0)}")
    lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # RECOMMENDATIONS
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("=" * 80)
    lines.append("PRIORITY REMEDIATION RECOMMENDATIONS")
    lines.append("=" * 80)
    lines.append("")
    for i, rec in enumerate(report.get("recommendations", []), 1):
        prefix = "🚨" if "CRITICAL" in rec else "⚠️" if "immediate" in rec.lower() else "•"
        lines.append(f"  {prefix} {rec}")
    
    if not report.get("recommendations"):
        lines.append("  No critical recommendations at this time.")
    lines.append("")
    
    # Errors
    if report.get("errors"):
        lines.append("-" * 80)
        lines.append("SYSTEM ERRORS")
        lines.append("-" * 80)
        for err in report["errors"]:
            lines.append(f"  ! {err}")
        lines.append("")
    
    # ═══════════════════════════════════════════════════════════════════════
    # FOOTER
    # ═══════════════════════════════════════════════════════════════════════
    lines.append("")
    lines.append("╔" + "═" * 78 + "╗")
    lines.append("║" + " " * 10 + "© 2025 VibeCheck Enterprise Security - All Rights Reserved" + " " * 10 + "║")
    lines.append("║" + " " * 8 + "This report contains confidential security information." + " " * 13 + "║")
    lines.append("║" + " " * 8 + "Distribution limited to authorized personnel only." + " " * 18 + "║")
    lines.append("╚" + "═" * 78 + "╝")
    lines.append("")
    lines.append("Report Generated by VibeCheck Autonomous Red Team Platform")
    lines.append("For inquiries: security@vibecheck.enterprise")
    lines.append("")
    lines.append("=" * 80)
    lines.append("END OF REPORT")
    lines.append("=" * 80)
    
    return "\n".join(lines)


async def save_report(report: dict[str, Any], output_dir: str = "reports") -> tuple[str, str]:
    """
    Save report to files.
    
    Returns tuple of (json_path, text_path).
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    mission_id = report.get("report_metadata", {}).get("mission_id", "unknown")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"mission_{mission_id}_{timestamp}"
    
    # Save JSON
    json_path = output_path / f"{base_name}.json"
    with open(json_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    logger.info("JSON report saved to %s", json_path)
    
    # Save text
    text_path = output_path / f"{base_name}.txt"
    text_content = format_report_text(report)
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(text_content)
    logger.info("Text report saved to %s", text_path)
    
    return str(json_path), str(text_path)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: STREAMLINED SUPABASE REPORT GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

async def generate_supabase_report(
    mission_id: str,
    target: str,
    objective: str,
    state: RedTeamState | None = None,
) -> dict[str, Any]:
    """
    Step 4: Streamlined report generation using Supabase.
    
    1. Queries mission_events from Supabase (instead of keeping in RAM)
    2. Builds kill chain narrative from events
    3. Generates JSON and Markdown reports
    4. Uploads to Supabase vibecheck_reports bucket
    5. Returns public URLs for both reports
    
    Args:
        mission_id: The mission ID
        target: Target URL/hostname
        objective: Mission objective
        state: Optional RedTeamState for additional context
        
    Returns:
        Dict with report URLs and metadata
    """
    import tempfile
    from core.supabase_client import get_supabase_client
    
    logger.info(f"Step 4: Generating Supabase report for mission {mission_id}")
    
    try:
        # Initialize Supabase client
        supabase = get_supabase_client()
        
        # Step 4.1: Query mission events from Supabase (not from RAM)
        events = []
        if supabase._enabled:
            try:
                events = await supabase.get_mission_events(mission_id)
                logger.info(f"Retrieved {len(events)} events from Supabase for mission {mission_id}")
            except Exception as e:
                logger.warning(f"Could not retrieve events from Supabase: {e}")
        
        # Step 4.2: Build kill chain narrative from events
        kill_chain_narrative = _build_kill_chain_from_events(events)
        
        # Step 4.3: Extract findings from events
        exploit_events = [e for e in events if e.get("event_type") == "action" and "critic" in e.get("message", "")]
        successful_exploits = [e for e in exploit_events 
                               if e.get("payload_json", {}).get("success", False)]
        
        # Step 4.4: Generate structured report
        report_data = {
            "report_metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "mission_id": mission_id,
                "report_version": "2.0",
                "generated_by": "VibeCheck Step 4 Streamlined Reporter",
            },
            "mission_summary": {
                "objective": objective,
                "target": target,
                "total_events": len(events),
                "successful_exploits": len(successful_exploits),
                "failed_exploits": len(exploit_events) - len(successful_exploits),
            },
            "kill_chain_narrative": kill_chain_narrative,
            "exploitation_results": [
                {
                    "timestamp": e.get("timestamp"),
                    "exploit_type": e.get("payload_json", {}).get("exploit_type", "unknown"),
                    "success": e.get("payload_json", {}).get("success", False),
                    "severity": e.get("payload_json", {}).get("severity", "low"),
                    "error_type": e.get("payload_json", {}).get("error_type", "unknown"),
                    "feedback": e.get("payload_json", {}).get("feedback", ""),
                }
                for e in exploit_events
            ],
            "recommendations": _generate_recommendations_from_events(events),
        }
        
        # Step 4.5: Generate JSON report
        json_content = json.dumps(report_data, indent=2, default=str)
        json_bytes = json_content.encode("utf-8")
        
        # Step 4.6: Generate Markdown report (human-readable kill chain)
        markdown_content = _generate_markdown_report(report_data, kill_chain_narrative)
        markdown_bytes = markdown_content.encode("utf-8")
        
        # Step 4.7: Upload to Supabase Storage
        json_url = None
        markdown_url = None
        
        if supabase._enabled:
            try:
                # Upload JSON report
                json_url = await supabase.upload_report(
                    mission_id=mission_id,
                    file_content=json_bytes,
                    file_name=f"{mission_id}_report.json",
                    content_type="application/json",
                )
                logger.info(f"JSON report uploaded: {json_url}")
                
                # Upload Markdown report
                markdown_url = await supabase.upload_report(
                    mission_id=mission_id,
                    file_content=markdown_bytes,
                    file_name=f"{mission_id}_report.md",
                    content_type="text/markdown",
                )
                logger.info(f"Markdown report uploaded: {markdown_url}")
                
            except Exception as e:
                logger.error(f"Supabase upload failed: {e}")
        
        # Step 4.8: Fallback - save locally if Supabase fails or not configured
        local_json_path = None
        local_md_path = None
        
        if not json_url or not markdown_url:
            logger.warning("Supabase upload failed or not configured, saving locally")
            
            # Use cross-platform temp directory
            temp_dir = Path(tempfile.gettempdir()) / "vibecheck_reports"
            temp_dir.mkdir(parents=True, exist_ok=True)
            
            # Save JSON locally
            local_json_path = temp_dir / f"{mission_id}_report.json"
            with open(local_json_path, "wb") as f:
                f.write(json_bytes)
            logger.info(f"JSON report saved locally: {local_json_path}")
            
            # Save Markdown locally
            local_md_path = temp_dir / f"{mission_id}_report.md"
            with open(local_md_path, "wb") as f:
                f.write(markdown_bytes)
            logger.info(f"Markdown report saved locally: {local_md_path}")
        
        # Return report metadata with URLs
        return {
            "mission_id": mission_id,
            "generated_at": report_data["report_metadata"]["generated_at"],
            "supabase_json_url": json_url,
            "supabase_markdown_url": markdown_url,
            "local_json_path": str(local_json_path) if local_json_path else None,
            "local_markdown_path": str(local_md_path) if local_md_path else None,
            "total_events": len(events),
            "successful_exploits": len(successful_exploits),
            "kill_chain_progress": len(kill_chain_narrative),
        }
        
    except Exception as e:
        logger.error(f"Step 4 report generation failed: {e}")
        # Return minimal report on failure
        return {
            "mission_id": mission_id,
            "error": str(e),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }


def _build_kill_chain_from_events(events: list[dict]) -> list[dict]:
    """Build kill chain narrative from Supabase events."""
    narrative = []
    step = 1
    
    # Sort events by timestamp
    sorted_events = sorted(events, key=lambda e: e.get("timestamp", ""))
    
    for event in sorted_events:
        event_type = event.get("event_type", "")
        payload = event.get("payload_json", {})
        
        if event_type == "action" and "critic" in event.get("message", "") and payload.get("success"):
            narrative.append({
                "step": step,
                "phase": "exploitation",
                "timestamp": event.get("timestamp"),
                "exploit_type": payload.get("exploit_type", "unknown"),
                "target": payload.get("command", "")[:50] if payload.get("command") else "unknown",
                "severity": payload.get("severity", "low"),
                "evidence": payload.get("evidence", "")[:100],
            })
            step += 1
    
    return narrative


def _generate_recommendations_from_events(events: list[dict]) -> list[str]:
    """Generate recommendations based on events."""
    recommendations = []
    
    # Check for successful exploits
    successful = [e for e in events
                  if e.get("event_type") == "action"
                  and "critic" in e.get("message", "")
                  and e.get("payload_json", {}).get("success", False)]
    
    if successful:
        recommendations.append(f"CRITICAL: {len(successful)} successful exploit(s) detected - immediate remediation required")
        
        # Group by exploit type
        exploit_types = {}
        for e in successful:
            exp_type = e.get("payload_json", {}).get("exploit_type", "unknown")
            exploit_types[exp_type] = exploit_types.get(exp_type, 0) + 1
        
        for exp_type, count in exploit_types.items():
            recommendations.append(f"  - {count} x {exp_type.upper()}: Patch or implement input validation")
    
    # Check for high severity findings
    high_severity = [e for e in events 
                     if e.get("payload_json", {}).get("severity") == "high"]
    if high_severity:
        recommendations.append(f"HIGH: {len(high_severity)} high-severity issues require immediate attention")
    
    if not recommendations:
        recommendations.append("No critical findings - continue monitoring and periodic assessments")
    
    return recommendations


def _generate_markdown_report(report_data: dict, narrative: list) -> str:
    """Generate human-readable Markdown report with kill chain narrative."""
    lines = []
    
    # Header
    lines.append("# VibeCheck Security Assessment Report")
    lines.append("")
    lines.append(f"**Mission ID:** {report_data['mission_summary'].get('mission_id', 'unknown')}")
    lines.append(f"**Target:** {report_data['mission_summary'].get('target', 'N/A')}")
    lines.append(f"**Generated:** {report_data['report_metadata'].get('generated_at', 'unknown')}")
    lines.append("")
    
    # Executive Summary
    lines.append("## Executive Summary")
    lines.append("")
    summary = report_data["mission_summary"]
    lines.append(f"- **Objective:** {summary.get('objective', 'N/A')}")
    lines.append(f"- **Total Events:** {summary.get('total_events', 0)}")
    lines.append(f"- **Successful Exploits:** {summary.get('successful_exploits', 0)}")
    lines.append(f"- **Failed Exploits:** {summary.get('failed_exploits', 0)}")
    lines.append("")
    
    # Kill Chain Narrative
    lines.append("## Kill Chain Narrative")
    lines.append("")
    lines.append("### Attack Progression")
    lines.append("")
    
    if narrative:
        for step in narrative:
            lines.append(f"#### Step {step['step']}: {step['exploit_type'].upper()}")
            lines.append("")
            lines.append(f"- **Phase:** {step['phase']}")
            lines.append(f"- **Target:** `{step.get('target', 'N/A')}`")
            lines.append(f"- **Severity:** {step.get('severity', 'low').upper()}")
            if step.get('evidence'):
                lines.append(f"- **Evidence:** {step['evidence']}")
            lines.append("")
    else:
        lines.append("No successful kill chain progression recorded.")
        lines.append("")
    
    # Exploitation Results
    lines.append("## Exploitation Results")
    lines.append("")
    
    results = report_data.get("exploitation_results", [])
    if results:
        lines.append("| Timestamp | Exploit | Success | Severity |")
        lines.append("|-----------|---------|---------|----------|")
        for r in results:
            ts = r.get("timestamp", "N/A")[:19] if r.get("timestamp") else "N/A"
            exploit = r.get("exploit_type", "unknown")
            success = "✅ YES" if r.get("success") else "❌ NO"
            severity = r.get("severity", "low").upper()
            lines.append(f"| {ts} | {exploit} | {success} | {severity} |")
        lines.append("")
    else:
        lines.append("No exploitation results recorded.")
        lines.append("")
    
    # Recommendations
    lines.append("## Priority Recommendations")
    lines.append("")
    
    for i, rec in enumerate(report_data.get("recommendations", []), 1):
        lines.append(f"{i}. {rec}")
    lines.append("")
    
    # Footer
    lines.append("---")
    lines.append("")
    lines.append("*Generated by VibeCheck Autonomous Red Team Platform*")
    lines.append("")
    
    return "\n".join(lines)
