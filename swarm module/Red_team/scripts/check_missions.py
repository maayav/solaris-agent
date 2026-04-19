"""
Check and manage pending missions in Redis.

Usage:
    python scripts/check_missions.py              # Show all pending missions
    python scripts/check_missions.py --claim      # Claim and process pending missions
    python scripts/check_missions.py --clear      # Clear all pending missions
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.redis_bus import redis_bus
from core.config import settings
from core.platform_compat import COLORS, SYMBOLS

# Redis stream and group names
MISSION_STREAM = "red_team_events"
MISSION_GROUP = "red_team"  # Actual group name from Redis
A2A_STREAM = "a2a_messages"
SWARM_STREAM = "swarm_missions"  # Main swarm mission stream


async def list_streams():
    """List all Redis streams."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== REDIS STREAMS ==={COLORS['reset']}")
    
    # Get all keys that are streams
    try:
        # Use SCAN to find stream keys
        streams = []
        async for key in client.scan_iter(match="*"):
            key_type = await client.type(key)
            if key_type == "stream":
                streams.append(key)
        
        if not streams:
            print("  No streams found")
            return
        
        for stream in streams:
            info = await client.xinfo_stream(stream)
            length = info.get("length", 0)
            print(f"  {stream}: {length} messages")
            
            # Show consumer groups
            try:
                groups = await client.xinfo_groups(stream)
                for group in groups:
                    print(f"    Group: {group['name']}")
                    print(f"      Consumers: {group['consumers']}")
                    print(f"      Pending: {group['pending']}")
                    print(f"      Last delivered: {group['last-delivered-id']}")
            except Exception as e:
                print(f"    No consumer groups: {e}")
                
    except Exception as e:
        print(f"  Error listing streams: {e}")
    
    await redis_bus.disconnect()


async def check_swarm_missions():
    """Check the swarm_missions stream (main mission queue)."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== SWARM MISSIONS STREAM ==={COLORS['reset']}")
    
    try:
        # Get stream info
        info = await client.xinfo_stream(SWARM_STREAM)
        length = info.get("length", 0)
        print(f"  Total missions: {length}")
        
        # Show recent missions
        messages = await client.xrevrange(SWARM_STREAM, count=5)
        
        if not messages:
            print(f"  {SYMBOLS['check']} No missions in stream")
        else:
            print(f"\n  Recent missions:")
            for msg_id, data in messages:
                print(f"\n    ID: {msg_id}")
                for key, value in data.items():
                    print(f"      {key}: {value}")
        
        # Check for consumer groups
        try:
            groups = await client.xinfo_groups(SWARM_STREAM)
            if groups:
                print(f"\n  Consumer groups:")
                for group in groups:
                    print(f"    {group['name']}: {group['consumers']} consumers, {group['pending']} pending")
            else:
                print(f"\n  {SYMBOLS['warn']} No consumer groups - missions won't be processed!")
        except Exception:
            print(f"\n  {SYMBOLS['warn']} No consumer groups defined")
        
    except Exception as e:
        print(f"  {SYMBOLS['cross']} Error: {e}")
    finally:
        await redis_bus.disconnect()


async def check_pending_missions():
    """Check pending missions in the mission stream."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== PENDING MISSIONS ==={COLORS['reset']}")
    
    try:
        # Check pending messages
        pending = await client.xpending(MISSION_STREAM, MISSION_GROUP)
        
        if pending.get("pending", 0) == 0:
            print(f"  {SYMBOLS['check']} No pending missions")
            await redis_bus.disconnect()
            return []
        
        print(f"  {SYMBOLS['warn']} {pending['pending']} pending mission(s)")
        print(f"  Lowest ID: {pending.get('min', 'N/A')}")
        print(f"  Highest ID: {pending.get('max', 'N/A')}")
        
        # Get pending entries with details
        pending_entries = await client.xpending_range(
            MISSION_STREAM,
            MISSION_GROUP,
            "-",
            "+",
            count=10
        )
        
        missions = []
        for entry in pending_entries:
            msg_id = entry["message_id"]
            consumer = entry.get("consumer", "unknown")
            idle_time = entry.get("time_since_delivered", 0)
            delivery_count = entry.get("delivery_count", 0)
            
            print(f"\n  Mission ID: {msg_id}")
            print(f"    Consumer: {consumer}")
            print(f"    Idle time: {idle_time}ms")
            print(f"    Delivery count: {delivery_count}")
            
            # Get message content
            messages = await client.xrange(MISSION_STREAM, msg_id, msg_id)
            for msg_id_actual, data in messages:
                print(f"    Data: {data}")
                missions.append({"id": msg_id, "data": data})
        
        return missions
        
    except Exception as e:
        print(f"  {SYMBOLS['cross']} Error checking pending: {e}")
        return []
    finally:
        await redis_bus.disconnect()


