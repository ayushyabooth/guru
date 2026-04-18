from sqlalchemy import Column, String, DateTime, Integer, Boolean, ForeignKey, Index, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class TimeLog(Base):
    __tablename__ = "time_logs"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ring_type = Column(String(20), nullable=False)  # 'catchup', 'divein', 'recap'
    duration_seconds = Column(Integer, nullable=False)
    context_id = Column(String(100))  # storyboard_id, article_id, or null for recap
    started_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Industry/Specialization context for granular analytics
    industry = Column(String(100), nullable=True)  # e.g., 'Consumer', 'Technology'
    specialization = Column(String(100), nullable=True)  # e.g., 'Food & Beverage', 'AI/ML'

    # Activity type for deeper insights
    activity_type = Column(String(50), nullable=True)  # 'storyboard', 'card', 'qa', 'article', 'socratic'

    # Idle tracking
    idle_seconds = Column(Integer, default=0)  # Time spent idle during session

    # Relationships
    user = relationship("User", back_populates="time_logs")

    # Indexes
    __table_args__ = (
        Index('idx_user_ring_started', 'user_id', 'ring_type', 'started_at'),
        Index('idx_user_industry', 'user_id', 'industry'),
        Index('idx_user_specialization', 'user_id', 'specialization'),
    )


class DailyMetric(Base):
    __tablename__ = "daily_metrics"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_date = Column(Date, nullable=False)
    catchup_minutes = Column(Integer, default=0)
    catchup_goal_met = Column(Boolean, default=False)
    divein_minutes = Column(Integer, default=0)
    divein_goal_met = Column(Boolean, default=False)
    recap_completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="daily_metrics")
    
    # Indexes and constraints
    __table_args__ = (
        Index('idx_user_metric_date', 'user_id', 'metric_date', unique=True),
    )
