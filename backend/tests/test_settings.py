"""
Tests for Settings API endpoints and user preferences functionality
"""
import pytest
import httpx
from sqlalchemy.orm import Session
import uuid
from datetime import datetime

from app.main import app
from app.models.user import User, UserProfile
from app.models.preferences import UserPreferences
from app.services.auth_service import create_access_token
from app.db.database import SessionLocal, create_tables


create_tables()


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
    unique_email = f"settings.test+{uuid.uuid4()}@example.com"
    user = User(
        id=uuid.uuid4(),
        email=unique_email,
        password_hash="test_hash",
        is_active=True
    )
    db_session.add(user)
    
    profile = UserProfile(
        user_id=user.id,
        core_industry="Technology",
        specializations=["Software Development", "Data Science"],
        additional_interest_industries=["Healthcare", "Finance"],
        catchup_daily_goal_minutes=30,
        catchup_daily_max_minutes=60,
        divein_weekly_goal_minutes=120,
        recap_weekly_goal_minutes=60
    )
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(user)
    
    return user


@pytest.fixture
def auth_token(test_user):
    """Create authentication token for test user"""
    return create_access_token(data={"sub": str(test_user.id)})


@pytest.fixture
def auth_headers(auth_token):
    """Create authorization headers"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def user_with_preferences(db_session: Session, test_user: User):
    """Create a test user with existing preferences"""
    preferences = UserPreferences(
        user_id=test_user.id,
        theme="dark",
        notifications_enabled=False,
        daily_goal_minutes=45,
        reading_time_units="hours",
        auto_save_articles=False,
        compact_view=True
    )
    db_session.add(preferences)
    db_session.commit()
    db_session.refresh(preferences)
    
    return test_user, preferences


class TestUserPreferencesModel:
    """Test cases for UserPreferences model"""
    
    def test_create_default_preferences(self, db_session: Session, test_user: User):
        """Verify default preferences are created correctly"""
        prefs = UserPreferences(user_id=test_user.id)
        db_session.add(prefs)
        db_session.commit()
        db_session.refresh(prefs)
        
        assert prefs.user_id == test_user.id
        assert prefs.theme == "system"
        assert prefs.notifications_enabled is True
        assert prefs.daily_goal_minutes == 30
        assert prefs.reading_time_units == "minutes"
        assert prefs.auto_save_articles is True
        assert prefs.show_read_time is True
        assert prefs.compact_view is False
    
    def test_preferences_to_dict(self, db_session: Session, test_user: User):
        """Verify preferences to_dict method works correctly"""
        prefs = UserPreferences(
            user_id=test_user.id,
            theme="dark",
            notifications_enabled=False,
            daily_goal_minutes=60
        )
        db_session.add(prefs)
        db_session.commit()
        db_session.refresh(prefs)
        
        prefs_dict = prefs.to_dict()
        
        assert prefs_dict["theme"] == "dark"
        assert prefs_dict["notifications_enabled"] is False
        assert prefs_dict["daily_goal_minutes"] == 60
        assert "updated_at" in prefs_dict
    
    def test_user_preferences_relationship(self, db_session: Session, test_user: User):
        """Verify User-UserPreferences relationship works"""
        prefs = UserPreferences(user_id=test_user.id)
        db_session.add(prefs)
        db_session.commit()
        
        # Refresh user to load relationships
        db_session.refresh(test_user)
        
        assert test_user.preferences is not None
        assert test_user.preferences.theme == "system"


class TestSettingsEndpoints:
    """Test cases for Settings API endpoints"""
    
    @pytest.mark.anyio
    async def test_get_preferences_creates_defaults(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify GET /user/preferences creates default preferences if none exist"""
        # Ensure no preferences exist
        existing = db_session.query(UserPreferences).filter(
            UserPreferences.user_id == test_user.id
        ).first()
        assert existing is None
        
        response = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Check default values
        assert data["theme"] == "system"
        assert data["notifications_enabled"] is True
        assert data["daily_goal_minutes"] == 30
        assert data["reading_time_units"] == "minutes"
        assert data["auto_save_articles"] is True
        assert data["show_read_time"] is True
        assert data["compact_view"] is False
        
        # Verify preferences were created in database
        created_prefs = db_session.query(UserPreferences).filter(
            UserPreferences.user_id == test_user.id
        ).first()
        assert created_prefs is not None
    
    @pytest.mark.anyio
    async def test_get_preferences_returns_existing(self, db_session: Session, user_with_preferences, auth_headers, async_client):
        """Verify GET /user/preferences returns existing preferences"""
        test_user, existing_prefs = user_with_preferences
        
        response = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["theme"] == "dark"
        assert data["notifications_enabled"] is False
        assert data["daily_goal_minutes"] == 45
        assert data["reading_time_units"] == "hours"
        assert data["auto_save_articles"] is False
        assert data["compact_view"] is True
    
    @pytest.mark.anyio
    async def test_update_preferences_partial(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify PUT /user/preferences updates only provided fields"""
        # Create initial preferences
        await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        
        # Update only some fields
        update_data = {
            "theme": "dark",
            "daily_goal_minutes": 60,
            "compact_view": True
        }
        
        response = await async_client.put(
            "/api/v1/user/preferences",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["updated"] is True
        assert "theme" in data["fields_updated"]
        assert "daily_goal_minutes" in data["fields_updated"]
        assert "compact_view" in data["fields_updated"]
        
        # Verify updated values
        prefs = data["preferences"]
        assert prefs["theme"] == "dark"
        assert prefs["daily_goal_minutes"] == 60
        assert prefs["compact_view"] is True
        # Unchanged fields should retain defaults
        assert prefs["notifications_enabled"] is True
        assert prefs["reading_time_units"] == "minutes"
    
    @pytest.mark.anyio
    async def test_update_preferences_validation(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify PUT /user/preferences validates input"""
        # Test invalid theme
        response = await async_client.put(
            "/api/v1/user/preferences",
            json={"theme": "invalid_theme"},
            headers=auth_headers
        )
        assert response.status_code == 422  # Validation error
        
        # Test invalid daily_goal_minutes (too low)
        response = await async_client.put(
            "/api/v1/user/preferences",
            json={"daily_goal_minutes": 2},
            headers=auth_headers
        )
        assert response.status_code == 422
        
        # Test invalid daily_goal_minutes (too high)
        response = await async_client.put(
            "/api/v1/user/preferences",
            json={"daily_goal_minutes": 500},
            headers=auth_headers
        )
        assert response.status_code == 422
        
        # Test invalid reading_time_units
        response = await async_client.put(
            "/api/v1/user/preferences",
            json={"reading_time_units": "seconds"},
            headers=auth_headers
        )
        assert response.status_code == 422
    
    @pytest.mark.anyio
    async def test_update_preferences_creates_if_not_exist(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify PUT /user/preferences creates preferences if none exist"""
        # Ensure no preferences exist
        existing = db_session.query(UserPreferences).filter(
            UserPreferences.user_id == test_user.id
        ).first()
        assert existing is None
        
        update_data = {
            "theme": "light",
            "notifications_enabled": False
        }
        
        response = await async_client.put(
            "/api/v1/user/preferences",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["updated"] is True
        prefs = data["preferences"]
        assert prefs["theme"] == "light"
        assert prefs["notifications_enabled"] is False
        # Other fields should have defaults
        assert prefs["daily_goal_minutes"] == 30
    
    @pytest.mark.anyio
    async def test_reset_preferences(self, db_session: Session, user_with_preferences, auth_headers, async_client):
        """Verify DELETE /user/preferences resets to defaults"""
        test_user, existing_prefs = user_with_preferences
        
        # Verify existing preferences are not defaults
        assert existing_prefs.theme == "dark"
        assert existing_prefs.notifications_enabled is False
        
        response = await async_client.delete("/api/v1/user/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["reset"] is True
        prefs = data["preferences"]
        
        # Should be back to defaults
        assert prefs["theme"] == "system"
        assert prefs["notifications_enabled"] is True
        assert prefs["daily_goal_minutes"] == 30
        assert prefs["auto_save_articles"] is True
    
    @pytest.mark.anyio
    async def test_get_settings_summary(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify GET /user/settings/summary returns comprehensive info"""
        response = await async_client.get("/api/v1/user/settings/summary", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Check structure
        assert "user" in data
        assert "profile" in data
        assert "preferences" in data
        assert "stats" in data
        
        # Check user info
        user_info = data["user"]
        assert user_info["email"] == test_user.email
        assert user_info["is_active"] is True
        
        # Check profile info
        profile_info = data["profile"]
        assert profile_info["core_industry"] == "Technology"
        
        # Check preferences
        prefs_info = data["preferences"]
        assert "theme" in prefs_info
        assert "notifications_enabled" in prefs_info
        
        # Check stats
        stats_info = data["stats"]
        assert "total_qa_exchanges" in stats_info
        assert "total_saved_articles" in stats_info
        assert "total_recap_sessions" in stats_info
    
    @pytest.mark.anyio
    async def test_authentication_required(self, test_user: User, async_client):
        """Verify authentication is required for all endpoints"""
        # Test get preferences without auth
        response = await async_client.get("/api/v1/user/preferences")
        assert response.status_code == 401
        
        # Test update preferences without auth
        response = await async_client.put("/api/v1/user/preferences", json={"theme": "dark"})
        assert response.status_code == 401
        
        # Test reset preferences without auth
        response = await async_client.delete("/api/v1/user/preferences")
        assert response.status_code == 401
        
        # Test settings summary without auth
        response = await async_client.get("/api/v1/user/settings/summary")
        assert response.status_code == 401
    
    @pytest.mark.anyio
    async def test_preferences_response_structure(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify preferences response has correct structure"""
        response = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        # Check all required fields are present
        required_fields = [
            "theme", "notifications_enabled", "email_notifications", 
            "push_notifications", "daily_goal_minutes", "reading_time_units",
            "auto_save_articles", "show_read_time", "compact_view",
            "share_reading_stats", "public_profile"
        ]
        
        for field in required_fields:
            assert field in data
        
        # Check data types
        assert isinstance(data["theme"], str)
        assert isinstance(data["notifications_enabled"], bool)
        assert isinstance(data["daily_goal_minutes"], int)
        assert isinstance(data["reading_time_units"], str)
        assert isinstance(data["auto_save_articles"], bool)
    
    @pytest.mark.anyio
    async def test_update_preferences_empty_request(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify PUT /user/preferences handles empty request"""
        response = await async_client.put(
            "/api/v1/user/preferences",
            json={},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["updated"] is True
        assert data["fields_updated"] == []  # No fields updated
    
    @pytest.mark.anyio
    async def test_preferences_persistence(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Verify preferences persist across requests"""
        # Update preferences
        update_data = {
            "theme": "dark",
            "daily_goal_minutes": 90,
            "compact_view": True
        }
        
        response1 = await async_client.put(
            "/api/v1/user/preferences",
            json=update_data,
            headers=auth_headers
        )
        assert response1.status_code == 200
        
        # Get preferences in separate request
        response2 = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        assert response2.status_code == 200
        
        data = response2.json()
        assert data["theme"] == "dark"
        assert data["daily_goal_minutes"] == 90
        assert data["compact_view"] is True


class TestPreferencesIntegration:
    """Integration tests for preferences functionality"""
    
    @pytest.mark.anyio
    async def test_complete_preferences_workflow(self, db_session: Session, test_user: User, auth_headers, async_client):
        """Test complete workflow: get defaults, update, reset"""
        # Step 1: Get default preferences (creates them)
        response1 = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        assert response1.status_code == 200
        defaults = response1.json()
        assert defaults["theme"] == "system"
        
        # Step 2: Update some preferences
        updates = {
            "theme": "dark",
            "notifications_enabled": False,
            "daily_goal_minutes": 120,
            "compact_view": True
        }
        
        response2 = await async_client.put("/api/v1/user/preferences", json=updates, headers=auth_headers)
        assert response2.status_code == 200
        updated_data = response2.json()
        assert updated_data["updated"] is True
        
        # Step 3: Verify updates persisted
        response3 = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        assert response3.status_code == 200
        current_prefs = response3.json()
        assert current_prefs["theme"] == "dark"
        assert current_prefs["notifications_enabled"] is False
        assert current_prefs["daily_goal_minutes"] == 120
        assert current_prefs["compact_view"] is True
        
        # Step 4: Reset to defaults
        response4 = await async_client.delete("/api/v1/user/preferences", headers=auth_headers)
        assert response4.status_code == 200
        reset_data = response4.json()
        assert reset_data["reset"] is True
        
        # Step 5: Verify reset worked
        response5 = await async_client.get("/api/v1/user/preferences", headers=auth_headers)
        assert response5.status_code == 200
        final_prefs = response5.json()
        assert final_prefs["theme"] == "system"
        assert final_prefs["notifications_enabled"] is True
        assert final_prefs["daily_goal_minutes"] == 30
        assert final_prefs["compact_view"] is False
