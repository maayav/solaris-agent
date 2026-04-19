"""
Target Container Deployment Tests

Tests for verifying that the TargetContainerManager can:
1. Clone a GitHub repo
2. Build a Docker image from the repo's Dockerfile
3. Run a container from that image
4. Have the container's application accessible on the expected port

Test repos:
- https://github.com/juice-shop/juice-shop (Node.js app on port 3000)
- https://github.com/owasp/nodegoat (Node.js app)

Usage:
    # Run all target container tests
    pytest tests/test_target_container_deployment.py -v

    # Run just Juice Shop tests
    pytest tests/test_target_container_deployment.py -k juice_shop -v

    # Run just nodegoat tests
    pytest tests/test_target_container_deployment.py -k nodegoat -v

    # Run with verbose output
    pytest tests/test_target_container_deployment.py -v -s

Requirements:
    - Docker available and running
    - Network access to clone GitHub repos
    - Ports available for container mapping (will use high ports like 31754+)
"""

from __future__ import annotations

import asyncio
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio

# Mark all tests in this file as integration/slow tests
pytestmark = [
    pytest.mark.integration,
    pytest.mark.slow,
]


# =============================================================================
# SERVICE AVAILABILITY CHECKS
# =============================================================================

def check_docker() -> bool:
    """Check if Docker is available."""
    try:
        result = subprocess.run(
            ["docker", "version"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


def check_git() -> bool:
    """Check if git is available."""
    try:
        result = subprocess.run(
            ["git", "--version"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture(scope="session")
def docker_available():
    """Check if Docker is available."""
    if not check_docker():
        pytest.skip("Docker not available")
    return True


@pytest.fixture(scope="session")
def git_available():
    """Check if git is available."""
    if not check_git():
        pytest.skip("git not available")
    return True


@pytest.fixture
def unique_mission_id():
    """Generate unique mission ID for each test."""
    return str(uuid.uuid4())


@pytest_asyncio.fixture
async def target_container_manager(docker_available):
    """Create a TargetContainerManager instance."""
    try:
        from sandbox.sandbox_manager import TargetContainerManager
        manager = TargetContainerManager()
        yield manager
        # Cleanup after test
        await manager.cleanup()
    except ImportError:
        pytest.skip("TargetContainerManager not available")


@pytest.fixture
def unique_port():
    """Generate a unique high port for each test to avoid conflicts."""
    import random
    port = random.randint(31754, 32754)
    return port


# =============================================================================
# REPO TEST DATA
# =============================================================================

JUICE_SHOP_REPO = "https://github.com/juice-shop/juice-shop"
NODEGOAT_REPO = "https://github.com/owasp/nodegoat"


# =============================================================================
# TARGET CONTAINER DEPLOYMENT TESTS
# =============================================================================

@pytest.mark.asyncio
class TestTargetContainerDeployment:
    """Tests for TargetContainerManager.deploy_target() method."""

    async def test_juice_shop_clone_and_build(self, docker_available, git_available, unique_mission_id, unique_port):
        """
        Test: Deploy Juice Shop from GitHub repo and verify it's accessible.
        
        Steps:
        1. Clone the juice-shop repo
        2. Build Docker image
        3. Run container
        4. Verify container is responding on the expected port
        """
        from sandbox.sandbox_manager import TargetContainerManager
        
        manager = TargetContainerManager()
        target_url = f"http://localhost:{unique_port}"
        
        try:
            # Deploy the target container
            result = await manager.deploy_target(
                repo_url=JUICE_SHOP_REPO,
                target_url=target_url,
                mission_id=unique_mission_id,
            )
            
            # Verify deployment succeeded
            assert result.get("success") is True, f"Deployment failed: {result.get('error')}"
            
            # Verify result contains expected keys
            assert "target_url" in result, "Missing target_url in result"
            assert "container_port" in result, "Missing container_port in result"
            assert "host_port" in result, "Missing host_port in result"
            assert "container_name" in result, "Missing container_name in result"
            assert "image_tag" in result, "Missing image_tag in result"
            
            # Log deployment info
            print(f"\n=== Juice Shop Deployment Info ===")
            print(f"Container Name: {result.get('container_name')}")
            print(f"Image Tag: {result.get('image_tag')}")
            print(f"Container Port: {result.get('container_port')}")
            print(f"Host Port: {result.get('host_port')}")
            print(f"Target URL: {result.get('target_url')}")
            
            # Verify the container is actually running
            container_name = result.get("container_name")
            check_result = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", container_name],
                capture_output=True,
                text=True,
            )
            assert "true" in check_result.stdout.lower(), f"Container not running: {check_result.stdout}"
            
            print(f"Container is running: {check_result.stdout.strip()}")
            
            # Give the app a moment to start and do a health check
            await asyncio.sleep(5)
            
            # Verify the app is accessible via HTTP
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Try the main page
                    response = await client.get(result.get("target_url"))
                    assert response.status_code < 500, f"App returned error: {response.status_code}"
                    print(f"HTTP health check passed: {response.status_code}")
                    
                    # Try an API endpoint
                    api_response = await client.get(f"{result.get('target_url')}/api/Challenges")
                    assert api_response.status_code < 500, f"API returned error: {api_response.status_code}"
                    print(f"API health check passed: {api_response.status_code}")
                    
            except httpx.ConnectError as e:
                pytest.fail(f"Could not connect to deployed app at {result.get('target_url')}: {e}")
            except httpx.TimeoutException:
                pytest.fail(f"Timeout connecting to deployed app at {result.get('target_url')}")
            
            print("=== Juice Shop Deployment Test PASSED ===\n")
            
        finally:
            # Cleanup
            await manager.cleanup()


    async def test_nodegoat_clone_and_build(self, docker_available, git_available, unique_mission_id, unique_port):
        """
        Test: Deploy nodegoat from GitHub repo and verify it's accessible.
        
        Steps:
        1. Clone the nodegoat repo
        2. Build Docker image
        3. Run container
        4. Verify container is responding on the expected port
        """
        from sandbox.sandbox_manager import TargetContainerManager
        
        manager = TargetContainerManager()
        target_url = f"http://localhost:{unique_port}"
        
        try:
            # Deploy the target container
            result = await manager.deploy_target(
                repo_url=NODEGOAT_REPO,
                target_url=target_url,
                mission_id=unique_mission_id,
            )
            
            # Verify deployment succeeded
            assert result.get("success") is True, f"Deployment failed: {result.get('error')}"
            
            # Verify result contains expected keys
            assert "target_url" in result, "Missing target_url in result"
            assert "container_port" in result, "Missing container_port in result"
            assert "host_port" in result, "Missing host_port in result"
            assert "container_name" in result, "Missing container_name in result"
            assert "image_tag" in result, "Missing image_tag in result"
            
            # Log deployment info
            print(f"\n=== NodeGoat Deployment Info ===")
            print(f"Container Name: {result.get('container_name')}")
            print(f"Image Tag: {result.get('image_tag')}")
            print(f"Container Port: {result.get('container_port')}")
            print(f"Host Port: {result.get('host_port')}")
            print(f"Target URL: {result.get('target_url')}")
            
            # Verify the container is actually running
            container_name = result.get("container_name")
            check_result = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", container_name],
                capture_output=True,
                text=True,
            )
            assert "true" in check_result.stdout.lower(), f"Container not running: {check_result.stdout}"
            
            print(f"Container is running: {check_result.stdout.strip()}")
            
            # Give the app a moment to start
            await asyncio.sleep(5)
            
            # Verify the app is accessible via HTTP
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Try the main page
                    response = await client.get(result.get("target_url"))
                    assert response.status_code < 500, f"App returned error: {response.status_code}"
                    print(f"HTTP health check passed: {response.status_code}")
                    
            except httpx.ConnectError as e:
                pytest.fail(f"Could not connect to deployed app at {result.get('target_url')}: {e}")
            except httpx.TimeoutException:
                pytest.fail(f"Timeout connecting to deployed app at {result.get('target_url')}")
            
            print("=== NodeGoat Deployment Test PASSED ===\n")
            
        finally:
            # Cleanup
            await manager.cleanup()


# =============================================================================
# SANDBOX TO TARGET COMMUNICATION TESTS
# =============================================================================

@pytest.mark.asyncio
class TestSandboxToTargetCommunication:
    """Tests for verifying sandbox container can reach target container."""

    async def test_sandbox_can_reach_juice_shop(self, docker_available, git_available, unique_mission_id, unique_port):
        """
        Test: Verify that sandbox container can reach the deployed target.
        
        This tests the full workflow:
        1. Deploy target container (Juice Shop)
        2. Use sandbox to curl the target
        3. Verify sandbox can successfully make HTTP requests to target
        """
        from sandbox.sandbox_manager import shared_sandbox_manager, TargetContainerManager
        
        target_manager = TargetContainerManager()
        target_url = f"http://localhost:{unique_port}"
        
        try:
            # Deploy the target container
            print(f"\n=== Deploying Juice Shop to {target_url} ===")
            deploy_result = await target_manager.deploy_target(
                repo_url=JUICE_SHOP_REPO,
                target_url=target_url,
                mission_id=unique_mission_id,
            )
            
            assert deploy_result.get("success") is True, f"Target deployment failed: {deploy_result.get('error')}"
            print(f"Target deployed: {deploy_result.get('target_url')}")
            
            # Give the app extra time to fully start
            await asyncio.sleep(8)
            
            # Now use the sandbox to make a request to the target
            print(f"=== Testing sandbox -> target communication ===")
            
            # The sandbox should be able to reach host.docker.internal:PORT on Windows/Mac
            # or localhost:PORT on Linux
            import sys
            if sys.platform == "win32" or sys.platform == "darwin":
                sandbox_target_url = f"http://host.docker.internal:{unique_port}"
            else:
                sandbox_target_url = f"http://localhost:{unique_port}"
            
            print(f"Sandbox will use URL: {sandbox_target_url}")
            
            # Test with curl via sandbox
            curl_cmd = f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 30 {sandbox_target_url}/"
            result = await shared_sandbox_manager.exec_command(curl_cmd, timeout=60)
            
            print(f"Curl exit code: {result.exit_code}")
            print(f"Curl stdout: {result.stdout}")
            print(f"Curl stderr: {result.stderr}")
            
            # Verify curl succeeded (exit code 0 or 18 which is partial transfer, both are OK)
            assert result.success or result.exit_code == 18, f"Curl failed: {result.stderr}"
            
            # HTTP status should be 200 or similar success
            status_code = result.stdout.strip().strip("'")
            assert status_code.isdigit(), f"Invalid status code: {status_code}"
            status_int = int(status_code)
            assert 200 <= status_int < 400, f"HTTP error: {status_int}"
            
            print(f"=== Sandbox -> Target communication TEST PASSED ===\n")
            
        finally:
            # Cleanup
            await target_manager.cleanup()


# =============================================================================
# URL TRANSLATION TESTS
# =============================================================================

@pytest.mark.asyncio
class TestUrlTranslation:
    """Tests for verify URL translation works correctly."""

    async def test_translate_localhost_to_host_docker_internal(self, docker_available, unique_mission_id, unique_port):
        """
        Test: Verify translate_url_for_sandbox correctly translates localhost:PORT URLs.
        """
        from sandbox.sandbox_manager import TargetContainerManager, translate_url_for_sandbox, _active_target_host, _active_target_port
        
        # This test doesn't need to deploy, just test the translation function
        # when active target is set
        
        target_manager = TargetContainerManager()
        target_url = f"http://localhost:{unique_port}"
        
        try:
            # Deploy the target (this sets the active target globals)
            deploy_result = await target_manager.deploy_target(
                repo_url=JUICE_SHOP_REPO,
                target_url=target_url,
                mission_id=unique_mission_id,
            )
            
            assert deploy_result.get("success") is True, f"Deployment failed: {deploy_result.get('error')}"
            
            # Now test URL translation
            original_url = f"http://localhost:{unique_port}/rest/user/login"
            translated = translate_url_for_sandbox(original_url)
            
            print(f"\nOriginal URL: {original_url}")
            print(f"Translated URL: {translated}")
            print(f"Active target host: {_active_target_host}")
            print(f"Active target port: {_active_target_port}")
            
            # On Windows/Mac, should translate to host.docker.internal:PORT
            # On Linux, should keep localhost:PORT
            import sys
            if sys.platform == "win32" or sys.platform == "darwin":
                assert "host.docker.internal" in translated, f"Expected host.docker.internal in translated URL, got: {translated}"
            else:
                assert "localhost" in translated, f"Expected localhost in translated URL, got: {translated}"
            
            # Port should be preserved
            assert str(unique_port) in translated, f"Expected port {unique_port} in translated URL, got: {translated}"
            
            print("=== URL Translation Test PASSED ===\n")
            
        finally:
            await target_manager.cleanup()
