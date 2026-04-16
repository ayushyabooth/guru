"""
Admin routes for ingestion management and monitoring
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
import logging
import os
from pathlib import Path
from datetime import datetime

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.ingestion_state_service import IngestionStateService
from app.services.markdown_ingestion_service import (
    parse_expert_links_md_with_state,
    get_expert_links_filepath,
    find_latest_expert_links_file
)
from app.services.rich_summary_service import RichSummaryService
from app.models.ingestion import IngestionState, IngestionStatus
from app.models.article import Article, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.tasks.ingestion_tasks import smart_ingest_expert_links, cleanup_expired_articles
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class ForceIngestRequest(BaseModel):
    """Request model for force ingestion"""
    filepath: str = "auto"  # "auto" = auto-detect latest file in expert-links/
    skip_existing: bool = True
    include_rss: bool = False  # Also run Tier 2 luminary RSS feed ingestion


class ForceIngestResponse(BaseModel):
    """Response model for force ingestion"""
    status: str
    total_created: int
    total_updated: int
    total_skipped: int
    errors: int
    duration_seconds: float
    message: str
    file_used: Optional[str] = None  # The actual file that was used
    rss_articles_ingested: int = 0  # Tier 2 RSS articles (if include_rss=true)


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


@router.post("/ingest-force", response_model=ForceIngestResponse)
async def force_ingest(
    request: ForceIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ForceIngestResponse:
    """
    Force re-ingestion even if file hasn't changed.

    By default, auto-detects the latest Expert_Links_YYYY-MM-DD.md file
    in the expert-links/ directory. You can also specify a specific filepath.

    Args:
        request: Force ingestion parameters
        db: Database session

    Returns:
        Ingestion results with timing information
    """
    import time
    import os

    start_time = time.time()

    try:
        # Auto-detect or validate the file path
        try:
            actual_filepath = get_expert_links_filepath(request.filepath)
        except FileNotFoundError as e:
            raise HTTPException(
                status_code=404,
                detail=str(e)
            )

        logger.info(f"Force ingestion requested for {actual_filepath} (skip_existing={request.skip_existing})")

        # Create new ingestion state
        ingestion_state = IngestionStateService.create_ingestion_state(actual_filepath, db)

        # Update state to in_progress
        IngestionStateService.update_ingestion_state(
            str(ingestion_state.id),
            IngestionStatus.IN_PROGRESS,
            db=db
        )

        try:
            if request.skip_existing:
                # Use state-aware parsing that skips existing articles
                result = parse_expert_links_md_with_state(
                    actual_filepath,
                    str(ingestion_state.id),
                    db
                )
            else:
                # Clear existing articles first, then ingest all
                from app.models.article import Article, ExpertNote

                # Delete existing articles and notes
                db.query(ExpertNote).delete()
                db.query(Article).delete()
                db.commit()

                # Log the clearing action
                IngestionStateService.log_ingestion_action(
                    str(ingestion_state.id),
                    'cleared_existing',
                    details="Cleared all existing articles and expert notes",
                    db=db
                )

                # Now ingest all articles as new
                result = parse_expert_links_md_with_state(
                    actual_filepath,
                    str(ingestion_state.id),
                    db
                )
            
            # Update state to completed
            total_articles = result['created'] + result['updated']
            IngestionStateService.update_ingestion_state(
                str(ingestion_state.id),
                IngestionStatus.COMPLETED,
                total_articles=total_articles,
                db=db
            )
            
            # --- Optional: Run Tier 2 luminary RSS feed ingestion ---
            rss_ingested = 0
            if request.include_rss:
                logger.info("Force ingestion: also running Tier 2 luminary RSS ingestion...")
                try:
                    from app.services.ingestion_orchestrator import IngestionOrchestrator
                    orchestrator = IngestionOrchestrator()
                    import asyncio
                    rss_ingested = await orchestrator.run_tier2()
                    logger.info(f"RSS ingestion complete: {rss_ingested} articles ingested")
                except Exception as rss_err:
                    logger.error(f"RSS ingestion failed (non-fatal): {rss_err}")

            duration = round(time.time() - start_time, 2)

            rss_msg = f", RSS: {rss_ingested}" if request.include_rss else ""
            response = ForceIngestResponse(
                status="success",
                total_created=result['created'],
                total_updated=result['updated'],
                total_skipped=result['skipped'],
                errors=result['errors'],
                duration_seconds=duration,
                message=f"Force ingestion completed. Created: {result['created']}, Skipped: {result['skipped']}, Errors: {result['errors']}{rss_msg}",
                file_used=actual_filepath,
                rss_articles_ingested=rss_ingested
            )

            logger.info(f"Force ingestion completed: {response.message} (took {duration}s)")
            return response
            
        except Exception as e:
            # Update state to failed
            error_msg = str(e)
            IngestionStateService.update_ingestion_state(
                str(ingestion_state.id),
                IngestionStatus.FAILED,
                error_message=error_msg,
                db=db
            )
            
            duration = round(time.time() - start_time, 2)
            
            logger.error(f"Force ingestion failed: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail=f"Ingestion failed: {error_msg}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        duration = round(time.time() - start_time, 2)
        logger.error(f"Force ingestion error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Force ingestion error: {str(e)}"
        )


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


@router.post("/smart-ingest")
async def trigger_smart_ingest(
    filepath: str = Query("auto", description="Path to the file to ingest, or 'auto' to auto-detect latest"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Trigger smart ingestion (checks if file changed before processing).

    By default, auto-detects the latest Expert_Links_YYYY-MM-DD.md file
    in the expert-links/ directory.

    Args:
        filepath: Path to the file to ingest, or "auto" to auto-detect
        db: Database session

    Returns:
        Smart ingestion results
    """
    try:
        # Auto-detect the file path
        try:
            actual_filepath = get_expert_links_filepath(filepath)
        except FileNotFoundError as e:
            raise HTTPException(
                status_code=404,
                detail=str(e)
            )

        result = await smart_ingest_expert_links(actual_filepath)
        result['file_used'] = actual_filepath
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in smart ingestion: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Smart ingestion error: {str(e)}"
        )


