"""
Dynamic Tool Registry — agents discover and invoke tools at runtime.

Each tool registers with a name, description, argument schema, and
an async execute function that runs commands in the Docker sandbox.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

from sandbox.sandbox_manager import ExecResult

logger = logging.getLogger(__name__)


@dataclass
class ToolSpec:
    """Specification for a registered tool."""

    name: str
    description: str
    args_schema: dict[str, str]  # arg_name -> description
    execute: Callable[..., Awaitable[ExecResult]]

    def to_prompt_description(self) -> str:
        """Format tool info for LLM prompt injection."""
        args_str = ", ".join(f"{k}: {v}" for k, v in self.args_schema.items())
        return f"- **{self.name}**: {self.description}\n  Args: {args_str}"


class ToolRegistry:
    """Registry of available tools that agents can invoke."""

    def __init__(self):
        self._tools: dict[str, ToolSpec] = {}

    def register(self, tool: ToolSpec) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool
        logger.info("Tool registered: %s", tool.name)

    def get(self, name: str) -> ToolSpec | None:
        """Get a tool by name."""
        return self._tools.get(name)

    def list_tools(self) -> list[ToolSpec]:
        """List all registered tools."""
        return list(self._tools.values())

    def list_names(self) -> list[str]:
        """List all tool names."""
        return list(self._tools.keys())

    def get_prompt_description(self, tool_names: list[str] | None = None) -> str:
        """
        Get a formatted description of tools for LLM prompts.
        If tool_names is None, returns all tools.
        """
        tools = self._tools.values()
        if tool_names:
            tools = [t for t in tools if t.name in tool_names]
        return "\n".join(t.to_prompt_description() for t in tools)

    async def execute(self, tool_name: str, **kwargs: Any) -> ExecResult:
        """Execute a tool by name with given arguments."""
        tool = self.get(tool_name)
        if tool is None:
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr=f"Unknown tool: {tool_name}",
                command=tool_name,
            )
        try:
            return await tool.execute(**kwargs)
        except Exception as e:
            logger.error("Tool '%s' execution error: %s", tool_name, e)
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr=f"Tool execution error: {e}",
                command=tool_name,
            )


# Default singleton
tool_registry = ToolRegistry()
