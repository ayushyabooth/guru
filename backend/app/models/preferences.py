"""
Database models for user preferences and settings
"""
from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
from app.db.types import UUID
import uuid


class UserPreferences(Base):
    """
    Stores user preferences and settings
    """
    __tablename__ = "user_preferences"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    
    # UI Preferences
    theme = Column(String(20), default='system')  # 'light', 'dark', 'system'
    
    # Notification Settings
    notifications_enabled = Column(Boolean, default=True)
    email_notifications = Column(Boolean, default=True)
    push_notifications = Column(Boolean, default=True)
    
    # Reading Goals and Time
    daily_goal_minutes = Column(Integer, default=30)
    reading_time_units = Column(String(10), default='minutes')  # 'minutes', 'hours'
    
    # Content Preferences
    auto_save_articles = Column(Boolean, default=True)
    show_read_time = Column(Boolean, default=True)
    compact_view = Column(Boolean, default=False)
    
    # Privacy Settings
    share_reading_stats = Column(Boolean, default=False)
    public_profile = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="preferences")
    
    def __repr__(self):
        return f"<UserPreferences(user_id='{self.user_id}', theme='{self.theme}')>"
    
    def to_dict(self):
        """Convert preferences to dictionary for API responses"""
        return {
            "theme": self.theme,
            "notifications_enabled": self.notifications_enabled,
            "email_notifications": self.email_notifications,
            "push_notifications": self.push_notifications,
            "daily_goal_minutes": self.daily_goal_minutes,
            "reading_time_units": self.reading_time_units,
            "auto_save_articles": self.auto_save_articles,
            "show_read_time": self.show_read_time,
            "compact_view": self.compact_view,
            "share_reading_stats": self.share_reading_stats,
            "public_profile": self.public_profile,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
