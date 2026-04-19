"""
Swarm Data Validation Test Script
=================================
This script demonstrates what data is available in the Supabase tables
and helps understand what the frontend needs.

Usage:
    python test_swarm_data.py
"""

import sys

# Supabase connection
SUPABASE_URL = "https://nesjaodrrkefpmqdqtgv.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc2phb2RycmtlZnBtcWRxdGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMTg0MjcsImV4cCI6MjA4NjY5NDQyN30.zbEAwOcZ7Tn-LVfGC8KdQeh3D3xEyzghZ-Mfg0VgnfE"


def test_swarm_data():
    """Test the data available in each swarm table."""
    try:
        from supabase import create_client
    except ImportError:
        print("[ERROR] supabase package not installed.")
        sys.exit(1)

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    print("[PASS] Connected to Supabase\n")

    # 1. Get recent missions
    print("=" * 60)
    print("1. RECENT MISSIONS (swarm_missions)")
    print("=" * 60)
    
    response = client.table("swarm_missions").select(
        "id, target, status, progress, iteration, created_at, started_at, completed_at"
    ).order("created_at", desc=True).limit(5).execute()
    
    missions = response.data
    print(f"Found {len(missions)} recent missions\n")
    
    if missions:
        # Get the most recent mission
        latest_mission = missions[0]
        mission_id = latest_mission["id"]
        
        print(f"Latest Mission:")
        print(f"  ID: {mission_id}")
        print(f"  Target: {latest_mission.get('target')}")
        print(f"  Status: {latest_mission.get('status')}")
        print(f"  Progress: {latest_mission.get('progress')}%")
        print(f"  Iteration: {latest_mission.get('iteration')}")
        print(f"  Created: {latest_mission.get('created_at')}")
        print(f"  Started: {latest_mission.get('started_at')}")
        print(f"  Completed: {latest_mission.get('completed_at')}")
    else:
        print("No missions found")
        return

    # 2. Get agent states for this mission
    print("\n" + "=" * 60)
    print("2. AGENT STATES (swarm_agent_states)")
    print("=" * 60)
    
    response = client.table("swarm_agent_states").select(
        "id, agent_id, agent_name, agent_team, status, iter, task, last_updated"
    ).eq("mission_id", mission_id).execute()
    
    agent_states = response.data
    print(f"Found {len(agent_states)} agent states\n")
    
    # Group by agent_name
    agents = {}
    for state in agent_states:
        name = state["agent_name"]
        if name not in agents:
            agents[name] = []
        agents[name].append(state)
    
    print("Unique agents:")
    for name, states in agents.items():
        latest = states[-1] if states else {}
        print(f"  - {name}: status={latest.get('status')}, iter={latest.get('iter')}, task={latest.get('task', '')[:50] if latest.get('task') else 'None'}...")

    # 3. Get events for this mission
    print("\n" + "=" * 60)
    print("3. MISSION EVENTS (swarm_events)")
    print("=" * 60)
    
    response = client.table("swarm_events").select(
        "id, event_type, agent_name, stage, title, success, created_at, iteration"
    ).eq("mission_id", mission_id).order("created_at", desc=True).limit(10).execute()
    
    events = response.data
    print(f"Found {len(events)} recent events\n")
    
    print("Recent event types:")
    event_types = {}
    for event in events:
        etype = event["event_type"]
        event_types[etype] = event_types.get(etype, 0) + 1
    
    for etype, count in sorted(event_types.items(), key=lambda x: -x[1]):
        print(f"  - {etype}: {count}")

    # 4. Get findings for this mission
    print("\n" + "=" * 60)
    print("4. FINDINGS (swarm_findings)")
    print("=" * 60)
    
    response = client.table("swarm_findings").select(
        "id, title, severity, finding_type, confirmed, agent_name, created_at"
    ).eq("mission_id", mission_id).execute()
    
    findings = response.data
    print(f"Found {len(findings)} findings\n")
    
    # Group by severity
    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = f.get("severity", "unknown")
        if sev in by_severity:
            by_severity[sev] += 1
    
    print("By severity:")
    for sev, count in by_severity.items():
        if count > 0:
            print(f"  - {sev}: {count}")
    
    # Show sample finding
    if findings:
        print(f"\nSample finding:")
        f = findings[0]
        print(f"  Title: {f.get('title')}")
        print(f"  Severity: {f.get('severity')}")
        print(f"  Type: {f.get('finding_type')}")
        print(f"  Confirmed: {f.get('confirmed')}")
        print(f"  Agent: {f.get('agent_name')}")

    # 5. Get exploit attempts
    print("\n" + "=" * 60)
    print("5. EXPLOIT ATTEMPTS (swarm_exploit_attempts)")
    print("=" * 60)
    
    response = client.table("swarm_exploit_attempts").select(
        "id, exploit_type, target_url, success, response_code, error_type, created_at"
    ).eq("mission_id", mission_id).order("created_at", desc=True).limit(10).execute()
    
    exploits = response.data
    print(f"Found {len(exploits)} exploit attempts\n")
    
    # Group by type
    by_type = {}
    for e in exploits:
        etype = e.get("exploit_type", "unknown")
        by_type[etype] = by_type.get(etype, 0) + 1
    
    print("By type:")
    for etype, count in sorted(by_type.items(), key=lambda x: -x[1])[:10]:
        print(f"  - {etype}: {count}")
    
    # Success rate
    if exploits:
        success_count = sum(1 for e in exploits if e.get("success"))
        print(f"\nSuccess rate: {success_count}/{len(exploits)} = {100*success_count/len(exploits):.1f}%")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Mission ID: {mission_id}")
    print(f"Agent states: {len(agent_states)}")
    print(f"Events: {len(events)}")
    print(f"Findings: {len(findings)}")
    print(f"Exploit attempts: {len(exploits)}")
    
    print("\n[INFO] This data structure matches what the frontend expects:")
    print("  - getSwarmMission() -> swarm_missions")
    print("  - getSwarmAgentStates() -> swarm_agent_states") 
    print("  - getSwarmEvents() -> swarm_events")
    print("  - getSwarmFindings() -> swarm_findings")


if __name__ == "__main__":
    test_swarm_data()
