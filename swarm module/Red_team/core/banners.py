"""
Demo banners and visual polish for VibeCheck v4.0.

Provides ASCII art banners and formatted output for mission phases,
exploit results, and summary tables.
"""

from __future__ import annotations


def print_phase_banner(phase: str, subtext: str = "") -> None:
    """Print a phase completion banner."""
    banners = {
        "recon": "═══════════════════════════════════════",
        "exploitation": "═══════════════════════════════════════",
        "complete": "═══════════════════════════════════════",
    }
    
    banner = banners.get(phase, "═══════════════════════════════════════")
    phase_upper = phase.upper()
    
    print(f"\n╔{banner}╗")
    print(f"║  {phase_upper:^37} ║")
    if subtext:
        print(f"║  {subtext:^37} ║")
    print(f"╚{banner}╝\n")


def print_exploit_result(exploit_type: str, status: str, time_taken: float = 0.0, severity: str = "") -> None:
    """Print a formatted exploit result."""
    icon = "✅" if status == "success" else "❌"
    sev = f" [{severity.upper()}]" if severity else ""
    print(f"{icon} EXPLOIT {exploit_type.upper():<20} {status.upper()}{sev} ({time_taken:.1f}s)")


def print_token_propagation(token_type: str, target_agents: list[str]) -> None:
    """Print token propagation event."""
    agents_str = ", ".join(target_agents)
    print(f"🔑 TOKEN PROPAGATION: {token_type} → {agents_str}")


def print_summary_table(results: list[dict]) -> None:
    """Print a summary table of all exploits."""
    print("\n" + "=" * 80)
    print("┌─────────────────────────┬─────────┬──────┬──────────┐")
    print("│ Exploit                 │ Status  │ Time │ Severity │")
    print("├─────────────────────────┼─────────┼──────┼──────────┤")
    
    for result in results:
        exploit = result.get("exploit_type", "unknown")[:23].ljust(23)
        status = "✅ WIN" if result.get("success") else "❌ FAIL"
        status = status.ljust(7)
        time_val = f"{result.get('time', 0):.1f}s".ljust(4)
        severity = result.get("severity", "N/A").upper().ljust(8)
        print(f"│ {exploit} │ {status} │ {time_val} │ {severity} │")
    
    print("└─────────────────────────┴─────────┴──────┴──────────┘")
    
    # Calculate stats
    total = len(results)
    wins = sum(1 for r in results if r.get("success"))
    print(f"\n📊 SUMMARY: {wins}/{total} exploits successful ({100*wins/total:.0f}% success rate)")
    print("=" * 80 + "\n")


def print_mode_banner(mode: str | None, target: str) -> None:
    """Print the initial mode banner."""
    mode_str = (mode or "AUTO").upper()
    print("\n" + "=" * 80)
    print(f"  VIBECHECK v4.0 - {mode_str} MODE")
    print(f"  Target: {target}")
    print("=" * 80 + "\n")


def print_gemini_finding(finding_type: str, file_path: str, description: str) -> None:
    """Print a Gemini architectural finding."""
    print(f"🧠 GEMINI FINDING: {finding_type}")
    print(f"   File: {file_path}")
    print(f"   {description[:100]}...")


def print_semgrep_result(rule: str, file_path: str, line: int, severity: str) -> None:
    """Print a Semgrep finding."""
    sev_icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(severity, "⚪")
    print(f"{sev_icon} SEMGREP: {rule} at {file_path}:{line} [{severity}]")


def print_progress_bar(current: int, total: int, width: int = 40) -> str:
    """Generate a progress bar string."""
    filled = int(width * current / total)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {current}/{total} ({100*current/total:.0f}%)"
