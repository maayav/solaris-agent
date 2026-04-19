"""
A2A (Agent-to-Agent) message schema.

All inter-agent communication uses this schema, serialized to JSON
and published to Redis Streams.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentRole(str, Enum):
    COMMANDER = "commander"
    ALPHA = "agent_alpha"
    BETA = "agent_beta"  # B15: Added missing agent role
    GAMMA = "agent_gamma"
    CRITIC = "agent_critic"  # Also add critic role for completeness


class MessageType(str, Enum):
    # Commander → Agents
    TASK_ASSIGNMENT = "TASK_ASSIGNMENT"
    STRATEGY_UPDATE = "STRATEGY_UPDATE"

    # Agents → Commander
    INTELLIGENCE_REPORT = "INTELLIGENCE_REPORT"
    EXPLOIT_RESULT = "EXPLOIT_RESULT"
    STATUS_UPDATE = "STATUS_UPDATE"

    # HITL
    HITL_REQUEST = "HITL_REQUEST"
    HITL_RESPONSE = "HITL_RESPONSE"

    # System
    MISSION_START = "MISSION_START"
    MISSION_COMPLETE = "MISSION_COMPLETE"


class Priority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class A2AMessage(BaseModel):
    """Inter-agent message conforming to the PRD A2A schema."""

    msg_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender: AgentRole
    recipient: AgentRole | Literal["all"] = "all"
    type: MessageType
    priority: Priority = Priority.MEDIUM
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_stream_dict(self) -> dict[str, str]:
        """Serialize for Redis Stream (all values must be strings)."""
        return {
            "msg_id": self.msg_id,
            "sender": self.sender.value,
            "recipient": self.recipient if isinstance(self.recipient, str) else self.recipient.value,
            "type": self.type.value,
            "priority": self.priority.value,
            "payload": self.model_dump_json(include={"payload"}),
            "timestamp": self.timestamp.isoformat(),
        }

    @classmethod
    def from_stream_dict(cls, data: dict[str, Any]) -> A2AMessage:
        """Deserialize from Redis Stream dict."""
        import json

        payload = data.get("payload", "{}")
        if isinstance(payload, str):
            try:
                parsed = json.loads(payload)
                # Handle the nested {"payload": {...}} structure from model_dump_json
                if isinstance(parsed, dict) and "payload" in parsed:
                    payload = parsed["payload"]
                else:
                    payload = parsed
            except json.JSONDecodeError:
                payload = {}

        return cls(
            msg_id=data.get("msg_id", str(uuid.uuid4())),
            sender=AgentRole(data["sender"]),
            recipient=data.get("recipient", "all"),
            type=MessageType(data["type"]),
            priority=Priority(data.get("priority", "MEDIUM")),
            payload=payload,
            timestamp=datetime.fromisoformat(data["timestamp"]) if "timestamp" in data else datetime.now(timezone.utc),
        )


class TaskAssignment(BaseModel):
    """Payload schema for TASK_ASSIGNMENT messages."""

    task_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    description: str
    target: str = ""
    tools_allowed: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class IntelligenceReport(BaseModel):
    """Payload schema for INTELLIGENCE_REPORT messages."""

    asset: str
    finding: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str = ""
    cve_hint: str | None = None
    recommended_action: str = ""


class ExploitResult(BaseModel):
    """Payload schema for EXPLOIT_RESULT messages."""

    target: str
    exploit_type: str
    success: bool
    payload_used: str = ""
    response_code: int | None = None
    evidence: str = ""
    impact: str = ""
    execution_time: float = 0.0  # Time in seconds for the exploit execution
