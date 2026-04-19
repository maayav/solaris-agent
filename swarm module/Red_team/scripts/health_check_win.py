"""
Health check script - verifies all infrastructure services are running.
Windows-compatible version.

Usage:
    python scripts/health_check_win.py
"""

from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from core.config import settings
from core.redis_bus import redis_bus
from core.platform_compat import SYMBOLS, COLORS, IS_WINDOWS

# Status indicators
PASS = f"{COLORS['green']}{SYMBOLS['check']}{COLORS['reset']}"
FAIL = f"{COLORS['red']}{SYMBOLS['cross']}{COLORS['reset']}"
WARN = f"{COLORS['yellow']}{SYMBOLS['warn']}{COLORS['reset']}"


async def check_redis():
    try:
        await redis_bus.connect()
        pong = await redis_bus.ping()
        await redis_bus.disconnect()
        return pong
    except Exception:
        return False


async def check_ollama():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def check_ollama_models():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            data = resp.json()
            return [m.get('name', '') for m in data.get('models', [])]
    except Exception:
        return []


async def check_juice_shop():
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(settings.juice_shop_url)
            return resp.status_code == 200
    except Exception:
        return False


async def check_openrouter():
    if not settings.openrouter_api_key or settings.openrouter_api_key.startswith("sk-or-v1-your"):
        return None  # Not configured
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            )
            return resp.status_code == 200
    except Exception:
        return False


async def check_docker():
    """Check if Docker is available."""
    try:
        import docker
        client = docker.from_env()
        client.ping()
        return True
    except Exception:
        return False


async def main():
    print(f"\n  {SYMBOLS['magnifier']} Red Team Infrastructure Health Check\n")
    print(f"  {'Service':<30} {'Status':<10} {'Details'}")
    print(f"  {'-' * 70}")

    # Redis
    redis_ok = await check_redis()
    print(f"  {'Redis (message bus)':<30} {PASS if redis_ok else FAIL:<10} {settings.redis_url}")

    # Ollama
    ollama_ok = await check_ollama()
    print(f"  {'Ollama (local LLM)':<30} {PASS if ollama_ok else FAIL:<10} {settings.ollama_base_url}")

    if ollama_ok:
        models = await check_ollama_models()
        needed = [settings.recon_model, settings.exploit_model]
        for model in needed:
            found = any(model in m for m in models)
            status = PASS if found else WARN
            detail = 'available' if found else f'not found - run: ollama pull {model}'
            print(f"  {'  -> ' + model:<30} {status:<10} {detail}")

    # Docker
    docker_ok = await check_docker()
    print(f"  {'Docker (sandbox)':<30} {PASS if docker_ok else FAIL:<10} {'Running' if docker_ok else 'Not available'}")

    # Juice Shop
    js_ok = await check_juice_shop()
    print(f"  {'Juice Shop (target)':<30} {PASS if js_ok else FAIL:<10} {settings.juice_shop_url}")

    # OpenRouter
    or_ok = await check_openrouter()
    if or_ok is None:
        print(f"  {'OpenRouter (cloud LLM)':<30} {WARN:<10} Not configured (optional)")
    else:
        print(f"  {'OpenRouter (cloud LLM)':<30} {PASS if or_ok else FAIL:<10} {'Connected' if or_ok else 'Connection failed'}")

    # Summary
    all_ok = redis_ok and ollama_ok and js_ok and docker_ok
    print(f"\n  {'=' * 70}")
    if all_ok:
        print(f"  {SYMBOLS['check']} All critical services are running!")
    else:
        print(f"  {SYMBOLS['warn']} Some services are not available. Check details above.")
    print(f"  {'=' * 70}\n")

    return 0 if all_ok else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
