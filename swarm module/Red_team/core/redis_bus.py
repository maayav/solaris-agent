"""
Redis Streams message bus for agent-to-agent (A2A) communication.

Streams:
  - a2a_messages:  Inter-agent task assignments and intelligence reports
  - red_team_events:  Kill chain events for monitoring/logging

Blackboard:
  - HSET/HGET for shared mission state (redteam:blackboard:{mission_id}:*)
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis.asyncio as aioredis

from core.config import settings

logger = logging.getLogger(__name__)

# Stream names
A2A_STREAM = "a2a_messages"
RED_TEAM_EVENTS = "red_team_events"
DEFENSE_ANALYTICS = "defense_analytics"  # Blue Team -> Red Team bridge


class RedisBus:
    """Async Redis Streams wrapper for agent messaging."""

    def __init__(self, url: str | None = None):
        self._url = url or settings.redis_url
        self._client: aioredis.Redis | None = None

    async def connect(self) -> None:
        """Establish connection to Redis."""
        self._client = aioredis.from_url(
            self._url, decode_responses=True, encoding="utf-8"
        )
        # Verify connectivity
        await self._client.ping()
        logger.info("Redis connected at %s", self._url)

    async def disconnect(self) -> None:
        """Close Redis connection."""
        if self._client:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> aioredis.Redis:
        if self._client is None:
            raise RuntimeError("RedisBus not connected — call connect() first")
        return self._client

    # ── Stream Operations ──────────────────────────────────────────

    async def publish(self, stream: str, message: dict[str, Any]) -> str:
        """
        Publish a message to a Redis Stream.
        Returns the stream message ID.
        """
        # Flatten the message — Redis Streams require string field/values
        flat = {k: json.dumps(v) if not isinstance(v, str) else v for k, v in message.items()}
        msg_id = await self.client.xadd(stream, flat)
        logger.debug("Published to %s: %s", stream, msg_id)
        return msg_id

    async def create_consumer_group(
        self, stream: str, group: str, start_id: str = "0"
    ) -> None:
        """Create a consumer group for a stream. Idempotent."""
        try:
            await self.client.xgroup_create(stream, group, id=start_id, mkstream=True)
            logger.info("Created consumer group '%s' on stream '%s'", group, stream)
        except aioredis.ResponseError as e:
            if "BUSYGROUP" in str(e):
                pass  # Group already exists
            else:
                raise

    async def consume(
        self,
        stream: str,
        group: str,
        consumer: str,
        count: int = 10,
        block_ms: int = 5000,
    ) -> list[dict[str, Any]]:
        """
        Read new messages from a consumer group.
        Returns list of dicts with 'msg_id' + original fields.
        """
        results = await self.client.xreadgroup(
            groupname=group,
            consumername=consumer,
            streams={stream: ">"},
            count=count,
            block=block_ms,
        )

        messages = []
        for _stream_name, entries in (results or []):
            for msg_id, fields in entries:
                parsed = {}
                for k, v in fields.items():
                    try:
                        parsed[k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        parsed[k] = v
                parsed["_msg_id"] = msg_id
                messages.append(parsed)

        return messages

    async def ack(self, stream: str, group: str, *msg_ids: str) -> int:
        """Acknowledge processed messages."""
        return await self.client.xack(stream, group, *msg_ids)

    async def claim_pending(
        self,
        stream: str,
        group: str,
        consumer: str,
        min_idle_ms: int = 60000,
        count: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Claim pending messages that were delivered to other consumers.
        Useful for recovering messages from crashed consumers.
        
        Args:
            stream: Stream name
            group: Consumer group name
            consumer: Consumer name to claim messages for
            min_idle_ms: Minimum idle time before claiming (default 60s)
            count: Max messages to claim
            
        Returns:
            List of claimed messages with 'msg_id' + original fields
        """
        try:
            # Get pending messages info
            pending_info = await self.client.xpending(stream, group)
            if not pending_info or pending_info["pending"] == 0:
                return []
            
            # Get pending message IDs
            pending_entries = await self.client.xpending_range(
                stream, group, min="-", max="+", count=count
            )
            
            if not pending_entries:
                return []
            
            msg_ids = [entry["message_id"] for entry in pending_entries]
            
            # Claim the messages
            claimed = await self.client.xclaim(
                stream, group, consumer, min_idle_time=min_idle_ms, message_ids=msg_ids
            )
            
            messages = []
            for msg_id, fields in claimed:
                parsed = {}
                for k, v in fields.items():
                    try:
                        parsed[k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        parsed[k] = v
                parsed["_msg_id"] = msg_id
                messages.append(parsed)
            
            return messages
            
        except Exception as e:
            logger.error(f"Failed to claim pending messages: {e}")
            return []

    async def read_stream(
        self, stream: str, count: int = 100, start_id: str = "0"
    ) -> list[dict[str, Any]]:
        """Read messages from a stream (no consumer group — for debugging/monitoring)."""
        results = await self.client.xrange(stream, min=start_id, count=count)
        messages = []
        for msg_id, fields in results:
            parsed = {}
            for k, v in fields.items():
                try:
                    parsed[k] = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    parsed[k] = v
            parsed["_msg_id"] = msg_id
            messages.append(parsed)
        return messages

    # ── Blackboard Operations ──────────────────────────────────────

    async def blackboard_write(
        self, mission_id: str, key: str, value: Any
    ) -> None:
        """Write a key-value pair to the mission blackboard."""
        bb_key = f"redteam:blackboard:{mission_id}"
        await self.client.hset(bb_key, key, json.dumps(value))
        logger.debug("Blackboard write: %s.%s", mission_id, key)

    async def blackboard_read(self, mission_id: str, key: str) -> Any | None:
        """Read a single key from the mission blackboard."""
        bb_key = f"redteam:blackboard:{mission_id}"
        raw = await self.client.hget(bb_key, key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw

    async def blackboard_read_all(self, mission_id: str) -> dict[str, Any]:
        """Read the entire mission blackboard."""
        bb_key = f"redteam:blackboard:{mission_id}"
        raw = await self.client.hgetall(bb_key)
        parsed = {}
        for k, v in raw.items():
            try:
                parsed[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                parsed[k] = v
        return parsed

    async def blackboard_clear(self, mission_id: str) -> None:
        """Delete the entire mission blackboard."""
        bb_key = f"redteam:blackboard:{mission_id}"
        await self.client.delete(bb_key)

    # ── Defense Analytics (Blue Team Bridge) ───────────────────────

    async def consume_defense_analytics(
        self,
        group: str = "red_team",
        consumer: str = "commander",
        count: int = 10,
        block_ms: int = 5000,
    ) -> list[dict[str, Any]]:
        """
        Consume defensive analytics from the Blue Team.
        
        This allows the Red Team Commander to adapt its strategy based on
        what the Blue Team has detected and blocked.

        Args:
            group: Consumer group name
            consumer: Consumer name
            count: Max messages to read
            block_ms: Block timeout in milliseconds

        Returns:
            List of defense analytics messages
        """
        # Ensure consumer group exists
        await self.create_consumer_group(DEFENSE_ANALYTICS, group)
        
        # Consume messages
        results = await self.client.xreadgroup(
            groupname=group,
            consumername=consumer,
            streams={DEFENSE_ANALYTICS: ">"},
            count=count,
            block=block_ms,
        )

        messages = []
        for _stream_name, entries in (results or []):
            for msg_id, fields in entries:
                parsed = {}
                for k, v in fields.items():
                    try:
                        parsed[k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        parsed[k] = v
                parsed["_msg_id"] = msg_id
                messages.append(parsed)

        return messages

    async def get_latest_defense_intel(
        self,
        count: int = 50,
    ) -> list[dict[str, Any]]:
        """
        Get recent defense analytics (no consumer group - for polling).

        Args:
            count: Maximum number of messages to retrieve

        Returns:
            List of recent defense analytics
        """
        results = await self.client.xrevrange(
            DEFENSE_ANALYTICS,
            "+",
            "-",
            count=count,
        )

        messages = []
        for msg_id, fields in results:
            parsed = {}
            for k, v in fields.items():
                try:
                    parsed[k] = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    parsed[k] = v
            parsed["_msg_id"] = msg_id
            messages.append(parsed)

        return messages

    # ── Shared Findings Store (PentAGI v4.0 Memory System) ────────

    async def findings_store(
        self, mission_id: str, category: str, key: str, value: Any
    ) -> None:
        """
        Store a finding for cross-agent propagation.

        Categories: tokens, credentials, successful_payloads, endpoints, owasp_successes
        Example: findings_store("m1", "tokens", "admin_jwt", "eyJ...")
        """
        findings_key = f"redteam:findings:{mission_id}:{category}"
        await self.client.hset(findings_key, key, json.dumps(value) if not isinstance(value, str) else value)
        logger.info("📦 Findings store: %s/%s.%s", mission_id, category, key)

    async def findings_read(self, mission_id: str, category: str) -> dict[str, Any]:
        """Read all findings in a category."""
        findings_key = f"redteam:findings:{mission_id}:{category}"
        raw = await self.client.hgetall(findings_key)
        parsed = {}
        for k, v in raw.items():
            try:
                parsed[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                parsed[k] = v
        return parsed

    async def findings_read_all(self, mission_id: str) -> dict[str, dict[str, Any]]:
        """Read all findings across all categories."""
        result = {}
        for category in ("tokens", "credentials", "successful_payloads", "endpoints", "owasp_successes"):
            data = await self.findings_read(mission_id, category)
            if data:
                result[category] = data
        return result

    async def log_parse_failure(
        self, mission_id: str, agent: str, raw_text: str
    ) -> None:
        """Log a JSON parse failure for critic analysis."""
        failure_key = f"redteam:parse_failures:{mission_id}"
        entry = json.dumps({"agent": agent, "text": raw_text[:500]})
        await self.client.rpush(failure_key, entry)
        logger.debug("Parse failure logged for critic: %s", agent)

    async def get_payload_attempt_count(
        self, mission_id: str, payload_hash: str
    ) -> int:
        """Get how many times a payload has been attempted (max 2 retries)."""
        key = f"redteam:payload_attempts:{mission_id}"
        count = await self.client.hget(key, payload_hash)
        return int(count) if count else 0

    async def increment_payload_attempt(
        self, mission_id: str, payload_hash: str
    ) -> int:
        """Increment and return attempt count for a payload."""
        key = f"redteam:payload_attempts:{mission_id}"
        return await self.client.hincrby(key, payload_hash, 1)

    # ── Health Check ───────────────────────────────────────────────

    async def ping(self) -> bool:
        """Check Redis connectivity."""
        try:
            return await self.client.ping()
        except Exception:
            return False


# Default singleton
redis_bus = RedisBus()
