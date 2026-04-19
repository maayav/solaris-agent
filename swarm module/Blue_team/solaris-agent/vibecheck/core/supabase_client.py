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

    # ==================== SCAN STATUS ====================

    def _get_scan_status_sync(self, scan_id: str) -> dict[str, Any] | None:
        """
        Sync method to get scan status.

        Args:
            scan_id: Unique scan identifier

        Returns:
            Scan record or None if not found
        """
        client = self._get_client()
        result = (
            client.table("scan_queue")
            .select("*")
            .eq("id", scan_id)
            .single()
            .execute()
        )
        return result.data if result else None

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


# Singleton instance
_client: SupabaseClient | None = None


def get_supabase_client() -> SupabaseClient:
    """Get the Supabase client singleton."""
    global _client
    if _client is None:
        _client = SupabaseClient()
    return _client