"""
Test suite for user profile endpoints
"""
import pytest
import httpx
import uuid
from sqlalchemy.orm import Session

from app.main import app
from app.models.user import User, UserProfile
from app.services.auth_service import hash_password, generate_jwt, create_access_token
from app.db.database import get_db, SessionLocal


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def async_client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.fixture
def db_session():
    """Create a test database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def test_user(db_session: Session):
    """Create a test user with profile"""
    unique_email = f"user.test+{uuid.uuid4().hex[:8]}@example.com"
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=unique_email,
        password_hash=hash_password("password123"),
        is_active=True
    )
    db_session.add(user)

    profile = UserProfile(
        user_id=user_id,
        core_industry="Consumer",
        specializations=["Food & Beverage"],
        additional_interest_industries=[],
        total_weekly_capacity_band="~2h",
        catchup_daily_goal_minutes=20,
        catchup_daily_max_minutes=45,
        divein_weekly_goal_minutes=90,
        recap_weekly_goal_minutes=30
    )
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(user)

    return user


@pytest.fixture
def auth_token(test_user):
    """Generate auth token for test user"""
    return create_access_token(data={"sub": str(test_user.id)})


@pytest.fixture
def auth_headers(auth_token):
    """Create authorization headers"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.mark.anyio
async def test_get_current_user_profile_success(async_client, test_user, auth_headers):
    """Test successful retrieval of user profile"""
    response = await async_client.get("/api/v1/me", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()

    assert data["user_id"] == str(test_user.id)
    assert data["core_industry"] == "Consumer"
    assert data["specializations"] == ["Food & Beverage"]
    assert data["additional_interest_industries"] == []
    assert data["total_weekly_capacity_band"] == "~2h"
    assert data["catchup_daily_goal_minutes"] == 20
    assert data["catchup_daily_max_minutes"] == 45
    assert data["divein_weekly_goal_minutes"] == 90
    assert data["recap_weekly_goal_minutes"] == 30


@pytest.mark.anyio
async def test_get_current_user_profile_unauthorized(async_client):
    """Test profile retrieval without authentication"""
    response = await async_client.get("/api/v1/me")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_get_current_user_profile_invalid_token(async_client):
    """Test profile retrieval with invalid token"""
    response = await async_client.get(
        "/api/v1/me",
        headers={"Authorization": "Bearer invalid_token"}
    )

    assert response.status_code == 401


@pytest.mark.anyio
async def test_update_user_profile_success(async_client, test_user, auth_headers):
    """Test successful profile update"""
    update_data = {
        "core_industry": "consumer",
        "specializations": ["food_beverage", "retail"],
        "additional_interest_industries": ["technology"],
        "total_weekly_capacity_band": "~4h",
        "catchup_daily_goal_minutes": 30,
        "catchup_daily_max_minutes": 60,
        "divein_weekly_goal_minutes": 120,
        "recap_weekly_goal_minutes": 45
    }

    response = await async_client.put(
        "/api/v1/me",
        json=update_data,
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert data["user_id"] == str(test_user.id)
    assert data["total_weekly_capacity_band"] == "~4h"
    assert data["catchup_daily_goal_minutes"] == 30


@pytest.mark.anyio
async def test_update_user_profile_unauthorized(async_client):
    """Test profile update without authentication"""
    update_data = {
        "core_industry": "consumer",
        "specializations": ["food_beverage"],
        "total_weekly_capacity_band": "~2h",
        "catchup_daily_goal_minutes": 20,
        "catchup_daily_max_minutes": 45,
        "divein_weekly_goal_minutes": 90,
        "recap_weekly_goal_minutes": 30
    }

    response = await async_client.put("/api/v1/me", json=update_data)

    assert response.status_code == 401


@pytest.mark.anyio
async def test_update_user_profile_invalid_industry(async_client, test_user, auth_headers):
    """Test profile update with invalid industry"""
    update_data = {
        "core_industry": "invalid_industry",
        "specializations": ["food_beverage"],
        "total_weekly_capacity_band": "~2h",
        "catchup_daily_goal_minutes": 20,
        "catchup_daily_max_minutes": 45,
        "divein_weekly_goal_minutes": 90,
        "recap_weekly_goal_minutes": 30
    }

    response = await async_client.put(
        "/api/v1/me",
        json=update_data,
        headers=auth_headers
    )

    assert response.status_code == 400
    assert "Invalid industry" in response.json()["detail"]


@pytest.mark.anyio
async def test_get_profile_without_profile_created(async_client, db_session: Session):
    """Test getting profile for user without profile"""
    # Create user without profile
    unique_email = f"noprofile+{uuid.uuid4().hex[:8]}@example.com"
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=unique_email,
        password_hash=hash_password("password123"),
        is_active=True
    )
    db_session.add(user)
    db_session.commit()

    token = create_access_token(data={"sub": str(user_id)})

    response = await async_client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 404
    assert "profile not found" in response.json()["detail"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
