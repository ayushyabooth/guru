"""
Ingestion status and control routes.

Provides:
- Status polling for frontend progress display
- Run history for observability
- Admin trigger endpoints for manual tier runs
"""
import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.deps import get_current_user
from app.models.user import User

from app.db.database import get_db
from app.models.ingestion_run import IngestionRun

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingestion", tags=["ingestion"])


# ── Response Models ────────────────────────────────────────────


class TierStatus(BaseModel):
    status: str
    last_run: Optional[str] = None
    articles_found: Optional[int] = None
    articles_ingested: Optional[int] = None
    articles_rejected: Optional[int] = None

    class Config:
        from_attributes = True


class IngestionStatusResponse(BaseModel):
    running: bool
    tiers: dict


class IngestionRunResponse(BaseModel):
    id: str
    tier: str
    status: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    articles_found: int = 0
    articles_ingested: int = 0
    articles_rejected: int = 0
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class TriggerResponse(BaseModel):
    message: str
    tier: str


# ── Status Endpoint ────────────────────────────────────────────


@router.get("/status", response_model=IngestionStatusResponse)
async def get_ingestion_status():
    """
    Get current ingestion orchestrator status.

    Returns the running state and latest run info for each tier.
    Frontend can poll this to show ingestion progress.
    """
    try:
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        orchestrator = IngestionOrchestrator.get_instance()
        return orchestrator.get_status()
    except Exception as e:
        logger.error(f"Failed to get ingestion status: {e}")
        return {"running": False, "tiers": {}, "error": str(e)}


# ── Run History ────────────────────────────────────────────────


@router.get("/runs", response_model=List[IngestionRunResponse])
async def get_ingestion_runs(
    tier: Optional[str] = Query(None, description="Filter by tier (tier1_expert, tier2_luminary, tier3_discovery)"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    Get recent ingestion run history.

    Returns the latest runs, optionally filtered by tier.
    """
    query = db.query(IngestionRun).order_by(IngestionRun.started_at.desc())

    if tier:
        valid_tiers = ["tier1_expert", "tier2_luminary", "tier3_discovery"]
        if tier not in valid_tiers:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid tier '{tier}'. Must be one of: {valid_tiers}",
            )
        query = query.filter(IngestionRun.tier == tier)

    runs = query.limit(limit).all()

    return [
        IngestionRunResponse(
            id=str(run.id),
            tier=run.tier,
            status=run.status,
            started_at=run.started_at.isoformat() if run.started_at else None,
            completed_at=run.completed_at.isoformat() if run.completed_at else None,
            articles_found=run.articles_found or 0,
            articles_ingested=run.articles_ingested or 0,
            articles_rejected=run.articles_rejected or 0,
            error_message=run.error_message,
        )
        for run in runs
    ]


# ── Admin Trigger Endpoints ────────────────────────────────────


@router.post("/trigger/{tier}", response_model=TriggerResponse)
async def trigger_ingestion(tier: str, current_user: User = Depends(get_current_user)):
    """
    Manually trigger an ingestion run for a specific tier.

    Runs the tier in the background and returns immediately.
    Use GET /status to check progress.
    """
    valid_tiers = {
        "tier2": "tier2_luminary",
        "tier3": "tier3_discovery",
        "tier2_luminary": "tier2_luminary",
        "tier3_discovery": "tier3_discovery",
    }

    normalized_tier = valid_tiers.get(tier)
    if not normalized_tier:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid tier '{tier}'. Use: tier2, tier3",
        )

    try:
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        orchestrator = IngestionOrchestrator.get_instance()

        if normalized_tier == "tier2_luminary":
            asyncio.create_task(orchestrator._scheduled_tier2())
        elif normalized_tier == "tier3_discovery":
            asyncio.create_task(orchestrator._scheduled_tier3())

        return TriggerResponse(
            message=f"Ingestion triggered for {normalized_tier}. Check /status for progress.",
            tier=normalized_tier,
        )

    except Exception as e:
        logger.error(f"Failed to trigger {tier}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
