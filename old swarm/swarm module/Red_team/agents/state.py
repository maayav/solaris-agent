"""
LangGraph shared state schema for the Red Team agent swarm.

This TypedDict defines the state that flows through the LangGraph
state machine. All agent nodes read from and write to this state.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal

from typing_extensions import TypedDict

from agents.a2a.messages import A2AMessage


class RedTeamState(TypedDict):
    """Shared state for the Red Team LangGraph workflow."""

    # ── Mission Identity ───────────────────────────────────────
    mission_id: str
    objective: str
    target: str  # e.g. "http://localhost:3000"

    # ── Phase Tracking ─────────────────────────────────────────
    phase: Literal["planning", "recon", "exploitation", "reporting", "complete"]

    # ── Message Accumulator ────────────────────────────────────
    # Using operator.add so each node appends to the list
    messages: Annotated[list[A2AMessage], operator.add]

    # ── Shared Intelligence ────────────────────────────────────
    blackboard: dict[str, Any]  # Aggregated findings from all agents

    # ── Agent Outputs ──────────────────────────────────────────
    recon_results: list[dict[str, Any]]   # Alpha's intelligence reports
    exploit_results: list[dict[str, Any]]  # Gamma's exploit results

    # ── Commander Strategy ─────────────────────────────────────
    current_tasks: list[dict[str, Any]]  # Active task assignments
    strategy: str  # Commander's current strategy text

    # ── Control Flow ───────────────────────────────────────────
    iteration: int  # Loop counter for PentAGI reflection
    max_iterations: int  # Safety limit
    needs_human_approval: bool  # HITL gate flag
    human_response: str | None  # Human's decision

    # ── Self-Reflection (Phase 3) ──────────────────────────────
    reflection_count: int  # Number of self-correction attempts
    max_reflections: int  # Max retries for failed exploits
    pending_exploit: dict[str, Any] | None  # Exploit awaiting HITL approval

    # ── GLOBAL AUTH CHAINING (Objective 3) ──────────────────────
    discovered_credentials: dict[str, dict]  # JWT, cookies, tokens discovered during exploit
    # Structure: {
    #     "jwt_token": {"value": "...", "target": "...", "type": "jwt"},
    #     "admin_cookie": {"value": "...", "target": "...", "type": "cookie"}
    # }
    
    contextual_memory: dict[str, Any]  # Session tokens, cookies from previous attempts

    # ── Mission Report ─────────────────────────────────────────
    report: dict[str, Any] | None  # Final mission report
    report_path: str | None  # Path to saved report file

    # ── Blue Team Integration ──────────────────────────────────
    blue_team_findings: list[Any]  # Static analysis findings from Blue Team
    blue_team_recon_results: list[dict[str, Any]]  # Converted to recon format
    blue_team_intelligence_brief: str  # Formatted brief for Commander

    # ── Error Handling ─────────────────────────────────────────
    errors: list[str]  # Error messages accumulated during execution

    # ── Mode Configuration ─────────────────────────────────────
    # Mode is now AUTO-DETECTED from target - see detect_target_type() in graph.py
    # "live" for running app URL, "static" for code/repo analysis
    mode: str | None  # Optional: will be auto-detected if not provided
    fast_mode: bool  # Skip recon tools for faster execution


def detect_target_type(target: str) -> str:
    """
    Auto-detect whether target is a live URL or code for static analysis.

    Returns:
        "live" for running web applications (http/https URLs)
        "static" for code repositories (GitHub URLs, local paths)

    Examples:
        >>> detect_target_type("http://localhost:3000")
        "live"
        >>> detect_target_type("https://example.com")
        "live"
        >>> detect_target_type("github.com/user/repo")
        "static"
        >>> detect_target_type("/home/user/myproject")
        "static"
    """
    import re
    from pathlib import Path

    if not target:
        return "live"  # Default fallback

    target_lower = target.lower().strip()

    # Check for GitHub URLs first (before generic HTTP check) -> Static mode
    if "github.com" in target_lower or target_lower.startswith("git@github.com"):
        return "static"

    # Check for HTTP/HTTPS URLs (non-GitHub) -> Live mode
    if target_lower.startswith(("http://", "https://")):
        return "live"

    # Check if it's a local file path that exists -> Static mode
    try:
        path = Path(target).expanduser().resolve()
        if path.exists():
            return "static"
    except (OSError, ValueError):
        pass

    # Check for absolute or relative paths that look like file paths -> Static mode
    # Matches: /home/user/project, ./project, ../project, C:\Users\project
    path_patterns = [
        r"^/[^/]",           # Unix absolute: /home, /var, etc.
        r"^\./",             # Relative: ./
        r"^\.\./",           # Parent relative: ../
        r"^[a-zA-Z]:\\",     # Windows absolute: C:\
    ]
    for pattern in path_patterns:
        if re.match(pattern, target):
            return "static"

    # Check for common repo indicators in path -> Static mode
    repo_indicators = [".git", "/src/", "/code/", ".py", ".js", ".ts", ".go", ".java"]
    if any(indicator in target for indicator in repo_indicators):
        return "static"

    # Default to live for anything else (domain names, IPs, etc.)
    return "live"
