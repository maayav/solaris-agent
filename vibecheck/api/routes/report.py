"""
Report routes for Project VibeCheck.

Provides endpoints for:
- Retrieving vulnerability reports
- Listing vulnerabilities by scan
- Exporting reports in various formats
"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()


# -------------------------------------------
# Request/Response Models
# -------------------------------------------

class VulnerabilityModel(BaseModel):
    """Model for a single vulnerability."""
    id: str
    scan_id: str
    type: str
    severity: str
    category: str | None = None
    
    file_path: str
    line_start: int | None = None
    line_end: int | None = None
    
    title: str | None = None
    description: str | None = None
    code_snippet: str | None = None
    
    confirmed: bool = False
    confidence_score: float | None = None
    false_positive: bool = False
    
    fix_suggestion: str | None = None
    reproduction_test: str | None = None
    
    created_at: datetime


class ReportResponse(BaseModel):
    """Response model for a scan report."""
    scan_id: str
    project_name: str | None = None
    repo_url: str | None = None
    status: str
    
    # Statistics
    total_vulnerabilities: int = 0
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    confirmed_count: int = 0
    
    # Timestamps
    created_at: datetime
    completed_at: datetime | None = None
    
    # Vulnerabilities (paginated)
    vulnerabilities: list[VulnerabilityModel] = []


class VulnerabilityListResponse(BaseModel):
    """Response model for vulnerability list."""
    vulnerabilities: list[VulnerabilityModel]
    total: int
    page: int
    page_size: int


class VulnerabilityDetailResponse(BaseModel):
    """Response model for single vulnerability detail."""
    vulnerability: VulnerabilityModel
    related_vulnerabilities: list[VulnerabilityModel] = []


# -------------------------------------------
# Report Endpoints
# -------------------------------------------

@router.get(
    "/{scan_id}",
    response_model=ReportResponse,
    summary="Get scan report",
    description="Retrieve the full vulnerability report for a scan.",
)
async def get_report(scan_id: str) -> ReportResponse:
    """
    Get the vulnerability report for a scan.
    
    Returns summary statistics and paginated vulnerabilities.
    """
    try:
        supabase = get_supabase_client()
        report_data = await supabase.get_report(scan_id)
        
        if not report_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Scan not found: {scan_id}",
            )
        
        scan = report_data.get("scan", {})
        vulnerabilities = report_data.get("vulnerabilities", [])
        
        # Calculate statistics
        severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        confirmed_count = 0
        
        vuln_models = []
        for vuln in vulnerabilities:
            severity = vuln.get("severity", "medium").lower()
            if severity in severity_counts:
                severity_counts[severity] += 1
            
            if vuln.get("confirmed", False):
                confirmed_count += 1
            
            vuln_models.append(VulnerabilityModel(
                id=str(vuln.get("id", "")),
                scan_id=scan_id,
                type=vuln.get("type", "unknown"),
                severity=vuln.get("severity", "medium"),
                category=vuln.get("category"),
                file_path=vuln.get("file_path", ""),
                line_start=vuln.get("line_start"),
                line_end=vuln.get("line_end"),
                title=vuln.get("title"),
                description=vuln.get("description"),
                code_snippet=vuln.get("code_snippet"),
                confirmed=vuln.get("confirmed", False),
                confidence_score=vuln.get("confidence_score"),
                false_positive=vuln.get("false_positive", False),
                fix_suggestion=vuln.get("fix_suggestion"),
                reproduction_test=vuln.get("reproduction_test"),
                created_at=vuln.get("created_at", datetime.now(timezone.utc)),
            ))
        
        return ReportResponse(
            scan_id=scan_id,
            project_name=scan.get("project_name"),
            repo_url=scan.get("repo_url"),
            status=scan.get("status", "unknown"),
            total_vulnerabilities=len(vulnerabilities),
            critical_count=severity_counts["critical"],
            high_count=severity_counts["high"],
            medium_count=severity_counts["medium"],
            low_count=severity_counts["low"],
            confirmed_count=confirmed_count,
            created_at=scan.get("created_at", datetime.now(timezone.utc)),
            completed_at=scan.get("completed_at"),
            vulnerabilities=vuln_models,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get report: {str(e)}",
        )


@router.get(
    "/{scan_id}/vulnerabilities",
    response_model=VulnerabilityListResponse,
    summary="List vulnerabilities",
    description="List all vulnerabilities for a scan with filtering and pagination.",
)
async def list_vulnerabilities(
    scan_id: str,
    severity: str | None = Query(None, description="Filter by severity"),
    confirmed_only: bool = Query(False, description="Show only confirmed vulnerabilities"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> VulnerabilityListResponse:
    """
    List vulnerabilities for a scan.
    
    Supports filtering by severity and confirmation status.
    """
    try:
        supabase = get_supabase_client()
        vulnerabilities = await supabase.get_vulnerabilities(scan_id)
        
        # Apply filters
        filtered = []
        for vuln in vulnerabilities:
            if severity and vuln.get("severity", "").lower() != severity.lower():
                continue
            if confirmed_only and not vuln.get("confirmed", False):
                continue
            filtered.append(vuln)
        
        # Apply pagination
        total = len(filtered)
        start = (page - 1) * page_size
        end = start + page_size
        paginated = filtered[start:end]
        
        vuln_models = [
            VulnerabilityModel(
                id=str(v.get("id", "")),
                scan_id=scan_id,
                type=v.get("type", "unknown"),
                severity=v.get("severity", "medium"),
                category=v.get("category"),
                file_path=v.get("file_path", ""),
                line_start=v.get("line_start"),
                line_end=v.get("line_end"),
                title=v.get("title"),
                description=v.get("description"),
                code_snippet=v.get("code_snippet"),
                confirmed=v.get("confirmed", False),
                confidence_score=v.get("confidence_score"),
                false_positive=v.get("false_positive", False),
                fix_suggestion=v.get("fix_suggestion"),
                reproduction_test=v.get("reproduction_test"),
                created_at=v.get("created_at", datetime.now(timezone.utc)),
            )
            for v in paginated
        ]
        
        return VulnerabilityListResponse(
            vulnerabilities=vuln_models,
            total=total,
            page=page,
            page_size=page_size,
        )
        
    except Exception as e:
        logger.error(f"Failed to list vulnerabilities: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list vulnerabilities: {str(e)}",
        )


@router.get(
    "/{scan_id}/vulnerabilities/{vuln_id}",
    response_model=VulnerabilityDetailResponse,
    summary="Get vulnerability detail",
    description="Get detailed information about a specific vulnerability.",
)
async def get_vulnerability_detail(
    scan_id: str,
    vuln_id: str,
) -> VulnerabilityDetailResponse:
    """
    Get detailed information about a vulnerability.
    
    Includes code snippet, reproduction test, and related vulnerabilities.
    """
    try:
        supabase = get_supabase_client()
        vulnerabilities = await supabase.get_vulnerabilities(scan_id)
        
        # Find the specific vulnerability
        vuln = None
        for v in vulnerabilities:
            if str(v.get("id", "")) == vuln_id:
                vuln = v
                break
        
        if not vuln:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Vulnerability {vuln_id} not found in scan {scan_id}",
            )
        
        vuln_model = VulnerabilityModel(
            id=str(vuln.get("id", "")),
            scan_id=scan_id,
            type=vuln.get("type", "unknown"),
            severity=vuln.get("severity", "medium"),
            category=vuln.get("category"),
            file_path=vuln.get("file_path", ""),
            line_start=vuln.get("line_start"),
            line_end=vuln.get("line_end"),
            title=vuln.get("title"),
            description=vuln.get("description"),
            code_snippet=vuln.get("code_snippet"),
            confirmed=vuln.get("confirmed", False),
            confidence_score=vuln.get("confidence_score"),
            false_positive=vuln.get("false_positive", False),
            fix_suggestion=vuln.get("fix_suggestion"),
            reproduction_test=vuln.get("reproduction_test"),
            created_at=vuln.get("created_at", datetime.now(timezone.utc)),
        )
        
        # Find related vulnerabilities (same type or same file)
        related = []
        for v in vulnerabilities:
            if str(v.get("id", "")) == vuln_id:
                continue
            if v.get("type") == vuln.get("type") or v.get("file_path") == vuln.get("file_path"):
                related.append(VulnerabilityModel(
                    id=str(v.get("id", "")),
                    scan_id=scan_id,
                    type=v.get("type", "unknown"),
                    severity=v.get("severity", "medium"),
                    category=v.get("category"),
                    file_path=v.get("file_path", ""),
                    line_start=v.get("line_start"),
                    line_end=v.get("line_end"),
                    title=v.get("title"),
                    description=v.get("description"),
                    code_snippet=v.get("code_snippet"),
                    confirmed=v.get("confirmed", False),
                    confidence_score=v.get("confidence_score"),
                    false_positive=v.get("false_positive", False),
                    fix_suggestion=v.get("fix_suggestion"),
                    reproduction_test=v.get("reproduction_test"),
                    created_at=v.get("created_at", datetime.now(timezone.utc)),
                ))
        
        return VulnerabilityDetailResponse(
            vulnerability=vuln_model,
            related_vulnerabilities=related[:5],  # Limit to 5 related
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get vulnerability detail: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get vulnerability detail: {str(e)}",
        )


@router.get(
    "/{scan_id}/export",
    summary="Export report",
    description="Export the scan report in various formats.",
)
async def export_report(
    scan_id: str,
    format: str = Query("json", description="Export format (json, csv, sarif)"),
) -> dict[str, Any]:
    """
    Export the scan report.
    
    Supported formats:
    - json: Full JSON report
    - csv: Comma-separated values
    - sarif: SARIF format for GitHub Advanced Security
    """
    # TODO: Implement export functionality
    
    if format not in ["json", "csv", "sarif"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported export format: {format}",
        )
    
    return {
        "scan_id": scan_id,
        "format": format,
        "download_url": f"/reports/{scan_id}/download.{format}",
    }


# -------------------------------------------
# Statistics Endpoints
# -------------------------------------------

class StatisticsResponse(BaseModel):
    """Response model for scan statistics."""
    scan_id: str
    total_vulnerabilities: int
    by_severity: dict[str, int]
    by_type: dict[str, int]
    confirmed_count: int
    false_positive_count: int
    average_confidence: float | None


@router.get(
    "/{scan_id}/statistics",
    response_model=StatisticsResponse,
    summary="Get scan statistics",
    description="Get aggregated statistics for a scan.",
)
async def get_statistics(scan_id: str) -> StatisticsResponse:
    """
    Get aggregated statistics for a scan.
    
    Returns counts by severity, type, and confirmation status.
    """
    try:
        supabase = get_supabase_client()
        vulnerabilities = await supabase.get_vulnerabilities(scan_id)
        
        # Calculate statistics
        by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        by_type: dict[str, int] = {}
        confirmed_count = 0
        false_positive_count = 0
        confidence_sum = 0.0
        confidence_count = 0
        
        for vuln in vulnerabilities:
            # Count by severity
            severity = vuln.get("severity", "medium").lower()
            if severity in by_severity:
                by_severity[severity] += 1
            else:
                by_severity["info"] += 1
            
            # Count by type
            vuln_type = vuln.get("type", "unknown")
            by_type[vuln_type] = by_type.get(vuln_type, 0) + 1
            
            # Count confirmed
            if vuln.get("confirmed", False):
                confirmed_count += 1
            
            # Count false positives
            if vuln.get("false_positive", False):
                false_positive_count += 1
            
            # Sum confidence scores
            if vuln.get("confidence_score") is not None:
                confidence_sum += vuln["confidence_score"]
                confidence_count += 1
        
        average_confidence = confidence_sum / confidence_count if confidence_count > 0 else None
        
        return StatisticsResponse(
            scan_id=scan_id,
            total_vulnerabilities=len(vulnerabilities),
            by_severity=by_severity,
            by_type=by_type,
            confirmed_count=confirmed_count,
            false_positive_count=false_positive_count,
            average_confidence=average_confidence,
        )
        
    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get statistics: {str(e)}",
        )