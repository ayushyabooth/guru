"""
Test suite for storyboard feed API endpoints
"""
import pytest
import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from sqlalchemy.orm import Session

from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.interaction import UserSavedArticle, UserNotRelevant
from app.services.auth_service import generate_jwt, verify_jwt
from app.services.clustering_service import get_or_build_storyboards_for_filter, parse_filter_context
from app.services.summary_service import generate_personal_prompt


@pytest.fixture
def db_session():
    """Mock database session"""
    return MagicMock(spec=Session)


@pytest.fixture
def test_user():
    """Test user fixture"""
    user_id = uuid.uuid4()
    return User(
        id=user_id,
        email="test@example.com",
        password_hash="hashed_password",
        is_active=True
    )


@pytest.fixture
def test_user_profile(test_user):
    """Test user profile fixture"""
    return UserProfile(
        user_id=test_user.id,
        core_industry="Technology",
        specializations=["Software Development", "AI"],
        additional_interest_industries=["Healthcare"],
        total_weekly_capacity_band="~2h",
        catchup_daily_goal_minutes=20,
        catchup_daily_max_minutes=45,
        divein_weekly_goal_minutes=90,
        recap_weekly_goal_minutes=30
    )


@pytest.fixture
def test_article():
    """Test article fixture"""
    article_id = uuid.uuid4()
    return Article(
        id=article_id,
        title="Test Article",
        source="Test Source",
        url="https://example.com/test",
        word_count=500,
        is_paywalled=False,
        created_at=datetime.now(timezone.utc)
    )


@pytest.fixture
def test_storyboard(test_article):
    """Test storyboard fixture"""
    storyboard_id = uuid.uuid4()
    return Storyboard(
        id=storyboard_id,
        headline_article_id=test_article.id,
        industry="Technology",
        specializations=["Software Development"],
        summary="Test storyboard summary",
        created_at=datetime.now(timezone.utc)
    )


@pytest.fixture
def auth_headers(test_user):
    """Authentication headers fixture"""
    token = generate_jwt(str(test_user.id), "access")
    return {"Authorization": f"Bearer {token}"}


