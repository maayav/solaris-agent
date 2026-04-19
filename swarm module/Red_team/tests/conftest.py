"""
Pytest configuration and shared fixtures for Swarm Module tests.

This file contains:
- Custom markers for test categorization
- Shared fixtures for all test modules
- Test configuration and setup
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# =============================================================================
# CUSTOM MARKERS
# =============================================================================

def pytest_configure(config):
    """Configure custom markers."""
    config.addinivalue_line("markers", "critical: Critical bug tests (break functionality)")
    config.addinivalue_line("markers", "high: High priority bug tests")
    config.addinivalue_line("markers", "medium: Medium priority feature tests")
    config.addinivalue_line("markers", "regression: Regression tests")
    config.addinivalue_line("markers", "slow: Slow tests (integration tests)")
    config.addinivalue_line("markers", "unit: Fast unit tests")
    config.addinivalue_line("markers", "integration: Integration tests requiring external services")
    config.addinivalue_line("markers", "redis: Tests requiring Redis")
    config.addinivalue_line("markers", "supabase: Tests requiring Supabase")
    config.addinivalue_line("markers", "qdrant: Tests requiring Qdrant")


# =============================================================================
# SESSION FIXTURES
# =============================================================================

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def test_data_dir():
    """Path to test data directory."""
    data_dir = Path(__file__).parent / "test_data"
    data_dir.mkdir(exist_ok=True)
    return data_dir


@pytest.fixture(scope="session")
def mock_juice_shop_responses():
    """Sample responses from Juice Shop for testing."""
    return {
        "login_success": """
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdGF0dXMiOiJzdWNjZXNzIn0; Path=/

{"authentication":{"token":"eyJhbGc...","uEmail":"admin@juice-sh.op","uRole":"admin"}}
""",
        "login_fail": """
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":"Invalid email or password"}
""",
        "idor_user": """
HTTP/1.1 200 OK
Content-Type: application/json

{"id":1,"username":"admin","email":"admin@juice-sh.op","password":"0192023a7bbd73250516f069df18b500"}
""",
        "sqli_error": """
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"error":{"message":"SQLITE_ERROR: near \"'\": syntax error"}}
""",
        "git_head": """
HTTP/1.1 200 OK
Content-Type: text/plain

ref: refs/heads/master
""",
        "security_question": """
HTTP/1.1 200 OK
Content-Type: application/json

