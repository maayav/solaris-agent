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
    # On Linux with host network, use localhost directly with internal Juice Shop port (3000)
    SANDBOX_TARGET_PORT = "3000"
else:
    # Windows and macOS use host.docker.internal to reach host
    # The host's Juice Shop is exposed on port 8080 (see docker-compose.yml)
    DOCKER_NETWORK_MODE = None  # Will use default bridge
    DOCKER_TARGET_HOST = "host.docker.internal"
    SANDBOX_TARGET_PORT = "8080"  # Translate to host port where Juice Shop is exposed


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

    async def ensure_image(self) -> None:
        """Ensure the sandbox image exists locally, building if necessary."""
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
            logger.info("Sandbox image built successfully")

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

            # Ensure the sandbox image is built (this was missing - fixes 404 on first run)
            await self.ensure_image()

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
                        "TARGET_PORT": SANDBOX_TARGET_PORT,
                    },
                    "cap_add": ["NET_RAW", "NET_ADMIN"],
                }
                
                # Add network mode only for Linux (host networking)
                # On Windows/Mac, also add to the red_team network for communication with target containers
                if DOCKER_NETWORK_MODE:
                    container_kwargs["network_mode"] = DOCKER_NETWORK_MODE
                else:
                    # On Windows/Mac, connect to the same network as target containers
                    container_kwargs["network"] = NETWORK_NAME
                
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

        # Debug: Show container network info
        logger.debug(f"[Docker Debug] Container short_id: {container.short_id}")
        logger.debug(f"[Docker Debug] Container status: {container.status}")
        logger.debug(f"[Docker Debug] Container network mode: {container.attrs.get('HostConfig', {}).get('NetworkMode', 'unknown')}")
        
        # Show active target globals
        logger.debug(f"[Docker Debug] _active_target_url: {_active_target_url}")
        logger.debug(f"[Docker Debug] _active_target_host: {_active_target_host}")
        logger.debug(f"[Docker Debug] _active_target_port: {_active_target_port}")
        
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


def get_sandbox_target() -> tuple[str, str]:
    """
    Returns the (host, port) tuple for the sandbox to reach host services.
    
    On Linux with host network: returns ("localhost", "3000")
    On Windows/Mac with bridge: returns ("host.docker.internal", "8080")
    """
    if IS_LINUX:
        return ("localhost", "3000")
    else:
        return (DOCKER_TARGET_HOST, SANDBOX_TARGET_PORT)


def translate_url_for_sandbox(url: str) -> str:
    """
    Translate a URL from localhost:PORT format to the correct sandbox host:port.
    
    Uses the active target container's host:port if deployed, otherwise falls back
    to the default sandbox target (for pre-existing services like manually started Juice Shop).
    
    E.g., "http://localhost:8080/api" -> "http://host.docker.internal:8080/api" (on Windows/Mac)
    """
    import re
    
    logger.debug(f"[URL Translation] Input URL: {url}")
    logger.debug(f"[URL Translation] Active target: host={_active_target_host}, port={_active_target_port}")
    
    # Use active target if set, otherwise use default sandbox target
    if _active_target_host and _active_target_port:
        host = _active_target_host
        port = _active_target_port
        logger.debug(f"[URL Translation] Using active target: {host}:{port}")
    else:
        host, port = get_sandbox_target()
        logger.debug(f"[URL Translation] Using default sandbox target: {host}:{port}")
    
    # Extract the port from the input URL if present, otherwise use the target port
    port_match = re.search(r'(localhost|127\.0\.0\.1):(\d+)', url)
    if port_match:
        input_port = port_match.group(2)
        logger.debug(f"[URL Translation] Input URL has explicit port: {input_port}")
        # Replace the port in the URL with the correct host:port
        url = re.sub(r'(localhost|127\.0\.0\.1):\d+', f'{host}:{port}', url)
    else:
        # No explicit port in URL - this shouldn't normally happen with full URLs
        # but handle it by replacing just the host
        url = re.sub(r'(localhost|127\.0\.0\.1)([/:])', f'{host}\\2', url)
    
    logger.debug(f"[URL Translation] Output URL: {url}")
    return url


