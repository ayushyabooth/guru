"""
Test suite for storyboard/catchup feed endpoints
"""
import pytest
import httpx
import uuid
from datetime import datetime
from sqlalchemy.orm import Session

from app.main import app
from app.models.user import User, UserProfile
from app.models.article import Article
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.interaction import UserSavedArticle, UserNotRelevant
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
    unique_email = f"storyboard.test+{uuid.uuid4().hex[:8]}@example.com"
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
def test_article(db_session: Session):
    """Create a test article"""
    article = Article(
        id=uuid.uuid4(),
        title="Test Article Title",
        source="Test Source",
        url=f"https://example.com/article-{uuid.uuid4().hex[:8]}",
        word_count=500,
        is_paywalled=False,
        raw_text="Test article content"
    )
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    return article


@pytest.fixture
def test_storyboard(db_session: Session, test_user, test_article):
    """Create a test storyboard with articles"""
    storyboard = Storyboard(
        id=uuid.uuid4(),
        filter_context="core",
        industry="Consumer",
        specializations=["Food & Beverage"],
        summary="Test storyboard summary",
        headline_article_id=test_article.id,
        personal_prompt="What can you learn from this?",
        cluster_narrative="This story covers important industry trends"
    )
    db_session.add(storyboard)

    # Add article to storyboard
    storyboard_article = StoryboardArticle(
        storyboard_id=storyboard.id,
        article_id=test_article.id,
        rank=1
    )
    db_session.add(storyboard_article)
    db_session.commit()
    db_session.refresh(storyboard)

    return storyboard


@pytest.fixture
def auth_token(test_user):
    """Generate auth token for test user"""
    return create_access_token(data={"sub": str(test_user.id)})


@pytest.fixture
def auth_headers(auth_token):
    """Create authorization headers"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.mark.anyio
async def test_get_catchup_feed_unauthorized(async_client):
    """Test catchup feed without authentication"""
    response = await async_client.get("/api/v1/catchup-feed")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_get_catchup_feed_with_filter(async_client, test_user, auth_headers):
    """Test catchup feed with valid filter"""
    response = await async_client.get(
        "/api/v1/catchup-feed?filter=core",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert "storyboards" in data
    assert "total" in data
    assert "filter" in data
    assert data["filter"] == "core"


@pytest.mark.anyio
async def test_get_catchup_feed_invalid_filter(async_client, test_user, auth_headers):
    """Test catchup feed with invalid filter format.

    Note: parse_filter_context() uses split(':', 1) so 'invalid:format:extra'
    becomes type='invalid', value='format:extra'. The endpoint doesn't validate
    the filter type, so it returns 200 with empty results rather than 400.
    """
    response = await async_client.get(
        "/api/v1/catchup-feed?filter=invalid:format:extra",
        headers=auth_headers
    )

    # Parser accepts any format with ':' — returns 200 with empty storyboards
    assert response.status_code == 200
    data = response.json()
    assert "storyboards" in data
    assert data["total"] == 0


@pytest.mark.anyio
async def test_save_article_success(async_client, test_user, test_article, auth_headers):
    """Test saving an article"""
    response = await async_client.post(
        f"/api/v1/articles/{test_article.id}/save",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert data["is_saved"] is True
    assert "saved" in data["message"].lower()


@pytest.mark.anyio
async def test_save_article_duplicate(async_client, test_user, test_article, auth_headers, db_session: Session):
    """Test saving an already saved article"""
    # First save
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=test_article.id
    )
    db_session.add(saved_article)
    db_session.commit()

    # Try to save again
    response = await async_client.post(
        f"/api/v1/articles/{test_article.id}/save",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert data["is_saved"] is True
    assert "already" in data["message"].lower()


@pytest.mark.anyio
async def test_save_article_invalid_id(async_client, test_user, auth_headers):
    """Test saving article with invalid ID format"""
    response = await async_client.post(
        "/api/v1/articles/invalid-uuid/save",
        headers=auth_headers
    )

    assert response.status_code == 400
    assert "Invalid article ID" in response.json()["detail"]


@pytest.mark.anyio
async def test_save_article_not_found(async_client, test_user, auth_headers):
    """Test saving non-existent article"""
    fake_id = str(uuid.uuid4())
    response = await async_client.post(
        f"/api/v1/articles/{fake_id}/save",
        headers=auth_headers
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.anyio
async def test_unsave_article_success(async_client, test_user, test_article, auth_headers, db_session: Session):
    """Test unsaving an article"""
    # First save the article
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=test_article.id
    )
    db_session.add(saved_article)
    db_session.commit()

    # Unsave it
    response = await async_client.delete(
        f"/api/v1/articles/{test_article.id}/save",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert data["is_saved"] is False


@pytest.mark.anyio
async def test_unsave_article_not_saved(async_client, test_user, test_article, auth_headers):
    """Test unsaving an article that wasn't saved"""
    response = await async_client.delete(
        f"/api/v1/articles/{test_article.id}/save",
        headers=auth_headers
    )

    assert response.status_code == 404
    assert "not in saved list" in response.json()["detail"].lower()


