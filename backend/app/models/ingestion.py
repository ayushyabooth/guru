"""
Database models for ingestion state management
"""
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
from app.db.types import UUID
import uuid
import enum


class IngestionStatus(enum.Enum):
    """Enumeration for ingestion status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class IngestionState(Base):
    """
    Tracks the state of file ingestion to avoid re-processing unchanged files
    """
    __tablename__ = "ingestion_states"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    file_path = Column(String(500), nullable=False, index=True)
    file_hash = Column(String(64), nullable=False)  # SHA256 hash
    last_ingested_at = Column(DateTime, nullable=True)
    total_articles_ingested = Column(Integer, default=0)
    status = Column(Enum(IngestionStatus), default=IngestionStatus.PENDING, nullable=False)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationship to ingestion logs
    logs = relationship("IngestionLog", back_populates="ingestion_state", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<IngestionState(file_path='{self.file_path}', status='{self.status.value}', articles={self.total_articles_ingested})>"


class IngestionLog(Base):
    """
    Detailed log of ingestion actions for debugging and auditing
    """
    __tablename__ = "ingestion_logs"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ingestion_state_id = Column(String(36), ForeignKey("ingestion_states.id"), nullable=False)
    action = Column(String(50), nullable=False)  # 'parsed', 'created_article', 'updated_article', 'skipped'
    article_id = Column(UUID(), ForeignKey("articles.id"), nullable=True)
    details = Column(Text, nullable=True)  # Additional context about the action
    timestamp = Column(DateTime, default=func.now())
    
    # Relationships
    ingestion_state = relationship("IngestionState", back_populates="logs")
    article = relationship("Article", foreign_keys=[article_id])
    
    def __repr__(self):
        return f"<IngestionLog(action='{self.action}', article_id='{self.article_id}', timestamp='{self.timestamp}')>"
