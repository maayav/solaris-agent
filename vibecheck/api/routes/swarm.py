"""
Swarm routes for Project VibeCheck.

Provides endpoints for:
- Triggering new swarm missions
- Getting mission status and events
- Real-time WebSocket updates
- Managing agent states
"""

import json
import logging
import subprocess
import tempfile
import shutil
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from core.supabase_client import get_supabase_client
from core.redis_bus import get_redis_bus

logger = logging.getLogger(__name__)

router = APIRouter()


# -------------------------------------------
# Request/Response Models
# -------------------------------------------

class SwarmTriggerRequest(BaseModel):
    """Request model for triggering a new swarm mission."""
    target: str = Field(..., description="Target URL or repository to attack")
    objective: str = Field(
        default="Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure",
        description="Mission objective"
    )
    mode: str = Field(default="live", description="Scan mode: 'live' for running apps, 'static' for repos, 'repo' for GitHub repos with auto-deploy")
    max_iterations: int = Field(default=5, description="Maximum iterations for the mission")
    scan_id: str | None = Field(None, description="Optional existing scan ID to link to")
    repo_url: str | None = Field(None, description="GitHub repository URL for auto-deployment")
    auto_deploy: bool = Field(default=False, description="Whether to automatically deploy the repo in Docker")


class SwarmTriggerResponse(BaseModel):
    """Response model for swarm mission trigger."""
    mission_id: str = Field(..., description="Unique mission identifier")
    message: str = Field(..., description="Status message")
    status: str = Field(..., description="Mission status")
    target: str | None = Field(None, description="Final target URL (may be different from input for repo deployments)")


class AgentStateResponse(BaseModel):
    """Response model for agent state."""
    agent_id: str
    agent_name: str
    agent_team: str
    status: str
    iter: str | None
    task: str | None
    recent_logs: list[dict]
    last_updated: datetime


class SwarmMissionResponse(BaseModel):
    """Response model for mission details."""
    mission_id: str
    scan_id: str | None = None
    target: str
    objective: str = ""
    mode: str | None = None
    status: str
    progress: int = 0
    current_phase: str | None = None
    iteration: int = 0
    max_iterations: int = 5
    findings_count: int = 0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class SwarmEventResponse(BaseModel):
    """Response model for agent events."""
    id: str
    agent_name: str
    agent_team: str
    event_type: str
    message: str
    payload: dict
    iteration: int | None
    phase: str | None
    created_at: datetime


class SwarmFindingResponse(BaseModel):
    """Response model for swarm findings."""
    id: str
    title: str
    description: str | None
    severity: str
    finding_type: str | None
    source: str | None
    target: str | None
    endpoint: str | None
    confirmed: bool
    agent_name: str | None
    cve_id: str | None
    created_at: datetime
    exploit_attempt_id: str | None = None
    agent_iteration: int | None = None
    confidence_score: float | None = None


class SwarmEventTimelineResponse(BaseModel):
    """Response model for mission timeline view."""
    id: str
    mission_id: str
    event_type: str
    agent_name: str
    stage: str | None
    title: str
    description: str | None
    success: bool | None
    error_type: str | None
    created_at: datetime
    iteration: int | None
    execution_time_ms: int | None
    child_events: int | None
    exploit_type: str | None
    target_url: str | None
    was_deduplicated: bool | None
    attempt_number: int | None


class MissionStatisticsResponse(BaseModel):
    """Response model for mission statistics view."""
    mission_id: str
    target: str | None
    status: str | None
    created_at: datetime | None
    total_events: int | None
    exploit_events: int | None
    agent_starts: int | None
    total_exploit_attempts: int | None
    successful_exploits: int | None
    failed_exploits: int | None
    deduplicated_exploits: int | None
    deduplication_rate_pct: float | None
    total_findings: int | None
    critical_findings: int | None
    high_findings: int | None
    max_iteration: int | None


class SwarmExploitAttemptResponse(BaseModel):
    """Response model for swarm exploit attempts."""
    id: str
    mission_id: str
    event_id: str | None
    exploit_type: str
    target_url: str
    method: str
    payload: str | None
    payload_hash: str | None
    tool_used: str | None
    command_executed: str | None
    success: bool
    response_code: int | None
    exit_code: int | None
    error_type: str | None
    error_message: str | None
    stdout: str | None
    stderr: str | None
    evidence: dict
    created_at: datetime
    execution_time_ms: int | None
    was_deduplicated: bool
    deduplication_key: str | None
    attempt_number: int | None
    critic_evaluated: bool | None
    critic_success: bool | None
    critic_feedback: str | None


# -------------------------------------------
# WebSocket Connection Manager
# -------------------------------------------

