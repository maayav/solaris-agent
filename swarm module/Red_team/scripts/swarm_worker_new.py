"""
Swarm Mission Worker - Processes missions from Redis stream.

Usage:
    python scripts/swarm_worker.py              # Start worker
    python scripts/swarm_worker.py --once       # Process one mission and exit
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import os
import subprocess

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.redis_bus import redis_bus
from core.config import settings
from core.platform_compat import COLORS, SYMBOLS, safe_print
from sandbox.sandbox_manager import target_container_manager, get_sandbox_target

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-20s] %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("swarm_worker")

# Stream and group configuration
SWARM_STREAM = "swarm_missions"
CONSUMER_GROUP = "swarm_workers"
CONSUMER_NAME = f"worker-{os.getpid()}"


async def create_consumer_group():
    """Create consumer group if it doesn't exist."""
    try:
        await redis_bus.create_consumer_group(SWARM_STREAM, CONSUMER_GROUP)
        logger.info(f"Consumer group '{CONSUMER_GROUP}' ready")
        return True
    except Exception as e:
        logger.error(f"Failed to create consumer group: {e}")
        return False


async def check_mission_status(mission_id: str) -> str | None:
    """Check if mission already exists and its status."""
    try:
        # For now, return None to skip status checking due to API differences
        # In production, this would query the mission status from the database
        return None
    except Exception as e:
        logger.debug(f"Failed to check mission status: {e}")
        return None


