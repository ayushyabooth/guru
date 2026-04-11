"""
Storyboard routes for filter-driven semantic clustering and catchup feed
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional, List
import uuid
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.article import Article
from app.models.interaction import UserSavedArticle, UserNotRelevant
from app.models.article_rich_content import ArticleRichContent
from app.services.clustering_service import get_or_build_storyboards_for_filter, parse_filter_context
from app.services.summary_service import generate_personal_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["storyboards"])


MAX_RELATED_ARTICLES = 5  # Cap related articles per storyboard to control payload size


@router.get("/catchup-feed")
async def get_catchup_feed(
    filter: str = Query("core", description="Filter context: core, industry:X, specialization:X, interest:X"),
    limit: int = Query(5, ge=1, le=20, description="Number of storyboards to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get catchup feed with filter-driven semantic clustering.
    Optimized: all DB lookups batched (6 queries total instead of N+1).
    """
    try:
        logger.info(f"Getting catchup feed for user {current_user.id} with filter '{filter}'")

        # Validate filter context
        filter_data = parse_filter_context(filter)
        if not filter_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid filter format"
            )

        # Get or build storyboards for this filter context
        all_storyboards = get_or_build_storyboards_for_filter(current_user, filter, db)

        # Trigger background pre-warming of other user filters (fire and forget)
        # Uses threading (not asyncio) to avoid blocking the event loop
        import threading
        from app.services.startup_service import warm_user_filters_sync
        threading.Thread(
            target=warm_user_filters_sync,
            args=(str(current_user.id), filter),
            daemon=True
        ).start()

        if not all_storyboards:
            return {
                "storyboards": [],
                "total": 0,
                "filter": filter,
                "limit": limit,
                "offset": offset
            }

        # --- BATCH 1: Get all not-relevant storyboard IDs in one query ---
        all_sb_ids = [sb.id for sb in all_storyboards]
        not_relevant_ids = set(
            row[0] for row in db.query(UserNotRelevant.storyboard_id).filter(
                UserNotRelevant.user_id == current_user.id,
                UserNotRelevant.storyboard_id.in_(all_sb_ids),
                UserNotRelevant.filter_context == filter
            ).all()
        )

        relevant_storyboards = [sb for sb in all_storyboards if sb.id not in not_relevant_ids]

        # Sort by ranking_score (highest quality first)
        relevant_storyboards.sort(
            key=lambda sb: sb.ranking_score or 0.0,
            reverse=True
        )

        # Apply pagination
        total = len(relevant_storyboards)
        paginated_storyboards = relevant_storyboards[offset:offset + limit]

        if not paginated_storyboards:
            return {
                "storyboards": [],
                "total": total,
                "filter": filter,
                "limit": limit,
                "offset": offset
            }

        paginated_sb_ids = [sb.id for sb in paginated_storyboards]
        headline_article_ids = [sb.headline_article_id for sb in paginated_storyboards]

        # --- BATCH 2: Get all headline articles in one query ---
        headline_articles_list = db.query(Article).filter(
            Article.id.in_(headline_article_ids)
        ).all()
        headline_map = {a.id: a for a in headline_articles_list}

        # --- BATCH 3: Get all storyboard-article links in one query ---
        all_sb_articles = db.query(StoryboardArticle).filter(
            StoryboardArticle.storyboard_id.in_(paginated_sb_ids)
        ).order_by(StoryboardArticle.rank).all()

        # Group by storyboard_id and collect all unique article IDs
        sb_articles_map: dict = {}  # storyboard_id -> list of StoryboardArticle
        all_related_article_ids = set()
        for sa in all_sb_articles:
            sb_articles_map.setdefault(sa.storyboard_id, []).append(sa)
            all_related_article_ids.add(sa.article_id)

        # --- BATCH 4: Get all related articles in one query (exclude raw_text for payload) ---
        related_articles_list = db.query(
            Article.id, Article.title, Article.source, Article.url,
            Article.word_count, Article.is_paywalled, Article.article_image_url,
            Article.created_at
        ).filter(
            Article.id.in_(all_related_article_ids)
        ).all() if all_related_article_ids else []
        related_article_map = {a.id: a for a in related_articles_list}

        # Collect all article IDs we need rich content for (headline + top-N narrative per storyboard)
        rich_content_article_ids = set(headline_article_ids)
        for sb in paginated_storyboards:
            sa_list = sb_articles_map.get(sb.id, [])
            count = 0
            for sa in sa_list:
                if sa.article_id != sb.headline_article_id and count < MAX_RELATED_ARTICLES:
                    rich_content_article_ids.add(sa.article_id)
                    count += 1

        # --- BATCH 5: Get all rich content in one query ---
        rich_content_list = db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id.in_(rich_content_article_ids)
        ).all() if rich_content_article_ids else []
        rich_content_map = {rc.article_id: rc for rc in rich_content_list}

        # --- BATCH 6: Get all saved article IDs for this user in one query ---
        saved_article_ids = set(
            row[0] for row in db.query(UserSavedArticle.article_id).filter(
                UserSavedArticle.user_id == current_user.id,
                UserSavedArticle.article_id.in_(headline_article_ids)
            ).all()
        )

        # --- Build response from pre-fetched data (no more DB queries) ---
        storyboard_responses = []

        for storyboard in paginated_storyboards:
            headline_article = headline_map.get(storyboard.headline_article_id)
            if not headline_article:
                logger.warning(f"Headline article not found for storyboard {storyboard.id}")
                continue

            # Build related articles list (capped at MAX_RELATED_ARTICLES)
            sa_list = sb_articles_map.get(storyboard.id, [])
            related_articles = []
            for sa in sa_list:
                if sa.article_id == headline_article.id:
                    continue
                art = related_article_map.get(sa.article_id)
                if not art:
                    continue
                related_articles.append({
                    "id": str(art.id),
                    "title": art.title,
                    "source": art.source,
                    "url": art.url,
                    "word_count": art.word_count,
                    "is_paywalled": art.is_paywalled,
                    "created_at": art.created_at.isoformat() if art.created_at else None,
                    "rank": sa.rank,
                    "thumbnail_url": art.article_image_url,
                })
                if len(related_articles) >= MAX_RELATED_ARTICLES:
                    break

            article_count = len(sa_list)

            # Build narrative articles with rich content (same as capped related)
            narrative_articles = []
            for article_data in related_articles:
                rc = rich_content_map.get(uuid.UUID(article_data["id"]))
                narrative_rich_summary = None
                narrative_socratic_prompts = []
                if rc:
                    narrative_rich_summary = {
                        "whats_in_article": rc.summary_whats_in,
                        "why_it_matters": rc.summary_why_matters,
                        "between_the_lines": rc.summary_between_lines,
                        "spotlight_quotes": rc.spotlight_quotes or []
                    }
                    narrative_socratic_prompts = rc.socratic_prompts or []

                narrative_articles.append({
                    "id": article_data["id"],
                    "title": article_data["title"],
                    "url": article_data["url"],
                    "word_count": article_data["word_count"],
                    "is_paywalled": article_data["is_paywalled"],
                    "source": article_data["source"],
                    "thumbnail_url": article_data.get("thumbnail_url"),
                    "rich_summary": narrative_rich_summary,
                    "socratic_prompts": narrative_socratic_prompts
                })

            # Headline rich content
            headline_rc = rich_content_map.get(headline_article.id)
            rich_summary = None
            socratic_prompts = []
            if headline_rc:
                rich_summary = {
                    "whats_in_article": headline_rc.summary_whats_in,
                    "why_it_matters": headline_rc.summary_why_matters,
                    "between_the_lines": headline_rc.summary_between_lines,
                    "spotlight_quotes": headline_rc.spotlight_quotes or []
                }
                socratic_prompts = headline_rc.socratic_prompts or []

            storyboard_responses.append({
                "id": str(storyboard.id),
                "filter_context": filter,
                "industry": storyboard.industry,
                "specializations": storyboard.specializations,
                "theme": storyboard.industry,
                "summary": storyboard.summary,
                "personal_prompt": storyboard.personal_prompt or "What insights can you apply from this content?",
                "cluster_narrative": storyboard.cluster_narrative,
                "narrative_articles": narrative_articles,
                "visual_url": headline_article.article_image_url,
                "visual_source": headline_article.image_source,
                "created_at": storyboard.created_at.isoformat() if storyboard.created_at else None,
                "headline_article": {
                    "id": str(headline_article.id),
                    "title": headline_article.title,
                    "source": headline_article.source,
                    "url": headline_article.url,
                    "word_count": headline_article.word_count,
                    "is_paywalled": headline_article.is_paywalled,
                    "is_saved": headline_article.id in saved_article_ids,
                    "created_at": headline_article.created_at.isoformat() if headline_article.created_at else None,
                    "rich_summary": rich_summary,
                    "socratic_prompts": socratic_prompts
                },
                "related_articles": related_articles,
                "article_count": article_count
            })

        logger.info(f"Returning {len(storyboard_responses)} storyboards for filter '{filter}'")

        return {
            "storyboards": storyboard_responses,
            "total": total,
            "filter": filter,
            "limit": limit,
            "offset": offset
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting catchup feed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get catchup feed"
        )