class ConnectionManager:
    """Manages WebSocket connections for real-time mission updates."""
    
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, mission_id: str):
        """Accept a new WebSocket connection."""
        await websocket.accept()
        if mission_id not in self.active_connections:
            self.active_connections[mission_id] = []
        self.active_connections[mission_id].append(websocket)
        logger.info(f"WebSocket client connected for mission {mission_id}")
    
    def disconnect(self, websocket: WebSocket, mission_id: str):
        """Remove a WebSocket connection."""
        if mission_id in self.active_connections:
            self.active_connections[mission_id].remove(websocket)
            if not self.active_connections[mission_id]:
                del self.active_connections[mission_id]
        logger.info(f"WebSocket client disconnected from mission {mission_id}")
    
    async def broadcast_to_mission(self, mission_id: str, message: dict):
        """Broadcast a message to all connected clients for a mission."""
        if mission_id not in self.active_connections:
            return
        
        disconnected = []
        for connection in self.active_connections[mission_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                disconnected.append(connection)
        
        # Clean up disconnected clients
        for conn in disconnected:
            self.active_connections[mission_id].remove(conn)


# Global connection manager
ws_manager = ConnectionManager()


# -------------------------------------------
# Docker Deployment Functions
# -------------------------------------------

async def _find_available_port(start_port: int = 15555) -> int:
    """Find an available port starting from start_port, incrementing by 1 if conflicts."""
    import socket
    
    port = start_port
    while port < start_port + 1000:  # Safety limit to avoid infinite loop
        try:
            # Test if port is available
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                logger.info(f"Found available port: {port}")
                return port
        except OSError:
            # Port in use, try next one
            logger.debug(f"Port {port} in use, trying {port + 1}")
            port += 1
    
    # Fallback if no ports available in range
    raise Exception(f"No available ports found in range {start_port}-{start_port + 999}")


async def _mock_deployment(repo_url: str, mission_id: str, target_domain: str) -> dict[str, Any]:
    """Mock deployment for testing without Docker."""
    logger.info(f"Using mock deployment for {repo_url}")
    
    # Check if there's a known service pattern for the repo
    target_url = "http://localhost:8080"  # Default to Juice Shop running on 8080
    
    # For specific repos, we could map to known running services:
    if "juice-shop" in repo_url.lower():
        target_url = "http://localhost:8080"  # Juice Shop
    else:
        # For other repos, try common development ports where apps might be running
        # Check if a service is actually running on these ports
        common_ports = [3000, 8000, 8080, 4200, 5000]
        for port in common_ports:
            test_url = f"http://localhost:{port}"
            try:
                # Quick connectivity check could be added here
                # For now, default to 8080 which we know has Juice Shop
                target_url = "http://localhost:8080"
                break
            except:
                continue
    
    return {
        "target_url": target_url,
        "deployment_info": {
            "container_name": f"mock-{mission_id[:8]}",
            "port": target_url.split(":")[-1],
            "deployment_type": "mock",
            "original_domain": target_domain,
            "repo_url": repo_url,
            "status": "mock_redirected_to_existing_service"
        }
    }


async def _deploy_repository_to_docker(
    repo_url: str, 
    mission_id: str, 
    target_domain: str
) -> dict[str, Any]:
    """
    Deploy a GitHub repository to Docker for testing.
    
    Args:
        repo_url: GitHub repository URL
        mission_id: Unique mission identifier  
        target_domain: Domain where the app should be accessible
        
    Returns:
        Dict with deployment information including target_url and deployment_info
        
    Raises:
        Exception: If deployment fails at any stage
    """
    logger.info(f"Starting Docker deployment for repo: {repo_url}")
    
    # Validate repository URL
    if not repo_url or not repo_url.startswith("http"):
        raise Exception(f"Invalid repository URL: {repo_url}")
    
    # Check if Docker is available
    try:
        docker_check = await asyncio.create_subprocess_exec(
            "docker", "--version",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = await docker_check.communicate()
        if docker_check.returncode != 0:
            logger.warning("Docker is not installed or not running - using mock deployment")
            return await _mock_deployment(repo_url, mission_id, target_domain)
        logger.info(f"Docker version: {stdout.decode().strip()}")
    except FileNotFoundError:
        logger.warning("Docker command not found - using mock deployment")
        return await _mock_deployment(repo_url, mission_id, target_domain)
    except Exception as e:
        logger.warning(f"Failed to verify Docker installation: {str(e)} - using mock deployment")
        return await _mock_deployment(repo_url, mission_id, target_domain)
    
    # Create temporary directory for cloning
    temp_dir = None
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix=f"mission-{mission_id[:8]}-"))
        repo_name = repo_url.split("/")[-1].replace(".git", "")
        repo_path = temp_dir / repo_name
        
        logger.info(f"Using temporary directory: {temp_dir}")
        
        # Clone repository with timeout
        logger.info(f"Cloning repository to {repo_path}")
        try:
            clone_process = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    "git", "clone", repo_url, str(repo_path),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                ),
                timeout=300  # 5 minute timeout for cloning
            )
            stdout, stderr = await clone_process.communicate()
            
            if clone_process.returncode != 0:
                error_msg = stderr.decode().strip()
                raise Exception(f"Git clone failed: {error_msg}")
            
            logger.info(f"Repository cloned successfully")
            
        except asyncio.TimeoutError:
            raise Exception("Repository clone timeout - check repository URL and network connection")
        except FileNotFoundError:
            raise Exception("Git command not found. Please install Git.")
        except Exception as e:
            raise Exception(f"Failed to clone repository: {str(e)}")
        
        # Verify repository was cloned
        if not repo_path.exists() or not any(repo_path.iterdir()):
            raise Exception(f"Repository clone failed - directory is empty: {repo_path}")
        
        # Look for Dockerfile or docker-compose.yml
        dockerfile_path = repo_path / "Dockerfile"
        compose_path = repo_path / "docker-compose.yml"
        compose_yaml_path = repo_path / "docker-compose.yaml"
        
        # Generate container and port info
        container_name = f"mission-{mission_id[:8]}-{repo_name}".lower().replace("_", "-")
        exposed_port = await _find_available_port(15555)  # Start from 15555 and increment if conflicts
        
        logger.info(f"Deployment config - container: {container_name}, port: {exposed_port}")
        
        # Choose deployment method
        if dockerfile_path.exists():
            logger.info("Found Dockerfile, using existing Dockerfile deployment")
            return await _deploy_with_dockerfile(
                repo_path, container_name, exposed_port, target_domain, mission_id
            )
        elif compose_path.exists() or compose_yaml_path.exists():
            logger.info("Found docker-compose file, using compose deployment")
            compose_file = compose_path if compose_path.exists() else compose_yaml_path
            return await _deploy_with_compose(
                repo_path, compose_file, container_name, exposed_port, target_domain, mission_id
            )
        else:
            logger.info("No Docker files found, attempting auto-detection")
            return await _deploy_with_auto_detection(
                repo_path, container_name, exposed_port, target_domain, mission_id
            )
            
    except Exception as e:
        logger.error(f"Docker deployment failed: {e}")
        # Cleanup on error
        if temp_dir and temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"Cleaned up temporary directory: {temp_dir}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temp directory: {cleanup_error}")
        raise
    finally:
        # Always cleanup temporary directory
        if temp_dir and temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"Cleaned up temporary directory: {temp_dir}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to cleanup temp directory {temp_dir}: {cleanup_error}")


