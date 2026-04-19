"""Script to claim pending messages from Redis stream."""
import asyncio
import redis.asyncio as aioredis
from core.config import get_settings

async def main():
    settings = get_settings()
    print(f"Connecting to Redis at {settings.redis_url}")
    
    client = aioredis.from_url(settings.redis_url, decode_responses=True)
    
    # Check pending messages
    print("\n=== CHECKING PENDING MESSAGES ===")
    pending = await client.xpending("scan_queue", "scan_workers")
    print(f"Pending: {pending}")
    
    if pending['pending'] > 0:
        print(f"\nFound {pending['pending']} pending message(s)")
        
        # Get pending entries with details
        pending_entries = await client.xpending_range(
            "scan_queue", 
            "scan_workers", 
            "-", 
            "+", 
            count=10
        )
        print(f"Pending entries: {pending_entries}")
        
        # Claim all pending messages
        print("\n=== CLAIMING PENDING MESSAGES ===")
        for entry in pending_entries:
            msg_id = entry['message_id']
            old_consumer = entry['consumer']
            print(f"Claiming message {msg_id} from {old_consumer}")
            
            # XCLAIM to take ownership
            claimed = await client.xclaim(
                "scan_queue",
                "scan_workers",
                "new-worker",
                min_idle_time=0,
                message_ids=[msg_id]
            )
            print(f"Claimed: {claimed}")
            
            # Now ack the message so it's removed
            await client.xack("scan_queue", "scan_workers", msg_id)
            print(f"Acknowledged message {msg_id}")
        
        print("\n=== DONE - Messages cleared ===")
    else:
        print("No pending messages found.")
    
    # Verify
    print("\n=== VERIFICATION ===")
    pending_after = await client.xpending("scan_queue", "scan_workers")
    print(f"Pending after cleanup: {pending_after}")
    
    await client.aclose()

if __name__ == "__main__":
    asyncio.run(main())
