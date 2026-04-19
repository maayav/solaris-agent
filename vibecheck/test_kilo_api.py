"""
Test script to verify Kilo Code API connectivity.

Run this before starting the scan worker to ensure API keys are working.
"""

import asyncio
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.config import get_settings


async def test_kilo_code():
    """Test Kilo Code API connectivity."""
    import httpx
    
    settings = get_settings()
    
    print("=" * 60)
    print("Testing Kilo Code API")
    print("=" * 60)
    print(f"Base URL: {settings.kilo_base_url}")
    print(f"Primary Model: {settings.kilo_primary_model}")
    print(f"Fallback Model: {settings.kilo_fallback_model}")
    print(f"API Key configured: {'Yes' if settings.kilo_api_key else 'NO - SKIPPING'}")
    print()
    
    if not settings.kilo_api_key:
        print("❌ KILO_API_KEY not configured in .env file")
        return False
    
    headers = {
        "Authorization": f"Bearer {settings.kilo_api_key}",
        "Content-Type": "application/json",
    }
    
    test_prompt = "Say 'Hello from VibeCheck test' in exactly 5 words."
    
    models_to_test = [
        ("Primary", settings.kilo_primary_model),
        ("Fallback", settings.kilo_fallback_model),
    ]
    
    all_passed = True
    
    for model_name, model_id in models_to_test:
        print(f"\nTesting {model_name} model: {model_id}")
        print("-" * 40)
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.kilo_base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model_id,
                        "messages": [{"role": "user", "content": test_prompt}],
                        "max_tokens": 50,
                        "temperature": 0.1,
                    },
                )
                
                print(f"Status: {response.status_code}")
                
                if response.status_code == 200:
                    result = response.json()
                    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                    print(f"✅ Success! Response: {content[:100]}...")
                else:
                    print(f"❌ Failed: {response.status_code}")
                    print(f"Response: {response.text[:200]}")
                    all_passed = False
                    
        except Exception as e:
            print(f"❌ Error: {e}")
            all_passed = False
    
    return all_passed


async def test_openrouter():
    """Test OpenRouter API connectivity."""
    import httpx
    
    settings = get_settings()
    
    print("\n" + "=" * 60)
    print("Testing OpenRouter API")
    print("=" * 60)
    print(f"Base URL: {settings.openrouter_base_url}")
    print(f"Primary Model: {settings.openrouter_primary_model}")
    print(f"API Key configured: {'Yes' if settings.openrouter_api_key else 'NO - SKIPPING'}")
    print()
    
    if not settings.openrouter_api_key:
        print("❌ OPENROUTER_API_KEY not configured in .env file")
        return False
    
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": settings.openrouter_http_referer,
        "Content-Type": "application/json",
    }
    
    test_prompt = "Say 'OpenRouter test successful' in exactly 3 words."
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                headers=headers,
                json={
                    "model": settings.openrouter_primary_model,
                    "messages": [{"role": "user", "content": test_prompt}],
                    "max_tokens": 50,
                    "temperature": 0.1,
                },
            )
            
            print(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                print(f"✅ Success! Response: {content[:100]}...")
                return True
            else:
                print(f"❌ Failed: {response.status_code}")
                print(f"Response: {response.text[:200]}")
                return False
                
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


async def test_ollama():
    """Test Ollama API connectivity."""
    import httpx
    
    settings = get_settings()
    
    print("\n" + "=" * 60)
    print("Testing Ollama API")
    print("=" * 60)
    print(f"Base URL: {settings.ollama_base_url}")
    print(f"Model: {settings.ollama_coder_model}")
    print()
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Test if Ollama is running
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            
            if response.status_code == 200:
                print(f"✅ Ollama is running")
                result = response.json()
                models = [m.get("name", "") for m in result.get("models", [])]
                print(f"Available models: {models}")
                
                if settings.ollama_coder_model in models:
                    print(f"✅ Model '{settings.ollama_coder_model}' is available")
                    return True
                else:
                    print(f"⚠️  Model '{settings.ollama_coder_model}' not found. Pull it with:")
                    print(f"   ollama pull {settings.ollama_coder_model}")
                    return False
            else:
                print(f"❌ Ollama returned status {response.status_code}")
                return False
                
    except Exception as e:
        print(f"❌ Ollama not accessible: {e}")
        print("   Make sure Ollama is running: ollama serve")
        return False


async def main():
    """Run all API tests."""
    print("\n🔍 VibeCheck LLM API Test Suite\n")
    
    # Test all three providers
    kilo_ok = await test_kilo_code()
    openrouter_ok = await test_openrouter()
    ollama_ok = await test_ollama()
    
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Kilo Code:    {'✅ PASS' if kilo_ok else '❌ FAIL'}")
    print(f"OpenRouter:   {'✅ PASS' if openrouter_ok else '❌ FAIL'}")
    print(f"Ollama:       {'✅ PASS' if ollama_ok else '❌ FAIL'}")
    print()
    
    if kilo_ok:
        print("🎉 Kilo Code is working as primary provider!")
    elif openrouter_ok:
        print("⚠️  Kilo Code failed, but OpenRouter is working as fallback")
    elif ollama_ok:
        print("⚠️  Cloud providers failed, but Ollama is working as final fallback")
    else:
        print("❌ No LLM providers are working. Check your configuration.")
        return 1
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
