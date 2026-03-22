"""
Cache models for storing temporary data like storyboard clusters
"""
from sqlalchemy import Column, String, DateTime, JSON, Index
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class StoryboardCache(Base):
    """
    Cache for filter-specific storyboard clusters to avoid re-computing
    """
    __tablename__ = "storyboard_cache"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), nullable=False, index=True)
    filter_context = Column(String(200), nullable=False, index=True)
    cache_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD format
    storyboard_ids = Column(JSON, nullable=False)  # List of storyboard UUIDs
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    
    # Composite index for efficient lookups
    __table_args__ = (
        Index('idx_storyboard_cache_lookup', 'user_id', 'filter_context', 'cache_date'),
    )
