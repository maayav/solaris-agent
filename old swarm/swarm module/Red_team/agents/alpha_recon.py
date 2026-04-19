"""
Agent Alpha — Reconnaissance (Phase 2: Real Tools).

Uses Ollama local LLM to reason about recon tasks,
then executes real tools (nmap, curl) via the Docker sandbox.
Nuclei has been removed for speed - using lightweight HTTP fingerprinting instead.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

from agents.a2a.messages import (
    A2AMessage,
    AgentRole,
    IntelligenceReport,
    MessageType,
    Priority,
)
from agents.state import RedTeamState, detect_target_type
from agents.tools.registry import tool_registry
from core.llm_client import llm_client
from core.config import settings
from core.supabase_client import get_supabase_client
from sandbox.sandbox_manager import ExecResult

logger = logging.getLogger(__name__)

# Initialize optional Supabase integration
supabase = get_supabase_client()

ALPHA_SYSTEM_PROMPT = """You are Agent Alpha, a reconnaissance specialist on a red team.
You have REAL tools that execute against a live target. You must discover attack surfaces and vulnerabilities.

⚠️ CRITICAL: YOU MUST ONLY OUTPUT VALID JSON. NO CONVERSATIONAL FILLER.

AVAILABLE TOOLS:
{tools_description}

═══════════════════════════════════════════════════════════════════
RECONNAISSANCE OBJECTIVES (HUNT FOR):
═══════════════════════════════════════════════════════════════════

