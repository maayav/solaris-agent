"""
CLI entry point to launch a Red Team mission.

Usage:
    python scripts/run_mission.py --objective "Recon Juice Shop" --target http://localhost:3000
    python scripts/run_mission.py --mission missions/juice_shop_recon.yaml
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.graph import build_red_team_graph, create_initial_state
from agents.a2a.messages import A2AMessage, MessageType
from core.redis_bus import redis_bus, A2A_STREAM, RED_TEAM_EVENTS
from core.config import settings
from sandbox.sandbox_manager import sandbox_manager
from agents.tools.registry import tool_registry
from agents.tools.nmap_tool import nmap_tool
from agents.tools.nuclei_tool import nuclei_tool
from agents.tools.curl_tool import curl_tool
from agents.tools.python_exec import python_exec_tool
from core.platform_compat import COLORS, SYMBOLS, safe_print

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-20s] %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mission_runner")



from core.platform_compat import print_banner


def print_message(msg: A2AMessage):
    """Pretty-print an A2A message."""
    sender = msg.sender.value if hasattr(msg.sender, 'value') else msg.sender
    color = sender
    if sender == "agent_alpha":
        color = "agent_alpha"
    elif sender == "agent_gamma":
        color = "agent_gamma"
    elif sender == "commander":
        color = "commander"
    else:
        color = "system"
    
    msg_type = msg.type.value if hasattr(msg.type, 'value') else msg.type
    priority = msg.priority.value if hasattr(msg.priority, 'value') else msg.priority

    print(f"\n{COLORS[color]}{'-' * 60}")
    print(f"  [{sender.upper()}] -> {msg_type}")
    print(f"  Priority: {priority}")
    print(f"{'-' * 60}")

    payload = msg.payload
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, str) and len(value) > 200:
                value = value[:200] + "..."
            print(f"  {key}: {value}")
    else:
        print(f"  {payload}")

    print(f"{COLORS[color]}{'-' * 60}{COLORS['reset']}")


def print_phase(phase: str, iteration: int, max_iter: int):
    """Print current phase header."""
    color = COLORS["system"]
    print(f"\n{color}{'=' * 60}")
    print(f"  PHASE: {phase.upper()}  |  Iteration: {iteration}/{max_iter}")
    print(f"{'=' * 60}{COLORS['reset']}")


async def run_mission(objective: str, target: str, max_iterations: int = 5):
    """Execute a red team mission."""
    print_banner()

    # Connect to Redis
    try:
        await redis_bus.connect()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning("Redis not available (%s) — running without message persistence", e)

    # Initialize sandbox
    safe_print(f"  {SYMBOLS['gear']} Initializing sandbox...", "system")
    try:
        await sandbox_manager.ensure_image()
        mission_id_pre = None  # Will be set after state creation
        logger.info("Sandbox image ready")
    except Exception as e:
        logger.error("Sandbox init failed: %s", e)
        safe_print(f"  {SYMBOLS['warn']} Sandbox unavailable: {e}", "system")

    # Register tools
    tool_registry.register(nmap_tool)
    tool_registry.register(nuclei_tool)
    tool_registry.register(curl_tool)
    tool_registry.register(python_exec_tool)
    logger.info("Tools registered: %s", tool_registry.list_names())

    # Build graph
    graph = build_red_team_graph()
    initial_state = create_initial_state(
        objective=objective,
        target=target,
        max_iterations=max_iterations,
    )

    # Create sandbox container
    try:
        await sandbox_manager.create_sandbox(initial_state['mission_id'])
        safe_print(f"  {SYMBOLS['check']} Sandbox ready", "system")
    except Exception as e:
        logger.error("Sandbox container creation failed: %s", e)
        safe_print(f"  {SYMBOLS['warn']} Sandbox container failed: {e}", "system")

    print(f"\n{COLORS['system']}  MISSION ID: {initial_state['mission_id']}")
    print(f"  OBJECTIVE: {objective}")
    print(f"  TARGET:    {target}")
    print(f"  MAX ITER:  {max_iterations}{COLORS['reset']}\n")

    # Publish mission start event
    try:
        await redis_bus.publish(RED_TEAM_EVENTS, {
            "event": "MISSION_START",
            "mission_id": initial_state["mission_id"],
            "objective": objective,
            "target": target,
        })
    except Exception:
        pass  # Redis optional for Phase 1

    # Run the graph
    prev_msg_count = 0
    prev_phase = ""

    try:
        async for state_update in graph.astream(initial_state):
            # state_update is {node_name: state_dict}
            for node_name, node_state in state_update.items():
                phase = node_state.get("phase", "")
                iteration = node_state.get("iteration", 0)
                max_iter = node_state.get("max_iterations", max_iterations)

                if phase and phase != prev_phase:
                    print_phase(phase, iteration, max_iter)
                    prev_phase = phase

                # Print new messages
                messages = node_state.get("messages", [])
                for msg in messages[prev_msg_count:]:
                    if isinstance(msg, A2AMessage):
                        print_message(msg)
                        # Persist to Redis
                        try:
                            await redis_bus.publish(A2A_STREAM, msg.to_stream_dict())
                        except Exception:
                            pass

                prev_msg_count = 0  # Reset — messages accumulate fresh per node

                # Print strategy updates
                strategy = node_state.get("strategy", "")
                if strategy and node_name == "commander_plan":
                    print(f"\n{COLORS['commander']}  STRATEGY: {strategy}{COLORS['reset']}")

                # Print errors
                for err in node_state.get("errors", []):
                    print(f"\n{COLORS['system']}  ⚠ ERROR: {err}{COLORS['reset']}")

    except KeyboardInterrupt:
        print(f"\n{COLORS['system']}  ⛔ Mission aborted by operator{COLORS['reset']}")
    except Exception as e:
        logger.exception("Mission failed: %s", e)
        print(f"\n{COLORS['system']}  ❌ Mission failed: {e}{COLORS['reset']}")

    # Publish mission end
    try:
        await redis_bus.publish(RED_TEAM_EVENTS, {
            "event": "MISSION_COMPLETE",
            "mission_id": initial_state["mission_id"],
        })
    except Exception:
        pass

    # Cleanup sandbox
    try:
        await sandbox_manager.destroy_sandbox(initial_state['mission_id'])
    except Exception:
        pass

    # Disconnect
    try:
        await redis_bus.disconnect()
    except Exception:
        pass

    print(f"\n{COLORS['system']}  ✅ Mission Complete{COLORS['reset']}\n")


def main():
    parser = argparse.ArgumentParser(description="Red Team Agent Swarm — Mission Runner")
    parser.add_argument(
        "--mission",
        type=str,
        help="Path to mission YAML file (overrides --objective, --target)",
    )
    parser.add_argument(
        "--objective",
        type=str,
        default="Perform reconnaissance and exploitation of the target OWASP Juice Shop to identify and exploit security vulnerabilities.",
        help="Mission objective",
    )
    parser.add_argument(
        "--target",
        type=str,
        default=settings.juice_shop_url,
        help="Target URL",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=3,
        help="Max orchestration loop iterations",
    )
    args = parser.parse_args()
    
    # Load mission from YAML if provided
    if args.mission:
        import yaml
        with open(args.mission) as f:
            mission_config = yaml.safe_load(f)
        objective = mission_config.get("mission", {}).get("objective", args.objective)
        target = mission_config.get("mission", {}).get("target", args.target)
        max_iterations = mission_config.get("execution", {}).get("max_iterations", args.max_iterations)
        logger.info(f"Loaded mission from {args.mission}")
    else:
        objective = args.objective
        target = args.target
        max_iterations = args.max_iterations
    
    asyncio.run(run_mission(objective, target, max_iterations))


if __name__ == "__main__":
    main()
