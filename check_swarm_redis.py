#!/usr/bin/env python3
import asyncio
import redis.asyncio as aioredis

async def check_swarm_redis():
    client = aioredis.from_url("redis://localhost:6380", decode_responses=True)
    
    try:
        # Check if swarm_missions stream exists
        streams = await client.keys("*")
        print("Available Redis keys:", streams)
        
        if "swarm_missions" in streams:
            # Get stream length
            length = await client.xlen("swarm_missions")
            print(f"\nSwarm missions stream length: {length}")
            
            if length > 0:
                # Get all messages
                messages = await client.xrange("swarm_missions")
                print("\n=== SWARM MISSIONS ===")
                for msg_id, data in messages[-5:]:  # Show last 5
                    print(f"ID: {msg_id}, Data: {data}")
            
            # Check consumer groups
            try:
                groups = await client.xinfo_groups("swarm_missions")
                print(f"\n=== CONSUMER GROUPS ===")
                for group in groups:
                    print(f"Group: {group['name']}, Consumers: {group['consumers']}, Pending: {group['pending']}")
            except Exception as e:
                print(f"No consumer groups: {e}")
        else:
            print("swarm_missions stream not found")
            
    finally:
        await client.aclose()

if __name__ == "__main__":
    asyncio.run(check_swarm_redis())