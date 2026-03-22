from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from jose import JWTError
from app.db.database import get_db
from app.models.user import User, UserProfile
from app.schemas.user_schema import UserSignupRequest, UserSignupResponse, UserLoginRequest, UserLoginResponse
from app.services.auth_service import hash_password, verify_password, generate_jwt, verify_jwt, create_refresh_token
from app.services.industries_config import IndustriesConfig
from app.config import settings
import uuid

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


def _get_default_industry_and_specialization():
    """Get default industry and specialization from config (first ones)"""
    try:
        config = IndustriesConfig.get_instance()
        industries = config._config.get("industries", [])
        if industries:
            first_industry = industries[0]
            industry_name = first_industry.get("name", "Consumer")
            specs = first_industry.get("specializations", [])
            spec_name = specs[0].get("name", "Food & Beverage") if specs else "Food & Beverage"
            return industry_name, [spec_name]
    except Exception:
        pass
    # Fallback only if config fails to load
    return "Consumer", ["Food & Beverage"]


@router.post("/signup", response_model=UserSignupResponse)
async def signup(user_data: UserSignupRequest, db: Session = Depends(get_db)):
    """Create a new user account with default profile"""

    # Validate invite code
    valid_codes = [c.strip().upper() for c in settings.SIGNUP_INVITE_CODES.split(",")]
    if user_data.invite_code.strip().upper() not in valid_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid invite code"
        )

    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Hash password
    hashed_password = hash_password(user_data.password)
    
    # Create user
    user_id = uuid.uuid4()
    new_user = User(
        id=user_id,
        email=user_data.email,
        password_hash=hashed_password
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create default UserProfile using config defaults
    default_industry, default_specs = _get_default_industry_and_specialization()
    default_profile = UserProfile(
        user_id=user_id,
        core_industry=default_industry,
        specializations=default_specs,
        additional_interest_industries=[],
        total_weekly_capacity_band="~2h",
        catchup_daily_goal_minutes=20,
        catchup_daily_max_minutes=45,
        divein_weekly_goal_minutes=90,
        recap_weekly_goal_minutes=30
    )
    
    db.add(default_profile)
    db.commit()
    
    # Generate tokens using new JWT functions
    access_token = generate_jwt(user_id, token_type='access')
    refresh_token = create_refresh_token(user_id)
    
    return UserSignupResponse(
        user_id=str(user_id),
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/login", response_model=UserLoginResponse)
async def login(user_data: UserLoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return tokens"""
    
    # Find user
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    # Generate tokens using new JWT functions
    access_token = generate_jwt(user.id, token_type='access')
    refresh_token = create_refresh_token(user.id)
    
    return UserLoginResponse(
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/refresh")
async def refresh_token(refresh_token: str, db: Session = Depends(get_db)):
    """Refresh access token using refresh token"""
    
    try:
        # Verify refresh token and get user ID
        user_id = verify_jwt(refresh_token)
        
        # Verify user still exists and is active
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid user"
            )
        
        # Generate new access token
        new_access_token = generate_jwt(user.id, token_type='access')
        
        return {"access_token": new_access_token}
        
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
