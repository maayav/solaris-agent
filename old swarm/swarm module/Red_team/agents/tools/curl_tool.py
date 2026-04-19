"""
HTTP request tool — curl wrapper for crafting custom requests via sandbox.
"""

from __future__ import annotations

import logging
import shlex

from agents.tools.registry import ToolSpec
from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)


async def curl_execute(
    mission_id: str,
    url: str = "",
    target: str = "",
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: str = "",
    args: str = "",
    timeout: int = 30,
    max_time: int = 30,
) -> ExecResult:
    """
    Send an HTTP request via curl.

    Args:
        mission_id: Active mission ID
        url: Target URL (primary)
        target: Alternative to url (for LLM compatibility)
        method: HTTP method (GET, POST, PUT, DELETE)
        headers: Optional dict of headers
        data: Optional request body
        args: Additional curl arguments
        timeout: Request timeout in seconds (default: 30)
        max_time: Max time for curl operation (default: 30)
    """
    # Support both 'url' and 'target' parameters (LLM may use either)
    actual_url = url or target
    if not actual_url:
        return ExecResult(
            stdout="",
            stderr="Error: No URL provided (need 'url' or 'target' parameter)",
            exit_code=1,
            command="curl (no url)",
        )
    
    # Replace localhost with host.docker.internal for Docker sandbox access to host
    docker_url = actual_url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")

    # Add timeout to prevent infinite hangs
    parts = ["curl", "-s", "-i", f"-X {method}", f"--max-time {max_time}"]

    if headers:
        for key, value in headers.items():
            parts.append(f'-H {shlex.quote(f"{key}: {value}")}')

    if data:
        parts.append(f"-d {shlex.quote(data)}")

    if args:
        # Filter out common curl flags that we already handle or shouldn't be in args
        # These flags should be in their own fields, not in args
        filtered_args = args
        for flag in ['--max-time', '-m', '--silent', '-s', '--show-error', '-S', 
                     '--include', '-i', '--insecure', '-k', '--verbose', '-v',
                     '--request', '-X', '--header', '-H', '--data', '-d',
                     '--data-binary', '--data-raw', '--user', '-u']:
            filtered_args = filtered_args.replace(flag, '')
        filtered_args = filtered_args.strip()
        if filtered_args:
            parts.append(filtered_args)

    parts.append(shlex.quote(docker_url))

    command = " ".join(parts)
    result = await shared_sandbox_manager.exec_command(command, timeout=timeout + 5)
    
    # Enhanced error handling for connection issues (B10: exit code 28)
    if result.exit_code == 28:
        result.stderr = (
            f"[Connection Timeout] Could not connect to {actual_url}\n"
            f"Exit code 28: Operation timed out after {max_time}s\n"
            f"Possible causes:\n"
            f"  - Target is not running or not accessible\n"
            f"  - Target is running on a different port\n"
            f"  - Docker host networking is not properly configured\n"
            f"  - Firewall blocking the connection\n"
            f"\nOriginal error:\n{result.stderr}"
        )
    elif result.exit_code == 7:
        result.stderr = (
            f"[Connection Failed] Could not connect to {actual_url}\n"
            f"Exit code 7: Failed to connect to host\n"
            f"Possible causes:\n"
            f"  - Target is not running\n"
            f"  - Wrong host or port\n"
            f"\nOriginal error:\n{result.stderr}"
        )
    
    return result


curl_tool = ToolSpec(
    name="curl",
    description="Send custom HTTP requests. Supports all methods, custom headers, JSON bodies, and cookies. Returns full response including headers.",
    args_schema={
        "url": "Target URL (e.g. http://localhost:3000/rest/user/login) - use this or 'target'",
        "target": "Alternative to url for LLM compatibility",
        "method": "HTTP method: GET, POST, PUT, DELETE (default: GET)",
        "headers": "Optional dict of headers (e.g. {'Content-Type': 'application/json'})",
        "data": "Optional request body (e.g. JSON payload)",
        "args": "Optional: additional curl flags (e.g. -L for follow redirects)",
    },
    execute=curl_execute,
)
