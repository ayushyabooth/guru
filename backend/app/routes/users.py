from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserProfile
from app.schemas.user_schema import UserProfileRequest, UserProfileResponse
from app.services.industries_config import IndustriesConfig
import uuid
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["users"])


def _resolve_display_name(config: IndustriesConfig, value: str, item_type: str) -> str:
    """Resolve a value (ID or display name) to its canonical display name from central config."""
    # Try as ID first (e.g., "consumer" → "Consumer")
    display = config.get_display_name(value, item_type)
    if display:
        return display
    # Try normalizing as display name → ID → display name (e.g., "Consumer" → "consumer" → "Consumer")
    normalized_id = config.normalize_id(value, item_type)
    if normalized_id:
        display = config.get_display_name(normalized_id, item_type)
        if display:
            return display
    # Fall back to the original value
    return value

@router.get("/me", response_model=UserProfileResponse)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's profile"""
    profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()

    if not profile:
        raise HTTPException(status_code=404, detail="User profile not found")

    # Resolve display names from central config for guaranteed correct labels
    config = IndustriesConfig.get_instance()

    core_display = _resolve_display_name(config, profile.core_industry, 'industry')
    specs_display = [
        _resolve_display_name(config, s, 'specialization')
        for s in (profile.specializations or [])
    ]
    interests_display = [
        _resolve_display_name(config, i, 'industry')
        for i in (profile.additional_interest_industries or [])
    ]

    return UserProfileResponse(
        user_id=str(profile.user_id),
        core_industry=profile.core_industry,
        specializations=profile.specializations,
        additional_interest_industries=profile.additional_interest_industries or [],
        core_industry_display=core_display,
        specializations_display=specs_display,
        additional_interest_industries_display=interests_display,
        total_weekly_capacity_band=profile.total_weekly_capacity_band,
        catchup_daily_goal_minutes=profile.catchup_daily_goal_minutes,
        catchup_daily_max_minutes=profile.catchup_daily_max_minutes,
        divein_weekly_goal_minutes=profile.divein_weekly_goal_minutes,
        recap_weekly_goal_minutes=profile.recap_weekly_goal_minutes,
        created_at=profile.created_at,
        updated_at=profile.updated_at
    )


@router.put("/me", response_model=UserProfileResponse)
async def update_current_user_profile(
    profile_data: UserProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user's profile with config validation"""
    config = IndustriesConfig.get_instance()
    
    # Validate industry_id
    if not config.validate_industry(profile_data.core_industry):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid industry: {profile_data.core_industry}"
        )
    
    # Validate specializations
    is_valid, error_msg = config.validate_specializations(
        profile_data.core_industry,
        profile_data.specializations
    )
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    # Validate additional interests (if provided)
    if profile_data.additional_interest_industries:
        is_valid, error_msg = config.validate_additional_interests(
            profile_data.core_industry,
            profile_data.additional_interest_industries
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_msg)
    
    logger.info(f"Profile validation passed for user {current_user.id}")
    
    # Convert IDs to display names for database storage
    core_industry_display = config.get_display_name(profile_data.core_industry, 'industry') or profile_data.core_industry
    specializations_display = [
        config.get_display_name(spec, 'specialization') or spec 
        for spec in profile_data.specializations
    ]
    interests_display = [
        config.get_display_name(interest, 'industry') or interest 
        for interest in (profile_data.additional_interest_industries or [])
    ]
    
    profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
    
    if not profile:
        # Create new profile if it doesn't exist
        profile = UserProfile(
            user_id=current_user.id,
            core_industry=core_industry_display,
            specializations=specializations_display,
            additional_interest_industries=interests_display,
            total_weekly_capacity_band=profile_data.total_weekly_capacity_band,
            catchup_daily_goal_minutes=profile_data.catchup_daily_goal_minutes,
            catchup_daily_max_minutes=profile_data.catchup_daily_max_minutes,
            divein_weekly_goal_minutes=profile_data.divein_weekly_goal_minutes,
            recap_weekly_goal_minutes=profile_data.recap_weekly_goal_minutes
        )
        db.add(profile)
    else:
        # Update existing profile
        profile.core_industry = core_industry_display
        profile.specializations = specializations_display
        profile.additional_interest_industries = interests_display
        profile.total_weekly_capacity_band = profile_data.total_weekly_capacity_band
        profile.catchup_daily_goal_minutes = profile_data.catchup_daily_goal_minutes
        profile.catchup_daily_max_minutes = profile_data.catchup_daily_max_minutes
        profile.divein_weekly_goal_minutes = profile_data.divein_weekly_goal_minutes
        profile.recap_weekly_goal_minutes = profile_data.recap_weekly_goal_minutes
    
    db.commit()
    db.refresh(profile)

    # Fire-and-forget: pre-warm storyboard caches for this user's filter keys.
    # By the time they navigate from onboarding to the feed (~3-5s), caches should be warm.
    import threading
    from app.services.startup_service import warm_user_filters_sync
    threading.Thread(
        target=warm_user_filters_sync,
        args=(str(current_user.id), None),  # current_filter=None → warm ALL filters
        daemon=True
    ).start()
    logger.info(f"Triggered post-onboarding cache warming for user {current_user.id}")

    return UserProfileResponse(
        user_id=str(profile.user_id),
        core_industry=profile.core_industry,
        specializations=profile.specializations,
        additional_interest_industries=profile.additional_interest_industries or [],
        core_industry_display=_resolve_display_name(config, profile.core_industry, 'industry'),
        specializations_display=[
            _resolve_display_name(config, s, 'specialization')
            for s in (profile.specializations or [])
        ],
        additional_interest_industries_display=[
            _resolve_display_name(config, i, 'industry')
            for i in (profile.additional_interest_industries or [])
        ],
        total_weekly_capacity_band=profile.total_weekly_capacity_band,
        catchup_daily_goal_minutes=profile.catchup_daily_goal_minutes,
        catchup_daily_max_minutes=profile.catchup_daily_max_minutes,
        divein_weekly_goal_minutes=profile.divein_weekly_goal_minutes,
        recap_weekly_goal_minutes=profile.recap_weekly_goal_minutes,
        created_at=profile.created_at,
        updated_at=profile.updated_at
    )


