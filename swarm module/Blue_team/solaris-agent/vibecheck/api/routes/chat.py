"""
Chat routes for Project VibeCheck.

Provides endpoints for:
- AI-powered chat about scan results
- Context-aware vulnerability discussions
"""

import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core.config import get_settings
from core.ollama import get_ollama_client

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()


# -------------------------------------------
# Request/Response Models
# -------------------------------------------

class ChatMessage(BaseModel):
    """Single chat message."""
    role: str = Field(..., description="Message role: user, assistant, or system")
    content: str = Field(..., description="Message content")


class ChatContext(BaseModel):
    """Context for chat conversation."""
    scan_id: str | None = None
    report: dict[str, Any] | None = None
    vulnerabilities: list[dict[str, Any]] | None = None


class ChatRequest(BaseModel):
    """Request model for chat endpoint."""
    messages: list[ChatMessage] = Field(..., description="Conversation history")
    context: ChatContext | None = Field(None, description="Scan context")


class ChatResponse(BaseModel):
    """Response model for chat endpoint."""
    message: ChatMessage
    conversation_id: str


# -------------------------------------------
# System Prompts
# -------------------------------------------

SYSTEM_PROMPT = """You are VibeCheck, an expert security analyst AI assistant. You help developers understand and fix security vulnerabilities in their code.

Your capabilities:
- Analyzing security scan results
- Explaining vulnerabilities in simple terms
- Providing code fix suggestions
- Answering questions about security best practices
- Helping prioritize vulnerability fixes

When discussing vulnerabilities:
1. Be clear and concise
2. Explain the security impact
3. Provide actionable remediation steps
4. Include code examples when helpful
5. Consider the context of the application

Always be helpful, accurate, and security-focused. If you're unsure about something, say so.

Format your responses using Markdown for better readability:
- Use **bold** for emphasis
- Use `code` for code snippets
- Use ```language blocks for multi-line code
- Use lists for multiple items
- Use headers to organize longer responses
"""

REPORT_CONTEXT_TEMPLATE = """
## Current Scan Context

**Scan ID:** {scan_id}
**Repository:** {repo_url}
**Status:** {status}

### Vulnerability Summary
- Critical: {critical_count}
- High: {high_count}
- Medium: {medium_count}
- Low: {low_count}
- Total: {total_vulnerabilities}
- Confirmed: {confirmed_count}

### Detected Vulnerabilities
{vulnerabilities_list}
"""


def build_context_message(context: ChatContext | None) -> str:
    """Build a context message from scan data."""
    if not context:
        return ""

    parts = []

    if context.report:
        report = context.report
        vulns_list = ""
        
        if context.vulnerabilities:
            for i, vuln in enumerate(context.vulnerabilities[:10], 1):  # Limit to 10
                vulns_list += f"\n{i}. **{vuln.get('type', 'Unknown')}** ({vuln.get('severity', 'Unknown')})\n"
                vulns_list += f"   - File: `{vuln.get('file_path', 'Unknown')}`\n"
                if vuln.get('line_start'):
                    vulns_list += f"   - Line: {vuln.get('line_start')}\n"
                if vuln.get('description'):
                    vulns_list += f"   - {vuln.get('description')[:200]}\n"

        parts.append(REPORT_CONTEXT_TEMPLATE.format(
            scan_id=context.scan_id or "Unknown",
            repo_url=report.get("repo_url", "Unknown"),
            status=report.get("status", "Unknown"),
            critical_count=report.get("critical_count", 0),
            high_count=report.get("high_count", 0),
            medium_count=report.get("medium_count", 0),
            low_count=report.get("low_count", 0),
            total_vulnerabilities=report.get("total_vulnerabilities", 0),
            confirmed_count=report.get("confirmed_count", 0),
            vulnerabilities_list=vulns_list or "No vulnerabilities detected.",
        ))

    return "\n".join(parts)


# -------------------------------------------
# Chat Endpoints
# -------------------------------------------

@router.post(
    "/",
    response_model=ChatResponse,
    summary="Send a chat message",
    description="Send a message to the AI assistant and get a response.",
)
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Chat with the AI assistant about scan results.
    
    The assistant has context about the current scan and can answer
    questions about vulnerabilities, suggest fixes, and explain security concepts.
    """
    try:
        ollama = get_ollama_client()
        
        # Build messages for Ollama
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        
        # Add context if available
        if request.context:
            context_message = build_context_message(request.context)
            if context_message:
                messages.append({"role": "system", "content": context_message})
        
        # Add conversation history
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})
        
        # Get response from Ollama
        response = await ollama.chat_async(
            messages=messages,
            model=settings.ollama_coder_model,
        )
        
        assistant_message = response.get("message", {})
        
        return ChatResponse(
            message=ChatMessage(
                role="assistant",
                content=assistant_message.get("content", "I apologize, I couldn't process your request."),
            ),
            conversation_id=str(uuid4()),
        )
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process chat: {str(e)}",
        )


@router.post(
    "/stream",
    summary="Stream chat response",
    description="Send a message and receive a streaming response.",
)
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """
    Stream a chat response from the AI assistant.
    
    This endpoint returns a streaming response for better UX with long responses.
    """
    try:
        ollama = get_ollama_client()
        
        # Build messages for Ollama
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        
        # Add context if available
        if request.context:
            context_message = build_context_message(request.context)
            if context_message:
                messages.append({"role": "system", "content": context_message})
        
        # Add conversation history
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})
        
        async def generate():
            async for chunk in ollama.chat_stream_async(
                messages=messages,
                model=settings.ollama_coder_model,
            ):
                yield chunk
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
        )
        
    except Exception as e:
        logger.error(f"Chat stream error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stream chat: {str(e)}",
        )
