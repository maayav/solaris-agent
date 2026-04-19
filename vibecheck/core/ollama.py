"""
Ollama client for Project VibeCheck.

Ollama provides local LLM inference for:
- Code analysis and summarization
- Embedding generation for RAG
- Vulnerability verification
- Patch generation
"""

import asyncio
import logging
from typing import Any

import httpx
from ollama import AsyncClient as OllamaAsyncClient
from ollama import Client as OllamaSyncClient

from core.config import get_settings

logger = logging.getLogger(__name__)


class OllamaClient:
    """
    Client for interacting with Ollama LLM server.

    Provides both sync and async interfaces for:
    - Chat completions
    - Embeddings
    - Model management
    """

    def __init__(self, base_url: str | None = None) -> None:
        """
        Initialize Ollama client.

        Args:
            base_url: Ollama server URL (e.g., http://localhost:11434)
        """
        settings = get_settings()
        self._base_url = base_url or settings.ollama_base_url
        self._sync_client: OllamaSyncClient | None = None
        self._async_client: OllamaAsyncClient | None = None
        self._coder_model = settings.ollama_coder_model
        self._embed_model = settings.ollama_embed_model

    @property
    def sync_client(self) -> OllamaSyncClient:
        """Get the sync Ollama client."""
        if self._sync_client is None:
            self._sync_client = OllamaSyncClient(host=self._base_url)
        return self._sync_client

    @property
    def async_client(self) -> OllamaAsyncClient:
        """Get the async Ollama client."""
        if self._async_client is None:
            self._async_client = OllamaAsyncClient(host=self._base_url)
        return self._async_client

    # ==========================================
    # Model Management
    # ==========================================

    def pull_model(self, model_name: str) -> None:
        """
        Pull a model from Ollama registry.

        Args:
            model_name: Name of the model to pull
        """
        logger.info(f"Pulling model: {model_name}")
        for progress in self.sync_client.pull(model_name, stream=True):
            if progress.get("status"):
                logger.debug(f"Pull progress: {progress['status']}")
        logger.info(f"Model pulled successfully: {model_name}")

    async def pull_model_async(self, model_name: str) -> None:
        """
        Pull a model asynchronously.

        Args:
            model_name: Name of the model to pull
        """
        logger.info(f"Pulling model: {model_name}")
        async for progress in await self.async_client.pull(model_name, stream=True):
            if progress.get("status"):
                logger.debug(f"Pull progress: {progress['status']}")
        logger.info(f"Model pulled successfully: {model_name}")

    def ensure_models_exist(self) -> None:
        """Ensure required models are available."""
        models = self.list_models()
        model_names = {m.get("name", "") for m in models}

        required = [self._coder_model, self._embed_model]
        for model in required:
            if model not in model_names:
                logger.info(f"Model {model} not found, pulling...")
                self.pull_model(model)

    def list_models(self) -> list[dict[str, Any]]:
        """
        List available models.

        Returns:
            List of model information dictionaries
        """
        response = self.sync_client.list()
        return response.get("models", [])

    # ==========================================
    # Chat Completions
    # ==========================================

    def chat(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Generate a chat completion (sync).

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model to use (defaults to coder model)
            **kwargs: Additional parameters (temperature, etc.)

        Returns:
            Generated response text
        """
        model = model or self._coder_model
        logger.debug(f"Chat completion with {model}, {len(messages)} messages")

        response = self.sync_client.chat(
            model=model,
            messages=messages,
            **kwargs,
        )

        return response["message"]["content"]

    async def chat_async(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Generate a chat completion (async).

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model to use (defaults to coder model)
            **kwargs: Additional parameters (temperature, etc.)

        Returns:
            Generated response text
        """
        model = model or self._coder_model
        logger.debug(f"Async chat completion with {model}, {len(messages)} messages")

        response = await self.async_client.chat(
            model=model,
            messages=messages,
            **kwargs,
        )

        return response["message"]["content"]

    async def chat_stream_async(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        **kwargs: Any,
    ):
        """
        Generate a streaming chat completion (async).

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model to use (defaults to coder model)
            **kwargs: Additional parameters (temperature, etc.)

        Yields:
            Chunks of the generated response
        """
        model = model or self._coder_model
        logger.debug(f"Streaming chat completion with {model}, {len(messages)} messages")

        response = await self.async_client.chat(
            model=model,
            messages=messages,
            stream=True,
            **kwargs,
        )
        async for chunk in response:
            if "message" in chunk and "content" in chunk["message"]:
                yield chunk["message"]["content"]
            elif "content" in chunk:
                yield chunk["content"]

    def complete(
        self,
        prompt: str,
        model: str | None = None,
        system: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Generate a completion from a prompt (sync).

        Args:
            prompt: The prompt string
            model: Model to use (defaults to coder model)
            system: Optional system prompt
            **kwargs: Additional parameters

        Returns:
            Generated response text
        """
        model = model or self._coder_model
        messages = []

        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return self.chat(messages, model=model, **kwargs)

    async def complete_async(
        self,
        prompt: str,
        model: str | None = None,
        system: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Generate a completion from a prompt (async).

        Args:
            prompt: The prompt string
            model: Model to use (defaults to coder model)
            system: Optional system prompt
            **kwargs: Additional parameters

        Returns:
            Generated response text
        """
        model = model or self._coder_model
        messages = []

        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        return await self.chat_async(messages, model=model, **kwargs)

    # ==========================================
    # Embeddings
    # ==========================================

    def embed(
        self,
        texts: list[str],
        model: str | None = None,
    ) -> list[list[float]]:
        """
        Generate embeddings for texts (sync).

        Args:
            texts: List of strings to embed
            model: Model to use (defaults to embed model)

        Returns:
            List of embedding vectors
        """
        model = model or self._embed_model
        logger.debug(f"Generating embeddings for {len(texts)} texts with {model}")

        response = self.sync_client.embed(
            model=model,
            input=texts,
        )

        return response["embeddings"]

    async def embed_async(
        self,
        texts: list[str],
        model: str | None = None,
    ) -> list[list[float]]:
        """
        Generate embeddings for texts (async).

        Args:
            texts: List of strings to embed
            model: Model to use (defaults to embed model)

        Returns:
            List of embedding vectors
        """
        model = model or self._embed_model
        logger.debug(f"Async embedding for {len(texts)} texts with {model}")

        response = await self.async_client.embed(
            model=model,
            input=texts,
        )

        return response["embeddings"]

    async def embed_single(self, text: str, model: str | None = None) -> list[float]:
        """
        Generate embedding for a single text.

        Args:
            text: String to embed
            model: Model to use (defaults to embed model)

        Returns:
            Embedding vector
        """
        embeddings = await self.embed_async([text], model=model)
        return embeddings[0]

    # ==========================================
    # Health Check
    # ==========================================

    def is_healthy(self) -> bool:
        """
        Check if Ollama server is running and responsive.

        Returns:
            True if healthy, False otherwise
        """
        try:
            # Simple health check via HTTP
            with httpx.Client() as client:
                response = client.get(f"{self._base_url}/api/tags", timeout=5.0)
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Ollama health check failed: {e}")
            return False

    async def is_healthy_async(self) -> bool:
        """
        Check if Ollama server is running and responsive (async).

        Returns:
            True if healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self._base_url}/api/tags", timeout=5.0)
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Ollama health check failed: {e}")
            return False


# Singleton instance
_client: OllamaClient | None = None


def get_ollama_client() -> OllamaClient:
    """Get the Ollama client singleton."""
    global _client
    if _client is None:
        _client = OllamaClient()
    return _client