"""
Socratic Chat API routes for interactive LLM-powered dialogue
Provides context-aware Socratic reasoning based on article and related articles
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.qa_models import QAExchange
from app.utils.llm_utils import get_claude_client
from app.config import settings
import uuid as uuid_mod

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/socratic", tags=["socratic-chat"])


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class SocraticChatRequest(BaseModel):
    article_id: str
    question: str
    conversation_history: List[ChatMessage] = []
    conversation_id: Optional[str] = None  # UUID for threading multi-turn conversations


class SocraticChatResponse(BaseModel):
    response: str
    related_article_citations: List[str] = []
    follow_up_prompts: List[str] = []
    conversation_id: str = ""  # Return conversation_id for threading
    exchange_id: str = ""  # The persisted QAExchange ID


@router.post("/chat", response_model=SocraticChatResponse)
async def socratic_chat(
    request: SocraticChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Engage in Socratic dialogue about an article
    
    The LLM agent:
    - Uses Socratic method to guide thinking
    - Has context of article + related articles
    - Steers user to think more and ask more
    - Cites related articles when relevant
    - Responds live with streaming-like experience
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
        
        # Build context from article — prefer context_summary (legally safe, dense RAG context)
        from app.models.article_rich_content import ArticleRichContent
        rich_content = db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id == request.article_id
        ).first()
        context_text = (
            (rich_content.context_summary if rich_content and rich_content.context_summary else None)
            or (article.raw_text[:3000] if article.raw_text else None)
            or (expert_note.notes_text if expert_note else 'Content not available')
        )
        article_context = f"""
Article Title: {article.title}
Source: {article.source}
Content: {context_text}
"""
        
        if expert_note:
            article_context += f"\nExpert Analysis: {expert_note.notes_text}"
        
        # Get related articles from the same storyboard cluster
        related_articles_context = ""
        if expert_note:
            # Find other articles with same industry/specialization
            related_notes = db.query(ExpertNote).join(Article).filter(
                ExpertNote.expert_industry == expert_note.expert_industry,
                ExpertNote.article_id != request.article_id
            ).limit(3).all()
            
            if related_notes:
                related_articles_context = "\n\nRelated Articles in Cluster:\n"
                for idx, note in enumerate(related_notes, 1):
                    related_article = db.query(Article).filter(
                        Article.id == note.article_id
                    ).first()
                    if related_article:
                        related_articles_context += f"{idx}. {related_article.title} ({related_article.source})\n"
                        # Use notes_text instead of summary field
                        if note.notes_text:
                            related_articles_context += f"   Summary: {note.notes_text[:200]}...\n"
        
        # Build Socratic prompt for Claude
        user_context = ""
        if user_profile:
            user_context = f"User's Industry: {user_profile.core_industry}\nUser's Specializations: {', '.join(user_profile.specializations)}"
        
        system_prompt = f"""You are Guru - a sharp, insightful mentor who makes complex topics click.

Your goal: Keep the reader hooked and learning. Make them WANT to go deeper.

