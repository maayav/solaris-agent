#!/usr/bin/env python3
"""
Combined Red Team + Blue Team Engine Launcher

This script simultaneously spins up:
1. Blue Team (solaris-agent): Defensive analytics scanner
2. Red Team: Autonomous penetration testing mission runner

Both teams communicate via Redis streams:
- Blue Team publishes defensive analytics to "defense_analytics" stream
- Red Team subscribes to defense_analytics and adapts its strategy accordingly
"""

import argparse
import asyncio
import logging
import os
import sys
import signal
import importlib.util
import time
from pathlib import Path

# Progress bar class for mission tracking
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Parse command-line arguments
def parse_args():
    parser = argparse.ArgumentParser(description="VibeCheck Combined Red Team + Blue Team Engine")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["live", "static"],
        default=None,
        help="Scan mode: 'live' for running app URL, 'static' for GitHub repo or local path. "
             "If not specified, mode is AUTO-DETECTED from target."
    )
    parser.add_argument(
        "--target",
        type=str,
        default="http://localhost:3000",
        help="Target URL to attack (live mode) or GitHub URL/file path (static mode) (default: http://localhost:3000)"
    )
    parser.add_argument(
        "--objective",
        type=str,
        default="Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure",
        help="Mission objective for the Red Team"
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=1,
        help="Maximum iterations for the Red Team (default: 1, exploits run in parallel)"
    )
    parser.add_argument(
        "--fast-mode",
        action="store_true",
        help="Fast mode: skip recon tools (nmap), go straight to exploits (live targets only)"
    )
    return parser.parse_args()

# Global args storage
ARGS = parse_args()

# Add project paths to Python path
PROJECT_ROOT = Path(__file__).parent.parent  # Go up from scripts/ to vibecheck/
RED_TEAM_PATH = PROJECT_ROOT / "Red_team"
BLUE_TEAM_PATH = PROJECT_ROOT / "Blue_team" / "solaris-agent" / "vibecheck"

# CRITICAL: Add paths in correct order - Red Team first
sys.path.insert(0, str(RED_TEAM_PATH))
sys.path.insert(0, str(PROJECT_ROOT))

# Import banners
from core.banners import print_mode_banner, print_phase_banner, print_summary_table

# Print mode banner at startup
print_mode_banner(ARGS.mode, ARGS.target)

# Import Red Team components first (this sets up the core module correctly)
logger.info("Loading Red Team components...")
from core.redis_bus import redis_bus, DEFENSE_ANALYTICS
from core.config import settings as red_settings

# Register tools for Red Team
from agents.tools.registry import tool_registry
from agents.tools.nmap_tool import nmap_tool
from agents.tools.curl_tool import curl_tool
from agents.tools.python_exec import python_exec_tool
from agents.tools.web_search_tool import register_web_search_tools

# Register all tools (nuclei removed - causes 60s timeouts)
tool_registry.register(nmap_tool)
tool_registry.register(curl_tool)
tool_registry.register(python_exec_tool)

# Register web search/OSINT tools (Google Search, Shodan, Web Scraping, CVE Search)
register_web_search_tools(tool_registry)

logger.info("Tools registered: %s", tool_registry.list_names())

# Blue Team components will be loaded dynamically in start_blue_team() to avoid namespace collision
blue_team_loaded = False
blue_redis_bus = None

# VibeCheck branding constants
BOLD_YELLOW = "\033[1;33m"
BOLD_CYAN = "\033[1;36m"
RESET = "\033[0m"
CHECK_MARK = "✅"


