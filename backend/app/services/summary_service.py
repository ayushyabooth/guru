"""
Summary service for generating article summaries and personalized prompts using Claude API
"""
import uuid
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
import logging

from app.db.database import get_db
from app.models.article import Article, ExpertNote
from app.models.user import User, UserProfile
from app.models.storyboard import Storyboard
from app.utils.llm_utils import get_claude_client
from app.db.database import SessionLocal

logger = logging.getLogger(__name__)


def generate_article_summary(article_id: uuid.UUID, db: Session = None) -> Dict[str, Any]:
    """
    Generate summary for an article using Claude API
    
    Args:
        article_id: UUID of the article to summarize
        db: Database session (optional, will create if not provided)
    
    Returns:
        Dictionary with summary results:
        {
            'success': bool,
            'summary': str,
            'source': str,  # 'claude' or 'expert_notes'
            'word_count': int,
            'error': str or None
        }
    """
    result = {
        'success': False,
        'summary': '',
        'source': '',
        'word_count': 0,
        'error': None
    }
    
    # Use provided session or create new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Query the article
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            result['error'] = f"Article not found: {article_id}"
            return result
        
        # Check if article is paywalled or has no content
        if article.is_paywalled or not article.raw_text:
            logger.info(f"Article {article_id} is paywalled or has no content, using expert notes")
            
            # Get expert notes as fallback
            expert_notes = db.query(ExpertNote).filter(
                ExpertNote.article_id == article_id
            ).all()
            
            if expert_notes:
                # Combine expert notes
                notes_text = ". ".join([
                    note.notes_text for note in expert_notes 
                    if note.notes_text
                ])
                
                if notes_text:
                    result['success'] = True
                    result['summary'] = notes_text
                    result['source'] = 'expert_notes'
                    result['word_count'] = len(notes_text.split())
                else:
                    result['error'] = "No expert notes available for paywalled article"
            else:
                result['error'] = "No content or expert notes available"
            
            return result
        
        # Generate summary using Claude
        try:
            claude_client = get_claude_client()
            summary = claude_client.generate_summary(article.raw_text, max_words=50)
            
            if summary:
                result['success'] = True
                result['summary'] = summary
                result['source'] = 'claude'
                result['word_count'] = len(summary.split())
                
                logger.info(f"Generated Claude summary for article {article_id}")
            else:
                result['error'] = "Claude returned empty summary"
                
        except Exception as e:
            logger.error(f"Error generating Claude summary for article {article_id}: {e}")
            result['error'] = f"Claude API error: {str(e)}"
            
            # Fallback to expert notes if Claude fails
            expert_notes = db.query(ExpertNote).filter(
                ExpertNote.article_id == article_id
            ).all()
            
            if expert_notes:
                notes_text = ". ".join([
                    note.notes_text for note in expert_notes 
                    if note.notes_text
                ])
                
                if notes_text:
                    result['success'] = True
                    result['summary'] = notes_text
                    result['source'] = 'expert_notes_fallback'
                    result['word_count'] = len(notes_text.split())
                    result['error'] = None
    
    finally:
        if close_db:
            db.close()
    
    return result


def generate_personal_prompt(storyboard_id: uuid.UUID, user_id: uuid.UUID, db: Session = None) -> Dict[str, Any]:
    """
    Generate personalized prompt for a storyboard based on user profile
    
    Args:
        storyboard_id: UUID of the storyboard
        user_id: UUID of the user
        db: Database session (optional)
    
    Returns:
        Dictionary with prompt results:
        {
            'success': bool,
            'prompt': str,
            'error': str or None
        }
    """
    result = {
        'success': False,
        'prompt': '',
        'error': None
    }
    
    # Use provided session or create new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Get user profile
        user_profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if not user_profile:
            result['error'] = f"User profile not found: {user_id}"
            return result
        
        # Get storyboard
        storyboard = db.query(Storyboard).filter(Storyboard.id == storyboard_id).first()
        if not storyboard:
            result['error'] = f"Storyboard not found: {storyboard_id}"
            return result
        
        # Build user specification string
        user_spec = f"Industry: {user_profile.core_industry}"
        if user_profile.specializations:
            specializations = ", ".join(user_profile.specializations)
            user_spec += f", Specializations: {specializations}"
        
        # Build context from storyboard
        context = f"Storyboard for {storyboard.industry}"
        if storyboard.specializations:
            context += f" - {', '.join(storyboard.specializations)}"
        if storyboard.summary:
            context += f"\nSummary: {storyboard.summary}"
        
        # Generate personalized prompt using Claude
        try:
            claude_client = get_claude_client()
            personal_prompt = claude_client.generate_personal_prompt(context, user_spec)
            
            if personal_prompt:
                result['success'] = True
                result['prompt'] = personal_prompt
                logger.info(f"Generated personal prompt for user {user_id}, storyboard {storyboard_id}")
            else:
                result['error'] = "Claude returned empty prompt"
                
        except Exception as e:
            logger.error(f"Error generating personal prompt: {e}")
            result['error'] = f"Claude API error: {str(e)}"
            
            # Fallback prompt
            result['success'] = True
            result['prompt'] = f"How does this content relate to your work in {user_profile.core_industry}?"
            result['error'] = None
    
    finally:
        if close_db:
            db.close()
    
    return result


