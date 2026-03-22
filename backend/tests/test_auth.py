"""
Test suite for authentication endpoints and JWT functionality
"""
import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from jose import JWTError

from app.main import app
from app.db.base import Base
from app.db.database import get_db
from app.models.user import User, UserProfile
# Import all models to ensure Base.metadata has all tables
from app.models import user, article, storyboard, interaction, recap, metric, cache, ingestion, qa_models, preferences, ingestion_run, article_rich_content  # noqa: F401
from app.services.auth_service import hash_password, verify_password, generate_jwt, verify_jwt, create_refresh_token
from app.utils.jwt_utils import encode_token, decode_token
from app.config import settings


# Test database setup
@pytest.fixture
def db_session():
    """Create a test database session"""
    engine = create_engine(
        "sqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    
    yield session
    
    session.close()


@pytest.fixture
def client(db_session):
    """Create a test client with database dependency override"""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    
    app.dependency_overrides[get_db] = override_get_db
    
    test_client = TestClient(app)
    yield test_client
    
    app.dependency_overrides.clear()


def test_signup_success(client):
    """Test successful user signup with token generation"""
    signup_data = {
        "email": "test@guru.com",
        "password": "testpassword123"
    }
    
    response = client.post("/api/v1/auth/signup", json=signup_data)
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify response structure
    assert "user_id" in data
    assert "access_token" in data
    assert "refresh_token" in data
    
    # Verify user_id is a valid UUID string
    user_id = data["user_id"]
    assert uuid.UUID(user_id)  # Should not raise exception
    
    # Verify tokens are valid JWTs
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]
    
    # Decode and verify access token
    access_payload = verify_jwt(access_token)
    assert access_payload == user_id
    
    # Decode and verify refresh token
    refresh_payload = verify_jwt(refresh_token)
    assert refresh_payload == user_id


def test_signup_duplicate_email(client):
    """Test signup rejection for duplicate email"""
    signup_data = {
        "email": "duplicate@guru.com",
        "password": "password123"
    }
    
    # First signup should succeed
    response1 = client.post("/api/v1/auth/signup", json=signup_data)
    assert response1.status_code == 200
    
    # Second signup with same email should fail
    response2 = client.post("/api/v1/auth/signup", json=signup_data)
    assert response2.status_code == 400
    assert "Email already registered" in response2.json()["detail"]


def test_signup_creates_user_profile(client, db_session):
    """Test that signup creates both User and UserProfile with defaults"""
    signup_data = {
        "email": "profile_test@guru.com",
        "password": "password123"
    }
    
    response = client.post("/api/v1/auth/signup", json=signup_data)
    assert response.status_code == 200
    
    user_id = response.json()["user_id"]
    
    # Verify user was created
    user = db_session.query(User).filter(User.id == user_id).first()
    assert user is not None
    assert user.email == "profile_test@guru.com"
    assert user.is_active is True
    
    # Verify user profile was created with defaults
    profile = db_session.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    assert profile is not None
    assert profile.core_industry == "Consumer"
    assert profile.specializations == ["Food & Beverage"]
    assert profile.additional_interest_industries == []
    assert profile.total_weekly_capacity_band == "~2h"
    assert profile.catchup_daily_goal_minutes == 20
    assert profile.catchup_daily_max_minutes == 45
    assert profile.divein_weekly_goal_minutes == 90
    assert profile.recap_weekly_goal_minutes == 30


def test_login_success(client, db_session):
    """Test successful login with valid credentials"""
    # Create a user first
    user_id = uuid.uuid4()
    hashed_password = hash_password("logintest123")
    
    test_user = User(
        id=user_id,
        email="login_test@guru.com",
        password_hash=hashed_password,
        is_active=True
    )
    db_session.add(test_user)
    db_session.commit()
    
    # Attempt login
    login_data = {
        "email": "login_test@guru.com",
        "password": "logintest123"
    }
    
    response = client.post("/api/v1/auth/login", json=login_data)
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify response structure
    assert "access_token" in data
    assert "refresh_token" in data
    
    # Verify tokens are valid and contain correct user ID
    access_payload = verify_jwt(data["access_token"])
    refresh_payload = verify_jwt(data["refresh_token"])
    
    assert access_payload == str(user_id)
    assert refresh_payload == str(user_id)


def test_login_invalid_email(client):
    """Test login failure with non-existent email"""
    login_data = {
        "email": "nonexistent@guru.com",
        "password": "password123"
    }
    
    response = client.post("/api/v1/auth/login", json=login_data)
    
    assert response.status_code == 401
    assert "Incorrect email or password" in response.json()["detail"]


def test_login_invalid_password(client, db_session):
    """Test login failure with wrong password"""
    # Create a user first
    user_id = uuid.uuid4()
    hashed_password = hash_password("correctpassword")
    
    test_user = User(
        id=user_id,
        email="password_test@guru.com",
        password_hash=hashed_password,
        is_active=True
    )
    db_session.add(test_user)
    db_session.commit()
    
    # Attempt login with wrong password
    login_data = {
        "email": "password_test@guru.com",
        "password": "wrongpassword"
    }
    
    response = client.post("/api/v1/auth/login", json=login_data)
    
    assert response.status_code == 401
    assert "Incorrect email or password" in response.json()["detail"]


