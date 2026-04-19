"""
Sandbox Manager — Docker container lifecycle for isolated tool execution.

Provides two modes:
1. SharedSandboxManager: Single shared 'vibecheck-sandbox' container with --network host
2. SandboxManager (legacy): Per-mission containers with compose network fallback

Recommended: Use shared_sandbox_manager for easy localhost:3000 access
"""

from __future__ import annotations

import asyncio
import logging
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import docker
from docker.errors import NotFound, APIError

logger = logging.getLogger(__name__)

# Cross-platform detection
IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

SANDBOX_IMAGE = "vibecheck-sandbox:latest"
SANDBOX_DOCKERFILE = Path(__file__).parent / "Dockerfile.sandbox"
NETWORK_NAME = "red_team_redteam_net"
SHARED_CONTAINER_NAME = "vibecheck-sandbox"

# Cross-platform shared directory
SHARED_DIR_HOST = Path(tempfile.gettempdir()) / "vibecheck" / "shared"
SHARED_DIR_CONTAINER = "/tmp/vibecheck/shared"

# Cross-platform Docker networking
# Linux: use host networking for direct localhost access
# Windows/Mac: use bridge network with host.docker.internal
if IS_LINUX:
    DOCKER_NETWORK_MODE = "host"
    DOCKER_TARGET_HOST = "localhost"
else:
    # Windows and macOS use host.docker.internal to reach host
    DOCKER_NETWORK_MODE = None  # Will use default bridge
    DOCKER_TARGET_HOST = "host.docker.internal"


@dataclass
class ExecResult:
    """Result of a command execution inside the sandbox."""

    exit_code: int
    stdout: str
    stderr: str
    command: str
    timed_out: bool = False

    @property
    def success(self) -> bool:
        # B23: Exit code 18 (partial transfer) is acceptable if we got data
        # This happens with FTP/directory listings that hit size limits
        acceptable_codes = (0, 18)
        return self.exit_code in acceptable_codes and not self.timed_out

    def __str__(self) -> str:
        status = "OK" if self.success else f"FAIL (exit={self.exit_code})"
        output = self.stdout[:500] if self.stdout else self.stderr[:500]
        return f"[{status}] {self.command}\n{output}"