@router.post("/storyboards/{storyboard_id}/not-relevant")
async def mark_storyboard_not_relevant(
    storyboard_id: str,
    filter: str = Query(..., description="Filter context for this not-relevant marking"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Mark a storyboard as not relevant for a specific filter context
    
    This hides the storyboard from the catchup feed for this specific filter only,
    not globally across all filters.
    """
    try:
        # Validate storyboard ID
        try:
            storyboard_uuid = uuid.UUID(storyboard_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid storyboard ID format"
            )
        
        # Check if storyboard exists
        storyboard = db.query(Storyboard).filter(Storyboard.id == storyboard_uuid).first()
        if not storyboard:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Storyboard not found"
            )
        
        # Check if already marked as not relevant for this filter
        existing = db.query(UserNotRelevant).filter(
            UserNotRelevant.user_id == current_user.id,
            UserNotRelevant.storyboard_id == storyboard_uuid,
            UserNotRelevant.filter_context == filter
        ).first()
        
        if existing:
            return {"message": "Storyboard already marked as not relevant for this filter"}
        
        # Create not relevant record
        not_relevant = UserNotRelevant(
            user_id=current_user.id,
            storyboard_id=storyboard_uuid,
            filter_context=filter
        )
        
        db.add(not_relevant)
        db.commit()
        
        logger.info(f"User {current_user.id} marked storyboard {storyboard_id} as not relevant for filter '{filter}'")
        
        return {"message": "Storyboard marked as not relevant for this filter"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking storyboard as not relevant: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to mark storyboard as not relevant"
        )


@router.post("/articles/{article_id}/save")
async def save_article(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Save an article to user's saved articles list
    """
    try:
        # Validate article ID
        try:
            article_uuid = uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Check if article exists
        article = db.query(Article).filter(Article.id == article_uuid).first()
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Article not found"
            )
        
        # Check if already saved
        existing = db.query(UserSavedArticle).filter(
            UserSavedArticle.user_id == current_user.id,
            UserSavedArticle.article_id == article_uuid
        ).first()
        
        if existing:
            return {"message": "Article already saved", "is_saved": True}
        
        # Create saved article record
        saved_article = UserSavedArticle(
            user_id=current_user.id,
            article_id=article_uuid
        )
        
        db.add(saved_article)
        db.commit()
        
        logger.info(f"User {current_user.id} saved article {article_id}")
        
        return {"message": "Article saved successfully", "is_saved": True}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving article: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save article"
        )


