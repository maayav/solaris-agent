"""
Pydantic schemas for structured agent output.
"""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


# ============ COMMANDER SCHEMAS ============

class TaskAssignment(BaseModel):
    """Single task assigned to an agent."""
    description: str = Field(..., description="Task description")
    target: str = Field(..., description="Target URL or host")
    tools_allowed: list[str] = Field(default_factory=list, description="Allowed tools")
    constraints: list[str] = Field(default_factory=list, description="Task constraints")


class CommanderPlan(BaseModel):
    """Commander's strategic plan output."""
    strategy: str = Field(..., description="High-level strategy")
    tasks: list[TaskAssignment] = Field(default_factory=list, description="Tasks to execute")
    phase: Literal["recon", "weaponization", "exploitation", "actions_on_objectives", "complete"] = Field(
        default="recon", description="Current phase"
    )


class CommanderObserve(BaseModel):
    """Commander's observation/decision output."""
    next_phase: str = Field(..., description="Next phase to execute")
    strategy: str = Field(..., description="Updated strategy")
    tasks: list[TaskAssignment] = Field(default_factory=list, description="New tasks if any")


# ============ ALPHA (RECON) SCHEMAS ============

class ReconFinding(BaseModel):
    """Single reconnaissance finding."""
    asset: str = Field(..., description="Asset (host:port)")
    finding: str = Field(..., description="What was found")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence 0-1")
    evidence: str = Field(..., description="Raw evidence")
    cve_hint: str | None = Field(None, description="CVE if applicable")
    recommended_action: str = Field(..., description="Recommended action")
    priority: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"] = Field(default="MEDIUM")


class AlphaIntel(BaseModel):
    """Alpha's intelligence report."""
    findings: list[ReconFinding] = Field(default_factory=list)


# ============ GAMMA (EXPLOIT) SCHEMAS ============

class ToolCall(BaseModel):
    """Single tool execution call."""
    tool: Literal["curl", "python", "nmap", "nuclei"] = Field(..., description="Tool name")
    args: dict = Field(default_factory=dict, description="Tool arguments")
    exploit_type: str = Field(..., description="Type of exploit (sqli, xss, etc)")
    reasoning: str = Field(..., description="Why this exploit should work")


class GammaPlan(BaseModel):
    """Gamma's exploit plan."""
    tool_calls: list[ToolCall] = Field(default_factory=list)


class ExploitCorrection(BaseModel):
    """Gamma's corrected exploit after self-reflection."""
    corrected: bool = Field(..., description="Whether correction was possible")
    new_tool_call: ToolCall | None = Field(None, description="Corrected tool call")
    reasoning: str = Field(..., description="Explanation of correction")


# ============ CRITIC SCHEMAS ============

class CriticEvaluation(BaseModel):
    """Critic's evaluation of exploit result."""
    success: bool = Field(..., description="Whether exploit succeeded")
    evidence: str = Field(..., description="Specific evidence of success/failure")
    error_type: Literal["none", "syntax_error", "waf_block", "auth_failure", "timeout", "not_found", "rate_limit", "unknown"] = Field(
        default="none", description="Type of error if failed"
    )
    feedback: str = Field(..., description="Actionable feedback for correction")
    severity: Literal["critical", "high", "medium", "low", "none"] = Field(default="medium")
    session_token_found: bool = Field(default=False)
    session_token_value: str | None = Field(None)


# ============ STATE SCHEMAS ============

class DiscoveredCredential(BaseModel):
    """Discovered authentication credential."""
    type: Literal["jwt", "cookie", "basic_auth", "api_key", "session"] = Field(..., description="Credential type")
    value: str = Field(..., description="Credential value")
    target: str = Field(..., description="Where it was discovered")
    timestamp: str | None = Field(None, description="Discovery timestamp")


class MissionState(BaseModel):
    """Global mission state with credentials."""
    mission_id: str
    objective: str
    target: str
    phase: str
    discovered_credentials: dict[str, DiscoveredCredential] = Field(default_factory=dict)
    contextual_memory: dict = Field(default_factory=dict)
