"""
Core module for Project VibeCheck.

This module contains clients and utilities for:
- FalkorDB (Graph Database)
- Qdrant (Vector Database)
- Redis Streams (Message Bus)
- Ollama (Local LLM)
"""

from core.config import Settings, get_settings

__all__ = [
    "Settings",
    "get_settings",
]
