"""
Supabase client for Project VibeCheck.

CRITICAL: The supabase Python SDK has NO async support.
All methods must be sync internally, wrapped in asyncio.get_event_loop().run_in_executor(None, sync_fn).

Used for:
- Scan status tracking
- Vulnerability storage
- Report generation
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from supabase import create_client, Client

from core.config import get_settings

logger = logging.getLogger(__name__)


class SupabaseClient:
    """
    Client for interacting with Supabase database.

    All methods are sync internally but exposed as async via run_in_executor.
    """

    def __init__(self, url: str | None = None, key: str | None = None) -> None:
        """
        Initialize Supabase client.

        Args:
            url: Supabase project URL (defaults to settings)
            key: Supabase anon/service key (defaults to settings)
        """
        settings = get_settings()
        self._url = url or settings.supabase_url
        self._key = key or settings.supabase_anon_key
        self._client: Client | None = None

    def _get_client(self) -> Client:
        """Get or create the Supabase client (sync)."""
        if self._client is None:
            logger.info(f"Connecting to Supabase at {self._url}")
            self._client = create_client(self._url, self._key)
            logger.info("Supabase connection established")
        return self._client

    def _reset_client(self) -> None:
        """Reset the cached client to force reconnection on next use."""
        if self._client is not None:
            logger.warning("Resetting Supabase client connection")
            self._client = None

    def _is_connection_error(self, error: Exception) -> bool:
        """Check if an error is a connection-related error."""
        error_msg = str(error).lower()
        connection_errors = [
            "server disconnected",
            "connection",
            "timeout",
            "reset",
            "closed",
            "broken pipe",
            "network",
            "winerror 10035",  # Windows non-blocking socket error
            "non-blocking socket",
            "socket operation",
        ]
        return any(err in error_msg for err in connection_errors)

    def _with_retry(self, operation, *args, **kwargs):
        """
        Execute a Supabase operation with connection error retry logic.
        
        Args:
            operation: Callable that performs the Supabase operation
            *args, **kwargs: Arguments to pass to the operation
            
        Returns:
            Result of the operation
            
        Raises:
            Exception: If all retries fail
        """
        max_retries = 2
        last_error = None
        
        for attempt in range(max_retries):
            try:
                return operation(*args, **kwargs)
            except Exception as e:
                last_error = e
                if self._is_connection_error(e) and attempt < max_retries - 1:
                    logger.warning(f"Connection error on attempt {attempt + 1}, retrying: {e}")
                    self._reset_client()
                    continue
                raise
        
        # Should not reach here, but just in case
        raise last_error if last_error else Exception("Unknown error in _with_retry")

    # ==================== SCAN STATUS ====================

    def _get_scan_status_sync(self, scan_id: str) -> dict[str, Any] | None:
        """
        Sync method to get scan status.

        Args:
            scan_id: Unique scan identifier

        Returns:
            Scan record or None if not found
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("scan_queue")
                .select("*")
                .eq("id", scan_id)
                .single()
                .execute()
            )
            return result.data if result else None
        
        return self._with_retry(_fetch)

    async def get_scan_status(self, scan_id: str) -> dict[str, Any] | None:
        """
        Async wrapper to get scan status.

        Uses run_in_executor to avoid blocking the event loop.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_scan_status_sync(scan_id)
        )

    def _update_scan_status_sync(
        self,
        scan_id: str,
        status: str,
        progress: int = 0,
        error_message: str | None = None,
        current_stage: str | None = None,
        stage_output: dict | None = None,
    ) -> bool:
        """
        Sync method to update scan status.

        Args:
            scan_id: Unique scan identifier
            status: New status (pending, running, completed, failed)
            progress: Progress percentage (0-100)
            error_message: Optional error message
            current_stage: Optional current pipeline stage name
            stage_output: Optional dict with intermediate stage results

        Returns:
            True if update succeeded
        """
        client = self._get_client()
        
        update_data = {
            "status": status,
            "progress": progress,
        }
        
        if status == "running" and progress == 0:
            update_data["started_at"] = datetime.now(timezone.utc).isoformat()
        elif status in ("completed", "failed"):
            update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        
        if error_message:
            update_data["error_message"] = error_message
        
        if current_stage:
            update_data["current_stage"] = current_stage
        
        if stage_output:
            update_data["stage_output"] = stage_output
        
        result = (
            client.table("scan_queue")
            .update(update_data)
            .eq("id", scan_id)
            .execute()
        )
        
        return result is not None

    async def update_scan_status(
        self,
        scan_id: str,
        status: str,
        progress: int = 0,
        error_message: str | None = None,
        current_stage: str | None = None,
        stage_output: dict | None = None,
    ) -> bool:
        """
        Async wrapper to update scan status.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._update_scan_status_sync(scan_id, status, progress, error_message, current_stage, stage_output)
        )

    def _create_scan_sync(
        self,
        scan_id: str,
        repo_url: str,
        triggered_by: str = "unknown",
    ) -> dict[str, Any] | None:
        """
        Sync method to create a new scan record.

        Args:
            scan_id: Unique scan identifier
            repo_url: Repository URL
            triggered_by: User who triggered the scan

        Returns:
            Created record or None
        """
        client = self._get_client()
        
        result = (
            client.table("scan_queue")
            .insert({
                "id": scan_id,
                "repo_url": repo_url,
                "triggered_by": triggered_by,
                "status": "pending",
                "progress": 0,
            })
            .execute()
        )
        
        return result.data[0] if result and result.data else None

    async def create_scan(
        self,
        scan_id: str,
        repo_url: str,
        triggered_by: str = "unknown",
    ) -> dict[str, Any] | None:
        """
        Async wrapper to create a new scan record.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_scan_sync(scan_id, repo_url, triggered_by)
        )

    # ==================== VULNERABILITIES ====================

    def _get_vulnerabilities_sync(self, scan_id: str) -> list[dict[str, Any]]:
        """
        Sync method to get vulnerabilities for a scan.

        Args:
            scan_id: Unique scan identifier

        Returns:
            List of vulnerability records
        """
        client = self._get_client()
        result = (
            client.table("vulnerabilities")
            .select("*")
            .eq("scan_id", scan_id)
            .execute()
        )
        return result.data if result else []

    async def get_vulnerabilities(self, scan_id: str) -> list[dict[str, Any]]:
        """
        Async wrapper to get vulnerabilities.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_vulnerabilities_sync(scan_id)
        )

    def _insert_vulnerability_sync(
        self,
        scan_id: str,
        vuln: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Sync method to insert a vulnerability.

        Args:
            scan_id: Unique scan identifier
            vuln: Vulnerability data

        Returns:
            Created record or None
        """
        client = self._get_client()
        
        # Ensure scan_id is included
        vuln_data = {**vuln, "scan_id": scan_id}
        
        result = (
            client.table("vulnerabilities")
            .insert(vuln_data)
            .execute()
        )
        
        return result.data[0] if result and result.data else None

    async def insert_vulnerability(
        self,
        scan_id: str,
        vuln: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Async wrapper to insert a vulnerability.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._insert_vulnerability_sync(scan_id, vuln)
        )

    def _insert_vulnerabilities_batch_sync(
        self,
        scan_id: str,
        vulns: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Sync method to insert multiple vulnerabilities.

        Args:
            scan_id: Unique scan identifier
            vulns: List of vulnerability data

        Returns:
            List of created records
        """
        if not vulns:
            logger.warning("No vulnerabilities to insert - vulns list is empty")
            return []
        
        client = self._get_client()
        
        # First, verify the scan_id exists in scan_queue (FK constraint)
        try:
            scan_check = (
                client.table("scan_queue")
                .select("id")
                .eq("id", scan_id)
                .execute()
            )
            if not scan_check.data:
                logger.error(f"Scan ID {scan_id} does not exist in scan_queue table - FK constraint will fail")
                raise ValueError(f"Scan ID {scan_id} not found in scan_queue table")
            logger.info(f"Verified scan_id {scan_id} exists in scan_queue")
        except Exception as e:
            logger.error(f"Failed to verify scan_id: {e}")
            raise
        
        # Add scan_id to each vulnerability
        vulns_data = [{**v, "scan_id": scan_id} for v in vulns]
        
        logger.info(f"Inserting {len(vulns_data)} vulnerabilities into Supabase for scan {scan_id}")
        logger.debug(f"Sample vulnerability data: {vulns_data[0] if vulns_data else 'none'}")
        
        try:
            # Use upsert to handle unique constraint on (scan_id, file_path, line_start)
            # This prevents race conditions where duplicate vulns are inserted
            result = (
                client.table("vulnerabilities")
                .upsert(vulns_data, on_conflict="scan_id,file_path,line_start")
                .execute()
            )
            
            if result and result.data:
                logger.info(f"Successfully inserted {len(result.data)} vulnerabilities")
                return result.data
            else:
                logger.warning(f"Insert returned no data. Result: {result}")
                return []
        except Exception as e:
            logger.error(f"Failed to insert vulnerabilities: {e}", exc_info=True)
            raise

    async def insert_vulnerabilities_batch(
        self,
        scan_id: str,
        vulns: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Async wrapper to insert multiple vulnerabilities.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._insert_vulnerabilities_batch_sync(scan_id, vulns)
        )

    # ==================== REPORTS ====================

    def _get_report_sync(self, scan_id: str) -> dict[str, Any] | None:
        """
        Sync method to get a full report for a scan.

        Args:
            scan_id: Unique scan identifier

        Returns:
            Report data with scan info and vulnerabilities
        """
        def _fetch():
            client = self._get_client()

            # Get scan info
            scan_result = (
                client.table("scan_queue")
                .select("*")
                .eq("id", scan_id)
                .single()
                .execute()
            )

            if not scan_result or not scan_result.data:
                return None

            # Get vulnerabilities
            vulns_result = (
                client.table("vulnerabilities")
                .select("*")
                .eq("scan_id", scan_id)
                .execute()
            )

            return {
                "scan": scan_result.data,
                "vulnerabilities": vulns_result.data if vulns_result else [],
            }
        
        return self._with_retry(_fetch)

    async def get_report(self, scan_id: str) -> dict[str, Any] | None:
        """
        Async wrapper to get a full report.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_report_sync(scan_id)
        )

    # ==================== LIST SCANS ====================

    def _list_scans_sync(
        self,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Sync method to list scans.

        Args:
            status: Optional status filter
            limit: Maximum number of results
            offset: Offset for pagination

        Returns:
            Dict with "scans" list and "total" count
        """
        def _fetch():
            client = self._get_client()
            
            # Build query for paginated results
            query = client.table("scan_queue").select("*")
            
            if status:
                query = query.eq("status", status)
            
            result = (
                query.order("created_at", desc=True)
                .limit(limit)
                .offset(offset)
                .execute()
            )
            
            scans = result.data if result else []
            
            # Get total count (separate query)
            count_query = client.table("scan_queue").select("*", count="exact")
            
            if status:
                count_query = count_query.eq("status", status)
            
            count_result = count_query.execute()
            total = count_result.count if count_result else len(scans)
            
            return {
                "scans": scans,
                "total": total,
            }
        
        return self._with_retry(_fetch)

    async def list_scans(
        self,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        Async wrapper to list scans.
        
        Returns:
            Dict with "scans" list and "total" count
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._list_scans_sync(status, limit, offset)
        )

    # ==================== SWARM MISSIONS ====================

    def _create_swarm_mission_sync(
        self,
        mission_id: str,
        target: str,
        objective: str,
        mode: str,
        max_iterations: int,
        scan_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create a swarm mission.

        Args:
            mission_id: Unique mission identifier
            target: Target URL or repository
            objective: Mission objective
            mode: Scan mode ('live' or 'static')
            max_iterations: Maximum iterations
            scan_id: Optional linked scan ID

        Returns:
            Created mission record
        """
        def _insert():
            client = self._get_client()
            result = (
                client.table("swarm_missions")
                .insert({
                    "id": mission_id,
                    "scan_id": scan_id,
                    "target": target,
                    "objective": objective,
                    "mode": mode,
                    "max_iterations": max_iterations,
                    "status": "pending",
                    "progress": 0,
                    "iteration": 0,
                })
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_mission(
        self,
        mission_id: str,
        target: str,
        objective: str,
        mode: str,
        max_iterations: int,
        scan_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create a swarm mission.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_mission_sync(
                mission_id, target, objective, mode, max_iterations, scan_id
            )
        )

    def _get_swarm_mission_sync(self, mission_id: str) -> dict[str, Any] | None:
        """
        Sync method to get a swarm mission by ID.

        Args:
            mission_id: Unique mission identifier

        Returns:
            Mission record or None if not found
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("swarm_missions")
                .select("*")
                .eq("id", mission_id)
                .single()
                .execute()
            )
            return result.data if result else None
        
        return self._with_retry(_fetch)

    async def get_swarm_mission(self, mission_id: str) -> dict[str, Any] | None:
        """
        Async wrapper to get a swarm mission.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_mission_sync(mission_id)
        )

    def _list_swarm_missions_sync(self, limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
        """
        Sync method to list all swarm missions.

        Args:
            limit: Maximum number of missions to return
            offset: Number of missions to skip

        Returns:
            List of mission records
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("swarm_missions")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .offset(offset)
                .execute()
            )
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def list_swarm_missions(self, limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
        """
        Async wrapper to list swarm missions.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._list_swarm_missions_sync(limit, offset)
        )

    def _update_swarm_mission_sync(
        self,
        mission_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Sync method to update a swarm mission.

        Args:
            mission_id: Unique mission identifier
            updates: Dictionary of fields to update

        Returns:
            Updated mission record
        """
        def _update():
            client = self._get_client()
            result = (
                client.table("swarm_missions")
                .update(updates)
                .eq("id", mission_id)
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_update)

    async def update_swarm_mission(
        self,
        mission_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Async wrapper to update a swarm mission.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._update_swarm_mission_sync(mission_id, updates)
        )

    # ==================== SWARM AGENT STATES ====================

    def _create_swarm_agent_state_sync(
        self,
        mission_id: str,
        agent_id: str,
        agent_name: str,
        agent_team: str,
        status: str,
        iter: str | None = None,
        task: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create an agent state record.
        """
        def _insert():
            client = self._get_client()
            result = (
                client.table("swarm_agent_states")
                .insert({
                    "mission_id": mission_id,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "agent_team": agent_team,
                    "status": status,
                    "iter": iter,
                    "task": task,
                    "recent_logs": [],
                })
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_agent_state(
        self,
        mission_id: str,
        agent_id: str,
        agent_name: str,
        agent_team: str,
        status: str,
        iter: str | None = None,
        task: str | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create an agent state.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_agent_state_sync(
                mission_id, agent_id, agent_name, agent_team, status, iter, task
            )
        )

    def _get_swarm_agent_states_sync(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Sync method to get all agent states for a mission.
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("swarm_agent_states")
                .select("*")
                .eq("mission_id", mission_id)
                .execute()
            )
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_swarm_agent_states(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Async wrapper to get agent states.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_agent_states_sync(mission_id)
        )

    def _update_swarm_agent_state_sync(
        self,
        mission_id: str,
        agent_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Sync method to update an agent state.
        """
        def _update():
            client = self._get_client()
            result = (
                client.table("swarm_agent_states")
                .update(updates)
                .eq("mission_id", mission_id)
                .eq("agent_id", agent_id)
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_update)

    async def update_swarm_agent_state(
        self,
        mission_id: str,
        agent_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Async wrapper to update an agent state.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._update_swarm_agent_state_sync(mission_id, agent_id, updates)
        )

    # ==================== SWARM AGENT EVENTS ====================

    def _create_swarm_agent_event_sync(
        self,
        mission_id: str,
        agent_name: str,
        agent_team: str,
        event_type: str,
        message: str,
        payload: dict[str, Any] | None = None,
        iteration: int | None = None,
        phase: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create an agent event.
        """
        def _insert():
            client = self._get_client()
            result = (
                client.table("swarm_agent_events")
                .insert({
                    "mission_id": mission_id,
                    "agent_name": agent_name,
                    "agent_team": agent_team,
                    "event_type": event_type,
                    "message": message,
                    "payload": payload or {},
                    "iteration": iteration,
                    "phase": phase,
                })
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_agent_event(
        self,
        mission_id: str,
        agent_name: str,
        agent_team: str,
        event_type: str,
        message: str,
        payload: dict[str, Any] | None = None,
        iteration: int | None = None,
        phase: str | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create an agent event.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_agent_event_sync(
                mission_id, agent_name, agent_team, event_type, message, payload, iteration, phase
            )
        )

    def _get_swarm_agent_events_sync(
        self,
        mission_id: str,
        limit: int = 100,
        agent_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Sync method to get agent events for a mission.
        """
        def _fetch():
            client = self._get_client()
            query = (
                client.table("swarm_agent_events")
                .select("*")
                .eq("mission_id", mission_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            
            if agent_name:
                query = query.eq("agent_name", agent_name)
            
            result = query.execute()
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_swarm_agent_events(
        self,
        mission_id: str,
        limit: int = 100,
        agent_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Async wrapper to get agent events.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_agent_events_sync(mission_id, limit, agent_name)
        )

    # ==================== SWARM FINDINGS ====================

    def _create_swarm_finding_sync(
        self,
        mission_id: str,
        title: str,
        severity: str,
        description: str | None = None,
        finding_type: str | None = None,
        source: str | None = None,
        target: str | None = None,
        endpoint: str | None = None,
        confirmed: bool = False,
        agent_name: str | None = None,
        cve_id: str | None = None,
        evidence: dict[str, Any] | None = None,
        exploit_attempt_id: str | None = None,
        agent_iteration: int | None = None,
        confidence_score: float | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create a swarm finding.
        """
        def _insert():
            client = self._get_client()
            data = {
                "mission_id": mission_id,
                "title": title,
                "description": description,
                "severity": severity,
                "finding_type": finding_type,
                "source": source,
                "target": target,
                "endpoint": endpoint,
                "confirmed": confirmed,
                "agent_name": agent_name,
                "cve_id": cve_id,
                "evidence": evidence or {},
            }
            # Add new columns from migration schema
            if exploit_attempt_id is not None:
                data["exploit_attempt_id"] = exploit_attempt_id
            if agent_iteration is not None:
                data["agent_iteration"] = agent_iteration
            if confidence_score is not None:
                data["confidence_score"] = confidence_score
            
            result = (
                client.table("swarm_findings")
                .insert(data)
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_finding(
        self,
        mission_id: str,
        title: str,
        severity: str,
        description: str | None = None,
        finding_type: str | None = None,
        source: str | None = None,
        target: str | None = None,
        endpoint: str | None = None,
        confirmed: bool = False,
        agent_name: str | None = None,
        cve_id: str | None = None,
        evidence: dict[str, Any] | None = None,
        exploit_attempt_id: str | None = None,
        agent_iteration: int | None = None,
        confidence_score: float | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create a swarm finding.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_finding_sync(
                mission_id, title, severity, description, finding_type, source,
                target, endpoint, confirmed, agent_name, cve_id, evidence,
                exploit_attempt_id, agent_iteration, confidence_score
            )
        )

    # ==================== SWARM EVENTS (NEW TIMELINE) ====================

    def _create_swarm_event_sync(
        self,
        mission_id: str,
        event_type: str,
        agent_name: str,
        title: str,
        description: str | None = None,
        stage: str | None = None,
        payload: str | None = None,
        target: str | None = None,
        success: bool | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        evidence: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        iteration: int | None = None,
        parent_event_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create a swarm event (complete timeline).
        
        New schema from swarm-timeline-migration-simple.sql
        """
        def _insert():
            client = self._get_client()
            data = {
                "mission_id": mission_id,
                "event_type": event_type,
                "agent_name": agent_name,
                "title": title,
                "description": description,
                "stage": stage,
                "payload": payload,
                "target": target,
                "success": success,
                "error_type": error_type,
                "error_message": error_message,
                "evidence": evidence or {},
                "metadata": metadata or {},
                "execution_time_ms": execution_time_ms,
                "iteration": iteration if iteration is not None else 0,
                "parent_event_id": parent_event_id,
            }
            result = (
                client.table("swarm_events")
                .insert(data)
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_event(
        self,
        mission_id: str,
        event_type: str,
        agent_name: str,
        title: str,
        description: str | None = None,
        stage: str | None = None,
        payload: str | None = None,
        target: str | None = None,
        success: bool | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        evidence: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        iteration: int | None = None,
        parent_event_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create a swarm event.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_event_sync(
                mission_id, event_type, agent_name, title, description, stage,
                payload, target, success, error_type, error_message, evidence,
                metadata, execution_time_ms, iteration, parent_event_id
            )
        )

    def _get_swarm_events_sync(
        self,
        mission_id: str,
        limit: int = 100,
        event_type: str | None = None,
        agent_name: str | None = None,
        iteration: int | None = None,
    ) -> list[dict[str, Any]]:
        """
        Sync method to get swarm events for a mission.
        """
        def _fetch():
            client = self._get_client()
            query = (
                client.table("swarm_events")
                .select("*")
                .eq("mission_id", mission_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            
            if event_type:
                query = query.eq("event_type", event_type)
            if agent_name:
                query = query.eq("agent_name", agent_name)
            if iteration is not None:
                query = query.eq("iteration", iteration)
            
            result = query.execute()
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_swarm_events(
        self,
        mission_id: str,
        limit: int = 100,
        event_type: str | None = None,
        agent_name: str | None = None,
        iteration: int | None = None,
    ) -> list[dict[str, Any]]:
        """
        Async wrapper to get swarm events.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_events_sync(mission_id, limit, event_type, agent_name, iteration)
        )

    # ==================== SWARM EXPLOIT ATTEMPTS ====================

    def _create_swarm_exploit_attempt_sync(
        self,
        mission_id: str,
        exploit_type: str,
        target_url: str,
        method: str = "GET",
        payload: str | None = None,
        payload_hash: str | None = None,
        tool_used: str | None = None,
        command_executed: str | None = None,
        success: bool = False,
        response_code: int | None = None,
        exit_code: int | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        stdout: str | None = None,
        stderr: str | None = None,
        evidence: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        event_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Sync method to create an exploit attempt record.
        
        New table from swarm-timeline-migration-simple.sql
        """
        def _insert():
            client = self._get_client()
            data = {
                "mission_id": mission_id,
                "event_id": event_id,
                "exploit_type": exploit_type,
                "target_url": target_url,
                "method": method,
                "payload": payload,
                "payload_hash": payload_hash,
                "tool_used": tool_used,
                "command_executed": command_executed,
                "success": success,
                "response_code": response_code,
                "exit_code": exit_code,
                "error_type": error_type,
                "error_message": error_message,
                "stdout": stdout,
                "stderr": stderr,
                "evidence": evidence or {},
                "execution_time_ms": execution_time_ms,
            }
            result = (
                client.table("swarm_exploit_attempts")
                .insert(data)
                .execute()
            )
            return result.data[0] if result and result.data else None
        
        return self._with_retry(_insert)

    async def create_swarm_exploit_attempt(
        self,
        mission_id: str,
        exploit_type: str,
        target_url: str,
        method: str = "GET",
        payload: str | None = None,
        payload_hash: str | None = None,
        tool_used: str | None = None,
        command_executed: str | None = None,
        success: bool = False,
        response_code: int | None = None,
        exit_code: int | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
        stdout: str | None = None,
        stderr: str | None = None,
        evidence: dict[str, Any] | None = None,
        execution_time_ms: int | None = None,
        event_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Async wrapper to create an exploit attempt.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._create_swarm_exploit_attempt_sync(
                mission_id, exploit_type, target_url, method, payload, payload_hash,
                tool_used, command_executed, success, response_code, exit_code,
                error_type, error_message, stdout, stderr, evidence, execution_time_ms,
                event_id
            )
        )

    def _get_swarm_exploit_attempts_sync(
        self,
        mission_id: str,
        limit: int = 100,
        exploit_type: str | None = None,
        success: bool | None = None,
    ) -> list[dict[str, Any]]:
        """
        Sync method to get exploit attempts for a mission.
        """
        def _fetch():
            client = self._get_client()
            query = (
                client.table("swarm_exploit_attempts")
                .select("*")
                .eq("mission_id", mission_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            
            if exploit_type:
                query = query.eq("exploit_type", exploit_type)
            if success is not None:
                query = query.eq("success", success)
            
            result = query.execute()
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_swarm_exploit_attempts(
        self,
        mission_id: str,
        limit: int = 100,
        exploit_type: str | None = None,
        success: bool | None = None,
    ) -> list[dict[str, Any]]:
        """
        Async wrapper to get exploit attempts.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_exploit_attempts_sync(mission_id, limit, exploit_type, success)
        )

    # ==================== VIEWS ====================

    def _get_mission_timeline_sync(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Sync method to get mission timeline from view.
        
        Uses mission_timeline_view from migration
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("mission_timeline_view")
                .select("*")
                .eq("mission_id", mission_id)
                .order("created_at", asc=True)
                .execute()
            )
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_mission_timeline(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Async wrapper to get mission timeline from view.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_mission_timeline_sync(mission_id)
        )

    def _get_mission_statistics_sync(self, mission_id: str) -> dict[str, Any] | None:
        """
        Sync method to get mission statistics from view.
        
        Uses mission_statistics_view from migration
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("mission_statistics_view")
                .select("*")
                .eq("mission_id", mission_id)
                .single()
                .execute()
            )
            return result.data if result else None
        
        return self._with_retry(_fetch)

    async def get_mission_statistics(self, mission_id: str) -> dict[str, Any] | None:
        """
        Async wrapper to get mission statistics from view.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_mission_statistics_sync(mission_id)
        )

    def _get_swarm_findings_sync(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Sync method to get all findings for a mission.
        """
        def _fetch():
            client = self._get_client()
            result = (
                client.table("swarm_findings")
                .select("*")
                .eq("mission_id", mission_id)
                .order("created_at", desc=True)
                .execute()
            )
            return result.data if result else []
        
        return self._with_retry(_fetch)

    async def get_swarm_findings(self, mission_id: str) -> list[dict[str, Any]]:
        """
        Async wrapper to get swarm findings.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._get_swarm_findings_sync(mission_id)
        )


# Singleton instance
_client: SupabaseClient | None = None


def get_supabase_client() -> SupabaseClient:
    """Get the Supabase client singleton."""
    global _client
    if _client is None:
        _client = SupabaseClient()
    return _client