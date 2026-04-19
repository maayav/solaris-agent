#!/usr/bin/env python3
"""
Standalone Blue Team (VibeCheck) Launcher

Run this separately to start the Blue Team defensive scanner.
It will publish defense analytics to Redis for the Red Team to consume.
"""

import asyncio
import logging
import sys
import signal
from pathlib import Path

# Configure logging with VibeCheck branding
BOLD_YELLOW = "\033[1;33m"
BOLD_CYAN = "\033[1;36m"
RESET = "\033[0m"
CHECK_MARK = "✅"

logging.basicConfig(
    level=logging.INFO,
    format=f"%(asctime)s - {BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] %(message)s"
)
logger = logging.getLogger(__name__)

# Add Blue Team path - go up from scripts/ to vibecheck/, then into Blue_team
BLUE_TEAM_PATH = Path(__file__).parent.parent / "Blue_team" / "solaris-agent" / "vibecheck"
sys.path.insert(0, str(BLUE_TEAM_PATH))

# Load environment variables from Blue Team .env file
from dotenv import load_dotenv
env_path = BLUE_TEAM_PATH / ".env"
load_dotenv(dotenv_path=env_path)

from core.redis_bus import get_redis_bus
from core.config import get_settings
from core.falkordb import get_falkordb_client
from core.qdrant import QdrantClient
from core.supabase_client import get_supabase_client


class MockFalkorDB:
    """Mock FalkorDB for demo fallback when real DB is unavailable."""
    def __init__(self):
        self._graphs = {}
        logger.warning("Using MockFalkorDB - DEMO MODE")
    
    def connect(self):
        logger.info("MockFalkorDB: Connected (in-memory)")
    
    def create_scan_graph(self, scan_id: str):
        self._graphs[scan_id] = {"nodes": [], "edges": []}
        return MockGraph(scan_id)
    
    def disconnect(self):
        logger.info("MockFalkorDB: Disconnected")


class MockGraph:
    """Mock graph for demo mode."""
    def __init__(self, scan_id: str):
        self.scan_id = scan_id
        self.nodes = []
    
    def add_node(self, **kwargs):
        self.nodes.append(kwargs)
        return True


class MockQdrant:
    """Mock Qdrant for demo fallback when real DB is unavailable."""
    def __init__(self):
        self._collections = {}
        logger.warning("Using MockQdrant - DEMO MODE")
    
    def connect(self):
        logger.info("MockQdrant: Connected (in-memory)")
    
    def get_collections(self):
        return []
    
    def close(self):
        logger.info("MockQdrant: Disconnected")


class BlueTeamEngine:
    """Blue Team (VibeCheck) defensive engine."""
    
    def __init__(self):
        self.running = False
        self.redis_bus = None
        self.falkordb = None
        self.qdrant = None
        self.use_mock_db = False
        
    async def start(self):
        """Start the Blue Team engine."""
        print(f"\n{BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Blue Team Defense System Initializing...", flush=True)
        
        # Load settings
        settings = get_settings()
        logger.info(f"Loaded configuration from {settings}")
        
        # Connect to Redis
        self.redis_bus = get_redis_bus()
        await self.redis_bus.connect()
        logger.info("Connected to Redis - Publishing defense analytics")
        
        # Connect to FalkorDB (with Mock fallback)
        try:
            logger.info("Connecting to FalkorDB...")
            self.falkordb = get_falkordb_client()
            self.falkordb.connect()  # Not async
            logger.info("FalkorDB connected")
        except Exception as e:
            logger.warning(f"FalkorDB connection failed: {e}")
            logger.info("Falling back to MockFalkorDB (DEMO MODE)")
            self.falkordb = MockFalkorDB()
            self.falkordb.connect()
            self.use_mock_db = True
        
        # Connect to Qdrant (with Mock fallback)
        try:
            logger.info("Connecting to Qdrant...")
            self.qdrant = QdrantClient()
            self.qdrant.connect()  # Not async - returns None
            logger.info("Qdrant connected")
        except Exception as e:
            logger.warning(f"Qdrant connection failed: {e}")
            logger.info("Falling back to MockQdrant (DEMO MODE)")
            self.qdrant = MockQdrant()
            self.qdrant.connect()
            self.use_mock_db = True
        
        # Connect to Supabase (optional - doesn't block demo)
        try:
            logger.info("Connecting to Supabase...")
            supabase = get_supabase_client()
            logger.info("Supabase connected")
        except Exception as e:
            logger.warning(f"Supabase connection failed: {e}")
            logger.info("Continuing without Supabase (DEMO MODE)")
        
        mode_str = " [DEMO MODE - Mock DBs]" if self.use_mock_db else ""
        print(f"{BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Defense Systems Online{mode_str} - Monitoring Active")
        logger.info("VibeCheck Blue Team is ready to publish defense analytics")
        
        self.running = True
        
        # Keep running until interrupted
        try:
            while self.running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await self.shutdown()
    
    async def shutdown(self):
        """Graceful shutdown."""
        logger.info("Shutting down Blue Team...")
        if self.redis_bus:
            await self.redis_bus.disconnect()
        logger.info("Blue Team stopped")
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        logger.info(f"Received signal {signum}")
        self.running = False


async def main():
    """Main entry point."""
    # Print VibeCheck banner
    print(f"\n{BOLD_YELLOW}{'='*60}{RESET}")
    print(f"{BOLD_YELLOW}✅ VIBECHECK COMMAND CENTER{RESET}")
    print(f"{BOLD_YELLOW}{'='*60}{RESET}")
    print(f"{BOLD_CYAN}Blue Team Defense Systems{RESET}")
    print(f"{BOLD_YELLOW}{'='*60}{RESET}\n")
    
    engine = BlueTeamEngine()
    signal.signal(signal.SIGINT, lambda s, f: engine.signal_handler(s, f))
    signal.signal(signal.SIGTERM, lambda s, f: engine.signal_handler(s, f))
    await engine.start()


if __name__ == "__main__":
    asyncio.run(main())
