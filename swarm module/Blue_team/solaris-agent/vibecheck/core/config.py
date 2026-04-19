"""
Configuration management for Project VibeCheck.

Uses pydantic-settings for environment variable loading and validation.
"""

import os
import tempfile
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=[".env", "vibecheck/.env"],
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -------------------------------------------
    # Environment
    # -------------------------------------------
    environment: str = Field(default="development", description="Application environment")
    log_level: str = Field(default="INFO", description="Logging level")
    api_port: int = Field(default=8000, description="API server port")

    # -------------------------------------------
    # Supabase Configuration
    # -------------------------------------------
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_anon_key: str = Field(..., description="Supabase anonymous key")

    # -------------------------------------------
    # OpenRouter Configuration
    # -------------------------------------------
    openrouter_api_key: str | None = Field(default=None, description="OpenRouter API key")
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        description="OpenRouter API base URL",
    )

    # -------------------------------------------
    # Local Services (Docker)
    # -------------------------------------------
    falkordb_url: str = Field(default="redis://localhost:6379", description="FalkorDB connection URL")
    qdrant_url: str = Field(default="http://localhost:6333", description="Qdrant connection URL")
    redis_url: str = Field(default="redis://localhost:6381", description="Redis connection URL (shared with Red Team)")

    # -------------------------------------------
    # Ollama Configuration
    # -------------------------------------------
    ollama_base_url: str = Field(default="http://localhost:11434", description="Ollama API URL")
    ollama_coder_model: str = Field(
        default="qwen2.5-coder:7b-instruct",
        description="Ollama model for code tasks",
    )
    ollama_embed_model: str = Field(
        default="nomic-embed-text:latest",
        description="Ollama model for embeddings",
    )

    # -------------------------------------------
    # OpenRouter LLM Configuration
    # -------------------------------------------
    openrouter_primary_model: str = Field(
        default="qwen/qwen2.5-72b-instruct:free",
        description="Primary OpenRouter model for verification",
    )
    openrouter_fallback_model: str = Field(
        default="meta-llama/llama-3.2-3b-instruct:free",
        description="Fallback OpenRouter model if primary fails",
    )
    openrouter_http_referer: str = Field(
        default="https://vibecheck.local",
        description="HTTP Referer header for OpenRouter API",
    )

    # -------------------------------------------
    # Scan Settings
    # -------------------------------------------
    max_concurrent_scans: int = Field(default=3, description="Maximum concurrent scans")
    repo_clone_dir: str = Field(
        default="",
        description="Directory for cloning repositories",
    )

    def __init__(self, **data):
        super().__init__(**data)
        # Set default repo_clone_dir to cross-platform temp directory if not provided
        if not self.repo_clone_dir:
            self.repo_clone_dir = os.path.join(tempfile.gettempdir(), "vibecheck", "repos")
    max_repo_size_mb: int = Field(default=500, description="Maximum repository size in MB")

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """Validate environment value."""
        allowed = {"development", "staging", "production"}
        if v.lower() not in allowed:
            raise ValueError(f"environment must be one of: {allowed}")
        return v.lower()

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level value."""
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v.upper() not in allowed:
            raise ValueError(f"log_level must be one of: {allowed}")
        return v.upper()

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.environment == "development"

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Uses lru_cache to ensure settings are only loaded once.
    """
    return Settings()
