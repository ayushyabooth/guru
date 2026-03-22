"""
Test suite for Save Article -> Dive In Feed flow
Verifies that saving articles from Catch-up storyboards correctly adds them to Dive In feed
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import app
from app.db.database import SessionLocal, create_tables
from app.models.user import User
from app.models.article import Article, ExpertNote
from app.models.interaction import UserSavedArticle
import uuid


@pytest.fixture(scope="module")
def test_client():
    """Create test client"""
    create_tables()
    return TestClient(app)


@pytest.fixture(scope="function")
def db():
    """Create database session for tests"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def test_user(db: Session):
    """Create test user and return auth token"""
    # Create user
    user = User(
        id=uuid.uuid4(),
        email=f"test_{uuid.uuid4()}@example.com",
        password_hash="hashed_password",
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    return user


@pytest.fixture(scope="function")
def test_articles(db: Session):
    """Create test articles with different priorities"""
    articles = []
    
    # Create 3 Essential articles
    for i in range(3):
        article = Article(
            id=uuid.uuid4(),
            url=f"https://example.com/essential-{i}",
            title=f"Essential Article {i}",
            source="Test Source",
            raw_text=f"Content for essential article {i}",
            word_count=500,
            is_paywalled=False
        )
        db.add(article)
        db.flush()
        
        # Add expert note marking as Essential
        note = ExpertNote(
            id=uuid.uuid4(),
            expert_id=uuid.uuid4(),
            article_id=article.id,
            notes_text=f"Expert notes for article {i}",
            priority="Essential",
            expert_industry="Consumer",
            expert_specializations=["CPG"]
        )
        db.add(note)
        articles.append(article)
    
    # Create 2 Normal articles (for saving)
    for i in range(2):
        article = Article(
            id=uuid.uuid4(),
            url=f"https://example.com/normal-{i}",
            title=f"Normal Article {i}",
            source="Test Source",
            raw_text=f"Content for normal article {i}",
            word_count=500,
            is_paywalled=False
        )
        db.add(article)
        db.flush()
        
        # Add expert note marking as Normal
        note = ExpertNote(
            id=uuid.uuid4(),
            expert_id=uuid.uuid4(),
            article_id=article.id,
            notes_text=f"Expert notes for article {i}",
            priority="Normal",
            expert_industry="Consumer",
            expert_specializations=["CPG"]
        )
        db.add(note)
        articles.append(article)
    
    db.commit()
    return articles


def get_auth_token(test_client: TestClient, user: User) -> str:
    """Get authentication token for user"""
    # For testing, we'll create a token manually
    from app.utils.auth import create_access_token
    return create_access_token(str(user.id))


class TestSaveArticleDiveInFlow:
    """Test suite for save article -> Dive In feed flow"""
    
    def test_initial_divein_feed_shows_only_essential(self, test_client, test_user, test_articles, db):
        """Test that Dive In feed initially shows only Essential articles"""
        token = get_auth_token(test_client, test_user)
        
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        articles = data["articles"]
        
        # Should have 3 Essential articles
        assert len(articles) == 3
        assert all(a["is_essential"] for a in articles)
        assert all(not a["is_saved"] for a in articles)
    
    def test_save_article_from_catchup(self, test_client, test_user, test_articles, db):
        """Test saving an article from Catch-up storyboard"""
        token = get_auth_token(test_client, test_user)
        
        # Get a Normal article to save (4th article in list)
        article_to_save = test_articles[3]
        
        # Save the article
        response = test_client.post(
            f"/api/v1/articles/{article_to_save.id}/save",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Article saved successfully"
        assert data["is_saved"] is True
        
        # Verify in database
        saved_record = db.query(UserSavedArticle).filter(
            UserSavedArticle.user_id == test_user.id,
            UserSavedArticle.article_id == article_to_save.id
        ).first()
        
        assert saved_record is not None
    
    def test_saved_article_appears_in_divein_feed(self, test_client, test_user, test_articles, db):
        """Test that saved article appears in Dive In feed"""
        token = get_auth_token(test_client, test_user)
        
        # Save a Normal article
        article_to_save = test_articles[3]
        test_client.post(
            f"/api/v1/articles/{article_to_save.id}/save",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Get Dive In feed
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        articles = data["articles"]
        
        # Should now have 4 articles (3 Essential + 1 Saved)
        assert len(articles) == 4
        
        # Find the saved article
        saved_articles = [a for a in articles if a["is_saved"]]
        assert len(saved_articles) == 1
        assert saved_articles[0]["id"] == str(article_to_save.id)
        assert saved_articles[0]["priority"] == "saved"
    
    def test_saved_articles_appear_at_top_of_feed(self, test_client, test_user, test_articles, db):
        """Test that saved articles appear at the top of Dive In feed"""
        token = get_auth_token(test_client, test_user)
        
        # Save both Normal articles
        for article in test_articles[3:5]:
            test_client.post(
                f"/api/v1/articles/{article.id}/save",
                headers={"Authorization": f"Bearer {token}"}
            )
        
        # Get Dive In feed
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        articles = data["articles"]
        
        # Should have 5 articles (3 Essential + 2 Saved)
        assert len(articles) == 5
        
        # First 2 articles should be the saved ones
        assert articles[0]["is_saved"] is True
        assert articles[1]["is_saved"] is True
        assert articles[0]["priority"] == "saved"
        assert articles[1]["priority"] == "saved"
        
        # Remaining articles should be Essential
        for article in articles[2:]:
            assert article["is_essential"] is True
            assert not article["is_saved"]
    
    def test_unsave_article_removes_from_divein_feed(self, test_client, test_user, test_articles, db):
        """Test that unsaving an article removes it from Dive In feed (if not Essential)"""
        token = get_auth_token(test_client, test_user)
        
        # Save a Normal article
        article_to_save = test_articles[3]
        test_client.post(
            f"/api/v1/articles/{article_to_save.id}/save",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Verify it appears in feed
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert len(response.json()["articles"]) == 4
        
        # Unsave the article
        response = test_client.delete(
            f"/api/v1/articles/{article_to_save.id}/save",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        
        # Verify it's removed from feed
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        articles = response.json()["articles"]
        assert len(articles) == 3  # Back to just Essential articles
        assert all(a["is_essential"] for a in articles)
    
    def test_save_essential_article_shows_both_flags(self, test_client, test_user, test_articles, db):
        """Test that saving an Essential article shows both is_saved and is_essential flags"""
        token = get_auth_token(test_client, test_user)
        
        # Save an Essential article
        essential_article = test_articles[0]
        test_client.post(
            f"/api/v1/articles/{essential_article.id}/save",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        # Get Dive In feed
        response = test_client.get(
            "/api/v1/divein-feed?limit=10",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        articles = response.json()["articles"]
        
        # Find the saved Essential article (should be first)
        saved_essential = articles[0]
        assert saved_essential["id"] == str(essential_article.id)
        assert saved_essential["is_saved"] is True
        assert saved_essential["is_essential"] is True
        assert saved_essential["priority"] == "essential"  # Priority is still essential
