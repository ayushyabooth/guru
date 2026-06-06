"""
Reader Mode routes for deep article view with annotations.

Three reader modes supported:
- /overlay: WebView + overlay reader (returns only metadata, annotations, rich content — no article text)
- /by-url: URL-to-article lookup for Chrome extension activation
- /deep: Legacy reconstructed reader (deprecated — will be removed)
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import uuid
import logging

from app.db.database import get_db
from app.models.article import Article, ArticleAnnotation, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.services.annotation_service import get_annotation_service
from app.services.ingestion_service import clean_article_text, extract_structured_content
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)


def _get_default_industry() -> str:
    """Get default industry name from central config."""
    try:
        config = IndustriesConfig.get_instance()
        _, name = config.get_default_industry()
        return name
    except Exception:
        return "Consumer"


router = APIRouter(prefix="/api/v1/reader", tags=["reader"])


class AnnotationResponse(BaseModel):
    id: str
    type: str
    text: str
    position_after_section: int
    generated_by: str


class InlineImageResponse(BaseModel):
    url: str
    alt: Optional[str] = None
    caption: Optional[str] = None
    position_after_paragraph: int = 0


# --- Rich content response for overlay mode ---

class RichContentResponse(BaseModel):
    summary_whats_in: Optional[str] = None
    summary_why_matters: Optional[str] = None
    summary_between_lines: Optional[str] = None
    spotlight_quotes: Optional[List[str]] = None
    socratic_prompts: Optional[List[str]] = None


class RelatedArticleOverlay(BaseModel):
    id: str
    title: str
    source: str
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    word_count: Optional[int] = None


class OverlayArticleResponse(BaseModel):
    """Response for WebView + overlay reader. No article text — WebView loads the URL directly."""
    id: str
    headline: str
    author: Optional[str] = None
    publish_date: Optional[str] = None
    source: str
    url: str
    thumbnail_url: Optional[str] = None
    word_count: int
    is_paywalled: bool
    expert_flags: int = 0
    annotations: List[AnnotationResponse]
    rich_content: Optional[RichContentResponse] = None
    related_articles: List[RelatedArticleOverlay] = []
    industry: Optional[str] = None
    cluster_theme: Optional[str] = None
    total_sections: int = 0  # For annotation rail positioning (position_after_section / total_sections)


# --- Legacy deep reader response ---

class DeepArticleResponse(BaseModel):
    id: str
    headline: str
    author: Optional[str] = None
    publish_date: Optional[str] = None
    source: str
    url: str
    thumbnail_url: Optional[str] = None
    word_count: int
    is_paywalled: bool
    expert_flags: int = 0
    full_text: str
    clean_text: str
    sections: List[dict]
    annotations: List[AnnotationResponse]
    inline_images: List[InlineImageResponse] = []
    industry: Optional[str] = None
    cluster_theme: Optional[str] = None
    socratic_prompts: Optional[List[str]] = None


def _fetch_article(article_id: str, db: Session) -> Article:
    """Shared helper: fetch article by UUID or 404."""
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID format"
        )
    article = db.query(Article).filter(Article.id == article_uuid).first()
    if not article:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Article not found"
        )
    return article


def _ensure_annotations(article: Article, db: Session) -> List[ArticleAnnotation]:
    """Fetch existing annotations or generate new ones if none exist."""
    article_uuid = article.id
    existing = db.query(ArticleAnnotation).filter(
        ArticleAnnotation.article_id == article_uuid
    ).order_by(ArticleAnnotation.position_after_section).all()

    if existing:
        return existing

    # Generate annotations if article has enough text
    clean_text = clean_article_text(article.raw_text or "")
    if not clean_text or len(clean_text) < 200:
        return []

    annotation_service = get_annotation_service()
    expert_note = db.query(ExpertNote).filter(
        ExpertNote.article_id == article_uuid
    ).first()
    industry = expert_note.expert_industry if expert_note else _get_default_industry()

    try:
        generated = annotation_service.generate_annotations_for_article(
            article_id=str(article_uuid),
            article_text=clean_text,
            article_title=article.title or "Untitled",
            industry=industry,
            max_annotations=3
        )
        for ann_data in generated:
            annotation = ArticleAnnotation(
                id=uuid.UUID(ann_data['id']),
                article_id=article_uuid,
                annotation_type=ann_data['type'],
                annotation_text=ann_data['text'],
                position_after_section=ann_data['position_after_section'],
                generated_by=ann_data['generated_by']
            )
            db.add(annotation)
        db.commit()

        existing = db.query(ArticleAnnotation).filter(
            ArticleAnnotation.article_id == article_uuid
        ).order_by(ArticleAnnotation.position_after_section).all()
        logger.info(f"Generated {len(generated)} annotations for article {article_uuid}")
    except Exception as e:
        logger.error(f"Error generating annotations: {e}")

    return existing


def _format_annotations(annotations: List[ArticleAnnotation]) -> List[AnnotationResponse]:
    return [
        AnnotationResponse(
            id=str(ann.id),
            type=ann.annotation_type,
            text=ann.annotation_text,
            position_after_section=ann.position_after_section,
            generated_by=ann.generated_by
        )
        for ann in annotations
    ]


def _count_expert_flags(article_id, db: Session) -> int:
    return db.query(ExpertNote).filter(
        ExpertNote.article_id == article_id,
        ExpertNote.priority == 'Essential'
    ).count()


# ============================================================
# OVERLAY ENDPOINT (WebView + overlay reader — no article text)
# ============================================================

@router.get("/articles/{article_id}/overlay", response_model=OverlayArticleResponse)
def get_overlay_article(  # sync def → FastAPI runs it in a threadpool; the blocking
    # annotation/Claude call in _ensure_annotations no longer jams the event loop and
    # block concurrent OPTIONS preflights (GUR-180).
    article_id: str,
    db: Session = Depends(get_db)
):
    """
    Get article metadata, annotations, and rich content for the WebView + overlay reader.

    The WebView loads the original article URL directly — this endpoint provides only
    Guru's transformative value-add (annotations, summaries, socratic prompts) with
    NO article text. This is the legally-safe reader mode.
    """
    article = _fetch_article(article_id, db)
    annotations = _ensure_annotations(article, db)

    # Rich content (summaries, quotes, socratic prompts)
    rich_content_row = db.query(ArticleRichContent).filter(
        ArticleRichContent.article_id == article.id
    ).first()

    rich_content = None
    if rich_content_row:
        rich_content = RichContentResponse(
            summary_whats_in=rich_content_row.summary_whats_in,
            summary_why_matters=rich_content_row.summary_why_matters,
            summary_between_lines=rich_content_row.summary_between_lines,
            spotlight_quotes=rich_content_row.spotlight_quotes,
            socratic_prompts=rich_content_row.socratic_prompts,
        )

    # Related articles from same storyboard cluster
    from app.models.storyboard import StoryboardArticle
    related_articles = []
    storyboard_link = db.query(StoryboardArticle).filter(
        StoryboardArticle.article_id == article.id
    ).first()
    if storyboard_link:
        sibling_links = db.query(StoryboardArticle).filter(
            StoryboardArticle.storyboard_id == storyboard_link.storyboard_id,
            StoryboardArticle.article_id != article.id
        ).order_by(StoryboardArticle.rank).limit(5).all()
        if sibling_links:
            sibling_ids = [s.article_id for s in sibling_links]
            siblings = db.query(
                Article.id, Article.title, Article.source, Article.url,
                Article.article_image_url, Article.word_count
            ).filter(Article.id.in_(sibling_ids)).all()
            sibling_map = {s.id: s for s in siblings}
            for link in sibling_links:
                s = sibling_map.get(link.article_id)
                if s:
                    related_articles.append(RelatedArticleOverlay(
                        id=str(s.id),
                        title=s.title or "Untitled",
                        source=s.source or "Unknown",
                        url=s.url,
                        thumbnail_url=s.article_image_url,
                        word_count=s.word_count,
                    ))

    # Compute total_sections for annotation rail positioning
    total_sections = 0
    if article.raw_text:
        sections = extract_structured_content(article.raw_text)
        total_sections = len(sections)

    # Industry from expert note
    expert_note = db.query(ExpertNote).filter(
        ExpertNote.article_id == article.id
    ).first()
    industry = expert_note.expert_industry if expert_note else None

    return OverlayArticleResponse(
        id=str(article.id),
        headline=article.title or "Untitled",
        author=None,
        publish_date=article.publish_date.isoformat() if article.publish_date else None,
        source=article.source or "Unknown",
        url=article.url,
        thumbnail_url=article.article_image_url,
        word_count=article.word_count or 0,
        is_paywalled=article.is_paywalled or False,
        expert_flags=_count_expert_flags(article.id, db),
        annotations=_format_annotations(annotations),
        rich_content=rich_content,
        related_articles=related_articles,
        industry=industry,
        cluster_theme=None,
        total_sections=total_sections,
    )


# ============================================================
# LEGACY DEEP ENDPOINT (reconstructed text reader)
# ============================================================

@router.get("/articles/{article_id}/deep", response_model=DeepArticleResponse)
def get_deep_article(  # sync def → runs in threadpool, won't block the event loop (GUR-180)
    article_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Legacy: Get article with clean structured content and AI-generated inline annotations.
    Deprecated in favor of /overlay for the WebView reader.
    """
    article = _fetch_article(article_id, db)
    annotations = _ensure_annotations(article, db)

    raw_text = article.raw_text or ""
    clean_text = clean_article_text(raw_text)
    sections = extract_structured_content(raw_text)

    # Format inline images
    inline_images_response = []
    if article.inline_images:
        for img in article.inline_images:
            inline_images_response.append(InlineImageResponse(
                url=img.get('url', ''),
                alt=img.get('alt', ''),
                caption=img.get('caption', ''),
                position_after_paragraph=img.get('position_after_paragraph', 0)
            ))

    # Get rich content for socratic prompts
    rich_content = db.query(ArticleRichContent).filter(
        ArticleRichContent.article_id == article.id
    ).first()
    socratic_prompts = rich_content.socratic_prompts if rich_content and rich_content.socratic_prompts else None

    return DeepArticleResponse(
        id=str(article.id),
        headline=article.title or "Untitled",
        author=None,
        publish_date=article.publish_date.isoformat() if article.publish_date else None,
        source=article.source or "Unknown",
        url=article.url,
        thumbnail_url=article.article_image_url,
        word_count=article.word_count or 0,
        is_paywalled=article.is_paywalled or False,
        expert_flags=_count_expert_flags(article.id, db),
        full_text=raw_text,
        clean_text=clean_text,
        sections=sections,
        annotations=_format_annotations(annotations),
        inline_images=inline_images_response,
        industry=None,
        cluster_theme=None,
        socratic_prompts=socratic_prompts
    )