class CombinedEngine:
    """Combined Red Team + Blue Team engine."""
    
    def __init__(self):
        self.running = False
        self.red_team_task = None
        self.blue_team_task = None
        
    async def start_blue_team(self):
        """Start the Blue Team (solaris-agent) as a separate subprocess."""
        print(f"\n{BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Blue Team Defense System Initializing...", flush=True)
        logger.info("=" * 60)
        logger.info("STARTING BLUE TEAM (Solaris Agent - Defensive Scanner)")
        logger.info("=" * 60)
        
        # Use subprocess to run Blue Team as separate process (avoids import conflicts)
        try:
            import subprocess
            
            # Determine Python executable
            venv_python = PROJECT_ROOT / "venv" / "bin" / "python"
            if venv_python.exists():
                python_exe = str(venv_python)
            else:
                python_exe = sys.executable
            
            # Launch Blue Team in subprocess
            blue_team_script = PROJECT_ROOT / "scripts" / "run_blue_team.py"
            logger.info(f"Launching Blue Team subprocess: {python_exe} {blue_team_script}")
            
            self.blue_process = subprocess.Popen(
                [python_exe, str(blue_team_script)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=str(PROJECT_ROOT),
                env={**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
            )
            
            # Wait a moment for Blue Team to start
            await asyncio.sleep(2)
            
            # Check if process is still running
            if self.blue_process.poll() is None:
                logger.info("Blue Team subprocess started successfully")
                global blue_team_loaded
                blue_team_loaded = True
                
                # Start a task to monitor Blue Team output
                asyncio.create_task(self._monitor_blue_team_output())
                
                print(f"{BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Defense Systems Online - Monitoring Active")
                logger.info("BLUE TEAM SERVICES READY")
                logger.info("  - Vulnerability Scanner")
                logger.info("  - Code Analysis Engine")
                logger.info("  - Defensive Analytics Publisher")
            else:
                # Process exited early - capture output for debugging
                stdout, stderr = self.blue_process.communicate()
                logger.warning("Blue Team subprocess exited early")
                if stdout:
                    logger.warning(f"Blue Team stdout: {stdout[:500]}")
                if stderr:
                    logger.error(f"Blue Team stderr: {stderr[:500]}")
                logger.info("Continuing in Red Team-only mode")
                
        except Exception as e:
            logger.warning(f"Blue Team components not available: {e}")
            logger.info("Running in Red Team-only mode")
            
    async def _monitor_blue_team_output(self):
        """Monitor Blue Team subprocess output."""
        if hasattr(self, 'blue_process') and self.blue_process:
            try:
                # Read all output from the process
                stdout, stderr = await asyncio.to_thread(self.blue_process.communicate)
                
                if stdout:
                    for line in stdout.split('\n'):
                        if line.strip():
                            logger.info(f"[Blue Team] {line.strip()}")
                
                # Check exit code
                exit_code = self.blue_process.returncode
                if exit_code != 0 and exit_code is not None:
                    logger.error(f"Blue Team exited with code {exit_code}")
                    if stderr:
                        logger.error(f"Blue Team stderr: {stderr}")
                else:
                    logger.info("Blue Team process ended")
                    
            except Exception as err:
                logger.error(f"Blue Team monitor error: {err}")
            # Blue Team is optional - continue with Red Team only
            
    async def start_red_team(self):
        """Start the Red Team mission runner."""
        logger.info("=" * 60)
        logger.info("STARTING RED TEAM (Autonomous Penetration Testing)")
        logger.info("=" * 60)
        
        try:
            # Import Red Team components
            from agents.graph import build_red_team_graph
            from agents.state import RedTeamState
            
            # Default mission configuration (uses command-line args)
            mission_config = {
                "mission_id": "combined_mission_001",
                "objective": ARGS.objective,
                "target": ARGS.target,
                "max_iterations": ARGS.max_iterations,
                "fast_mode": ARGS.fast_mode,
                "mode": ARGS.mode,
            }
            
            logger.info(f"Red Team: Initializing mission {mission_config['mission_id']}")
            mode_display = (mission_config['mode'] or 'AUTO').upper()
            logger.info(f"  Mode: {mode_display}")
            logger.info(f"  Target: {mission_config['target']}")
            logger.info(f"  Objective: {mission_config['objective']}")
            
            # Clear stale tokens and payload stores from previous runs
            try:
                await redis_bus.client.delete(f"payload_attempts:{mission_config['mission_id']}")
                await redis_bus.client.delete(f"redteam:findings:{mission_config['mission_id']}:tokens")
                await redis_bus.client.delete(f"redteam:blackboard:{mission_config['mission_id']}:repo_path")
                # Fix Issue 3: Clear payload stores that cause "already tried" on fresh runs
                await redis_bus.client.delete(f"payload_store:{mission_config['mission_id']}")
                await redis_bus.client.delete(f"tried_payloads:{mission_config['mission_id']}")
                await redis_bus.client.delete(f"exploit_history:{mission_config['mission_id']}")
                # Clear global payload tracking keys
                await redis_bus.client.delete("payload_store")
                await redis_bus.client.delete("tried_payloads")
                await redis_bus.client.delete("global_exploit_history")
                logger.info("Red Team: Cleared stale tokens, payload stores, and mission data from Redis")
            except Exception as e:
                logger.warning(f"Red Team: Could not clear Redis data: {e}")
            
            # Configure network isolation for the sandbox (PentAGI-style security)
            # SKIP network isolation for localhost targets - sandbox uses host network
            logger.info("Red Team: Configuring network isolation...")
            try:
                from sandbox.sandbox_manager import shared_sandbox_manager
                from urllib.parse import urlparse
                
                # Extract target IP/hostname for network restrictions
                parsed = urlparse(ARGS.target)
                target_host = parsed.hostname or ARGS.target
                
                # Skip network isolation for localhost/127.0.0.1 targets
                # The sandbox uses host network mode, so localhost is the host machine
                if target_host in ('localhost', '127.0.0.1', '::1', '0.0.0.0'):
                    logger.info(f"Red Team: Skipping network isolation for localhost target ({target_host})")
                    logger.info("Red Team: Sandbox has full host network access")
                else:
                    # Ensure sandbox is running
                    await shared_sandbox_manager.ensure_shared_sandbox()
                    
                    # Configure iptables rules to restrict outbound connections
                    # Allow: target host, localhost (for Ollama), DNS
                    # Block: everything else
                    net_result = await shared_sandbox_manager.configure_network_isolation(
                        target_ip=target_host,
                        allowed_ports=[80, 443, 3000, 8080, 11434, 6379, 6333]
                    )
                    
                    if net_result.success:
                        logger.info(f"Red Team: Network isolation active - only {target_host} accessible")
                    else:
                        logger.warning(f"Red Team: Could not configure network isolation: {net_result.stderr}")
                        logger.info("Red Team: Continuing without network restrictions")
            except Exception as net_err:
                logger.warning(f"Red Team: Network isolation setup failed: {net_err}")
                logger.info("Red Team: Continuing without network restrictions")
            
            # Create mission graph
            graph = build_red_team_graph()
            
            # Run the mission
            logger.info("Red Team: Starting mission execution...")
            
            # Create initial state
            from agents.graph import create_initial_state
            state = create_initial_state(
                mission_id=mission_config["mission_id"],
                objective=mission_config["objective"],
                target=mission_config["target"],
                max_iterations=mission_config["max_iterations"],
                fast_mode=mission_config.get("fast_mode", False),
                mode=mission_config.get("mode", "live"),
            )
            
            logger.info("Red Team: Starting mission execution...")
            
            # Run the LangGraph
            final_state = await graph.ainvoke(state)
            
            logger.info("Red Team: Mission completed")
            logger.info(f"  Final phase: {final_state.get('phase')}")
            strategy = final_state.get('strategy', 'N/A') or 'N/A'
            logger.info(f"  Strategy: {str(strategy)[:100]}...")
            
            return final_state
            
        except Exception as e:
            logger.error(f"Red Team execution failed: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise
            
    async def run_bridge_loop(self):
        """Background task to monitor Blue->Red communication."""
        logger.info("Starting Blue-Red bridge monitoring loop...")
        
        # Track seen alerts to prevent spam
        seen_alerts: set[str] = set()
        
        while self.running:
            try:
                # Check for new defense analytics
                messages = await redis_bus.get_latest_defense_intel(count=5)
                
                if messages:
                    for msg in messages:
                        # Create unique key for deduplication
                        alert_key = f"{msg.get('vulnerability_type')}:{msg.get('description', '')[:50]}"
                        
                        # Skip if we've seen this alert before
                        if alert_key in seen_alerts:
                            continue
                        
                        seen_alerts.add(alert_key)
                        
                        # Limit cache size to prevent memory growth
                        if len(seen_alerts) > 100:
                            seen_alerts.clear()
                        
                        # VibeCheck branded alert display
                        severity = msg.get('severity', 'medium').upper()
                        vuln_type = msg.get('vulnerability_type', 'unknown')
                        desc = msg.get('description', '')[:50]
                        print(f"{BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Defense Alert: [{severity}] {vuln_type} - {desc}", flush=True)
                        
                await asyncio.sleep(5)  # Check every 5 seconds
                
            except Exception as e:
                logger.debug(f"Bridge loop: {e}")
                await asyncio.sleep(5)
                
    async def start(self):
        """Start the combined engine."""
        logger.info("=" * 60)
        logger.info("COMBINED RED TEAM + BLUE TEAM ENGINE")
        logger.info("=" * 60)
        
        # Initialize sandbox
        from sandbox.sandbox_manager import sandbox_manager
        logger.info("Initializing Docker sandbox image...")
        try:
            await sandbox_manager.ensure_image()
            logger.info("Sandbox image ready")
        except Exception as e:
            logger.warning(f"Sandbox initialization failed: {e}")
        
        # Connect to Redis
        await redis_bus.connect()
        logger.info("Redis connection established")
        
        self.running = True
        
        # Start background bridge monitoring
        bridge_task = asyncio.create_task(self.run_bridge_loop())
        
        # Start both teams
        blue_task = asyncio.create_task(self.start_blue_team())
        red_task = asyncio.create_task(self.start_red_team())
        
        # Wait for tasks
        try:
            # Give Blue Team time to initialize
            await asyncio.sleep(2)
            
            # Start Red Team (this is the main execution)
            await red_task
            
        except KeyboardInterrupt:
            logger.info("Received interrupt signal")
        except Exception as e:
            logger.error(f"Error in combined engine: {e}")
        finally:
            self.running = False
            bridge_task.cancel()
            try:
                await bridge_task
            except asyncio.CancelledError:
                pass
            await redis_bus.disconnect()
            # Cleanup Blue Team subprocess
            if hasattr(self, 'blue_process') and self.blue_process:
                logger.info("Terminating Blue Team subprocess...")
                try:
                    self.blue_process.terminate()
                    self.blue_process.wait(timeout=5)
                except Exception as e:
                    logger.warning(f"Blue Team termination: {e}")
                    try:
                        self.blue_process.kill()
                    except:
                        pass
            # Cleanup sandbox
            try:
                await sandbox_manager.destroy_all()
                logger.info("Sandbox destroyed")
            except Exception as e:
                logger.warning(f"Sandbox cleanup failed: {e}")
            logger.info("Combined engine stopped")
            
    def signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        logger.info(f"Received signal {signum}, shutting down...")
        self.running = False
        # Force exit on second signal
        if signum == signal.SIGINT:
            signal.signal(signal.SIGINT, lambda s, f: os._exit(0))


async def main():
    """Main entry point."""
    # Print VibeCheck banner
    print(f"\n{BOLD_YELLOW}{'='*60}{RESET}")
    print(f"{BOLD_YELLOW}✅ VIBECHECK COMMAND CENTER{RESET}")
    print(f"{BOLD_YELLOW}{'='*60}{RESET}")
    print(f"{BOLD_CYAN}Red Team + Blue Team Integrated Security Platform{RESET}")
    print(f"{BOLD_YELLOW}{'='*60}{RESET}\n")
    
    engine = CombinedEngine()
    
    # Setup signal handlers
    signal.signal(signal.SIGINT, lambda s, f: engine.signal_handler(s, f))
    signal.signal(signal.SIGTERM, lambda s, f: engine.signal_handler(s, f))
    
    await engine.start()


if __name__ == "__main__":
    asyncio.run(main())