def test_login_inactive_user(client, db_session):
    """Test login failure with inactive user"""
    # Create an inactive user
    user_id = uuid.uuid4()
    hashed_password = hash_password("password123")
    
    inactive_user = User(
        id=user_id,
        email="inactive@guru.com",
        password_hash=hashed_password,
        is_active=False
    )
    db_session.add(inactive_user)
    db_session.commit()
    
    # Attempt login
    login_data = {
        "email": "inactive@guru.com",
        "password": "password123"
    }
    
    response = client.post("/api/v1/auth/login", json=login_data)
    
    assert response.status_code == 400
    assert "Inactive user" in response.json()["detail"]


def test_refresh_token_success(client, db_session):
    """Test successful token refresh"""
    # Create a user first
    user_id = uuid.uuid4()
    hashed_password = hash_password("refreshtest123")
    
    test_user = User(
        id=user_id,
        email="refresh_test@guru.com",
        password_hash=hashed_password,
        is_active=True
    )
    db_session.add(test_user)
    db_session.commit()
    
    # Generate a valid refresh token
    refresh_token = create_refresh_token(user_id)
    
    # Use refresh token to get new access token
    response = client.post(f"/api/v1/auth/refresh?refresh_token={refresh_token}")
    
    assert response.status_code == 200
    data = response.json()
    
    # Verify new access token is returned
    assert "access_token" in data
    
    # Verify new access token is valid
    new_access_payload = verify_jwt(data["access_token"])
    assert new_access_payload == str(user_id)


def test_refresh_token_invalid(client):
    """Test refresh token failure with invalid token"""
    invalid_token = "invalid.jwt.token"
    
    response = client.post(f"/api/v1/auth/refresh?refresh_token={invalid_token}")
    
    assert response.status_code == 401
    assert "Invalid refresh token" in response.json()["detail"]


def test_refresh_token_expired(client):
    """Test refresh token failure with expired token"""
    # Create an expired token (expires immediately)
    payload = {"sub": str(uuid.uuid4()), "type": "refresh"}
    expired_token = encode_token(payload, settings.JWT_SECRET_KEY, expires_in=-1)
    
    response = client.post(f"/api/v1/auth/refresh?refresh_token={expired_token}")
    
    assert response.status_code == 401
    assert "Invalid refresh token" in response.json()["detail"]


def test_refresh_token_nonexistent_user(client):
    """Test refresh token failure with non-existent user"""
    # Create a valid token for non-existent user
    nonexistent_user_id = str(uuid.uuid4())
    valid_token = create_refresh_token(nonexistent_user_id)
    
    response = client.post(f"/api/v1/auth/refresh?refresh_token={valid_token}")
    
    assert response.status_code == 401
    assert "Invalid user" in response.json()["detail"]


def test_invalid_jwt_malformed(client):
    """Test JWT verification with malformed token"""
    malformed_token = "not.a.valid.jwt.token.at.all"
    
    with pytest.raises(JWTError):
        verify_jwt(malformed_token)


def test_invalid_jwt_wrong_secret():
    """Test JWT verification with wrong secret"""
    # Create token with different secret
    payload = {"sub": str(uuid.uuid4())}
    wrong_secret_token = encode_token(payload, "wrong_secret", expires_in=3600)
    
    with pytest.raises(JWTError):
        verify_jwt(wrong_secret_token)


def test_invalid_jwt_missing_subject():
    """Test JWT verification with missing subject"""
    # Create token without 'sub' claim
    payload = {"user": str(uuid.uuid4())}  # Wrong claim name
    token = encode_token(payload, settings.JWT_SECRET_KEY, expires_in=3600)
    
    with pytest.raises(JWTError):
        verify_jwt(token)


def test_password_hashing():
    """Test password hashing and verification"""
    password = "test_password_123"
    
    # Hash password
    hashed = hash_password(password)
    
    # Verify correct password
    assert verify_password(password, hashed) is True
    
    # Verify incorrect password
    assert verify_password("wrong_password", hashed) is False
    
    # Verify different passwords produce different hashes
    hashed2 = hash_password(password)
    assert hashed != hashed2  # Should be different due to random salt


def test_jwt_token_types():
    """Test different JWT token types (access vs refresh)"""
    user_id = uuid.uuid4()
    
    # Generate access token
    access_token = generate_jwt(user_id, token_type='access')
    access_payload = decode_token(access_token, settings.JWT_SECRET_KEY)
    
    # Generate refresh token
    refresh_token = generate_jwt(user_id, token_type='refresh')
    refresh_payload = decode_token(refresh_token, settings.JWT_SECRET_KEY)
    
    # Verify both tokens have correct user ID
    assert access_payload["sub"] == str(user_id)
    assert refresh_payload["sub"] == str(user_id)
    
    # Verify token types
    assert access_payload["type"] == "access"
    assert refresh_payload["type"] == "refresh"
    
    # Verify different expiration times (refresh should expire later)
    assert refresh_payload["exp"] > access_payload["exp"]


def test_jwt_uuid_handling():
    """Test JWT functions handle both UUID and string user IDs"""
    user_uuid = uuid.uuid4()
    user_string = str(user_uuid)
    
    # Test with UUID input
    token_from_uuid = generate_jwt(user_uuid)
    payload_from_uuid = verify_jwt(token_from_uuid)
    
    # Test with string input
    token_from_string = generate_jwt(user_string)
    payload_from_string = verify_jwt(token_from_string)
    
    # Both should return the same user ID as string
    assert payload_from_uuid == user_string
    assert payload_from_string == user_string
