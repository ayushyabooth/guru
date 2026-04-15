"""
Q&A Service for generating suggested questions and answering custom questions using Claude
"""
import json
import logging
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
import uuid

from app.db.database import SessionLocal
from app.models.article import Article, ExpertNote
from app.models.qa_models import QAExchange
from app.utils.llm_utils import get_claude_client
from app.config import settings

logger = logging.getLogger(__name__)


class QAService:
    """Service for handling Q&A operations with Claude integration"""
    
    @staticmethod
    def generate_suggested_questions(article_id: str, db: Optional[Session] = None) -> List[str]:
        """
        Generate 3 suggested questions about an article using Claude Haiku (fast/cheap)
        
        Args:
            article_id: UUID of the article
            db: Database session (optional)
            
        Returns:
            List of suggested question strings
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            # Validate article_id format
            try:
                article_uuid = uuid.UUID(article_id)
            except ValueError:
                logger.error(f"Invalid article ID format: {article_id}")
                return []
            
            # Get article with expert notes
            article = db.query(Article).filter(Article.id == article_uuid).first()
            if not article:
                logger.error(f"Article not found: {article_id}")
                return []
            
            # Get content for question generation
            content = ""
            if article.expert_notes:
                # Use expert notes for context
                notes_content = []
                for note in article.expert_notes:
                    if note.notes_text:
                        notes_content.append(note.notes_text)
                content = " ".join(notes_content)
            
            if not content:
                # Prefer context_summary (dense RAG summary, legally safe)
                from app.models.article_rich_content import ArticleRichContent
                rc = db.query(ArticleRichContent).filter(
                    ArticleRichContent.article_id == article.id
                ).first()
                if rc and rc.context_summary:
                    content = rc.context_summary

            if not content and article.raw_text:
                # Fallback to raw text (truncated for cost efficiency)
                content = article.raw_text[:1000]  # First 1000 chars
            
            if not content:
                content = "No content available"
            
            # Get industry/topic context
            industry = "General"
            if article.expert_notes:
                industry = article.expert_notes[0].expert_industry or "General"
            
            # Use Claude Haiku for fast, cheap question generation
            claude_client = get_claude_client()
            
            prompt = f"""Based on this article about {article.title or "a topic"}:

Topic/Industry: {industry}
Content: {content}

Generate exactly 3 thoughtful questions that a professional reader might ask about this article. 
The questions should be:
- Specific to the content
- Actionable or insightful
- Relevant to someone in the {industry} industry