class TestCatchupFeed:
    """Test cases for catchup feed functionality"""
    
    @patch('app.services.clustering_service.get_or_build_storyboards_for_filter')
    @patch('app.services.clustering_service.parse_filter_context')
    def test_get_catchup_feed_with_core_filter(
        self, 
        mock_parse_filter,
        mock_get_storyboards,
        db_session,
        test_user,
        test_storyboard
    ):
        """Test catchup feed with core filter"""
        # Setup mocks
        mock_get_db.return_value = db_session
        mock_parse_filter.return_value = {"type": "core"}
        mock_get_storyboards.return_value = [test_storyboard]
        mock_generate_prompt.return_value = {"prompt": "Test personal prompt"}
        
        # Mock database queries
        db_session.query.return_value.filter.return_value.first.side_effect = [
            None,  # UserNotRelevant query
            test_article,  # Article query for headline
            None,  # UserSavedArticle query
        ]
        
        # Mock StoryboardArticle query
        mock_storyboard_article = MagicMock()
        mock_storyboard_article.article_id = test_article.id
        mock_storyboard_article.rank = 1
        db_session.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_storyboard_article]
        
        # Make request
        response = client.get("/catchup-feed?filter=core&limit=5&offset=0", headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert "storyboards" in data
        assert data["filter"] == "core"
        assert data["limit"] == 5
        assert data["offset"] == 0
        assert len(data["storyboards"]) <= 5
        
        # Verify storyboard structure
        if data["storyboards"]:
            storyboard = data["storyboards"][0]
            assert "id" in storyboard
            assert "summary" in storyboard
            assert "personal_prompt" in storyboard
            assert "headline_article" in storyboard
            assert "related_articles" in storyboard
    
    @patch('app.routes.storyboards.get_db')
    @patch('app.services.clustering_service.get_or_build_storyboards_for_filter')
    @patch('app.services.clustering_service.parse_filter_context')
    def test_get_catchup_feed_with_specialization_filter(
        self,
        mock_parse_filter,
        mock_get_storyboards,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_storyboard,
        auth_headers
    ):
        """Test catchup feed with specialization filter"""
        # Setup mocks
        mock_get_db.return_value = db_session
        mock_parse_filter.return_value = {"type": "specialization", "value": "AI"}
        mock_get_storyboards.return_value = [test_storyboard]
        
        # Mock database queries
        db_session.query.return_value.filter.return_value.first.return_value = None
        
        # Make request
        response = client.get("/catchup-feed?filter=specialization:AI&limit=3", headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["filter"] == "specialization:AI"
        assert data["limit"] == 3
    
    @patch('app.routes.storyboards.get_db')
    @patch('app.services.clustering_service.get_or_build_storyboards_for_filter')
    @patch('app.services.clustering_service.parse_filter_context')
    def test_pagination(
        self,
        mock_parse_filter,
        mock_get_storyboards,
        mock_get_db,
        client,
        db_session,
        test_user,
        auth_headers
    ):
        """Test pagination in catchup feed"""
        # Create multiple test storyboards
        storyboards = []
        for i in range(10):
            storyboard = MagicMock()
            storyboard.id = uuid.uuid4()
            storyboard.headline_article_id = uuid.uuid4()
            storyboard.summary = f"Test summary {i}"
            storyboard.industry = "Technology"
            storyboard.specializations = ["AI"]
            storyboard.created_at = datetime.now(timezone.utc)
            storyboards.append(storyboard)
        
        # Setup mocks
        mock_get_db.return_value = db_session
        mock_parse_filter.return_value = {"type": "core"}
        mock_get_storyboards.return_value = storyboards
        
        # Mock database queries to return None (no not-relevant records)
        db_session.query.return_value.filter.return_value.first.return_value = None
        
        # Test first page
        response = client.get("/catchup-feed?filter=core&limit=5&offset=0", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 10
        assert data["limit"] == 5
        assert data["offset"] == 0
        
        # Test second page
        response = client.get("/catchup-feed?filter=core&limit=5&offset=5", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["offset"] == 5
    
    def test_catchup_feed_unauthorized(self, client):
        """Test catchup feed without authentication"""
        response = client.get("/catchup-feed")
        assert response.status_code == 401
    
    @patch('app.routes.storyboards.get_db')
    @patch('app.services.clustering_service.parse_filter_context')
    def test_catchup_feed_invalid_filter(
        self,
        mock_parse_filter,
        mock_get_db,
        client,
        db_session,
        auth_headers
    ):
        """Test catchup feed with invalid filter"""
        mock_get_db.return_value = db_session
        mock_parse_filter.return_value = None  # Invalid filter
        
        response = client.get("/catchup-feed?filter=invalid", headers=auth_headers)
        assert response.status_code == 400


class TestSaveArticle:
    """Test cases for POST /articles/{id}/save endpoint"""
    
    @patch('app.routes.storyboards.get_db')
    def test_save_article(
        self,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_article,
        auth_headers
    ):
        """Test saving an article"""
        # Setup mocks
        mock_get_db.return_value = db_session
        
        # Mock article exists
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_article,  # Article exists
            None,  # Not already saved
        ]
        
        # Make request
        response = client.post(f"/articles/{test_article.id}/save", headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Article saved successfully"
        assert data["is_saved"] is True
        
        # Verify database operations
        db_session.add.assert_called_once()
        db_session.commit.assert_called_once()
    
    @patch('app.routes.storyboards.get_db')
    def test_save_article_already_saved(
        self,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_article,
        auth_headers
    ):
        """Test saving an already saved article"""
        # Setup mocks
        mock_get_db.return_value = db_session
        
        # Mock article exists and is already saved
        saved_article = UserSavedArticle(user_id=test_user.id, article_id=test_article.id)
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_article,  # Article exists
            saved_article,  # Already saved
        ]
        
        # Make request
        response = client.post(f"/articles/{test_article.id}/save", headers=auth_headers)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Article already saved"
        assert data["is_saved"] is True
    
    @patch('app.routes.storyboards.get_db')
    def test_save_article_not_found(
        self,
        mock_get_db,
        client,
        db_session,
        auth_headers
    ):
        """Test saving a non-existent article"""
        # Setup mocks
        mock_get_db.return_value = db_session
        db_session.query.return_value.filter.return_value.first.return_value = None
        
        # Make request
        article_id = str(uuid.uuid4())
        response = client.post(f"/articles/{article_id}/save", headers=auth_headers)
        
        # Assertions
        assert response.status_code == 404
        data = response.json()
        assert data["detail"] == "Article not found"
    
    def test_save_article_invalid_id(self, client, auth_headers):
        """Test saving article with invalid ID format"""
        response = client.post("/articles/invalid-id/save", headers=auth_headers)
        assert response.status_code == 400
        data = response.json()
        assert data["detail"] == "Invalid article ID format"
    
    def test_save_article_unauthorized(self, client, test_article):
        """Test saving article without authentication"""
        response = client.post(f"/articles/{test_article.id}/save")
        assert response.status_code == 401


class TestMarkNotRelevant:
    """Test cases for POST /storyboards/{id}/not-relevant endpoint"""
    
    @patch('app.routes.storyboards.get_db')
    def test_mark_not_relevant_per_filter(
        self,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_storyboard,
        auth_headers
    ):
        """Test marking storyboard as not relevant for specific filter"""
        # Setup mocks
        mock_get_db.return_value = db_session
        
        # Mock storyboard exists and not already marked
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_storyboard,  # Storyboard exists
            None,  # Not already marked as not relevant
        ]
        
        # Make request
        response = client.post(
            f"/storyboards/{test_storyboard.id}/not-relevant?filter=core",
            headers=auth_headers
        )
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Storyboard marked as not relevant for this filter"
        
        # Verify database operations
        db_session.add.assert_called_once()
        db_session.commit.assert_called_once()
    
    @patch('app.routes.storyboards.get_db')
    def test_mark_not_relevant_already_marked(
        self,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_storyboard,
        auth_headers
    ):
        """Test marking storyboard that's already marked as not relevant"""
        # Setup mocks
        mock_get_db.return_value = db_session
        
        # Mock storyboard exists and already marked
        not_relevant = UserNotRelevant(
            user_id=test_user.id,
            storyboard_id=test_storyboard.id,
            filter_context="core"
        )
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_storyboard,  # Storyboard exists
            not_relevant,  # Already marked as not relevant
        ]
        
        # Make request
        response = client.post(
            f"/storyboards/{test_storyboard.id}/not-relevant?filter=core",
            headers=auth_headers
        )
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Storyboard already marked as not relevant for this filter"
    
    @patch('app.routes.storyboards.get_db')
    def test_mark_not_relevant_storyboard_not_found(
        self,
        mock_get_db,
        client,
        db_session,
        auth_headers
    ):
        """Test marking non-existent storyboard as not relevant"""
        # Setup mocks
        mock_get_db.return_value = db_session
        db_session.query.return_value.filter.return_value.first.return_value = None
        
        # Make request
        storyboard_id = str(uuid.uuid4())
        response = client.post(
            f"/storyboards/{storyboard_id}/not-relevant?filter=core",
            headers=auth_headers
        )
        
        # Assertions
        assert response.status_code == 404
        data = response.json()
        assert data["detail"] == "Storyboard not found"
    
    def test_mark_not_relevant_invalid_id(self, client, auth_headers):
        """Test marking storyboard with invalid ID format"""
        response = client.post(
            "/storyboards/invalid-id/not-relevant?filter=core",
            headers=auth_headers
        )
        assert response.status_code == 400
        data = response.json()
        assert data["detail"] == "Invalid storyboard ID format"
    
    def test_mark_not_relevant_unauthorized(self, client, test_storyboard):
        """Test marking storyboard without authentication"""
        response = client.post(f"/storyboards/{test_storyboard.id}/not-relevant?filter=core")
        assert response.status_code == 401


class TestIntegration:
    """Integration tests for storyboard feed functionality"""
    
    @patch('app.routes.storyboards.get_db')
    @patch('app.services.clustering_service.get_or_build_storyboards_for_filter')
    @patch('app.services.clustering_service.parse_filter_context')
    def test_full_workflow(
        self,
        mock_parse_filter,
        mock_get_storyboards,
        mock_get_db,
        client,
        db_session,
        test_user,
        test_article,
        test_storyboard,
        auth_headers
    ):
        """Test full workflow: get feed, save article, mark not relevant"""
        # Setup mocks
        mock_get_db.return_value = db_session
        mock_parse_filter.return_value = {"type": "core"}
        mock_get_storyboards.return_value = [test_storyboard]
        
        # Mock database queries for feed
        db_session.query.return_value.filter.return_value.first.side_effect = [
            None,  # UserNotRelevant query
            test_article,  # Article query for headline
            None,  # UserSavedArticle query
        ]
        
        # Mock StoryboardArticle query
        mock_storyboard_article = MagicMock()
        mock_storyboard_article.article_id = test_article.id
        mock_storyboard_article.rank = 1
        db_session.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_storyboard_article]
        
        # 1. Get catchup feed
        response = client.get("/catchup-feed?filter=core", headers=auth_headers)
        assert response.status_code == 200
        
        # 2. Save article
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_article,  # Article exists
            None,  # Not already saved
        ]
        response = client.post(f"/articles/{test_article.id}/save", headers=auth_headers)
        assert response.status_code == 200
        
        # 3. Mark storyboard as not relevant
        db_session.query.return_value.filter.return_value.first.side_effect = [
            test_storyboard,  # Storyboard exists
            None,  # Not already marked as not relevant
        ]
        response = client.post(
            f"/storyboards/{test_storyboard.id}/not-relevant?filter=core",
            headers=auth_headers
        )
        assert response.status_code == 200
