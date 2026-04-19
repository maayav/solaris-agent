"""
PentAGI-Style Executor REST API for Docker Container Management.

This module provides a REST API that the Executor agent uses to run
commands in isolated Docker containers with strict network restrictions.

PentAGI Pattern:
- Each tool run triggers: docker run --network=none --rm security-tool-image
- Network access restricted to specific target IP only
- No shared containers - fresh container per command
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from typing import Any
from dataclasses import dataclass

import docker
from docker.errors import NotFound, APIError

logger = logging.getLogger(__name__)

# Default sandbox image
SANDBOX_IMAGE = "vibecheck-sandbox:latest"


@dataclass
class ExecutionRequest:
    """Request to execute a command in an isolated container."""
    command: str
    tool_type: str  # 'nmap', 'nuclei', 'curl', 'python', etc.
    target_ip: str | None = None  # If provided, only this IP is accessible
    allowed_ports: list[int] | None = None
    timeout: int = 60
    workdir: str = "/workspace"


@dataclass
class ExecutionResult:
    """Result of command execution."""
    exit_code: int
    stdout: str
    stderr: str
    container_id: str
    execution_time: float
    timed_out: bool = False


class PentAGIExecutorAPI:
    """
    PentAGI-style executor that creates fresh containers per command.
    
    Key features:
    - Per-command container creation (--rm)
    - Network isolation (--network=none by default)
    - Target-specific egress rules (if target_ip provided)
    - No shared state between executions
    """
    
    def __init__(self):
        self._client: docker.DockerClient | None = None
        self._network_name = "pentagi-isolated-net"
    
    def _get_client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.from_env()
        return self._client
    
    async def execute(self, request: ExecutionRequest) -> ExecutionResult:
        """
        Execute a command in an isolated container.
        
        PentAGI Pattern:
        1. Create isolated network if target_ip specified
        2. Run container with --network=none (default) or restricted network
        3. Execute command
        4. Remove container (--rm behavior)
        """
        import time
        start_time = time.time()
        
        client = self._get_client()
        container = None
        
        try:
            # Prepare container configuration
            container_config = {
                "image": SANDBOX_IMAGE,
                "command": ["sh", "-c", request.command],
                "detach": True,
                "mem_limit": "1g",
                "cpu_quota": 100000,  # 1 CPU core
                "cpu_period": 100000,
                "cap_drop": ["ALL"],  # Drop all capabilities for security
                "cap_add": ["NET_RAW"],  # Only add back what we need
                "security_opt": ["no-new-privileges:true"],
                "read_only": False,  # Allow writing for exploit scripts
                "workdir": request.workdir,
            }
            
            # Network configuration
            if request.target_ip:
                # Create isolated network with target access
                network = await self._ensure_isolated_network(request.target_ip, request.allowed_ports)
                container_config["network"] = network.id
                logger.info(f"PentAGI Executor: Restricted network for target {request.target_ip}")
            else:
                # Complete network isolation
                container_config["network_disabled"] = True
                logger.info("PentAGI Executor: Network completely disabled")
            
            # Create and start container
            container = await asyncio.to_thread(client.containers.run, **container_config)
            
            # Wait for completion with timeout
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(container.wait),
                    timeout=request.timeout
                )
                timed_out = False
            except asyncio.TimeoutError:
                logger.warning(f"Command timed out after {request.timeout}s: {request.command[:50]}")
                await asyncio.to_thread(container.kill)
                timed_out = True
            
            # Get logs
            logs = await asyncio.to_thread(container.logs, stdout=True, stderr=True)
            stdout = logs.decode("utf-8", errors="replace") if logs else ""
            stderr = ""  # Docker combines stdout/stderr in logs
            
            # Get exit code
            container.reload()
            exit_code = container.attrs["State"]["ExitCode"]
            
            # Cleanup
            await asyncio.to_thread(container.remove, force=True)
            
            execution_time = time.time() - start_time
            
            return ExecutionResult(
                exit_code=-1 if timed_out else exit_code,
                stdout=stdout,
                stderr=stderr,
                container_id=container.id[:12],
                execution_time=execution_time,
                timed_out=timed_out
            )
            
        except Exception as e:
            logger.error(f"PentAGI Executor error: {e}")
            if container:
                try:
                    await asyncio.to_thread(container.remove, force=True)
                except:
                    pass
            
            return ExecutionResult(
                exit_code=-1,
                stdout="",
                stderr=str(e),
                container_id="",
                execution_time=time.time() - start_time,
                timed_out=False
            )
    
    async def _ensure_isolated_network(self, target_ip: str, allowed_ports: list[int] | None) -> Any:
        """
        Create an isolated Docker network with iptables rules restricting egress to target only.
        
        This implements the PentAGI pattern of restricting network access
        to only the specific target IP.
        """
        if allowed_ports is None:
            allowed_ports = [80, 443, 3000, 8080]
        
        client = self._get_client()
        network_name = f"pentagi-target-{target_ip.replace('.', '-')}"
        bridge_name = network_name[:15]  # Docker limits interface names to 15 chars
        
        try:
            # Try to get existing network
            network = client.networks.get(network_name)
            return network
        except NotFound:
            # Create new isolated network
            ipam_config = docker.types.IPAMConfig(
                pool_configs=[
                    docker.types.IPAMPool(
                        subnet="172.25.0.0/16",
                        gateway="172.25.0.1"
                    )
                ]
            )
            
            network = await asyncio.to_thread(
                client.networks.create,
                name=network_name,
                driver="bridge",
                internal=False,  # Allow external access but we filter with iptables
                ipam=ipam_config,
                options={
                    "com.docker.network.bridge.name": bridge_name,
                    "com.docker.network.bridge.enable_ip_masquerade": "true",
                }
            )
            
            # Wait a moment for the bridge to be created
            await asyncio.sleep(0.5)
            
            # Configure iptables rules to restrict egress to target only
            await self._configure_iptables_rules(bridge_name, target_ip, allowed_ports)
            
            logger.info(f"Created isolated network: {network_name} with egress restricted to {target_ip}")
            return network
    
    async def _configure_iptables_rules(self, bridge_name: str, target_ip: str, allowed_ports: list[int]):
        """
        Configure iptables FORWARD rules on the bridge to restrict egress to target only.
        
        Since Docker containers use the bridge interface, we need FORWARD chain rules:
        1. Allow DNS (UDP/TCP 53) for name resolution
        2. Allow established/related connections
        3. Allow egress to target_ip on allowed_ports
        4. Drop all other forwarded traffic
        """
        
        # Build iptables commands for the FORWARD chain
        # We target the specific bridge interface to only affect this network
        rules = []
        
        # Flush existing FORWARD rules for this bridge (be careful not to break other networks)
        # Instead of flushing all, we add rules with specific interface matching
        
        # Allow established/related connections (important for return traffic)
        rules.append(f"iptables -I FORWARD -o {bridge_name} -m state --state ESTABLISHED,RELATED -j ACCEPT")
        
        # Allow DNS from the bridge (UDP 53)
        rules.append(f"iptables -I FORWARD -i {bridge_name} -p udp --dport 53 -j ACCEPT")
        rules.append(f"iptables -I FORWARD -i {bridge_name} -p tcp --dport 53 -j ACCEPT")
        
        # Allow egress to specific target IP on allowed ports from the bridge
        for port in allowed_ports:
            rules.append(f"iptables -I FORWARD -i {bridge_name} -o eth0 -p tcp -d {target_ip} --dport {port} -j ACCEPT")
        
        # Allow ping for health checks from the bridge
        rules.append(f"iptables -I FORWARD -i {bridge_name} -p icmp --icmp-type echo-request -j ACCEPT")
        rules.append(f"iptables -I FORWARD -i {bridge_name} -p icmp --icmp-type echo-reply -j ACCEPT")
        
        # Drop all other forwarded traffic from the bridge (this is the isolation rule)
        rules.append(f"iptables -I FORWARD -i {bridge_name} -j DROP")
        
        # Apply rules in order
        full_command = " && ".join(rules)
        
        try:
            # Run iptables commands in a privileged container that shares host network namespace
            client = self._get_client()
            await asyncio.to_thread(
                client.containers.run,
                image="alpine:latest",
                command=["sh", "-c", f"apk add --no-cache iptables && {full_command}"],
                network_mode="host",
                privileged=True,
                remove=True,
                detach=False
            )
            logger.info(f"Configured iptables FORWARD rules for bridge {bridge_name}: target {target_ip} ports {allowed_ports}")
        except Exception as e:
            logger.error(f"Failed to configure iptables rules: {e}")
            # Log the error but don't fail - network will still work but without strict isolation
            logger.warning("Network created but without strict egress filtering")
    
    async def execute_script(self, script_content: str, language: str = "python", 
                           target_ip: str | None = None, timeout: int = 60) -> ExecutionResult:
        """
        Execute a script in an isolated container.
        
        This is used by the Developer agent to run generated exploit scripts.
        """
        # Write script to temp file
        import base64
        import tempfile
        import os
        
        ext = {"python": "py", "javascript": "js", "bash": "sh"}.get(language, "sh")
        encoded_script = base64.b64encode(script_content.encode()).decode()
        
        # Build command to decode and execute
        interpreter = {"python": "python3", "javascript": "node", "bash": "bash"}.get(language, "sh")
        command = f"echo '{encoded_script}' | base64 -d > /tmp/exploit.{ext} && {interpreter} /tmp/exploit.{ext}"
        
        request = ExecutionRequest(
            command=command,
            tool_type=language,
            target_ip=target_ip,
            timeout=timeout
        )
        
        return await self.execute(request)


# Singleton instance
pentagi_executor = PentAGIExecutorAPI()
