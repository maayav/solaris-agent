"""
Tests for A2A messaging schema and serialization.
"""

import json
from datetime import datetime, timezone

from agents.a2a.messages import (
    A2AMessage,
    AgentRole,
    ExploitResult,
    IntelligenceReport,
    MessageType,
    Priority,
    TaskAssignment,
)


class TestA2AMessage:
    """Test A2A message creation and serialization."""

    def test_create_message(self):
        msg = A2AMessage(
            sender=AgentRole.COMMANDER,
            recipient=AgentRole.ALPHA,
            type=MessageType.TASK_ASSIGNMENT,
            priority=Priority.HIGH,
            payload={"description": "Scan target"},
        )
        assert msg.sender == AgentRole.COMMANDER
        assert msg.recipient == AgentRole.ALPHA
        assert msg.type == MessageType.TASK_ASSIGNMENT
        assert msg.msg_id  # Auto-generated

    def test_to_stream_dict(self):
        msg = A2AMessage(
            sender=AgentRole.ALPHA,
            recipient=AgentRole.COMMANDER,
            type=MessageType.INTELLIGENCE_REPORT,
            payload={"finding": "Port 3000 open"},
        )
        stream_dict = msg.to_stream_dict()
        assert isinstance(stream_dict["sender"], str)
        assert stream_dict["sender"] == "agent_alpha"
        assert stream_dict["type"] == "INTELLIGENCE_REPORT"

    def test_roundtrip_serialization(self):
        original = A2AMessage(
            sender=AgentRole.GAMMA,
            recipient=AgentRole.COMMANDER,
            type=MessageType.EXPLOIT_RESULT,
            priority=Priority.CRITICAL,
            payload={"success": True, "exploit_type": "sqli"},
        )
        stream_dict = original.to_stream_dict()
        restored = A2AMessage.from_stream_dict(stream_dict)
        assert restored.sender == original.sender
        assert restored.type == original.type
        assert restored.priority == original.priority


class TestPayloadSchemas:
    """Test typed payload schemas."""

    def test_task_assignment(self):
        task = TaskAssignment(
            description="Perform nmap scan",
            target="http://localhost:3000",
            tools_allowed=["nmap"],
        )
        d = task.model_dump()
        assert d["description"] == "Perform nmap scan"
        assert "nmap" in d["tools_allowed"]

    def test_intelligence_report(self):
        intel = IntelligenceReport(
            asset="http://localhost:3000",
            finding="Port 3000 running Express",
            confidence=0.95,
            evidence="nmap output: 3000/tcp open",
        )
        assert intel.confidence == 0.95
        assert intel.cve_hint is None

    def test_exploit_result(self):
        result = ExploitResult(
            target="http://localhost:3000/rest/user/login",
            exploit_type="sqli",
            success=True,
            payload_used="' OR 1=1--",
            response_code=200,
            impact="Admin authentication bypass",
        )
        assert result.success is True
        assert result.exploit_type == "sqli"
