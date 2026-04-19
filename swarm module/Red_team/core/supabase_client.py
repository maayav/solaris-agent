"""
Supabase client for Red Team kill chain event persistence.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY = 0.5  # seconds
RETRY_BACKOFF = 2.0  # exponential backoff multiplier

# Thread pool for synchronous Supabase operations
_executor = ThreadPoolExecutor(max_workers=4)

# UUID validation regex pattern
UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)


def is_valid_uuid(value: str | None) -> bool:
    """Check if a string is a valid UUID format.
    
    Args:
        value: The string to validate
        
    Returns:
        True if valid UUID, False otherwise
    """
    if not value or value == "unknown":
        return False
    return bool(UUID_PATTERN.match(value))


def _retry_with_backoff(func, max_retries=MAX_RETRIES, backoff=RETRY_BACKOFF):
    """Execute a function with exponential backoff retry logic.
    
    Args:
        func: The function to execute (should make a Supabase API call)
        max_retries: Maximum number of retry attempts
        backoff: Exponential backoff multiplier
        
    Returns:
        The result of func() if successful
        
    Raises:
        The last exception if all retries fail
    """
    last_exception = None
    delay = RETRY_DELAY
    
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            last_exception = e
            error_str = str(e).lower()
            
            # Don't retry for non-transient errors
            if "404" in error_str or "not found" in error_str:
                raise  # Re-raise 404s immediately
            if "duplicate" in error_str or "conflict" in error_str:
                raise  # Re-raise conflicts immediately
            if "constraint" in error_str:
                raise  # Re-raise constraint violations immediately
                
            # Retry on transient errors
            if attempt < max_retries - 1:
                logger.debug(f"Supabase request failed (attempt {attempt + 1}/{max_retries}), retrying in {delay}s: {e}")
                time.sleep(delay)
                delay *= backoff
            else:
                logger.warning(f"Supabase request failed after {max_retries} attempts: {e}")
    
    raise last_exception


# Load environment variables from .env file if present
try:
    from pathlib import Path
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    if key not in os.environ:  # Don't override existing env vars
                        os.environ[key] = value
        logger.debug(f"Loaded .env from {env_path}")
except Exception:
    pass  # Silently fail if .env can't be loaded

# Optional Supabase import - gracefully handle if not installed
try:
    from supabase import create_client, Client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False
    logger.warning("supabase package not installed - kill chain events will not be persisted")


class RedTeamSupabaseClient:
    """Client for persisting Red Team kill chain events to Supabase."""
    
    def __init__(self, url: str | None = None, key: str | None = None):
        self._url = url
        self._key = key
        self._client: Any = None
        self._enabled = HAS_SUPABASE and url and key
        
        if self._enabled:
            try:
                self._client = create_client(url, key)
                logger.info("Red Team Supabase client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Supabase client: {e}")
                self._enabled = False
    
    def table(self, table_name: str):
        """Access a Supabase table - delegates to underlying client.
        
        This allows the wrapper to be used like the native Supabase client:
            client.table("scan_queue").select("*").execute()
        """
        if not self._enabled or not self._client:
            raise RuntimeError("Supabase client not initialized")
        return self._client.table(table_name)
    
    async def log_kill_chain_event(
        self,
        mission_id: str,
        stage: str,  # recon, exploit, post_exploit, etc.
        agent: str,  # commander, alpha, gamma, critic
        event_type: str,  # tool_execution, vulnerability_found, error, etc.
        details: dict[str, Any],
        target: str | None = None,
        success: bool | None = None,
        human_intervention: bool = False,
    ) -> bool:
        """Log a kill chain event to Supabase."""
        if not self._enabled:
            logger.debug(f"Supabase not enabled - event would be logged: {stage}/{event_type}")
            return False
        
        # Validate mission_id to prevent DB errors from invalid UUID
        if not is_valid_uuid(mission_id):
            logger.warning(f"Skipping kill chain event log - invalid mission_id: {mission_id}")
            return False
        
        # B18: Match swarm_agent_events schema
        event_data = {
            "mission_id": mission_id,
            "agent_name": agent,
            "agent_team": "red",
            "event_type": "action" if success else "error",
            "message": f"{stage}/{event_type}",
            "payload": details,
            "phase": stage,
        }
        
        def _do_insert():
            return _retry_with_backoff(
                lambda: self._client.table("swarm_agent_events").insert(event_data).execute()
            )

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(_executor, _do_insert)
            logger.debug(f"Logged kill chain event: {stage}/{event_type}")
            return True
        except RuntimeError:
            # No running event loop - run synchronously
            result = _do_insert()
            logger.debug(f"Logged kill chain event: {stage}/{event_type}")
            return True
        except Exception as e:
            error_str = str(e).lower()
            if "404" in error_str or "not found" in error_str:
                logger.debug(f"kill_chain_events table not found (404) - skipping log")
            elif "winerror 10035" in error_str:
                logger.debug(f"Windows socket error on Supabase write - skipping log")
            else:
                logger.error(f"Failed to log kill chain event: {e}")
            return False
    
    async def update_mission_status(
        self,
        mission_id: str,
        status: str,  # running, completed, failed
        progress_pct: int = 0,
        current_stage: str | None = None,
        findings_count: int | None = None,
    ) -> bool:
        """Update mission status in Supabase."""
        if not self._enabled:
            return False
        
        update_data = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        try:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    _executor,
                    lambda: self._client.table("swarm_missions")
                    .update(update_data)
                    .eq("id", mission_id)
                    .execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                self._client.table("swarm_missions").update(update_data).eq("id", mission_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to update mission status: {e}")
            return False

    async def update_agent_state(
        self,
        mission_id: str,
        agent_id: str,
        agent_name: str,
        status: str,  # idle, running, complete, error, reviewing
        agent_team: str = "red",
        iteration: int | None = None,
        task: str | None = None,
        recent_logs: list[dict] | None = None,
    ) -> bool:
        """Update or insert agent state in swarm_agent_states table.
        
        Uses upsert to create if not exists, update if exists.
        """
        if not self._enabled:
            return False
        
        if not is_valid_uuid(mission_id):
            logger.debug(f"Skipping agent state update - invalid mission_id: {mission_id}")
            return False
        
        # Build agent state data
        state_data = {
            "mission_id": mission_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_team": agent_team,
            "status": status,
            "last_updated": datetime.utcnow().isoformat(),
        }
        
        if iteration is not None:
            state_data["iter"] = str(iteration)
        if task is not None:
            state_data["task"] = task
        if recent_logs is not None:
            state_data["recent_logs"] = recent_logs
        
        def _do_upsert():
            return _retry_with_backoff(
                lambda: self._client.table("swarm_agent_states")
                .upsert(state_data, on_conflict="mission_id,agent_id")
                .execute()
            )

        try:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(_executor, _do_upsert)
            except RuntimeError:
                _do_upsert()
            logger.debug(f"Updated agent state: {agent_name} ({agent_id}) = {status}")
            return True
        except Exception as e:
            logger.error(f"Failed to update agent state: {e}")
            return False

    # ==================== REAL-TIME REPORTING METHODS ====================
    
    async def create_mission(
        self,
        mission_id: str,
        target: str,
        objective: str | None = None,
        mode: str | None = None,
    ) -> dict[str, Any] | None:
        """Create a new mission record in Supabase.

        Args:
            mission_id: Unique mission identifier
            target: Target URL, GitHub repo, or local path
            objective: Mission objective description
            mode: "live", "static", or None for auto-detection

        Returns the created mission data or None if failed.
        """
        logger.info(f"[DEBUG] create_mission called: mission_id={mission_id}, target={target}")

        # Auto-detect mode if not provided
        if mode is None:
            from agents.state import detect_target_type
            mode = detect_target_type(target)

        if not self._enabled:
            logger.warning(f"[DEBUG] Supabase not enabled - mission {mission_id} would be created but not persisted")
            return None

        mission_data = {
            "id": mission_id,
            "target": target,
            "status": "running",
            "created_at": datetime.utcnow().isoformat(),
        }
        
        try:
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    _executor,
                    lambda: self._client.table("swarm_missions").insert(mission_data).execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                result = self._client.table("swarm_missions").insert(mission_data).execute()
            logger.info(f"[DEBUG] Created mission record: {mission_id}")
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"[DEBUG] Failed to create mission: {e}")
            return None
    
    async def complete_mission(
        self,
        mission_id: str,
        status: str = "completed",
    ) -> bool:
        """Mark a mission as completed or failed."""
        if not self._enabled:
            return False
        
        update_data = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat(),
        }
        
        try:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    _executor,
                    lambda: self._client.table("swarm_missions")
                    .update(update_data)
                    .eq("id", mission_id)
                    .execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                self._client.table("swarm_missions").update(update_data).eq("id", mission_id).execute()
            logger.info(f"Mission {mission_id} marked as {status}")
            return True
        except Exception as e:
            logger.error(f"Failed to complete mission: {e}")
            return False
    
    async def log_mission_event(
        self,
        mission_id: str,
        event_type: str,
        payload_json: dict[str, Any],
    ) -> bool:
        """Log a mission event to Supabase (NON-BLOCKING).
        
        This method is designed to be fire-and-forget using asyncio.create_task()
        to avoid blocking the main execution loop.
        """
        if not self._enabled:
            return False
        
        # Validate mission_id to prevent DB errors from invalid UUID
        if not is_valid_uuid(mission_id):
            logger.warning(f"Skipping mission event log - invalid mission_id: {mission_id}")
            return False
        
        # B18: Match swarm_agent_events schema
        event_data = {
            "mission_id": mission_id,
            "agent_name": "commander",
            "agent_team": "red",
            "event_type": event_type,
            "message": f"Mission event: {event_type}",
            "payload": payload_json or {},
        }
        
        try:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    _executor,
                    lambda: self._client.table("swarm_agent_events").insert(event_data).execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                self._client.table("swarm_agent_events").insert(event_data).execute()
            logger.debug(f"Logged mission event: {event_type} for {mission_id}")
            return True
        except Exception as e:
            error_str = str(e).lower()
            # Silently ignore 404 errors (table doesn't exist)
            if "404" in error_str or "not found" in error_str:
                logger.debug(f"mission_events table not found (404) - skipping log")
            elif "winerror 10035" in error_str:
                logger.debug(f"Windows socket error on Supabase write - skipping log")
            else:
                logger.error(f"Failed to log mission event: {e}")
            return False
    
    async def get_mission_events(
        self,
        mission_id: str,
        event_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve all events for a mission (for final report generation)."""
        if not self._enabled:
            return []
        
        try:
            query = self._client.table("swarm_agent_events").select("*").eq("mission_id", mission_id)
            
            if event_type:
                query = query.eq("event_type", event_type)
            
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    _executor,
                    lambda: query.order("timestamp", desc=False).execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                result = query.order("timestamp", desc=False).execute()
            return result.data if result.data else []
        except Exception as e:
            logger.error(f"Failed to get mission events: {e}")
            return []
    
    async def upload_report(
        self,
        mission_id: str,
        file_content: bytes,
        file_name: str,
        content_type: str,
    ) -> str | None:
        """Upload a report to Supabase Storage.
        
        Returns the public URL of the uploaded file or None if failed.
        """
        if not self._enabled:
            return None
        
        try:
            # Upload to vibecheck_reports bucket
            file_path = f"{mission_id}/{file_name}"
            
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    _executor,
                    lambda: self._client.storage
                    .from_("vibecheck_reports")
                    .upload(file_path, file_content, {"content-type": content_type})
                )
                
                # Get public URL
                public_url = await loop.run_in_executor(
                    _executor,
                    lambda: self._client.storage
                    .from_("vibecheck_reports")
                    .get_public_url(file_path)
                )
            except RuntimeError:
                # No running event loop - run synchronously
                result = self._client.storage.from_("vibecheck_reports").upload(file_path, file_content, {"content-type": content_type})
                public_url = self._client.storage.from_("vibecheck_reports").get_public_url(file_path)
            
            logger.info(f"Uploaded report: {file_name} for mission {mission_id}")
            return public_url
        except Exception as e:
            logger.error(f"Failed to upload report: {e}")
            return None

    # ==================== SWARM EVENTS (New Timeline Schema) ====================

    async def log_swarm_event(
        self,
        mission_id: str,
        event_type: str,
        agent_name: str,
        title: str,
        stage: str | None = None,
        description: str | None = None,
        payload: str | None = None,
        target: str | None = None,
        success: bool | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        evidence: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        iteration: int | None = None,
        reflection_count: int | None = None,
        parent_event_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Log an event to the swarm_events timeline table.
        
        Returns the inserted row (with 'id') or None if failed.
        """
        if not self._enabled:
            logger.warning(f"[DEBUG] Supabase not enabled - skipping swarm event: {event_type}/{title}")
            return None

        if not is_valid_uuid(mission_id):
            logger.warning(f"[DEBUG] Skipping swarm event - invalid mission_id: {mission_id}")
            return None

        logger.info(f"[DEBUG] Logging swarm event: mission_id={mission_id}, event_type={event_type}, agent={agent_name}, title={title[:50]}")

        event_data: dict[str, Any] = {
            "mission_id": mission_id,
            "event_type": event_type,
            "agent_name": agent_name,
            "title": title,
        }

        # Optional fields
        if stage is not None:
            event_data["stage"] = stage
        if description is not None:
            event_data["description"] = description
        if payload is not None:
            event_data["payload"] = payload
        if target is not None:
            event_data["target"] = target
        if success is not None:
            event_data["success"] = success
        if error_type is not None:
            event_data["error_type"] = error_type
        if error_message is not None:
            event_data["error_message"] = error_message
        if evidence is not None:
            event_data["evidence"] = evidence
        if metadata is not None:
            event_data["metadata"] = metadata
        if execution_time_ms is not None:
            event_data["execution_time_ms"] = execution_time_ms
        if iteration is not None:
            event_data["iteration"] = iteration
        if reflection_count is not None:
            event_data["reflection_count"] = reflection_count
        if parent_event_id is not None and is_valid_uuid(parent_event_id):
            event_data["parent_event_id"] = parent_event_id

        def _do_insert():
            return _retry_with_backoff(
                lambda: self._client.table("swarm_events").insert(event_data).execute()
            )

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(_executor, _do_insert)
            if result and result.data:
                logger.debug(f"Logged swarm event: {event_type}/{title}")
                return result.data[0]
            return None
        except RuntimeError:
            result = _do_insert()
            if result and result.data:
                logger.debug(f"Logged swarm event: {event_type}/{title}")
                return result.data[0]
            return None
        except Exception as e:
            error_str = str(e).lower()
            if "404" in error_str or "not found" in error_str:
                logger.debug("swarm_events table not found (404) - skipping")
            elif "winerror 10035" in error_str:
                logger.debug("Windows socket error on swarm_events write - skipping")
            else:
                logger.error(f"Failed to log swarm event: {e}")
            return None

    async def log_exploit_attempt(
        self,
        mission_id: str,
        exploit_type: str,
        target_url: str,
        method: str = "GET",
        event_id: str | None = None,
        payload: str | None = None,
        payload_hash: str | None = None,
        tool_used: str | None = None,
        command_executed: str | None = None,
        success: bool | None = False,
        response_code: int | None = None,
        exit_code: int | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        stdout: str | None = None,
        stderr: str | None = None,
        evidence: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        was_deduplicated: bool = False,
        deduplication_key: str | None = None,
        attempt_number: int = 1,
    ) -> dict[str, Any] | None:
        """Log an exploit attempt to the swarm_exploit_attempts table.
        
        Returns the inserted row (with 'id') or None if failed.
        """
        if not self._enabled:
            logger.warning(f"[DEBUG] Supabase not enabled - skipping exploit attempt: {exploit_type} on {target_url}")
            return None

        if not is_valid_uuid(mission_id):
            logger.warning(f"[DEBUG] Skipping exploit attempt - invalid mission_id: {mission_id}")
            return None

        logger.info(f"[DEBUG] Logging exploit attempt: mission_id={mission_id}, exploit_type={exploit_type}, target={target_url[:50]}, event_id={event_id}")

        attempt_data: dict[str, Any] = {
            "mission_id": mission_id,
            "exploit_type": exploit_type,
            "target_url": target_url,
            "method": method,
            "success": success,
            "was_deduplicated": was_deduplicated,
            "attempt_number": attempt_number,
        }

        if event_id and is_valid_uuid(event_id):
            attempt_data["event_id"] = event_id
        if payload is not None:
            attempt_data["payload"] = payload[:5000] if len(payload) > 5000 else payload
        if payload_hash is not None:
            attempt_data["payload_hash"] = payload_hash
        if tool_used is not None:
            attempt_data["tool_used"] = tool_used
        if command_executed is not None:
            attempt_data["command_executed"] = command_executed[:2000] if len(command_executed) > 2000 else command_executed
        if response_code is not None:
            attempt_data["response_code"] = response_code
        if exit_code is not None:
            attempt_data["exit_code"] = exit_code
        if error_type is not None:
            attempt_data["error_type"] = error_type
        if error_message is not None:
            attempt_data["error_message"] = error_message[:2000] if len(error_message) > 2000 else error_message
        if stdout is not None:
            attempt_data["stdout"] = stdout[:10000] if len(stdout) > 10000 else stdout
        if stderr is not None:
            attempt_data["stderr"] = stderr[:10000] if len(stderr) > 10000 else stderr
        if evidence is not None:
            attempt_data["evidence"] = evidence
        if execution_time_ms is not None:
            attempt_data["execution_time_ms"] = execution_time_ms
        if deduplication_key is not None:
            attempt_data["deduplication_key"] = deduplication_key

        def _do_insert():
            return _retry_with_backoff(
                lambda: self._client.table("swarm_exploit_attempts").insert(attempt_data).execute()
            )

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(_executor, _do_insert)
            if result and result.data:
                logger.debug(f"Logged exploit attempt: {exploit_type} on {target_url}")
                return result.data[0]
            return None
        except RuntimeError:
            result = _do_insert()
            if result and result.data:
                logger.debug(f"Logged exploit attempt: {exploit_type} on {target_url}")
                return result.data[0]
            return None
        except Exception as e:
            error_str = str(e).lower()
            if "404" in error_str or "not found" in error_str:
                logger.debug("swarm_exploit_attempts table not found - skipping")
            else:
                logger.error(f"Failed to log exploit attempt: {e}")
            return None

    async def log_swarm_finding(
        self,
        mission_id: str,
        title: str,
        severity: str = "medium",
        description: str | None = None,
        finding_type: str | None = None,
        source: str | None = None,
        target: str | None = None,
        endpoint: str | None = None,
        file_path: str | None = None,
        line_start: int | None = None,
        line_end: int | None = None,
        confirmed: bool = False,
        agent_name: str | None = None,
        evidence: dict[str, Any] | None = None,
        cve_id: str | None = None,
        exploit_attempt_id: str | None = None,
        agent_iteration: int = 0,
        confidence_score: float | None = None,
    ) -> dict[str, Any] | None:
        """Log a finding to the swarm_findings table (with new columns).
        
        Returns the inserted row (with 'id') or None if failed.
        """
        if not self._enabled:
            return None

        if not is_valid_uuid(mission_id):
            logger.debug(f"Skipping swarm finding - invalid mission_id: {mission_id}")
            return None

        finding_data: dict[str, Any] = {
            "mission_id": mission_id,
            "title": title,
            "severity": severity,
            "confirmed": confirmed,
            "agent_iteration": agent_iteration,
            "evidence": evidence or {},
        }

        if description is not None:
            finding_data["description"] = description
        if finding_type is not None:
            finding_data["finding_type"] = finding_type
        if source is not None:
            finding_data["source"] = source
        if target is not None:
            finding_data["target"] = target
        if endpoint is not None:
            finding_data["endpoint"] = endpoint
        if file_path is not None:
            finding_data["file_path"] = file_path
        if line_start is not None:
            finding_data["line_start"] = line_start
        if line_end is not None:
            finding_data["line_end"] = line_end
        if agent_name is not None:
            finding_data["agent_name"] = agent_name
        if cve_id is not None:
            finding_data["cve_id"] = cve_id
        if exploit_attempt_id and is_valid_uuid(exploit_attempt_id):
            finding_data["exploit_attempt_id"] = exploit_attempt_id
        if confidence_score is not None:
            finding_data["confidence_score"] = confidence_score

        def _do_insert():
            return _retry_with_backoff(
                lambda: self._client.table("swarm_findings").insert(finding_data).execute()
            )

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(_executor, _do_insert)
            if result and result.data:
                logger.debug(f"Logged swarm finding: {title} ({severity})")
                return result.data[0]
            return None
        except RuntimeError:
            result = _do_insert()
            if result and result.data:
                logger.debug(f"Logged swarm finding: {title} ({severity})")
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Failed to log swarm finding: {e}")
            return None

    async def get_swarm_events(
        self,
        mission_id: str,
        event_type: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        """Query swarm_events for a mission (for report generation)."""
        if not self._enabled:
            return []

        try:
            query = self._client.table("swarm_events").select("*").eq("mission_id", mission_id)
            if event_type:
                query = query.eq("event_type", event_type)
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    _executor,
                    lambda: query.order("created_at", desc=False).limit(limit).execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                result = query.order("created_at", desc=False).limit(limit).execute()
            return result.data if result and result.data else []
        except Exception as e:
            logger.error(f"Failed to get swarm events: {e}")
            return []

    async def get_exploit_attempts(
        self,
        mission_id: str,
        success_only: bool = False,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        """Query swarm_exploit_attempts for a mission."""
        if not self._enabled:
            return []

        try:
            query = self._client.table("swarm_exploit_attempts").select("*").eq("mission_id", mission_id)
            if success_only:
                query = query.eq("success", True)
            try:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    _executor,
                    lambda: query.order("created_at", desc=False).limit(limit).execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                result = query.order("created_at", desc=False).limit(limit).execute()
            return result.data if result and result.data else []
        except Exception as e:
            logger.error(f"Failed to get exploit attempts: {e}")
            return []

    async def update_exploit_attempt(
        self,
        attempt_id: str,
        critic_evaluated: bool = True,
        critic_success: bool | None = None,
        critic_feedback: str | None = None,
    ) -> bool:
        """Update critic evaluation fields on an exploit attempt."""
        if not self._enabled or not is_valid_uuid(attempt_id):
            return False

        update_data: dict[str, Any] = {"critic_evaluated": critic_evaluated}
        if critic_success is not None:
            update_data["critic_success"] = critic_success
        if critic_feedback is not None:
            update_data["critic_feedback"] = critic_feedback[:2000] if len(critic_feedback) > 2000 else critic_feedback

        try:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    _executor,
                    lambda: self._client.table("swarm_exploit_attempts")
                    .update(update_data)
                    .eq("id", attempt_id)
                    .execute()
                )
            except RuntimeError:
                # No running event loop - run synchronously
                self._client.table("swarm_exploit_attempts").update(update_data).eq("id", attempt_id).execute()
            return True
        except Exception as e:
            logger.error(f"Failed to update exploit attempt: {e}")
            return False


# Singleton instance
_supabase_client: RedTeamSupabaseClient | None = None


def get_supabase_client(url: str | None = None, key: str | None = None) -> RedTeamSupabaseClient:
    """Get or create Supabase client singleton.
    
    If url/key not provided, reads from environment variables:
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
    """
    global _supabase_client
    if _supabase_client is None:
        # Read from environment if not provided
        if url is None:
            url = os.getenv("SUPABASE_URL")
        if key is None:
            key = os.getenv("SUPABASE_ANON_KEY")
        _supabase_client = RedTeamSupabaseClient(url, key)
    return _supabase_client


# Convenience function for non-blocking event logging
def fire_and_forget_log_event(
    mission_id: str,
    event_type: str,
    payload_json: dict[str, Any],
) -> None:
    """Fire-and-forget event logging that won't block the main loop.
    
    Writes to both swarm_events (new timeline) and swarm_agent_events (legacy).
    Usage: fire_and_forget_log_event(mission_id, "exploit_result", {...})
    
    This function handles both async and sync contexts gracefully.
    """
    # Validate mission_id early to prevent unnecessary task creation
    if not is_valid_uuid(mission_id):
        logger.debug(f"Skipping fire_and_forget log - invalid mission_id: {mission_id}")
        return
    
    try:
        client = get_supabase_client()
        if client._enabled:
            # Try to get running loop for async logging
            try:
                loop = asyncio.get_running_loop()
                # We're in an async context - use create_task
                asyncio.create_task(
                    client.log_mission_event(mission_id, event_type, payload_json)
                )
                asyncio.create_task(
                    client.log_swarm_event(
                        mission_id=mission_id,
                        event_type=event_type,
                        agent_name=payload_json.get("agent_name", "system"),
                        title=f"Event: {event_type}",
                        description=str(payload_json.get("message", ""))[:500],
                        metadata=payload_json,
                    )
                )
            except RuntimeError:
                # No running event loop - run synchronously
                # Log to swarm_agent_events
                event_data = {
                    "mission_id": mission_id,
                    "agent_name": payload_json.get("agent_name", "system"),
                    "agent_team": "red",
                    "event_type": event_type,
                    "message": f"Mission event: {event_type}",
                    "payload": payload_json,
                }
                client._client.table("swarm_agent_events").insert(event_data).execute()
                
                # Log to swarm_events
                event_data_timeline = {
                    "mission_id": mission_id,
                    "event_type": event_type,
                    "agent_name": payload_json.get("agent_name", "system"),
                    "title": f"Event: {event_type}",
                    "description": str(payload_json.get("message", ""))[:500],
                    "metadata": payload_json,
                }
                client._client.table("swarm_events").insert(event_data_timeline).execute()
                logger.debug(f"Fire-and-forget logged sync: {event_type} for {mission_id}")
    except Exception as e:
        logger.debug(f"Failed to queue event log: {e}")
