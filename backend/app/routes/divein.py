"""
Dive-in feed API routes for saved and essential articles
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc, cast, Text
from typing import List, Optional
import uuid
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.interaction import UserSavedArticle
from app.models.article_rich_content import ArticleRichContent
from app.services.industries_config import IndustriesConfig
from pydantic import BaseModel
from datetime import datetime, timedelta
from app.config import settings

logger = logging.getLogger(__name__)

# Get default industry from config for fallback
def _get_default_industry_name():
    try:
        config = IndustriesConfig.get_instance()
        _, name = config.get_default_industry()
        return name
    except Exception:
        return "Consumer"

router = APIRouter(prefix="/api/v1", tags=["divein"])


# Pydantic models for responses
class RichSummaryResponse(BaseModel):
    """Rich summary content for liquid glass cards"""
    whats_in_article: Optional[str] = None
    why_it_matters: Optional[str] = None
    between_the_lines: Optional[str] = None
    spotlight_quotes: Optional[List[str]] = None
    socratic_prompts: Optional[List[str]] = None


class ArticleSummary(BaseModel):
    """Article summary for feed display"""
    id: str
    title: str
    source: str
    reading_time: Optional[int] = None
    is_saved: bool
    is_essential: bool
    image_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    summary: Optional[str] = None
    expert_takeaway: Optional[str] = None
    rich_summary: Optional[RichSummaryResponse] = None
    created_at: str
    publish_date: Optional[str] = None
    url: str
    word_count: Optional[int] = None
    context: Optional[str] = None
    industry: Optional[str] = None
    priority: str = "normal"


class DiveinFeedResponse(BaseModel):
    """Response model for dive-in feed with three-section architecture"""
    saved_articles: List[ArticleSummary]      # Section 1: user's saved articles (cross-filter)
    essential_articles: List[ArticleSummary]   # Section 2: expert picks (filter-specific)
    discovery_articles: List[ArticleSummary]   # Section 3: more to explore (filter-specific)
    total_saved: int
    total_essential: int
    total_discovery: int
    limit: int
    offset: int


class ArticleDeepRead(BaseModel):
    """Full article content for deep reading"""
    id: str
    title: str
    source: str
    url: str
    author: Optional[str] = None
    published_at: Optional[str] = None
    reading_time: Optional[int] = None
    summary: Optional[str] = None
    content: str
    is_paywalled: bool
    paywall_link: Optional[str] = None
    industry: Optional[str] = None
    priority: Optional[str] = None
    image_url: Optional[str] = None
    is_saved: bool


@router.get("/divein-feed", response_model=DiveinFeedResponse)
async def get_divein_feed(
    current_user: User = Depends(get_current_user),
    limit: int = Query(10, ge=1, le=50, description="Number of discovery articles to return"),
    offset: int = Query(0, ge=0, description="Pagination offset for discovery pool"),
    filter: str = Query("core", description="Filter context: 'core', 'specialization:X', or 'interest:Y'"),
    db: Session = Depends(get_db)
) -> DiveinFeedResponse:
    """
    Get Dive-in feed with two-pool architecture.

    Pool 1 (essential_articles): Saved + Essential articles - always returned in full.
    Pool 2 (discovery_articles): All other articles matching filter - paginated.

    Both pools are sorted by composite score (quality + freshness + relevance + tier).
    """
    try:
        # Get user profile for filter context
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
        if not user_profile:
            raise HTTPException(status_code=404, detail="User profile not found")

        # Parse filter context
        from app.services.clustering_service import parse_filter_context
        from app.services.industries_config import NameNormalizer

        filter_data = parse_filter_context(filter)
        filter_type = filter_data["type"]
        filter_value = filter_data.get("value")

        # Get user's saved article IDs
        user_saved_ids = {
            row[0] for row in db.query(UserSavedArticle.article_id).filter(
                UserSavedArticle.user_id == current_user.id
            ).all()
        }

        # Get essential article IDs
        essential_ids = {
            row[0] for row in db.query(ExpertNote.article_id).filter(
                ExpertNote.priority == 'Essential'
            ).all()
        }

        # Age cutoff — exclude articles older than ARTICLE_TIME_WINDOW_DAYS
        cutoff_date = datetime.utcnow() - timedelta(days=settings.ARTICLE_TIME_WINDOW_DAYS)

        # Build filter conditions for specialization/industry matching
        filter_conditions = _build_filter_conditions(
            filter_type, filter_value, user_profile
        )

        # ── Section 1: Saved articles (CROSS-FILTER — always shown) ───
        saved_articles = []
        if user_saved_ids:
            saved_articles = db.query(Article).filter(
                Article.id.in_(user_saved_ids),
                Article.created_at >= cutoff_date,
                Article.title.isnot(None),
                Article.title != 'Untitled',
            ).order_by(desc(Article.created_at)).all()

        # ── Section 2: Expert Picks (filter-specific, exclude saved) ──
        essential_only_ids = essential_ids - user_saved_ids
        expert_articles = []
        if essential_only_ids:
            expert_query = db.query(Article).join(ExpertNote).filter(
                Article.id.in_(essential_only_ids),
                Article.created_at >= cutoff_date,
                Article.title.isnot(None),
                Article.title != 'Untitled',
            )
            if filter_conditions:
                expert_query = expert_query.filter(or_(*filter_conditions))
            expert_articles = expert_query.order_by(
                desc(Article.quality_score),
                desc(Article.created_at)
            ).all()

        # ── Section 3: More to Explore (filter-specific, exclude saved+essential) ──
        excluded_ids = user_saved_ids | essential_ids
        pool3_query = db.query(Article).join(ExpertNote).filter(
            ~Article.id.in_(excluded_ids) if excluded_ids else True,
            Article.created_at >= cutoff_date,
            Article.title.isnot(None),
            Article.title != 'Untitled',
        )
        if filter_conditions:
            pool3_query = pool3_query.filter(or_(*filter_conditions))

        total_discovery = pool3_query.count()

        discovery_articles = pool3_query.order_by(
            desc(Article.quality_score),
            desc(Article.created_at)
        ).limit(limit).offset(offset).all()

        # ── Fallback: if ALL sections empty, show recent articles ─────
        if not saved_articles and not expert_articles and not discovery_articles:
            logger.info(
                f"No articles match filter '{filter}' for user {current_user.id}, "
                f"falling back to recent articles"
            )
            fallback_query = db.query(Article).filter(
                Article.created_at >= cutoff_date,
            ).order_by(desc(Article.created_at)).limit(limit)
            discovery_articles = fallback_query.all()
            total_discovery = len(discovery_articles)

        # ── Batch-fetch rich content for all articles ─────────────────
        all_feed_article_ids = (
            [a.id for a in saved_articles]
            + [a.id for a in expert_articles]
            + [a.id for a in discovery_articles]
        )
        rich_content_map = {}
        if all_feed_article_ids:
            rich_content_list = db.query(ArticleRichContent).filter(
                ArticleRichContent.article_id.in_(all_feed_article_ids)
            ).all()
            rich_content_map = {rc.article_id: rc for rc in rich_content_list}

        # ── Build response summaries ─────────────────────────────────
        saved_summaries = [
            _build_article_summary(a, user_saved_ids, essential_ids, rich_content_map)
            for a in saved_articles
        ]
        essential_summaries = [
            _build_article_summary(a, user_saved_ids, essential_ids, rich_content_map)
            for a in expert_articles
        ]
        discovery_summaries = [
            _build_article_summary(a, user_saved_ids, essential_ids, rich_content_map)
            for a in discovery_articles
        ]

        logger.info(
            f"Dive-in feed: {len(saved_summaries)} saved + {len(essential_summaries)} essential "
            f"+ {len(discovery_summaries)} discovery (user: {current_user.id})"
        )

        return DiveinFeedResponse(
            saved_articles=saved_summaries,
            essential_articles=essential_summaries,
            discovery_articles=discovery_summaries,
            total_saved=len(saved_articles),
            total_essential=len(expert_articles),
            total_discovery=total_discovery,
            limit=limit,
            offset=offset
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving dive-in feed for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve dive-in feed"
        )


def _article_freshness(article: Article) -> float:
    """Linear freshness decay over ARTICLE_TIME_WINDOW_DAYS."""
    if not article.created_at:
        return 0.0
    days_old = (datetime.utcnow() - article.created_at.replace(tzinfo=None)).days
    return max(0.0, 1.0 - (days_old / settings.ARTICLE_TIME_WINDOW_DAYS))


def _article_tier_score(article: Article) -> float:
    """Source tier score: Luminary (Tier 2) > Expert (Tier 1) > Discovery (Tier 3)."""
    tier_scores = {'tier2_luminary': 0.9, 'tier1_expert': 0.7, 'tier3_discovery': 0.5}
    return tier_scores.get(article.ingestion_tier, 0.5)


def _build_filter_conditions(filter_type, filter_value, user_profile):
    """Build SQLAlchemy filter conditions for specialization/industry matching.

    IMPORTANT: UserProfile stores DISPLAY names (e.g. "Specialty Finance & Alternative Lenders")
    but ExpertNote.expert_specializations stores IDs (e.g. "specialty_finance_alternative_lenders").
    We must normalize display names to IDs before building LIKE patterns.
    """
    from app.services.industries_config import NameNormalizer

    config = IndustriesConfig.get_instance()
    conditions = []

    if filter_type == "core":
        for spec in user_profile.specializations:
            spec_id = config.normalize_id(spec, 'specialization')
            spec_to_use = spec_id if spec_id else spec
            patterns = NameNormalizer.build_sql_like_patterns(spec_to_use)
            for pattern in patterns:
                conditions.append(cast(ExpertNote.expert_specializations, Text).like(pattern))
            if spec_id and spec_id != spec:
                extra = NameNormalizer.build_sql_like_patterns(spec)
                for pattern in extra:
                    conditions.append(cast(ExpertNote.expert_specializations, Text).like(pattern))

        industry_id = config.normalize_id(user_profile.core_industry, 'industry')
        industry_to_use = industry_id if industry_id else user_profile.core_industry
        industry_patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
        for pattern in industry_patterns:
            conditions.append(ExpertNote.expert_industry.like(pattern))
        if industry_id and industry_id != user_profile.core_industry:
            extra = NameNormalizer.build_sql_like_patterns(user_profile.core_industry)
            for pattern in extra:
                conditions.append(ExpertNote.expert_industry.like(pattern))

    elif filter_type == "specialization":
        spec_id = config.normalize_id(filter_value, 'specialization')
        spec_to_use = spec_id if spec_id else filter_value
        patterns = NameNormalizer.build_sql_like_patterns(spec_to_use)
        for pattern in patterns:
            conditions.append(cast(ExpertNote.expert_specializations, Text).like(pattern))
        if spec_id and spec_id != filter_value:
            extra = NameNormalizer.build_sql_like_patterns(filter_value)
            for pattern in extra:
                conditions.append(cast(ExpertNote.expert_specializations, Text).like(pattern))

    elif filter_type == "interest":
        if filter_value:
            industry_id = config.normalize_id(filter_value, 'industry')
            industry_to_use = industry_id if industry_id else filter_value
            patterns = NameNormalizer.build_sql_like_patterns(industry_to_use)
            for pattern in patterns:
                conditions.append(ExpertNote.expert_industry.like(pattern))
            if industry_id and industry_id != filter_value:
                extra = NameNormalizer.build_sql_like_patterns(filter_value)
                for pattern in extra:
                    conditions.append(ExpertNote.expert_industry.like(pattern))

    return conditions


def _build_article_summary(
    article: Article,
    user_saved_ids: set,
    essential_ids: set,
    rich_content_map: dict
) -> ArticleSummary:
    """Build an ArticleSummary from an Article for the dive-in feed response."""
    reading_time = max(1, round(article.word_count / 200)) if article.word_count else None

    summary = None
    expert_takeaway = None
    context = None
    industry = None
    if article.expert_notes:
        first_note = article.expert_notes[0]
        if first_note.notes_text:
            summary = first_note.notes_text[:200] + "..." if len(first_note.notes_text) > 200 else first_note.notes_text
            expert_takeaway = first_note.notes_text[:150] + "..." if len(first_note.notes_text) > 150 else first_note.notes_text
        if first_note.expert_industry:
            context = first_note.expert_industry
            industry = first_note.expert_industry

    rich_summary = None
    rich_content = rich_content_map.get(article.id)
    if rich_content:
        rich_summary = RichSummaryResponse(
            whats_in_article=rich_content.summary_whats_in,
            why_it_matters=rich_content.summary_why_matters,
            between_the_lines=rich_content.summary_between_lines,
            spotlight_quotes=rich_content.spotlight_quotes if rich_content.spotlight_quotes else None,
            socratic_prompts=rich_content.socratic_prompts if rich_content.socratic_prompts else None,
        )

    thumbnail_url = getattr(article, 'article_image_url', None)

    if article.id in essential_ids:
        priority = "essential"
    elif article.id in user_saved_ids:
        priority = "saved"
    else:
        priority = "normal"

    return ArticleSummary(
        id=str(article.id),
        title=article.title or "Untitled",
        source=article.source or "Unknown Source",
        reading_time=reading_time,
        is_saved=article.id in user_saved_ids,
        is_essential=article.id in essential_ids,
        image_url=thumbnail_url,
        thumbnail_url=thumbnail_url,
        summary=summary,
        expert_takeaway=expert_takeaway,
        rich_summary=rich_summary,
        created_at=article.created_at.isoformat() if article.created_at else datetime.utcnow().isoformat(),
        publish_date=article.publish_date.isoformat() if article.publish_date else None,
        url=article.url,
        word_count=article.word_count,
        context=context or _get_default_industry_name(),
        industry=industry or _get_default_industry_name(),
        priority=priority
    )


@router.get("/articles/{article_id}/deep", response_model=ArticleDeepRead)
async def get_article_deep(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> ArticleDeepRead:
    """
    Get article for deep reading with full content
    
    Returns complete article information including:
    - Full text content (or expert notes for paywalled articles)
    - Metadata and reading information
    - User interaction status (saved/not saved)
    """
    try:
        # Validate article_id format
        try:
            article_uuid = uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Get article with expert notes
        article = db.query(Article).filter(Article.id == article_uuid).first()
        
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Article not found"
            )
        
        # Determine content based on paywall status
        content = ""
        paywall_link = None
        
        if article.is_paywalled:
            # Use expert notes for paywalled content
            if article.expert_notes:
                # Combine all expert notes
                notes_content = []
                for note in article.expert_notes:
                    if note.notes_text:
                        notes_content.append(note.notes_text)
                
                if notes_content:
                    content = "\n\n".join(notes_content)
                else:
                    content = "Full text not available. Please visit the source for complete content."
            else:
                content = "Full text not available. Please visit the source for complete content."
            
            paywall_link = article.url
        else:
            # Prefer context_summary → raw_text fallback
            from app.models.article_rich_content import ArticleRichContent as ARC
            rc = db.query(ARC).filter(ARC.article_id == article_uuid).first()
            if rc and rc.context_summary:
                content = rc.context_summary
            else:
                content = article.raw_text or "Content not available."
        
        # Check if user has saved this article
        is_saved = db.query(UserSavedArticle).filter(
            UserSavedArticle.article_id == article_uuid,
            UserSavedArticle.user_id == current_user.id
        ).first() is not None
        
        # Get priority and industry from expert notes
        priority = None
        industry = None
        if article.expert_notes:
            first_note = article.expert_notes[0]
            priority = first_note.priority
            industry = first_note.expert_industry
        
        # Calculate reading time
        reading_time = None
        if article.word_count:
            reading_time = max(1, round(article.word_count / 200))
        
        # Get summary from expert notes
        summary = None
        if article.expert_notes and article.expert_notes[0].notes_text:
            note_text = article.expert_notes[0].notes_text
            summary = note_text[:300] + "..." if len(note_text) > 300 else note_text
        
        logger.info(f"Retrieved deep read for article {article_id} (user: {current_user.id})")
        
        return ArticleDeepRead(
            id=str(article.id),
            title=article.title or "Untitled",
            source=article.source or "Unknown Source",
            url=article.url,
            author=None,  # TODO: Add author field to Article model if needed
            published_at=article.publish_date.isoformat() if article.publish_date else None,
            reading_time=reading_time,
            summary=summary,
            content=content,
            is_paywalled=article.is_paywalled,
            paywall_link=paywall_link,
            industry=industry,
            priority=priority,
            image_url=None,  # TODO: Add image_url field to Article model if needed
            is_saved=is_saved
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving deep read for article {article_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve article content"
        )