async def claim_pending_missions():
    """Claim and acknowledge pending missions."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== CLAIMING PENDING MISSIONS ==={COLORS['reset']}")
    
    try:
        pending = await client.xpending(MISSION_STREAM, MISSION_GROUP)
        
        if pending.get("pending", 0) == 0:
            print(f"  {SYMBOLS['check']} No pending missions to claim")
            await redis_bus.disconnect()
            return
        
        pending_entries = await client.xpending_range(
            MISSION_STREAM,
            MISSION_GROUP,
            "-",
            "+",
            count=10
        )
        
        for entry in pending_entries:
            msg_id = entry["message_id"]
            print(f"\n  Claiming mission {msg_id}...")
            
            # Claim the message
            claimed = await client.xclaim(
                MISSION_STREAM,
                MISSION_GROUP,
                "mission-recovery-worker",
                min_idle_time=0,
                message_ids=[msg_id]
            )
            
            if claimed:
                print(f"  {SYMBOLS['check']} Claimed successfully")
                # Acknowledge to remove from pending
                await client.xack(MISSION_STREAM, MISSION_GROUP, msg_id)
                print(f"  {SYMBOLS['check']} Acknowledged and removed")
            else:
                print(f"  {SYMBOLS['warn']} Could not claim")
        
        print(f"\n{SYMBOLS['check']} All pending missions processed")
        
    except Exception as e:
        print(f"  {SYMBOLS['cross']} Error claiming: {e}")
    finally:
        await redis_bus.disconnect()


async def clear_all_pending():
    """Clear all pending missions (use with caution)."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== CLEARING ALL PENDING MISSIONS ==={COLORS['reset']}")
    print(f"  {SYMBOLS['warn']} This will acknowledge all pending messages!")
    
    try:
        pending = await client.xpending(MISSION_STREAM, MISSION_GROUP)
        count = pending.get("pending", 0)
        
        if count == 0:
            print(f"  {SYMBOLS['check']} No pending missions to clear")
            await redis_bus.disconnect()
            return
        
        print(f"  Found {count} pending mission(s)")
        
        # Get all pending entries
        pending_entries = await client.xpending_range(
            MISSION_STREAM,
            MISSION_GROUP,
            "-",
            "+",
            count=100
        )
        
        for entry in pending_entries:
            msg_id = entry["message_id"]
            await client.xack(MISSION_STREAM, MISSION_GROUP, msg_id)
            print(f"  {SYMBOLS['check']} Cleared: {msg_id}")
        
        print(f"\n{SYMBOLS['check']} Cleared {len(pending_entries)} missions")
        
    except Exception as e:
        print(f"  {SYMBOLS['cross']} Error clearing: {e}")
    finally:
        await redis_bus.disconnect()


async def show_stream_content(count: int = 10):
    """Show recent messages in the mission stream."""
    await redis_bus.connect()
    client = redis_bus.client
    
    print(f"\n{COLORS['system']}=== RECENT MISSIONS (last {count}) ==={COLORS['reset']}")
    
    try:
        messages = await client.xrevrange(MISSION_STREAM, count=count)
        
        if not messages:
            print("  No messages in stream")
            await redis_bus.disconnect()
            return
        
        for msg_id, data in messages:
            print(f"\n  ID: {msg_id}")
            for key, value in data.items():
                print(f"    {key}: {value}")
                
    except Exception as e:
        print(f"  Error reading stream: {e}")
    finally:
        await redis_bus.disconnect()


def main():
    parser = argparse.ArgumentParser(
        description="Check and manage pending missions in Redis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/check_missions.py           # Show pending missions
  python scripts/check_missions.py --streams # List all streams
  python scripts/check_missions.py --recent  # Show recent missions
  python scripts/check_missions.py --claim   # Claim pending missions
  python scripts/check_missions.py --clear   # Clear all pending (danger!)
        """
    )
    parser.add_argument(
        "--streams",
        action="store_true",
        help="List all Redis streams"
    )
    parser.add_argument(
        "--recent",
        action="store_true",
        help="Show recent mission messages"
    )
    parser.add_argument(
        "--claim",
        action="store_true",
        help="Claim and acknowledge pending missions"
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear ALL pending missions (use with caution!)"
    )
    parser.add_argument(
        "--count",
        type=int,
        default=10,
        help="Number of recent messages to show (default: 10)"
    )
    
    args = parser.parse_args()
    
    print(f"{COLORS['system']}")
    print("=" * 60)
    print("  RED TEAM MISSION MANAGER")
    print("=" * 60)
    print(f"{COLORS['reset']}")
    print(f"Redis URL: {settings.redis_url}")
    
    if args.streams:
        asyncio.run(list_streams())
    elif args.recent:
        asyncio.run(show_stream_content(args.count))
    elif args.claim:
        asyncio.run(claim_pending_missions())
    elif args.clear:
        confirm = input(f"\n{SYMBOLS['warn']} Are you sure? This will clear all pending missions! (yes/no): ")
        if confirm.lower() == "yes":
            asyncio.run(clear_all_pending())
        else:
            print("Cancelled")
    else:
        # Default: check swarm missions, pending, and list streams
        asyncio.run(check_swarm_missions())
        asyncio.run(check_pending_missions())
        asyncio.run(list_streams())
    
    print()


if __name__ == "__main__":
    main()
