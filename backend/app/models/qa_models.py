"""
Database models for Q&A exchanges and interactions
"""
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
from app.db.types import UUID
import uuid


class QAExchange(Base):
    """
    Stores question-answer exchanges between users and articles.
    Supports both direct (one-shot) Q&A and multi-turn Socratic conversations.
    """
    __tablename__ = "qa_exchanges"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    model_used = Column(String(50), nullable=False)  # haiku, sonnet, opus
    conversation_id = Column(UUID(), nullable=True, index=True)  # Groups multi-turn threads
    exchange_type = Column(String(20), default='direct')  # 'direct' | 'socratic' | 'annotation'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="qa_exchanges")
    article = relationship("Article", back_populates="qa_exchanges")
    
    def __repr__(self):
        return f"<QAExchange(user_id='{self.user_id}', article_id='{self.article_id}', model='{self.model_used}')>"
