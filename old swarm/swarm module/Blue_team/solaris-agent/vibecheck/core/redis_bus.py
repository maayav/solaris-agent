"""
Redis Streams client for Project VibeCheck.

Redis Streams is used as the message bus for:
- Scan job queue (scan_queue)
- Agent-to-Agent communication (a2a_messages)
- Red team event streaming (red_team_events)

This provides reliable, ordered, persistent messaging with consumer groups.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import redis.asyncio as aioredis

from core.config import get_settings

logger = logging.getLogger(__name__)

# Log module loading
logger.debug("=== REDIS BUS MODULE LOADING ===")

# Stream names
STREAM_SCAN_QUEUE = "scan_queue"
STREAM_A2A_MESSAGES = "a2a_messages"
STREAM_RED_TEAM_EVENTS = "red_team_events"
STREAM_DEFENSE_ANALYTICS = "defense_analytics"  # Blue Team -> Red Team bridge

# Consumer group names
GROUP_SCAN_WORKERS = "scan_workers"
GROUP_RED_TEAM = "red_team"


class RedisBus:
    """
    Async Redis client for stream-based messaging.

    Provides:
    - Producer: Write messages to streams
    - Consumer: Read messages with consumer groups
    - Blackboard: Shared state for agent coordination
    """

    def __init__(self, url: str | None = None) -> None:
        """
        Initialize Redis bus client.

        Args:
            url: Redis connection URL (e.g., redis://localhost:6380)
        """
        settings = get_settings()
        self._url = url or settings.redis_url
        self._client: aioredis.Redis | None = None

    async def connect(self) -> None:
        """Establish async connection to Redis."""
        logger.debug(f"connect() called, current client state: {self._client is not None}")
        if self._client is None:
            logger.info(f"Connecting to Redis at {self._url}")
            logger.debug("Creating Redis client...")
            self._client = aioredis.from_url(
                self._url,
                decode_responses=True,
                encoding="utf-8",
            )
            logger.debug("Redis client created, testing connection with PING...")
            # Test connection
            try:
                result = await self._client.ping()
                logger.debug(f"PING result: {result}")
            except Exception as e:
                logger.error(f"PING failed: {e}", exc_info=True)
                raise
            logger.info("Redis connection established")

            # Ensure consumer groups exist
            logger.debug("Ensuring consumer groups exist...")
            await self._ensure_consumer_groups()
            logger.debug("Consumer groups ensured")
        else:
            logger.debug("Redis client already exists, reusing connection")

    async def disconnect(self) -> None:
        """Close connection to Redis."""
        if self._client:
            await self._client.close()
            self._client = None
            logger.info("Redis connection closed")

    @property
    def client(self) -> aioredis.Redis:
        """Get the Redis client, connecting if necessary."""
        if self._client is None:
            raise RuntimeError("Redis not connected. Call connect() first.")
        return self._client

    async def _ensure_consumer_groups(self) -> None:
        """Create consumer groups if they don't exist."""
        groups = [
            (STREAM_SCAN_QUEUE, GROUP_SCAN_WORKERS),
            (STREAM_RED_TEAM_EVENTS, GROUP_RED_TEAM),
        ]

        logger.debug(f"Ensuring {len(groups)} consumer groups...")
        for stream_name, group_name in groups:
            logger.debug(f"Checking group {group_name} for stream {stream_name}")
            try:
                # Create stream with initial message if it doesn't exist
                # Then create consumer group
                # Use "$" to start from NEW messages only (not historical)
                await self.client.xgroup_create(
                    name=stream_name,
                    groupname=group_name,
                    id="$",  # Start from new messages only
                    mkstream=True,
                )
                logger.info(f"Created consumer group: {group_name} for stream: {stream_name}")
            except aioredis.ResponseError as e:
                if "BUSYGROUP" in str(e):
                    logger.debug(f"Consumer group already exists: {group_name}")
                else:
                    logger.error(f"Error creating consumer group: {e}")
                    raise

    # ==========================================
    # Producer Methods
    # ==========================================

    async def publish(
        self,
        stream_name: str,
        data: dict[str, Any],
    ) -> str:
        """
        Publish a message to a stream.

        Args:
            stream_name: Name of the stream
            data: Message data as dictionary

        Returns:
            Message ID
        """
        # Convert values to strings for Redis
        message = {
            k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
            for k, v in data.items()
        }

        msg_id = await self.client.xadd(stream_name, message)
        logger.debug(f"Published to {stream_name}: {msg_id}")
        return msg_id

    async def publish_scan_job(
        self,
        repo_url: str,
        project_id: str | None = None,
        triggered_by: str = "manual",
        scan_id: str | None = None,
    ) -> str:
        """
        Publish a scan job to the queue.

        Args:
            repo_url: Repository URL to scan
            project_id: Optional project ID
            triggered_by: Who triggered the scan
            scan_id: Optional pre-generated scan ID

        Returns:
            Message ID
        """
        data = {
            "repo_url": repo_url,
            "project_id": project_id or "",
            "triggered_by": triggered_by,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if scan_id:
            data["scan_id"] = scan_id
        return await self.publish(STREAM_SCAN_QUEUE, data)

    async def publish_a2a_message(
        self,
        mission_id: str,
        sender: str,
        recipient: str,
        msg_type: str,
        payload: dict[str, Any],
        priority: str = "NORMAL",
    ) -> str:
        """
        Publish an agent-to-agent message.

        Args:
            mission_id: Mission/scan ID
            sender: Agent name sending the message
            recipient: Agent name receiving the message
            msg_type: Message type (e.g., INTELLIGENCE_REPORT)
            payload: Message payload
            priority: Message priority (LOW, NORMAL, HIGH)

        Returns:
            Message ID
        """
        data = {
            "mission_id": mission_id,
            "sender": sender,
            "recipient": recipient,
            "type": msg_type,
            "priority": priority,
            "payload": json.dumps(payload),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        stream_name = f"{STREAM_A2A_MESSAGES}:{mission_id}"
        return await self.publish(stream_name, data)

    async def publish_defense_analytics(
        self,
        scan_id: str,
        vulnerability_type: str,
        severity: str,
        description: str,
        blocked_payload: str | None = None,
        detected_signature: str | None = None,
    ) -> str:
        """
        Publish defensive analytics to inform the Red Team.
        
        This enables the Red Team to adapt its attack strategy based on
        what the Blue Team has detected and blocked.

        Args:
            scan_id: The scan/mission ID
            vulnerability_type: Type of vulnerability detected (e.g., sql_injection, xss)
            severity: Severity level (critical, high, medium, low)
            description: Description of the detected threat
            blocked_payload: The specific payload that was blocked (if available)
            detected_signature: The signature/pattern that was detected

        Returns:
            Message ID
        """
        data = {
            "scan_id": scan_id,
            "vulnerability_type": vulnerability_type,
            "severity": severity,
            "description": description,
            "blocked_payload": blocked_payload or "",
            "detected_signature": detected_signature or "",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "blue_team",
        }
        return await self.publish(STREAM_DEFENSE_ANALYTICS, data)

    # ==========================================
    # Consumer Methods
    # ==========================================

    async def consume(
        self,
        stream_name: str,
        group_name: str,
        consumer_name: str,
        block: int = 5000,
        count: int = 1,
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Consume messages from a stream using a consumer group.

        Args:
            stream_name: Name of the stream
            group_name: Consumer group name
            consumer_name: Unique consumer name
            block: Block timeout in milliseconds
            count: Max messages to read

        Yields:
            Message dictionaries with id and data
        """
        logger.debug(f"consume() started for stream={stream_name}, group={group_name}, consumer={consumer_name}")
        iteration = 0
        while True:
            iteration += 1
            logger.debug(f"consume loop iteration {iteration}")
            try:
                # Read new messages (not yet delivered to this consumer)
                logger.debug(f"Calling xreadgroup with block={block}ms...")
                messages = await self.client.xreadgroup(
                    groupname=group_name,
                    consumername=consumer_name,
                    streams={stream_name: ">"},  # ">" means new messages only
                    block=block,
                    count=count,
                )
                logger.debug(f"xreadgroup returned: {len(messages) if messages else 0} streams")

                if not messages:
                    logger.debug("No messages, continuing loop...")
                    continue

                for stream, msg_list in messages:
                    logger.debug(f"Processing {len(msg_list)} messages from stream {stream}")
                    for msg_id, msg_data in msg_list:
                        # Parse JSON fields
                        parsed_data = {}
                        for k, v in msg_data.items():
                            try:
                                parsed_data[k] = json.loads(v)
                            except (json.JSONDecodeError, TypeError):
                                parsed_data[k] = v

                        logger.info(f"Yielding message {msg_id}")
                        yield {
                            "id": msg_id,
                            "stream": stream,
                            "data": parsed_data,
                        }

            except asyncio.CancelledError:
                logger.info(f"Consumer {consumer_name} cancelled")
                break
            except aioredis.ResponseError as e:
                if "NOGROUP" in str(e):
                    logger.warning(f"Consumer group missing, recreating...")
                    await self._ensure_consumer_groups()
                    await asyncio.sleep(1)
                else:
                    logger.error(f"Error consuming from {stream_name}: {e}", exc_info=True)
                    await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Error consuming from {stream_name}: {e}", exc_info=True)
                await asyncio.sleep(1)  # Back off on error

    async def ack_message(
        self,
        stream_name: str,
        group_name: str,
        msg_id: str,
    ) -> None:
        """
        Acknowledge a message has been processed.

        Args:
            stream_name: Name of the stream
            group_name: Consumer group name
            msg_id: Message ID to acknowledge
        """
        await self.client.xack(stream_name, group_name, msg_id)
        logger.debug(f"Acknowledged message {msg_id} in {stream_name}")

    async def claim_pending(
        self,
        stream_name: str,
        group_name: str,
        consumer_name: str,
        min_idle_time: int = 60000,
        count: int = 1,
    ) -> list[dict[str, Any]]:
        """
        Claim pending messages that have been idle too long.

        Used to recover from crashed consumers.

        Args:
            stream_name: Name of the stream
            group_name: Consumer group name
            consumer_name: Consumer claiming the messages
            min_idle_time: Minimum idle time in milliseconds
            count: Max messages to claim

        Returns:
            List of claimed messages
        """
        messages = await self.client.xautoclaim(
            name=stream_name,
            groupname=group_name,
            consumername=consumer_name,
            min_idle_time=min_idle_time,
            start_id="0",
            count=count,
        )

        result = []
        if messages:
            for msg_id, msg_data in messages[1]:  # messages[1] is the list
                parsed_data = {}
                for k, v in msg_data.items():
                    try:
                        parsed_data[k] = json.loads(v)
                    except (json.JSONDecodeError, TypeError):
                        parsed_data[k] = v
                result.append({
                    "id": msg_id,
                    "stream": stream_name,
                    "data": parsed_data,
                })

        return result

    # ==========================================
    # Blackboard Methods (Shared State)
    # ==========================================

    async def set_blackboard(
        self,
        mission_id: str,
        key: str,
        value: dict[str, Any],
    ) -> None:
        """
        Set a value on the shared blackboard.

        Args:
            mission_id: Mission/scan ID
            key: Blackboard key
            value: Value to store
        """
        blackboard_key = f"blackboard:{mission_id}"
        await self.client.hset(
            blackboard_key,
            key,
            json.dumps(value),
        )
        logger.debug(f"Set blackboard {mission_id}/{key}")

    async def get_blackboard(
        self,
        mission_id: str,
        key: str,
    ) -> dict[str, Any] | None:
        """
        Get a value from the shared blackboard.

        Args:
            mission_id: Mission/scan ID
            key: Blackboard key

        Returns:
            Stored value or None
        """
        blackboard_key = f"blackboard:{mission_id}"
        value = await self.client.hget(blackboard_key, key)
        if value:
            return json.loads(value)
        return None

    async def get_all_blackboard(
        self,
        mission_id: str,
    ) -> dict[str, Any]:
        """
        Get all values from the shared blackboard.

        Args:
            mission_id: Mission/scan ID

        Returns:
            Dictionary of all blackboard values
        """
        blackboard_key = f"blackboard:{mission_id}"
        values = await self.client.hgetall(blackboard_key)
        return {
            k: json.loads(v) if isinstance(v, str) else v
            for k, v in values.items()
        }

    # ==========================================
    # Utility Methods
    # ==========================================

    async def get_stream_length(self, stream_name: str) -> int:
        """Get the number of messages in a stream."""
        return await self.client.xlen(stream_name)

    async def get_pending_count(
        self,
        stream_name: str,
        group_name: str,
    ) -> int:
        """Get the number of pending messages for a consumer group."""
        info = await self.client.xpending(stream_name, group_name)
        return info.get("pending", 0) if info else 0


# Singleton instance
_client: RedisBus | None = None


def get_redis_bus() -> RedisBus:
    """Get the Redis bus singleton."""
    global _client
    if _client is None:
        _client = RedisBus()
    return _client