def generate_article_questions(article_id: uuid.UUID, count: int = 3, db: Session = None) -> Dict[str, Any]:
    """
    Generate thought-provoking questions for an article
    
    Args:
        article_id: UUID of the article
        count: Number of questions to generate
        db: Database session (optional)
    
    Returns:
        Dictionary with questions results:
        {
            'success': bool,
            'questions': List[str],
            'error': str or None
        }
    """
    result = {
        'success': False,
        'questions': [],
        'error': None
    }
    
    # Use provided session or create new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Query the article
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            result['error'] = f"Article not found: {article_id}"
            return result
        
        # Use article content or expert notes
        content = article.raw_text
        if not content or article.is_paywalled:
            # Use expert notes as content
            expert_notes = db.query(ExpertNote).filter(
                ExpertNote.article_id == article_id
            ).all()
            
            if expert_notes:
                content = ". ".join([
                    note.notes_text for note in expert_notes 
                    if note.notes_text
                ])
        
        if not content:
            result['error'] = "No content available for question generation"
            return result
        
        # Generate questions using Claude
        try:
            claude_client = get_claude_client()
            questions = claude_client.generate_questions(content, count=count)
            
            if questions:
                result['success'] = True
                result['questions'] = questions
                logger.info(f"Generated {len(questions)} questions for article {article_id}")
            else:
                result['error'] = "Claude returned no questions"
                
        except Exception as e:
            logger.error(f"Error generating questions for article {article_id}: {e}")
            result['error'] = f"Claude API error: {str(e)}"
    
    finally:
        if close_db:
            db.close()
    
    return result


def analyze_article_sentiment(article_id: uuid.UUID, db: Session = None) -> Dict[str, Any]:
    """
    Analyze sentiment of an article
    
    Args:
        article_id: UUID of the article
        db: Database session (optional)
    
    Returns:
        Dictionary with sentiment results:
        {
            'success': bool,
            'sentiment': str,
            'error': str or None
        }
    """
    result = {
        'success': False,
        'sentiment': 'neutral',
        'error': None
    }
    
    # Use provided session or create new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Query the article
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            result['error'] = f"Article not found: {article_id}"
            return result
        
        # Use article content or title
        content = article.raw_text or article.title or ""
        
        if not content:
            result['error'] = "No content available for sentiment analysis"
            return result
        
        # Analyze sentiment using Claude
        try:
            claude_client = get_claude_client()
            sentiment = claude_client.analyze_sentiment(content)
            
            result['success'] = True
            result['sentiment'] = sentiment
            logger.info(f"Analyzed sentiment for article {article_id}: {sentiment}")
                
        except Exception as e:
            logger.error(f"Error analyzing sentiment for article {article_id}: {e}")
            result['error'] = f"Claude API error: {str(e)}"
    
    finally:
        if close_db:
            db.close()
    
    return result


def extract_article_topics(article_id: uuid.UUID, max_topics: int = 5, db: Session = None) -> Dict[str, Any]:
    """
    Extract key topics from an article
    
    Args:
        article_id: UUID of the article
        max_topics: Maximum number of topics to extract
        db: Database session (optional)
    
    Returns:
        Dictionary with topics results:
        {
            'success': bool,
            'topics': List[str],
            'error': str or None
        }
    """
    result = {
        'success': False,
        'topics': [],
        'error': None
    }
    
    # Use provided session or create new one
    if db is None:
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        # Query the article
        article = db.query(Article).filter(Article.id == article_id).first()
        if not article:
            result['error'] = f"Article not found: {article_id}"
            return result
        
        # Use article content
        content = article.raw_text
        if not content or article.is_paywalled:
            # Use title and expert notes
            content = article.title or ""
            expert_notes = db.query(ExpertNote).filter(
                ExpertNote.article_id == article_id
            ).all()
            
            if expert_notes:
                notes_text = ". ".join([
                    note.notes_text for note in expert_notes 
                    if note.notes_text
                ])
                content += f". {notes_text}"
        
        if not content:
            result['error'] = "No content available for topic extraction"
            return result
        
        # Extract topics using Claude
        try:
            claude_client = get_claude_client()
            topics = claude_client.extract_key_topics(content, max_topics=max_topics)
            
            result['success'] = True
            result['topics'] = topics
            logger.info(f"Extracted {len(topics)} topics for article {article_id}")
                
        except Exception as e:
            logger.error(f"Error extracting topics for article {article_id}: {e}")
            result['error'] = f"Claude API error: {str(e)}"
    
    finally:
        if close_db:
            db.close()
    
    return result
