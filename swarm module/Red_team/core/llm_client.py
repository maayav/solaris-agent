"""
Unified LLM client with 4-model cascade.

PentAGI v4.0 Priority Order:
  1st → OpenRouter primary model (google/gemini-2.0-flash-exp:free)
  2nd → OpenRouter fallback chain (deepseek-r1:free → qwq-32b:free)
  3rd → Ollama local (last resort)

Each OpenRouter model gets 15s timeout before auto-failover.
"""

from __future__ import annotations

import logging
from typing import Any

from core.config import settings
from core.openrouter_client import openrouter_client
from core.ollama_client import ollama_client

logger = logging.getLogger(__name__)


class LLMClient:
    """
    Unified LLM client: OpenRouter cascade → Ollama fallback.
    """

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        fallback_model: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Send a chat completion request.

        DEMO MODE: Ollama models (no "/" in name) go directly to Ollama.
        OpenRouter models (contain "/") use OpenRouter cascade first.
        """
        # Check if this is an Ollama model (no "/" in model name)
        is_ollama_model = "/" not in model
        
        if is_ollama_model:
            # DEMO MODE: Use Ollama directly for local models
            logger.info(f"🦙 Using Ollama model directly: {model}")
            try:
                response = await ollama_client.chat(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    **kwargs,
                )
                logger.info(f"✅ LLM [Ollama/{model}] responded")
                return response
            except Exception as e:
                logger.warning(f"Ollama primary failed: {e}")
                # Try fallback model if different
                ollama_fallback = fallback_model or "qwen2.5-coder:7b-instruct"
                if ollama_fallback != model:
                    logger.info(f"🔄 Trying Ollama fallback: {ollama_fallback}")
                    response = await ollama_client.chat(
                        model=ollama_fallback,
                        messages=messages,
                        temperature=temperature,
                        **kwargs,
                    )
                    logger.info(f"✅ LLM [Ollama/{ollama_fallback}] responded")
                    return response
                raise
        else:
            # OpenRouter model (contains "/") - use OpenRouter cascade
            if settings.openrouter_api_key and settings.openrouter_api_key != "your_openrouter_api_key_here":
                try:
                    response = await openrouter_client.chat(
                        model=model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        **kwargs,
                    )
                    return response
                except Exception as e:
                    logger.warning("OpenRouter cascade exhausted: %s — falling back to Ollama", str(e)[:100])
            else:
                logger.debug("No OpenRouter API key set, using Ollama directly")

            # Fallback to Ollama
            ollama_model = fallback_model or settings.commander_model_fallback
            try:
                logger.info("🔄 LLM falling back to Ollama [%s]", ollama_model)
                response = await ollama_client.chat(
                    model=ollama_model,
                    messages=messages,
                    temperature=temperature,
                    **kwargs,
                )
                logger.info("✅ LLM [Ollama/%s] responded", ollama_model)
                return response
            except Exception as e:
                logger.error("❌ Ollama fallback also failed: %s", e)
                raise RuntimeError(
                    f"All LLM backends failed. "
                    f"OpenRouter model: {model}, Ollama model: {ollama_model}"
                )

    async def ping_openrouter(self) -> bool:
        """Check if OpenRouter is available."""
        if not settings.openrouter_api_key:
            return False
        return await openrouter_client.ping()

    async def ping_ollama(self) -> bool:
        """Check if Ollama is available."""
        return await ollama_client.ping()


# Default singleton
llm_client = LLMClient()
