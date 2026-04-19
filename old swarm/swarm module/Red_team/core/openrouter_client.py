from __future__ import annotations

"""
OpenRouter client for cloud LLM inference.
Uses the OpenAI-compatible API at https://openrouter.ai/api/v1.

PentAGI v4.0: 9-model cascade with instant failover.
Priority order:
  1st → meta-llama/llama-3.3-70b-instruct:free
  2nd → openai/gpt-oss-120b:free
  3rd → nousresearch/hermes-3-llama-3.1-405b:free
  4th → cognitivecomputations/dolphin-mistral-24b-venice-edition:free
  5th → upstage/solar-pro-3:free
  6th → z-ai/glm-4.5-air:free
  7th → stepfun/step-3.5-flash:free
  8th → google/gemma-3-27b-it:free
  9th → mistralai/mistral-small-3.1-24b-instruct:free
  10th → Ollama local (last resort - no limits)

NOTE: All OpenRouter free models have rate limits (~10-20 req/min).
For production use, set OPENROUTER_API_KEY in .env for paid access.
"""

# PentAGI v4.0: 9-model cascade - instant skip on 429/timeout
# On any error or rate limit: immediately try next model (zero wait time)
FALLBACK_MODELS = [
    "openai/gpt-oss-120b:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    "upstage/solar-pro-3:free",
    "z-ai/glm-4.5-air:free",
    "stepfun/step-3.5-flash:free",
    "google/gemma-3-27b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
]  # Ollama is last resort after all OpenRouter models fail

# Model role recommendations (for logging/debugging)
MODEL_ROLES = {
    "meta-llama/llama-3.3-70b-instruct:free": "Primary/Llama-3.3",
    "openai/gpt-oss-120b:free": "Backup/GPT-OSS",
    "nousresearch/hermes-3-llama-3.1-405b:free": "Reasoning/Hermes-405B",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": "Uncensored/Dolphin",
    "upstage/solar-pro-3:free": "Solid/Solar-Pro",
    "z-ai/glm-4.5-air:free": "Fast/GLM-4.5",
    "stepfun/step-3.5-flash:free": "Fast/Step-Flash",
    "google/gemma-3-27b-it:free": "Reliable/Gemma-3",
    "mistralai/mistral-small-3.1-24b-instruct:free": "Small/Mistral",
}

# Per-request timeout before switching to next model (20s for better success rate)
MODEL_TIMEOUT_SECONDS = 20

import asyncio
import logging
import time
from typing import Any

from openai import AsyncOpenAI, RateLimitError, NotFoundError

from core.config import settings

logger = logging.getLogger(__name__)


class OpenRouterClient:
    """Async wrapper around OpenRouter's OpenAI-compatible API."""

    BASE_URL = "https://openrouter.ai/api/v1"
    MAX_RETRIES = 2  # Reduced from 5 — fail fast, try next model
    BASE_DELAY = 1  # seconds

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or settings.openrouter_api_key
        self._client = AsyncOpenAI(
            api_key=self._api_key,
            base_url=self.BASE_URL,
            max_retries=0,  # We handle retries ourselves for fallback
        )

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> str:
        """
        Send a chat completion with 10s timeout + model fallback cascade.
        Logs which model was used for each successful request.
        
        Note: Free tier models have rate limits. If all OpenRouter models fail,
        the caller should fall back to Ollama local inference.
        """
        models_to_try = [model] + [m for m in FALLBACK_MODELS if m != model]

        for model_name in models_to_try:
            for attempt in range(self.MAX_RETRIES):
                try:
                    start_ts = time.monotonic()
                    # 15-second timeout per model attempt
                    response = await asyncio.wait_for(
                        self._client.chat.completions.create(
                            model=model_name,
                            messages=messages,
                            temperature=temperature,
                            max_tokens=max_tokens,
                            **kwargs,
                        ),
                        timeout=MODEL_TIMEOUT_SECONDS,
                    )
                    elapsed = time.monotonic() - start_ts

                    # Handle None response or empty choices
                    if response is None or not response.choices:
                        logger.warning("OpenRouter: empty response from %s (%.1fs), trying next model...", model_name, elapsed)
                        break  # Try next model

                    content = response.choices[0].message.content or ""
                    role = MODEL_ROLES.get(model_name, "General")
                    logger.info(
                        "✅ LLM [%s|%s] responded in %.1fs (%d chars)",
                        model_name, role, elapsed, len(content),
                    )
                    return content

                except asyncio.TimeoutError:
                    logger.warning(
                        "⏱️ LLM [%s] timed out after %ds (attempt %d/%d), trying next...",
                        model_name, MODEL_TIMEOUT_SECONDS, attempt + 1, self.MAX_RETRIES,
                    )
                    break  # Don't retry same model on timeout — try next model

                except RateLimitError:
                    # Free tier models are rate-limited by design (~10-20 req/min)
                    # Don't waste time retrying - immediately try next model
                    logger.warning(
                        "🚫 LLM [%s] rate limited (429) - free tier limit reached, trying next model...",
                        model_name,
                    )
                    break  # Immediately try next model - no retries on rate limit

                except NotFoundError:
                    logger.warning("❌ LLM [%s] not found on OpenRouter, trying next...", model_name)
                    break  # Try next model

                except Exception as e:
                    logger.warning("❌ LLM [%s] error: %s, trying next...", model_name, str(e)[:100])
                    break  # Try next model

        raise RuntimeError(
            f"All OpenRouter models exhausted. Tried: {', '.join(models_to_try)}"
        )

    async def ping(self) -> bool:
        """Check OpenRouter connectivity."""
        try:
            await asyncio.wait_for(self._client.models.list(), timeout=5)
            return True
        except Exception:
            return False


# Default singleton
openrouter_client = OpenRouterClient()
