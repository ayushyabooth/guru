"""
Recap service for:
  - Legacy: collecting weekly Q&A exchanges and generating Claude Opus synthesis (RecapSession)
  - New: 4-stage Recap Journey with snapshot, guided questions, system-extracted
    insights, and commitment (RecapJourney + KeyInsight).

All users get the full journey (Snapshot → Questions → Socratic → Commitment → Audio).
Depth varies naturally with available data — no tier-based stage gating.
Q&A exchanges and user annotations are the primary signal for driving questions
and Socratic dialogue; reading time is background context.
"""
import json
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import and_, func
import uuid

from app.db.database import SessionLocal
from app.models.article import Article, ExpertNote
from app.models.qa_models import QAExchange
from app.models.recap import RecapSession, RecapSessionPublish, RecapJourney, KeyInsight
from app.models.interaction import UserSavedArticle, UserInteraction, UserAnnotation
from app.models.metric import TimeLog, DailyMetric
from app.models.article_rich_content import ArticleRichContent
from app.utils.llm_utils import get_claude_client
from app.config import settings

logger = logging.getLogger(__name__)

# GUR-218: a single reading session realistically tops out well under an hour.
# Sessions that are never closed (tab left open, no blur/visibility stop) can log
# many hours of wall-clock time and inflate snapshot aggregates (e.g. 1184 min on
# one article). Clamp each session's contribution to a sane ceiling so one runaway
# log can't dominate reading_pattern / deepest_dive.
MAX_SESSION_SECONDS = 60 * 60  # 60 minutes


def _capped_seconds(log) -> int:
    """Per-session reading seconds, clamped to MAX_SESSION_SECONDS (GUR-218)."""
    return min(log.duration_seconds or 0, MAX_SESSION_SECONDS)


class RecapService:
    """Service for handling weekly recap collection and synthesis"""
    
    @staticmethod
    def collect_weekly_qa(user_id: str, week_start: datetime, db: Optional[Session] = None) -> List[QAExchange]:
        """
        Collect user's Q&A exchanges from a specific week
        
        Args:
            user_id: UUID of the user
            week_start: Start of the week (datetime)
            db: Database session (optional)
            
        Returns:
            List of QAExchange objects from that week
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            week_end = week_start + timedelta(days=7)
            
            # Validate user_id
            try:
                user_uuid = uuid.UUID(user_id)
            except ValueError:
                logger.error(f"Invalid user ID format: {user_id}")
                return []
            
            exchanges = db.query(QAExchange).filter(
                and_(
                    QAExchange.user_id == user_uuid,
                    QAExchange.created_at >= week_start,
                    QAExchange.created_at < week_end
                )
            ).order_by(QAExchange.created_at.desc()).all()
            
            logger.info(f"Found {len(exchanges)} Q&A exchanges for user {user_id} in week {week_start.date()}")
            return exchanges
            
        except Exception as e:
            logger.error(f"Error collecting weekly Q&A for user {user_id}: {e}")
            return []
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def generate_recap_session(user_id: str, week_start: datetime, db: Optional[Session] = None) -> Dict:
        """
        Generate a new recap session with 4 selected questions from the week
        
        Args:
            user_id: UUID of the user
            week_start: Start of the week
            db: Database session (optional)
            
        Returns:
            Dictionary with recap session details or error
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
                return {"error": "Invalid user ID format"}
            
            # Check if recap session already exists for this week
            existing_session = db.query(RecapSession).filter(
                and_(
                    RecapSession.user_id == user_uuid,
                    RecapSession.week_start == week_start
                )
            ).first()
            
            if existing_session:
                return {"error": "Recap session already exists for this week"}
            
            # Collect Q&A exchanges from this week
            exchanges = RecapService.collect_weekly_qa(user_id, week_start, db)
            
            if len(exchanges) < 4:
                return {"error": f"Not enough Q&A exchanges this week (found {len(exchanges)}, need 4)"}
            
            # Select 4 diverse exchanges
            selected_exchanges = RecapService._select_diverse_exchanges(exchanges, 4, db)
            
            if len(selected_exchanges) < 4:
                return {"error": "Could not select 4 diverse exchanges"}
            
            # Create recap session
            week_end = week_start + timedelta(days=7)
            session = RecapSession(
                user_id=user_uuid,
                week_start=week_start,
                week_end=week_end,
                status='in_progress',
                selected_qa_ids=[str(e.id) for e in selected_exchanges]
            )
            
            # Store categories for each question
            for i, exchange in enumerate(selected_exchanges, 1):
                article = db.query(Article).filter(Article.id == exchange.article_id).first()
                category = "General"
                if article and article.expert_notes:
                    category = article.expert_notes[0].expert_industry or "General"
                elif article:
                    category = article.source or "General"
                
                setattr(session, f'question_{i}_category', category)
            
            db.add(session)
            db.commit()
            db.refresh(session)
            
            # Build response with question previews
            questions = []
            for i, exchange in enumerate(selected_exchanges):
                article = db.query(Article).filter(Article.id == exchange.article_id).first()
                questions.append({
                    "order": i + 1,
                    "article_id": str(exchange.article_id),
                    "article_title": article.title if article else "Unknown Article",
                    "question_preview": exchange.question[:100] + "..." if len(exchange.question) > 100 else exchange.question,
                    "category": getattr(session, f'question_{i+1}_category'),
                    "qa_exchange_id": str(exchange.id)
                })
            
            logger.info(f"Created recap session {session.id} for user {user_id}")
            
            return {
                "recap_id": str(session.id),
                "week_start": week_start.isoformat(),
                "week_end": week_end.isoformat(),
                "questions": questions,
                "status": session.status
            }
            
        except Exception as e:
            logger.error(f"Error generating recap session for user {user_id}: {e}")
            if db:
                db.rollback()
            return {"error": "Failed to generate recap session"}
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def _select_diverse_exchanges(exchanges: List[QAExchange], count: int, db: Session) -> List[QAExchange]:
        """
        Select diverse Q&A exchanges from different industries/categories
        
        Args:
            exchanges: List of all exchanges to choose from
            count: Number of exchanges to select
            db: Database session
            
        Returns:
            List of selected diverse exchanges
        """
        selected = []
        industries_seen = set()
        
        # First pass: select from different industries
        for exchange in exchanges:
            if len(selected) >= count:
                break
                
            article = db.query(Article).filter(Article.id == exchange.article_id).first()
            if not article:
                continue
                
            # Determine industry/category
            industry = "General"
            if article.expert_notes:
                industry = article.expert_notes[0].expert_industry or "General"
            elif article.source:
                industry = article.source
            
            if industry not in industries_seen:
                selected.append(exchange)
                industries_seen.add(industry)
        
        # Second pass: fill remaining slots with any exchanges
        if len(selected) < count:
            for exchange in exchanges:
                if len(selected) >= count:
                    break
                if exchange not in selected:
                    selected.append(exchange)
        
        return selected[:count]
    
    @staticmethod
    def generate_synthesis(recap_session_id: str, db: Optional[Session] = None) -> Dict:
        """
        Generate synthesis using Claude Opus for highest quality analysis
        
        Args:
            recap_session_id: UUID of the recap session
            db: Database session (optional)
            
        Returns:
            Dictionary with synthesis results or error
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            # Get recap session
            try:
                recap_uuid = uuid.UUID(recap_session_id)
            except ValueError:
                return {"error": "Invalid recap session ID"}

            session = db.query(RecapSession).filter(RecapSession.id == recap_uuid).first()
            if not session:
                return {"error": "Recap session not found"}
            
            # Get selected Q&A exchanges
            if not session.selected_qa_ids:
                return {"error": "No Q&A exchanges selected for this session"}
            
            exchanges_data = []
            for qa_id in session.selected_qa_ids:
                try:
                    qa_uuid = uuid.UUID(qa_id)
                except ValueError:
                    continue
                exchange = db.query(QAExchange).filter(QAExchange.id == qa_uuid).first()
                if exchange:
                    article = db.query(Article).filter(Article.id == exchange.article_id).first()
                    exchanges_data.append({
                        "question": exchange.question,
                        "answer": exchange.answer,
                        "article_title": article.title if article else "Unknown",
                        "category": article.expert_notes[0].expert_industry if article and article.expert_notes else "General"
                    })
            
            if not exchanges_data:
                return {"error": "No valid Q&A exchanges found"}
            
            # Build context for Claude
            exchanges_text = ""
            for i, data in enumerate(exchanges_data, 1):
                exchanges_text += f"""Q{i} ({data['category']} - {data['article_title']}):
Question: {data['question']}
Answer: {data['answer']}

"""
            
            # Use Claude Opus for highest quality synthesis
            claude_client = get_claude_client()
            
            prompt = f"""You are analyzing a week's worth of Q&A exchanges from a professional reader. Generate a thoughtful synthesis that helps them understand patterns and insights from their learning.

Q&A EXCHANGES FROM THIS WEEK:

{exchanges_text}

Please generate a 2-3 paragraph synthesis that:

1. **Identifies Common Themes**: What patterns or recurring topics emerge across these Q&A exchanges?

2. **Highlights Key Insights**: What are the most important or surprising insights that emerged from this week's learning?

3. **Makes Practical Connections**: How do these insights connect to each other and what practical implications do they suggest?

4. **Provides Forward-Looking Perspective**: What questions or areas for further exploration does this week's learning suggest?

