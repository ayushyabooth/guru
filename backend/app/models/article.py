from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text, Float, ForeignKey, Index, JSON
from sqlalchemy.orm import relationship, deferred
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class Article(Base):
    __tablename__ = "articles"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    url = Column(String(2048), unique=True, nullable=False, index=True)
    title = Column(String(500))
    source = Column(String(255))
    publish_date = Column(DateTime(timezone=True))
    raw_text = deferred(Column(Text))
    word_count = Column(Integer)
    is_paywalled = Column(Boolean, default=False)
    article_image_url = Column(String(2048), nullable=True, index=True)
    scrape_attempted = Column(Boolean, default=False)
    image_source = Column(String(50), nullable=True)
    inline_images = Column(JSON, nullable=True)
    # 3-Tier ingestion fields
    ingestion_tier = Column(String(30), nullable=True, index=True)  # 'tier1_expert', 'tier2_luminary', 'tier3_discovery'
    quality_score = Column(Float, nullable=True, index=True)  # 0.0-1.0
    luminary_id = Column(String(100), nullable=True)  # For Tier 2 (luminary) articles
    discovery_query = Column(String(500), nullable=True)  # For Tier 3 (discovery) articles
    content_hash = Column(String(64), nullable=True)  # SHA-256 for content dedup
    # Tagging fields (filter-driven clustering depends on these)
    industries = Column(JSON, nullable=True)  # e.g., ["Consumer"]
    specializations = Column(JSON, nullable=True)  # e.g., ["Food & Beverage"]
    # index=True: hot filter column — every storyboard build/rebuild filters
    # created_at >= cutoff, and startup cleanup filters created_at < cutoff.
    # NOTE: create_all() will NOT add this to an existing table; apply manually:
    #   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_articles_created_at ON articles (created_at);
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    expert_notes = relationship("ExpertNote", back_populates="article")
    storyboard_articles = relationship("StoryboardArticle", back_populates="article")
    saved_by_users = relationship("UserSavedArticle", back_populates="article")
    qa_exchanges = relationship("QAExchange", back_populates="article")
    annotations = relationship("ArticleAnnotation", back_populates="article", cascade="all, delete-orphan")


class ExpertNote(Base):
    __tablename__ = "expert_notes"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    expert_id = Column(UUID(), nullable=False, index=True)  # Expert user_id
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True)
    notes_text = Column(Text)
    priority = Column(String(20), default='Normal')  # 'Normal' or 'Essential'
    auto_generated = Column(Boolean, default=False)  # True if auto-detected as Essential by quality pipeline
    expert_industry = Column(String(50))
    expert_specializations = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    article = relationship("Article", back_populates="expert_notes")
    
    # Indexes and constraints
    __table_args__ = (
        Index('idx_expert_article', 'expert_id', 'article_id', unique=True),
    )


class ExpertLink(Base):
    """
    Legacy DB table (kept for schema/back-compat; the curated-links ingestion
    pathway that populated it has been decommissioned). No code writes to this
    table any more — it is retained only so existing rows and the schema survive.
    """
    __tablename__ = "expert_links"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    url = Column(String(2048), unique=True, nullable=False, index=True)
    title = Column(String(500))
    domain = Column(String(100))       # e.g. "Consumer", "Food & Beverage CPG"
    article_type = Column(String(100)) # e.g. "Insight/Op-ed", "News/Update"
    importance = Column(String(50))    # "Essential" or "Normal"
    tier = Column(String(30), default='tier1_expert')
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ArticleAnnotation(Base):
    """Inline annotations for Reader Mode - AI-generated or expert-provided"""
    __tablename__ = "article_annotations"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True)
    annotation_type = Column(String(30), nullable=False)  # 'reflection', 'expert_insight', 'leading_question'
    annotation_text = Column(Text, nullable=False)
    position_after_section = Column(Integer, nullable=False)  # Insert after this paragraph index
    generated_by = Column(String(20), default='ai')  # 'ai', 'expert', 'fallback'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    article = relationship("Article", back_populates="annotations")
    
    __table_args__ = (
        Index('idx_annotation_article', 'article_id'),
    )
