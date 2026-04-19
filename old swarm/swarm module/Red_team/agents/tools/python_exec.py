"""
Python execution tool — run Python exploit scripts in the sandbox.
"""

from __future__ import annotations

import logging

from agents.tools.registry import ToolSpec
from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)


async def python_exec_execute(
    mission_id: str,
    code: str | None = None,
    script_path: str | None = None,
    timeout: int = 30,
) -> ExecResult:
    """
    Execute a Python script inside the sandbox.

    Args:
        mission_id: Active mission ID
        code: Python code to execute (has 'requests' available)
        script_path: Path to Python script file (alternative to code)
        timeout: Execution timeout in seconds
    """
    # Docker host for sandbox to access host services
    host = "host.docker.internal"
    
    # Handle both code and script_path arguments
    if script_path:
        # It's a script path - use it directly
        command = f"python3 {script_path}"
    elif code:
        # It's inline code - execute directly
        # Replace localhost with Docker host for sandbox access
        code = code.replace("localhost:3000", f"{host}:3000")
        code = code.replace("localhost", host)
        code = code.replace("127.0.0.1", host)

        # Write code to temp file and execute
        # Using heredoc to avoid quoting issues
        escaped_code = code.replace("'", "'\\''")
        command = f"python3 -c '{escaped_code}'"
    else:
        raise ValueError("Either 'code' or 'script_path' must be provided")

    return await shared_sandbox_manager.exec_command(command, timeout=timeout)


python_exec_tool = ToolSpec(
    name="python",
    description="Execute Python code in an isolated sandbox. Has access to 'requests' library for HTTP. Use this for complex exploit logic, automated attacks, or data processing.",
    args_schema={
        "code": "Python code to execute (has 'requests' available)",
        "script_path": "Path to Python script file (alternative to code)",
        "timeout": "Optional: execution timeout in seconds (default: 30)",
    },
    execute=python_exec_execute,
)