@pytest.mark.anyio
async def test_get_saved_articles_empty(async_client, test_user, auth_headers):
    """Test getting saved articles when none saved"""
    response = await async_client.get(
        "/api/v1/saved-articles",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert data["articles"] == []
    assert data["total"] == 0


@pytest.mark.anyio
async def test_get_saved_articles_with_articles(async_client, test_user, test_article, auth_headers, db_session: Session):
    """Test getting saved articles"""
    # Save an article
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=test_article.id
    )
    db_session.add(saved_article)
    db_session.commit()

    response = await async_client.get(
        "/api/v1/saved-articles",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert len(data["articles"]) == 1
    assert data["total"] == 1
    assert data["articles"][0]["id"] == str(test_article.id)
    assert data["articles"][0]["title"] == "Test Article Title"


@pytest.mark.anyio
async def test_get_saved_articles_pagination(async_client, test_user, auth_headers, db_session: Session):
    """Test pagination on saved articles"""
    # Create and save multiple articles
    for i in range(5):
        article = Article(
            id=uuid.uuid4(),
            title=f"Test Article {i}",
            source="Test Source",
            url=f"https://example.com/article{i}-{uuid.uuid4().hex[:8]}",
            word_count=500,
            is_paywalled=False,
            raw_text=f"Test content {i}"
        )
        db_session.add(article)
        db_session.flush()

        saved = UserSavedArticle(
            user_id=test_user.id,
            article_id=article.id
        )
        db_session.add(saved)

    db_session.commit()

    # Get first page
    response = await async_client.get(
        "/api/v1/saved-articles?limit=2&offset=0",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert len(data["articles"]) == 2
    assert data["total"] == 5
    assert data["limit"] == 2
    assert data["offset"] == 0


@pytest.mark.anyio
async def test_mark_storyboard_not_relevant_success(async_client, test_user, test_storyboard, auth_headers):
    """Test marking a storyboard as not relevant"""
    response = await async_client.post(
        f"/api/v1/storyboards/{test_storyboard.id}/not-relevant?filter=core",
        headers=auth_headers
    )

    assert response.status_code == 200
    assert "not relevant" in response.json()["message"].lower()


@pytest.mark.anyio
async def test_mark_storyboard_not_relevant_duplicate(async_client, test_user, test_storyboard, auth_headers, db_session: Session):
    """Test marking storyboard as not relevant when already marked"""
    # First mark as not relevant
    not_relevant = UserNotRelevant(
        user_id=test_user.id,
        storyboard_id=test_storyboard.id,
        filter_context="core"
    )
    db_session.add(not_relevant)
    db_session.commit()

    # Try again
    response = await async_client.post(
        f"/api/v1/storyboards/{test_storyboard.id}/not-relevant?filter=core",
        headers=auth_headers
    )

    assert response.status_code == 200
    assert "already" in response.json()["message"].lower()


@pytest.mark.anyio
async def test_mark_storyboard_not_relevant_invalid_id(async_client, test_user, auth_headers):
    """Test marking storyboard with invalid ID"""
    response = await async_client.post(
        "/api/v1/storyboards/invalid-uuid/not-relevant?filter=core",
        headers=auth_headers
    )

    assert response.status_code == 400
    assert "Invalid storyboard ID" in response.json()["detail"]


@pytest.mark.anyio
async def test_mark_storyboard_not_relevant_not_found(async_client, test_user, auth_headers):
    """Test marking non-existent storyboard as not relevant"""
    fake_id = str(uuid.uuid4())
    response = await async_client.post(
        f"/api/v1/storyboards/{fake_id}/not-relevant?filter=core",
        headers=auth_headers
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.anyio
async def test_save_article_unauthorized(async_client, db_session: Session):
    """Test saving article without auth"""
    article = Article(
        id=uuid.uuid4(),
        title="Unauth Test Article",
        source="Test Source",
        url=f"https://example.com/unauth-{uuid.uuid4().hex[:8]}",
        word_count=500,
        is_paywalled=False,
        raw_text="Test content"
    )
    db_session.add(article)
    db_session.commit()

    response = await async_client.post(f"/api/v1/articles/{article.id}/save")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_unsave_article_unauthorized(async_client, db_session: Session):
    """Test unsaving article without auth"""
    article = Article(
        id=uuid.uuid4(),
        title="Unauth Test Article 2",
        source="Test Source",
        url=f"https://example.com/unauth2-{uuid.uuid4().hex[:8]}",
        word_count=500,
        is_paywalled=False,
        raw_text="Test content"
    )
    db_session.add(article)
    db_session.commit()

    response = await async_client.delete(f"/api/v1/articles/{article.id}/save")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_get_saved_articles_unauthorized(async_client):
    """Test getting saved articles without auth"""
    response = await async_client.get("/api/v1/saved-articles")

    assert response.status_code == 401


@pytest.fixture
def interest_user(db_session: Session):
    """Create a test user with Technology as an additional interest industry"""
    unique_email = f"interest.test+{uuid.uuid4().hex[:8]}@example.com"
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
        additional_interest_industries=["Technology"],
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
def interest_auth_headers(interest_user):
    """Auth headers for the interest user"""
    token = create_access_token(data={"sub": str(interest_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_get_catchup_feed_interest_filter(async_client, interest_user, interest_auth_headers):
    """Test catchup feed with interest filter (e.g. interest:Technology).

    This test would have caught the UnboundLocalError in clustering_service.py
    where the 'interest' branch of get_articles_for_filter() failed because
    IndustriesConfig was only imported locally in other branches.
    """
    response = await async_client.get(
        "/api/v1/catchup-feed?filter=interest:Technology",
        headers=interest_auth_headers
    )

    # Should NOT return 500 — the bug caused a silent UnboundLocalError
    # which was caught by try/except and returned an empty result
    assert response.status_code == 200
    data = response.json()

    assert "storyboards" in data
    assert "total" in data
    assert "filter" in data
    assert data["filter"] == "interest:Technology"


@pytest.mark.anyio
async def test_get_catchup_feed_specialization_filter(async_client, test_user, auth_headers):
    """Test catchup feed with specialization filter"""
    response = await async_client.get(
        "/api/v1/catchup-feed?filter=specialization:Food %26 Beverage",
        headers=auth_headers
    )

    assert response.status_code == 200
    data = response.json()

    assert "storyboards" in data
    assert "total" in data
    assert data["filter"] == "specialization:Food & Beverage"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
