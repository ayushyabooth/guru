"""
Cache status endpoint for checking if storyboards are ready
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import date, datetime
import uuid
import logging

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.cache import StoryboardCache
from app.services.startup_service import _build_filter_contexts_for_user

# Sentinel UUID for base (shared) storyboard caches
BASE_SENTINEL_UUID = uuid.UUID('00000000-0000-0000-0000-000000000000')

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["cache"])


@router.get("/cache-status")
async def get_cache_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Check if storyboards are cached and ready for the current user
    
    Returns:
        {
            "ready": bool,
            "cached_filters": int,
            "total_filters": int,
            "warming": bool,
            "message": str
        }
    """
    try:
        # Get user profile to determine expected filters
        if not current_user.profile:
            return {
                "ready": False,
                "cached_filters": 0,
                "total_filters": 0,
                "warming": True,
                "message": "Setting up your profile..."
            }
        
        # Build expected filter contexts
        filter_contexts = _build_filter_contexts_for_user(current_user.profile)
        total_filters = len(filter_contexts)
        
        # Check how many are cached
        today_str = date.today().strftime('%Y-%m-%d')
        cached_count = 0
        
        for filter_context in filter_contexts:
            # Check base (sentinel) caches first, then user-specific
            cache_entry = db.query(StoryboardCache).filter(
                and_(
                    StoryboardCache.user_id.in_([BASE_SENTINEL_UUID, current_user.id]),
                    StoryboardCache.filter_context == filter_context,
                    StoryboardCache.cache_date == today_str
                )
            ).first()

            if cache_entry:
                cached_count += 1
        
        # Determine status
        ready = cached_count >= total_filters
        warming = cached_count < total_filters
        
        # Generate appropriate message
        if ready:
            message = "Your stories are ready!"
        elif cached_count == 0:
            message = "Brewing your personalized stories..."
        else:
            percentage = int((cached_count / total_filters) * 100)
            message = f"Almost there... {percentage}% ready"
        
        return {
            "ready": ready,
            "cached_filters": cached_count,
            "total_filters": total_filters,
            "warming": warming,
            "message": message
        }
        
    except Exception as e:
        logger.error(f"Error checking cache status: {e}")
        return {
            "ready": False,
            "cached_filters": 0,
            "total_filters": 0,
            "warming": True,
            "message": "Preparing your experience..."
        }