Write in a conversational, engaging tone that helps the reader see the bigger picture of their learning journey. Focus on synthesis rather than just summarization."""

            response = claude_client.client.messages.create(
                model=settings.CLAUDE_SONNET_MODEL,  # Downgraded from Opus to save cost (~10x cheaper)
                max_tokens=1000,
                temperature=0.7,  # Slightly higher for more creative synthesis
                messages=[{"role": "user", "content": prompt}]
            )
            
            synthesis_text = response.content[0].text.strip()
            
            # Extract key insights
            insights = RecapService._extract_insights(synthesis_text, db)
            
            # Store synthesis in session
            session.synthesis_text = synthesis_text
            session.synthesis_insights = insights
            db.commit()
            
            logger.info(f"Generated synthesis for recap session {recap_session_id}")
            
            return {
                "synthesis_text": synthesis_text,
                "key_insights": insights,
                "generated_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error generating synthesis for recap {recap_session_id}: {e}")
            return {"error": "Failed to generate synthesis"}
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def _extract_insights(synthesis_text: str, db: Session) -> List[str]:
        """
        Extract 3-5 key insights from the synthesis text
        
        Args:
            synthesis_text: The generated synthesis
            db: Database session
            
        Returns:
            List of key insight strings
        """
        try:
            claude_client = get_claude_client()
            
            prompt = f"""Extract 3-5 key insights from this weekly learning synthesis. Each insight should be:
- Concise (1-2 sentences)
- Actionable or thought-provoking
- Distinct from the others

SYNTHESIS TEXT:
{synthesis_text}

Format your response as a JSON array of strings:
["Insight 1", "Insight 2", "Insight 3", ...]"""

            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=300,
                temperature=0.3,
                messages=[{"role": "user", "content": prompt}]
            )
            
            response_text = response.content[0].text.strip()
            insights = json.loads(response_text)
            
            # Ensure we have 3-5 insights
            if isinstance(insights, list):
                return insights[:5]  # Cap at 5 insights
            else:
                return ["Key insight about this week's learning journey"]
                
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to extract insights: {e}")
            return [
                "This week's learning revealed important patterns across different topics",
                "Key insights emerged that connect to broader professional themes",
                "New questions and areas for exploration were identified"
            ]
    
    @staticmethod
    def store_user_response(recap_session_id: str, question_order: int, response_text: str, db: Optional[Session] = None) -> Dict:
        """
        Store user's response to a recap question
        
        Args:
            recap_session_id: UUID of the recap session
            question_order: Order of the question (1-4)
            response_text: User's response
            db: Database session (optional)
            
        Returns:
            Dictionary with success status or error
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False
            
        try:
            try:
                recap_uuid = uuid.UUID(recap_session_id)
            except ValueError:
                return {"error": "Invalid recap session ID"}

            session = db.query(RecapSession).filter(RecapSession.id == recap_uuid).first()
            if not session:
                return {"error": "Recap session not found"}
            
            # Initialize user_responses if None
            if not session.user_responses:
                session.user_responses = {}
            
            # Store the response
            session.user_responses[str(question_order)] = response_text
            db.commit()
            
            logger.info(f"Stored response for recap {recap_session_id}, question {question_order}")
            
            return {"stored": True, "question_order": question_order}
            
        except Exception as e:
            logger.error(f"Error storing user response: {e}")
            if db:
                db.rollback()
            return {"error": "Failed to store response"}
            
        finally:
            if close_db:
                db.close()
    
    @staticmethod
    def get_recap_session(recap_session_id: str, db: Optional[Session] = None) -> Optional[Dict]:
        """
        Get recap session details

        Args:
            recap_session_id: UUID of the recap session
            db: Database session (optional)

        Returns:
            Dictionary with session details or None
        """
        if db is None:
            db = SessionLocal()
            close_db = True
        else:
            close_db = False

        try:
            try:
                recap_uuid = uuid.UUID(recap_session_id)
            except ValueError:
                return None

            session = db.query(RecapSession).filter(RecapSession.id == recap_uuid).first()
            if not session:
                return None

            return {
                "id": str(session.id),
                "user_id": str(session.user_id),
                "week_start": session.week_start.isoformat(),
                "week_end": session.week_end.isoformat(),
                "status": session.status,
                "synthesis_text": session.synthesis_text,
                "synthesis_insights": session.synthesis_insights,
                "user_responses": session.user_responses,
                "created_at": session.created_at.isoformat(),
                "published_at": session.published_at.isoformat() if session.published_at else None
            }

        except Exception as e:
            logger.error(f"Error getting recap session {recap_session_id}: {e}")
            return None

        finally:
            if close_db:
                db.close()


# ══════════════════════════════════════════════════════════════════════
# New Recap Journey Service — 4-stage learning consolidation
# ══════════════════════════════════════════════════════════════════════


