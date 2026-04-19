"""
Debug script to test OpenRouter API directly.
"""

import asyncio
import os
import sys
import json

# Add vibecheck to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.config import get_settings

import httpx

OPENROUTER_TIMEOUT = 120.0


async def test_openrouter():
    settings = get_settings()
    
    if not settings.openrouter_api_key:
        print("ERROR: OpenRouter API key not configured")
        return
    
    print(f"OpenRouter API Key: {settings.openrouter_api_key[:10]}...")
    print(f"Primary Model: {settings.openrouter_primary_model}")
    print(f"Fallback Model: {settings.openrouter_fallback_model}")
    print(f"Base URL: {settings.openrouter_base_url}")
    print("=" * 80)
    
    # Simple test prompt
    prompt = """You are a security expert analyzing code for vulnerabilities.

TASK: Verify if the following code contains a sql_injection vulnerability.

Rule that detected this: rules.taint-express-sqli

Code to analyze:
```
models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`)
```

Respond with ONLY this JSON format:
{
  "confirmed": true,
  "confidence": 0.9,
  "reason": "The code uses string interpolation with user input",
  "fix_suggestion": "Use parameterized queries",
  "severity": "high"
}"""

    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": settings.openrouter_http_referer,
        "Content-Type": "application/json",
    }
    
    models_to_try = [
        settings.openrouter_primary_model,
        settings.openrouter_fallback_model,
    ]
    
    async with httpx.AsyncClient(timeout=OPENROUTER_TIMEOUT) as client:
        for model in models_to_try:
            print(f"\n{'='*80}")
            print(f"Testing model: {model}")
            print(f"{'='*80}")
            
            try:
                response = await client.post(
                    f"{settings.openrouter_base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": "You are a security expert. Respond only with valid JSON."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.0,
                        "max_tokens": 500,
                        "provider": {
                            "order": ["Together", "DeepInfra", "Fireworks", "Nebius"],
                            "allow_fallbacks": True,
                            "ignore": ["Cloudflare"]
                        }
                    },
                )
                
                print(f"Status Code: {response.status_code}")
                print(f"Response Headers: {dict(response.headers)}")
                
                response.raise_for_status()
                result = response.json()
                
                print(f"\nFull Response:")
                print(json.dumps(result, indent=2))
                
                # Check for errors
                if "error" in result:
                    print(f"\nERROR in response: {result['error']}")
                    continue
                
                # Extract content
                choices = result.get("choices", [])
                if not choices:
                    print("\nERROR: No choices in response")
                    continue
                
                message = choices[0].get("message", {})
                content = message.get("content", "")
                
                print(f"\nContent Length: {len(content)}")
                print(f"Content Preview:\n{content[:500]}")
                
                # Try to parse as JSON using the same logic as llm_verifier
                def parse_json_response(text):
                    if not text or not text.strip():
                        return None
                    
                    text = text.strip()
                    
                    # Try direct parse
                    try:
                        result = json.loads(text)
                        if isinstance(result, dict):
                            return result
                    except json.JSONDecodeError:
                        pass

                    # Try to extract JSON from markdown code blocks
                    try:
                        import re
                        # Try with explicit json tag first
                        json_block_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', text)
                        if not json_block_match:
                            # Try without json tag
                            json_block_match = re.search(r'```\s*(\{[\s\S]*?\})\s*```', text)
                        if json_block_match:
                            json_str = json_block_match.group(1)
                            result = json.loads(json_str)
                            if isinstance(result, dict):
                                return result
                    except (json.JSONDecodeError, AttributeError):
                        pass

                    # Try to extract JSON object boundaries
                    try:
                        start = text.find("{")
                        end = text.rfind("}") + 1
                        if start >= 0 and end > start:
                            json_str = text[start:end]
                            result = json.loads(json_str)
                            if isinstance(result, dict):
                                return result
                    except json.JSONDecodeError:
                        pass
                    
                    return None
                
                parsed = parse_json_response(content)
                if parsed:
                    print(f"\nParsed JSON:")
                    print(json.dumps(parsed, indent=2))
                else:
                    print(f"\nFailed to parse JSON from content")
                    
            except httpx.HTTPStatusError as e:
                print(f"HTTP Error: {e}")
                print(f"Response text: {e.response.text}")
            except Exception as e:
                print(f"Error: {e}")
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_openrouter())
