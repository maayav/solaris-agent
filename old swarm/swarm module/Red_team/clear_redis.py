"""
Clear all Redis streams and pending missions
"""
import asyncio
import redis.asyncio as redis

async def clear_all():
    r = redis.Redis(host='localhost', port=6380, decode_responses=True)
    
    print("=== CLEARING REDIS STREAMS ===")
    
    # Delete the swarm_missions stream entirely
    result = await r.delete('swarm_missions')
    print(f"✓ Deleted swarm_missions stream (was {result} bytes)")
    
    # Also delete consumer group
    try:
        await r.xgroup_destroy('swarm_missions', 'swarm_workers')
        print("✓ Deleted swarm_workers consumer group")
    except:
        pass
    
    # Clear any mission state keys
    keys = await r.keys('*mission*')
    if keys:
        await r.delete(*keys)
        print(f"✓ Deleted {len(keys)} mission-related keys")
    
    # Clear pending findings
    keys = await r.keys('*pending*')
    if keys:
        await r.delete(*keys)
        print(f"✓ Deleted {len(keys)} pending keys")
    
    await r.close()
    print("\n=== REDIS CLEARED SUCCESSFULLY ===")
    print("You can now restart the swarm worker fresh")

if __name__ == "__main__":
    asyncio.run(clear_all())
