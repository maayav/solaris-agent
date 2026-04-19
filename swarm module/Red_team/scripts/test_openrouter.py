"""
Test OpenRouter API connectivity.

Usage:
    python scripts/test_openrouter.py
"""

from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import settings
from core.platform_compat import COLORS, SYMBOLS


async def test_openrouter():
    """Test OpenRouter API with configured models."""
    import httpx
    
    print(f"{COLORS['system']}")
    print("=" * 60)
    print("  OPENROUTER API TEST")
    print("=" * 60)
    print(f"{COLORS['reset']}")
    
    print(f"Base URL: {settings.openrouter_base_url}")
    print(f"API Key: {'✓ Set' if settings.openrouter_api_key else '✗ Not Set'}")
    print()
    
    if not settings.openrouter_api_key:
        print(f"{SYMBOLS['cross']} OPENROUTER_API_KEY not configured in .env")
        return False
    
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": "https://vibecheck.local",
        "Content-Type": "application/json",
    }
    
    # Test all configured models
    models = [
        ("Commander", settings.commander_model),
        ("Recon", settings.recon_model),
        ("Exploit", settings.exploit_model),
        ("Critic", settings.critic_model),
    ]
    
    all_passed = True
    
    for name, model in models:
        print(f"\n{COLORS['system']}Testing {name} model: {model}{COLORS['reset']}")
        print("-" * 40)
        
        # Skip Ollama models (no "/" in name)
        if "/" not in model:
            print(f"  {SYMBOLS['warn']} Skipped - Ollama model (use Ollama directly)")
            continue
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.openrouter_base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": "You are a security testing AI."},
                            {"role": "user", "content": "Say 'OpenRouter test successful' in exactly 4 words."}
                        ],
                        "max_tokens": 50,
                        "temperature": 0.1,
                    },
                )
                
                if response.status_code == 200:
                    result = response.json()
                    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                    print(f"  {SYMBOLS['check']} Success!")
                    print(f"     Response: {content[:80]}...")
                else:
                    print(f"  {SYMBOLS['cross']} Failed: HTTP {response.status_code}")
                    print(f"     Error: {response.text[:100]}")
                    all_passed = False
                    
        except Exception as e:
            print(f"  {SYMBOLS['cross']} Error: {e}")
            all_passed = False
    
    print(f"\n{COLORS['system']}{'=' * 60}{COLORS['reset']}")
    if all_passed:
        print(f"{SYMBOLS['check']} All OpenRouter models working!")
    else:
        print(f"{SYMBOLS['warn']} Some models failed - will fallback to Ollama")
    print()
    
    return all_passed


def main():
    result = asyncio.run(test_openrouter())
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
