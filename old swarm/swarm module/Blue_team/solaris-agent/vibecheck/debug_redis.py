"""Debug script to check Redis stream state."""
import asyncio
import redis.asyncio as aioredis
from core.config import get_settings

async def main():
    settings = get_settings()
    print(f"Connecting to Redis at {settings.redis_url}")
    
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    
    # Check stream info
    print("\n=== STREAM INFO ===")
    try:
        info = await client.xinfo_stream("scan_queue")
        print(f"Stream length: {info['length']}")
        print(f"First entry: {info.get('first-entry')}")
        print(f"Last entry: {info.get('last-entry')}")
    except Exception as e:
        print(f"Error getting stream info: {e}")
    
    # Check consumer groups
    print("\n=== CONSUMER GROUPS ===")
    try:
        groups = await client.xinfo_groups("scan_queue")
        for group in groups:
            print(f"Group: {group['name']}")
            print(f"  Consumers: {group['consumers']}")
            print(f"  Pending: {group['pending']}")
            print(f"  Last-delivered-id: {group['last-delivered-id']}")
    except Exception as e:
        print(f"Error getting groups: {e}")
    
    # Read all messages in stream
    print("\n=== ALL MESSAGES IN STREAM ===")
    try:
        messages = await client.xrange("scan_queue", count=10)
        for msg_id, data in messages:
            print(f"ID: {msg_id}, Data: {data}")
    except Exception as e:
        print(f"Error reading messages: {e}")
    
    # Check pending messages for the group
    print("\n=== PENDING MESSAGES FOR GROUP ===")
    try:
        pending = await client.xpending("scan_queue", "scan_workers")
        print(f"Pending: {pending}")
    except Exception as e:
        print(f"Error getting pending: {e}")
    
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