# Global state for the active target container
_active_target_url: str | None = None
_active_target_host: str | None = None
_active_target_port: str | None = None


class TargetContainerManager:
    """
    Manages the target application container - clones repo, builds image, runs container.
    
    This handles the workflow where a user provides:
    - GitHub repo URL
    - Target URL (e.g., http://localhost:31754)
    
    The manager will:
    1. Clone the repo
    2. Detect Dockerfile and internal port
    3. Build image from repo
    4. Run container with port mapping
    5. Return the URL for exploits to target
    """

    def __init__(self):
        self._client: docker.DockerClient | None = None
        self._repo_path: Path | None = None
        self._container: Any = None
        self._image_tag: str | None = None
        self._mission_id: str | None = None
        self._deployed_url: str | None = None

    def _get_client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.from_env()
        return self._client

    def _extract_port_from_url(self, url: str) -> int:
        """Extract port number from URL like http://localhost:31754"""
        import re
        match = re.search(r':(\d+)', url)
        if match:
            return int(match.group(1))
        # Default to 3000 if no port specified
        return 3000

    def _find_dockerfile(self, repo_path: Path) -> Path | None:
        """Find Dockerfile in the repo (also checks Dockerfile.dev, Dockerfile.prod)"""
        patterns = ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod", "Dockerfile.prod stage"]
        for pattern in patterns:
            dockerfile = repo_path / pattern
            if dockerfile.exists():
                return dockerfile
        return None

    def _detect_internal_port(self, dockerfile: Path) -> int | None:
        """Detect the internal port from EXPOSE in Dockerfile"""
        import re
        try:
            content = dockerfile.read_text()
            # Look for EXPOSE directive
            match = re.search(r'EXPOSE\s+(\d+)', content)
            if match:
                return int(match.group(1))
            # Also check for common patterns like PORT=3000 in env files
            port_match = re.search(r'PORT\s*=\s*(\d+)', content)
            if port_match:
                return int(port_match.group(1))
        except Exception:
            pass
        return None

    async def deploy_target(
        self,
        repo_url: str,
        target_url: str,
        mission_id: str,
    ) -> dict:
        """
        Deploy the target application container.
        
        Args:
            repo_url: GitHub repo URL to clone
            target_url: The target URL (e.g., http://localhost:31754)
            mission_id: Mission ID for naming resources
            
        Returns:
            dict with keys:
                - success: bool
                - target_url: The translated URL for exploits to use
                - container_port: The internal port of the container
                - host_port: The mapped host port
                - container_name: Name of the container
                - error: Error message if failed
        """
        import subprocess
        import shutil
        
        self._mission_id = mission_id
        client = self._get_client()
        
        logger.info(f"=== TARGET CONTAINER DEPLOYMENT STARTING ===")
        logger.info(f"[DEBUG] repo_url: {repo_url}")
        logger.info(f"[DEBUG] target_url: {target_url}")
        logger.info(f"[DEBUG] mission_id: {mission_id}")
        logger.info(f"[DEBUG] platform: Windows={IS_WINDOWS}, Mac={IS_MAC}, Linux={IS_LINUX}")
        
        # Extract the host port from target_url
        host_port = self._extract_port_from_url(target_url)
        logger.info(f"[DEBUG] Extracted host_port from URL: {host_port}")
        
        # Step 0: Ensure the Docker network exists
        try:
            client.networks.get(NETWORK_NAME)
            logger.info(f"[DEBUG] Network '{NETWORK_NAME}' already exists")
        except NotFound:
            logger.info(f"[DEBUG] Creating Docker network '{NETWORK_NAME}'")
            client.networks.create(NETWORK_NAME, driver="bridge")
            logger.info(f"[DEBUG] Network '{NETWORK_NAME}' created")
        
        try:
            # Step 1: Clone the repo
            logger.info(f"Cloning repo: {repo_url}")
            temp_dir = Path(tempfile.mkdtemp(prefix="vibecheck_target_"))
            self._repo_path = temp_dir / "repo"
            
            result = subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, str(self._repo_path)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                return {
                    "success": False,
                    "error": f"Git clone failed: {result.stderr}",
                    "target_url": target_url,
                }
            logger.info(f"Repo cloned to: {self._repo_path}")
            
            # Step 2: Find Dockerfile
            dockerfile_path = self._find_dockerfile(self._repo_path)
            if not dockerfile_path:
                return {
                    "success": False,
                    "error": "No Dockerfile found in repo. Please add a Dockerfile to the repository.",
                    "target_url": target_url,
                }
            logger.info(f"Dockerfile found: {dockerfile_path.name}")
            
            # Step 3: Detect internal port
            internal_port = self._detect_internal_port(dockerfile_path)
            if not internal_port:
                # Default to 3000 if not detected
                internal_port = 3000
                logger.warning(f"Could not detect internal port, defaulting to {internal_port}")
            else:
                logger.info(f"Internal port detected: {internal_port}")
            
            # Step 4: Build the image
            image_tag = f"target-{mission_id[:8]}"
            self._image_tag = image_tag
            
            logger.info(f"[DEBUG] Building Docker image: {image_tag}")
            logger.info(f"[DEBUG] Build path: {self._repo_path}")
            logger.info(f"[DEBUG] Dockerfile: {dockerfile_path.name}")
            
            # Check if image already exists
            try:
                existing = client.images.get(image_tag)
                logger.info(f"[DEBUG] Image {image_tag} already exists, removing it first")
                client.images.remove(image_tag, force=True)
            except NotFound:
                pass
            
            build_result = await asyncio.to_thread(
                client.images.build,
                path=str(self._repo_path),
                dockerfile=dockerfile_path.name,
                tag=image_tag,
                rm=True,
            )
            logger.info(f"[DEBUG] Image build completed. Image: {image_tag}")
            
            # Step 5: Run the container
            container_name = f"target-{mission_id[:8]}"
            
            # Determine network mode
            if IS_LINUX:
                network_mode = "host"
                container_url = f"http://localhost:{internal_port}"
            else:
                network_mode = "bridge"
                container_url = f"http://host.docker.internal:{host_port}"
            
            logger.info(f"[DEBUG] Network mode: {network_mode}")
            logger.info(f"[DEBUG] Container URL will be: {container_url}")
            logger.info(f"[DEBUG] Port mapping: container {internal_port} -> host {host_port}")
            
            # Create shared directory for file exchange
            SHARED_DIR_HOST.mkdir(parents=True, exist_ok=True)
            
            container_kwargs = {
                "image": image_tag,
                "name": container_name,
                "detach": True,
                "mem_limit": "1g",
                "ports": {f"{internal_port}/tcp": host_port},
                "environment": {
                    "PORT": str(internal_port),
                    "NODE_ENV": "development",
                },
            }
            
            if network_mode == "host":
                container_kwargs["network_mode"] = "host"
            else:
                container_kwargs["network"] = NETWORK_NAME
            
            logger.info(f"[DEBUG] Creating container with kwargs: {container_kwargs}")
            
            self._container = await asyncio.to_thread(
                client.containers.run,
                **container_kwargs
            )
            logger.info(f"[DEBUG] Container created with ID: {self._container.id}")
            
            # Wait for container to initialize (with health check)
            logger.info(f"[DEBUG] Waiting for container to start...")
            await asyncio.sleep(2)
            
            # Verify container is running
            self._container.reload()
            logger.info(f"[DEBUG] Container status after reload: {self._container.status}")
            
            if self._container.status != "running":
                # Try to get logs
                try:
                    logs = await asyncio.to_thread(self._container.logs, stdout=True, stderr=True)
                    logger.error(f"[DEBUG] Container logs: {logs}")
                except Exception as e:
                    logger.error(f"[DEBUG] Could not get container logs: {e}")
                    
                return {
                    "success": False,
                    "error": f"Container failed to start. Status: {self._container.status}",
                    "target_url": target_url,
                }
            
            logger.info(f"[DEBUG] Container is running! Container short ID: {self._container.short_id}")
            
            # Health check: Wait for application to be ready
            health_check_url = f"http://localhost:{host_port}"
            logger.info(f"[DEBUG] Health checking: {health_check_url}")
            
            import httpx
            max_retries = 30
            retry_delay = 1
            
            for attempt in range(max_retries):
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client_http:
                        response = await client_http.get(health_check_url)
                        if response.status_code < 500:  # Any non-server error means app is responding
                            logger.info(f"[DEBUG] Health check passed on attempt {attempt + 1}")
                            break
                except Exception as e:
                    if attempt < max_retries - 1:
                        logger.debug(f"[DEBUG] Health check attempt {attempt + 1} failed: {e}")
                        await asyncio.sleep(retry_delay)
                    else:
                        logger.warning(f"[DEBUG] Health check failed after {max_retries} attempts: {e}")
                        # Continue anyway - the app might just be slow to start
            
            logger.info(f"[DEBUG] Container should be ready at: {container_url}")
            logger.info(f"[DEBUG] Container name: {container_name}")
            logger.info(f"[DEBUG] Container network mode: {network_mode}")
            
            # Store the deployed URL for use by translate_url_for_sandbox
            # NOTE: _active_target_port should be the INTERNAL port (3000), not the external mapped port.
            # translate_url_for_sandbox replaces localhost:PORT in URLs with host.docker.internal:PORT.
            # Since exploit URLs use localhost:3000 (Juice Shop's internal port), we store 3000 here.
            # Docker's port mapping (host_port -> internal_port) handles the rest.
            global _active_target_url, _active_target_host, _active_target_port
            _active_target_url = container_url
            if IS_LINUX:
                _active_target_host = "localhost"
            else:
                _active_target_host = "host.docker.internal"
            _active_target_port = str(internal_port)  # Use internal port (3000), not external (host_port)
            self._deployed_url = container_url
            
            return {
                "success": True,
                "target_url": container_url,
                "container_port": internal_port,
                "host_port": host_port,
                "container_name": container_name,
                "image_tag": image_tag,
            }
            
        except Exception as e:
            logger.exception(f"Failed to deploy target: {e}")
            return {
                "success": False,
                "error": str(e),
                "target_url": target_url,
            }

    async def cleanup(self):
        """Clean up the target container and cloned repo."""
        global _active_target_url, _active_target_host, _active_target_port
        
        # Clear the active target state
        _active_target_url = None
        _active_target_host = None
        _active_target_port = None
        
        client = self._get_client()
        
        # Stop and remove container
        if self._container:
            try:
                await asyncio.to_thread(self._container.stop, timeout=10)
                await asyncio.to_thread(self._container.remove, force=True)
                logger.info(f"Removed container: {self._container.name}")
            except Exception as e:
                logger.warning(f"Failed to remove container: {e}")
            self._container = None
        
        # Remove image
        if self._image_tag:
            try:
                client.images.remove(self._image_tag, force=True)
                logger.info(f"Removed image: {self._image_tag}")
            except Exception as e:
                logger.warning(f"Failed to remove image: {e}")
            self._image_tag = None
        
        # Remove cloned repo
        if self._repo_path and self._repo_path.exists():
            try:
                import shutil
                shutil.rmtree(self._repo_path.parent)
                logger.info(f"Removed repo directory: {self._repo_path.parent}")
            except Exception as e:
                logger.warning(f"Failed to remove repo directory: {e}")
            self._repo_path = None


# Global target container manager instance
target_container_manager = TargetContainerManager()
