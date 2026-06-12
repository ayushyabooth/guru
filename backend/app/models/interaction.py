from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class UserSavedArticle(Base):
    __tablename__ = "user_saved_articles"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True)
    saved_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="saved_articles")
    article = relationship("Article", back_populates="saved_by_users")
    
    # Indexes and constraints
    # idx_user_saved_at serves GET /saved-articles (WHERE user_id ORDER BY saved_at DESC).
    # NOTE: create_all() will NOT add new indexes to an existing table; apply manually:
    #   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_saved_at ON user_saved_articles (user_id, saved_at DESC);
    __table_args__ = (
        Index('idx_user_article', 'user_id', 'article_id', unique=True),
        Index('idx_user_saved_at', 'user_id', 'saved_at'),
    )


class UserNotRelevant(Base):
    __tablename__ = "user_not_relevant"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    storyboard_id = Column(UUID(), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    filter_context = Column(String(200), nullable=False, index=True)  # Filter context for this not-relevant marking
    marked_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="not_relevant_storyboards")
    storyboard = relationship("Storyboard", back_populates="not_relevant_users")
    
    # Indexes and constraints
    __table_args__ = (
        Index('idx_user_storyboard_filter', 'user_id', 'storyboard_id', 'filter_context', unique=True),
    )


class UserInteraction(Base):
    """Tracks user interactions: spotlight taps, link opens, highlights, annotation expands."""
    __tablename__ = "user_interactions"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    interaction_type = Column(String(30), nullable=False, index=True)  # 'spotlight_tap', 'link_open', 'highlight', 'annotation_expand'
    content = Column(Text, nullable=True)  # The quote text, link URL, highlighted text, etc.
    metadata_json = Column(JSON, nullable=True)  # Extra context (paragraph index, position, etc.)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserAnnotation(Base):
    """User highlights and notes on articles."""
    __tablename__ = "user_annotations"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True)
    highlighted_text = Column(Text, nullable=False)
    note_text = Column(Text, nullable=True)
    color = Column(String(20), default='gold')
    paragraph_index = Column(Integer, nullable=True)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
