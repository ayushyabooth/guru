from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime


class UserSignupRequest(BaseModel):
    email: EmailStr
    password: str
    invite_code: str = ""


class UserSignupResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserLoginResponse(BaseModel):
    access_token: str
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserProfileRequest(BaseModel):
    """
    User profile request - accepts IDs (e.g., 'food_beverage') 
    which are converted to display names (e.g., 'Food & Beverage') before storage
    """
    core_industry: str  # Industry ID (e.g., 'consumer', 'technology')
    specializations: List[str]  # Specialization IDs (e.g., 'food_beverage', 'ai_ml')
    additional_interest_industries: Optional[List[str]] = []  # Industry IDs for additional interests
    total_weekly_capacity_band: str
    catchup_daily_goal_minutes: int
    catchup_daily_max_minutes: int
    divein_weekly_goal_minutes: int
    recap_weekly_goal_minutes: int


class UserProfileResponse(BaseModel):
    """
    User profile response - returns display names (e.g., 'Food & Beverage')
    as stored in the database, plus explicit _display fields for guaranteed mapping
    """
    user_id: str
    core_industry: str  # Display name (e.g., 'Consumer', 'Technology')
    specializations: List[str]  # Display names (e.g., 'Food & Beverage', 'AI & ML')
    additional_interest_industries: List[str]  # Display names for additional interests
    core_industry_display: Optional[str] = None  # Guaranteed display name from central config
    specializations_display: Optional[List[str]] = None  # Guaranteed display names from central config
    additional_interest_industries_display: Optional[List[str]] = None  # Guaranteed display names
    total_weekly_capacity_band: str
    catchup_daily_goal_minutes: int
    catchup_daily_max_minutes: int
    divein_weekly_goal_minutes: int
    recap_weekly_goal_minutes: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
