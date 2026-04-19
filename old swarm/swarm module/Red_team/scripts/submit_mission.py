#!/usr/bin/env python3
"""
Submit a new mission to the swarm.

Usage:
    python scripts/submit_mission.py [target_url] [objective]

Examples:
    python scripts/submit_mission.py http://localhost:8080 "Test Juice Shop security"
    python scripts/submit_mission.py http://localhost:3000 "Scan for vulnerabilities"
"""

import sys
import json
import redis
import uuid


def submit_mission(target: str, objective: str, mode: str = "live") -> str:
    """Submit a mission to the Redis stream."""
    r = redis.Redis(host='localhost', port=6380, decode_responses=True)
    
    mission = {
        'mission_id': str(uuid.uuid4()),
        'action': 'start',
        'target': target,
        'objective': objective,
        'mode': mode,
    }
    
    msg_id = r.xadd('swarm_missions', {'data': json.dumps(mission)})
    return msg_id


if __name__ == "__main__":
    if len(sys.argv) < 2:
        target = "http://localhost:8080"
        objective = "Comprehensive security audit"
    elif len(sys.argv) < 3:
        target = sys.argv[1]
        objective = "Security scan"
    else:
        target = sys.argv[1]
        objective = sys.argv[2]
    
    print(f"Submitting mission...")
    print(f"  Target: {target}")
    print(f"  Objective: {objective}")
    
    try:
        msg_id = submit_mission(target, objective)
        print(f"\n[OK] Mission submitted successfully!")
        print(f"  Stream Message ID: {msg_id}")
        print(f"\nThe swarm worker will process this mission shortly.")
    except Exception as e:
        print(f"\n[FAIL] Failed to submit mission: {e}")
        sys.exit(1)
