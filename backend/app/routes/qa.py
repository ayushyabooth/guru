"""
Q&A API routes for generating suggested questions and answering custom questions
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services.qa_service import QAService
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["qa"])


# Pydantic models for requests and responses
class AskQuestionRequest(BaseModel):
    """Request model for asking a question"""
    question_text: str


class SuggestedQuestion(BaseModel):
    """Model for a suggested question"""
    text: str
    rank: int


class SuggestedQuestionsResponse(BaseModel):
    """Response model for suggested questions"""
    questions: List[SuggestedQuestion]
    article_id: str


class QAResponse(BaseModel):
    """Response model for Q&A answer"""
    id: str
    answer: str
    created_at: str
    article_id: str
    question: str
    model_used: str


class QAHistoryItem(BaseModel):
    """Model for Q&A history item"""
    id: str
    question: str
    answer: str
    article_id: str
    model_used: str
    created_at: str
    conversation_id: str | None = None
    exchange_type: str = "direct"


class QAHistoryResponse(BaseModel):
    """Response model for Q&A history"""
    exchanges: List[QAHistoryItem]
    total: int
    user_id: str


@router.post("/articles/{article_id}/ask", response_model=QAResponse)
async def ask_question(
    article_id: str,
    request: AskQuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> QAResponse:
    """
    Ask a custom question about an article
    
    Uses Claude Sonnet for accurate, detailed answers based on article content.
    The Q&A exchange is stored in the database for future reference.
    """
    try:
        # Validate article_id format
        try:
            uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Validate question
        if not request.question_text or not request.question_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Question text is required and cannot be empty"
            )
        
        question = request.question_text.strip()
        
        # Generate answer using QA service
        result = QAService.answer_question(
            article_id=article_id,
            question=question,
            user_id=str(current_user.id),
            db=db
        )
        
        # Check for errors
        if "error" in result:
            if result["error"] == "Article not found":
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Article not found"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=result["error"]
                )
        
        logger.info(f"Generated answer for user {current_user.id}, article {article_id}")
        
        return QAResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask_question endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process question"
        )


@router.get("/articles/{article_id}/questions", response_model=SuggestedQuestionsResponse)
async def get_suggested_questions(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> SuggestedQuestionsResponse:
    """
    Get 3 suggested questions about an article
    
    Uses Claude Haiku for fast, cost-effective question generation based on
    article content and industry context.
    """
    try:
        # Validate article_id format
        try:
            uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Generate suggested questions using QA service
        questions = QAService.generate_suggested_questions(article_id=article_id, db=db)
        
        if not questions:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Article not found or no questions could be generated"
            )
        
        # Format response
        suggested_questions = [
            SuggestedQuestion(text=question, rank=i + 1)
            for i, question in enumerate(questions)
        ]
        
        logger.info(f"Generated {len(suggested_questions)} questions for article {article_id}")
        
        return SuggestedQuestionsResponse(
            questions=suggested_questions,
            article_id=article_id
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_suggested_questions endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate suggested questions"
        )


@router.get("/qa/history", response_model=QAHistoryResponse)
async def get_qa_history(
    current_user: User = Depends(get_current_user),
    article_id: Optional[str] = Query(None, description="Filter by specific article ID"),
    limit: int = Query(10, ge=1, le=50, description="Number of exchanges to return"),
    db: Session = Depends(get_db)
) -> QAHistoryResponse:
    """
    Get Q&A history for the current user
    
    Returns a list of previous question-answer exchanges, optionally filtered
    by a specific article. Ordered by most recent first.
    """
    try:
        # Validate article_id if provided
        if article_id:
            try:
                uuid.UUID(article_id)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid article ID format"
                )
        
        # Get Q&A history using service
        exchanges_data = QAService.get_qa_history(
            user_id=str(current_user.id),
            article_id=article_id,
            limit=limit,
            db=db
        )
        
        # Convert to response models
        exchanges = [QAHistoryItem(**exchange) for exchange in exchanges_data]
        
        logger.info(f"Retrieved {len(exchanges)} Q&A exchanges for user {current_user.id}")
        
        return QAHistoryResponse(
            exchanges=exchanges,
            total=len(exchanges),
            user_id=str(current_user.id)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_qa_history endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve Q&A history"
        )


@router.get("/articles/{article_id}/qa", response_model=QAHistoryResponse)
async def get_article_qa_history(
    article_id: str,
    current_user: User = Depends(get_current_user),
    limit: int = Query(10, ge=1, le=50, description="Number of exchanges to return"),
    db: Session = Depends(get_db)
) -> QAHistoryResponse:
    """
    Get Q&A history for a specific article
    
    Returns all question-answer exchanges for the current user about a specific article.
    Useful for showing conversation history when viewing an article.
    """
    try:
        # Validate article_id format
        try:
            uuid.UUID(article_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid article ID format"
            )
        
        # Get Q&A history for this article
        exchanges_data = QAService.get_qa_history(
            user_id=str(current_user.id),
            article_id=article_id,
            limit=limit,
            db=db
        )
        
        # Convert to response models
        exchanges = [QAHistoryItem(**exchange) for exchange in exchanges_data]
        
        logger.info(f"Retrieved {len(exchanges)} Q&A exchanges for user {current_user.id}, article {article_id}")
        
        return QAHistoryResponse(
            exchanges=exchanges,
            total=len(exchanges),
            user_id=str(current_user.id)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_article_qa_history endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve article Q&A history"
        )