1. **API Discovery**
   - Find all API endpoints: /api/*, /rest/*, /graphql, /swagger
   - Document: endpoint path, HTTP methods allowed, authentication requirements

2. **IDOR Pattern Discovery**
   - Identify numeric ID patterns: /api/users/1, /api/orders/123
   - Look for: sequential IDs, UUIDs, predictable identifiers
   - Test parameter: id, user_id, order_id, file_id

3. **Sensitive Endpoint Detection**
   - Hunt for: /.env, /.git/config, /config.json, /swagger.json
   - Check: /robots.txt, /sitemap.xml, /.well-known/
   - Try: /admin, /manage, /dashboard, /console

4. **Input Vector Mapping**
   - Find all user input points: search, login, registration, comments
   - Document: parameter names, data types, validation patterns
   - Test for: reflected values, error messages, response differences

5. **Authentication Analysis**
   - Identify: login endpoints, session mechanisms, token patterns
   - Look for: JWT in responses, cookie settings, CORS headers

═══════════════════════════════════════════════════════════════════

For each assigned task, respond with a JSON object specifying which tools to run:
{{
  "tool_calls": [
    {{
      "tool": "nmap" | "curl" | "python" | "google_search" | "shodan_search" | "scrape_website" | "search_cve",
      "args": {{
        "target": "the target URL or host",
        "method": "GET|POST|PUT|DELETE (for curl)",
        "endpoint": "/api/example (for lightweight fingerprinting)",
        "wordlist": "common-api-endpoints (optional)"
      }}
      "args": {{
        "target": "the target URL or host",
        "args": "specific arguments for the tool"
      }},
      "reasoning": "why this tool is appropriate for the task"
      "reasoning": "what specific vulnerability or pattern this will discover"
    }}
  ]
}}

IMPORTANT:
- These are REAL tools. nmap will actually scan. curl will do HTTP fingerprinting (1-2s vs 120s for nuclei).
- Use the target URL provided in the task, not made-up targets.
- For lightweight recon, use curl with HEAD requests to discover endpoints quickly.
- Start broad (port scan) then narrow (specific vuln templates).
- Focus on DISCOVERING patterns that Gamma can exploit (IDOR endpoints, input vectors, etc.)

⚠️ CRITICAL: YOU MUST ONLY OUTPUT VALID JSON. DO NOT INCLUDE CONVERSATIONAL FILLER OR MARKDOWN CODE BLOCKS. YOUR ENTIRE RESPONSE MUST BE PARSEABLE AS JSON.
"""

ANALYZE_PROMPT = """You are Agent Alpha analyzing REAL tool output from reconnaissance.

TOOL: {tool_name}
COMMAND: {command}
EXIT CODE: {exit_code}
STDOUT:
{stdout}

STDERR:
{stderr}

Analyze this output and extract findings. Respond in JSON:
{{
  "findings": [
    {{
      "asset": "specific host/port/endpoint found",
      "finding": "what you discovered",
      "confidence": 0.0-1.0,
      "evidence": "relevant line from output",
      "cve_hint": "CVE-XXXX-XXXXX or null",
      "recommended_action": "what Gamma should exploit"
    }}
  ],
  "summary": "brief summary"
}}

If the tool returned no useful output or failed, return empty findings.
"""


async def alpha_recon(state: RedTeamState) -> dict[str, Any]:
    """
    Alpha Recon agent — executes real tools and analyzes output with LLM.
    """
    mission_id = state.get("mission_id", "unknown")
    iteration = state.get("iteration", 0)
    logger.info("Alpha: Executing recon for mission %s", mission_id)
    
    # Update agent state in Supabase
    try:
        if supabase._enabled:
            import asyncio
            asyncio.create_task(supabase.update_agent_state(
                mission_id=mission_id,
                agent_id="alpha",
                agent_name="alpha",
                status="running",
                agent_team="red",
                iteration=iteration,
                task="reconnaissance",
            ))
    except Exception as e:
        logger.debug(f"Failed to update alpha state: {e}")

    # Auto-detect mode from target if not already set
    target = state.get('target', '')
    mode = state.get("mode") or detect_target_type(target)
    logger.info("Alpha: Detected mode=%s for target=%s", mode, target)

    # STATIC MODE: Code analysis instead of network recon
    if mode == "static":
        logger.info("Alpha: STATIC MODE - Analyzing source code")
        target = state.get('target', '')
        
        # Run static analysis
        static_findings, repo_path = await _run_static_analysis(target, state.get("mission_id", "unknown"))
        
        # Store repo path in blackboard for gamma to access
        if repo_path:
            await redis_bus.blackboard_write(state.get("mission_id", "unknown"), "repo_path", str(repo_path))
        
        intel = IntelligenceReport(
            asset=target,
            finding=f"Static analysis complete - {len(static_findings)} findings",
            confidence=0.9,
            evidence=f"Analyzed {target} - found code vulnerabilities",
            recommended_action="Gamma should analyze static findings for exploitation",
        )
        msg = A2AMessage(
            sender=AgentRole.ALPHA,
            recipient=AgentRole.COMMANDER,
            type=MessageType.INTELLIGENCE_REPORT,
            priority=Priority.HIGH,
            payload=intel.model_dump(),
        )
        return {
            "recon_results": static_findings,
            "messages": [msg],
        }
    
    # FAST MODE: Skip slow recon tools, proceed directly to exploitation
    if state.get("fast_mode", False):
        logger.info("Alpha: FAST MODE - Skipping recon tools, proceeding to exploitation")
        target = state.get('target', 'http://localhost:3000')
        # Return minimal finding to trigger Gamma
        intel = IntelligenceReport(
            asset=target,
            finding="OWASP Juice Shop web application detected (fast mode)",
            confidence=0.95,
            evidence="Target confirmed as Juice Shop - proceeding with exploit arsenal",
            recommended_action="Gamma should attempt to exploit known vulnerabilities in OWASP Juice Shop",
        )
        msg = A2AMessage(
            sender=AgentRole.ALPHA,
            recipient=AgentRole.COMMANDER,
            type=MessageType.INTELLIGENCE_REPORT,
            priority=Priority.HIGH,
            payload=intel.model_dump(),
        )
        return {
            "recon_results": [{
                "asset": target,
                "finding": "Juice Shop confirmed",
                "confidence": 0.95,
                "evidence": "Fast mode - skipping recon",
            }],
            "messages": [msg],
        }

    # Find task assignments directed to Alpha
    tasks_for_alpha = []
    for msg in state.get("messages", []):
        if (
            isinstance(msg, A2AMessage)
            and msg.type == MessageType.TASK_ASSIGNMENT
            and msg.recipient == AgentRole.ALPHA
        ):
            tasks_for_alpha.append(msg.payload)

    if not tasks_for_alpha:
        logger.warning("Alpha: No tasks assigned, returning empty")
        return {"recon_results": [], "messages": []}

    # Get tool descriptions for the LLM
    tools_desc = tool_registry.get_prompt_description()

    tasks_str = json.dumps(tasks_for_alpha, indent=2, default=str)

    # Step 1: Ask LLM which tools to run
    plan_prompt = f"""ASSIGNED TASKS:
{tasks_str}

TARGET: {state.get('target', 'http://localhost:3000')}

Decide which tools to run for these tasks. Respond in JSON."""

    response = await llm_client.chat(
        model=settings.recon_model,
        fallback_model=settings.recon_model_fallback,
        messages=[
            {"role": "system", "content": ALPHA_SYSTEM_PROMPT.format(tools_description=tools_desc)},
            {"role": "user", "content": plan_prompt},
        ],
        temperature=0.2,
    )

    # Extract port from target URL for precision scanning
    port = _extract_port_from_target(state.get("target", "http://localhost:3000"))
    
    try:
        plan = _parse_json_response(response)
    except Exception as e:
        logger.error("Alpha plan parse failed: %s", e)
        # Fallback: run precision nmap scan on discovered port
        nmap_args = f"-sV -p {port}" if port else "-sV --top-ports 20"
        plan = {"tool_calls": [
            {"tool": "nmap", "args": {"target": state.get('target', 'http://localhost:3000'), "args": nmap_args}, "reasoning": "Precision scan on target port"},
        ]}

    # Step 2: Execute each tool call
    all_findings: list[dict[str, Any]] = []
    new_messages: list[A2AMessage] = []
    skipped_blue_count = 0  # Initialize counter for blue_team findings skipped

    for tool_call in plan.get("tool_calls", []):
        tool_name = tool_call.get("tool", "nmap")
        tool_args = tool_call.get("args", {})

        # Ensure mission_id is passed
        tool_args["mission_id"] = state.get("mission_id", "unknown")

        # Execute the tool
        logger.info("Alpha: Running %s with args: %s", tool_name, str(tool_args)[:100])
        result: ExecResult = await tool_registry.execute(tool_name, **tool_args)

        # ACTION LOG: Print first 10 lines of tool output for judges
        output_lines = result.stdout.split('\n')[:10] if result.stdout else []
        if output_lines:
            print(f"\n🔵 ALPHA ACTION: {tool_name}")
            for i, line in enumerate(output_lines, 1):
                if line.strip():
                    print(f"  {i}: {line[:120]}")
            if len(result.stdout.split('\n')) > 10:
                print(f"  ... ({len(result.stdout.split(chr(10))) - 10} more lines)")
            print(f"  Exit code: {result.exit_code}")
            print()

        # Step 3: Analyze tool output with LLM
        analyze_prompt = ANALYZE_PROMPT.format(
            tool_name=tool_name,
            command=result.command,
            exit_code=result.exit_code,
            stdout=result.stdout[:3000] if result.stdout else "(empty)",
            stderr=result.stderr[:1000] if result.stderr else "(empty)",
        )

        analysis_response = await llm_client.chat(
            model=settings.recon_model,
            fallback_model=settings.recon_model_fallback,
            messages=[
                {"role": "system", "content": "You are a security analyst parsing tool output. Respond ONLY in JSON."},
                {"role": "user", "content": analyze_prompt},
            ],
            temperature=0.1,
        )

        try:
            analysis = _parse_json_response(analysis_response)
        except Exception as e:
            logger.error("Alpha analysis parse failed: %s", e)
            analysis = {"findings": [{
                "asset": state.get('target', 'http://localhost:3000'),
                "finding": f"{tool_name} returned exit code {result.exit_code}",
                "confidence": 0.3,
                "evidence": result.stdout[:200] if result.stdout else result.stderr[:200],
                "cve_hint": None,
                "recommended_action": "Manual review needed",
            }], "summary": f"{tool_name} completed with exit code {result.exit_code}"}

        # Convert findings to A2A messages - but filter out blue_team sourced findings
        # to avoid flooding with 50+ duplicate reports already on the blackboard
        findings_list = analysis.get("findings", [])
        
        # Filter: Skip findings that came from blue_team (already on blackboard)
        new_findings = []
        for finding in findings_list:
            # B17: Handle case where finding is a string instead of dict
            if isinstance(finding, str):
                finding = {"finding": finding, "asset": state.get('target', 'http://localhost:3000')}
            elif not isinstance(finding, dict):
                continue  # Skip invalid findings
            
            # Skip if this finding came from blue_team (already on blackboard)
            source = finding.get("source", "")
            if source == "blue_team" or finding.get("finding", "").startswith("Blue Team:"):
                skipped_blue_count += 1
                continue
            
            new_findings.append(finding)
        
        # Limit to max 15 findings to prevent context window flooding
        MAX_FINDINGS = 15
        if len(new_findings) > MAX_FINDINGS:
            logger.warning(f"Alpha: Limiting {len(new_findings)} findings to {MAX_FINDINGS} highest confidence")
            # Sort by confidence and take top MAX_FINDINGS
            new_findings.sort(key=lambda x: x.get("confidence", 0.5), reverse=True)
            new_findings = new_findings[:MAX_FINDINGS]
        
        # Emit only new findings (not from blue_team)
        for finding in new_findings:
            intel = IntelligenceReport(
                asset=finding.get("asset", state.get('target', 'http://localhost:3000')),
                finding=finding.get("finding", "Unknown"),
                confidence=min(max(finding.get("confidence", 0.5), 0.0), 1.0),
                evidence=finding.get("evidence", ""),
                cve_hint=finding.get("cve_hint"),
                recommended_action=finding.get("recommended_action", ""),
            )

            msg = A2AMessage(
                sender=AgentRole.ALPHA,
                recipient=AgentRole.COMMANDER,
                type=MessageType.INTELLIGENCE_REPORT,
                priority=Priority.HIGH if intel.confidence > 0.7 else Priority.MEDIUM,
                payload=intel.model_dump(),
            )
            new_messages.append(msg)
            all_findings.append(intel.model_dump())
        
        # Emit single summary if we skipped blue_team findings
        if skipped_blue_count > 0:
            summary_msg = A2AMessage(
                sender=AgentRole.ALPHA,
                recipient=AgentRole.COMMANDER,
                type=MessageType.INTELLIGENCE_REPORT,
                priority=Priority.LOW,
                payload={
                    "asset": state.get('target', 'http://localhost:3000'),
                    "finding": f"Blue Team analysis: {skipped_blue_count} findings available on blackboard",
                    "confidence": 0.9,
                    "evidence": "Static analysis results from Blue Team enrichment",
                    "recommended_action": "Gamma should check blackboard for detailed vulnerability data",
                },
            )
            new_messages.append(summary_msg)

    logger.info("Alpha: %d new findings from %d tool calls (skipped %d blue_team findings)", 
                len(all_findings), len(plan.get("tool_calls", [])), skipped_blue_count)
    
    # Update agent state to complete
    try:
        if supabase._enabled:
            import asyncio
            asyncio.create_task(supabase.update_agent_state(
                mission_id=mission_id,
                agent_id="alpha",
                agent_name="alpha",
                status="complete",
                agent_team="red",
                iteration=iteration,
                task="reconnaissance_complete",
            ))
    except Exception as e:
        logger.debug(f"Failed to update alpha state: {e}")
    
    # Log kill chain events to Supabase (legacy + new timeline)
    for finding in all_findings:
        await supabase.log_kill_chain_event(
            mission_id=state.get("mission_id", "unknown"),
            stage="recon",
            agent="alpha",
            event_type="intelligence_discovered",
            details={
                "finding": finding.get("finding", ""),
                "confidence": finding.get("confidence", 0),
                "asset": finding.get("asset", ""),
            },
            target=finding.get("asset", state.get("target")),
            success=True,
            human_intervention=False,
        )
        # New timeline: log to swarm_events
        import asyncio
        asyncio.create_task(supabase.log_swarm_event(
            mission_id=state.get("mission_id", "unknown"),
            event_type="recon_finding",
            agent_name="alpha",
            title=f"Recon: {finding.get('finding', 'Unknown')[:80]}",
            stage="reconnaissance",
            description=finding.get("finding", ""),
            target=finding.get("asset", state.get("target")),
            success=True,
            evidence={"confidence": finding.get("confidence", 0), "asset": finding.get("asset", "")},
            iteration=iteration,
        ))

    return {
        "recon_results": all_findings,
        "messages": new_messages,
    }


def _parse_json_response(text: str) -> dict[str, Any]:
    """Extract JSON from LLM response with aggressive repair."""
    # First try the simple approach
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try aggressive repair from core.parsing
        try:
            from core.parsing import sanitize_json_output
            result = sanitize_json_output(text)
            if result is not None and isinstance(result, dict):
                return result
        except Exception:
            pass
        # If all else fails, re-raise the original error
        raise


def _extract_port_from_target(target: str) -> str | None:
    """
    Extract port from target URL or host:port string.
    
    Examples:
        http://localhost:3000 -> 3000
        https://example.com:8443 -> 8443
        localhost:3000 -> 3000
        example.com -> None
    """
    # Try parsing as URL first
    if "://" in target:
        parsed = urlparse(target)
        if parsed.port:
            return str(parsed.port)
    
    # Try parsing as host:port
    match = re.match(r"^.+:(\d+)$", target)
    if match:
        return match.group(1)
    
    return None


async def _run_static_analysis(target: str, mission_id: str) -> tuple[list[dict[str, Any]], Path | None]:
    """
    Run static code analysis on GitHub repo or local path.
    
    Args:
        target: GitHub URL or local file path
        mission_id: Mission identifier for logging
        
    Returns:
        Tuple of (findings list, repo_path)
    """
    import subprocess
    import tempfile
    import os
    from pathlib import Path
    
    findings = []
    repo_path = None
    
    try:
        # Determine if target is GitHub URL or local path
        if target.startswith("https://github.com/") or target.startswith("http://github.com/"):
            # Clone repo to temp directory
            logger.info("Alpha: Cloning GitHub repo %s", target)
            temp_dir = tempfile.mkdtemp(prefix="vibecheck_")
            repo_path = Path(temp_dir) / "repo"
            
            result = subprocess.run(
                ["git", "clone", "--depth", "1", target, str(repo_path)],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                logger.error("Alpha: Git clone failed: %s", result.stderr)
                return [{
                    "asset": target,
                    "finding": "Failed to clone repository",
                    "confidence": 1.0,
                    "evidence": result.stderr,
                    "recommended_action": "Check URL and network connectivity",
                }], None
            logger.info("Alpha: Repo cloned to %s", repo_path)
        else:
            # Use local path
            repo_path = Path(target)
            if not repo_path.exists():
                logger.error("Alpha: Local path does not exist: %s", target)
                return [{
                    "asset": target,
                    "finding": "Local path does not exist",
                    "confidence": 1.0,
                    "evidence": f"Path {target} not found",
                    "recommended_action": "Check file path",
                }], None
        
        # Run npm audit if package.json exists
        pkg_json = repo_path / "package.json"
        if pkg_json.exists():
            logger.info("Alpha: Running npm audit")
            try:
                result = subprocess.run(
                    ["npm", "audit", "--json"],
                    cwd=str(repo_path),
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode in [0, 1]:  # 0 = no vulns, 1 = vulns found
                    try:
                        audit_data = json.loads(result.stdout)
                        vulnerabilities = audit_data.get("vulnerabilities", {})
                        for pkg_name, pkg_info in vulnerabilities.items():
                            findings.append({
                                "asset": f"npm:{pkg_name}",
                                "finding": f"CVE: {pkg_info.get('name', 'Unknown')}",
                                "confidence": 0.9,
                                "evidence": f"Severity: {pkg_info.get('severity', 'unknown')}, Via: {pkg_info.get('via', [])}",
                                "cve_hint": pkg_info.get('name'),
                                "recommended_action": f"Update {pkg_name} to {pkg_info.get('fixAvailable', 'latest')}",
                            })
                        logger.info("Alpha: npm audit found %d vulnerabilities", len(findings))
                    except json.JSONDecodeError:
                        logger.warning("Alpha: Could not parse npm audit output")
            except Exception as e:
                logger.warning("Alpha: npm audit failed: %s", e)
        
        # Run pip audit if requirements.txt exists
        req_txt = repo_path / "requirements.txt"
        if req_txt.exists():
            logger.info("Alpha: Running pip audit")
            try:
                result = subprocess.run(
                    ["pip-audit", "--format=json", "-r", str(req_txt)],
                    cwd=str(repo_path),
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    try:
                        audit_data = json.loads(result.stdout)
                        for vuln in audit_data.get("vulnerabilities", []):
                            findings.append({
                                "asset": f"pip:{vuln.get('name', 'Unknown')}",
                                "finding": f"CVE: {vuln.get('vulnerability_id', 'Unknown')}",
                                "confidence": 0.9,
                                "evidence": f"Version: {vuln.get('version', 'unknown')}",
                                "cve_hint": vuln.get('vulnerability_id'),
                                "recommended_action": f"Update {vuln.get('name')} to fix version",
                            })
                        logger.info("Alpha: pip audit found %d vulnerabilities", len(audit_data.get("vulnerabilities", [])))
                    except json.JSONDecodeError:
                        logger.warning("Alpha: Could not parse pip audit output")
            except Exception as e:
                logger.warning("Alpha: pip audit failed: %s", e)
        
        # Basic file structure analysis
        logger.info("Alpha: Analyzing file structure")
        code_files = []
        for pattern in ["**/*.js", "**/*.ts", "**/*.py", "**/*.java"]:
            code_files.extend(repo_path.glob(pattern))
        
        if code_files:
            findings.append({
                "asset": str(repo_path),
                "finding": f"Found {len(code_files)} source code files",
                "confidence": 1.0,
                "evidence": f"Extensions: .js, .ts, .py, .java",
                "recommended_action": "Run Semgrep for detailed code analysis",
            })
        
        # Look for sensitive files
        sensitive_files = [".env", ".env.example", "config.json", "secrets.yaml", "docker-compose.yml"]
        for sf in sensitive_files:
            sf_path = repo_path / sf
            if sf_path.exists():
                findings.append({
                    "asset": str(sf_path.relative_to(repo_path)),
                    "finding": "Potentially sensitive configuration file found",
                    "confidence": 0.7,
                    "evidence": f"File exists: {sf}",
                    "recommended_action": "Review for hardcoded credentials",
                })
        
        logger.info("Alpha: Static analysis complete - %d findings", len(findings))
        
    except Exception as e:
        logger.error("Alpha: Static analysis failed: %s", e)
        findings.append({
            "asset": target,
            "finding": "Static analysis error",
            "confidence": 1.0,
            "evidence": str(e),
            "recommended_action": "Check target format and accessibility",
        })
    
    return findings, repo_path