@router.post("/articles/{article_id}/annotations/regenerate")
async def regenerate_annotations(
    article_id: str,
    db: Session = Depends(get_db)
):
    """
    Force regenerate annotations for an article (admin use)
    """
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID format"
        )
    
    # Fetch article
    article = db.query(Article).filter(Article.id == article_uuid).first()
    if not article:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Article not found"
        )
    
    # Delete existing annotations
    db.query(ArticleAnnotation).filter(
        ArticleAnnotation.article_id == article_uuid
    ).delete()
    db.commit()
    
    # Clean text and generate new annotations
    clean_text = clean_article_text(article.raw_text or "")
    
    if not clean_text or len(clean_text) < 200:
        return {"message": "Article too short for annotations", "annotations": []}
    
    annotation_service = get_annotation_service()
    
    # Get industry from expert notes
    expert_note = db.query(ExpertNote).filter(
        ExpertNote.article_id == article_uuid
    ).first()
    industry = expert_note.expert_industry if expert_note else _get_default_industry()

    try:
        generated = annotation_service.generate_annotations_for_article(
            article_id=str(article_uuid),
            article_text=clean_text,
            article_title=article.title or "Untitled",
            industry=industry,
            max_annotations=3
        )
        
        # Save to database
        for ann_data in generated:
            annotation = ArticleAnnotation(
                id=uuid.UUID(ann_data['id']),
                article_id=article_uuid,
                annotation_type=ann_data['type'],
                annotation_text=ann_data['text'],
                position_after_section=ann_data['position_after_section'],
                generated_by=ann_data['generated_by']
            )
            db.add(annotation)
        
        db.commit()
        
        return {
            "message": f"Regenerated {len(generated)} annotations",
            "annotations": generated
        }
        
    except Exception as e:
        logger.error(f"Error regenerating annotations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to regenerate annotations: {str(e)}"
        )


