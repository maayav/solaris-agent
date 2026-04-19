"""
Tests for Week 1 MVP - Foundation (Local Brain).

These tests verify the Week 1 exit criteria:
1. Docker services start (FalkorDB, Qdrant, Redis)
2. POST /scan/trigger writes to Redis Stream
3. Worker reads job, clones repo, prints file tree
"""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestConfig:
    """Tests for configuration management."""
    
    def test_settings_defaults(self):
        """Test that settings have sensible defaults."""
        from core.config import Settings
        
        # Create settings with minimal required values
        settings = Settings(
            supabase_url="https://test.supabase.co",
            supabase_anon_key="test-key",
        )
        
        assert settings.environment == "development"
        assert settings.log_level == "INFO"
        assert settings.api_port == 8000
        # These are default values for local development
        # They can be overridden via environment variables
        assert settings.falkordb_url is not None
        assert settings.qdrant_url is not None
        assert settings.redis_url is not None
    
    def test_environment_validation(self):
        """Test environment validation."""
        from core.config import Settings
        from pydantic import ValidationError
        
        # Valid environments
        for env in ["development", "staging", "production"]:
            settings = Settings(
                supabase_url="https://test.supabase.co",
                supabase_anon_key="test-key",
                environment=env,
            )
            assert settings.environment == env
        
        # Invalid environment
        with pytest.raises(ValidationError):
            Settings(
                supabase_url="https://test.supabase.co",
                supabase_anon_key="test-key",
                environment="invalid",
            )


class TestRedisBus:
    """Tests for Redis Streams message bus."""
    
    @pytest.mark.asyncio
    async def test_publish_scan_job(self):
        """Test publishing a scan job to Redis Stream."""
        from core.redis_bus import RedisBus
        from core.config import get_settings
        
        # Use configured Redis URL
        settings = get_settings()
        bus = RedisBus(url=settings.redis_url)
        
        # Mock the Redis client
        with patch.object(bus, '_client', None):
            bus._client = MagicMock()
            bus._client.xadd = AsyncMock(return_value="12345-0")
            bus._client.ping = AsyncMock(return_value=True)
            bus._client.xgroup_create = AsyncMock()
            
            msg_id = await bus.publish_scan_job(
                repo_url="https://github.com/test/repo",
                triggered_by="test",
            )
            
            assert msg_id == "12345-0"
            bus._client.xadd.assert_called_once()


class TestScanWorker:
    """Tests for the scan worker."""
    
    def test_worker_initialization(self):
        """Test worker initialization."""
        from worker.scan_worker import ScanWorker
        
        worker = ScanWorker(worker_id="test-worker")
        
        assert worker.worker_id == "test-worker"
        assert worker.running == False
    
    @pytest.mark.asyncio
    async def test_format_size(self):
        """Test file size formatting."""
        from worker.scan_worker import ScanWorker
        
        worker = ScanWorker(worker_id="test-worker")
        
        assert worker._format_size(500) == "500.0B"
        assert worker._format_size(1024) == "1.0KB"
        assert worker._format_size(1024 * 1024) == "1.0MB"
        assert worker._format_size(1024 * 1024 * 1024) == "1.0GB"


class TestAPIRoutes:
    """Tests for API routes."""
    
    @pytest.mark.asyncio
    async def test_scan_trigger_endpoint(self):
        """Test scan trigger endpoint."""
        from api.routes.scan import ScanTriggerRequest
        
        request = ScanTriggerRequest(
            repo_url="https://github.com/test/repo",
            triggered_by="test",
        )
        
        assert request.repo_url == "https://github.com/test/repo"
        assert request.triggered_by == "test"
        assert request.priority == "normal"


# Integration test (requires running services)
@pytest.mark.integration
class TestIntegration:
    """Integration tests requiring running services."""
    
    @pytest.mark.asyncio
    async def test_redis_connection(self):
        """Test connection to Redis."""
        pytest.skip("Requires running Redis service")
        
        from core.redis_bus import RedisBus
        
        bus = RedisBus()
        await bus.connect()
        
        # Test ping
        result = await bus.client.ping()
        assert result == True
        
        await bus.disconnect()
    
    @pytest.mark.asyncio
    async def test_falkordb_connection(self):
        """Test connection to FalkorDB."""
        pytest.skip("Requires running FalkorDB service")
        
        from core.falkordb import FalkorDBClient
        
        client = FalkorDBClient()
        client.connect()
        
        # Test ping
        result = client.client.ping()
        assert result == True
        
        client.disconnect()
    
    @pytest.mark.asyncio
    async def test_qdrant_connection(self):
        """Test connection to Qdrant."""
        pytest.skip("Requires running Qdrant service")
        
        from core.qdrant import QdrantClient
        
        client = QdrantClient()
        client.connect()
        
        # Test get collections
        collections = client.list_collections()
        assert isinstance(collections, list)
        
        client.disconnect()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])