class TopicsUpdateRequest(BaseModel):
    """Partial profile update for the Settings interests/specializations editor.
    Accepts IDs; only these two fields change — everything else is preserved."""
    specializations: List[str] = []                 # specialization IDs
    additional_interest_industries: List[str] = []  # industry IDs (interests)


@router.put("/me/interests", response_model=UserProfileResponse)
async def update_my_topics(
    data: TopicsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update ONLY the user's specializations + additional interests (GUR-235).

    Used by the Settings → Interests & specializations editor. Core industry,
    capacity and goals are left untouched. Validates against central config
    (interest cap = 4), stores display names, and fires the same background
    storyboard warming as onboarding so the new contexts' feeds fill in.
    """
    config = IndustriesConfig.get_instance()
    profile = db.query(UserProfile).filter(UserProfile.user_id == current_user.id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="User profile not found")

    # The stored core_industry is a display name; validation needs its ID.
    core_id = config.normalize_id(profile.core_industry, 'industry') or profile.core_industry

    ok, err = config.validate_specializations(core_id, data.specializations)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    ok, err = config.validate_additional_interests(core_id, data.additional_interest_industries)
    if not ok:
        raise HTTPException(status_code=400, detail=err)

    # Store display names (consistent with onboarding / PUT /me).
    profile.specializations = [
        config.get_display_name(s, 'specialization') or s for s in data.specializations
    ]
    profile.additional_interest_industries = [
        config.get_display_name(i, 'industry') or i for i in data.additional_interest_industries
    ]
    db.commit()
    db.refresh(profile)

    # Fire-and-forget: warm storyboard caches for the user's (now updated) filter
    # contexts so a newly-added interest/specialization feed isn't empty.
    import threading
    from app.services.startup_service import warm_user_filters_sync
    threading.Thread(
        target=warm_user_filters_sync,
        args=(str(current_user.id), None),
        daemon=True,
    ).start()
    logger.info(f"Updated topics + triggered warming for user {current_user.id}")

    return UserProfileResponse(
        user_id=str(profile.user_id),
        core_industry=profile.core_industry,
        specializations=profile.specializations,
        additional_interest_industries=profile.additional_interest_industries or [],
        core_industry_display=_resolve_display_name(config, profile.core_industry, 'industry'),
        specializations_display=[
            _resolve_display_name(config, s, 'specialization')
            for s in (profile.specializations or [])
        ],
        additional_interest_industries_display=[
            _resolve_display_name(config, i, 'industry')
            for i in (profile.additional_interest_industries or [])
        ],
        total_weekly_capacity_band=profile.total_weekly_capacity_band,
        catchup_daily_goal_minutes=profile.catchup_daily_goal_minutes,
        catchup_daily_max_minutes=profile.catchup_daily_max_minutes,
        divein_weekly_goal_minutes=profile.divein_weekly_goal_minutes,
        recap_weekly_goal_minutes=profile.recap_weekly_goal_minutes,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )
