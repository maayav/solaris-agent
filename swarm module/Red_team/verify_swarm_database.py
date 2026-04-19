"""
Swarm Database Verification Script
=================================
This script verifies that all required Supabase tables exist.
Run this before connecting the frontend to verify the database is properly set up.

Usage:
    python verify_swarm_database.py

Requirements:
    pip install supabase
"""

import sys

# Supabase connection
SUPABASE_URL = "https://nesjaodrrkefpmqdqtgv.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc2phb2RycmtlZnBtcWRxdGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMTg0MjcsImV4cCI6MjA4NjY5NDQyN30.zbEAwOcZ7Tn-LVfGC8KdQeh3D3xEyzghZ-Mfg0VgnfE"

# Expected tables in order of dependencies
EXPECTED_TABLES = [
    "swarm_missions",
    "swarm_agent_states",
    "swarm_findings",
    "swarm_events",
    "swarm_exploit_attempts",
]


def verify_database():
    """Verify all swarm tables exist."""
    try:
        from supabase import create_client
    except ImportError:
        print("[ERROR] supabase package not installed.")
        print("Run: pip install supabase")
        sys.exit(1)

    results = {
        "connected": False,
        "tables_found": [],
        "tables_missing": [],
        "row_counts": {},
    }

    try:
        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        results["connected"] = True
        print("[PASS] Connected to Supabase")
    except Exception as e:
        print(f"[FAIL] Failed to connect to Supabase: {e}")
        return results

    # Check which tables exist by trying to query them
    print("\n=== STEP 1: Checking Table Existence ===")
    
    for table in EXPECTED_TABLES:
        try:
            # Try to count rows - this will fail if table doesn't exist
            response = client.table(table).select("*", count="exact").limit(1).execute()
            results["tables_found"].append(table)
            print(f"  [PASS] {table} - exists")
        except Exception as e:
            error_msg = str(e)
            if "does not exist" in error_msg.lower() or "PGRST204" in error_msg:
                results["tables_missing"].append(table)
                print(f"  [FAIL] {table} - MISSING")
            else:
                # Table might exist but has other issues
                results["tables_found"].append(table)
                print(f"  [PASS] {table} - exists (with warnings)")

    # Get row counts for existing tables
    print("\n=== STEP 2: Current Data Counts ===")
    
    for table in results["tables_found"]:
        try:
            response = client.table(table).select("*", count="exact").execute()
            count = response.count or 0
            results["row_counts"][table] = count
            print(f"  [INFO] {table}: {count} rows")
        except Exception as e:
            print(f"  [WARN] {table}: Could not get count - {e}")
            results["row_counts"][table] = -1

    # Summary
    print("\n" + "=" * 50)
    print("VERIFICATION SUMMARY")
    print("=" * 50)
    
    if results["tables_missing"]:
        print(f"[FAIL] MISSING TABLES: {', '.join(results['tables_missing'])}")
        print("\nTo fix, run these SQL migrations in Supabase SQL Editor:")
        print("  1. plans/swarm-database-schema.md")
        print("  2. plans/swarm-timeline-migration.sql")
    else:
        print("[PASS] All required tables exist!")
    
    return results


if __name__ == "__main__":
    results = verify_database()
    
    # Exit with error code if tables are missing
    if results["tables_missing"]:
        sys.exit(1)
    sys.exit(0)
