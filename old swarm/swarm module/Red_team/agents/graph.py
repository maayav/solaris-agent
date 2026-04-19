"""
LangGraph state machine for the Red Team agent swarm.

Execution flow:
  Commander Plan → Alpha Recon → Gamma Exploit → HITL Gate → Commander Observe
                          ↑                                         │
                          └──── loop if not complete ─────────────────┘
                                                                    ↓
                                                              Report Gen → END

The graph runs until Commander declares phase="complete" or
max_iterations is reached.

Phase 3 additions:
  - HITL Safety Gate: Human approval for destructive exploits
  - Self-Reflection: Gamma retries failed exploits with modified payloads
  - Report Generation: Comprehensive mission report on completion
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from langgraph.graph import END, StateGraph

from agents.state import RedTeamState, detect_target_type
from agents.commander import commander_plan, commander_observe
from agents.alpha_recon import alpha_recon
from agents.gamma_exploit import gamma_exploit, hitl_approval_gate
from agents.report_generator import generate_mission_report, save_report, format_report_text
from core.blue_team_bridge import enrich_state_with_blue_team_findings, get_blue_team_bridge
from core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)


async def blue_team_enrichment_node(state: RedTeamState) -> dict[str, Any]:
    """
    Blue Team enrichment node - fetches static analysis findings.

    This node runs at mission start to query Blue Team's findings
    for the target and inject them into the state for use by all agents.
    """
    target = state.get("target", "")
    mission_id = state.get("mission_id", "unknown")

    logger.info("=" * 60)
    logger.info("BLUE TEAM ENRICHMENT - Querying static analysis findings")
    logger.info(f"Mission: {mission_id}, Target: {target}")
    logger.info("=" * 60)

    try:
        # Update mission status and commander agent state in Supabase
        supabase = get_supabase_client()
        if supabase._enabled:
            asyncio.create_task(supabase.update_mission_status(
                mission_id=mission_id,
                status="running",
            ))
            asyncio.create_task(supabase.update_agent_state(
                mission_id=mission_id,
                agent_id="commander",
                agent_name="commander",
                status="running",
                task="blue_team_enrichment",
            ))
            # New timeline: log mission start event
            asyncio.create_task(supabase.log_swarm_event(
                mission_id=mission_id,
                event_type="agent_start",
                agent_name="commander",
                title="Mission started — Blue Team enrichment",
                stage="planning",
                target=target,
            ))
        
        # Enrich state with Blue Team findings
        enriched_state = await enrich_state_with_blue_team_findings(
            dict(state), target
        )

        # Log summary
        findings = enriched_state.get("blue_team_findings", [])
        if findings:
            logger.info(f"✓ Loaded {len(findings)} Blue Team findings")
            brief = enriched_state.get("blue_team_intelligence_brief", "")
            if brief:
                logger.info("\n" + brief)
        else:
            logger.info("ℹ No Blue Team findings available for this target")

        # Update commander agent state to complete
        if supabase._enabled:
            asyncio.create_task(supabase.update_agent_state(
                mission_id=mission_id,
                agent_id="commander",
                agent_name="commander",
                status="complete",
                task="blue_team_enrichment",
            ))

        # Return enriched keys
        return {
            "blue_team_findings": enriched_state.get("blue_team_findings", []),
            "blue_team_recon_results": enriched_state.get("blue_team_recon_results", []),
            "blue_team_intelligence_brief": enriched_state.get("blue_team_intelligence_brief", ""),
        }

    except Exception as e:
        logger.error(f"Failed to enrich with Blue Team findings: {e}")
        # Don't fail the mission - just continue without Blue Team data
        return {
            "blue_team_findings": [],
            "blue_team_recon_results": [],
            "blue_team_intelligence_brief": f"Blue Team enrichment failed: {e}",
        }


async def generate_report_node(state: RedTeamState) -> dict[str, Any]:
    """
    Report generation node - creates and saves mission report.

    This node runs when the mission completes (either by Commander
    declaration or max iterations reached).
    """
    logger.info("=" * 60)
    logger.info("MISSION COMPLETE - Generating Report")
    logger.info("=" * 60)
    
    mission_id = state.get("mission_id", "unknown")
    iteration = state.get("iteration", 0)

    # Generate the report
    report = generate_mission_report(state)
    
    # Print report to console
    print("\n" + format_report_text(report))
    
    # Save report to files
    try:
        json_path, text_path = await save_report(report)
        logger.info("Report saved to: %s", text_path)
    except Exception as e:
        logger.error("Failed to save report: %s", e)
        text_path = None
    
    # Update mission status and agent states in Supabase
    try:
        supabase = get_supabase_client()
        if supabase._enabled:
            # Mark mission as completed
            asyncio.create_task(supabase.update_mission_status(
                mission_id=mission_id,
                status="completed",
            ))
            # Mark all agents as complete
            for agent_id in ["commander", "alpha", "gamma", "critic"]:
                asyncio.create_task(supabase.update_agent_state(
                    mission_id=mission_id,
                    agent_id=agent_id,
                    agent_name=agent_id,
                    status="complete",
                    iteration=iteration,
                    task="mission_complete",
                ))
            # New timeline: log mission complete event
            asyncio.create_task(supabase.log_swarm_event(
                mission_id=mission_id,
                event_type="agent_complete",
                agent_name="commander",
                title="Mission completed — report generated",
                stage="reporting",
                iteration=iteration,
            ))
    except Exception as e:
        logger.debug(f"Failed to update final mission status: {e}")
    
    # Return state updates
    return {
        "report": report,
        "report_path": text_path,
        "phase": "complete",
    }


def should_continue(state: RedTeamState) -> str:
    """
    Routing function after Commander Observe.
    Decides whether to loop back for another cycle or end.
    """
    phase = state.get("phase", "complete")
    iteration = state.get("iteration", 0)
    max_iter = state.get("max_iterations", 5)

    logger.info("should_continue: iteration=%d, max_iter=%d, phase=%s", iteration, max_iter, phase)

    if phase == "complete":
        logger.info("Mission complete — Commander declared phase=complete")
        return "report"

    if iteration >= max_iter:
        logger.warning("Max iterations (%d) reached — forcing completion", max_iter)
        return "report"

    if phase == "exploitation":
        logger.info("Moving to exploitation phase — routing to Gamma")
        return "exploit_only"

    # Default: continue recon cycle
    logger.info("Continuing recon cycle — iteration %d", iteration)
    return "continue"


def build_red_team_graph() -> StateGraph:
    """
    Construct the LangGraph state machine for the red team swarm.

    Returns a compiled graph ready for invocation.
    """
    graph = StateGraph(RedTeamState)

    # ── Add Nodes ──────────────────────────────────────────────
    graph.add_node("blue_team_enrichment", blue_team_enrichment_node)  # NEW: Blue Team findings
    graph.add_node("commander_plan", commander_plan)
    graph.add_node("alpha_recon", alpha_recon)
    graph.add_node("gamma_exploit", gamma_exploit)
    graph.add_node("hitl_gate", hitl_approval_gate)  # Phase 3: HITL safety gate
    graph.add_node("commander_observe", commander_observe)
    graph.add_node("generate_report", generate_report_node)  # Report generation

    # ── Set Entry Point ────────────────────────────────────────
    graph.set_entry_point("blue_team_enrichment")

    # ── Define Edges ───────────────────────────────────────────
    # Blue Team Enrichment → Commander Plan (start with findings loaded)
    graph.add_edge("blue_team_enrichment", "commander_plan")

    # Commander Plan → Alpha Recon (always starts with recon)
    graph.add_edge("commander_plan", "alpha_recon")

    # Alpha Recon → Gamma Exploit (recon feeds into exploitation)
    graph.add_edge("alpha_recon", "gamma_exploit")

    # Gamma Exploit → HITL Gate (Phase 3: safety check before results)
    graph.add_edge("gamma_exploit", "hitl_gate")

    # HITL Gate → Commander Observe
    graph.add_edge("hitl_gate", "commander_observe")

    # Commander Observe → conditional routing
    graph.add_conditional_edges(
        "commander_observe",
        should_continue,
        {
            "continue": "alpha_recon",       # Back to recon for next cycle
            "exploit_only": "gamma_exploit",  # Skip recon, go straight to exploit
            "report": "generate_report",      # Mission complete, generate report
        },
    )

    # Report Generation → END
    graph.add_edge("generate_report", END)

    return graph.compile()


def create_initial_state(
    objective: str,
    target: str,
    max_iterations: int = 5,
    mission_id: str | None = None,
    max_reflections: int = 3,
    fast_mode: bool = False,
    mode: str | None = None,
) -> RedTeamState:
    """
    Create the initial state for a red team mission.

    Args:
        objective: Mission objective/description
        target: Target to analyze (URL, GitHub repo, or local path)
        max_iterations: Maximum loop iterations before forcing completion
        mission_id: Optional mission ID (auto-generated if not provided)
        max_reflections: Maximum self-reflection attempts for failed exploits
        fast_mode: Skip recon tools for faster execution (live mode only)
        mode: Optional mode override ("live" or "static"). If not provided,
              mode is AUTO-DETECTED from the target:
              - "live": HTTP/HTTPS URLs (e.g., http://localhost:3000)
              - "static": GitHub repos, local paths (e.g., github.com/user/repo)
    """
    # Auto-detect mode from target if not explicitly provided
    detected_mode = mode if mode else detect_target_type(target)

    logger.info(
        "Creating mission: target=%s, detected_mode=%s (explicit_mode=%s)",
        target, detected_mode, mode or "auto"
    )

    # B19: Use full UUID instead of truncated for Supabase compatibility
    state = RedTeamState(
        mission_id=mission_id or str(uuid.uuid4()),
        objective=objective,
        target=target,
        phase="planning",
        messages=[],
        blackboard={},
        recon_results=[],
        exploit_results=[],
        current_tasks=[],
        strategy="",
        iteration=0,
        max_iterations=max_iterations,
        needs_human_approval=False,
        human_response=None,
        reflection_count=0,
        max_reflections=max_reflections,
        pending_exploit=None,
        discovered_credentials={},
        contextual_memory={},
        report=None,
        report_path=None,
        errors=[],
        blue_team_findings=[],
        blue_team_recon_results=[],
        blue_team_intelligence_brief="",
    )
    # Add mode and fast_mode flags (mode is auto-detected if not provided)
    state["mode"] = detected_mode
    state["fast_mode"] = fast_mode
    
    # Create mission record in Supabase synchronously to ensure it's created before events
    # Use synchronous insert to avoid event loop issues
    try:
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        supabase = get_supabase_client()
        if supabase._enabled:
            try:
                # Run mission creation synchronously to avoid event loop issues
                mission_data = {
                    "id": state["mission_id"],
                    "target": target,
                    "status": "running",
                    "created_at": datetime.utcnow().isoformat(),
                }
                result = supabase._client.table("swarm_missions").insert(mission_data).execute()
                if result.data:
                    logger.info(f"Mission {state['mission_id']} created in Supabase")
                else:
                    logger.warning(f"Failed to create mission {state['mission_id']} in Supabase - events may be orphaned")
            except Exception as e:
                logger.warning(f"Failed to create mission in Supabase: {e} - events may be orphaned")
        else:
            logger.info(f"Supabase not enabled - mission {state['mission_id']} will not be persisted")
    except Exception as e:
        logger.warning(f"Error in Supabase mission creation: {e} - continuing without Supabase")
    
    return state