{"question":"What is your favorite pet?"}
""",
    }


@pytest.fixture(scope="session")
def exploit_payloads():
    """Common exploit payloads for testing."""
    return {
        "sqli": [
            "' OR 1=1--",
            "' UNION SELECT 1,2,3--",
            "' AND SLEEP(5)--",
            "1' AND 1=1--",
        ],
        "xss": [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "javascript:alert(1)",
        ],
        "idor": [
            "/api/users/1",
            "/api/users/2",
            "/api/users/99",
        ],
        "lfi": [
            "../../../etc/passwd",
            "..%2f..%2f..%2fetc%2fpasswd",
            "....//....//etc/passwd",
        ],
        "command_injection": [
            "; cat /etc/passwd",
            "| whoami",
            "`id`",
        ],
        "xxe": [
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
        ],
        "ssrf": [
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost:8080/admin",
            "file:///etc/passwd",
        ],
    }


# =============================================================================
# FUNCTION FIXTURES
# =============================================================================

@pytest.fixture
def unique_id():
    """Generate a unique identifier."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_timestamp():
    """Get current timestamp in ISO format."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def temp_file(tmp_path):
    """Create a temporary file for testing."""
    return tmp_path / "test_file.txt"


@pytest.fixture
def mock_redis_client():
    """Create a mock Redis client."""
    client = MagicMock()
    client.xadd = AsyncMock(return_value="1234567890-0")
    client.xreadgroup = AsyncMock(return_value=[])
    client.xack = AsyncMock(return_value=1)
    client.xgroup_create = AsyncMock(return_value=True)
    client.xpending = AsyncMock(return_value={"pending": 0})
    client.hset = AsyncMock(return_value=1)
    client.hget = AsyncMock(return_value=None)
    client.ping = AsyncMock(return_value=True)
    client.aclose = AsyncMock(return_value=None)
    client.xtrim = AsyncMock(return_value=0)
    client.delete = AsyncMock(return_value=0)
    return client


@pytest.fixture
def mock_qdrant_client():
    """Create a mock Qdrant client."""
    client = MagicMock()
    client.upsert = AsyncMock(return_value=True)
    client.search = AsyncMock(return_value=[])
    client.delete = AsyncMock(return_value=True)
    return client


@pytest.fixture
def mock_llm_response():
    """Create a mock LLM response."""
    def _create(response_type="success"):
        responses = {
            "success": {
                "analysis": "Test analysis",
                "next_phase": "exploitation",
                "strategy": "Test strategy",
                "stealth_mode": False,
                "tasks": [
                    {
                        "agent": "agent_gamma",
                        "description": "Test SQLi on login endpoint",
                        "target": "http://localhost:3000/rest/user/login",
                        "tools_allowed": ["curl"],
                        "priority": "HIGH",
                        "exploit_type": "sqli",
                    }
                ],
            },
            "complete": {
                "analysis": "Mission complete",
                "next_phase": "complete",
                "strategy": "Final strategy",
                "stealth_mode": False,
                "tasks": [],
            },
            "empty": {
                "error": "No tasks generated",
            },
        }
        return responses.get(response_type, responses["success"])
    return _create


@pytest.fixture
def mock_sandbox_result():
    """Create a mock sandbox execution result."""
    def _create(
        exit_code: int = 0,
        stdout: str = "",
        stderr: str = "",
        command: str = "test",
    ):
        # Import inside fixture to avoid collection errors
        try:
            from sandbox.sandbox_manager import ExecResult
        except ImportError:
            pytest.skip("sandbox.sandbox_manager not available")
        
        return ExecResult(
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            command=command,
        )
    return _create


# =============================================================================
# ASYNC FIXTURES
# =============================================================================

@pytest.fixture
async def async_redis_bus():
    """Create a RedisBus instance for async tests."""
    try:
        from core.redis_bus import RedisBus
    except ImportError:
        pytest.skip("core.redis_bus not available")
    
    bus = RedisBus()
    try:
        await bus.connect()
        yield bus
    except Exception as e:
        pytest.skip(f"Redis not available: {e}")
    finally:
        try:
            await bus.disconnect()
        except:
            pass


@pytest.fixture
async def async_supabase_client():
    """Create a Supabase client for async tests."""
    try:
        from core.supabase_client import get_supabase_client
    except ImportError:
        pytest.skip("core.supabase_client not available")
    
    client = get_supabase_client()
    if not client._enabled:
        pytest.skip("Supabase not configured")
    yield client


# =============================================================================
# ENVIRONMENT FIXTURES
# =============================================================================

@pytest.fixture
def set_env_vars():
    """Set environment variables for testing."""
    old_environ = dict(os.environ)
    os.environ.update({
        "TESTING": "true",
        "LOG_LEVEL": "DEBUG",
    })
    yield
    os.environ.clear()
    os.environ.update(old_environ)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def create_mock_exec_result(
    exit_code: int = 0,
    stdout: str = "",
    stderr: str = "",
    command: str = "test",
) -> Any:
    """Helper to create mock execution results."""
    try:
        from sandbox.sandbox_manager import ExecResult
    except ImportError:
        pytest.skip("sandbox.sandbox_manager not available")
    
    return ExecResult(
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
        command=command,
    )


def assert_valid_uuid(value: str) -> None:
    """Assert that a value is a valid UUID."""
    import re
    pattern = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )
    assert pattern.match(value), f"'{value}' is not a valid UUID"


def assert_valid_json(value: str) -> dict:
    """Assert that a string is valid JSON and return the parsed object."""
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        pytest.fail(f"Invalid JSON: {e}")


# =============================================================================
# PYTEST HOOKS
# =============================================================================

def pytest_collection_modifyitems(config, items):
    """Modify test items during collection."""
    # Add unit marker to tests that don't have any markers
    for item in items:
        if not any(marker.name in ['critical', 'high', 'medium', 'regression', 'integration', 'slow'] 
                   for marker in item.iter_markers()):
            item.add_marker(pytest.mark.unit)


def pytest_runtest_setup(item):
    """Setup before each test."""
    # Skip integration tests unless explicitly requested
    if item.get_closest_marker("integration"):
        if os.getenv("SKIP_INTEGRATION") == "1":
            pytest.skip("Integration tests disabled (SKIP_INTEGRATION=1)")
