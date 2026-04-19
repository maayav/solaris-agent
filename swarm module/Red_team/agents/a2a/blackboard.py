"""
Redis-backed blackboard for shared mission state.

Thin wrapper over core.redis_bus blackboard operations with
mission-scoped key namespacing.
"""

from __future__ import annotations

import logging
from typing import Any

from core.redis_bus import redis_bus

logger = logging.getLogger(__name__)


class Blackboard:
    """Shared intelligence store for a red team mission."""

    def __init__(self, mission_id: str):
        self.mission_id = mission_id

    async def write(self, key: str, value: Any) -> None:
        """Write a finding or state to the blackboard."""
        await redis_bus.blackboard_write(self.mission_id, key, value)
        logger.info("Blackboard [%s] write: %s", self.mission_id, key)

    async def read(self, key: str) -> Any | None:
        """Read a single key."""
        return await redis_bus.blackboard_read(self.mission_id, key)

    async def read_all(self) -> dict[str, Any]:
        """Read entire mission blackboard state."""
        return await redis_bus.blackboard_read_all(self.mission_id)

    async def append_to_list(self, key: str, item: Any) -> None:
        """Append an item to a list stored at key."""
        existing = await self.read(key)
        if existing is None:
            existing = []
        if not isinstance(existing, list):
            existing = [existing]
        existing.append(item)
        await self.write(key, existing)

    async def clear(self) -> None:
        """Clear the entire mission blackboard."""
        await redis_bus.blackboard_clear(self.mission_id)
        logger.info("Blackboard [%s] cleared", self.mission_id)
