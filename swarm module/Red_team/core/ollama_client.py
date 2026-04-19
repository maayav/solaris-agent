"""
Ollama client for local LLM inference (chat + embeddings).
Wraps the ollama Python SDK with async support.
"""

from __future__ import annotations

import logging
from typing import Any

from ollama import AsyncClient

from core.config import settings

logger = logging.getLogger(__name__)


class OllamaClient:
    """Async wrapper around the Ollama API."""

    def __init__(self, base_url: str | None = None):
        self._base_url = base_url or settings.ollama_base_url
        self._client = AsyncClient(host=self._base_url)

    async def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
        format: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Send a chat completion request to Ollama.
        Returns the assistant's response text.
        """
        options = {"temperature": temperature}

        request_kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "options": options,
            **kwargs,
        }
        if format:
            request_kwargs["format"] = format

        response = await self._client.chat(**request_kwargs)
        content = response["message"]["content"]
        logger.debug("Ollama %s response: %d chars", model, len(content))
        return content

    async def embed(self, model: str, text: str) -> list[float]:
        """
        Generate an embedding vector for the given text.
        """
        response = await self._client.embed(model=model, input=text)
        embeddings = response["embeddings"][0]
        logger.debug("Ollama embed: %d dimensions", len(embeddings))
        return embeddings

    async def list_models(self) -> list[str]:
        """List locally available models."""
        response = await self._client.list()
        # Handle both dict and object responses from different SDK versions
        models = response.get("models", []) if isinstance(response, dict) else getattr(response, "models", [])
        result = []
        for m in models:
            name = m.get("name", "") if isinstance(m, dict) else getattr(m, "model", getattr(m, "name", ""))
            if name:
                result.append(name)
        return result

    async def ping(self) -> bool:
        """Check Ollama connectivity by listing models."""
        try:
            await self.list_models()
            return True
        except Exception as e:
            logging.getLogger(__name__).debug("Ollama ping failed: %s", e)
            return False


# Default singleton
ollama_client = OllamaClient()
