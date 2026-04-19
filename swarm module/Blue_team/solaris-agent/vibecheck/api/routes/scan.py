"""
Scan routes for Project VibeCheck.

Provides endpoints for:
- Triggering new scans
- Checking scan status
- Listing scan history

Week 2: Wired to Supabase for real status data.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl

from core.redis_bus import get_redis_bus
from core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()


# -------------------------------------------
# Request/Response Models
# -------------------------------------------

class ScanTriggerRequest(BaseModel):
    """Request model for triggering a new scan."""
    repo_url: str = Field(..., description="Repository URL to scan")
    project_name: str | None = Field(None, description="Optional project name")
    triggered_by: str = Field(default="manual", description="Who triggered the scan")
    priority: str = Field(default="normal", description="Scan priority (low, normal, high)")


class ScanTriggerResponse(BaseModel):
    """Response model for scan trigger."""
    scan_id: str = Field(..., description="Unique scan identifier")
    message: str = Field(..., description="Status message")
    queue_position: int | None = Field(None, description="Position in queue")


class ScanStatusResponse(BaseModel):
    """Response model for scan status."""
    scan_id: str
    status: str
    progress: int
    current_stage: str | None = None
    stage_output: dict | None = None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class ScanListResponse(BaseModel):
    """Response model for scan list."""
    scans: list[ScanStatusResponse]
    total: int


# -------------------------------------------
# Scan Endpoints
# -------------------------------------------

@router.post(
    "/trigger",
    response_model=ScanTriggerResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger a new scan",
    description="Submit a repository URL for security scanning. The scan runs asynchronously.",
)
async def trigger_scan(request: ScanTriggerRequest) -> ScanTriggerResponse:
    """
    Trigger a new security scan.
    
    This endpoint:
    1. Validates the repository URL
    2. Creates a unique scan ID
    3. Creates a scan record in Supabase
    4. Publishes the scan job to Redis Stream
    5. Returns the scan ID for status tracking
    
    The actual scanning happens asynchronously in the worker process.
    """
    logger.info(f"Received scan request for: {request.repo_url}")
    
    # Generate unique scan ID
    scan_id = str(uuid4())
    
    try:
        # Create scan record in Supabase first
        supabase = get_supabase_client()
        await supabase.create_scan(
            scan_id=scan_id,
            repo_url=request.repo_url,
            triggered_by=request.triggered_by,
        )
        logger.info(f"Created scan record in Supabase: scan_id={scan_id}")
        
        # Get Redis bus
        redis_bus = get_redis_bus()
        
        # Publish scan job to Redis Stream
        msg_id = await redis_bus.publish_scan_job(
            repo_url=request.repo_url,
            project_id=None,  # Will be created by worker if needed
            triggered_by=request.triggered_by,
            scan_id=scan_id,  # Pass scan_id to worker
        )
        
        logger.info(f"Scan job published: scan_id={scan_id}, msg_id={msg_id}")
        
        # Get queue position (approximate)
        queue_length = await redis_bus.get_stream_length("scan_queue")
        
        return ScanTriggerResponse(
            scan_id=scan_id,
            message="Scan job queued successfully",
            queue_position=queue_length,
        )
        
    except Exception as e:
        logger.error(f"Failed to queue scan job: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue scan job: {str(e)}",
        )


@router.get(
    "/{scan_id}/status",
    response_model=ScanStatusResponse,
    summary="Get scan status",
    description="Check the status of a running or completed scan.",
)
async def get_scan_status(scan_id: str) -> ScanStatusResponse:
    """
    Get the status of a scan job.
    
    Returns current status, progress percentage, and timestamps.
    Week 2: Now queries Supabase for real status data.
    """
    try:
        supabase = get_supabase_client()
        scan_data = await supabase.get_scan_status(scan_id)
        
        if not scan_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Scan not found: {scan_id}",
            )
        
        return ScanStatusResponse(
            scan_id=str(scan_data.get("id", scan_id)),
            status=scan_data.get("status", "unknown"),
            progress=scan_data.get("progress", 0),
            current_stage=scan_data.get("current_stage"),
            stage_output=scan_data.get("stage_output"),
            error_message=scan_data.get("error_message"),
            started_at=scan_data.get("started_at"),
            completed_at=scan_data.get("completed_at"),
            created_at=scan_data.get("created_at", datetime.now(timezone.utc)),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get scan status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get scan status: {str(e)}",
        )


@router.get(
    "/",
    response_model=ScanListResponse,
    summary="List scans",
    description="List all scans with optional filtering.",
)
async def list_scans(
    status: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> ScanListResponse:
    """
    List scan jobs with optional filtering.
    
    Query parameters:
    - status: Filter by status (pending, running, completed, failed)
    - limit: Maximum number of results
    - offset: Pagination offset
    
    Week 2: Now queries Supabase for real scan data.
    """
    try:
        supabase = get_supabase_client()
        scans_data = await supabase.list_scans(
            status=status,
            limit=limit,
            offset=offset,
        )
        
        scans = [
            ScanStatusResponse(
                scan_id=str(scan.get("id", "")),
                status=scan.get("status", "unknown"),
                progress=scan.get("progress", 0),
                current_stage=scan.get("current_stage"),
                stage_output=scan.get("stage_output"),
                error_message=scan.get("error_message"),
                started_at=scan.get("started_at"),
                completed_at=scan.get("completed_at"),
                created_at=scan.get("created_at", datetime.now(timezone.utc)),
            )
            for scan in scans_data.get("scans", [])
        ]
        
        return ScanListResponse(
            scans=scans,
            total=scans_data.get("total", 0),
        )
        
    except Exception as e:
        logger.error(f"Failed to list scans: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list scans: {str(e)}",
        )


@router.post(
    "/{scan_id}/cancel",
    summary="Cancel a scan",
    description="Cancel a running scan.",
)
async def cancel_scan(scan_id: str) -> dict[str, str]:
    """
    Cancel a running scan.
    
    Only pending or running scans can be cancelled.
    """
    try:
        supabase = get_supabase_client()
        
        # Get current scan status
        scan_data = await supabase.get_scan_status(scan_id)
        
        if not scan_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Scan not found: {scan_id}",
            )
        
        current_status = scan_data.get("status", "")
        
        # Check if scan can be cancelled
        if current_status not in ("pending", "running"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot cancel scan with status: {current_status}",
            )
        
        # Update scan status to cancelled
        success = await supabase.update_scan_status(
            scan_id=scan_id,
            status="cancelled",
            error_message="Scan cancelled by user request",
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to cancel scan",
            )
        
        # Publish cancellation event for workers
        redis_bus = get_redis_bus()
        await redis_bus.publish(
            "scan_cancellations",
            {"scan_id": scan_id, "timestamp": datetime.now(timezone.utc).isoformat()},
        )
        
        logger.info(f"Scan cancelled: {scan_id}")
        
        return {
            "scan_id": scan_id,
            "message": "Scan cancelled successfully",
            "previous_status": current_status,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel scan: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel scan: {str(e)}",
        )


# -------------------------------------------
# Webhook Endpoints (for GitHub integration)
# -------------------------------------------

class GitHubWebhookPayload(BaseModel):
    """GitHub webhook payload model (simplified)."""
    ref: str
    repository: dict[str, Any]
    pusher: dict[str, Any] | None = None
    commits: list[dict[str, Any]] = []


@router.post(
    "/webhook/github",
    status_code=status.HTTP_202_ACCEPTED,
    summary="GitHub webhook",
    description="Handle GitHub push events to trigger automatic scans.",
)
async def github_webhook(payload: GitHubWebhookPayload) -> dict[str, str]:
    """
    Handle GitHub webhook push events.
    
    When code is pushed to a repository, this endpoint:
    1. Extracts the repository URL
    2. Queues a new scan job
    3. Returns immediately (async processing)
    """
    repo_url = payload.repository.get("clone_url")
    if not repo_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repository URL not found in payload",
        )
    
    logger.info(f"GitHub webhook received for: {repo_url}")
    
    try:
        redis_bus = get_redis_bus()
        
        # Queue scan job
        await redis_bus.publish_scan_job(
            repo_url=repo_url,
            triggered_by="github_webhook",
        )
        
        return {
            "status": "queued",
            "repo_url": repo_url,
            "branch": payload.ref,
        }
        
    except Exception as e:
        logger.error(f"Failed to process GitHub webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process webhook: {str(e)}",
        )