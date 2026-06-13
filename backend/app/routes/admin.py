"""
Admin routes for ingestion management and monitoring
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import Literal, Optional, Dict, Any, List
import logging
from datetime import datetime

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.ingestion_state_service import IngestionStateService
from app.services.rich_summary_service import RichSummaryService
from app.models.article import Article, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.tasks.ingestion_tasks import cleanup_expired_articles
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class IngestionStatusResponse(BaseModel):
    """Response model for ingestion status"""
    id: str
    file_path: str
    file_hash: str
    last_ingested_at: Optional[datetime]
    total_articles_ingested: int
    status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime


class IngestionStatsResponse(BaseModel):
    """Response model for ingestion statistics"""
    total_articles: int
    total_ingestion_states: int
    last_ingestion: Optional[datetime]
    articles_by_industry: Dict[str, int]
    articles_by_priority: Dict[str, int]


@router.get("/ingestion-status", response_model=List[IngestionStatusResponse])
async def get_ingestion_status(
    file_path: Optional[str] = Query(None, description="Filter by file path"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of records"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[IngestionStatusResponse]:
    """
    Get ingestion history and status
    
    Args:
        file_path: Optional file path filter
        limit: Maximum number of records to return
        db: Database session
        
    Returns:
        List of ingestion states ordered by creation date (newest first)
    """
    try:
        states = IngestionStateService.get_ingestion_history(file_path, limit, db)
        
        return [
            IngestionStatusResponse(
                id=str(state.id),
                file_path=state.file_path,
                file_hash=state.file_hash,
                last_ingested_at=state.last_ingested_at,
                total_articles_ingested=state.total_articles_ingested,
                status=state.status.value,
                error_message=state.error_message,
                created_at=state.created_at,
                updated_at=state.updated_at
            )
            for state in states
        ]
        
    except Exception as e:
        logger.error(f"Error getting ingestion status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving ingestion status: {str(e)}"
        )


@router.get("/ingestion-stats", response_model=IngestionStatsResponse)
async def get_ingestion_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IngestionStatsResponse:
    """
    Get overall ingestion statistics
    
    Args:
        db: Database session
        
    Returns:
        Dictionary with ingestion statistics
    """
    try:
        stats = IngestionStateService.get_ingestion_stats(db)
        
        return IngestionStatsResponse(
            total_articles=stats['total_articles'],
            total_ingestion_states=stats['total_ingestion_states'],
            last_ingestion=stats['last_ingestion'],
            articles_by_industry=stats['articles_by_industry'],
            articles_by_priority=stats['articles_by_priority']
        )
        
    except Exception as e:
        logger.error(f"Error getting ingestion stats: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving ingestion statistics: {str(e)}"
        )


@router.get("/ingestion-logs/{state_id}")
async def get_ingestion_logs(
    state_id: str,
    limit: int = Query(50, ge=1, le=500, description="Maximum number of log entries"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """
    Get detailed logs for a specific ingestion state
    
    Args:
        state_id: UUID of the ingestion state
        limit: Maximum number of log entries to return
        db: Database session
        
    Returns:
        List of ingestion log entries
    """
    try:
        from app.models.ingestion import IngestionLog
        
        logs = db.query(IngestionLog).filter(
            IngestionLog.ingestion_state_id == state_id
        ).order_by(IngestionLog.timestamp.desc()).limit(limit).all()
        
        return [
            {
                'id': str(log.id),
                'action': log.action,
                'article_id': str(log.article_id) if log.article_id else None,
                'details': log.details,
                'timestamp': log.timestamp
            }
            for log in logs
        ]
        
    except Exception as e:
        logger.error(f"Error getting ingestion logs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving ingestion logs: {str(e)}"
        )


@router.post("/generate-rich-content")
async def generate_rich_content_for_articles(
    limit: int = Query(10, ge=1, le=100, description="Max articles to process"),
    force: bool = Query(False, description="Regenerate even if exists"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Generate rich content (4-part summary + Socratic prompts) for existing articles.
    
    This endpoint processes articles that don't have rich content generated yet,
    using Claude to create personalized summaries and thought-provoking questions.
    
    Args:
        limit: Maximum number of articles to process
        force: If True, regenerate content even for articles that have it
        db: Database session
        
    Returns:
        Processing results
    """
    import time
    start_time = time.time()
    
    result = {
        'processed': 0,
        'success': 0,
        'failed': 0,
        'skipped': 0,
        'errors': [],
        'duration_seconds': 0
    }
    
    try:
        # Get articles that need rich content
        if force:
            # Process all articles up to limit
            articles = db.query(Article).limit(limit).all()
        else:
            # Only process articles without rich content
            existing_ids = db.query(ArticleRichContent.article_id).all()
            existing_ids = [r[0] for r in existing_ids]
            
            articles = db.query(Article).filter(
                ~Article.id.in_(existing_ids) if existing_ids else True
            ).limit(limit).all()
        
        logger.info(f"Processing {len(articles)} articles for rich content generation")
        
        rich_service = RichSummaryService(db)
        
        for article in articles:
            result['processed'] += 1
            
            try:
                # Get industry/specialization from expert notes
                expert_note = db.query(ExpertNote).filter(
                    ExpertNote.article_id == article.id
                ).first()
                
                from app.services.industries_config import IndustriesConfig
                _defaults = IndustriesConfig.get_instance().get_defaults()
                industry = expert_note.expert_industry if expert_note else _defaults['industry_name']
                specializations = expert_note.expert_specializations if expert_note else [_defaults['specialization_name']]
                specialization = specializations[0] if specializations else _defaults['specialization_name']
                
                # Delete existing if force regeneration
                if force:
                    db.query(ArticleRichContent).filter(
                        ArticleRichContent.article_id == article.id
                    ).delete()
                    db.commit()
                
                # Generate rich content
                rich_content = rich_service.generate_rich_content(
                    article=article,
                    industry=industry,
                    specialization=specialization,
                    related_article_titles=None
                )
                
                if rich_content:
                    result['success'] += 1
                    logger.info(f"Generated rich content for article {article.id}: {article.title[:50]}...")
                else:
                    result['failed'] += 1
                    result['errors'].append({
                        'article_id': str(article.id),
                        'error': 'RichSummaryService returned None'
                    })
                    
            except Exception as e:
                result['failed'] += 1
                result['errors'].append({
                    'article_id': str(article.id),
                    'error': str(e)
                })
                logger.error(f"Error generating rich content for {article.id}: {e}")
        
        result['duration_seconds'] = round(time.time() - start_time, 2)
        
        logger.info(f"Rich content generation complete: {result['success']}/{result['processed']} successful")
        return result
        
    except Exception as e:
        logger.error(f"Error in rich content generation: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Rich content generation error: {str(e)}"
        )


