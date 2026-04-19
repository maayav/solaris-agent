#!/usr/bin/env python3
"""
Submit a new mission to the swarm.

Usage:
    python scripts/submit_mission.py [target_url] [objective] [mode] [repo_url]

Examples:
    # Live mode (target already running)
    python scripts/submit_mission.py http://localhost:8080 "Test Juice Shop security"
    
    # Repo mode (auto-deploy from GitHub)
    python scripts/submit_mission.py http://localhost:3000 "Security audit" repo https://github.com/juice-shop/juice-shop
    
    # Shorthand for Juice Shop repo deployment
    python scripts/submit_mission.py http://localhost:3000 "Security audit" repo
"""

import sys
import json
import redis
import uuid

REDIS_HOST = 'localhost'
REDIS_PORT = 6380
STREAM_NAME = 'swarm_missions'

# Default repos
DEFAULT_REPOS = {
    'juice-shop': 'https://github.com/juice-shop/juice-shop',
    'nodegoat': 'https://github.com/owasp/nodegoat',
}


def submit_mission(
    target: str,
    objective: str,
    mode: str = "live",
    repo_url: str | None = None,
    max_iterations: int = 5,
) -> str:
    """
    Submit a mission to the Redis stream.
    
    Args:
        target: Target URL (e.g., http://localhost:3000)
        objective: Mission objective
        mode: "live" or "repo" (repo = auto-deploy from repo_url)
        repo_url: GitHub repo URL (required if mode=repo)
        max_iterations: Max agent iterations
        
    Returns:
        Stream message ID
    """
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    
    mission = {
        'mission_id': str(uuid.uuid4()),
        'action': 'start',
        'target': target,
        'objective': objective,
        'mode': mode,
        'max_iterations': max_iterations,
    }
    
    if repo_url:
        mission['repo_url'] = repo_url
    
    msg_id = r.xadd(STREAM_NAME, {'data': json.dumps(mission)})
    return msg_id


def clear_pending_missions() -> int:
    """Delete all pending messages from the swarm_missions stream."""
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    
    # Get all messages in the stream
    messages = r.xread({STREAM_NAME: '0'}, count=100)
    
    if not messages:
        print("No messages in stream")
        return 0
    
    count = 0
    for stream_name, stream_messages in messages:
        for msg_id, data in stream_messages:
            r.xdel(STREAM_NAME, msg_id)
            count += 1
    
    print(f"Deleted {count} messages from {STREAM_NAME}")
    return count


def kill_all_containers():
    """Kill all target- containers created by the swarm."""
    import subprocess
    result = subprocess.run(
        ['docker', 'ps', '-a', '--format', '{{.Names}}'],
        capture_output=True,
        text=True,
    )
    
    count = 0
    for name in result.stdout.strip().split('\n'):
        if name.startswith('target-'):
            print(f"Removing container: {name}")
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            count += 1
    
    print(f"Removed {count} containers")
    return count


if __name__ == "__main__":
    args = sys.argv[1:]
    
    if '--clear' in args:
        # Clear pending missions
        clear_pending_missions()
        sys.exit(0)
    
    if '--kill-containers' in args:
        # Kill all target containers
        kill_all_containers()
        sys.exit(0)
    
    if '--help' in args or '-h' in args:
        print(__doc__)
        print("\nSpecial commands:")
        print("  --clear          Clear all pending missions from the queue")
        print("  --kill-containers Kill all target-* Docker containers")
        sys.exit(0)
    
    if len(args) < 2:
        target = "http://localhost:8080"
        objective = "Comprehensive security audit"
        mode = "live"
        repo_url = None
    elif len(args) < 3:
        target = args[0]
        objective = args[1]
        mode = "live"
        repo_url = None
    elif len(args) < 4:
        target = args[0]
        objective = args[1]
        mode = args[2]
        repo_url = None
    else:
        target = args[0]
        objective = args[1]
        mode = args[2]
        repo_url = args[3] if args[3].startswith('http') else None
    
    # Auto-fill repo_url if mode=repo and target is localhost:3000
    if mode == "repo" and not repo_url:
        repo_url = DEFAULT_REPOS.get('juice-shop')
        print(f"Using default repo: {repo_url}")
    
    print(f"Submitting mission...")
    print(f"  Target: {target}")
    print(f"  Objective: {objective}")
    print(f"  Mode: {mode}")
    if repo_url:
        print(f"  Repo: {repo_url}")
    
    try:
        msg_id = submit_mission(target, objective, mode, repo_url)
        print(f"\n[OK] Mission submitted successfully!")
        print(f"  Stream Message ID: {msg_id}")
        print(f"\nThe swarm worker will process this mission shortly.")
    except Exception as e:
        print(f"\n[FAIL] Failed to submit mission: {e}")
        sys.exit(1)