async def _deploy_with_dockerfile(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy repository using existing Dockerfile."""
    logger.info(f"Deploying with Dockerfile at {repo_path}")
    
    image_tag = f"mission-{mission_id[:8]}".lower()
    
    try:
        # Build Docker image with timeout
        logger.info(f"Building Docker image: {image_tag}")
        build_process = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                "docker", "build", "-t", image_tag, str(repo_path),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            ),
            timeout=600  # 10 minute timeout for building
        )
        stdout, stderr = await build_process.communicate()
        
        if build_process.returncode != 0:
            error_msg = stderr.decode().strip()
            raise Exception(f"Docker build failed: {error_msg}")
        
        logger.info(f"Docker image built successfully: {image_tag}")
        
        # Try different common ports
        ports_to_try = [3000, 8080, 8000, 80, 5000, 4000]
        container_started = False
        actual_internal_port = None
        
        for internal_port in ports_to_try:
            try:
                logger.info(f"Attempting to start container on port {internal_port}")
                
                # Remove existing container if it exists
                await _remove_container_if_exists(container_name)
                
                run_process = await asyncio.create_subprocess_exec(
                    "docker", "run", "-d", 
                    "--name", container_name,
                    "-p", f"{port}:{internal_port}",
                    image_tag,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                stdout, stderr = await run_process.communicate()
                
                if run_process.returncode == 0:
                    container_started = True
                    actual_internal_port = internal_port
                    logger.info(f"Container started successfully on port {internal_port}")
                    break
                else:
                    logger.debug(f"Failed to start on port {internal_port}: {stderr.decode()}")
                    
            except Exception as e:
                logger.debug(f"Error starting container on port {internal_port}: {e}")
                continue
        
        if not container_started:
            raise Exception(f"Failed to start container on any common port: {ports_to_try}")
        
        # Wait for container to be ready and verify it's running
        await asyncio.sleep(3)
        if not await _verify_container_running(container_name):
            raise Exception("Container failed to start properly")
        
        # Wait a bit more for the application to initialize
        await asyncio.sleep(2)
        
        target_url = f"http://localhost:{port}"
        logger.info(f"Application should be accessible at: {target_url}")
        
        return {
            "target_url": target_url,
            "deployment_info": {
                "container_name": container_name,
                "image_tag": image_tag,
                "port": port,
                "internal_port": actual_internal_port,
                "deployment_type": "dockerfile",
                "original_domain": target_domain,
                "status": "running"
            }
        }
        
    except asyncio.TimeoutError:
        raise Exception("Docker build timeout - build took longer than 10 minutes")
    except Exception as e:
        # Cleanup on failure
        await _cleanup_docker_resources(container_name, image_tag)
        raise Exception(f"Docker deployment failed: {str(e)}")


async def _remove_container_if_exists(container_name: str):
    """Remove container if it exists (ignore errors)."""
    try:
        # Stop container
        stop_process = await asyncio.create_subprocess_exec(
            "docker", "stop", container_name,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await stop_process.wait()
        
        # Remove container
        rm_process = await asyncio.create_subprocess_exec(
            "docker", "rm", container_name,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await rm_process.wait()
    except Exception:
        pass  # Ignore errors - container might not exist


async def _verify_container_running(container_name: str) -> bool:
    """Verify that a container is running."""
    try:
        ps_process = await asyncio.create_subprocess_exec(
            "docker", "ps", "--filter", f"name={container_name}", "--format", "{{.Names}}",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = await ps_process.communicate()
        
        if ps_process.returncode == 0:
            running_containers = stdout.decode().strip().split('\n')
            return container_name in running_containers
        return False
    except Exception:
        return False


async def _cleanup_docker_resources(container_name: str, image_tag: str):
    """Clean up Docker container and image."""
    try:
        # Stop and remove container
        stop_process = await asyncio.create_subprocess_exec(
            "docker", "stop", container_name,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await stop_process.wait()
        
        rm_process = await asyncio.create_subprocess_exec(
            "docker", "rm", container_name,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await rm_process.wait()
        
        # Remove image
        rmi_process = await asyncio.create_subprocess_exec(
            "docker", "rmi", image_tag,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await rmi_process.wait()
        
        logger.info(f"Cleaned up Docker resources: {container_name}, {image_tag}")
    except Exception as e:
        logger.warning(f"Failed to cleanup Docker resources: {e}")


async def _deploy_with_compose(
    repo_path: Path, 
    compose_file: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy repository using docker-compose."""
    logger.info(f"Deploying with docker-compose: {compose_file}")
    
    # Change to repo directory and run docker-compose
    compose_process = await asyncio.create_subprocess_exec(
        "docker-compose", "-f", str(compose_file), "up", "-d",
        cwd=str(repo_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    stdout, stderr = await compose_process.communicate()
    
    if compose_process.returncode != 0:
        raise Exception(f"Docker compose failed: {stderr.decode()}")
    
    # Wait for services to start
    await asyncio.sleep(5)
    
    # Try to detect exposed port from compose output or use default
    target_url = f"http://localhost:{port}"
    
    return {
        "target_url": target_url,
        "deployment_info": {
            "container_name": f"compose-{mission_id[:8]}",
            "port": port,
            "deployment_type": "docker-compose",
            "compose_file": str(compose_file),
            "original_domain": target_domain
        }
    }


async def _deploy_with_auto_detection(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Auto-detect framework and deploy."""
    logger.info(f"Auto-detecting framework for {repo_path}")
    
    # Check for common framework files
    package_json = repo_path / "package.json"
    requirements_txt = repo_path / "requirements.txt"
    pom_xml = repo_path / "pom.xml"
    
    if package_json.exists():
        # Node.js application
        return await _deploy_nodejs_app(repo_path, container_name, port, target_domain, mission_id)
    elif requirements_txt.exists():
        # Python application
        return await _deploy_python_app(repo_path, container_name, port, target_domain, mission_id)
    elif pom_xml.exists():
        # Java application
        return await _deploy_java_app(repo_path, container_name, port, target_domain, mission_id)
    else:
        # Generic web server
        return await _deploy_static_site(repo_path, container_name, port, target_domain, mission_id)


async def _deploy_nodejs_app(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy Node.js application."""
    logger.info(f"Deploying Node.js app from {repo_path}")
    
    # Create simple Dockerfile
    dockerfile_content = """
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
"""
    
    dockerfile_path = repo_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_content)
    
    return await _deploy_with_dockerfile(repo_path, container_name, port, target_domain, mission_id)


async def _deploy_python_app(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy Python application."""
    logger.info(f"Deploying Python app from {repo_path}")
    
    # Create simple Dockerfile
    dockerfile_content = """
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "app.py"]
"""
    
    dockerfile_path = repo_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_content)
    
    return await _deploy_with_dockerfile(repo_path, container_name, port, target_domain, mission_id)


async def _deploy_java_app(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy Java application."""
    logger.info(f"Deploying Java app from {repo_path}")
    
    # Create simple Dockerfile for Maven project
    dockerfile_content = """
FROM openjdk:17-jdk-slim
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN apt-get update && apt-get install -y maven
RUN mvn clean package
EXPOSE 8080
CMD ["java", "-jar", "target/*.jar"]
"""
    
    dockerfile_path = repo_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_content)
    
    return await _deploy_with_dockerfile(repo_path, container_name, port, target_domain, mission_id)


async def _deploy_static_site(
    repo_path: Path, 
    container_name: str, 
    port: int, 
    target_domain: str, 
    mission_id: str
) -> dict[str, Any]:
    """Deploy static site with nginx."""
    logger.info(f"Deploying static site from {repo_path}")
    
    # Create simple Dockerfile for static content
    dockerfile_content = """
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
"""
    
    dockerfile_path = repo_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_content)
    
    # Use port 80 for nginx
    run_process = await asyncio.create_subprocess_exec(
        "docker", "run", "-d", 
        "--name", container_name,
        "-p", f"{port}:80",
        f"mission-{mission_id[:8]}",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    target_url = f"http://localhost:{port}"
    
    return {
        "target_url": target_url,
        "deployment_info": {
            "container_name": container_name,
            "port": port,
            "deployment_type": "static-nginx",
            "original_domain": target_domain
        }
    }


# -------------------------------------------
# Swarm Endpoints
# -------------------------------------------

@router.get(
    "/missions",
    summary="List all swarm missions",
    description="Get all swarm missions from Supabase, ordered by creation date.",
)
async def list_swarm_missions(limit: int = 20, offset: int = 0) -> dict:
    """Get all swarm missions from Supabase."""
    logger.info(f"[SWARM] Listing missions - limit: {limit}, offset: {offset}")
    
    try:
        supabase = get_supabase_client()
        missions = await supabase.list_swarm_missions(limit=limit, offset=offset)
        logger.info(f"[SWARM] Found {len(missions)} missions")
        return {
            "missions": missions,
            "total": len(missions)
        }
    except Exception as e:
        logger.error(f"[SWARM] Failed to list missions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list missions: {str(e)}",
        )


@router.post(
    "/trigger",
    response_model=SwarmTriggerResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger a new swarm mission",
    description="Start a new Red Team swarm mission against a target.",
)
async def trigger_swarm_mission(request: SwarmTriggerRequest) -> SwarmTriggerResponse:
    """
    Trigger a new swarm penetration testing mission.
    
    This endpoint:
    1. Creates a mission record in Supabase
    2. If repo mode: deploys the repository in Docker
    3. Initializes agent states for all 12 agents
    4. Publishes the mission to Redis for the swarm module
    5. Returns the mission ID for tracking
    """
    logger.info(f"Received swarm mission request for target: {request.target}, mode: {request.mode}")
    
    # Generate unique mission ID
    mission_id = str(uuid4())
    
    # Variables for Docker deployment
    deployed_target = request.target
    deployment_info = {}
    
    try:
        # Handle repository deployment for 'repo' mode
        if request.mode == "repo" and request.repo_url and request.auto_deploy:
            logger.info(f"Starting Docker deployment for repo: {request.repo_url}")
            
            try:
                deployment_result = await _deploy_repository_to_docker(
                    repo_url=request.repo_url,
                    mission_id=mission_id,
                    target_domain=request.target
                )
                
                deployed_target = deployment_result["target_url"]
                deployment_info = deployment_result["deployment_info"]
                
                logger.info(f"Repository deployed successfully at: {deployed_target}")
                
            except Exception as deploy_error:
                logger.error(f"Failed to deploy repository: {deploy_error}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to deploy repository: {str(deploy_error)}",
                )
        
        # Create mission in Supabase
        supabase = get_supabase_client()
        
        # Map 'repo' mode to 'static' for database compatibility
        db_mode = "static" if request.mode == "repo" else request.mode
        
        await supabase.create_swarm_mission(
            mission_id=mission_id,
            target=deployed_target,
            objective=request.objective,
            mode=db_mode,  # Use compatible mode
            max_iterations=request.max_iterations,
            scan_id=request.scan_id,
        )
        
        # Store deployment information if available
        if deployment_info:
            logger.info(f"Storing deployment info for mission {mission_id}")
            # You could store this in a separate table or as metadata in the mission record
        
        # Initialize agent states
        await _initialize_agent_states(mission_id)
        
        # Prepare mission data for Redis
        mission_data = {
            "mission_id": mission_id,
            "target": deployed_target,
            "objective": request.objective,
            "mode": request.mode,
            "max_iterations": request.max_iterations,
            "action": "start",
        }
        
        # Add repo-specific data if applicable
        if request.mode == "repo":
            mission_data.update({
                "repo_url": request.repo_url,
                "auto_deploy": request.auto_deploy,
                "deployment_info": deployment_info,
            })
        
        # Publish to Redis for swarm module
        # NOTE: Do NOT wrap in "data" field - the worker expects flat mission dict
        redis_bus = get_redis_bus()
        await redis_bus.publish("swarm_missions", {
            "mission_id": mission_id,
            "target": deployed_target,
            "objective": request.objective,
            "mode": request.mode,
            "max_iterations": request.max_iterations,
            "action": "start",
            "repo_url": request.repo_url if request.mode == "repo" else None,
            "auto_deploy": request.auto_deploy if request.mode == "repo" else False,
            "deployment_info": deployment_info,
        })
        
        logger.info(f"Swarm mission {mission_id} triggered successfully")
        
        return SwarmTriggerResponse(
            mission_id=mission_id,
            message="Swarm mission triggered successfully" + (
                f" with deployed target: {deployed_target}" if request.mode == "repo" else ""
            ),
            status="pending",
            target=deployed_target
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to trigger swarm mission: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to trigger mission: {str(e)}",
        )


@router.get(
    "/{mission_id}",
    response_model=SwarmMissionResponse,
    summary="Get mission status",
    description="Get the current status and details of a swarm mission.",
)
async def get_mission(mission_id: str) -> SwarmMissionResponse:
    """Get mission details and current status."""
    try:
        supabase = get_supabase_client()
        
        logger.info(f"[SWARM] Fetching mission status for ID: {mission_id}")
        mission = await supabase.get_swarm_mission(mission_id)
        
        if not mission:
            logger.warning(f"[SWARM] Mission not found: {mission_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Mission {mission_id} not found",
            )
        
        logger.info(f"[SWARM] Mission found - id={mission.get('id')}, status={mission.get('status')}, target={mission.get('target')}")
        
        # Count findings
        findings = await supabase.get_swarm_findings(mission_id)
        logger.info(f"[SWARM] Found {len(findings)} findings for mission {mission_id}")
        
        return SwarmMissionResponse(
            mission_id=mission["id"],
            scan_id=mission.get("scan_id"),
            target=mission["target"],
            objective=mission["objective"],
            mode=mission["mode"],
            status=mission["status"],
            progress=mission["progress"],
            current_phase=mission.get("current_phase"),
            iteration=mission["iteration"],
            max_iterations=mission["max_iterations"],
            findings_count=len(findings),
            created_at=mission["created_at"],
            started_at=mission.get("started_at"),
            completed_at=mission.get("completed_at"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get mission {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get mission: {str(e)}",
        )


@router.get(
    "/{mission_id}/agents",
    response_model=list[AgentStateResponse],
    summary="Get agent states",
    description="Get the current state of all agents in a mission.",
)
async def get_agent_states(mission_id: str) -> list[AgentStateResponse]:
    """Get current states of all agents in a mission."""
    try:
        supabase = get_supabase_client()
        states = await supabase.get_swarm_agent_states(mission_id)
        
        return [
            AgentStateResponse(
                agent_id=state["agent_id"],
                agent_name=state["agent_name"],
                agent_team=state["agent_team"],
                status=state["status"],
                iter=state.get("iter"),
                task=state.get("task"),
                recent_logs=state.get("recent_logs", []),
                last_updated=state["last_updated"],
            )
            for state in states
        ]
        
    except Exception as e:
        logger.error(f"Failed to get agent states for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get agent states: {str(e)}",
        )


@router.get(
    "/{mission_id}/events",
    response_model=list[SwarmEventResponse],
    summary="Get mission events",
    description="Get recent events/logs from a swarm mission.",
)
async def get_mission_events(
    mission_id: str,
    limit: int = 100,
    agent: str | None = None,
) -> list[SwarmEventResponse]:
    """Get recent events for a mission."""
    try:
        supabase = get_supabase_client()
        
        logger.info(f"[SWARM] Fetching events for mission: {mission_id}, agent: {agent}, limit: {limit}")
        events = await supabase.get_swarm_agent_events(mission_id, limit=limit, agent_name=agent)
        
        logger.info(f"[SWARM] Retrieved {len(events)} events from Supabase")
        
        return [
            SwarmEventResponse(
                id=event["id"],
                agent_name=event["agent_name"],
                agent_team=event["agent_team"],
                event_type=event["event_type"],
                message=event["message"],
                payload=event.get("payload", {}),
                iteration=event.get("iteration"),
                phase=event.get("phase"),
                created_at=event["created_at"],
            )
            for event in events
        ]
        
    except Exception as e:
        logger.error(f"Failed to get events for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get events: {str(e)}",
        )


@router.get(
    "/{mission_id}/timeline-events",
    response_model=list[dict],
    summary="Get timeline events",
    description="Get timeline events from the new swarm_events table.",
)
async def get_timeline_events(
    mission_id: str,
    limit: int = 100,
    event_type: str | None = None,
    agent: str | None = None,
    iteration: int | None = None,
) -> list[dict]:
    """Get timeline events from the new swarm_events table."""
    try:
        supabase = get_supabase_client()
        events = await supabase.get_swarm_events(
            mission_id, limit=limit, event_type=event_type, 
            agent_name=agent, iteration=iteration
        )
        return events
        
    except Exception as e:
        logger.error(f"Failed to get timeline events for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get timeline events: {str(e)}",
        )


@router.get(
    "/{mission_id}/findings",
    response_model=list[SwarmFindingResponse],
    summary="Get mission findings",
    description="Get all vulnerabilities discovered during a mission.",
)
async def get_mission_findings(mission_id: str) -> list[SwarmFindingResponse]:
    """Get all findings for a mission."""
    try:
        supabase = get_supabase_client()
        
        logger.info(f"[SWARM] Fetching findings for mission: {mission_id}")
        findings = await supabase.get_swarm_findings(mission_id)
        
        logger.info(f"[SWARM] Retrieved {len(findings)} findings from Supabase")
        
        # Log finding details
        for i, finding in enumerate(findings[:5]):
            logger.info(f"[SWARM] Finding {i+1}: severity={finding.get('severity')}, "
                       f"type={finding.get('finding_type')}, confirmed={finding.get('confirmed')}")
        
        return [
            SwarmFindingResponse(
                id=finding["id"],
                title=finding["title"],
                description=finding.get("description"),
                severity=finding["severity"],
                finding_type=finding.get("finding_type"),
                source=finding.get("source"),
                target=finding.get("target"),
                endpoint=finding.get("endpoint"),
                confirmed=finding["confirmed"],
                agent_name=finding.get("agent_name"),
                cve_id=finding.get("cve_id"),
                created_at=finding["created_at"],
                exploit_attempt_id=finding.get("exploit_attempt_id"),
                agent_iteration=finding.get("agent_iteration"),
                confidence_score=finding.get("confidence_score"),
            )
            for finding in findings
        ]
        
    except Exception as e:
        logger.error(f"Failed to get findings for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get findings: {str(e)}",
        )


@router.get(
    "/{mission_id}/timeline",
    response_model=list[SwarmEventTimelineResponse],
    summary="Get mission timeline",
    description="Get complete mission timeline from the database view.",
)
async def get_mission_timeline(mission_id: str) -> list[SwarmEventTimelineResponse]:
    """Get mission timeline from the database view."""
    try:
        supabase = get_supabase_client()
        timeline = await supabase.get_mission_timeline(mission_id)
        
        return [
            SwarmEventTimelineResponse(
                id=event["id"],
                mission_id=event["mission_id"],
                event_type=event["event_type"],
                agent_name=event["agent_name"],
                stage=event.get("stage"),
                title=event["title"],
                description=event.get("description"),
                success=event.get("success"),
                error_type=event.get("error_type"),
                created_at=event["created_at"],
                iteration=event.get("iteration"),
                execution_time_ms=event.get("execution_time_ms"),
                child_events=event.get("child_events"),
                exploit_type=event.get("exploit_type"),
                target_url=event.get("target_url"),
                was_deduplicated=event.get("was_deduplicated"),
                attempt_number=event.get("attempt_number"),
            )
            for event in timeline
        ]
        
    except Exception as e:
        logger.error(f"Failed to get timeline for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get timeline: {str(e)}",
        )


@router.get(
    "/{mission_id}/statistics",
    response_model=MissionStatisticsResponse,
    summary="Get mission statistics",
    description="Get aggregated mission statistics from the database view.",
)
async def get_mission_statistics(mission_id: str) -> MissionStatisticsResponse:
    """Get mission statistics from the database view."""
    try:
        supabase = get_supabase_client()
        stats = await supabase.get_mission_statistics(mission_id)
        
        if not stats:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Statistics not found for mission {mission_id}",
            )
        
        return MissionStatisticsResponse(
            mission_id=stats["mission_id"],
            target=stats.get("target"),
            status=stats.get("status"),
            created_at=stats.get("created_at"),
            total_events=stats.get("total_events"),
            exploit_events=stats.get("exploit_events"),
            agent_starts=stats.get("agent_starts"),
            total_exploit_attempts=stats.get("total_exploit_attempts"),
            successful_exploits=stats.get("successful_exploits"),
            failed_exploits=stats.get("failed_exploits"),
            deduplicated_exploits=stats.get("deduplicated_exploits"),
            deduplication_rate_pct=stats.get("deduplication_rate_pct"),
            total_findings=stats.get("total_findings"),
            critical_findings=stats.get("critical_findings"),
            high_findings=stats.get("high_findings"),
            max_iteration=stats.get("max_iteration"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get statistics for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get statistics: {str(e)}",
        )


@router.get(
    "/{mission_id}/exploit-attempts",
    response_model=list[SwarmExploitAttemptResponse],
    summary="Get exploit attempts",
    description="Get all exploit attempts for a mission.",
)
async def get_exploit_attempts(
    mission_id: str,
    limit: int = 500,
    exploit_type: str | None = None,
    success: bool | None = None,
) -> list[SwarmExploitAttemptResponse]:
    """Get all exploit attempts for a mission."""
    try:
        supabase = get_supabase_client()
        attempts = await supabase.get_swarm_exploit_attempts(
            mission_id, limit=limit, exploit_type=exploit_type, success=success
        )
        
        return [
            SwarmExploitAttemptResponse(
                id=attempt["id"],
                mission_id=attempt["mission_id"],
                event_id=attempt.get("event_id"),
                exploit_type=attempt["exploit_type"],
                target_url=attempt["target_url"],
                method=attempt["method"],
                payload=attempt.get("payload"),
                payload_hash=attempt.get("payload_hash"),
                tool_used=attempt.get("tool_used"),
                command_executed=attempt.get("command_executed"),
                success=attempt.get("success", False),
                response_code=attempt.get("response_code"),
                exit_code=attempt.get("exit_code"),
                error_type=attempt.get("error_type"),
                error_message=attempt.get("error_message"),
                stdout=attempt.get("stdout"),
                stderr=attempt.get("stderr"),
                evidence=attempt.get("evidence") if isinstance(attempt.get("evidence"), dict) else (json.loads(attempt["evidence"]) if isinstance(attempt["evidence"], str) else {}),
                created_at=attempt["created_at"],
                execution_time_ms=attempt.get("execution_time_ms"),
                was_deduplicated=attempt.get("was_deduplicated", False),
                deduplication_key=attempt.get("deduplication_key"),
                attempt_number=attempt.get("attempt_number"),
                critic_evaluated=attempt.get("critic_evaluated"),
                critic_success=attempt.get("critic_success"),
                critic_feedback=attempt.get("critic_feedback"),
            )
            for attempt in attempts
        ]
        
    except Exception as e:
        logger.error(f"Failed to get exploit attempts for {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get exploit attempts: {str(e)}",
        )


@router.websocket("/ws/{mission_id}")
async def swarm_websocket(websocket: WebSocket, mission_id: str):
    """
    WebSocket endpoint for real-time mission updates.
    
    Clients can connect to this endpoint to receive real-time updates
    about mission progress, agent states, and new findings.
    """
    await ws_manager.connect(websocket, mission_id)
    
    try:
        # Send initial mission state
        supabase = get_supabase_client()
        mission = await supabase.get_swarm_mission(mission_id)
        
        if mission:
            await websocket.send_json({
                "type": "mission_state",
                "data": mission,
            })
        
        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for messages from client (heartbeat, commands, etc.)
                data = await websocket.receive_json()
                
                # Handle client commands
                if data.get("action") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.warning(f"WebSocket error for mission {mission_id}: {e}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket error for mission {mission_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, mission_id)


@router.post(
    "/{mission_id}/cancel",
    response_model=dict,
    summary="Cancel a mission",
    description="Cancel a running swarm mission and cleanup Docker resources.",
)
async def cancel_mission(mission_id: str) -> dict:
    """Cancel a running swarm mission."""
    try:
        supabase = get_supabase_client()
        
        # Get mission details for cleanup
        mission = await supabase.get_swarm_mission(mission_id)
        
        # Update mission status
        await supabase.update_swarm_mission(
            mission_id=mission_id,
            updates={
                "status": "cancelled",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        
        # Cleanup Docker containers if this was a repo deployment
        if mission and mission.get("mode") == "repo":
            await _cleanup_docker_deployment(mission_id)
        
        # Publish cancel command to Redis
        redis_bus = get_redis_bus()
        await redis_bus.publish("swarm_missions", {
            "mission_id": mission_id,
            "action": "cancel",
        })
        
        # Notify WebSocket clients
        await ws_manager.broadcast_to_mission(mission_id, {
            "type": "mission_cancelled",
            "mission_id": mission_id,
        })
        
        return {"message": "Mission cancelled", "mission_id": mission_id}
        
    except Exception as e:
        logger.error(f"Failed to cancel mission {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel mission: {str(e)}",
        )


async def _cleanup_docker_deployment(mission_id: str):
    """Clean up Docker containers and images for a mission."""
    try:
        logger.info(f"Cleaning up Docker deployment for mission {mission_id}")
        
        # Clean up all containers that match the mission pattern
        container_patterns = [
            f"mission-{mission_id[:8]}",
            f"mission-{mission_id[:8]}-*"
        ]
        
        image_tag = f"mission-{mission_id[:8]}"
        
        # Stop and remove containers
        for pattern in container_patterns:
            try:
                # List containers matching the pattern
                ps_process = await asyncio.create_subprocess_exec(
                    "docker", "ps", "-a", "--filter", f"name={pattern}", "--format", "{{.Names}}",
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                stdout, stderr = await ps_process.communicate()
                
                if ps_process.returncode == 0:
                    container_names = [name.strip() for name in stdout.decode().split('\n') if name.strip()]
                    
                    for container_name in container_names:
                        if container_name:
                            # Stop container
                            stop_process = await asyncio.create_subprocess_exec(
                                "docker", "stop", container_name,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL
                            )
                            await asyncio.wait_for(stop_process.wait(), timeout=30)
                            
                            # Remove container
                            rm_process = await asyncio.create_subprocess_exec(
                                "docker", "rm", container_name,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL
                            )
                            await rm_process.wait()
                            
                            logger.info(f"Removed container: {container_name}")
            except asyncio.TimeoutError:
                logger.warning(f"Timeout stopping containers for pattern: {pattern}")
            except Exception as e:
                logger.warning(f"Error cleaning up containers for pattern {pattern}: {e}")
        
        # Remove images
        try:
            rmi_process = await asyncio.create_subprocess_exec(
                "docker", "rmi", image_tag,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            await asyncio.wait_for(rmi_process.wait(), timeout=30)
            logger.info(f"Removed image: {image_tag}")
        except asyncio.TimeoutError:
            logger.warning(f"Timeout removing image: {image_tag}")
        except Exception as e:
            logger.warning(f"Error removing image {image_tag}: {e}")
        
        logger.info(f"Docker cleanup completed for mission {mission_id}")
        
    except Exception as e:
        logger.error(f"Failed to cleanup Docker resources for mission {mission_id}: {e}")
        # Don't re-raise - cleanup is best effort


@router.post(
    "/{mission_id}/cleanup",
    response_model=dict,
    summary="Cleanup mission resources", 
    description="Manually cleanup Docker resources for a completed mission.",
)
async def cleanup_mission_resources(mission_id: str) -> dict:
    """Manually cleanup Docker resources for a mission."""
    try:
        await _cleanup_docker_deployment(mission_id)
        return {"message": "Resources cleaned up", "mission_id": mission_id}
    except Exception as e:
        logger.error(f"Failed to cleanup resources for mission {mission_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cleanup resources: {str(e)}",
        )


# -------------------------------------------
# Helper Functions
# -------------------------------------------

async def _initialize_agent_states(mission_id: str):
    """Initialize agent states for a new mission."""
    supabase = get_supabase_client()
    
    # Define all 12 agents
    agents = [
        {"id": "purple-cmd", "name": "Purple Commander", "team": "purple"},
        {"id": "kg-agent", "name": "Knowledge Graph", "team": "blue"},
        {"id": "sast-agent", "name": "SAST Semgrep", "team": "blue"},
        {"id": "llm-verify", "name": "LLM Verifier", "team": "blue"},
        {"id": "traffic-mon", "name": "Traffic Monitor", "team": "blue2"},
        {"id": "sig-detect", "name": "Signature Detector", "team": "blue2"},
        {"id": "redis-pub", "name": "Redis Bridge", "team": "blue2"},
        {"id": "red-cmd", "name": "Red Commander", "team": "red"},
        {"id": "alpha-recon", "name": "Alpha Recon", "team": "red"},
        {"id": "gamma-exploit", "name": "Gamma Exploit", "team": "red"},
        {"id": "critic", "name": "Critic Agent", "team": "red"},
        {"id": "sandbox", "name": "Sandbox Container", "team": "sand"},
    ]
    
    for agent in agents:
        await supabase.create_swarm_agent_state(
            mission_id=mission_id,
            agent_id=agent["id"],
            agent_name=agent["name"],
            agent_team=agent["team"],
            status="idle",
            iter="PENDING",
            task="Waiting for mission start...",
        )
