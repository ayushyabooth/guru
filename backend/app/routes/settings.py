"""
Settings API routes for user preferences management
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
import uuid
import logging
from sqlalchemy import func

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.preferences import UserPreferences
from app.models.qa_models import QAExchange
from app.models.interaction import UserSavedArticle
from app.models.recap import RecapSession
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["settings"])


# Pydantic models for requests and responses
class UserPreferencesResponse(BaseModel):
    """Response model for user preferences"""
    theme: str
    notifications_enabled: bool
    email_notifications: bool
    push_notifications: bool
    daily_goal_minutes: int
    reading_time_units: str
    auto_save_articles: bool
    show_read_time: bool
    compact_view: bool
    share_reading_stats: bool
    public_profile: bool
    updated_at: Optional[str] = None


class UpdatePreferencesRequest(BaseModel):
    """Request model for updating preferences"""
    theme: Optional[str] = Field(None, pattern="^(light|dark|system)$")
    notifications_enabled: Optional[bool] = None
    email_notifications: Optional[bool] = None
    push_notifications: Optional[bool] = None
    daily_goal_minutes: Optional[int] = Field(None, ge=5, le=480)  # 5 minutes to 8 hours
    reading_time_units: Optional[str] = Field(None, pattern="^(minutes|hours)$")
    auto_save_articles: Optional[bool] = None
    show_read_time: Optional[bool] = None
    compact_view: Optional[bool] = None
    share_reading_stats: Optional[bool] = None
    public_profile: Optional[bool] = None


@router.get("/user/preferences", response_model=UserPreferencesResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> UserPreferencesResponse:
    """
    Get user preferences and settings
    
    Returns the user's current preferences. If no preferences exist,
    creates default preferences and returns them.
    """
    try:
        # Get existing preferences
        prefs = db.query(UserPreferences).filter(
            UserPreferences.user_id == current_user.id
        ).first()
        
        # Create default preferences if none exist
        if not prefs:
            prefs = UserPreferences(user_id=current_user.id)
            db.add(prefs)
            db.commit()
            db.refresh(prefs)
            logger.info(f"Created default preferences for user {current_user.id}")
        
        logger.info(f"Retrieved preferences for user {current_user.id}")
        
        return UserPreferencesResponse(**prefs.to_dict())
        
    except Exception as e:
        logger.error(f"Error retrieving preferences for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve preferences"
        )


@router.put("/user/preferences")
async def update_preferences(
    request: UpdatePreferencesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update user preferences and settings
    
    Updates only the provided fields, leaving others unchanged.
    Creates default preferences if none exist.
    """
    try:
        # Get or create preferences
        prefs = db.query(UserPreferences).filter(
            UserPreferences.user_id == current_user.id
        ).first()
        
        if not prefs:
            prefs = UserPreferences(user_id=current_user.id)
            db.add(prefs)
            db.flush()  # Get the ID
        
        # Update provided fields
        updated_fields = []
        for field, value in request.model_dump(exclude_unset=True).items():
            if hasattr(prefs, field):
                setattr(prefs, field, value)
                updated_fields.append(field)
        
        if updated_fields:
            db.commit()
            db.refresh(prefs)
            logger.info(f"Updated preferences for user {current_user.id}: {updated_fields}")
        
        return {
            "updated": True,
            "fields_updated": updated_fields,
            "preferences": prefs.to_dict()
        }
        
    except Exception as e:
        logger.error(f"Error updating preferences for user {current_user.id}: {e}")
        if db:
            db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update preferences"
        )


@router.delete("/user/preferences")
async def reset_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Reset user preferences to defaults
    
    Deletes existing preferences and creates new default ones.
    """
    try:
        # Delete existing preferences
        existing_prefs = db.query(UserPreferences).filter(
            UserPreferences.user_id == current_user.id
        ).first()
        
        if existing_prefs:
            db.delete(existing_prefs)
            db.flush()
        
        # Create new default preferences
        new_prefs = UserPreferences(user_id=current_user.id)
        db.add(new_prefs)
        db.commit()
        db.refresh(new_prefs)
        
        logger.info(f"Reset preferences to defaults for user {current_user.id}")
        
        return {
            "reset": True,
            "preferences": new_prefs.to_dict()
        }
        
    except Exception as e:
        logger.error(f"Error resetting preferences for user {current_user.id}: {e}")
        if db:
            db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset preferences"
        )


@router.get("/user/settings/summary")
async def get_settings_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get a summary of user settings and account information
    
    Returns key settings and account details for the settings screen.
    """
    try:
        # Get preferences
        prefs = db.query(UserPreferences).filter(
            UserPreferences.user_id == current_user.id
        ).first()
        
        if not prefs:
            prefs = UserPreferences(user_id=current_user.id)
            db.add(prefs)
            db.commit()
            db.refresh(prefs)
        
        # Get user profile if it exists
        profile = current_user.profile

        total_qa_exchanges = db.query(func.count(QAExchange.id)).filter(
            QAExchange.user_id == current_user.id
        ).scalar() or 0
        total_saved_articles = db.query(func.count(UserSavedArticle.id)).filter(
            UserSavedArticle.user_id == current_user.id
        ).scalar() or 0
        total_recap_sessions = db.query(func.count(RecapSession.id)).filter(
            RecapSession.user_id == current_user.id
        ).scalar() or 0
        
        summary = {
            "user": {
                "id": str(current_user.id),
                "email": current_user.email,
                "created_at": current_user.created_at.isoformat(),
                "is_active": current_user.is_active
            },
            "profile": {
                "core_industry": profile.core_industry if profile else None,
                "specializations": profile.specializations if profile else None,
                "additional_interests": profile.additional_interest_industries if profile else None
            } if profile else None,
            "preferences": {
                "theme": prefs.theme,
                "notifications_enabled": prefs.notifications_enabled,
                "daily_goal_minutes": prefs.daily_goal_minutes,
                "auto_save_articles": prefs.auto_save_articles
            },
            "stats": {
                "total_qa_exchanges": total_qa_exchanges,
                "total_saved_articles": total_saved_articles,
                "total_recap_sessions": total_recap_sessions
            }
        }
        
        logger.info(f"Retrieved settings summary for user {current_user.id}")
        
        return summary
        
    except Exception as e:
        logger.error(f"Error retrieving settings summary for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve settings summary"
        )
