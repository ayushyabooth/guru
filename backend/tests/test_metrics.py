"""
Test suite for metrics endpoints - tracking user activity and rings progress
"""
import pytest
import httpx
import uuid
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session

from app.main import app
from app.models.user import User, UserProfile
from app.models.metric import TimeLog, DailyMetric
from app.services.auth_service import hash_password, create_access_token
from app.db.database import SessionLocal


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
    unique_email = f"metrics.test+{uuid.uuid4().hex[:8]}@example.com"
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
async def test_log_time_catchup(async_client, test_user, auth_headers):
    """Test logging time for catchup activity"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "catchup",
        "duration_seconds": 1200,  # 20 minutes
        "context_id": str(uuid.uuid4()),
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=20)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 201
    data = response.json()

    assert data["ring_type"] == "catchup"
    assert data["duration_seconds"] == 1200
    assert "id" in data


@pytest.mark.anyio
async def test_log_time_divein(async_client, test_user, auth_headers):
    """Test logging time for divein activity"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "divein",
        "duration_seconds": 3600,  # 60 minutes
        "context_id": str(uuid.uuid4()),
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=60)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 201
    data = response.json()

    assert data["ring_type"] == "divein"
    assert data["duration_seconds"] == 3600


@pytest.mark.anyio
async def test_log_time_recap(async_client, test_user, auth_headers):
    """Test logging time for recap activity"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "recap",
        "duration_seconds": 900,  # 15 minutes
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=15)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 201
    data = response.json()

    assert data["ring_type"] == "recap"


@pytest.mark.anyio
async def test_log_time_invalid_ring_type(async_client, test_user, auth_headers):
    """Test logging time with invalid ring type"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "invalid",
        "duration_seconds": 1200,
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=20)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 422  # Validation error


@pytest.mark.anyio
async def test_log_time_unauthorized(async_client):
    """Test logging time without authentication"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "catchup",
        "duration_seconds": 1200,
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=20)).isoformat()
    }

    response = await async_client.post("/api/v1/metrics/log-time", json=log_data)

    assert response.status_code == 401


@pytest.mark.anyio
async def test_get_metrics_summary(async_client, test_user, auth_headers):
    """Test getting metrics summary"""
    response = await async_client.get(
        "/api/v1/me/metrics",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    # Verify response structure
    assert "today" in data
    assert "week" in data
    assert "total_catchup_minutes" in data
    assert "total_divein_minutes" in data
    assert "total_recap_sessions" in data
    assert "current_streak" in data

    # Verify today's data structure
    today_data = data["today"]
    assert "metric_date" in today_data
    assert "catchup_minutes" in today_data
    assert "catchup_goal_met" in today_data
    assert "divein_minutes" in today_data
    assert "recap_completed" in today_data


@pytest.mark.anyio
async def test_get_metrics_summary_unauthorized(async_client):
    """Test getting metrics summary without authentication"""
    response = await async_client.get("/api/v1/me/metrics")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_metrics_update_after_logging(async_client, test_user, auth_headers):
    """Test that daily metrics are updated after logging time"""
    now = datetime.utcnow()

    # Log catchup time that meets goal (20+ minutes)
    log_data = {
        "ring_type": "catchup",
        "duration_seconds": 1500,  # 25 minutes
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=25)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 201

    # Check metrics summary
    response = await async_client.get(
        "/api/v1/me/metrics",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    # Should show 25 minutes of catchup today (or more if other tests added)
    assert data["today"]["catchup_minutes"] >= 25
    assert data["today"]["catchup_goal_met"] is True


@pytest.mark.anyio
async def test_metrics_streak_calculation(async_client, db_session: Session):
    """Test streak calculation with historical data"""
    # Create user
    unique_email = f"streak.test+{uuid.uuid4().hex[:8]}@example.com"
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

    # Add historical daily metrics with 3-day streak
    today = date.today()
    for i in range(3):
        metric = DailyMetric(
            user_id=user_id,
            metric_date=today - timedelta(days=i),
            catchup_minutes=25,
            catchup_goal_met=True,
            divein_minutes=0,
            recap_completed=False
        )
        db_session.add(metric)

    db_session.commit()

    token = create_access_token(data={"sub": str(user_id)})

    response = await async_client.get(
        "/api/v1/me/metrics",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    data = response.json()

    # Should have 3-day streak
    assert data["current_streak"] == 3


@pytest.mark.anyio
async def test_metrics_week_history(async_client, db_session: Session):
    """Test week history in metrics summary"""
    # Create user
    unique_email = f"week.test+{uuid.uuid4().hex[:8]}@example.com"
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

    # Add metrics for past 5 days
    today = date.today()
    for i in range(5):
        metric = DailyMetric(
            user_id=user_id,
            metric_date=today - timedelta(days=i),
            catchup_minutes=20 + i * 5,
            catchup_goal_met=True,
            divein_minutes=30,
            recap_completed=(i % 2 == 0)
        )
        db_session.add(metric)

    db_session.commit()

    token = create_access_token(data={"sub": str(user_id)})

    response = await async_client.get(
        "/api/v1/me/metrics",
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    data = response.json()

    # Should have at least 5 days in week history
    assert len(data["week"]) >= 5


@pytest.mark.anyio
async def test_log_time_negative_duration(async_client, test_user, auth_headers):
    """Test that negative duration is rejected"""
    now = datetime.utcnow()
    log_data = {
        "ring_type": "catchup",
        "duration_seconds": -100,
        "started_at": now.isoformat(),
        "ended_at": (now + timedelta(minutes=20)).isoformat()
    }

    response = await async_client.post(
        "/api/v1/metrics/log-time",
        json=log_data,
        headers=auth_headers
    )

    assert response.status_code == 422  # Validation error


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