# ============================================================
# URL LOOKUP ENDPOINT (Chrome extension article discovery)
# ============================================================

def _normalize_url(url: str) -> str:
    """Normalize URL for matching: strip fragments, trailing slashes, tracking params."""
    from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
    parsed = urlparse(url)
    # Remove fragment
    parsed = parsed._replace(fragment='')
    # Remove tracking params
    tracking_params = {'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                       'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'}
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=True)
        filtered = {k: v for k, v in params.items() if k.lower() not in tracking_params}
        parsed = parsed._replace(query=urlencode(filtered, doseq=True))
    # Remove trailing slash from path (but keep root /)
    path = parsed.path.rstrip('/') if parsed.path != '/' else parsed.path
    parsed = parsed._replace(path=path)
    return urlunparse(parsed)


@router.get("/articles/by-url")
async def get_article_by_url(
    url: str,
    db: Session = Depends(get_db)
):
    """
    Look up an article by its original URL. Used by the Chrome extension
    to determine if the current page is a Guru-tracked article.
    Returns article_id, headline, and source on match; 404 otherwise.
    """
    normalized = _normalize_url(url)

    # Try exact match first
    article = db.query(Article).filter(Article.url == normalized).first()

    # If no match, try with the original URL (in case DB has un-normalized URLs)
    if not article:
        article = db.query(Article).filter(Article.url == url).first()

    # Try trailing slash variants of normalized URL
    if not article:
        alt_normalized = normalized.rstrip('/') if normalized.endswith('/') else normalized + '/'
        article = db.query(Article).filter(Article.url == alt_normalized).first()

    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    return {
        "article_id": str(article.id),
        "headline": article.title,
        "source": article.source
    }


@router.post("/articles/{article_id}/reingest")
async def reingest_article(
    article_id: str,
    db: Session = Depends(get_db)
):
    """
    Re-ingest and clean article content (for fixing bad ingestion)
    """
    from app.services.ingestion_service import ingest_url
    
    try:
        article_uuid = uuid.UUID(article_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid article ID format"
        )
    
    article = db.query(Article).filter(Article.id == article_uuid).first()
    if not article:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Article not found"
        )
    
    try:
        # Re-ingest from URL
        result = ingest_url(article.url)
        
        if result.get('error'):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Ingestion failed: {result['error']}"
            )
        
        # Update article with cleaned content
        article.raw_text = result.get('raw_text')
        article.word_count = result.get('word_count', 0)
        article.title = result.get('title') or article.title
        article.is_paywalled = result.get('is_paywalled', False)
        
        # Delete old annotations (will be regenerated on next deep fetch)
        db.query(ArticleAnnotation).filter(
            ArticleAnnotation.article_id == article_uuid
        ).delete()
        
        db.commit()
        
        return {
            "message": "Article re-ingested successfully",
            "word_count": article.word_count,
            "title": article.title
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error re-ingesting article {article_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to re-ingest article: {str(e)}"
        )
