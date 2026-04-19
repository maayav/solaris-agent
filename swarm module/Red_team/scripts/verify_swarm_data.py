#!/usr/bin/env python3
"""
Test script to verify swarm data in Supabase.
Run this after a mission completes to check if data is properly stored.

Usage:
    python scripts/verify_swarm_data.py [mission_id]
    
If no mission_id is provided, it will show all recent missions.
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta

# Fix Windows Unicode output issues
import io
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

# Load .env file
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(env_path)

from core.supabase_client import get_supabase_client


def print_section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_data(title: str, data):
    print(f"\n--- {title} ---")
    if not data:
        print("  (empty)")
        return
    for i, row in enumerate(data, 1):
        print(f"  {i}. {row}")


async def verify_mission(mission_id: str, supabase):
    """Verify all data for a specific mission."""
    print_section(f"MISSION: {mission_id}")
    
    # 1. Check swarm_missions table
    print_section("1. Checking swarm_missions table")
    try:
        client = supabase._client
        result = client.table("swarm_missions").select("*").eq("id", mission_id).execute()
        if result.data:
            for row in result.data:
                print(f"  Status: {row.get('status')}")
                print(f"  Target: {row.get('target')}")
                print(f"  Created: {row.get('created_at')}")
        else:
            print("  ❌ Mission NOT FOUND in swarm_missions!")
    except Exception as e:
        print(f"  Error: {e}")
    
    # 2. Check swarm_events table
    print_section("2. Checking swarm_events table")
    try:
        client = supabase._client
        result = client.table("swarm_events").select(
            "id, event_type, agent_name, title, success, created_at, stage"
        ).eq("mission_id", mission_id).order("created_at").execute()
        if result.data:
            print(f"  Total events: {len(result.data)}")
            for row in result.data:
                status = "✓" if row.get("success") else "✗"
                print(f"    {status} [{row.get('event_type')}] {row.get('agent_name')}: {row.get('title')[:50]}")
        else:
            print("  ❌ No events found!")
    except Exception as e:
        print(f"  Error: {e}")
    
    # 3. Check swarm_exploit_attempts table
    print_section("3. Checking swarm_exploit_attempts table")
    try:
        client = supabase._client
        result = client.table("swarm_exploit_attempts").select(
            "id, exploit_type, target_url, success, created_at"
        ).eq("mission_id", mission_id).order("created_at").execute()
        if result.data:
            print(f"  Total exploit attempts: {len(result.data)}")
            for row in result.data:
                status = "✓" if row.get("success") else "✗"
                print(f"    {status} {row.get('exploit_type')}: {row.get('target_url')[:60]}")
        else:
            print("  ❌ No exploit attempts found!")
    except Exception as e:
        print(f"  Error: {e}")
    
    # 4. Check swarm_findings table
    print_section("4. Checking swarm_findings table")
    try:
        client = supabase._client
        result = client.table("swarm_findings").select(
            "id, title, severity, confirmed, created_at"
        ).eq("mission_id", mission_id).order("created_at").execute()
        if result.data:
            print(f"  Total findings: {len(result.data)}")
            for row in result.data:
                severity = row.get("severity", "N/A")
                confirmed = "✓" if row.get("confirmed") else "✗"
                print(f"    [{severity.upper()}] {confirmed} {row.get('title')[:60]}")
        else:
            print("  (No findings)")
    except Exception as e:
        print(f"  Error: {e}")
    
    # 5. Check mission_timeline_view
    print_section("5. Checking mission_timeline_view")
    try:
        client = supabase._client
        result = client.table("mission_timeline_view").select(
            "id, event_type, agent_name, title, success, created_at"
        ).eq("mission_id", mission_id).order("created_at").execute()
        if result.data:
            print(f"  Total timeline events: {len(result.data)}")
            for row in result.data:
                status = "✓" if row.get("success") else "✗"
                print(f"    {status} [{row.get('event_type')}] {row.get('title')[:50]}")
        else:
            print("  ❌ No timeline data - VIEW IS EMPTY!")
            print("  This is the BUG - the views aren't returning data!")
    except Exception as e:
        print(f"  Error: {e}")
    
    # 6. Check mission_statistics_view
    print_section("6. Checking mission_statistics_view")
    try:
        client = supabase._client
        result = client.table("mission_statistics_view").select("*").eq("mission_id", mission_id).execute()
        if result.data:
            stats = result.data[0]
            print(f"  Status: {stats.get('status')}")
            print(f"  Total events: {stats.get('total_events')}")
            print(f"  Exploit events: {stats.get('exploit_events')}")
            print(f"  Total exploit attempts: {stats.get('total_exploit_attempts')}")
            print(f"  Successful exploits: {stats.get('successful_exploits')}")
            print(f"  Failed exploits: {stats.get('failed_exploits')}")
            print(f"  Total findings: {stats.get('total_findings')}")
        else:
            print("  ❌ No statistics - VIEW IS EMPTY!")
    except Exception as e:
        print(f"  Error: {e}")


async def list_recent_missions(supabase, limit: int = 10):
    """List recent missions."""
    print_section(f"RECENT MISSIONS (last {limit})")
    
    try:
        client = supabase._client
        result = client.table("swarm_missions").select(
            "id, target, status, created_at"
        ).order("created_at", desc=True).limit(limit).execute()
        
        if result.data:
            for row in result.data:
                status = row.get("status", "unknown")
                created = row.get("created_at", "")
                mission_id = row.get("id", "")
                target = row.get("target", "")[:50]
                print(f"  [{status.upper():10}] {created[:19]} | {target}... | {mission_id[:8]}...")
        else:
            print("  No missions found")
    except Exception as e:
        print(f"  Error: {e}")


async def check_orphaned_events(supabase):
    """Check for events without a corresponding mission."""
    print_section("CHECKING FOR ORPHANED EVENTS")
    
    try:
        client = supabase._client
        
        # Get all unique mission_ids from swarm_events
        result = client.table("swarm_events").select("mission_id").execute()
        if not result.data:
            print("  No events found")
            return
            
        mission_ids = set(row["mission_id"] for row in result.data)
        print(f"  Found {len(mission_ids)} unique mission_ids in swarm_events")
        
        # Check each mission_id
        orphaned = []
        for mission_id in list(mission_ids)[:20]:  # Check first 20
            mission_result = client.table("swarm_missions").select("id").eq("id", mission_id).execute()
            if not mission_result.data:
                orphaned.append(mission_id)
        
        if orphaned:
            print(f"  ❌ Found {len(orphaned)} ORPHANED mission_ids (no matching swarm_missions record):")
            for mid in orphaned:
                print(f"      {mid}")
        else:
            print("  ✓ All events have corresponding mission records")
            
    except Exception as e:
        print(f"  Error: {e}")


async def main():
    print("="*60)
    print("  SWARM DATA VERIFICATION TOOL")
    print("="*60)
    
    # Initialize Supabase client
    supabase = get_supabase_client()
    
    if not supabase._enabled:
        print("\n❌ Supabase client is NOT enabled!")
        print("   Check SUPABASE_URL and SUPABASE_ANON_KEY environment variables")
        return
    
    print(f"\n✓ Supabase client enabled")
    print(f"  URL: {supabase._url}")
    
    # Get mission_id from command line or list recent
    mission_id = sys.argv[1] if len(sys.argv) > 1 else None
    
    if mission_id:
        await verify_mission(mission_id, supabase)
    else:
        await list_recent_missions(supabase)
        await check_orphaned_events(supabase)
        
        print("\n" + "="*60)
        print("  USAGE")
        print("="*60)
        print("  To verify a specific mission:")
        print("    python scripts/verify_swarm_data.py <mission_id>")
        print("\n  Example:")
        print("    python scripts/verify_swarm_data.py a219b9f3-aeb4-48eb-8f6c-6caf59215b12")


if __name__ == "__main__":
    asyncio.run(main())
