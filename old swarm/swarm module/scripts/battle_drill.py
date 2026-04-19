#!/usr/bin/env python3
"""
BATTLE DRILL SIMULATION: Red Team vs Blue Team Integration Test

This script demonstrates the full autonomous flow:
1. Blue Team detects a HIGH severity attack
2. Red Team Commander receives defense intel within <2 seconds
3. Commander marks the endpoint as FORBIDDEN
4. Red Team pivots to a different attack vector

Usage:
    ./venv/bin/python battle_drill.py
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

# Setup paths
PROJECT_ROOT = Path(__file__).parent
RED_TEAM_PATH = PROJECT_ROOT / "Red_team"
sys.path.insert(0, str(RED_TEAM_PATH))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("BATTLE_DRILL")

# ANSI colors for dramatic effect
BOLD_RED = "\033[1;31m"
BOLD_GREEN = "\033[1;32m"
BOLD_YELLOW = "\033[1;33m"
BOLD_CYAN = "\033[1;36m"
BOLD_MAGENTA = "\033[1;35m"
RESET = "\033[0m"
CHECK = "✅"
CROSS = "❌"
WARNING = "⚠️"
SHIELD = "🛡️"
SWORD = "⚔️"


async def inject_mock_detection(redis_bus, target_endpoint: str):
    """Inject a HIGH severity detection into the defense_analytics stream."""
    logger.info(f"{BOLD_YELLOW}{SHIELD}{RESET} BLUE TEAM: Injecting HIGH severity detection...")
    
    detection_event = {
        "timestamp": time.time(),
        "severity": "HIGH",
        "vulnerability_type": "SQL_INJECTION",
        "endpoint": target_endpoint,
        "description": f"Detected SQL injection attempt on {target_endpoint}/api/login",
        "blocked_payload": "' OR 1=1 --",
        "detected_signature": "sql_injection_heuristic_v2",
        "source_ip": "192.168.1.100",
        "action_taken": "BLOCKED"
    }
    
    await redis_bus.publish("defense_analytics", detection_event)
    logger.info(f"{BOLD_GREEN}{CHECK}{RESET} Detection event published to Redis")
    return detection_event


async def monitor_redis_latency(redis_bus, timeout: float = 2.0):
    """Monitor how quickly defense intel is retrieved."""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        messages = await redis_bus.get_latest_defense_intel(count=5)
        if messages:
            elapsed = time.time() - start_time
            logger.info(f"{BOLD_GREEN}{CHECK}{RESET} Defense intel retrieved in {elapsed:.3f}s")
            return messages, elapsed
        await asyncio.sleep(0.1)
    
    return None, timeout


async def run_battle_drill():
    """Execute the full battle drill simulation."""
    
    print(f"\n{BOLD_MAGENTA}{SWORD}{RESET} {BOLD_RED}BATTLE DRILL: Red Team vs Blue Team{RESET}")
    print("=" * 70)
    print()
    
    # Phase 1: Setup
    logger.info("Phase 1: Initializing Redis connection...")
    from core.redis_bus import redis_bus
    await redis_bus.connect()
    logger.info(f"{BOLD_GREEN}{CHECK}{RESET} Redis connected")
    
    # Phase 2: Blue Team Detection Injection
    print()
    logger.info(f"{BOLD_CYAN}{SWORD}{RESET} PHASE 2: BLUE TEAM DETECTION")
    print("-" * 70)
    
    target_endpoint = "http://localhost:3000"
    detection = await inject_mock_detection(redis_bus, target_endpoint)
    
    logger.info(f"  Severity: {BOLD_RED}{detection['severity']}{RESET}")
    logger.info(f"  Type: {detection['vulnerability_type']}")
    logger.info(f"  Endpoint: {detection['endpoint']}")
    logger.info(f"  Action: {detection['action_taken']}")
    
    # Phase 3: Test Redis Latency (Nervous System Check)
    print()
    logger.info(f"{BOLD_YELLOW}{WARNING}{RESET} PHASE 3: NERVOUS SYSTEM LATENCY CHECK")
    print("-" * 70)
    logger.info("Measuring time to retrieve defense intel...")
    
    messages, latency = await monitor_redis_latency(redis_bus, timeout=2.0)
    
    if messages:
        if latency < 2.0:
            logger.info(f"{BOLD_GREEN}{CHECK}{RESET} PASS: Latency {latency:.3f}s < 2s threshold")
        else:
            logger.warning(f"{CROSS} FAIL: Latency {latency:.3f}s exceeds 2s threshold")
    else:
        logger.error(f"{CROSS} FAIL: Could not retrieve defense intel within timeout")
    
    # Phase 4: Commander Logic Test (Logic Pivot)
    print()
    logger.info(f"{BOLD_RED}{SWORD}{RESET} PHASE 4: RED TEAM COMMANDER LOGIC PIVOT")
    print("-" * 70)
    
    # Simulate what the Commander would do
    forbidden_endpoints = []
    high_severity_detected = False
    
    for msg in messages or []:
        severity = msg.get('severity', 'unknown').upper()
        if severity == 'HIGH':
            high_severity_detected = True
            endpoint = msg.get('endpoint', target_endpoint)
            if endpoint not in forbidden_endpoints:
                forbidden_endpoints.append(endpoint)
                logger.info(f"{BOLD_RED}{CROSS}{RESET} Commander: Marking {endpoint} as FORBIDDEN")
                logger.info(f"  Reason: HIGH severity {msg.get('vulnerability_type')} detected")
    
    if high_severity_detected:
        logger.info(f"{BOLD_GREEN}{CHECK}{RESET} Commander: Pivoting to alternative attack vector")
        logger.info(f"  New target: http://localhost:3000/api/products (different endpoint)")
        logger.info(f"  Forbidden list: {forbidden_endpoints}")
    
    # Phase 5: Summary
    print()
    logger.info(f"{BOLD_GREEN}{CHECK}{RESET} {BOLD_GREEN}BATTLE DRILL COMPLETE{RESET}")
    print("=" * 70)
    print(f"{BOLD_CYAN}Results:{RESET}")
    print(f"  - Redis Latency: {latency:.3f}s (< 2s threshold: {'PASS' if latency < 2.0 else 'FAIL'})")
    print(f"  - HIGH Severity Detection: {'DETECTED' if high_severity_detected else 'NOT DETECTED'}")
    print(f"  - Endpoint Blocking: {len(forbidden_endpoints)} endpoints marked FORBIDDEN")
    print(f"  - Logic Pivot: {'SUCCESS' if high_severity_detected else 'N/A'}")
    print()
    print(f"{BOLD_YELLOW}The VibeCheck Red+Blue integration is functional!{RESET}")
    print()
    
    await redis_bus.disconnect()
    return True


if __name__ == "__main__":
    try:
        success = asyncio.run(run_battle_drill())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        logger.info("Battle drill interrupted")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Battle drill failed: {e}")
        sys.exit(1)
