"""
Robust JSON parsing utilities for LLM output.

PentAGI v4.0 enhancements:
  - Removed "error"/"failed" from refusal patterns (valid in security output)
  - Added truncated JSON completion (closes unclosed braces/brackets)
  - Parse failures logged to Redis for critic analysis
  - Max 3 parse retries before marking task failed
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, TypeVar, Callable

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)


# Patterns that indicate the LLM is refusing
# NOTE: "error" and "failed" REMOVED — they appear in valid security tool output
# e.g. "SQL syntax error" or "login failed" are valid exploit results
REFUSAL_PATTERNS = [
    r"i cannot",
    r"i can't",
    r"unable to",
    r"not able to",
    r"cannot fulfill",
    r"i apologize",
    r"i'm sorry",
]

# Patterns for conversational filler that should be stripped
CONVERSATIONAL_FILLER_PATTERNS = [
    r"^(?:I'm sorry,? but )?I cannot[^.]*\.?\s*",
    r"^(?:I'm sorry,? but )?I can't[^.]*\.?\s*",
    r"^Sure,? here is[^:]*:\s*",
    r"^Here is[^:]*:\s*",
    r"^Okay,?\s*",
    r"^Certainly!?\s*",
    r"^Of course!?\s*",
    r"^As requested,?\s*",
    r"^The following is[^:]*:\s*",
    r"^Below is[^:]*:\s*",
    r"^I've [^\.]+\.\s*",
    r"^Let me[^\.]+\.\s*",
]

# Patterns that indicate JSON-like content that needs extraction
JSON_EXTRACTION_PATTERNS = [
    r'\{[^{}]*\}',  # Simple {}
    r'\[[^\[\]]*\]',  # Simple []
    r'\{.+\}',  # Greedy {}
    r'\[.+\]',  # Greedy []
]


def _strip_conversational_filler(text: str) -> str:
    """
    Strip conversational filler and preamble from LLM output.
    
    Removes phrases like "Sure, here is:", "I'm sorry, I cannot...", etc.
    """
    text = text.strip()
    
    # Apply all conversational filler patterns
    for pattern in CONVERSATIONAL_FILLER_PATTERNS:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE)
    
    return text.strip()


def extract_json_from_text(text: str) -> dict | list | None:
    """
    Extract JSON from potentially messy LLM output.
    
    Tries multiple strategies:
    1. Strip conversational filler
    2. Direct parse
    3. Markdown code block extraction
    4. Regex extraction
    5. Bracket matching
    6. Truncated JSON completion
    """
    if not text:
        return None
    
    # Clean the text - strip conversational filler first
    text = _strip_conversational_filler(text)
    text = text.strip()
    
    # Strategy 1: Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # Strategy 2: Extract from markdown code blocks
    # ```json ... ``` or ``` ... ```
    code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text, re.IGNORECASE)
    if code_block_match:
        try:
            return json.loads(code_block_match.group(1).strip())
        except json.JSONDecodeError:
            # Try completing truncated JSON from code block
            completed = _complete_truncated_json(code_block_match.group(1).strip())
            if completed is not None:
                return completed
    
    # Strategy 3: Find JSON object in text
    # Look for { ... } pattern
    json_match = re.search(r'(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # Strategy 4: Look for array
    array_match = re.search(r'(\[[\s\S]*\])', text)
    if array_match:
        try:
            return json.loads(array_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # Strategy 5: Try completing truncated JSON
    completed = _complete_truncated_json(text)
    if completed is not None:
        return completed
    
    return None


def _complete_truncated_json(text: str) -> dict | list | None:
    """
    Attempt to complete truncated JSON by closing unclosed braces/brackets.
    Handles cases where LLM output was cut off mid-JSON.
    """
    text = text.strip()
    if not text:
        return None
    
    # Find the start of JSON
    start_idx = -1
    for i, ch in enumerate(text):
        if ch in ('{', '['):
            start_idx = i
            break
    
    if start_idx < 0:
        return None
    
    text = text[start_idx:]
    
    # Count unclosed braces/brackets
    stack = []
    in_string = False
    escape_next = False
    
    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if ch == '\\':
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']'):
            if stack:
                stack.pop()
    
    if not stack:
        return None  # Already balanced or no JSON structure
    
    # Remove trailing comma before closing
    completed = text.rstrip().rstrip(',')
    
    # Close all unclosed braces/brackets
    for closer in reversed(stack):
        completed += closer
    
    try:
        return json.loads(completed)
    except json.JSONDecodeError:
        return None


def parse_with_retry(
    text: str,
    schema: type[T] | None = None,
    max_retries: int = 3,
    on_failure: Callable[[str], dict] | None = None,
) -> dict | T | None:
    """
    Parse LLM output with retry mechanism.
    
    Args:
        text: Raw LLM output
        schema: Optional Pydantic model to validate against
        max_retries: Number of retry attempts (increased to 3 for aggressive repair)
        on_failure: Optional callback to generate fixed prompt
        
    Returns:
        Parsed dict or Pydantic model, or None if all strategies fail
    """
    # First attempt - direct parse
    result = _try_parse(text, schema)
    if result is not None:
        return result
    
    # Retry with progressive cleaning strategies
    strategies = [
        ("common_fixes", _fix_common_json_issues),
        ("aggressive_repair", aggressive_json_repair),
        ("sanitize_output", lambda x: aggressive_json_repair(_fix_common_json_issues(x))),
    ]
    
    for attempt, (strategy_name, strategy_func) in enumerate(strategies[:max_retries]):
        logger.warning(f"JSON parse failed, attempt {attempt + 1}/{max_retries} using {strategy_name}")
        
        fixed_text = strategy_func(text)
        result = _try_parse(fixed_text, schema)
        if result is not None:
            logger.info(f"JSON parse succeeded on attempt {attempt + 1} using {strategy_name}")
            return result
    
    # Final attempt: use sanitize_json_output which has the most aggressive strategies
    logger.warning("Standard repairs failed, trying aggressive sanitization")
    sanitized = sanitize_json_output(text)
    if sanitized is not None:
        if schema is not None:
            try:
                if isinstance(sanitized, dict):
                    return schema(**sanitized)
                elif isinstance(sanitized, list) and sanitized and isinstance(sanitized[0], dict):
                    return schema(**sanitized[0])
            except ValidationError:
                pass
        return sanitized
    
    # Last resort: call the failure callback if provided
    if on_failure:
        logger.warning("All parse attempts failed, calling failure handler")
        return on_failure(text)
    
    # Log to Redis for critic analysis (fire-and-forget)
    _log_parse_failure_async(text)
    
    return None


def _log_parse_failure_async(text: str) -> None:
    """Fire-and-forget parse failure logging to Redis."""
    try:
        import asyncio
        from core.redis_bus import redis_bus
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(
                redis_bus.log_parse_failure("current", "parsing", text[:500])
            )
    except Exception:
        pass  # Non-critical — don't crash on logging failure


def _try_parse(text: str, schema: type[T] | None) -> dict | T | None:
    """Try to parse text as JSON, optionally validating against schema."""
    
    # Check for refusals — only check clear refusal patterns, not "error"/"failed"
    text_lower = text.lower().strip()
    # Only match refusals at the START of text (not embedded in JSON)
    for pattern in REFUSAL_PATTERNS:
        if re.match(pattern, text_lower):
            logger.warning(f"LLM refusal detected: {pattern}")
            return None
    
    # Extract JSON
    parsed = extract_json_from_text(text)
    if parsed is None:
        return None
    
    # Validate against schema if provided
    if schema is not None:
        try:
            if isinstance(parsed, dict):
                return schema(**parsed)
            elif isinstance(parsed, list):
                # For lists, return first dict if schema expects dict
                if parsed and isinstance(parsed[0], dict):
                    return schema(**parsed[0])
        except ValidationError as e:
            logger.warning(f"Schema validation failed: {e}")
            return None
    
    return parsed


def _fix_common_json_issues(text: str) -> str:
    """Fix common JSON formatting issues in LLM output."""
    
    # Remove markdown code block markers
    text = re.sub(r'^```json\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^```\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'```$', '', text)
    
    # Remove leading/trailing text that might confuse parser
    # Keep only the JSON-like content
    lines = text.split('\n')
    json_lines = []
    in_json = False
    brace_count = 0
    
    for line in lines:
        # Skip empty lines at start
        if not json_lines and not line.strip():
            continue
            
        # Start of JSON
        if '{' in line or '[' in line:
            in_json = True
            
        if in_json:
            json_lines.append(line)
            brace_count += line.count('{') - line.count('}')
            brace_count += line.count('[') - line.count(']')
            
            # End of JSON
            if brace_count == 0 and '{' in ''.join(json_lines):
                break
    
    if json_lines:
        return '\n'.join(json_lines)
    
    return text


def aggressive_json_repair(text: str) -> str:
    """
    Aggressively repair JSON with invalid control characters and other issues.
    
    This function handles:
    - Invalid control characters (0x00-0x1F, except allowed ones)
    - Unescaped newlines in strings
    - Trailing commas
    - Missing quotes around keys
    - Single quotes instead of double quotes
    """
    if not text:
        return "{}"
    
    # Remove null bytes and other invalid control characters
    # Only allow: tab (0x09), newline (0x0A), carriage return (0x0D)
    allowed_controls = {'\t', '\n', '\r'}
    cleaned = []
    for char in text:
        if char in allowed_controls:
            cleaned.append(char)
        elif ord(char) < 0x20:  # Control characters below space
            continue  # Skip invalid control characters
        else:
            cleaned.append(char)
    text = ''.join(cleaned)
    
    # Replace unescaped newlines within strings with \n
    # This is a heuristic approach - find strings and escape newlines inside them
    result = []
    in_string = False
    escape_next = False
    
    for char in text:
        if escape_next:
            result.append(char)
            escape_next = False
            continue
            
        if char == '\\':
            result.append(char)
            escape_next = True
            continue
            
        if char == '"':
            in_string = not in_string
            result.append(char)
            continue
            
        if in_string and char in '\n\r\t':
            # Replace with escaped version
            if char == '\n':
                result.append('\\n')
            elif char == '\r':
                result.append('\\r')
            elif char == '\t':
                result.append('\\t')
            continue
            
        result.append(char)
    
    text = ''.join(result)
    
    # Remove trailing commas before closing braces/brackets
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    
    # Try to fix single-quoted strings (convert to double-quoted)
    # This is a simplified approach - replace 'key': with "key":
    text = re.sub(r"'([^']+)':\s*", r'"\1": ', text)
    
    # Fix missing quotes around keys (e.g., {key: "value"} -> {"key": "value"})
    # Match word characters followed by colon at the start of an object
    text = re.sub(r'([{\[,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1"\2":', text)
    
    return text


def sanitize_json_output(text: str) -> dict | list | None:
    """
    Sanitize and parse JSON output with multiple fallback strategies.
    
    This is the most aggressive parser that tries everything to extract valid JSON.
    Returns None if all strategies fail.
    """
    if not text:
        return None
    
    # Strategy 1: Direct parse after stripping
    cleaned = text.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    
    # Strategy 2: Apply common fixes
    fixed = _fix_common_json_issues(cleaned)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass
    
    # Strategy 3: Aggressive repair for control characters and other issues
    repaired = aggressive_json_repair(fixed)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        pass
    
    # Strategy 4: Try to extract just the JSON object/array using regex
    # Look for outermost braces or brackets
    for pattern in [r'\{[\s\S]*\}', r'\[[\s\S]*\]']:
        match = re.search(pattern, text)
        if match:
            try:
                extracted = match.group(0)
                # Try with aggressive repair
                extracted_repaired = aggressive_json_repair(extracted)
                return json.loads(extracted_repaired)
            except (json.JSONDecodeError, ValueError):
                continue
    
    # Strategy 5: Try truncated JSON completion
    completed = _complete_truncated_json(text)
    if completed is not None:
        return completed
    
    # Strategy 6: Manual key-value extraction for simple objects
    # This handles cases like {key: "value", key2: 123}
    try:
        simple_obj_match = re.search(r'\{([^}]*)\}', text)
        if simple_obj_match:
            inner = simple_obj_match.group(1)
            result = {}
            # Split by commas not inside quotes
            pairs = re.findall(r'["\']?([a-zA-Z_][a-zA-Z0-9_]*)["\']?\s*:\s*([^,]+)', inner)
            for key, value in pairs:
                value = value.strip()
                # Try to parse value as different types
                if value.lower() == 'true':
                    result[key] = True
                elif value.lower() == 'false':
                    result[key] = False
                elif value.lower() == 'null':
                    result[key] = None
                elif re.match(r'^-?\d+$', value):
                    result[key] = int(value)
                elif re.match(r'^-?\d+\.\d+$', value):
                    result[key] = float(value)
                elif value.startswith('"') and value.endswith('"'):
                    result[key] = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    result[key] = value[1:-1]
                else:
                    result[key] = value
            return result
    except Exception:
        pass
    
    return None


async def retry_json_parse(
    llm_call: Callable,
    prompt: str,
    schema: type[T] | None = None,
    max_retries: int = 2,
) -> dict | T | None:
    """
    Call LLM and parse response with retry.
    
    If parsing fails, sends a follow-up prompt asking the LLM to fix the JSON.
    """
    # First call
    response = await llm_call(prompt)
    
    # Try parsing
    result = parse_with_retry(response, schema)
    if result is not None:
        return result
    
    # Retry with fix prompt
    for attempt in range(max_retries):
        fix_prompt = f"""Your previous response was not valid JSON. 
Please respond ONLY with valid JSON, no other text.

Original request: {prompt}

Respond with valid JSON only:"""

        response = await llm_call(fix_prompt)
        result = parse_with_retry(response, schema)
        if result is not None:
            logger.info(f"Retry {attempt + 1} succeeded")
            return result
    
    return None