How to respond:
1. Jump straight into the insight - no labels, no headers, no "here's what I think"
2. Be conversational, like a brilliant colleague at coffee who gets excited about ideas
3. Connect the article to their world with specific, actionable angles
4. If it feels natural, end with ONE curious question that pulls them deeper (but don't force it - sometimes the insight speaks for itself)

Voice:
- Confident but not preachy
- Specific beats generic (use numbers, examples, comparisons from the article)
- Short paragraphs - let ideas breathe
- Match their energy - if they ask something technical, go technical

NEVER DO THIS:
- Don't use headers like "Key insight:" or "Question:" - just write naturally
- Don't announce what you're doing ("Let me explain..." "Here's a question...")
- Don't lecture - this is a dialogue, not a TED talk
- Don't ask multiple questions - one max, and only if it genuinely sparks curiosity

Context from article:
{article_context}
{related_articles_context}

{user_context}

Remember: You're helping them think, not telling them what to think. Keep them curious."""

        # Build conversation for Claude
        claude_client = get_claude_client()
        
        # Format conversation history
        messages = []
        for msg in request.conversation_history:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        # Add current user question
        messages.append({
            "role": "user",
            "content": request.question
        })
        
        # Get response from Claude
        response = claude_client.client.messages.create(
            model=settings.CLAUDE_SONNET_MODEL,
            max_tokens=500,  # Keep responses concise
            system=system_prompt,
            messages=messages
        )
        
        assistant_response = response.content[0].text
        
        # Extract any related article citations from response
        related_citations = []
        if "Related Articles" in related_articles_context:
            # Simple heuristic: if response mentions numbers like "1.", "2.", etc.
            # it's likely citing related articles
            for idx in range(1, 4):
                if f"{idx}." in assistant_response or f"article {idx}" in assistant_response.lower():
                    # Extract the article title from context
                    lines = related_articles_context.split('\n')
                    for line in lines:
                        if line.strip().startswith(f"{idx}."):
                            related_citations.append(line.strip())
        
        # Generate dynamic, contextual follow-up prompts using Claude
        follow_up_prompts = []
        try:
            # Build context for follow-up generation
            conversation_summary = "\n".join([
                f"{msg.role}: {msg.content[:200]}" 
                for msg in request.conversation_history[-3:]  # Last 3 messages
            ])
            
            followup_prompt = f"""Based on this Socratic dialogue about the article, generate exactly 3 thought-provoking follow-up questions.

Article: {article.title}
User's Industry: {user_profile.core_industry if user_profile else 'General professional'}
User's Specializations: {', '.join(user_profile.specializations) if user_profile and user_profile.specializations else 'Not specified'}

Recent conversation:
{conversation_summary}
User asked: {request.question}
Guru responded: {assistant_response[:500]}

Generate 3 follow-up questions that:
1. **Deepen understanding** - Push the user to think critically about implications
2. **Connect to their work** - Make it relevant to their industry/role
3. **Challenge assumptions** - Encourage exploring different perspectives

Format: Return ONLY the 3 questions, one per line, no numbering or bullets. Keep each under 60 characters.
Make questions punchy and direct - start with action words like "How might...", "What if...", "Why does..."."""

            followup_response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,  # Use Haiku for speed/cost
                max_tokens=150,
                messages=[{"role": "user", "content": followup_prompt}]
            )
            
            # Parse the response into individual questions
            raw_prompts = followup_response.content[0].text.strip().split('\n')
            follow_up_prompts = [
                q.strip().lstrip('0123456789.-) ') 
                for q in raw_prompts 
                if q.strip() and len(q.strip()) > 10
            ][:3]  # Take max 3
            
        except Exception as e:
            logger.warning(f"Failed to generate dynamic follow-ups: {e}")
            # Fallback to contextual but simpler prompts
            if user_profile and user_profile.core_industry:
                follow_up_prompts = [
                    f"How might this impact {user_profile.core_industry}?",
                    "What assumptions here deserve more scrutiny?",
                    "What would change your view on this?",
                ]
            else:
                follow_up_prompts = [
                    "What implications concern you most?",
                    "How would you test this idea?",
                    "What's the strongest counterargument?",
                ]
        
        # Persist the Q&A turn in QAExchange for future retrieval
        conv_id = request.conversation_id
        if conv_id:
            try:
                conv_uuid = uuid_mod.UUID(conv_id)
            except ValueError:
                conv_uuid = uuid_mod.uuid4()
        else:
            conv_uuid = uuid_mod.uuid4()

        try:
            article_uuid = uuid_mod.UUID(request.article_id)
            qa_exchange = QAExchange(
                user_id=current_user.id,
                article_id=article_uuid,
                question=request.question,
                answer=assistant_response,
                model_used=settings.CLAUDE_SONNET_MODEL,
                conversation_id=conv_uuid,
                exchange_type='socratic',
            )
            db.add(qa_exchange)
            db.commit()
            db.refresh(qa_exchange)
            exchange_id = str(qa_exchange.id)
            logger.info(f"Persisted Socratic turn conv={conv_uuid} for user {current_user.id}")
        except Exception as persist_err:
            logger.warning(f"Failed to persist Socratic turn: {persist_err}")
            db.rollback()
            exchange_id = ""

        return {
            "response": assistant_response,
            "related_article_citations": related_citations,
            "follow_up_prompts": follow_up_prompts,
            "conversation_id": str(conv_uuid),
            "exchange_id": exchange_id,
        }
        
    except Exception as e:
        logger.error(f"Error in Socratic chat: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate Socratic response: {str(e)}"
        )


@router.get("/history/{article_id}")
async def get_chat_history(
    article_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all chat exchanges for an article, ordered by creation time.
    Used by the Chrome extension and web app to restore conversation state,
    and by Recap to synthesize weekly learning."""
    try:
        article_uuid = uuid_mod.UUID(article_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid article_id")

    exchanges = (
        db.query(QAExchange)
        .filter(
            QAExchange.article_id == article_uuid,
            QAExchange.user_id == current_user.id,
        )
        .order_by(QAExchange.created_at.asc())
        .all()
    )

    messages = []
    conversation_id = None
    for ex in exchanges:
        messages.append({"role": "user", "content": ex.question})
        messages.append({"role": "assistant", "content": ex.answer})
        if ex.conversation_id:
            conversation_id = str(ex.conversation_id)

    return {
        "messages": messages,
        "conversation_id": conversation_id or "",
        "exchange_count": len(exchanges),
    }