async def process_mission(mission_data: dict, msg_id: str | None = None) -> bool:
    """Process a single mission."""
    mission_id = mission_data.get("mission_id", "unknown")
    objective = mission_data.get("objective", "No objective")
    target = mission_data.get("target", "No target")
    action = mission_data.get("action", "unknown")
    mode = mission_data.get("mode", "live")
    repo_url = mission_data.get("repo_url")
    deployment_info = mission_data.get("deployment_info", {})
    
    # Generate effective mission_id if not provided
    import uuid
    effective_mission_id = mission_id if mission_id != "unknown" else str(uuid.uuid4())
    
    # Check if mission already processed (stale message handling)
    if mission_id != "unknown":
        existing_status = await check_mission_status(mission_id)
        if existing_status in ("completed", "failed"):
            logger.info(f"Mission {mission_id} already {existing_status} — ACK and skip")
            if msg_id:
                await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
            return True  # Return success to avoid retry
        elif existing_status == "running":
            logger.warning(f"Mission {mission_id} already running — possible duplicate, skipping")
            if msg_id:
                await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
            return True
    
    print(f"\n{COLORS['system']}{'='*60}")
    print(f"  PROCESSING MISSION: {effective_mission_id}")
    print(f"{'='*60}{COLORS['reset']}")
    print(f"  Action: {action}")
    print(f"  Mode: {mode}")
    print(f"  Target: {target}")
    print(f"  Objective: {objective[:80]}...")
    
    # Display repo information for repo missions
    if mode == "repo" and repo_url:
        print(f"  Repository: {repo_url}")
        if deployment_info:
            container_name = deployment_info.get("container_name")
            port = deployment_info.get("port")
            deployment_type = deployment_info.get("deployment_type")
            if container_name:
                print(f"  Container: {container_name}")
            if port:
                print(f"  Port: {port}")
            if deployment_type:
                print(f"  Deployment: {deployment_type}")
    
    if action == "start":
        # Import here to avoid loading on startup
        try:
            from agents.graph import build_red_team_graph, create_initial_state
            from agents.a2a.messages import A2AMessage
            from agents.tools.registry import tool_registry
            from agents.tools.nmap_tool import nmap_tool
            from agents.tools.nuclei_tool import nuclei_tool
            from agents.tools.curl_tool import curl_tool
            from agents.tools.python_exec import python_exec_tool
            from agents.tools.jwt_tool import jwt_tool, jwt_forge_tool
            from agents.tools.ffuf_tool import ffuf_tool, ffuf_quick_tool
            from agents.tools.sqlmap_tool import sqlmap_tool, sqlmap_quick_tool, sqlmap_deep_tool
            
            # Deploy target container if this is a repo mission
            deployed_target_url = None
            if mode == "repo" and repo_url:
                print(f"\n{COLORS['system']}Deploying target container from repo...{COLORS['reset']}")
                deployment_result = await target_container_manager.deploy_target(
                    repo_url=repo_url,
                    target_url=target,
                    mission_id=effective_mission_id,
                )
                
                if not deployment_result.get("success"):
                    print(f"\n{SYMBOLS['cross']} Failed to deploy target container")
                    print(f"  Error: {deployment_result.get('error', 'Unknown error')}")
                    return False
                
                deployed_target_url = deployment_result["target_url"]
                deployment_info = {
                    "container_name": deployment_result["container_name"],
                    "image_tag": deployment_result["image_tag"],
                    "container_port": deployment_result["container_port"],
                    "host_port": deployment_result["host_port"],
                }
                
                print(f"{SYMBOLS['check']} Target container deployed!")
                print(f"  Container: {deployment_result['container_name']}")
                print(f"  URL: {deployed_target_url}")
                print(f"  Port mapping: {deployment_result['container_port']} -> {deployment_result['host_port']}")
                
                # Update the target URL to the deployed container's URL
                target = deployed_target_url
            
            # Register tools
            tool_registry.register(nmap_tool)
            tool_registry.register(nuclei_tool)
            tool_registry.register(curl_tool)
            tool_registry.register(python_exec_tool)
            tool_registry.register(jwt_tool)
            tool_registry.register(jwt_forge_tool)
            tool_registry.register(ffuf_tool)
            tool_registry.register(ffuf_quick_tool)
            tool_registry.register(sqlmap_tool)
            tool_registry.register(sqlmap_quick_tool)
            tool_registry.register(sqlmap_deep_tool)
            
            # Build and run graph
            graph = build_red_team_graph()
            
            initial_state = create_initial_state(
                objective=objective,
                target=target,
                max_iterations=mission_data.get("max_iterations", 5),
                mission_id=effective_mission_id,
            )
            
            print(f"\n{COLORS['system']}Starting mission execution...{COLORS['reset']}")
            
            # Execute the graph with simple streaming like the old version
            async for state_update in graph.astream(initial_state):
                for node_name, node_state in state_update.items():
                    phase = node_state.get("phase", "")
                    iteration = node_state.get("iteration", 0)
                    
                    if phase:
                        print(f"\n{COLORS['system']}Phase: {phase} | Iteration: {iteration}{COLORS['reset']}")
                    
                    # Print messages
                    messages = node_state.get("messages", [])
                    for msg in messages:
                        if isinstance(msg, A2AMessage):
                            sender = msg.sender.value if hasattr(msg.sender, 'value') else msg.sender
                            print(f"  [{sender}] {msg.type.value if hasattr(msg.type, 'value') else msg.type}")
                    
                    # Print strategy
                    strategy = node_state.get("strategy", "")
                    if strategy:
                        print(f"\n{COLORS['commander']}Strategy: {strategy}{COLORS['reset']}")
                    
                    # Print errors
                    for err in node_state.get("errors", []):
                        print(f"\n{SYMBOLS['warn']} Error: {err}")
            
            print(f"\n{SYMBOLS['check']} Mission completed successfully!")
            
            # Cleanup Docker resources if this was a repo mission
            if mode == "repo" and repo_url:
                await target_container_manager.cleanup()
            
            return True
            
        except ImportError as e:
            logger.error(f"Failed to import mission components: {e}")
            print(f"\n{SYMBOLS['cross']} Cannot run mission - missing dependencies")
            print(f"  Error: {e}")
            return False
        except Exception as e:
            logger.exception("Mission failed")
            print(f"\n{SYMBOLS['cross']} Mission failed: {e}")
            
            # Cleanup on failure if this was a repo mission
            if mode == "repo" and repo_url:
                await target_container_manager.cleanup()
            
            return False
    elif action == "cancel":
        print(f"\n{SYMBOLS['stop']} Mission cancellation requested")
        
        # Cleanup Docker resources if this was a repo mission
        if mode == "repo" and repo_url:
            from sandbox.sandbox_manager import target_container_manager
            await target_container_manager.cleanup()
        
        return True
    else:
        print(f"\n{SYMBOLS['warn']} Unknown action: {action}")
        return False


async def _cleanup_mission_containers(mission_id: str, deployment_info: dict):
    """Clean up Docker containers for a completed/failed mission."""
    try:
        print(f"{COLORS['system']}Cleaning up Docker resources...{COLORS['reset']}")
        
        container_name = deployment_info.get("container_name")
        if container_name:
            # Stop container
            try:
                result = subprocess.run(
                    ["docker", "stop", container_name], 
                    capture_output=True, 
                    timeout=30,
                    check=False  # Don't raise on non-zero exit
                )
                print(f"  Stopped container: {container_name}")
            except Exception as e:
                logger.warning(f"Failed to stop container {container_name}: {e}")
            
            # Remove container
            try:
                result = subprocess.run(
                    ["docker", "rm", container_name], 
                    capture_output=True, 
                    timeout=30,
                    check=False
                )
                print(f"  Removed container: {container_name}")
            except Exception as e:
                logger.warning(f"Failed to remove container {container_name}: {e}")
        
        # Clean up image if specified
        image_tag = f"mission-{mission_id[:8]}"
        try:
            result = subprocess.run(
                ["docker", "rmi", image_tag], 
                capture_output=True, 
                timeout=30,
                check=False
            )
            print(f"  Removed image: {image_tag}")
        except Exception as e:
            logger.warning(f"Failed to remove image {image_tag}: {e}")
        
        print(f"{COLORS['system']}Docker cleanup completed{COLORS['reset']}")
        
    except Exception as e:
        logger.error(f"Failed to cleanup containers for mission {mission_id}: {e}")
        print(f"\n{SYMBOLS['warn']} Cleanup failed: {e}")


