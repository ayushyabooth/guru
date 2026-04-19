"""
Custom Q&A API routes for context-aware article questions
Uses Claude API to generate answers based on article content
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.utils.llm_utils import get_claude_client
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/qa", tags=["custom-qa"])


class CustomQARequest(BaseModel):
    article_id: str
    question: str


class CustomQAResponse(BaseModel):
    answer: str
    citations: List[str]


@router.post("/ask", response_model=CustomQAResponse)
async def ask_custom_question(
    request: CustomQARequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Answer a custom question about an article using Claude API
    
    Provides context-aware answers based on:
    - Article content
    - Expert notes
    - User's industry/specialization context
    """
    try:
        # Get the article
        article = db.query(Article).filter(Article.id == request.article_id).first()
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        
        # Get expert note for additional context
        expert_note = db.query(ExpertNote).filter(
            ExpertNote.article_id == request.article_id
        ).first()
        
        # Get user profile for personalization
        user_profile = db.query(UserProfile).filter(
            UserProfile.user_id == current_user.id
        ).first()
        
        # Build context from article
        article_context = f"""
Article Title: {article.title}
Source: {article.source}
"""
        
        # Use article content if available, otherwise use expert notes
        if article.raw_text and len(article.raw_text.strip()) > 100:
            article_context += f"Content: {article.raw_text[:5000]}"
        elif expert_note and expert_note.notes_text:
            article_context += f"Expert Analysis: {expert_note.notes_text}"
        else:
            article_context += "Content: Limited content available"
        
        # Build user context
        user_context = ""
        if user_profile:
            user_context = f"\nUser's Industry: {user_profile.core_industry}\nUser's Specializations: {', '.join(user_profile.specializations)}"
        
        # Build prompt for Claude
        system_prompt = f"""You are an expert analyst helping a professional understand an article.

Your task:
1. Answer the user's question based ONLY on the article content provided
2. Be concise and specific - cite exact information from the article
3. If the article doesn't contain information to answer the question, say so clearly
4. Relate your answer to the user's professional context when relevant
5. Keep your answer to 2-3 sentences maximum

Article Context:
{article_context}
{user_context}

Remember: Only use information from the article. Be direct and concise."""

        # Get response from Claude
        claude_client = get_claude_client()
        
        response = claude_client.client.messages.create(
            model=settings.CLAUDE_HAIKU_MODEL,
            max_tokens=300,  # Keep answers concise
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": request.question
            }]
        )
        
        answer = response.content[0].text
        
        # Build citations
        citations = [article.title]
        if article.source:
            citations.append(article.source)
        
        return {
            "answer": answer,
            "citations": citations
        }
        
    except Exception as e:
        logger.error(f"Error in custom Q&A: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate answer: {str(e)}"
        )