class SharedSandboxManager:
    """
    Manages a single shared 'vibecheck-sandbox' container for all tool execution.
    Uses --network host for easy access to localhost:3000 (Juice Shop).
    """

    def __init__(self):
        self._client: docker.DockerClient | None = None
        self._shared_container: Any = None
        self._lock = asyncio.Lock()

    def _get_client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.from_env()
        return self._client

    async def ensure_shared_sandbox(self) -> Any:
        """
        Ensure the shared 'vibecheck-sandbox' container is running.
        If not running, creates/starts it with --network host.
        Returns the container object.
        """
        async with self._lock:
            client = self._get_client()

            # Check if shared container exists and is running
            try:
                container = client.containers.get(SHARED_CONTAINER_NAME)
                container.reload()

                if container.status == "running":
                    logger.debug("Shared sandbox '%s' is running", SHARED_CONTAINER_NAME)
                    self._shared_container = container
                    return container
                else:
                    logger.warning(
                        "Shared sandbox '%s' is %s, starting it...",
                        SHARED_CONTAINER_NAME,
                        container.status,
                    )
                    await asyncio.to_thread(container.start)
                    container.reload()
                    if container.status == "running":
                        logger.info("Shared sandbox '%s' started", SHARED_CONTAINER_NAME)
                        self._shared_container = container
                        return container
            except NotFound:
                logger.info("Shared sandbox '%s' not found, creating...", SHARED_CONTAINER_NAME)
            except Exception as e:
                logger.warning("Error checking shared sandbox: %s", e)

            # Create shared directory for file exchange (cross-platform)
            SHARED_DIR_HOST.mkdir(parents=True, exist_ok=True)

            # Create new shared container with cross-platform networking
            try:
                # Build container kwargs dynamically for cross-platform support
                container_kwargs = {
                    "image": SANDBOX_IMAGE,
                    "name": SHARED_CONTAINER_NAME,
                    "detach": True,
                    "mem_limit": "2g",
                    "volumes": {
                        str(SHARED_DIR_HOST): {"bind": SHARED_DIR_CONTAINER, "mode": "rw"}
                    },
                    "environment": {
                        "TARGET_HOST": DOCKER_TARGET_HOST,
                    },
                    "cap_add": ["NET_RAW", "NET_ADMIN"],
                }
                
                # Add network mode only for Linux (host networking)
                if DOCKER_NETWORK_MODE:
                    container_kwargs["network_mode"] = DOCKER_NETWORK_MODE
                
                container = await asyncio.to_thread(
                    client.containers.run,
                    **container_kwargs
                )
                logger.info(
                    "Shared sandbox '%s' created (%s)", SHARED_CONTAINER_NAME, 
                    "host network" if IS_LINUX else "bridge network with host.docker.internal"
                )
                self._shared_container = container
                return container

            except Exception as e:
                raise RuntimeError(f"Failed to create shared sandbox: {e}")

    async def exec_command(
        self,
        command: str,
        timeout: int = 60,
        workdir: str = "/tmp",
        user: str = "root",
    ) -> ExecResult:
        """
        Execute a command in the shared sandbox container.
        Auto-starts the container if not running.
        """
        container = await self.ensure_shared_sandbox()

        logger.info("Sandbox exec: %s", command[:80])

        try:
            exec_result = await asyncio.wait_for(
                asyncio.to_thread(
                    container.exec_run,
                    ["sh", "-c", command],
                    demux=True,
                    workdir=workdir,
                    user=user,
                    privileged=True,
                ),
                timeout=timeout,
            )

            stdout_raw, stderr_raw = exec_result.output
            stdout = (stdout_raw or b"").decode("utf-8", errors="replace")
            stderr = (stderr_raw or b"").decode("utf-8", errors="replace")

            result = ExecResult(
                exit_code=exec_result.exit_code,
                stdout=stdout,
                stderr=stderr,
                command=command,
            )

            # ACTION LOG: Print first 10 lines of output for judges
            output_lines = stdout.split('\n')[:10]
            if output_lines and output_lines[0]:
                print(f"\n[TOOL OUTPUT] {command[:60]}...")
                for i, line in enumerate(output_lines, 1):
                    if line.strip():
                        print(f"  {i}: {line[:100]}")
                if len(stdout.split('\n')) > 10:
                    print(f"  ... ({len(stdout.split(chr(10))) - 10} more lines)")
                print()

            # KEEP-ALIVE RULE: Re-attach/restart on exit code -1
            if result.exit_code == -1:
                logger.warning("Exit code -1 detected! Attempting to re-attach/restart container...")
                try:
                    # Try to re-attach to existing container
                    client = self._get_client()
                    try:
                        container = client.containers.get(SHARED_CONTAINER_NAME)
                        container.reload()
                        if container.status != "running":
                            logger.info("Container exists but not running, starting it...")
                            await asyncio.to_thread(container.start)
                            logger.info("Container restarted successfully")
                        else:
                            logger.info("Container is already running, re-attached")
                        self._shared_container = container
                    except NotFound:
                        logger.info("Container not found, creating new one...")
                        self._shared_container = None
                        container = await self.ensure_shared_sandbox()
                    
                    # Retry the command once
                    logger.info("Retrying command after restart...")
                    exec_result = await asyncio.wait_for(
                        asyncio.to_thread(
                            container.exec_run,
                            ["sh", "-c", command],
                            demux=True,
                            workdir=workdir,
                            user=user,
                            privileged=True,
                        ),
                        timeout=timeout,
                    )
                    
                    stdout_raw, stderr_raw = exec_result.output
                    stdout = (stdout_raw or b"").decode("utf-8", errors="replace")
                    stderr = (stderr_raw or b"").decode("utf-8", errors="replace")
                    
                    result = ExecResult(
                        exit_code=exec_result.exit_code,
                        stdout=stdout,
                        stderr=stderr,
                        command=command,
                    )
                    logger.info("Retry successful! Exit code: %d", result.exit_code)
                except Exception as retry_err:
                    logger.error("Re-attach/restart failed: %s", retry_err)

            level = logging.DEBUG if result.success else logging.WARNING
            logger.log(level, "Sandbox result: %s", str(result)[:150])
            return result

        except asyncio.TimeoutError:
            logger.warning("Sandbox timeout after %ds: %s", timeout, command[:80])
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr=f"Command timed out after {timeout}s",
                command=command,
                timed_out=True,
            )
        except Exception as e:
            logger.error("Sandbox execution failed: %s", e)
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr=f"Execution error: {e}",
                command=command,
            )

    async def execute_python(self, code: str, timeout: int = 60) -> ExecResult:
        """
        Execute Python code in the shared sandbox container.
        Used for web scraping and dynamic exploit generation.
        """
        import base64
        # Encode the code to handle special characters safely
        encoded_code = base64.b64encode(code.encode()).decode()
        command = f"python3 -c 'import base64; exec(base64.b64decode(\"{encoded_code}\"))'"
        return await self.exec_command(command, timeout=timeout)

    async def write_file(self, filename: str, content: str, workdir: str = "/workspace") -> ExecResult:
        """
        Write a file to the sandbox filesystem.
        Used by Gamma to save generated exploit scripts.
        """
        import base64
        # Encode content to handle binary/special chars
        encoded_content = base64.b64encode(content.encode()).decode()
        command = f"mkdir -p {workdir} && echo '{encoded_content}' | base64 -d > {workdir}/{filename}"
        result = await self.exec_command(command)
        if result.success:
            logger.info("Written file to sandbox: %s/%s", workdir, filename)
        else:
            logger.error("Failed to write file: %s", result.stderr)
        return result

    async def read_file(self, filepath: str) -> ExecResult:
        """
        Read a file from the sandbox filesystem.
        """
        command = f"cat {filepath} 2>/dev/null || echo 'FILE_NOT_FOUND'"
        result = await self.exec_command(command)
        if result.stdout.strip() == "FILE_NOT_FOUND":
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr=f"File not found: {filepath}",
                command=command,
            )
        return result

    async def execute_script(self, script_path: str, interpreter: str = "python3", timeout: int = 60) -> ExecResult:
        """
        Execute a script file in the sandbox.
        Used to run generated exploit scripts.
        """
        command = f"{interpreter} {script_path}"
        return await self.exec_command(command, timeout=timeout)

    async def configure_network_isolation(self, target_ip: str | None = None, allowed_ports: list[int] | None = None) -> ExecResult:
        """
        Configure network isolation to restrict outbound connections.
        Only allows connections to the specified target IP and ports.
        
        Args:
            target_ip: The only IP allowed for outbound connections
            allowed_ports: List of ports allowed (default: [80, 443, 3000, 8080])
        """
        if allowed_ports is None:
            allowed_ports = [80, 443, 3000, 8080, 11434]  # Include Ollama port
        
        # Build iptables rules
        commands = [
            "# Flush existing rules",
            "iptables -F OUTPUT",
            "iptables -P OUTPUT DROP",  # Default deny outbound
            "# Allow loopback",
            "iptables -A OUTPUT -o lo -j ACCEPT",
            "# Allow established connections",
            "iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
        ]
        
        # Allow specific target if provided
        if target_ip:
            for port in allowed_ports:
                commands.append(f"iptables -A OUTPUT -p tcp -d {target_ip} --dport {port} -j ACCEPT")
        else:
            # Allow common ports to any IP (less restrictive)
            for port in allowed_ports:
                commands.append(f"iptables -A OUTPUT -p tcp --dport {port} -j ACCEPT")
        
        # Allow DNS
        commands.append("iptables -A OUTPUT -p udp --dport 53 -j ACCEPT")
        
        command = " && ".join(commands)
        result = await self.exec_command(command)
        
        if result.success:
            logger.info("Network isolation configured for target: %s", target_ip or "any")
        else:
            logger.warning("Failed to configure network isolation: %s", result.stderr)
        
        return result

    async def destroy(self):
        """Stop and remove the shared sandbox container."""
        if self._shared_container:
            try:
                await asyncio.to_thread(self._shared_container.stop, timeout=5)
                await asyncio.to_thread(self._shared_container.remove, force=True)
                logger.info("Shared sandbox destroyed")
            except Exception as e:
                logger.warning("Error destroying shared sandbox: %s", e)
            self._shared_container = None


