from sqlalchemy import Column, String, DateTime, Integer, Float, ForeignKey, Index, JSON, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class Storyboard(Base):
    __tablename__ = "storyboards"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    industry = Column(String(50), nullable=False, index=True)
    specializations = Column(JSON)
    filter_context = Column(String(255), nullable=True, index=True)
    headline_article_id = Column(UUID(), ForeignKey("articles.id"), nullable=False)
    summary = Column(String(1000))
    personal_prompt = Column(Text, nullable=True)
    cluster_narrative = Column(Text, nullable=True)
    ranking_score = Column(Float, nullable=True, index=True)  # Composite quality ranking score
    base_cache_key = Column(String(500), nullable=True, index=True)  # Canonical filter key for base storyboard sharing
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    headline_article = relationship("Article", foreign_keys=[headline_article_id])
    storyboard_articles = relationship("StoryboardArticle", back_populates="storyboard")
    not_relevant_users = relationship("UserNotRelevant", back_populates="storyboard")


class UserStoryboardPrompt(Base):
    """Per-user personalized prompts for shared base storyboards.

    Base storyboards are generated once per filter context (summary, theme, narrative).
    Personal prompts are generated per-user via a single Haiku call.
    """
    __tablename__ = "user_storyboard_prompts"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    storyboard_id = Column(UUID(), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    personal_prompt = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_user_storyboard_prompt_lookup', 'user_id', 'storyboard_id', unique=True),
    )


class StoryboardArticle(Base):
    __tablename__ = "storyboard_articles"
    
    storyboard_id = Column(UUID(), ForeignKey("storyboards.id", ondelete="CASCADE"), primary_key=True)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    rank = Column(Integer, nullable=False)  # Order within storyboard
    
    # Relationships
    storyboard = relationship("Storyboard", back_populates="storyboard_articles")
    article = relationship("Article", back_populates="storyboard_articles")
    
    # Indexes
    __table_args__ = (
        Index('idx_storyboard_article_id', 'article_id'),
    )