class BackfillCruxRequest(BaseModel):
    """Request body for POST /admin/backfill-crux"""
    limit: int = 10
    scope: Literal["priority", "all"] = "priority"


@router.post("/backfill-crux")
async def backfill_crux(
    request: BackfillCruxRequest = BackfillCruxRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Backfill GUR-231 crux fields (core_argument / strongest_evidence /
    counterpoints) for articles whose rich_summary predates them.

    Re-runs the single-pass rich summary generation in place for up to
    `limit` articles whose rich content lacks core_argument.
    scope='priority' processes saved / essential / AI-industry articles first;
    scope='all' takes any (newest first).

    Batch-callable: synchronous within the request (no background tasks —
    they die on redeploy). Call repeatedly until `remaining` reaches 0.
    """
    try:
        missing_crux = or_(
            ArticleRichContent.core_argument.is_(None),
            ArticleRichContent.core_argument == "",
        )

        # All candidates, newest articles first (raw_text is deferred, so this is cheap)
        candidates = (
            db.query(Article, ArticleRichContent)
            .join(ArticleRichContent, ArticleRichContent.article_id == Article.id)
            .filter(missing_crux)
            .order_by(Article.created_at.desc())
            .all()
        )

        if request.scope == "priority":
            from app.models.interaction import UserSavedArticle
            saved_ids = {r[0] for r in db.query(UserSavedArticle.article_id).distinct().all()}
            essential_ids = {
                r[0] for r in db.query(ExpertNote.article_id).filter(
                    ExpertNote.priority == "Essential"
                ).all()
            }

            def _is_priority(article: Article) -> bool:
                if article.id in saved_ids or article.id in essential_ids:
                    return True
                industries = article.industries or []
                return isinstance(industries, list) and "AI" in industries

            # Stable sort: priority articles first, newest-first order preserved within groups
            candidates.sort(key=lambda pair: 0 if _is_priority(pair[0]) else 1)

        batch = candidates[: max(0, request.limit)]

        from app.services.industries_config import IndustriesConfig
        _defaults = IndustriesConfig.get_instance().get_defaults()
        rich_service = RichSummaryService(db)
        processed = 0

        for article, rc in batch:
            # Reuse the personalization context the row was originally built with;
            # fall back to expert note, then config defaults.
            industry = rc.industry_context
            specialization = rc.specialization_context
            if not industry or not specialization:
                expert_note = db.query(ExpertNote).filter(
                    ExpertNote.article_id == article.id
                ).first()
                if not industry:
                    industry = (expert_note.expert_industry if expert_note else None) or _defaults['industry_name']
                if not specialization:
                    specs = expert_note.expert_specializations if expert_note else None
                    specialization = (specs[0] if specs else None) or _defaults['specialization_name']

            result = rich_service.regenerate_rich_content(
                article=article,
                industry=industry,
                specialization=specialization,
                existing=rc,
            )
            if result is not None and result.core_argument:
                processed += 1

        remaining = (
            db.query(ArticleRichContent)
            .filter(missing_crux)
            .count()
        )

        logger.info(f"Crux backfill: processed={processed}, remaining={remaining} (scope={request.scope})")
        return {"processed": processed, "remaining": remaining}

    except Exception as e:
        logger.error(f"Error in crux backfill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Crux backfill error: {str(e)}"
        )


@router.post("/cleanup-expired")
async def trigger_cleanup_expired(
    expiration_days: Optional[int] = Query(None, ge=1, le=365, description="Override expiration days (uses config if not specified)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Manually trigger cleanup of expired articles.

    Articles older than the expiration period will be deleted along with
    their associated expert notes and rich content.

    Args:
        expiration_days: Override the config expiration period (optional)
        db: Database session

    Returns:
        Cleanup results with counts of deleted items
    """
    try:
        result = cleanup_expired_articles(db, expiration_days)

        return {
            'status': 'success',
            'deleted_articles': result['deleted_articles'],
            'deleted_notes': result['deleted_notes'],
            'deleted_rich_content': result['deleted_rich_content'],
            'expiration_days': result['expiration_days'],
            'message': f"Cleaned up {result['deleted_articles']} expired articles (older than {result['expiration_days']} days)"
        }

    except Exception as e:
        logger.error(f"Error in cleanup: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Cleanup error: {str(e)}"
        )


@router.get("/expiration-settings")
async def get_expiration_settings(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Get current article expiration settings from config.

    Returns:
        Current expiration settings
    """
    try:
        from app.services.industries_config import IndustriesConfig
        config = IndustriesConfig.get_instance()

        return {
            'article_expiration_days': config.get_article_expiration_days(),
            'auto_cleanup_on_startup': config.is_auto_cleanup_enabled(),
            'message': f"Articles expire after {config.get_article_expiration_days()} days"
        }

    except Exception as e:
        logger.error(f"Error getting expiration settings: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving settings: {str(e)}"
        )


@router.get("/perf-metrics")
async def get_perf_metrics(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Dev Metrics Panel data: API response times, ingestion timings, content stats.

    Returns combined performance data for the frontend Dev Metrics Panel.
    """
    from app.services.perf_store import PerfStore
    from app.models.article import Article
    from app.models.storyboard import Storyboard
    from app.models.ingestion_run import IngestionRun

    store = PerfStore.get_instance()

    # Content stats (fast queries)
    total_articles = db.query(Article).count()
    total_storyboards = db.query(Storyboard).count()

    # Last ingestion run per tier
    last_runs = {}
    for tier in ["tier1_expert", "tier2_luminary", "tier3_discovery"]:
        run = db.query(IngestionRun).filter(
            IngestionRun.tier == tier
        ).order_by(IngestionRun.started_at.desc()).first()
        if run:
            last_runs[tier] = {
                "status": run.status,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                "articles_found": run.articles_found,
                "articles_ingested": run.articles_ingested,
                "articles_rejected": run.articles_rejected,
                "step_timings": getattr(run, 'step_timings', None),
            }

    return {
        "api": store.get_api_summary(),
        "ingestion": {
            **store.get_ingestion_summary(),
            "last_runs": last_runs,
        },
        "content": {
            "total_articles": total_articles,
            "total_storyboards": total_storyboards,
        },
    }
