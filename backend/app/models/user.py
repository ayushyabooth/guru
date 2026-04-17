from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey, Index, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from typing import List
from app.db.base import Base
from app.db.types import UUID


class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    
    # Relationships
    profile = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    saved_articles = relationship("UserSavedArticle", back_populates="user", cascade="all, delete-orphan")
    not_relevant_storyboards = relationship("UserNotRelevant", back_populates="user", cascade="all, delete-orphan")
    qa_exchanges = relationship("QAExchange", back_populates="user", cascade="all, delete-orphan")
    preferences = relationship("UserPreferences", back_populates="user", uselist=False, cascade="all, delete-orphan")
    time_logs = relationship("TimeLog", back_populates="user", cascade="all, delete-orphan")
    daily_metrics = relationship("DailyMetric", back_populates="user", cascade="all, delete-orphan")
    recap_sessions = relationship("RecapSession", back_populates="user", cascade="all, delete-orphan")
    recap_journeys = relationship("RecapJourney", back_populates="user", cascade="all, delete-orphan")
    key_insights = relationship("KeyInsight", back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    core_industry = Column(String(50), nullable=False)
    specializations = Column(JSON, nullable=False)
    additional_interest_industries = Column(JSON)
    total_weekly_capacity_band = Column(String(20))
    catchup_daily_goal_minutes = Column(Integer, nullable=False)
    catchup_daily_max_minutes = Column(Integer, nullable=False)
    divein_weekly_goal_minutes = Column(Integer, nullable=False)
    recap_weekly_goal_minutes = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="profile")


class RevokedToken(Base):
    """Blocklist for revoked JWT tokens, keyed by jti claim."""
    __tablename__ = "revoked_tokens"

    jti = Column(String(36), primary_key=True)
    expires_at = Column(DateTime(timezone=False), nullable=False)
    revoked_at = Column(DateTime(timezone=False), server_default=func.now())
