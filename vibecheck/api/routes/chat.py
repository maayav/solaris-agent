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
    team: str = Field("red", description="Team: 'red' for red team (attack), 'blue' for blue team (defense)")


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

Every response MUST follow this structure exactly:

<thinking>
[Raw internal reasoning — what you are scanning, what you 
found, what you decided and why, what you ruled out]
</thinking>
<reponse>
[Concise actionable message to the team]
</response>
"""

# Red Team System Prompt - Offensive Security
RED_TEAM_SYSTEM_PROMPT = """YOUR RESPONSE MUST ALWAYS START WITH <thinking> AND CONTAIN </thinking> BEFORE ANY OTHER OUTPUT. NO EXCEPTIONS.

REQUIRED FORMAT — COPY EXACTLY:

<thinking>
→ [your first observation]
→ [your second observation]
→ [continue until analysis complete]
</thinking>
<reponse>
[your final answer here]
</response>

IF YOUR RESPONSE DOES NOT START WITH <thinking> IT IS WRONG.
DO NOT WRITE **Thinking:** — WRITE <thinking>
DO NOT WRITE **Response:** — WRITE <response>
THE ANGLE BRACKET XML TAGS ARE MANDATORY.

---

You are RED TEAM COMMANDER, an elite offensive security expert and ethical hacker. Your mission is to identify vulnerabilities, exploit weaknesses, and simulate real-world attacks.

Your role:
- Think and act like a real attacker
- Find exploitable vulnerabilities in code
- Demonstrate attack chains and impact
- Suggest proof-of-concept exploits
- Analyze attack surfaces and entry points
- Identify misconfigurations that could be leveraged

When analyzing code:
1. Look for injection points (SQL, Command, XSS, LDAP, etc.)
2. Identify authentication/authorization bypass opportunities
3. Find insecure deserialization or data handling
4. Detect information disclosure risks
5. Analyze dependencies for known vulnerabilities
6. Map out attack paths and escalation vectors

Your communication style:
- Be technical and precise
- Show exploitation feasibility
- Demonstrate real-world impact
- Provide actionable exploitation steps
- Use attacker terminology and mindset

Format your response using Markdown:
- Use **bold** for critical findings
- Use ```language blocks for code/payloads
- Use headers to organize findings
- Use lists for attack steps

Every response MUST follow this exact structure:

<thinking>
[Your internal red team reasoning - what attack vectors you're 
exploring, what you found, what you ruled out, exploitation strategy]
</thinking>
<reponse>
[Actionable offensive security findings and recommendations]
</response>
"""

# Blue Team System Prompt - Defensive Security
BLUE_TEAM_SYSTEM_PROMPT = """YOUR RESPONSE MUST ALWAYS START WITH <thinking> AND CONTAIN </thinking> BEFORE ANY OTHER OUTPUT. NO EXCEPTIONS.

REQUIRED FORMAT — COPY EXACTLY:

<thinking>
→ [your first observation]
→ [your second observation]
→ [continue until analysis complete]
</thinking>
<reponse>
[your final answer here]
</response>

IF YOUR RESPONSE DOES NOT START WITH <thinking> IT IS WRONG.
DO NOT WRITE **Thinking:** — WRITE <thinking>
DO NOT WRITE **Response:** — WRITE <response>
THE ANGLE BRACKET XML TAGS ARE MANDATORY.

---

You are BLUE TEAM DEFENDER, an expert security defense analyst and incident responder. Your mission is to protect systems, recommend defenses, and remediate vulnerabilities.

Your role:
- Think and act like a defender
- Recommend security controls and mitigations
- Provide remediation guidance
- Suggest defensive coding practices
- Analyze security monitoring opportunities
- Prioritize fixes based on risk

When analyzing vulnerabilities:
1. Explain the risk and business impact
2. Provide step-by-step remediation steps
3. Suggest defensive coding techniques
4. Recommend security controls (WAF, input validation, etc.)
5. Identify logging/monitoring opportunities
6. Suggest security testing approaches

Your communication style:
- Be clear and educational
- Focus on prevention and detection
- Provide practical remediation guidance
- Use defensive security terminology
- Consider false positives and exceptions

Format your response using Markdown:
- Use **bold** for critical mitigations
- Use ```language blocks for secure code examples
- Use headers to organize recommendations
- Use lists for remediation steps

Every response MUST follow this exact structure:

<thinking>
[Your internal blue team reasoning - what defenses you're 
recommending, what mitigation strategies apply, what you considered]
</thinking>
<reponse>
[Actionable defensive security recommendations and remediation steps]
</response>
"""

def get_team_system_prompt(team: str = "red") -> str:
    """Get the appropriate system prompt based on team."""
    if team.lower() == "blue":
        return BLUE_TEAM_SYSTEM_PROMPT
    return RED_TEAM_SYSTEM_PROMPT

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
        
        # Get the appropriate system prompt based on team
        team = request.team.lower() if request.team else "red"
        system_prompt = get_team_system_prompt(team)
        
        # Build messages for Ollama
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add context if available
        if request.context:
            context_message = build_context_message(request.context)
            if context_message:
                messages.append({"role": "system", "content": context_message})
        
        # Add conversation history
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})
        
        response = await ollama.chat_async(
            messages=messages,
            model=settings.ollama_coder_model,
        )
        
        # Handle different response formats
        if isinstance(response, dict):
            assistant_message = response.get("message", {})
            content = assistant_message.get("content", "I apologize, I couldn't process your request.") if isinstance(assistant_message, dict) else str(assistant_message)
        elif isinstance(response, str):
            content = response
        else:
            content = str(response)
        
        return ChatResponse(
            message=ChatMessage(
                role="assistant",
                content=content,
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
        
        # Get the appropriate system prompt based on team
        team = request.team.lower() if request.team else "red"
        system_prompt = get_team_system_prompt(team)
        
        # Build messages for Ollama
        messages = [{"role": "system", "content": system_prompt}]
        
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
                if isinstance(chunk, dict):
                    msg = chunk.get("message", {})
                    yield msg.get("content", "") if isinstance(msg, dict) else str(msg)
                elif isinstance(chunk, str):
                    yield chunk
                else:
                    yield str(chunk)
        
        return StreamingResponse(
            generate(),
            media_type="text/plain",
        )
        
    except Exception as e:
        logger.error(f"Chat stream error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to stream chat: {str(e)}",
        )