@router.get("/expert-links-info")
async def get_expert_links_info(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Get information about available expert links files.

    Returns:
        Information about the latest file and all available files in the directory.
    """
    import os
    import glob as glob_module
    from app.services.markdown_ingestion_service import EXPERT_LINKS_DIR

    try:
        # Get the latest file
        latest_file, latest_date = find_latest_expert_links_file()

        # List all files in the directory
        all_files = []
        if os.path.isdir(EXPERT_LINKS_DIR):
            pattern = os.path.join(EXPERT_LINKS_DIR, "Expert_Links_*.md")
            for f in sorted(glob_module.glob(pattern), reverse=True):
                stat = os.stat(f)
                all_files.append({
                    'filename': os.path.basename(f),
                    'path': f,
                    'size_bytes': stat.st_size,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                })

        return {
            'expert_links_directory': EXPERT_LINKS_DIR,
            'directory_exists': os.path.isdir(EXPERT_LINKS_DIR),
            'latest_file': {
                'path': latest_file,
                'date': latest_date,
                'filename': os.path.basename(latest_file) if latest_file else None
            } if latest_file else None,
            'all_files': all_files,
            'total_files': len(all_files)
        }

    except Exception as e:
        logger.error(f"Error getting expert links info: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving expert links info: {str(e)}"
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


@router.post("/upload-expert-links")
async def upload_expert_links(
    file: UploadFile = File(...),
    auto_ingest: bool = Query(True, description="Trigger Tier 1 ingestion after upload"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload an expert links markdown file and optionally trigger ingestion.

    Security: requires JWT auth. Validates file type and size.
    """
    from app.config import settings

    # Validate file type
    if not file.filename or not file.filename.endswith('.md'):
        raise HTTPException(status_code=400, detail="Only .md files accepted")

    # Read content and validate size (5MB max)
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (5MB max)")

    # Determine upload directory
    if settings.EXPERT_LINKS_DIR:
        upload_dir = Path(settings.EXPERT_LINKS_DIR)
    elif settings.APP_ENV == "production":
        upload_dir = Path("/app/data/expert-links")
    else:
        upload_dir = Path(__file__).parent.parent.parent.parent.parent / "expert-links"

    upload_dir.mkdir(parents=True, exist_ok=True)
    # Sanitize filename to prevent path traversal
    safe_filename = os.path.basename(file.filename).replace('..', '').lstrip('.')
    if not safe_filename or not safe_filename.endswith('.md'):
        raise HTTPException(status_code=400, detail="Invalid filename")
    dest = upload_dir / safe_filename
    dest.write_bytes(content)
    logger.info(f"Expert links file uploaded: {dest} ({len(content)} bytes)")

    ingestion_result = None
    if auto_ingest:
        import asyncio
        asyncio.create_task(_run_expert_links_ingestion(str(dest)))
        ingestion_result = {"status": "triggered", "message": "Ingestion running in background. Check /ingestion/status for progress."}

    return {
        "uploaded": file.filename,
        "size_bytes": len(content),
        "saved_to": str(dest),
        "ingestion": ingestion_result,
    }


async def _run_expert_links_ingestion(filepath: str):
    """Run expert links ingestion in background so the upload endpoint returns immediately."""
    try:
        result = await smart_ingest_expert_links(filepath)
        logger.info(f"Background expert links ingestion completed: {result}")
    except Exception as e:
        logger.error(f"Background expert links ingestion failed: {e}")
