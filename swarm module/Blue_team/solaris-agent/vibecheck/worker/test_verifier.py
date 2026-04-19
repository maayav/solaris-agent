"""
Test script for LLM verifier - debug tool to see exactly what Ollama returns.

Usage:
    cd vibecheck
    python -m worker.test_verifier

This will show:
1. Raw Ollama response
2. Parsed result
3. Whether the issue is prompt, parsing, or model behavior
"""

import asyncio
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from worker.llm_verifier import verify_candidate, _parse_json_response
from core.config import get_settings
import httpx

# Get settings for Ollama configuration
settings = get_settings()
OLLAMA_URL = settings.ollama_base_url
OLLAMA_MODEL = settings.ollama_coder_model  # Use the correct field name


# Known-bad snippet from juice-shop that SHOULD be confirmed
TEST_CANDIDATE_SQLI = {
    "vuln_type": "sql_injection",
    "rule_id": "javascript.sequelize.security.audit.sequelize-injection",
    "file_path": "routes/search.ts",
    "line_start": 10,
    "code_snippet": "models.sequelize.query(`SELECT * FROM Products WHERE name LIKE '%${criteria}%'`)",
    "message": "Sequelize query constructed with user input",
    "severity": "high",
}

# Known XSS snippet
TEST_CANDIDATE_XSS = {
    "vuln_type": "xss",
    "rule_id": "javascript.express.security.xss",
    "file_path": "routes/userProfile.ts",
    "line_start": 25,
    "code_snippet": "res.send(`<div>Welcome ${user.name}</div>`)",
    "message": "User input directly rendered in HTML response",
    "severity": "high",
}

# Path traversal snippet
TEST_CANDIDATE_PATH_TRAVERSAL = {
    "vuln_type": "path_traversal",
    "rule_id": "javascript.fs.security.path-traversal",
    "file_path": "routes/fileServer.ts",
    "line_start": 15,
    "code_snippet": "fs.readFile(path.join(__dirname, req.params.filename))",
    "message": "User input used in file path without sanitization",
    "severity": "high",
}


async def test_raw_ollama_response():
    """Test what Ollama actually returns for our prompt."""
    print("=" * 60)
    print("TEST 1: Raw Ollama Response")
    print("=" * 60)
    print(f"Ollama URL: {OLLAMA_URL}")
    print(f"Model: {OLLAMA_MODEL}")
    print()
    
    # Build the exact prompt that verify_candidate uses
    candidate = TEST_CANDIDATE_SQLI
    
    prompt = f"""You are a penetration tester analyzing potential security vulnerabilities.

Analyze this code for security issues:

File: {candidate['file_path']}
Lines: {candidate['line_start']}
Vulnerability Type: {candidate['vuln_type']}
Rule: {candidate['rule_id']}
Code:
```
{candidate['code_snippet']}
```

Context: {candidate['message']}

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "is_test_fixture": true/false,
  "severity": "critical/high/medium/low"
}}"""
    
    print("Prompt being sent:")
    print("-" * 40)
    print(prompt)
    print("-" * 40)
    print()
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.1,
                        "num_predict": 512,
                    }
                }
            )
            
            if response.status_code != 200:
                print(f"ERROR: Ollama returned status {response.status_code}")
                print(f"Response: {response.text}")
                return None
            
            data = response.json()
            raw_response = data.get("response", "")
            
            print("Raw Ollama response:")
            print("-" * 40)
            print(raw_response)
            print("-" * 40)
            print()
            
            return raw_response
            
    except Exception as e:
        print(f"ERROR: Failed to call Ollama: {e}")
        return None


async def test_json_parsing(response_text: str):
    """Test the JSON parsing function."""
    print("=" * 60)
    print("TEST 2: JSON Parsing")
    print("=" * 60)
    
    if not response_text:
        print("No response text to parse")
        return None
    
    parsed = _parse_json_response(response_text)
    
    print(f"Parsed result: {json.dumps(parsed, indent=2)}")
    print()
    
    return parsed


async def test_verify_candidate():
    """Test the full verify_candidate function."""
    print("=" * 60)
    print("TEST 3: Full verify_candidate() Function")
    print("=" * 60)
    
    candidates = [
        ("SQL Injection", TEST_CANDIDATE_SQLI),
        ("XSS", TEST_CANDIDATE_XSS),
        ("Path Traversal", TEST_CANDIDATE_PATH_TRAVERSAL),
    ]
    
    for name, candidate in candidates:
        print(f"\nTesting {name}...")
        print(f"  Code: {candidate['code_snippet'][:60]}...")
        
        result = await verify_candidate(candidate)
        
        print(f"  Result:")
        print(f"    confirmed:   {result.get('confirmed')}")
        print(f"    confidence:  {result.get('confidence')}")
        print(f"    reason:      {result.get('verification_reason', result.get('reason', 'N/A'))}")
        print(f"    is_fixture:  {result.get('is_test_fixture')}")
        print(f"    severity:    {result.get('severity')}")


async def test_ollama_connection():
    """Test basic Ollama connectivity."""
    print("=" * 60)
    print("TEST 0: Ollama Connection")
    print("=" * 60)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            
            if response.status_code == 200:
                data = response.json()
                models = [m.get("name") for m in data.get("models", [])]
                print(f"[OK] Ollama is running")
                print(f"  Available models: {models}")
                
                if OLLAMA_MODEL not in models:
                    print(f"  WARNING: Model '{OLLAMA_MODEL}' not found!")
                    print(f"  You may need to pull it: ollama pull {OLLAMA_MODEL}")
                else:
                    print(f"  [OK] Model '{OLLAMA_MODEL}' is available")
                return True
            else:
                print(f"[FAIL] Ollama returned status {response.status_code}")
                return False
                
    except Exception as e:
        print(f"[FAIL] Failed to connect to Ollama: {e}")
        print(f"  Make sure Ollama is running: ollama serve")
        return False


async def main():
    print("\n" + "=" * 60)
    print("LLM VERIFIER DEBUG TOOL")
    print("=" * 60)
    print()
    
    # Test 0: Connection
    connected = await test_ollama_connection()
    print()
    
    if not connected:
        print("Cannot proceed without Ollama connection.")
        return
    
    # Test 1: Raw response
    raw_response = await test_raw_ollama_response()
    print()
    
    # Test 2: JSON parsing
    if raw_response:
        await test_json_parsing(raw_response)
    
    # Test 3: Full function
    await test_verify_candidate()
    
    print("\n" + "=" * 60)
    print("DIAGNOSIS GUIDE")
    print("=" * 60)
    print("""
If confirmed is always false:
  → Prompt needs tuning - model is too conservative
  → Try changing "code security auditor" to "penetration tester"

If JSON parsing fails:
  → _parse_json_response needs improvement
  → Check if model is adding markdown code blocks

If is_test_fixture is true:
  → Model thinks the code is test code
  → Prompt needs to clarify this is production code

If timeout/connection errors:
  → Ollama isn't reachable at the configured URL
  → Check OLLAMA_URL in environment

If model not found:
  → Run: ollama pull qwen2.5-coder:14b-instruct
""")


if __name__ == "__main__":
    asyncio.run(main())
