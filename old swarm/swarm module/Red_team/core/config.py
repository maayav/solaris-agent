"""
Centralized configuration loaded from environment variables.
Uses pydantic-settings for validation and type coercion.
"""

from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field

# Resolve .env relative to project root (parent of core/)
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """All configuration for the Red Team agent swarm."""

    # Redis (message bus) - Shared with Blue Team on port 6380
    redis_url: str = Field(default="redis://localhost:6380", description="Redis connection URL")

    # Ollama (local LLMs)
    ollama_base_url: str = Field(
        default="http://localhost:11434", description="Ollama server base URL"
    )

    # OpenRouter (cloud LLMs)
    openrouter_api_key: str = Field(default="", description="OpenRouter API key")
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1", description="OpenRouter API base URL"
    )

    # Target - Blue Team Juice Shop runs on port 8080
    juice_shop_url: str = Field(
        default="http://localhost:8080", description="Juice Shop target URL"
    )

    # Blue Team Integration
    qdrant_url: str = Field(
        default="http://localhost:6333", description="Qdrant vector DB URL"
    )
    falkordb_url: str = Field(
        default="redis://localhost:6379", description="FalkorDB graph DB URL"
    )

    # Model selection — PentAGI v4.0 (Ollama primary, OpenRouter optional)
    # DEMO MODE: Ollama is primary for local execution
    # OpenRouter available as backup if Ollama fails
    #
    # OLLAMA_CASCADE (local):
    # 1st → qwen2.5-coder:7b      (best for exploit code generation)
    # 2nd → llama3:latest          (reliable general-purpose)
    # 3rd → mistral:latest         (good reasoning, fast)
    # 4th → deepseek-r1:8b         (good reasoning fallback)
    # 5th → phi4:latest            (fast, lightweight)
    #
    # OPENROUTER_CASCADE (cloud backup):
    # 6th → meta-llama/llama-3.3-70b-instruct:free
    # 7th → nousresearch/hermes-3-llama-3.1-405b:free
    # 8th → cognitivecomputations/dolphin-mistral-24b-venice-edition:free
    # 9th → upstage/solar-pro-3:free
    # 10th → google/gemma-3-27b-it:free
    
    # Commander - Ollama primary
    commander_model: str = Field(
        default="qwen2.5-coder:7b-instruct",
        description="Ollama model for Commander agent (primary)",
    )
    commander_model_fallback: str = Field(
        default="qwen2.5-coder:7b-instruct",  # Use qwen for JSON reliability
        description="Ollama fallback for Commander agent",
    )

    # Alpha Recon - Ollama primary
    recon_model: str = Field(
        default="qwen2.5-coder:7b-instruct",
        description="Ollama model for Alpha Recon agent (primary)",
    )
    recon_model_fallback: str = Field(
        default="qwen2.5-coder:7b-instruct",  # Use qwen for JSON reliability
        description="Ollama fallback for Alpha Recon agent",
    )

    # Gamma Exploit - Ollama primary (coder model best for exploits)
    exploit_model: str = Field(
        default="qwen2.5-coder:7b-instruct",
        description="Ollama model for Gamma Exploit agent (primary)",
    )
    exploit_model_fallback: str = Field(
        default="qwen2.5-coder:7b-instruct",  # Use qwen for JSON reliability
        description="Ollama fallback for Gamma Exploit agent",
    )

    # Critic Agent - Ollama primary
    critic_model: str = Field(
        default="qwen2.5-coder:7b-instruct",
        description="Ollama model for Critic agent (primary)",
    )
    critic_model_fallback: str = Field(
        default="qwen2.5-coder:7b-instruct",  # Use qwen for JSON reliability
        description="Ollama fallback for Critic agent",
    )

    # HITL (Phase 3)
    hitl_timeout_seconds: int = Field(
        default=120, description="Seconds to wait for human approval"
    )
    max_reflection_iterations: int = Field(
        default=3, description="Max PentAGI reflection retries"
    )

    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8", "extra": "ignore"}


# Singleton — import this everywhere
settings = Settings()