class RecapJourneyService:
    """Service for the new 4-stage Recap Journey (replacing legacy RecapSession flow)"""

    # ── Activity Stats (cheap counts used for journey metadata) ───────

    @staticmethod
    def _compute_activity_stats(
        user_id, week_start: date, week_end: date, db: Session
    ) -> Dict:
        """
        Count the user's weekly activity for display/metadata purposes.

        This is a lightweight DB-count pass — no LLM, no heavy aggregation.
        The full snapshot (articles, anchors, Q&A highlights, annotations) is
        built lazily on first Stage 1 fetch so mid-week activity is captured.

        Returns activity_stats_dict (no tier — all users get the full journey).
        """
        user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        week_start_dt = datetime.combine(week_start, datetime.min.time())
        week_end_dt = datetime.combine(week_end, datetime.max.time())

        # ── Count articles engaged with (via time logs) ──
        article_time_logs = db.query(TimeLog).filter(
            and_(
                TimeLog.user_id == user_uuid,
                TimeLog.ring_type.in_(['catchup', 'divein']),
                TimeLog.started_at >= week_start_dt,
                TimeLog.started_at <= week_end_dt,
            )
        ).all()

        engaged_context_ids = set()
        total_time_seconds = 0
        industries_seen = set()
        specializations_seen = set()

        for log in article_time_logs:
            if log.context_id:
                engaged_context_ids.add(log.context_id)
            total_time_seconds += _capped_seconds(log)
            if log.industry:
                industries_seen.add(log.industry)
            if log.specialization:
                specializations_seen.add(log.specialization)

        articles_read_count = len(engaged_context_ids)
        total_time_minutes = total_time_seconds // 60

        articles_saved_count = db.query(UserSavedArticle).filter(
            and_(
                UserSavedArticle.user_id == user_uuid,
                UserSavedArticle.saved_at >= week_start_dt,
                UserSavedArticle.saved_at <= week_end_dt,
            )
        ).count()

        qa_count = db.query(QAExchange).filter(
            and_(
                QAExchange.user_id == user_uuid,
                QAExchange.created_at >= week_start_dt,
                QAExchange.created_at <= week_end_dt,
            )
        ).count()

        filters_explored = len(industries_seen) + len(specializations_seen)
        if filters_explored == 0:
            filters_explored = 1

        return {
            "articles_read_count": articles_read_count,
            "articles_saved_count": articles_saved_count,
            "qa_count": qa_count,
            "filters_explored_count": filters_explored,
            "total_time_minutes": total_time_minutes,
            "industries": list(industries_seen),
            "specializations": list(specializations_seen),
        }

    # ── Step 4: Stage 1 — Weekly Snapshot Generation ──────────────────

    @staticmethod
    def generate_weekly_snapshot(
        user_id, week_start: date, week_end: date, db: Session
    ) -> Dict:
        """
        Generate a content-focused "memory board" for Stage 1.

        NOT metrics — this is a visual summary of what the user actually engaged with.

        Returns JSON:
        {
          articles_engaged: [...],
          filters_explored: [...],
          qa_highlights: [...],
          topic_clusters: [...],
          reading_pattern: { peak_day, total_articles, deepest_dive }
        }
        """
        user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        week_start_dt = datetime.combine(week_start, datetime.min.time())
        week_end_dt = datetime.combine(week_end, datetime.max.time())

        # ── Collect articles engaged with ──
        time_logs = db.query(TimeLog).filter(
            and_(
                TimeLog.user_id == user_uuid,
                TimeLog.ring_type.in_(['catchup', 'divein']),
                TimeLog.started_at >= week_start_dt,
                TimeLog.started_at <= week_end_dt,
            )
        ).all()

        # ── Fallback: if no activity this week, widen window to last 14 days ──
        # This ensures the snapshot always has content to show, even for
        # users who were active recently but not in the strict Mon-Sun window.
        widened_window = False
        if not time_logs:
            fallback_start_dt = datetime.combine(
                week_end - timedelta(days=14), datetime.min.time()
            )
            time_logs = db.query(TimeLog).filter(
                and_(
                    TimeLog.user_id == user_uuid,
                    TimeLog.ring_type.in_(['catchup', 'divein']),
                    TimeLog.started_at >= fallback_start_dt,
                    TimeLog.started_at <= week_end_dt,
                )
            ).all()
            if time_logs:
                widened_window = True
                week_start_dt = fallback_start_dt
                logger.info(
                    f"Snapshot for user {user_id}: no activity in strict week, "
                    f"widened to last 14 days ({len(time_logs)} time logs found)"
                )

        # Aggregate per context_id (article/storyboard)
        article_engagement = {}  # context_id -> { total_seconds, industry, specialization, activity_types }
        day_totals = {}  # day_name -> total_seconds

        for log in time_logs:
            ctx = log.context_id
            if not ctx:
                # Still track day totals for peak day calc, skip article aggregation
                if log.started_at:
                    day_name = log.started_at.strftime("%A")
                    day_totals[day_name] = day_totals.get(day_name, 0) + _capped_seconds(log)
                continue

            if ctx not in article_engagement:
                article_engagement[ctx] = {
                    "total_seconds": 0,
                    "industry": log.industry,
                    "specialization": log.specialization,
                    "activity_types": set(),
                }
            article_engagement[ctx]["total_seconds"] += _capped_seconds(log)
            if log.activity_type:
                article_engagement[ctx]["activity_types"].add(log.activity_type)

            # Track per-day totals for peak day calculation
            if log.started_at:
                day_name = log.started_at.strftime("%A")
                day_totals[day_name] = day_totals.get(day_name, 0) + _capped_seconds(log)

        # Also discover articles from annotations, QA, and interactions
        # (catches articles the user engaged with even without a TimeLog context_id)
        annotation_article_ids = set(
            str(a.article_id) for a in db.query(UserAnnotation.article_id).filter(
                and_(
                    UserAnnotation.user_id == user_uuid,
                    UserAnnotation.created_at >= week_start_dt,
                    UserAnnotation.created_at <= week_end_dt,
                )
            ).distinct().all()
        )
        qa_article_ids = set(
            str(q.article_id) for q in db.query(QAExchange.article_id).filter(
                and_(
                    QAExchange.user_id == user_uuid,
                    QAExchange.created_at >= week_start_dt,
                    QAExchange.created_at <= week_end_dt,
                )
            ).distinct().all()
        )
        interaction_article_ids = set(
            str(i.article_id) for i in db.query(UserInteraction.article_id).filter(
                and_(
                    UserInteraction.user_id == user_uuid,
                    UserInteraction.article_id.isnot(None),
                    UserInteraction.created_at >= week_start_dt,
                    UserInteraction.created_at <= week_end_dt,
                )
            ).distinct().all()
        )

        # Merge discovered article IDs into article_engagement
        for aid in (annotation_article_ids | qa_article_ids | interaction_article_ids):
            if aid and aid not in article_engagement:
                article_engagement[aid] = {
                    "total_seconds": 0,
                    "industry": None,
                    "specialization": None,
                    "activity_types": set(),
                }
                if aid in qa_article_ids:
                    article_engagement[aid]["activity_types"].add("qa")
            elif aid and aid in article_engagement:
                if aid in qa_article_ids:
                    article_engagement[aid]["activity_types"].add("qa")

        # ── Build articles_engaged list ──
        articles_engaged = []
        for ctx_id, engagement in article_engagement.items():
            # Try to find the article record
            article = None
            try:
                article_uuid = uuid.UUID(ctx_id)
                article = db.query(Article).filter(Article.id == article_uuid).first()
            except (ValueError, Exception):
                pass

            # Get a key quote from ArticleRichContent
            key_quote = None
            if article:
                rich = db.query(ArticleRichContent).filter(
                    ArticleRichContent.article_id == article.id
                ).first()
                if rich and rich.spotlight_quotes:
                    quotes = rich.spotlight_quotes
                    if isinstance(quotes, list) and len(quotes) > 0:
                        key_quote = quotes[0] if isinstance(quotes[0], str) else str(quotes[0])

            # Determine engagement type
            activity_types = engagement["activity_types"]
            engagement_type = "read"
            if "qa" in activity_types:
                engagement_type = "qa_asked"

            # Check if saved
            if article:
                is_saved = db.query(UserSavedArticle).filter(
                    and_(
                        UserSavedArticle.user_id == user_uuid,
                        UserSavedArticle.article_id == article.id,
                    )
                ).first()
                if is_saved:
                    engagement_type = "saved"

            # Determine filter context
            filter_context = "core"
            if engagement["specialization"]:
                filter_context = f"specialization:{engagement['specialization']}"
            elif engagement["industry"]:
                filter_context = f"industry:{engagement['industry']}"

            articles_engaged.append({
                "id": ctx_id,
                "title": article.title if article else f"Content {ctx_id[:8]}",
                "source": article.source if article else None,
                "thumbnail_url": article.article_image_url if article else None,
                "filter_context": filter_context,
                "key_quote": key_quote,
                "engagement_type": engagement_type,
                "time_spent_minutes": round(engagement["total_seconds"] / 60, 1),
            })

        # Sort by time spent (deepest engagement first)
        articles_engaged.sort(key=lambda a: a["time_spent_minutes"], reverse=True)

        # ── Filters explored ──
        filters_explored = list(set(
            a["filter_context"] for a in articles_engaged if a["filter_context"] != "core"
        ))
        if not filters_explored:
            filters_explored = ["core"]

        # ── Q&A highlights ──
        qa_exchanges = db.query(QAExchange).filter(
            and_(
                QAExchange.user_id == user_uuid,
                QAExchange.created_at >= week_start_dt,
                QAExchange.created_at <= week_end_dt,
            )
        ).order_by(QAExchange.created_at.desc()).limit(5).all()

        qa_highlights = []
        for qa in qa_exchanges:
            article = db.query(Article).filter(Article.id == qa.article_id).first()
            qa_highlights.append({
                "question": qa.question[:150] if qa.question else "",
                "article_title": article.title if article else "Unknown",
                "answer_snippet": qa.answer[:200] if qa.answer else "",
            })

        # ── Spotlight interactions ──
        spotlight_interactions = db.query(UserInteraction).filter(
            and_(
                UserInteraction.user_id == user_uuid,
                UserInteraction.created_at >= week_start_dt,
                UserInteraction.created_at <= week_end_dt,
            )
        ).order_by(UserInteraction.created_at.desc()).limit(20).all()

        spotlight_highlights = []
        for si in spotlight_interactions:
            article = None
            if si.article_id:
                article = db.query(Article).filter(Article.id == si.article_id).first()
            spotlight_highlights.append({
                "type": si.interaction_type,
                "content": si.content[:200] if si.content else None,
                "article_title": article.title if article else None,
            })

        # ── User annotations (highlights + notes) ──
        annotations = db.query(UserAnnotation).filter(
            and_(
                UserAnnotation.user_id == user_uuid,
                UserAnnotation.created_at >= week_start_dt,
                UserAnnotation.created_at <= week_end_dt,
            )
        ).order_by(UserAnnotation.created_at.desc()).limit(15).all()

        user_highlights = []
        for ann in annotations:
            article = db.query(Article).filter(Article.id == ann.article_id).first()
            user_highlights.append({
                "highlighted_text": ann.highlighted_text[:200] if ann.highlighted_text else "",
                "note": ann.note_text[:200] if ann.note_text else None,
                "article_title": article.title if article else "Unknown",
            })

        # ── Topic clusters (group by industry/specialization) ──
        cluster_map = {}
        for article_data in articles_engaged:
            fc = article_data["filter_context"]
            if fc not in cluster_map:
                cluster_map[fc] = {"theme": fc, "article_count": 0, "filters": set()}
            cluster_map[fc]["article_count"] += 1
            cluster_map[fc]["filters"].add(fc)

        topic_clusters = [
            {
                "theme": v["theme"],
                "article_count": v["article_count"],
                "filters": list(v["filters"]),
            }
            for v in cluster_map.values()
        ]
        topic_clusters.sort(key=lambda c: c["article_count"], reverse=True)

        # ── Reading pattern ──
        peak_day = max(day_totals, key=day_totals.get) if day_totals else "N/A"
        deepest_dive = articles_engaged[0] if articles_engaged else None

        reading_pattern = {
            "peak_day": peak_day,
            "total_articles": len(articles_engaged),
            "deepest_dive": {
                "article_title": deepest_dive["title"] if deepest_dive else "N/A",
                "time_spent_minutes": deepest_dive["time_spent_minutes"] if deepest_dive else 0,
            },
        }

        snapshot = {
            "articles_engaged": articles_engaged,
            "filters_explored": filters_explored,
            "qa_highlights": qa_highlights,
            "spotlight_highlights": spotlight_highlights,
            "user_highlights": user_highlights,
            "topic_clusters": topic_clusters,
            "reading_pattern": reading_pattern,
            "widened_window": widened_window,
        }

        # Compute anchor interactions (top 3-4 most meaningful engagements)
        snapshot["anchor_interactions"] = RecapJourneyService.prioritize_anchor_interactions(snapshot)

        logger.info(
            f"Generated weekly snapshot for user {user_id}: "
            f"{len(articles_engaged)} articles, {len(qa_highlights)} QAs, "
            f"{len(spotlight_highlights)} interactions, {len(user_highlights)} annotations, "
            f"{len(topic_clusters)} clusters, {len(snapshot['anchor_interactions'])} anchors"
        )
        return snapshot

    # ── Activity Prioritization ──────────────────────────────────────

    @staticmethod
    def prioritize_anchor_interactions(snapshot_data: Dict) -> List[Dict]:
        """
        Score each article by composite engagement and return top 3-4
        as 'anchor interactions' for Stage 2 and Stage 3.

        Scoring weights:
          - Time depth:        min(time_spent_minutes / 5, 3.0)    max 3 pts
          - Highlight/note:    2 pts per highlight, +1 if has note  uncapped
          - Q&A asked:         3 pts per question asked             uncapped
          - Spotlight taps:    1 pt per spotlight tap               uncapped
          - Saved:             2 pts if article was saved           max 2 pts

        Diversity constraint: No more than 2 anchors from the same filter_context.
        """
        articles = snapshot_data.get("articles_engaged", [])
        if not articles:
            return []

        user_highlights = snapshot_data.get("user_highlights", [])
        qa_highlights = snapshot_data.get("qa_highlights", [])
        spotlight_highlights = snapshot_data.get("spotlight_highlights", [])

        # Build per-article lookup maps by title
        highlight_map = {}  # article_title -> [{"text": ..., "note": ...}]
        for h in user_highlights:
            title = h.get("article_title", "")
            if title not in highlight_map:
                highlight_map[title] = []
            highlight_map[title].append({
                "text": h.get("highlighted_text", ""),
                "note": h.get("note"),
            })

        qa_map = {}  # article_title -> [question_text]
        for q in qa_highlights:
            title = q.get("article_title", "")
            if title not in qa_map:
                qa_map[title] = []
            qa_map[title].append(q.get("question", ""))

        spotlight_map = {}  # article_title -> [content]
        for s in spotlight_highlights:
            title = s.get("article_title", "")
            if title not in spotlight_map:
                spotlight_map[title] = []
            spotlight_map[title].append(s.get("content", ""))

        # Score each article
        scored = []
        for article in articles:
            title = article.get("title", "")
            time_min = article.get("time_spent_minutes", 0)

            # Time depth score: max 3 pts
            time_score = min(time_min / 5.0, 3.0)

            # Highlights + notes
            article_highlights = highlight_map.get(title, [])
            highlight_score = sum(
                2 + (1 if h.get("note") else 0)
                for h in article_highlights
            )

            # Q&A questions
            article_qas = qa_map.get(title, [])
            qa_score = len(article_qas) * 3

            # Spotlight taps
            article_spotlights = spotlight_map.get(title, [])
            spotlight_score = len(article_spotlights)

            # Saved bonus
            saved_score = 2 if article.get("engagement_type") == "saved" else 0

            composite = time_score + highlight_score + qa_score + spotlight_score + saved_score

            scored.append({
                "article_id": article.get("id", ""),
                "article_title": title,
                "filter_context": article.get("filter_context", "core"),
                "composite_score": round(composite, 1),
                "time_spent_minutes": time_min,
                "highlights": article_highlights,
                "qa_questions": article_qas,
                "spotlight_taps": article_spotlights,
                "was_saved": article.get("engagement_type") == "saved",
                "score_breakdown": {
                    "time": round(time_score, 1),
                    "highlights": highlight_score,
                    "qa": qa_score,
                    "spotlights": spotlight_score,
                    "saved": saved_score,
                },
            })

        # Sort by composite score descending
        scored.sort(key=lambda a: a["composite_score"], reverse=True)

        # Apply diversity constraint: max 2 per filter_context
        anchors = []
        filter_counts = {}
        for item in scored:
            fc = item["filter_context"]
            if filter_counts.get(fc, 0) >= 2:
                continue
            anchors.append(item)
            filter_counts[fc] = filter_counts.get(fc, 0) + 1
            if len(anchors) >= 4:
                break

        return anchors

    # ── Stage 1 Lazy Compute: ensure_snapshot ─────────────────────────

    @staticmethod
    def ensure_snapshot(journey, db: Session) -> Dict:
        """
        Compute and cache the weekly snapshot on the journey record if missing.

        Called at first Stage 1 fetch (not at /recap/start) so that mid-week
        activity between journey creation and Recap open is captured. Subsequent
        calls return the cached snapshot without recomputation.

        Also updates the activity count columns on the journey from the fresh data.
        """
        if journey.snapshot_data:
            return journey.snapshot_data

        snapshot = RecapJourneyService.generate_weekly_snapshot(
            journey.user_id, journey.week_start, journey.week_end, db
        )
        journey.snapshot_data = snapshot

        # Refresh activity counts from the fresh snapshot so the journey row
        # reflects current state rather than the stale counts from /recap/start.
        stats = RecapJourneyService._compute_activity_stats(
            journey.user_id, journey.week_start, journey.week_end, db
        )
        journey.articles_read_count = stats["articles_read_count"]
        journey.articles_saved_count = stats["articles_saved_count"]
        journey.qa_count = stats["qa_count"]
        journey.filters_explored_count = stats["filters_explored_count"]
        journey.total_time_minutes = stats["total_time_minutes"]

        flag_modified(journey, 'snapshot_data')
        db.commit()
        db.refresh(journey)

        logger.info(
            f"Lazily computed Stage 1 snapshot for journey {journey.id} "
            f"({stats['articles_read_count']} articles, {stats['qa_count']} QAs, "
            f"{len(snapshot.get('user_highlights', []))} annotations)"
        )
        return snapshot

    # ── Step 5: Stage 2 — Guided Question Generation ──────────────────

    @staticmethod
    def generate_guided_questions(
        user_id, snapshot_data: Dict, db: Session
    ) -> List[Dict]:
        """
        Generate 5 typed guided questions based on the weekly snapshot.

        Question types:
          'retrieval'       — "What was the key argument in [Article X]?"
          'pattern_spotting' — "Which two articles told a consistent story about [Theme]?"
          'reflection'      — "How does [Insight] connect to your work in [Specialization]?"
          'surprise'        — "What was the most unexpected thing you encountered?"

        Q&A exchanges and user annotations are the PRIMARY signal — questions
        should build on what the user actually asked and highlighted. Reading
        time is secondary context.

        Returns list of question dicts.
        """
        articles = snapshot_data.get("articles_engaged", [])
        qa_highlights = snapshot_data.get("qa_highlights", [])
        user_highlights = snapshot_data.get("user_highlights", [])
        topic_clusters = snapshot_data.get("topic_clusters", [])
        filters = snapshot_data.get("filters_explored", [])
        anchor_interactions = snapshot_data.get("anchor_interactions", [])

        if not articles:
            # No articles found in snapshot — return a set of general
            # reflection questions so the user still gets a meaningful
            # Stage 2 experience rather than a single generic prompt.
            return [
                {
                    "type": "reflection",
                    "text": "Think about the most interesting article or idea you came across recently. What made it stick with you?",
                    "referenced_articles": [],
                    "response_format": "free_text",
                    "chips": [],
                },
                {
                    "type": "pattern_spotting",
                    "text": "Have you noticed any recurring themes or topics showing up across your reading lately?",
                    "referenced_articles": [],
                    "response_format": "free_text",
                    "chips": [],
                },
                {
                    "type": "surprise",
                    "text": "Was there anything you read recently that challenged your assumptions or surprised you?",
                    "referenced_articles": [],
                    "response_format": "free_text",
                    "chips": [],
                },
                {
                    "type": "reflection",
                    "text": "What's one topic you'd like to explore more deeply next week?",
                    "referenced_articles": [],
                    "response_format": "free_text",
                    "chips": [],
                },
            ]

        # Always generate 5 questions — everyone gets the full journey
        question_count = 5

        # ── PRIMARY SIGNAL: The user's own questions ──
        # Q&A is the highest-value signal of curiosity — lead with it.
        qa_primary = ""
        if qa_highlights:
            qa_lines = []
            for q in qa_highlights[:5]:
                qa_lines.append(
                    f'- They asked: "{q["question"][:150]}" (about: {q["article_title"]})'
                )
            qa_primary = (
                "\n\n═══ PRIMARY SIGNAL — THE USER'S OWN QUESTIONS ═══\n"
                "These are the questions the user ACTUALLY asked this week. They are "
                "the single most valuable signal of what the user is curious about. "
                "Your generated questions MUST build on this curiosity:\n"
                + "\n".join(qa_lines)
                + "\n\nAt LEAST 2 of your 5 generated questions should directly build on these. "
                  "Open one of them with a phrase like \"Building on your question about...\" or "
                  "\"You asked why X — what does that imply for Y?\" Extend, challenge, or connect "
                  "the threads THEY already pulled on."
            )

        # ── SECONDARY SIGNAL: The user's annotations (verbatim highlights + notes) ──
        annotations_primary = ""
        if user_highlights:
            ann_lines = []
            for h in user_highlights[:8]:
                line = f'- Highlighted: "{h.get("highlighted_text", "")[:160]}" (in: {h.get("article_title", "?")})'
                if h.get("note"):
                    line += f'\n  User\'s own note: "{h["note"][:140]}"'
                ann_lines.append(line)
            annotations_primary = (
                "\n\n═══ SECONDARY SIGNAL — PASSAGES THE USER HIGHLIGHTED/NOTED ═══\n"
                "These are the exact passages the user stopped to mark. Reference their\n"
                "highlighted words VERBATIM in at least one question — quote them back:\n"
                + "\n".join(ann_lines)
            )

        # ── BACKGROUND CONTEXT: Anchor interactions (engagement depth by time) ──
        anchors_context = ""
        if anchor_interactions:
            anchors_parts = []
            for i, a in enumerate(anchor_interactions[:4]):
                parts = [f"ANCHOR {i+1}: [id:{a['article_id']}] \"{a['article_title']}\" "
                         f"(time: {a['time_spent_minutes']}m, engagement score: {a['composite_score']})"]
                if a.get("highlights"):
                    hl_texts = [f'"{h["text"][:80]}"' + (f' [note: {h["note"][:60]}]' if h.get("note") else '')
                                for h in a["highlights"][:3]]
                    parts.append(f"  User highlighted: {', '.join(hl_texts)}")
                if a.get("qa_questions"):
                    parts.append(f"  User asked: {'; '.join(q[:80] for q in a['qa_questions'][:3])}")
                if a.get("spotlight_taps"):
                    parts.append(f"  Spotlights tapped: {'; '.join(s[:80] for s in a['spotlight_taps'][:3])}")
                anchors_parts.append("\n".join(parts))
            anchors_context = (
                "\n\nBACKGROUND CONTEXT — DEEPEST ENGAGEMENTS BY TIME:\n"
                "(Reading time is background. Prefer Q&A + annotations when both point to the same article.)\n"
                + "\n\n".join(anchors_parts)
            )

        # ── Articles and clusters — pure background context ──
        articles_summary = "\n".join([
            f"- [id:{a.get('id', 'unknown')}] \"{a['title']}\" (filter: {a['filter_context']}, time: {a['time_spent_minutes']}m, type: {a['engagement_type']})"
            for a in articles[:15]
        ])

        clusters_summary = ""
        if topic_clusters:
            clusters_summary = "\nTopic clusters:\n" + "\n".join([
                f"- {c['theme']}: {c['article_count']} articles"
                for c in topic_clusters[:5]
            ])

        types_instruction = (
            "Generate exactly 5 questions with this mix:\n"
            "- 1 'retrieval' (tests recall of specific content)\n"
            "- 1 'pattern_spotting' (finds connections between articles)\n"
            "- 2 'reflection' (connects content to reader's work/experience)\n"
            "- 1 'surprise' (identifies unexpected or counterintuitive findings)"
        )

        prompt = f"""You are generating guided reflection questions for a professional reader's weekly recap.

Q&A and annotations are the PRIMARY signal of what the user actually cares about.
Reading time is background. Lead every question from what they asked and highlighted.
{qa_primary}
{annotations_primary}

{anchors_context}

ARTICLES ENGAGED THIS WEEK (background):
{articles_summary}
{clusters_summary}

{types_instruction}

IMPORTANT INSTRUCTIONS:
- If the user asked ANY Q&A this week, at least 2 of your 5 questions MUST directly extend one of their actual questions (build on it, challenge it, or connect it to another article)
- If the user highlighted ANY passages, quote at least ONE highlighted phrase VERBATIM in one of your questions and ask them to unpack why it struck them
- Only after you've anchored on Q&A + annotations, layer in pattern/retrieval/surprise questions across the broader article set
- Include article IDs using format [[Article: "title" | id:UUID]] so the UI can render tappable article links

For each question, provide:
- "type": one of "retrieval", "pattern_spotting", "reflection", "surprise"
- "text": the question text (engaging, specific, referencing actual article titles with [[Article: "title" | id:UUID]] tags)
- "referenced_articles": list of article IDs referenced (from the articles above)
- "response_format": "free_text" for retrieval/reflection/surprise, "tappable_chips" for pattern_spotting
- "chips": (only for tappable_chips format) list of article title pairs or options

Return a JSON array of question objects. Example:
[
  {{
    "type": "reflection",
    "text": "Building on your question \\"Why do founders miss the signals?\\" — does that apply to the distribution pivot in [[Article: \\"Foo\\" | id:abc]]?",
    "referenced_articles": ["abc"],
    "response_format": "free_text",
    "chips": []
  }},
  {{
    "type": "pattern_spotting",
    "text": "Which two articles shared a common theme about digital transformation?",
    "referenced_articles": ["article-id-1", "article-id-2", "article-id-3"],
    "response_format": "tappable_chips",
    "chips": ["Article A + Article B", "Article A + Article C", "Article B + Article C"]
  }}
]

Return ONLY the JSON array, no other text."""

        try:
            claude_client = get_claude_client()
            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=1500,
                temperature=0.6,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = response.content[0].text.strip()

            # Try to parse JSON (handle markdown code fences)
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()

            questions = json.loads(response_text)

            if isinstance(questions, list):
                return questions[:question_count]
            else:
                logger.warning("Claude returned non-list for guided questions")
                return RecapJourneyService._fallback_questions(articles, qa_highlights)

        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Failed to generate guided questions via Claude: {e}")
            return RecapJourneyService._fallback_questions(articles, qa_highlights)

    @staticmethod
    def _fallback_questions(
        articles: List[Dict], qa_highlights: Optional[List[Dict]] = None
    ) -> List[Dict]:
        """Generate fallback questions if Claude fails. Leads with Q&A when present."""
        questions = []
        qa_highlights = qa_highlights or []

        # Lead with the user's actual Q&A if they asked anything this week
        if qa_highlights:
            first_q = qa_highlights[0]
            questions.append({
                "type": "reflection",
                "text": (
                    f"Building on the question you asked about \"{first_q.get('article_title', '?')}\" — "
                    f"\"{first_q.get('question', '')[:120]}\" — what partial answer are you now sitting with?"
                ),
                "referenced_articles": [],
                "response_format": "free_text",
                "chips": [],
            })
            if len(qa_highlights) >= 2:
                questions.append({
                    "type": "pattern_spotting",
                    "text": "The questions you asked this week — do they share a hidden thread? What are you really chasing?",
                    "referenced_articles": [],
                    "response_format": "free_text",
                    "chips": [],
                })

        if articles:
            questions.append({
                "type": "retrieval",
                "text": f"What was the most important takeaway from \"{articles[0]['title']}\"?",
                "referenced_articles": [articles[0]["id"]],
                "response_format": "free_text",
                "chips": [],
            })

        questions.append({
            "type": "reflection",
            "text": "How might what you read this week change your approach to work next week?",
            "referenced_articles": [],
            "response_format": "free_text",
            "chips": [],
        })

        if len(articles) >= 2:
            questions.append({
                "type": "pattern_spotting",
                "text": "Did you notice any common themes across the articles you read this week?",
                "referenced_articles": [a["id"] for a in articles[:3]],
                "response_format": "free_text",
                "chips": [],
            })
            questions.append({
                "type": "surprise",
                "text": "What was the most unexpected or counterintuitive thing you encountered this week?",
                "referenced_articles": [],
                "response_format": "free_text",
                "chips": [],
            })

        return questions[:5]

    # ── Step 5b: Generate Follow-up After User Answer ──────────────────

    @staticmethod
    def generate_question_followup(
        journey_id, question_index: int, user_answer: str, db: Session
    ) -> Dict:
        """
        Generate a 1-2 sentence follow-up after user answers a guided question.
        Connects their answer to a DIFFERENT anchor interaction.
        Returns: {"followup_text": "...", "referenced_articles": [...]}
        """
        try:
            journey_uuid = journey_id if isinstance(journey_id, uuid.UUID) else uuid.UUID(str(journey_id))
            journey = db.query(RecapJourney).filter(RecapJourney.id == journey_uuid).first()
            if not journey:
                return {"followup_text": "", "referenced_articles": []}

            snapshot = journey.snapshot_data or {}
            anchors = snapshot.get("anchor_interactions", [])
            questions = journey.guided_questions or []

            if question_index >= len(questions):
                return {"followup_text": "", "referenced_articles": []}

            current_question = questions[question_index]

            # Build context of OTHER anchors (exclude the one referenced in the question)
            current_refs = set(current_question.get("referenced_articles", []))
            other_anchors = [a for a in anchors if a["article_id"] not in current_refs]
            if not other_anchors:
                other_anchors = anchors  # Fallback to all if filtering removes everything

            other_context = "\n".join([
                f"- [id:{a['article_id']}] \"{a['article_title']}\""
                + (f" (highlighted: {a['highlights'][0]['text'][:60]})" if a.get('highlights') else "")
                + (f" (asked: {a['qa_questions'][0][:60]})" if a.get('qa_questions') else "")
                for a in other_anchors[:3]
            ])

            # If no articles to reference, generate a simpler followup without article links
            if not other_context.strip():
                prompt = f"""The user just answered a guided reflection question in their weekly recap.

Question: {current_question.get('text', '')}
User's answer: {user_answer[:500]}

Generate a brief follow-up (1-2 sentences) that:
1. Acknowledges their thought naturally (don't just say "great answer")
2. Asks a deeper probing question to help them think further
3. Do NOT reference any articles, IDs, or links — the user hasn't read any yet

Return ONLY the follow-up text, no JSON wrapper."""
            else:
                prompt = f"""The user just answered a guided reflection question in their weekly recap.

Question: {current_question.get('text', '')}
User's answer: {user_answer[:500]}

Other articles/interactions the user engaged with this week:
{other_context}

Generate a brief follow-up (1-2 sentences) that:
1. Acknowledges their thought naturally (don't just say "great answer")
2. Connects their answer to ONE of the other articles listed above
3. Asks a deeper probing question that bridges the two topics
4. Use [[Article: "title" | id:UUID]] format for article references — ONLY use IDs from the list above, never invent IDs

Return ONLY the follow-up text, no JSON wrapper."""

            claude_client = get_claude_client()
            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=300,
                temperature=0.7,
                messages=[{"role": "user", "content": prompt}],
            )
            followup_text = response.content[0].text.strip()

            # Extract article references from the response
            import re
            refs = re.findall(r'\[\[Article:.*?\|\s*id:([a-f0-9-]+)\]\]', followup_text)

            return {
                "followup_text": followup_text,
                "referenced_articles": refs,
            }

        except Exception as e:
            logger.error(f"Failed to generate question followup: {e}")
            return {"followup_text": "", "referenced_articles": []}

    # ── Step 7: System-Extracted Insights (Fallback) ──────────────────

    @staticmethod
    def extract_system_insights(
        user_id, snapshot_data: Dict, week_start: date, db: Session
    ) -> List[Dict]:
        """
        Extract insights from articles when user didn't do Stage 3,
        or to supplement user-generated insights.

        Uses Claude to analyze the week's articles and find:
          - Cross-filter patterns
          - Surprising connections
          - Key takeaways from highest-quality articles

        Returns list of dicts suitable for creating KeyInsight records.
        """
        articles = snapshot_data.get("articles_engaged", [])
        if not articles:
            return []

        # Build article summaries for Claude
        article_details = []
        for article_data in articles[:10]:
            try:
                article_uuid = uuid.UUID(article_data["id"])
                article = db.query(Article).filter(Article.id == article_uuid).first()
                if article:
                    rich = db.query(ArticleRichContent).filter(
                        ArticleRichContent.article_id == article.id
                    ).first()
                    summary = ""
                    if rich:
                        if rich.summary_whats_in:
                            summary += rich.summary_whats_in + " "
                        if rich.summary_why_matters:
                            summary += rich.summary_why_matters
                    elif article.raw_text:
                        summary = article.raw_text[:300]

                    article_details.append({
                        "id": article_data["id"],
                        "title": article.title,
                        "filter": article_data.get("filter_context", "core"),
                        "summary": summary.strip(),
                    })
            except Exception:
                continue

        if not article_details:
            return []

        articles_text = "\n\n".join([
            f"[id:{a['id']}] [{a['filter']}] \"{a['title']}\": {a['summary']}"
            for a in article_details
        ])

        prompt = f"""Analyze these articles that a professional reader engaged with this week and extract 3-5 key insights.

ARTICLES:
{articles_text}

For each insight:
- Find cross-article patterns, surprising connections, or actionable takeaways
- Reference specific articles that contribute to the insight using their exact UUID from the [id:...] prefix above
- Make insights concise (1-2 sentences) and thought-provoking

Return a JSON array:
[
  {{
    "insight_text": "...",
    "source_article_ids": ["exact-uuid-from-list", "exact-uuid-from-list"],
    "filters_spanned": ["filter1", "filter2"]
  }}
]

IMPORTANT: source_article_ids MUST contain exact UUIDs from the article list above, not sequential numbers.
Return ONLY the JSON array."""

        try:
            claude_client = get_claude_client()
            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=800,
                temperature=0.5,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = response.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()

            insights = json.loads(response_text)
            if isinstance(insights, list):
                # Validate article IDs — filter out any that aren't in our actual list
                valid_ids = {a['id'] for a in article_details}
                for insight in insights:
                    if 'source_article_ids' in insight:
                        insight['source_article_ids'] = [
                            aid for aid in insight['source_article_ids']
                            if aid in valid_ids
                        ]
                return insights[:5]

        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Failed to extract system insights: {e}")

        # Fallback insights
        return [
            {
                "insight_text": f"This week's reading covered {len(articles)} articles across multiple domains, revealing opportunities for cross-disciplinary thinking.",
                "source_article_ids": [a["id"] for a in articles[:3]],
                "filters_spanned": list(set(a.get("filter_context", "core") for a in articles[:3])),
            }
        ]

    # ── Step 8: Commitment ────────────────────────────────────────────

    @staticmethod
    def store_commitment(
        recap_journey_id, commitment_text: str, db: Session
    ) -> Dict:
        """Store the user's 'One Commitment' for the week."""
        try:
            journey_uuid = recap_journey_id if isinstance(recap_journey_id, uuid.UUID) else uuid.UUID(str(recap_journey_id))
            journey = db.query(RecapJourney).filter(RecapJourney.id == journey_uuid).first()
            if not journey:
                return {"error": "Recap journey not found"}

            journey.commitment_text = commitment_text.strip()
            journey.status = 'completed'
            journey.stage_progress = 4
            journey.completed_at = datetime.utcnow()

            # Mark recap_completed on DailyMetric for ring system
            today = date.today()
            daily = db.query(DailyMetric).filter(
                DailyMetric.user_id == journey.user_id,
                DailyMetric.metric_date == today,
            ).first()
            if daily:
                daily.recap_completed = True
            else:
                daily = DailyMetric(
                    user_id=journey.user_id,
                    metric_date=today,
                    recap_completed=True,
                )
                db.add(daily)

            db.commit()

            logger.info(f"Stored commitment for journey {recap_journey_id}, marked completed")
            return {"saved": True}

        except Exception as e:
            logger.error(f"Failed to store commitment: {e}")
            db.rollback()
            return {"error": "Failed to store commitment"}

    @staticmethod
    def get_current_commitment(user_id, db: Session) -> Optional[Dict]:
        """Get the most recent commitment for display on Home screen."""
        try:
            user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
            journey = db.query(RecapJourney).filter(
                and_(
                    RecapJourney.user_id == user_uuid,
                    RecapJourney.commitment_text.isnot(None),
                )
            ).order_by(RecapJourney.week_start.desc()).first()

            if not journey or not journey.commitment_text:
                return None

            return {
                "commitment_text": journey.commitment_text,
                "week_start": journey.week_start.isoformat(),
                "week_end": journey.week_end.isoformat(),
                "journey_id": str(journey.id),
            }

        except Exception as e:
            logger.error(f"Failed to get commitment: {e}")
            return None

    # ── Journey Lifecycle ─────────────────────────────────────────────

    @staticmethod
    def start_journey(user_id, db: Session, force_new: bool = False) -> Dict:
        """
        Create (or resume) a Recap Journey record for the current week.

        IMPORTANT: Does NOT compute the weekly snapshot. The snapshot is built
        lazily on the first Stage 1 fetch (see ensure_snapshot) so that mid-week
        activity between journey creation and Recap open is captured.

        1. Compute week boundaries (Monday-Sunday)
        2. Check for existing journey
        3. Compute lightweight activity stats (counts only) for UI display
        4. Create RecapJourney record with snapshot_data=None

        Pass force_new=True to start a fresh recap even if one is completed.

        Returns dict with journey details or error.
        """
        user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))

        # GUR-232: recap is decoupled from the calendar week — it covers SINCE
        # THE LAST COMPLETED RECAP (founder). The window anchor (`week_start`,
        # repurposed as the period start) = the date of the last completed
        # recap; first-ever recap covers the trailing 7 days so it's never
        # empty. `week_end` is always today, so the snapshot/stats/Q&A (all of
        # which key off the journey's week_start/week_end) cover [since, now].
        today = date.today()
        last_completed = db.query(RecapJourney).filter(
            and_(
                RecapJourney.user_id == user_uuid,
                RecapJourney.status == 'completed',
                RecapJourney.completed_at.isnot(None),
            )
        ).order_by(RecapJourney.completed_at.desc()).first()
        if last_completed and last_completed.completed_at:
            period_start = last_completed.completed_at.date()
        else:
            period_start = today - timedelta(days=7)
        week_start = period_start
        week_end = today

        # Resume the latest ACTIVE (non-completed) journey if one exists — the
        # resume must NOT key off week_start (the anchor drifts day-to-day while
        # nothing is completed, GUR-232). Refresh its window end to today so
        # activity since creation is captured.
        active = db.query(RecapJourney).filter(
            and_(
                RecapJourney.user_id == user_uuid,
                RecapJourney.status != 'completed',
            )
        ).order_by(RecapJourney.created_at.desc()).first()
        if active and not force_new:
            active.week_end = today
            db.commit()
            db.refresh(active)
            return {
                "journey_id": str(active.id),
                "week_start": active.week_start.isoformat(),
                "week_end": active.week_end.isoformat(),
                "tier": active.tier,
                "status": active.status,
                "stage_progress": active.stage_progress,
                "resumed": True,
            }

        # No active journey (or force_new): we need a fresh recap for the
        # [period_start, today] window. The (user_id, week_start) unique index
        # means a journey may already sit at this anchor (e.g. a same-day
        # re-recap, or a prior completed recap that started here) — reset and
        # reuse that slot instead of inserting a duplicate.
        existing = db.query(RecapJourney).filter(
            and_(
                RecapJourney.user_id == user_uuid,
                RecapJourney.week_start == week_start,
            )
        ).order_by(RecapJourney.created_at.desc()).first()
        if existing:
            # A journey already sits at this anchor — reset it to a fresh recap
            # for the [period_start, today] window (covers force_new and the
            # ordinary "new recap since the last completed one" case). Resume of
            # an in-progress journey was already handled above.
            logger.info(f"Recap: resetting journey {existing.id} at anchor {week_start} for user {user_id}")
            db.query(KeyInsight).filter(
                KeyInsight.recap_journey_id == existing.id
            ).delete()
            activity_stats = RecapJourneyService._compute_activity_stats(
                user_uuid, week_start, week_end, db
            )
            existing.week_end = today
            existing.status = 'not_started'
            existing.stage_progress = 0
            existing.snapshot_data = None  # Force fresh compute on first Stage 1 fetch
            existing.guided_questions = None
            existing.guided_responses = None
            existing.socratic_exchanges = None
            existing.commitment_text = None
            existing.socratic_exchange_count = 0
            existing.synthesis_text = None
            existing.audio_url = None
            existing.audio_script = None
            existing.audio_duration_seconds = None
            existing.audio_status = None
            existing.audio_error = None
            existing.completed_at = None
            existing.articles_read_count = activity_stats["articles_read_count"]
            existing.articles_saved_count = activity_stats["articles_saved_count"]
            existing.qa_count = activity_stats["qa_count"]
            existing.filters_explored_count = activity_stats["filters_explored_count"]
            existing.total_time_minutes = activity_stats["total_time_minutes"]
            db.commit()
            db.refresh(existing)
            return {
                "journey_id": str(existing.id),
                "week_start": week_start.isoformat(),
                "week_end": week_end.isoformat(),
                "tier": existing.tier,
                "status": existing.status,
                "stage_progress": existing.stage_progress,
                "activity_summary": activity_stats,
                "resumed": False,
            }

        # Cheap activity stats for the response (counts only — no snapshot).
        activity_stats = RecapJourneyService._compute_activity_stats(
            user_uuid, week_start, week_end, db
        )

        # Create journey record with NO snapshot — it's computed lazily at Stage 1.
        journey = RecapJourney(
            user_id=user_uuid,
            week_start=week_start,
            week_end=week_end,
            status='not_started',
            stage_progress=0,
            snapshot_data=None,
            articles_read_count=activity_stats["articles_read_count"],
            articles_saved_count=activity_stats["articles_saved_count"],
            qa_count=activity_stats["qa_count"],
            filters_explored_count=activity_stats["filters_explored_count"],
            total_time_minutes=activity_stats["total_time_minutes"],
        )
        db.add(journey)
        db.commit()
        db.refresh(journey)

        logger.info(
            f"Started recap journey {journey.id} for user {user_id} "
            f"(snapshot deferred to first Stage 1 fetch)"
        )

        return {
            "journey_id": str(journey.id),
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "tier": journey.tier,
            "status": journey.status,
            "stage_progress": journey.stage_progress,
            "activity_summary": activity_stats,
            "resumed": False,
        }

    # ── Step 6: Stage 3 — Socratic Deep Dive (Recap Mode) ───────────

    @staticmethod
    def socratic_exchange(
        journey_id, user_message: str, db: Session
    ) -> Dict:
        """
        Process one Socratic exchange in the recap journey.

        Key differences from article-level Socratic chat:
          - Context: ALL articles from the week + Q&As + user's Stage 2 answers
          - Goal: Cross-article synthesis and insight generation
          - Insight extraction: After each user response, evaluates for novel insights

        Returns:
        {
          response: str,
          follow_up_prompt: str,
          insight_extracted: { insight_text, source_article_ids, filters_spanned } | null,
          exchange_count: int,
          is_concluded: bool,
        }
        """
        try:
            journey_uuid = journey_id if isinstance(journey_id, uuid.UUID) else uuid.UUID(str(journey_id))
            journey = db.query(RecapJourney).filter(RecapJourney.id == journey_uuid).first()
            if not journey:
                return {"error": "Recap journey not found"}

            snapshot = journey.snapshot_data or {}
            articles = snapshot.get("articles_engaged", [])
            qa_highlights = snapshot.get("qa_highlights", [])
            guided_responses = journey.guided_responses or {}

            # Build conversation history
            exchanges = journey.socratic_exchanges or []

            # ── Build system prompt (cross-article weekly context) ──
            articles_context = "\n".join([
                f"- \"{a['title']}\" [id:{a.get('id', 'unknown')}] ({a.get('filter_context', 'core')}, {a.get('time_spent_minutes', 0)}m)"
                for a in articles[:12]
            ])

            # Include spotlight interactions and user highlights in context
            spotlight_ctx = ""
            spotlight_data = snapshot.get("spotlight_highlights", [])
            if spotlight_data:
                spotlight_ctx = "\nQuotes/links the user engaged with:\n" + "\n".join([
                    f"- {s.get('type', 'tap')}: \"{s.get('content', '')[:100]}\" (from {s.get('article_title', 'unknown')})"
                    for s in spotlight_data[:8]
                ])

            highlights_ctx = ""
            user_hl = snapshot.get("user_highlights", [])
            if user_hl:
                highlights_ctx = "\nPassages the user highlighted/noted:\n" + "\n".join([
                    f"- \"{h.get('highlighted_text', '')[:80]}\" (from {h.get('article_title', 'unknown')})"
                    + (f" — Note: {h['note'][:60]}" if h.get('note') else "")
                    for h in user_hl[:8]
                ])

            qa_context = ""
            if qa_highlights:
                qa_context = "\nQ&A exchanges this week:\n" + "\n".join([
                    f"- Q: {q['question'][:80]} | A: {q['answer_snippet'][:80]}"
                    for q in qa_highlights[:4]
                ])

            guided_context = ""
            if guided_responses:
                questions = journey.guided_questions or []
                guided_context = "\nUser's reflection answers:\n"
                for idx_str, answer in guided_responses.items():
                    idx = int(idx_str)
                    if idx < len(questions):
                        q = questions[idx]
                        guided_context += f"- [{q.get('type', 'reflection')}] Q: {q.get('text', '')[:80]}\n  A: {str(answer)[:150]}\n"

            # Anchor interactions for priority focus
            anchors_ctx = ""
            anchor_data = snapshot.get("anchor_interactions", [])
            if anchor_data:
                anchors_parts = []
                for i, a in enumerate(anchor_data[:4]):
                    parts = [f"ANCHOR {i+1}: [id:{a['article_id']}] \"{a['article_title']}\" (score: {a['composite_score']})"]
                    if a.get("highlights"):
                        parts.append(f"  Highlighted: {', '.join(h['text'][:60] for h in a['highlights'][:2])}")
                    if a.get("qa_questions"):
                        parts.append(f"  Asked: {a['qa_questions'][0][:60]}")
                    anchors_parts.append("\n".join(parts))
                anchors_ctx = "\n\nUSER'S DEEPEST ENGAGEMENTS (prioritize these):\n" + "\n".join(anchors_parts)

            # Get user profile for personalization
            from app.models.user import UserProfile
            profile = db.query(UserProfile).filter(UserProfile.user_id == journey.user_id).first()
            user_context = ""
            if profile:
                user_context = f"\nUser's industry: {profile.core_industry}\nUser's specializations: {', '.join(profile.specializations or [])}"

            system_prompt = f"""You are Guru — a sharp, insightful mentor conducting a weekly learning synthesis dialogue.

This is a WEEKLY RECAP conversation, not about a single article. Your goal: help the reader see CONNECTIONS across what they read this week, extract novel insights, and deepen their understanding.

PRIMARY SIGNAL — the questions the user asked and passages they highlighted
are what you should build the dialogue around. Reading time is background.
{qa_context}
{highlights_ctx}
{anchors_ctx}

SECONDARY CONTEXT:
{articles_context}
{spotlight_ctx}
{guided_context}
{user_context}

How to conduct this dialogue:
1. LEAD with what the user asked or highlighted. Quote their exact highlighted words back to them verbatim (in quotes) when you probe — "You underlined 'X' in [Article A]. What pulled you to that line?"
2. If the user asked a Q&A this week, extend it — "You asked '{{their question}}' — that question implies something about Y. Do you see it?"
3. Find threads that connect multiple articles — "Did you notice that both [Article A] and [Article B] point to..."
4. Challenge assumptions — "[Article C] suggests the opposite of what you said. How do you reconcile?"
5. Draw out implications for their work — specific, actionable, connected to their industry
6. When the user says something insightful, acknowledge it naturally and build on it

ARTICLE REFERENCES:
When you mention a specific article, include a reference tag like this: [[Article: "title" | id:UUID]]
This allows the UI to render tappable article links. Use the article IDs provided above.

Voice:
- Conversational, like a brilliant colleague who gets excited about finding patterns
- Short paragraphs — let ideas breathe
- Specific beats generic (quote their highlights VERBATIM, reference their actual questions, use real article titles)
- ONE question per response — let each exchange go deep before pivoting

NEVER DO THIS:
- Don't use headers or labels ("Key insight:", "Question:")
- Don't announce what you're doing
- Don't lecture — this is a dialogue
- Don't ask multiple questions — one punchy question to close
- Don't paraphrase a highlight when you could quote it directly

After 4-5 exchanges, naturally wrap up with a synthesis of the insights generated."""

            # Format messages for Claude
            messages = []
            for ex in exchanges:
                messages.append({
                    "role": ex["role"],
                    "content": ex["content"],
                })

            # If no prior exchanges, generate opening prompt
            if not messages:
                opening = RecapJourneyService._generate_opening_prompt(
                    articles, guided_responses, journey.guided_questions, snapshot
                )

                # Handle __open__ sentinel: return opening prompt without LLM call
                if user_message.strip() == '__open__':
                    exchanges.append({
                        "role": "assistant",
                        "content": opening,
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                    journey.socratic_exchanges = exchanges
                    journey.socratic_exchange_count = 0
                    db.commit()
                    return {
                        "response": opening,
                        "follow_up_prompt": None,
                        "insight_extracted": None,
                        "exchange_count": 0,
                        "is_concluded": False,
                    }

                messages.append({"role": "assistant", "content": opening})
                exchanges.append({
                    "role": "assistant",
                    "content": opening,
                    "timestamp": datetime.utcnow().isoformat(),
                })

            # Add user message
            messages.append({"role": "user", "content": user_message})
            exchanges.append({
                "role": "user",
                "content": user_message,
                "timestamp": datetime.utcnow().isoformat(),
            })

            exchange_count = sum(1 for e in exchanges if e["role"] == "user")
            is_final = exchange_count >= 5

            # Adjust prompt for final exchange
            if is_final:
                messages[-1]["content"] += "\n\n[System note: This is the final exchange. Wrap up the dialogue naturally with a synthesis of the key insights generated during this conversation.]"

            # Get Claude response
            claude_client = get_claude_client()
            response = claude_client.client.messages.create(
                model=settings.CLAUDE_SONNET_MODEL,
                max_tokens=600,
                system=system_prompt,
                messages=messages,
            )
            assistant_response = response.content[0].text.strip()

            # Add assistant response to history
            exchanges.append({
                "role": "assistant",
                "content": assistant_response,
                "timestamp": datetime.utcnow().isoformat(),
            })

            # ── Insight extraction ──
            # After user's response, evaluate if it contains a novel insight
            insight_extracted = None
            if len(user_message.strip()) > 30:  # Only evaluate substantive responses
                insight_extracted = RecapJourneyService._extract_insight_from_exchange(
                    user_message, assistant_response, articles, journey, db
                )

            # ── Generate follow-up prompt ──
            follow_up = ""
            if not is_final:
                try:
                    followup_response = claude_client.client.messages.create(
                        model=settings.CLAUDE_HAIKU_MODEL,
                        max_tokens=80,
                        messages=[{
                            "role": "user",
                            "content": f"Based on this dialogue exchange, generate ONE short follow-up question (under 50 chars) that the user might want to explore next:\n\nUser said: {user_message[:200]}\nGuru responded: {assistant_response[:300]}\n\nReturn ONLY the question, nothing else.",
                        }],
                    )
                    follow_up = followup_response.content[0].text.strip()
                except Exception:
                    follow_up = "What connections do you see?"

            # ── Persist state ──
            journey.socratic_exchanges = exchanges
            journey.socratic_exchange_count = exchange_count
            flag_modified(journey, 'socratic_exchanges')
            if journey.status == 'stage_2':
                journey.status = 'stage_3'
            db.commit()

            return {
                "response": assistant_response,
                "follow_up_prompt": follow_up,
                "insight_extracted": insight_extracted,
                "exchange_count": exchange_count,
                "is_concluded": is_final,
            }

        except Exception as e:
            logger.error(f"Socratic exchange failed: {e}")
            db.rollback()
            return {"error": f"Socratic exchange failed: {str(e)}"}

    @staticmethod
    def _generate_opening_prompt(
        articles: List[Dict], guided_responses: Dict, guided_questions: List,
        snapshot: Optional[Dict] = None
    ) -> str:
        """Generate the opening Socratic prompt — leads with Q&A + annotations."""
        if not articles:
            return "Tell me about something interesting you read this week."

        snapshot = snapshot or {}
        qa_highlights = snapshot.get("qa_highlights", [])
        user_highlights = snapshot.get("user_highlights", [])

        # ── PRIMARY: If the user asked Q&A, open from their exact question ──
        if qa_highlights:
            first_q = qa_highlights[0]
            q_text = (first_q.get("question") or "").strip()
            q_article = first_q.get("article_title") or "your reading"
            if q_text:
                if len(qa_highlights) >= 2:
                    return (
                        f"You asked some sharp things this week. One that stuck out: "
                        f"\"{q_text[:160]}\" — from \"{q_article}\". "
                        f"Where did that question actually come from?"
                    )
                return (
                    f"You asked: \"{q_text[:160]}\" while reading \"{q_article}\". "
                    f"What partial answer are you sitting with now?"
                )

        # ── SECONDARY: Lead from a verbatim highlight if the user annotated ──
        if user_highlights:
            first_h = user_highlights[0]
            hl_text = (first_h.get("highlighted_text") or "").strip()
            hl_article = first_h.get("article_title") or "your reading"
            if hl_text:
                note = first_h.get("note")
                if note:
                    return (
                        f"You underlined this in \"{hl_article}\": \"{hl_text[:160]}\" — "
                        f"and wrote alongside it: \"{note[:120]}\". Unpack that for me."
                    )
                return (
                    f"You underlined this in \"{hl_article}\": \"{hl_text[:160]}\". "
                    f"What pulled you to that line?"
                )

        # Fallback: articles marked with qa engagement_type
        qa_articles = [a for a in articles if a.get("engagement_type") == "qa_asked"]
        top_article = articles[0]["title"] if articles else "your reading"

        if qa_articles:
            qa_title = qa_articles[0]["title"]
            if len(qa_articles) > 1:
                return (
                    f"You asked some sharp questions this week — especially around \"{qa_title}\" "
                    f"and \"{qa_articles[1]['title']}\". "
                    f"What was it about those pieces that sparked your curiosity?"
                )
            return (
                f"I noticed you dug deep into \"{qa_title}\" this week — you were asking questions "
                f"and really engaging with the material. What was pulling you in?"
            )

        if guided_responses and guided_questions:
            for idx_str, answer in guided_responses.items():
                if answer and len(str(answer)) > 20:
                    return (
                        f"I noticed you spent the most time with \"{top_article}\" this week. "
                        f"In your reflections, you mentioned something interesting. "
                        f"What struck you most about the themes you encountered across your reading?"
                    )

        if len(articles) >= 3:
            return (
                f"You explored {len(articles)} articles this week, from \"{articles[0]['title']}\" "
                f"to \"{articles[-1]['title']}\". That's quite a range. "
                f"Did any unexpected connections jump out at you?"
            )

        return (
            f"Let's dive into your week. You spent time with \"{top_article}\". "
            f"What's the one thing from your reading that keeps rattling around in your head?"
        )

    @staticmethod
    def _extract_insight_from_exchange(
        user_message: str, assistant_response: str,
        articles: List[Dict], journey, db: Session
    ) -> Optional[Dict]:
        """
        Evaluate whether the user's message contains a novel insight.
        If yes, create a KeyInsight record and return its data.
        """
        try:
            claude_client = get_claude_client()
            response = claude_client.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=200,
                messages=[{
                    "role": "user",
                    "content": f"""Does this user response contain a novel, substantive insight worth capturing?

User said: "{user_message}"

Criteria for a capturable insight:
- Makes a non-obvious connection between topics
- Articulates an original perspective or realization
- Identifies a pattern, principle, or actionable takeaway
- Is specific (not just "I found it interesting")

If YES, extract the insight as a concise 1-2 sentence statement.
If NO, respond with just "NO".

Format if YES:
INSIGHT: [the concise insight statement]""",
                }],
            )

            resp_text = response.content[0].text.strip()
            if resp_text.startswith("NO") or "INSIGHT:" not in resp_text:
                return None

            insight_text = resp_text.split("INSIGHT:")[1].strip()
            if len(insight_text) < 10:
                return None

            # Determine which articles contributed
            source_article_ids = []
            filters_spanned = set()
            for a in articles[:5]:
                # Simple check: if article title words appear in the exchange
                title_words = set(a.get("title", "").lower().split())
                exchange_words = set((user_message + " " + assistant_response).lower().split())
                if len(title_words & exchange_words) >= 2:
                    source_article_ids.append(a["id"])
                    fc = a.get("filter_context", "core")
                    if fc:
                        filters_spanned.add(fc)

            if not source_article_ids and articles:
                source_article_ids = [articles[0]["id"]]

            # Create KeyInsight record
            exchange_ref = str(journey.socratic_exchange_count or 0)
            insight = KeyInsight(
                user_id=journey.user_id,
                recap_journey_id=journey.id,
                insight_text=insight_text,
                source="user_reflection",
                source_article_ids=source_article_ids,
                filters_spanned=list(filters_spanned),
                socratic_exchange_ref=exchange_ref,
                week_start=journey.week_start,
            )
            db.add(insight)
            db.flush()  # Get the ID without committing

            logger.info(f"Captured insight from Socratic exchange: {insight_text[:50]}...")

            return {
                "id": str(insight.id),
                "insight_text": insight_text,
                "source": "user_reflection",
                "source_article_ids": source_article_ids,
                "filters_spanned": list(filters_spanned),
            }

        except Exception as e:
            logger.warning(f"Insight extraction failed: {e}")
            return None

    @staticmethod
    def advance_stage(journey_id, db: Session) -> Dict:
        """Advance the journey to the next stage."""
        try:
            journey_uuid = journey_id if isinstance(journey_id, uuid.UUID) else uuid.UUID(str(journey_id))
            journey = db.query(RecapJourney).filter(RecapJourney.id == journey_uuid).first()
            if not journey:
                return {"error": "Journey not found"}

            stage_flow = {
                'not_started': ('stage_1', 1),
                'stage_1': ('stage_2', 2),
                'stage_2': ('stage_3', 3),
                'stage_3': ('commitment', 3),
                'commitment': ('stage_4', 4),
                'stage_4': ('completed', 4),
            }

            current = journey.status
            if current in stage_flow:
                next_status, next_progress = stage_flow[current]
                journey.status = next_status
                journey.stage_progress = next_progress
                if next_status == 'completed':
                    journey.completed_at = datetime.utcnow()
                    # Update DailyMetric so ring system reflects completion
                    today = date.today()
                    daily = db.query(DailyMetric).filter(
                        DailyMetric.user_id == journey.user_id,
                        DailyMetric.metric_date == today,
                    ).first()
                    if daily:
                        daily.recap_completed = True
                    else:
                        daily = DailyMetric(
                            user_id=journey.user_id,
                            metric_date=today,
                            recap_completed=True,
                        )
                        db.add(daily)
                db.commit()

                # Warm-up: pre-generate audio script when entering commitment
                # and trigger full audio generation when entering stage_4
                if next_status in ('commitment', 'stage_4'):
                    try:
                        from app.services.audio_recap_service import AudioRecapService
                        if next_status == 'stage_4':
                            AudioRecapService.trigger_audio_generation(str(journey.id), db)
                            logger.info(f"Auto-triggered audio generation for journey {journey.id}")
                        else:
                            # Warm-up: start script-only generation early
                            AudioRecapService.warm_up_script(str(journey.id), db)
                            logger.info(f"Warm-up script generation started for journey {journey.id}")
                    except Exception as e:
                        logger.warning(f"Failed to auto-trigger audio: {e}")

                return {"status": journey.status, "stage_progress": journey.stage_progress}
            else:
                return {"error": f"Cannot advance from status '{current}'"}

        except Exception as e:
            logger.error(f"Failed to advance stage: {e}")
            db.rollback()
            return {"error": "Failed to advance stage"}
