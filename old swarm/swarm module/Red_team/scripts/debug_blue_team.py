"""Debug script to test Blue Team bridge queries."""
import asyncio
import sys
import os
sys.path.insert(0, r'D:\Projects\Prawin\solaris\solaris-agent\swarm module\Red_team')

# Load environment variables from .env file
from pathlib import Path
env_path = Path(r'D:\Projects\Prawin\solaris\solaris-agent\swarm module\Red_team\.env')
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key] = value
    print(f"[INFO] Loaded .env from {env_path}")
else:
    print(f"[WARNING] .env file not found at {env_path}")

from core.blue_team_bridge import BlueTeamBridge

async def test():
    print("="*60)
    print("BLUE TEAM BRIDGE DEBUG")
    print("="*60)
    
    bridge = BlueTeamBridge()
    
    # Test 1: Direct Supabase query
    print("\n[TEST 1] Querying Supabase directly...")
    supabase = await bridge._get_supabase()
    if supabase:
        print(f"  Supabase client: {type(supabase)}")
        print(f"  Enabled: {getattr(supabase, '_enabled', 'N/A')}")
        
        # Try to get scan_queue count
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            
            # Query all scans
            scan_query = supabase.table("scan_queue").select("id, repo_url, status").limit(5)
            result = await loop.run_in_executor(None, lambda: scan_query.execute())
            
            if result and hasattr(result, 'data'):
                print(f"  Found {len(result.data)} scans in scan_queue:")
                for row in result.data:
                    print(f"    - {row.get('id')}: {row.get('repo_url')} ({row.get('status')})")
            else:
                print(f"  No scan data. Result: {result}")
                
            # Query vulnerabilities count
            vuln_query = supabase.table("vulnerabilities").select("id, scan_id, severity, title").limit(20)
            vuln_result = await loop.run_in_executor(None, lambda: vuln_query.execute())
            
            if vuln_result and hasattr(vuln_result, 'data'):
                print(f"\n  Found {len(vuln_result.data)} vulnerabilities:")
                unique_scan_ids = set()
                for row in vuln_result.data:
                    unique_scan_ids.add(row.get('scan_id'))
                    print(f"    - {row.get('id')[:8]}: scan={row.get('scan_id')[:8]}, sev={row.get('severity')}, title={row.get('title', 'N/A')[:40]}")
                print(f"\n  Unique scan_ids in vulnerabilities: {unique_scan_ids}")
            else:
                print(f"\n  No vulnerability data. Result: {vuln_result}")
            
            # Query all scan_ids to see the mapping
            print("\n  All scan_ids in scan_queue:")
            all_scans = supabase.table("scan_queue").select("id, repo_url").limit(20)
            all_result = await loop.run_in_executor(None, lambda: all_scans.execute())
            if all_result and hasattr(all_result, 'data'):
                for row in all_result.data:
                    print(f"    - {row.get('id')}: {row.get('repo_url')}")
                
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            print(traceback.format_exc())
    else:
        print("  Supabase client not available!")
    
    # Test 2: Direct query with scan_ids
    print("\n[TEST 2] Direct vulnerabilities query with scan_ids...")
    juice_shop_scan_ids = [
        '2b1d51fb-173f-4811-9860-8f5b28b5d1e9',
        'f320fd2b-9dbc-47ff-a2c2-7daff5cf9b9f'
    ]
    
    try:
        # Test .in_() method
        query = (
            supabase.table("vulnerabilities")
            .select("*")
            .in_("scan_id", juice_shop_scan_ids)
            .limit(10)
        )
        result = await loop.run_in_executor(None, lambda: query.execute())
        if result and hasattr(result, 'data'):
            print(f"  .in_() query returned {len(result.data)} vulnerabilities")
        else:
            print(f"  .in_() query returned no data: {result}")
    except Exception as e:
        print(f"  .in_() query error: {e}")
    
    # Test 3: Bridge query for Juice Shop
    print("\n[TEST 3] Bridge query for Juice Shop...")
    findings = await bridge.get_findings_for_target("http://localhost:8080")
    print(f"  Found {len(findings)} findings")
    
    if findings:
        print("\n  First 3 findings:")
        for f in findings[:3]:
            print(f"    - {f.severity}: {f.vuln_type} in {f.file_path}")

if __name__ == "__main__":
    asyncio.run(test())
