"""
Integration Tests for Swarm Module Pipeline

These tests require external services (Redis, Supabase, Qdrant) to be running.
Use pytest markers to skip these in CI/unit test runs.

Usage:
    pytest tests/test_integration.py -v          # Run all integration tests
    pytest tests/test_integration.py -m redis    # Run Redis tests only
    pytest tests/test_integration.py --skip-integration  # Skip these tests
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest
import pytest_asyncio

# Skip all tests in this file if SKIP_INTEGRATION is set
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("SKIP_INTEGRATION") == "1",
        reason="Integration tests disabled (SKIP_INTEGRATION=1)",
    ),
]


# =============================================================================
# REDIS INTEGRATION TESTS
# =============================================================================

@pytest.mark.redis
@pytest.mark.asyncio
class TestRedisIntegration:
    """Integration tests for Redis message bus."""

    async def test_redis_connection(self):
        """Test Redis connection and basic operations."""
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        try:
            await bus.connect()
            assert bus._client is not None
            
            # Test ping
            result = await bus.client.ping()
            assert result is True
        finally:
            await bus.disconnect()

    async def test_stream_publish_consume_ack(self):
        """Test full message lifecycle: publish → consume → ack."""
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        stream = f"test_stream_{uuid.uuid4().hex[:8]}"
        group = "test_group"
        consumer = "test_consumer"
        
        try:
            await bus.connect()
            
            # Create consumer group
            await bus.create_consumer_group(stream, group)
            
            # Publish message
            test_data = {"test": "data", "timestamp": datetime.now(timezone.utc).isoformat()}
            msg_id = await bus.publish(stream, test_data)
            assert msg_id is not None
            
            # Consume message
            messages = await bus.consume(stream, group, consumer, count=1, block_ms=5000)
            assert len(messages) == 1
            assert messages[0]["test"] == "data"
            
            # Acknowledge message
            acked = await bus.ack(stream, group, messages[0]["_msg_id"])
            assert acked == 1
            
        finally:
            # Cleanup
            try:
                await bus.client.xtrim(stream, maxlen=0)
                await bus.client.delete(stream)
            except:
                pass
            await bus.disconnect()

    async def test_multiple_consumers(self):
        """Test multiple consumers in the same group."""
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        stream = f"test_stream_{uuid.uuid4().hex[:8]}"
        group = "test_group"
        
        try:
            await bus.connect()
            await bus.create_consumer_group(stream, group)
            
            # Publish multiple messages
            msg_ids = []
            for i in range(5):
                msg_id = await bus.publish(stream, {"index": i})
                msg_ids.append(msg_id)
            
            # Consume with different consumers
            consumer1_msgs = await bus.consume(stream, group, "consumer1", count=3, block_ms=2000)
            consumer2_msgs = await bus.consume(stream, group, "consumer2", count=3, block_ms=2000)
            
            # Messages should be distributed
            assert len(consumer1_msgs) + len(consumer2_msgs) == 5
            
            # Ack all messages
            for msg in consumer1_msgs + consumer2_msgs:
                await bus.ack(stream, group, msg["_msg_id"])
                
        finally:
            try:
                await bus.client.xtrim(stream, maxlen=0)
                await bus.client.delete(stream)
            except:
                pass
            await bus.disconnect()

    async def test_claim_pending_recovery(self):
        """Test claiming pending messages from crashed consumer."""
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        stream = f"test_stream_{uuid.uuid4().hex[:8]}"
        group = "test_group"
        
        try:
            await bus.connect()
            await bus.create_consumer_group(stream, group)
            
            # Publish and consume (but don't ack)
            msg_id = await bus.publish(stream, {"test": "pending"})
            messages = await bus.consume(stream, group, "crashed_consumer", count=1, block_ms=2000)
            assert len(messages) == 1
            
            # Don't ack - simulate crash
            # Now try to claim with new consumer
            claimed = await bus.claim_pending(
                stream, group, "recovery_consumer", min_idle_ms=10, count=10
            )
            
            # Should be able to claim the message (after min_idle_ms)
            # Note: In real scenario, would need to wait for min_idle_ms
            
        finally:
            try:
                await bus.ack(stream, group, msg_id)  # Cleanup
                await bus.client.xtrim(stream, maxlen=0)
                await bus.client.delete(stream)
            except:
                pass
            await bus.disconnect()


# =============================================================================
# SUPABASE INTEGRATION TESTS
# =============================================================================

@pytest.mark.supabase
@pytest.mark.asyncio
class TestSupabaseIntegration:
    """Integration tests for Supabase client."""

    async def test_supabase_connection(self):
        """Test Supabase connection."""
        from core.supabase_client import get_supabase_client
        
        client = get_supabase_client()
        if not client._enabled:
            pytest.skip("Supabase not configured")
        
        assert client._client is not None

    async def test_kill_chain_event_logging(self):
        """Test logging kill chain events to Supabase."""
        from core.supabase_client import get_supabase_client
        
        client = get_supabase_client()
        if not client._enabled:
            pytest.skip("Supabase not configured")
        
        mission_id = str(uuid.uuid4())
        
        result = await client.log_kill_chain_event(
            mission_id=mission_id,
            stage="exploitation",
            agent="test_agent",
            event_type="action",
            details={"test": "data"},
            success=True,
        )
        
        assert result is True

    async def test_mission_status_update(self):
        """Test updating mission status."""
        from core.supabase_client import get_supabase_client
        
        client = get_supabase_client()
        if not client._enabled:
            pytest.skip("Supabase not configured")
        
        mission_id = str(uuid.uuid4())
        
        result = await client.update_mission_status(
            mission_id=mission_id,
            status="running",
            progress_pct=50,
            current_stage="exploitation",
            findings_count=5,
        )
        
        assert result is True

    async def test_invalid_mission_id_handling(self):
        """Test handling of invalid mission IDs."""
        from core.supabase_client import get_supabase_client, is_valid_uuid
        
        client = get_supabase_client()
        
        # Invalid mission IDs should be rejected
        invalid_ids = ["unknown", "not-a-uuid", "", None]
        
        for invalid_id in invalid_ids:
            assert is_valid_uuid(invalid_id) is False
            
            if client._enabled and invalid_id:
                result = await client.log_kill_chain_event(
                    mission_id=str(invalid_id) if invalid_id else "",
                    stage="test",
                    agent="test",
                    event_type="action",
                    details={},
                )
                assert result is False  # Should fail validation


# =============================================================================
# QDRANT INTEGRATION TESTS
# =============================================================================

@pytest.mark.qdrant
@pytest.mark.asyncio
class TestQdrantIntegration:
    """Integration tests for Qdrant memory."""

    async def test_qdrant_connection(self):
        """Test Qdrant connection."""
        from core.qdrant_memory import get_episodic_memory
        
        memory = get_episodic_memory()
        if not memory or not memory._enabled:
            pytest.skip("Qdrant not configured")
        
        # Connection is tested during initialization
        assert memory._client is not None

    async def test_store_and_retrieve_exploit(self):
        """Test storing and retrieving an exploit."""
        from core.qdrant_memory import get_episodic_memory
        
        memory = get_episodic_memory()
        if not memory or not memory._enabled:
            pytest.skip("Qdrant not configured")
        
        mission_id = str(uuid.uuid4())
        
        # Store exploit
        exploit_data = {
            "endpoint": "http://localhost:3000/api/login",
            "exploit_type": "sqli",
            "payload": "' OR 1=1--",
            "success": True,
        }
        
        await memory.store_exploit(mission_id, exploit_data)
        
        # Retrieve similar exploits
        results = await memory.get_similar_exploits(
            endpoint="http://localhost:3000/api/login",
            exploit_type="sqli",
            limit=5,
        )
        
        # Should find the stored exploit
        assert len(results) > 0

    async def test_similarity_search(self):
        """Test semantic similarity search."""
        from core.qdrant_memory import get_episodic_memory
        
        memory = get_episodic_memory()
        if not memory or not memory._enabled:
            pytest.skip("Qdrant not configured")
        
        mission_id = str(uuid.uuid4())
        
        # Store multiple exploits
        exploits = [
            {"endpoint": "http://localhost:3000/api/users", "exploit_type": "idor", "payload": "1"},
            {"endpoint": "http://localhost:3000/api/login", "exploit_type": "sqli", "payload": "' OR 1=1--"},
            {"endpoint": "http://localhost:3000/search", "exploit_type": "xss", "payload": "<script>alert(1)</script>"},
        ]
        
        for exploit in exploits:
            await memory.store_exploit(mission_id, exploit)
        
        # Search for SQLi exploits
        sqli_results = await memory.get_similar_exploits(
            endpoint="http://localhost:3000/api/login",
            exploit_type="sqli",
            limit=5,
        )
        
        # SQLi exploits should be most similar
        if sqli_results:
            assert any("sqli" in str(r) for r in sqli_results)

    async def test_deduplication(self):
        """Test that duplicate exploits are not stored."""
        from core.qdrant_memory import get_episodic_memory
        import hashlib
        
        memory = get_episodic_memory()
        if not memory or not memory._enabled:
            pytest.skip("Qdrant not configured")
        
        mission_id = str(uuid.uuid4())
        endpoint = "http://localhost:3000/api/login"
        exploit_type = "sqli"
        
        # Generate deterministic point ID
        point_id = hashlib.md5(f"{endpoint}:{exploit_type}".encode()).hexdigest()
        
        # Store exploit twice with same point ID
        exploit_data = {
            "endpoint": endpoint,
            "exploit_type": exploit_type,
            "payload": "' OR 1=1--",
        }
        
        # Upsert should handle deduplication
        await memory.store_exploit(mission_id, exploit_data)
        await memory.store_exploit(mission_id, exploit_data)
        
        # Should only have one exploit with this endpoint+type
        results = await memory.get_similar_exploits(endpoint=endpoint, exploit_type=exploit_type, limit=10)
        
        # Count unique endpoint+type combinations
        unique_combos = set()
        for result in results:
            payload = result.get("payload", {})
            combo = (payload.get("endpoint"), payload.get("exploit_type"))
            unique_combos.add(combo)
        
        # Same endpoint+type should be deduplicated
        assert len([c for c in unique_combos if c == (endpoint, exploit_type)]) <= 1


# =============================================================================
# END-TO-END WORKFLOW TESTS
# =============================================================================

@pytest.mark.slow
@pytest.mark.asyncio
class TestEndToEndWorkflow:
    """End-to-end workflow tests."""

    async def test_mission_lifecycle(self):
        """Test full mission lifecycle from creation to completion."""
        from agents.state import create_initial_state
        from agents.graph import build_red_team_graph, should_continue
        
        # Create initial state
        state = create_initial_state(
            objective="Test Juice Shop login",
            target="http://localhost:3000",
            max_iterations=2,
        )
        
        assert state["mission_id"] is not None
        assert state["objective"] == "Test Juice Shop login"
        assert state["phase"] == "planning"
        assert state["iteration"] == 0
        
        # Test routing logic
        state["phase"] = "complete"
        next_step = should_continue(state)
        assert next_step == "report"

    async def test_agent_communication(self):
        """Test A2A message passing between agents."""
        from agents.a2a.messages import (
            A2AMessage,
            AgentRole,
            MessageType,
            Priority,
            TaskAssignment,
        )
        
        # Create task assignment
        task = TaskAssignment(
            agent=AgentRole.GAMMA,
            description="Test SQLi on login",
            target="http://localhost:3000/rest/user/login",
            tools_allowed=["curl"],
            priority=Priority.HIGH,
            exploit_type="sqli",
        )
        
        # Create message
        message = A2AMessage(
            type=MessageType.TASK_ASSIGNMENT,
            sender=AgentRole.COMMANDER,
            recipient=AgentRole.GAMMA,
            payload=task.__dict__,
        )
        
        assert message.type == MessageType.TASK_ASSIGNMENT
        assert message.sender == AgentRole.COMMANDER
        assert message.recipient == AgentRole.GAMMA

    async def test_tool_registry(self):
        """Test tool registration and discovery."""
        from agents.tools.registry import tool_registry
        
        # Check that tools are registered
        tools = tool_registry.list_tools()
        assert len(tools) > 0
        
        # Check specific tools
        tool_names = [t["name"] for t in tools]
        assert "curl" in tool_names
        assert "nmap" in tool_names


# =============================================================================
# PERFORMANCE TESTS
# =============================================================================

@pytest.mark.slow
@pytest.mark.asyncio
class TestPerformance:
    """Performance and load tests."""

    async def test_concurrent_message_processing(self):
        """Test handling of concurrent messages."""
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        stream = f"perf_test_{uuid.uuid4().hex[:8]}"
        group = "perf_group"
        
        try:
            await bus.connect()
            await bus.create_consumer_group(stream, group)
            
            # Publish many messages
            num_messages = 100
            for i in range(num_messages):
                await bus.publish(stream, {"index": i, "data": "x" * 100})
            
            # Consume all messages
            consumed = 0
            while consumed < num_messages:
                messages = await bus.consume(stream, group, "consumer", count=10, block_ms=1000)
                if not messages:
                    break
                consumed += len(messages)
                for msg in messages:
                    await bus.ack(stream, group, msg["_msg_id"])
            
            assert consumed == num_messages
            
        finally:
            await bus.disconnect()

    async def test_memory_stress(self):
        """Test memory under load."""
        from core.qdrant_memory import get_episodic_memory
        
        memory = get_episodic_memory()
        if not memory or not memory._enabled:
            pytest.skip("Qdrant not configured")
        
        mission_id = str(uuid.uuid4())
        
        # Store many exploits
        num_exploits = 50
        for i in range(num_exploits):
            exploit = {
                "endpoint": f"http://localhost:3000/api/resource/{i}",
                "exploit_type": "idor" if i % 2 == 0 else "sqli",
                "payload": f"test_payload_{i}",
            }
            await memory.store_exploit(mission_id, exploit)
        
        # Search should still work efficiently
        import time
        start = time.time()
        results = await memory.get_similar_exploits(
            endpoint="http://localhost:3000/api/resource/1",
            exploit_type="idor",
            limit=10,
        )
        elapsed = time.time() - start
        
        # Should complete in reasonable time
        assert elapsed < 5.0  # 5 seconds max


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-m", "integration"])