async def run_worker(once: bool = False):
    """Main worker loop."""
    print(f"{COLORS['system']}")
    print("=" * 60)
    print("  SWARM MISSION WORKER")
    print("=" * 60)
    print(f"{COLORS['reset']}")
    print(f"Redis URL: {settings.redis_url}")
    print(f"Stream: {SWARM_STREAM}")
    print(f"Consumer Group: {CONSUMER_GROUP}")
    print(f"Consumer Name: {CONSUMER_NAME}")
    print()
    
    # Connect to Redis
    try:
        await redis_bus.connect()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        print(f"{SYMBOLS['cross']} Cannot connect to Redis at {settings.redis_url}")
        print(f"  Make sure Blue Team's docker-compose is running")
        return 1
    
    # Create consumer group
    if not await create_consumer_group():
        print(f"{SYMBOLS['cross']} Failed to create consumer group")
        return 1
    
    print(f"{SYMBOLS['check']} Worker ready - listening for missions...")
    print(f"  Press Ctrl+C to stop\n")
    
    processed = 0
    
    # Claim any pending messages from crashed consumers
    print(f"{SYMBOLS['info']} Checking for pending messages...")
    try:
        pending_messages = await redis_bus.claim_pending(
            SWARM_STREAM,
            CONSUMER_GROUP,
            CONSUMER_NAME,
            min_idle_ms=5000,  # Claim messages idle for 5+ seconds
            count=10
        )
        if pending_messages:
            print(f"{SYMBOLS['check']} Claimed {len(pending_messages)} pending messages")
            for msg in pending_messages:
                # Extract mission data from the 'data' field
                mission_data = msg.get("data", {})
                msg_id = msg.get("_msg_id")
                
                if not mission_data:
                    logger.warning(f"Pending message {msg_id} has no data field, skipping")
                    if msg_id:
                        await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
                    continue
                
                success = await process_mission(mission_data, msg_id)
                if msg_id is not None and not success:  # Only ACK if not already ACKed in process_mission
                    await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
                if success:
                    processed += 1
    except Exception as e:
        logger.warning(f"Failed to claim pending messages: {e}")
    
    try:
        while True:
            try:
                # Read new messages from consumer group
                messages = await redis_bus.consume(
                    SWARM_STREAM,
                    CONSUMER_GROUP,
                    CONSUMER_NAME,
                    count=1,
                    block_ms=5000
                )
                
                if not messages:
                    if once:
                        print(f"\n{SYMBOLS['check']} No missions available, exiting (--once mode)")
                        break
                    continue
                
                for msg in messages:
                    msg_id = msg.get("_msg_id")
                    
                    # Extract mission data from the 'data' field
                    mission_data = msg.get("data", {})
                    if not mission_data:
                        logger.warning(f"Message {msg_id} has no data field")
                        # Acknowledge and skip
                        if msg_id:
                            await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
                        continue
                    
                    logger.info(f"Received mission: {msg_id}")
                    
                    # Process mission
                    success = await process_mission(mission_data, msg_id)
                    
                    # Acknowledge message (if not already ACKed in process_mission for stale missions)
                    # B18: Always ACK when msg_id is available, regardless of success
                    if msg_id is not None:
                        try:
                            await redis_bus.client.xack(SWARM_STREAM, CONSUMER_GROUP, msg_id)
                            logger.debug(f"ACKed message {msg_id}")
                        except Exception as e:
                            logger.warning(f"Failed to ACK message {msg_id}: {e}")
                    else:
                        logger.warning("msg_id is None, skipping xack")
                    
                    if success:
                        processed += 1
                        logger.info(f"Mission {msg_id} completed")
                    else:
                        logger.warning(f"Mission {msg_id} failed")
                    
                    if once:
                        print(f"\n{SYMBOLS['check']} Processed one mission, exiting (--once mode)")
                        break
                
                if once:
                    break
                    
            except KeyboardInterrupt:
                print(f"\n{SYMBOLS['stop']} Stopping worker...")
                break
            except Exception as e:
                logger.exception("Error in worker loop")
                print(f"\n{SYMBOLS['warn']} Error: {e}")
                if once:
                    break
                await asyncio.sleep(1)
    
    finally:
        await redis_bus.disconnect()
        print(f"\n{SYMBOLS['check']} Worker stopped. Processed {processed} mission(s).")
    
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Swarm Mission Worker - Process missions from Redis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/swarm_worker.py        # Start worker (continuous)
  python scripts/swarm_worker.py --once # Process one mission and exit
        """
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process one mission and exit"
    )
    
    args = parser.parse_args()
    
    exit_code = asyncio.run(run_worker(once=args.once))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