class SandboxManager:
    """Legacy per-mission sandbox manager."""

    def __init__(self):
        self._client: docker.DockerClient | None = None
        self._containers: dict[str, Any] = {}
        self.use_host_network: bool = False

    def _get_client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.from_env()
        return self._client

    def get_target_host(self) -> str:
        if self.use_host_network:
            if IS_WINDOWS or IS_MAC:
                return "host.docker.internal"
            return "localhost"
        return "juiceshop"

    async def ensure_image(self) -> None:
        client = self._get_client()
        try:
            client.images.get(SANDBOX_IMAGE)
            logger.info("Sandbox image '%s' exists", SANDBOX_IMAGE)
        except NotFound:
            logger.info("Building sandbox image '%s'...", SANDBOX_IMAGE)
            await asyncio.to_thread(
                client.images.build,
                path=str(SANDBOX_DOCKERFILE.parent),
                dockerfile=SANDBOX_DOCKERFILE.name,
                tag=SANDBOX_IMAGE,
                rm=True,
            )
            logger.info("Sandbox image built")

    async def create_sandbox(self, mission_id: str) -> str:
        """Create a per-mission sandbox container."""
        client = self._get_client()
        container_name = f"redteam-sandbox-{mission_id}"

        try:
            old = client.containers.get(container_name)
            await asyncio.to_thread(old.remove, force=True)
        except NotFound:
            pass

        # Cross-platform shared directory
        SHARED_DIR_HOST.mkdir(parents=True, exist_ok=True)

        base_kwargs = dict(
            image=SANDBOX_IMAGE,
            name=container_name,
            detach=True,
            mem_limit="2g",
            volumes={str(SHARED_DIR_HOST): {"bind": SHARED_DIR_CONTAINER, "mode": "rw"}},
            user="root",
            cap_add=["NET_RAW", "NET_ADMIN"],
        )

        # Cross-platform network configuration
        if IS_LINUX:
            # Linux: prefer host network for direct localhost access
            try:
                host_kwargs = {**base_kwargs, "network_mode": "host"}
                container = await asyncio.to_thread(client.containers.run, **host_kwargs)
                self.use_host_network = True
                logger.info("Sandbox on host network (Linux)")
            except (NotFound, APIError):
                # Fallback to bridge network
                container = await asyncio.to_thread(
                    client.containers.run, **base_kwargs, network=NETWORK_NAME
                )
                self.use_host_network = False
        else:
            # Windows/Mac: use bridge network with host.docker.internal
            container = await asyncio.to_thread(
                client.containers.run, **base_kwargs, network=NETWORK_NAME
            )
            self.use_host_network = False
            logger.info("Sandbox on bridge network (Windows/Mac)")

        self._containers[mission_id] = container
        return container.id

    async def exec_command(self, mission_id: str, command: str, timeout: int = 60) -> ExecResult:
        """Execute command in mission-specific container."""
        container = self._containers.get(mission_id)
        if container is None:
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr="No sandbox container found",
                command=command,
            )

        try:
            exec_result = await asyncio.wait_for(
                asyncio.to_thread(
                    container.exec_run,
                    ["sh", "-c", command],
                    demux=True,
                    workdir="/tmp",
                    user="root",
                    privileged=True,
                ),
                timeout=timeout,
            )

            stdout = (exec_result.output[0] or b"").decode("utf-8", errors="replace")
            stderr = (exec_result.output[1] or b"").decode("utf-8", errors="replace")

            return ExecResult(
                exit_code=exec_result.exit_code,
                stdout=stdout,
                stderr=stderr,
                command=command,
            )
        except asyncio.TimeoutError:
            return ExecResult(
                exit_code=-1,
                stdout="",
                stderr="Timeout",
                command=command,
                timed_out=True,
            )

    async def destroy_sandbox(self, mission_id: str):
        container = self._containers.pop(mission_id, None)
        if container:
            try:
                await asyncio.to_thread(container.remove, force=True)
            except Exception as e:
                logger.warning("Error removing container: %s", e)

    async def destroy_all(self):
        for mission_id in list(self._containers.keys()):
            await self.destroy_sandbox(mission_id)


# Default instances
sandbox_manager = SandboxManager()
shared_sandbox_manager = SharedSandboxManager()
