"""
Article Reader API routes for enhanced reading experience
Provides related articles and contextual questions using clustering and Socratic logic
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import List, Optional, Dict, Any
import uuid
import logging
import numpy as np

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.services.clustering_service import get_embedding_model
from app.services.rich_summary_service import RichSummaryService
from app.utils.llm_utils import get_claude_client
from app.config import settings
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/reader", tags=["article-reader"])


class RelatedArticleResponse(BaseModel):
    id: str
    title: str
    source: str
    url: Optional[str]
    publish_date: Optional[str]
    word_count: int
    context: str
    similarity_score: float
    teaser: Optional[str]


class SocraticQuestionResponse(BaseModel):
    question: str
    context: str
    position: str  # "intro", "middle", "conclusion"


@router.get("/articles/{article_id}/related")
async def get_related_articles(
    article_id: str,
    limit: int = Query(5, ge=1, le=10),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get semantically related articles using clustering logic (same as storyboards)
    
    Uses embedding similarity to find articles that are thematically related,
    filtered by user's industry/specialization context.
    """
    try:
        # Get the source article
        source_article = db.query(Article).filter(Article.id == article_id).first()
        if not source_article:
            raise HTTPException(status_code=404, detail="Article not found")
        
        # Get user profile for context filtering
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
        if not user_profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        
        # Get source article's expert note for context
        source_expert_note = db.query(ExpertNote).filter(
            ExpertNote.article_id == article_id
        ).first()
        
        if not source_expert_note:
            logger.warning(f"No expert note found for article {article_id}")
            return {"related_articles": []}
        
        # Get embedding model
        embedding_model = get_embedding_model()
        
        # Generate embedding for source article
        source_text = f"{source_article.title} {source_expert_note.notes_text or ''}"
        source_embedding = embedding_model.encode([source_text])[0]
        
        # Get candidate articles from user's context
        # Use broader filtering - just get articles from same industry
        # We'll use semantic similarity to find the most related ones
        candidate_articles = db.query(Article).join(ExpertNote).filter(
            Article.id != article_id,  # Exclude source article
            ExpertNote.expert_industry == user_profile.core_industry
        ).limit(100).all()  # Get top 100 candidates for similarity comparison
        
        # If no articles in same industry, get any articles
        if not candidate_articles:
            candidate_articles = db.query(Article).join(ExpertNote).filter(
                Article.id != article_id
            ).limit(100).all()
        
        if not candidate_articles:
            return {"related_articles": []}
        
        # Calculate similarity scores
        related_with_scores = []
        for candidate in candidate_articles:
            candidate_note = db.query(ExpertNote).filter(
                ExpertNote.article_id == candidate.id
            ).first()
            
            if not candidate_note:
                continue
            
            # Generate embedding for candidate
            candidate_text = f"{candidate.title} {candidate_note.notes_text or ''}"
            candidate_embedding = embedding_model.encode([candidate_text])[0]
            
            # Calculate cosine similarity
            similarity = np.dot(source_embedding, candidate_embedding) / (
                np.linalg.norm(source_embedding) * np.linalg.norm(candidate_embedding)
            )
            
            # Only include if similarity is above threshold (0.3 - lower threshold for more results)
            if similarity > 0.3:
                # Get rich content for teaser
                rich_content = db.query(ArticleRichContent).filter(
                    ArticleRichContent.article_id == candidate.id
                ).first()
                
                related_with_scores.append({
                    "article": candidate,
                    "expert_note": candidate_note,
                    "rich_content": rich_content,
                    "similarity": float(similarity)
                })
        
        # Sort by similarity and take top N
        related_with_scores.sort(key=lambda x: x["similarity"], reverse=True)
        top_related = related_with_scores[:limit]
        
        # Format response
        related_articles = []
        for item in top_related:
            article = item["article"]
            expert_note = item["expert_note"]
            rich_content = item["rich_content"]
            
            related_articles.append({
                "id": str(article.id),
                "title": article.title,
                "source": article.source,
                "url": article.url,
                "publish_date": article.publish_date.isoformat() if article.publish_date else None,
                "word_count": article.word_count or 0,
                "context": expert_note.expert_industry or "General",
                "similarity_score": item["similarity"],
                "teaser": rich_content.summary_whats_in if rich_content else expert_note.summary,
                "thumbnail_url": article.article_image_url,
            })
        
        return {
            "related_articles": related_articles,
            "total": len(related_articles)
        }
        
    except Exception as e:
        logger.error(f"Error fetching related articles: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch related articles: {str(e)}"
        )


@router.get("/articles/{article_id}/questions")
async def get_contextual_questions(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate contextual Socratic questions for the article
    
    Uses same logic as storyboard Socratic prompts, personalized to user's
    industry and specialization context.
    """
    try:
        # Get the article
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        
        # Check if rich content already has Socratic prompts
        rich_content = db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id == article_id
        ).first()
        
        if rich_content and rich_content.socratic_prompts:
            # Return existing prompts with positioning
            questions = []
            positions = ["intro", "middle", "conclusion"]
            for idx, prompt in enumerate(rich_content.socratic_prompts[:3]):
                questions.append({
                    "question": prompt,
                    "context": rich_content.industry_context or "General",
                    "position": positions[idx] if idx < len(positions) else "middle"
                })
            
            return {"questions": questions}
        
        # Generate new Socratic questions if not available
        # Get user profile for personalization
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
        
        # Get expert note for context
        expert_note = db.query(ExpertNote).filter(
            ExpertNote.article_id == article_id
        ).first()
        
        if not expert_note:
            logger.warning(f"No expert note found for article {article_id}")
            return {"questions": []}
        
        # Use RichSummaryService to generate questions
        rich_service = RichSummaryService(db)
        
        # Generate rich content if not exists
        if not rich_content:
            industry = expert_note.expert_industry or (user_profile.core_industry if user_profile else "General")
            specialization = (expert_note.expert_specializations[0] 
                            if expert_note.expert_specializations 
                            else (user_profile.specializations[0] if user_profile and user_profile.specializations else None))
            
            rich_content = rich_service.generate_rich_content(
                article_id=article_id,
                industry=industry,
                specialization=specialization
            )
        
        # Extract Socratic prompts
        questions = []
        if rich_content and rich_content.socratic_prompts:
            positions = ["intro", "middle", "conclusion"]
            for idx, prompt in enumerate(rich_content.socratic_prompts[:3]):
                questions.append({
                    "question": prompt,
                    "context": rich_content.industry_context or "General",
                    "position": positions[idx] if idx < len(positions) else "middle"
                })
        
        return {"questions": questions}
        
    except Exception as e:
        logger.error(f"Error generating contextual questions: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate questions: {str(e)}"
        )
