from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey, Index, Date, JSON, Boolean, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


# ── Legacy model — kept for backward compatibility with existing recap sessions ──

class RecapSession(Base):
    __tablename__ = "recap_sessions"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    week_start = Column(DateTime(timezone=True), nullable=False)
    week_end = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(20), default='in_progress')  # 'in_progress', 'completed'

    # 4 selected questions from week
    question_1_category = Column(String(100), nullable=True)
    question_2_category = Column(String(100), nullable=True)
    question_3_category = Column(String(100), nullable=True)
    question_4_category = Column(String(100), nullable=True)

    # Store selected Q&A exchange IDs
    selected_qa_ids = Column(JSON, nullable=True)  # List of QA exchange IDs

    # Synthesis
    synthesis_text = Column(Text, nullable=True)
    synthesis_insights = Column(JSON, nullable=True)  # List of key insights

    # User responses
    user_responses = Column(JSON, nullable=True)  # {question_order: response}

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="recap_sessions")
    publishes = relationship("RecapSessionPublish", back_populates="recap_session")

    # Indexes and constraints
    __table_args__ = (
        Index('idx_user_week_start', 'user_id', 'week_start', unique=True),
    )


class RecapSessionPublish(Base):
    __tablename__ = "recap_session_publishes"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    recap_session_id = Column(UUID(), ForeignKey("recap_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    share_key = Column(String(32), unique=True, nullable=False, index=True)
    shared_at = Column(DateTime(timezone=True), server_default=func.now())
    view_count = Column(Integer, default=0)

    # Relationships
    recap_session = relationship("RecapSession", back_populates="publishes")

    def __repr__(self):
        return f"<RecapSessionPublish(share_key='{self.share_key}', views={self.view_count})>"


# ── New models for the 4-stage Recap Journey ─────────────────────────

class RecapJourney(Base):
    """
    A weekly Recap Journey that guides the user through 4 stages:
      Stage 1: Glass Memory Wall (weekly snapshot)
      Stage 2: Guided Questions (typed reflection prompts)
      Stage 3: Socratic Deep Dive (cross-article dialogue + insight extraction)
      Stage 4: Audio Recap (Phase 2 — NotebookLM-style two-host discussion)

    Plus a Commitment screen between Stage 3 and Stage 4.
    """
    __tablename__ = "recap_journeys"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Week boundaries
    week_start = Column(Date, nullable=False)
    week_end = Column(Date, nullable=False)

    # Tier: determines which stages are available
    # 'lite'     -> 1-3 articles: Stages 1-2 only (2 questions)
    # 'standard' -> 4-7 articles: Stages 1-3 (4-5 questions + Socratic)
    # 'full'     -> 8+ articles:  All stages including audio eligibility
    tier = Column(String(20), nullable=False, default='standard')

    # Overall journey status
    # not_started -> stage_1 -> stage_2 -> stage_3 -> commitment -> stage_4 -> completed
    status = Column(String(20), nullable=False, default='not_started')

    # Tracks which stage the user is currently on (0=not started, 1-4)
    stage_progress = Column(Integer, nullable=False, default=0)

    # ── Stage 1: Weekly Snapshot (pre-computed) ───────────────────
    # JSON blob containing articles_engaged, filters_explored, qa_highlights,
    # topic_clusters, reading_pattern — see recap_service.generate_weekly_snapshot()
    snapshot_data = Column(JSON, nullable=True)

    # ── Stage 2: Guided Questions ─────────────────────────────────
    # List of question objects:
    #   { type, text, referenced_articles, response_format, chips }
    guided_questions = Column(JSON, nullable=True)
    # User's answers keyed by question index:
    #   { "0": "answer text", "1": "selected_chip_id", ... }
    guided_responses = Column(JSON, nullable=True)

    # ── Stage 3: Socratic Deep Dive ───────────────────────────────
    # Full dialogue history:
    #   [ { role: 'system'|'user', content: str, timestamp: str, insight_id?: str }, ... ]
    socratic_exchanges = Column(JSON, nullable=True)
    # Number of Socratic exchanges completed
    socratic_exchange_count = Column(Integer, default=0)

    # ── Commitment ────────────────────────────────────────────────
    # "One thing you'll do differently next week"
    commitment_text = Column(Text, nullable=True)

    # ── Stage 4: Audio Recap (Phase 2) ────────────────────────────
    audio_url = Column(String(500), nullable=True)
    audio_script = Column(Text, nullable=True)
    audio_duration_seconds = Column(Integer, nullable=True)
    audio_status = Column(String(30), nullable=True, default=None)
    # Values: None | 'generating_script' | 'generating_audio' | 'ready' | 'failed'
    audio_error = Column(Text, nullable=True)

    # ── Synthesis (generated after Stage 3 or commitment) ─────────
    synthesis_text = Column(Text, nullable=True)
    synthesis_insights = Column(JSON, nullable=True)  # List of insight summaries

    # ── Activity metrics used for tier calculation ────────────────
    articles_read_count = Column(Integer, default=0)
    articles_saved_count = Column(Integer, default=0)
    qa_count = Column(Integer, default=0)
    filters_explored_count = Column(Integer, default=0)
    total_time_minutes = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="recap_journeys")
    key_insights = relationship("KeyInsight", back_populates="recap_journey", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_journey_user_week', 'user_id', 'week_start', unique=True),
    )

    def __repr__(self):
        return f"<RecapJourney(user={self.user_id}, week={self.week_start}, tier={self.tier}, status={self.status})>"


class KeyInsight(Base):
    """
    A captured insight from the Recap journey.

    Two-source pipeline:
      1. 'user_reflection'   — extracted from Socratic dialogue when user articulates a novel insight
      2. 'system_extracted'  — generated by Claude from article analysis as fallback/supplement

    Key Insights are the core output of Recap — they persist as the user's learning journal.
    """
    __tablename__ = "key_insights"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recap_journey_id = Column(UUID(), ForeignKey("recap_journeys.id", ondelete="CASCADE"), nullable=False, index=True)

    # The insight text itself
    insight_text = Column(Text, nullable=False)

    # Source classification
    # 'user_reflection'  — user articulated this during Socratic dialogue
    # 'system_extracted' — system generated from article analysis
    source = Column(String(30), nullable=False, default='system_extracted')

    # Which articles contributed to this insight (list of article UUID strings)
    source_article_ids = Column(JSON, nullable=True)

    # Which filter contexts this insight spans (e.g., ["specialization:F&B", "interest:Technology"])
    filters_spanned = Column(JSON, nullable=True)

    # Reference to specific Socratic exchange that produced it (for user_reflection source)
    # Format: exchange index number as string (e.g., "3" for the 4th exchange)
    socratic_exchange_ref = Column(String(50), nullable=True)

    # Week reference for easy querying
    week_start = Column(Date, nullable=False)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="key_insights")
    recap_journey = relationship("RecapJourney", back_populates="key_insights")

    __table_args__ = (
        Index('idx_insight_user_week', 'user_id', 'week_start'),
    )

    def __repr__(self):
        return f"<KeyInsight(user={self.user_id}, source={self.source}, text={self.insight_text[:50]}...)>"