Format your response as a JSON array of objects with a 'question' field:
[
  {{"question": "First question here?"}},
  {{"question": "Second question here?"}},
  {{"question": "Third question here?"}}
]"""

            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,  # Fast, cheap model for suggestions
                max_tokens=300,
                temperature=0.7,
                messages=[{"role": "user", "content": prompt}]
            )
            
            response_text = response.content[0].text.strip()
            logger.debug(f"Claude response for questions: {response_text}")
            
            try:
                # Parse JSON response
                questions_data = json.loads(response_text)
                questions = [q.get("question", "") for q in questions_data if q.get("question")]
                
                # Ensure we have exactly 3 questions
                if len(questions) >= 3:
                    return questions[:3]
                else:
                    # Pad with fallback questions if needed
                    fallback_questions = [
                        "What is the main point of this article?",
                        f"How does this apply to the {industry} industry?",
                        "What are the key takeaways I should remember?"
                    ]
                    questions.extend(fallback_questions)
                    return questions[:3]
                    
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse Claude JSON response: {e}")
                # Return fallback questions
                return [
                    "What is the main point of this article?",
                    f"How does this relate to {industry}?",
                    "What should I do with this information?"
                ]
                
        except Exception as e:
            logger.error(f"Error generating suggested questions for article {article_id}: {e}")
            return [
                "What is the main point of this article?",
                "How does this apply to my industry?",
                "What are the key insights?"
            ]
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def answer_question(article_id: str, question: str, user_id: str, db: Optional[Session] = None) -> Dict:
        """
        Answer a custom question about an article using Claude Sonnet (accurate)
        
        Args:
            article_id: UUID of the article
            question: User's question
            user_id: UUID of the user asking
            db: Database session (optional)
            
        Returns:
            Dictionary with answer details or error
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            # Validate UUIDs
            try:
                article_uuid = uuid.UUID(article_id)
                user_uuid = uuid.UUID(user_id)
            except ValueError:
                return {"error": "Invalid ID format"}
            
            # Get article with expert notes
            article = db.query(Article).filter(Article.id == article_uuid).first()
            if not article:
                return {"error": "Article not found"}
            
            # Get article content for context
            context = ""
            if article.is_paywalled:
                # Use expert notes for paywalled content
                if article.expert_notes:
                    notes_content = []
                    for note in article.expert_notes:
                        if note.notes_text:
                            notes_content.append(note.notes_text)
                    context = "\n\n".join(notes_content)
                else:
                    context = "Limited content available due to paywall restrictions."
            else:
                # Prefer context_summary; lazy-generate on first access, then cache.
                from app.models.article_rich_content import ArticleRichContent
                from app.services.rich_summary_service import RichSummaryService
                rc = db.query(ArticleRichContent).filter(
                    ArticleRichContent.article_id == article.id
                ).first()
                context = rc.context_summary if rc and rc.context_summary else None
                if not context:
                    try:
                        context = RichSummaryService(db).ensure_context_summary(article)
                    except Exception as e:
                        logger.warning(f"ensure_context_summary failed: {e}")
                if not context:
                    context = article.raw_text or "No content available."
            
            # Get metadata
            author = "Unknown"
            industry = "General"
            if article.expert_notes:
                industry = article.expert_notes[0].expert_industry or "General"
            
            # Use Claude Haiku — sufficient for clarifying questions on pre-summarized
            # context, and ~5x cheaper than Sonnet. Article context is cache-controlled
            # so repeated questions on the same article hit the 90%-discounted prefix.
            claude_client = get_claude_client()
            model_used = settings.CLAUDE_HAIKU_MODEL

            system_instructions = """You are an expert analyst helping a professional understand an article. Answer clearly and accurately based on the article content supplied in the system prompt.

Your response should:
1. Directly answer the user's question
2. Cite specific details from the article when relevant
3. Briefly note implications for a professional reader
4. Acknowledge gaps if the article doesn't cover the question

Be concise and well-structured. Plain prose, no headers unless the answer genuinely needs them."""

            article_block = f"""ARTICLE DETAILS:
Title: {article.title or "Untitled"}
Source: {article.source or "Unknown"}
URL: {article.url}
Industry: {industry}

ARTICLE CONTENT:
{context}"""

            response = claude_client.client.messages.create(
                model=model_used,
                max_tokens=800,
                temperature=0.3,
                system=[
                    {"type": "text", "text": system_instructions},
                    {"type": "text", "text": article_block, "cache_control": {"type": "ephemeral"}},
                ],
                messages=[{"role": "user", "content": question}]
            )

            answer_text = response.content[0].text.strip()
            
            # Store the Q&A exchange in database
            qa_exchange = QAExchange(
                user_id=user_uuid,
                article_id=article_uuid,
                question=question,
                answer=answer_text,
                model_used=model_used,
                exchange_type='direct',
            )
            
            db.add(qa_exchange)
            db.commit()
            db.refresh(qa_exchange)
            
            logger.info(f"Generated Q&A for user {user_id}, article {article_id}")
            
            return {
                "id": str(qa_exchange.id),
                "answer": answer_text,
                "created_at": qa_exchange.created_at.isoformat(),
                "article_id": str(article_id),
                "question": question,
                "model_used": model_used,
            }
            
        except Exception as e:
            logger.error(f"Error answering question for article {article_id}: {e}")
            if db:
                db.rollback()
            return {"error": "Failed to generate answer"}
            
        finally:
            if close_db:
                db.close()

    @staticmethod
    def get_qa_history(user_id: str, article_id: Optional[str] = None, limit: int = 10, db: Optional[Session] = None) -> List[Dict]:
        """
        Get Q&A history for a user, optionally filtered by article
        
        Args:
            user_id: UUID of the user
            article_id: Optional UUID of specific article
            limit: Maximum number of records to return
            db: Database session (optional)
            
        Returns:
            List of Q&A exchange dictionaries
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
        
        try:
            # Validate user_id
            try:
                user_uuid = uuid.UUID(user_id)
            except ValueError:
                return []
            
            # Build query
            query = db.query(QAExchange).filter(QAExchange.user_id == user_uuid)
            
            if article_id:
                try:
                    article_uuid = uuid.UUID(article_id)
                except ValueError:
                    return []
                query = query.filter(QAExchange.article_id == article_uuid)
            
            exchanges = query.order_by(QAExchange.created_at.desc()).limit(limit).all()
            
            return [
                {
                    "id": str(exchange.id),
                    "question": exchange.question,
                    "answer": exchange.answer,
                    "article_id": str(exchange.article_id),
                    "model_used": exchange.model_used,
                    "created_at": exchange.created_at.isoformat(),
                    "conversation_id": str(exchange.conversation_id) if exchange.conversation_id else None,
                    "exchange_type": exchange.exchange_type or "direct",
                }
                for exchange in exchanges
            ]
        
        except Exception as e:
            logger.error(f"Error retrieving Q&A history for user {user_id}: {e}")
            return []
        
        finally:
            if close_db:
                db.close()