@router.delete("/articles/{article_id}/save")
async def unsave_article(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Remove an article from user's saved articles list
    """
    try:
        # Validate article ID
        try:
            article_uuid = uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Find and delete saved article record
        saved_article = db.query(UserSavedArticle).filter(
            UserSavedArticle.user_id == current_user.id,
            UserSavedArticle.article_id == article_uuid
        ).first()
        
        if not saved_article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Article not in saved list"
            )
        
        db.delete(saved_article)
        db.commit()
        
        logger.info(f"User {current_user.id} unsaved article {article_id}")
        
        return {"message": "Article removed from saved list", "is_saved": False}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error unsaving article: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to unsave article"
        )


@router.get("/saved-articles")
async def get_saved_articles(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get user's saved articles with pagination
    """
    try:
        # Get saved articles
        saved_articles_query = db.query(UserSavedArticle).filter(
            UserSavedArticle.user_id == current_user.id
        ).order_by(UserSavedArticle.saved_at.desc())
        
        total = saved_articles_query.count()
        saved_articles = saved_articles_query.offset(offset).limit(limit).all()
        
        # Get article details
        articles = []
        for saved_article in saved_articles:
            article = db.query(Article).filter(Article.id == saved_article.article_id).first()
            if article:
                articles.append({
                    "id": str(article.id),
                    "title": article.title,
                    "source": article.source,
                    "url": article.url,
                    "word_count": article.word_count,
                    "is_paywalled": article.is_paywalled,
                    "created_at": article.created_at.isoformat() if article.created_at else None,
                    "saved_at": saved_article.saved_at.isoformat() if saved_article.saved_at else None
                })
        
        return {
            "articles": articles,
            "total": total,
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Error getting saved articles: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get saved articles"
        )
