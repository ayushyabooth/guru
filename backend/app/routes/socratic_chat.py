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
        
        # Build context from article — prefer context_summary (legally safe, dense RAG context).
        # Lazily generate context_summary on first Q&A access (saves tokens at ingestion for
        # articles that never get opened).
        from app.models.article_rich_content import ArticleRichContent
        from app.services.rich_summary_service import RichSummaryService
        rich_content = db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id == request.article_id
        ).first()
        context_text = rich_content.context_summary if rich_content and rich_content.context_summary else None
        if not context_text:
            # Lazy-generate and cache
            try:
                context_text = RichSummaryService(db).ensure_context_summary(article)
            except Exception as e:
                logger.warning(f"ensure_context_summary failed: {e}")
        if not context_text:
            context_text = (
                (article.raw_text[:3000] if article.raw_text else None)
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
        
        # System prompt is split into two blocks so the large, stable article context
        # can be marked with cache_control (90% discount on cache hits across multi-turn chat).
        system_instructions = """You are Guru - a sharp, insightful mentor who makes complex topics click.

Your goal: Keep the reader hooked and learning. Make them WANT to go deeper.

How to respond:
1. Jump straight into the insight - no labels, no headers, no "here's what I think"
2. Be conversational, like a brilliant colleague at coffee who gets excited about ideas
3. Connect the article to their world with specific, actionable angles
4. If it feels natural, end with ONE curious question that pulls them deeper (but don't force it)

Voice:
- Confident but not preachy
- Specific beats generic (use numbers, examples, comparisons from the article)
- Short paragraphs - let ideas breathe
- Match their energy - if they ask something technical, go technical

NEVER DO THIS:
- Don't use headers like "Key insight:" or "Question:" - just write naturally
- Don't announce what you're doing ("Let me explain..." "Here's a question...")
- Don't lecture - this is a dialogue, not a TED talk
- Don't ask multiple questions in your response - one max, and only if it sparks curiosity

OUTPUT FORMAT (STRICT):
Return ONLY a valid JSON object with exactly these two keys:
{
  "response": "<your Socratic answer here, natural prose, no headers>",
  "followups": ["<q1>", "<q2>", "<q3>"]
}
followups must contain exactly 3 short (<60 char) follow-up questions that deepen understanding, connect to the user's work, or challenge assumptions. Start each with action words like "How might...", "What if...", "Why does...". Return NOTHING outside the JSON."""

        article_block = f"""Context from article:
{article_context}
{related_articles_context}

{user_context}"""

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

        # Single merged call: returns both the response and follow-up prompts as JSON.
        # Cache the large article context block — stable across turns in the same chat.
        response = claude_client.client.messages.create(
            model=settings.CLAUDE_SONNET_MODEL,
            max_tokens=700,  # 500 response + ~150 followups + JSON scaffolding
            system=[
                {"type": "text", "text": system_instructions},
                {"type": "text", "text": article_block, "cache_control": {"type": "ephemeral"}},
            ],
            messages=messages
        )

        raw_text = response.content[0].text.strip()

        # Parse JSON; fall back gracefully if the model returns plain text.
        import json as _json
        import re as _re
        assistant_response = raw_text
        parsed_followups: List[str] = []
        try:
            # Strip markdown fences if present
            jtext = raw_text
            if jtext.startswith("```"):
                jtext = _re.sub(r"^```(?:json)?\s*|\s*```$", "", jtext.strip(), flags=_re.MULTILINE)
            parsed = _json.loads(jtext)
            if isinstance(parsed, dict):
                assistant_response = str(parsed.get("response", raw_text)).strip()
                fu = parsed.get("followups") or []
                if isinstance(fu, list):
                    parsed_followups = [str(q).strip() for q in fu if str(q).strip()][:3]
        except Exception as parse_err:
            logger.warning(f"Socratic JSON parse failed, using raw text: {parse_err}")
        
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
        
        # Follow-ups come from the same merged Claude call (no second API call).
        # Fall back to deterministic prompts if parsing gave us nothing.
        follow_up_prompts = parsed_followups
        if not follow_up_prompts:
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
