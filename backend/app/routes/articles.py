"""
Articles routes for content ingestion and management
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, HttpUrl
from typing import Optional
import uuid
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.article import Article, ExpertNote
from app.services.ingestion_service import ingest_url, validate_url
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/experts", tags=["expert-articles"])


class ExpertArticleRequest(BaseModel):
    url: HttpUrl
    notes: Optional[str] = None
    priority: str = "Normal"  # Normal, High, Essential
    category: str = "General"


class ExpertArticleResponse(BaseModel):
    article_id: str
    status: str
    summary_source: str
    is_paywalled: bool
    word_count: int
    error: Optional[str] = None


@router.post("/articles", response_model=ExpertArticleResponse)
async def create_expert_article(
    article_data: ExpertArticleRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create expert article from URL with manual web form input
    
    This endpoint:
    1. Validates the URL
    2. Checks if article already exists
    3. Ingests content from URL
    4. Creates Article and ExpertNote records
    """
    
    url_str = str(article_data.url)
    
    # Validate URL format
    if not validate_url(url_str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL format"
        )
    
    # Check if article already exists
    existing_article = db.query(Article).filter(Article.url == url_str).first()
    if existing_article:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Article already exists with ID: {existing_article.id}"
        )
    
    # Ingest content from URL
    logger.info(f"Ingesting article from URL: {url_str}")
    ingestion_result = ingest_url(url_str)
    
    if ingestion_result.get('error'):
        return ExpertArticleResponse(
            article_id="",
            status="error",
            summary_source="",
            is_paywalled=False,
            word_count=0,
            error=ingestion_result['error']
        )
    
    try:
        # Create Article record
        article_id = uuid.uuid4()
        new_article = Article(
            id=article_id,
            url=url_str,
            title=ingestion_result.get('title'),
            source=ingestion_result.get('source'),
            publish_date=ingestion_result.get('publish_date'),
            raw_text=ingestion_result.get('raw_text'),
            word_count=ingestion_result.get('word_count', 0),
            is_paywalled=ingestion_result.get('is_paywalled', False),
            inline_images=ingestion_result.get('inline_images', [])  # Include inline images
        )
        
        db.add(new_article)
        db.commit()
        db.refresh(new_article)
        
        # Create ExpertNote record
        # For now, using a placeholder expert_id - in production this would come from authentication
        expert_id = uuid.uuid4()  # This should be the authenticated expert's user ID
        
        expert_note = ExpertNote(
            expert_id=expert_id,
            article_id=article_id,
            notes_text=article_data.notes,
            priority=article_data.priority,
            expert_industry=IndustriesConfig.get_instance().get_defaults()['industry_name'],
            expert_specializations=[IndustriesConfig.get_instance().get_defaults()['specialization_name']]
        )
        
        db.add(expert_note)
        db.commit()

        logger.info(f"Successfully created article {article_id} from URL: {url_str}")
        
        return ExpertArticleResponse(
            article_id=str(article_id),
            status="success",
            summary_source=ingestion_result.get('source', ''),
            is_paywalled=ingestion_result.get('is_paywalled', False),
            word_count=ingestion_result.get('word_count', 0)
        )
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating article from URL {url_str}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create article: {str(e)}"
        )


@router.get("/articles/{article_id}")
async def get_expert_article(article_id: str, db: Session = Depends(get_db)):
    """
    Get expert article by ID with associated expert notes
    """
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
    
    # Get associated expert notes
    expert_notes = db.query(ExpertNote).filter(ExpertNote.article_id == article_uuid).all()
    
    return {
        "article": {
            "id": str(article.id),
            "url": article.url,
            "title": article.title,
            "source": article.source,
            "publish_date": article.publish_date,
            "word_count": article.word_count,
            "is_paywalled": article.is_paywalled,
            "raw_text": article.raw_text,  # Include the actual article content
            "created_at": article.created_at
        },
        "expert_notes": [
            {
                "id": str(note.id),
                "expert_id": str(note.expert_id),
                "notes_text": note.notes_text,
                "priority": note.priority,
                "expert_industry": note.expert_industry,
                "expert_specializations": note.expert_specializations,
                "created_at": note.created_at
            }
            for note in expert_notes
        ]
    }


@router.get("/articles")
async def list_expert_articles(
    skip: int = 0, 
    limit: int = 50, 
    is_paywalled: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    List expert articles with optional filtering
    """
    query = db.query(Article)
    
    if is_paywalled is not None:
        query = query.filter(Article.is_paywalled == is_paywalled)
    
    articles = query.offset(skip).limit(limit).all()
    
    return {
        "articles": [
            {
                "id": str(article.id),
                "url": article.url,
                "title": article.title,
                "source": article.source,
                "word_count": article.word_count,
                "is_paywalled": article.is_paywalled,
                "created_at": article.created_at
            }
            for article in articles
        ],
        "total": query.count(),
        "skip": skip,
        "limit": limit
    }


@router.delete("/articles/{article_id}")
async def delete_expert_article(article_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Delete expert article and associated expert notes
    """
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
        # Delete associated expert notes first (due to foreign key constraints)
        db.query(ExpertNote).filter(ExpertNote.article_id == article_uuid).delete()
        
        # Delete the article
        db.delete(article)
        db.commit()
        
        logger.info(f"Deleted article {article_id}")
        return {"message": "Article deleted successfully"}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting article {article_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete article: {str(e)}"
        )
