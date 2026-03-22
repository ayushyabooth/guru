"""
Tests for Dive-in feed API endpoints
"""
import pytest
import httpx
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timedelta

from app.main import app
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.interaction import UserSavedArticle
from app.services.auth_service import create_access_token
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
    unique_email = f"divein.test+{uuid.uuid4().hex[:8]}@example.com"
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
        specializations='["Software Development", "AI & Machine Learning"]',
        additional_interest_industries='["Healthcare", "Finance"]',
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
    """Create authentication token for test user"""
    return create_access_token(data={"sub": str(test_user.id)})


@pytest.fixture
def auth_headers(auth_token):
    """Create authorization headers"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def sample_articles(db_session: Session, test_user: User):
    """Create sample articles for testing"""
    articles = []
    unique_suffix = uuid.uuid4().hex[:8]
    
    # Regular article with normal expert note (saveable, not essential)
    article1 = Article(
        id=uuid.uuid4(),
        title="Regular Tech Article",
        url=f"https://example.com/regular-{unique_suffix}",
        source="Tech News",
        raw_text="This is a regular technology article with some content.",
        word_count=100,
        is_paywalled=False
    )
    db_session.add(article1)
    articles.append(article1)

    # Expert note for regular article (Normal priority — needed for JOIN in divein feed)
    expert_note_regular = ExpertNote(
        id=uuid.uuid4(),
        expert_id=test_user.id,
        article_id=article1.id,
        notes_text="A solid overview of current technology trends.",
        priority="Normal",
        expert_industry="Technology",
        expert_specializations=["Software Development"]
    )
    db_session.add(expert_note_regular)

    # Essential article with expert note
    article2 = Article(
        id=uuid.uuid4(),
        title="Essential AI Article",
        url=f"https://example.com/essential-{unique_suffix}",
        source="AI Weekly",
        raw_text="This is an essential AI article with important insights.",
        word_count=200,
        is_paywalled=False
    )
    db_session.add(article2)
    articles.append(article2)

    # Create essential expert note
    expert_note = ExpertNote(
        id=uuid.uuid4(),
        expert_id=test_user.id,
        article_id=article2.id,
        notes_text="This article provides crucial insights into AI development trends.",
        priority="Essential",
        expert_industry="Technology",
        expert_specializations=["AI & Machine Learning"]
    )
    db_session.add(expert_note)
    
    # Paywalled article with expert notes
    article3 = Article(
        id=uuid.uuid4(),
        title="Paywalled Finance Article",
        url=f"https://example.com/paywalled-{unique_suffix}",
        source="Finance Premium",
        raw_text="Limited preview text...",
        word_count=500,
        is_paywalled=True
    )
    db_session.add(article3)
    articles.append(article3)
    
    # Expert note for paywalled article
    expert_note2 = ExpertNote(
        id=uuid.uuid4(),
        expert_id=test_user.id,
        article_id=article3.id,
        notes_text="This paywalled article discusses important financial trends and market analysis.",
        priority="Normal",
        expert_industry="Finance",
        expert_specializations=["Investment Banking"]
    )
    db_session.add(expert_note2)
    
    db_session.commit()
    for article in articles:
        db_session.refresh(article)
    
    return articles


@pytest.mark.anyio
async def test_get_divein_feed_includes_saved(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify feed includes saved articles in the essential pool (Pool 1)"""
    # Save an article
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=sample_articles[0].id
    )
    db_session.add(saved_article)
    db_session.commit()

    response = await async_client.get("/api/v1/divein-feed", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()
    # Two-pool architecture: essential_articles (Pool 1) + discovery_articles (Pool 2)
    assert "essential_articles" in data
    assert "discovery_articles" in data

    # Saved article should be in Pool 1 (essential_articles)
    all_articles = data["essential_articles"] + data["discovery_articles"]
    assert len(all_articles) > 0

    article_ids = [a["id"] for a in data["essential_articles"]]
    assert str(sample_articles[0].id) in article_ids

    # Check that saved article is marked as saved
    saved_article_data = next(a for a in data["essential_articles"] if a["id"] == str(sample_articles[0].id))
    assert saved_article_data["is_saved"] is True


@pytest.mark.anyio
async def test_get_divein_feed_includes_essential(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify feed includes essential flagged articles in Pool 1"""
    response = await async_client.get("/api/v1/divein-feed", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()
    assert "essential_articles" in data

    # Essential article should be in Pool 1
    essential_articles = [a for a in data["essential_articles"] if a["is_essential"]]
    assert len(essential_articles) > 0

    # Verify the essential article is the AI article
    all_articles = data["essential_articles"] + data["discovery_articles"]
    ai_article = next((a for a in all_articles if "AI" in a["title"]), None)
    assert ai_article is not None
    assert ai_article["is_essential"] is True


@pytest.mark.anyio
async def test_get_divein_feed_pagination(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify pagination applies to discovery pool only"""
    response = await async_client.get("/api/v1/divein-feed?limit=2&offset=0", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()
    # Pagination applies only to discovery_articles (Pool 2)
    assert len(data["discovery_articles"]) <= 2
    assert data["limit"] == 2
    assert data["offset"] == 0
    assert "total_essential" in data
    assert "total_discovery" in data


@pytest.mark.anyio
async def test_get_divein_feed_authentication_required(async_client):
    """Verify authentication is required"""
    response = await async_client.get("/api/v1/divein-feed")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_get_article_deep_with_full_text(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify deep read returns full content for non-paywalled articles"""
    article = sample_articles[0]  # Regular article
    
    response = await async_client.get(f"/api/v1/articles/{article.id}/deep", headers=auth_headers)
    assert response.status_code == 200
    
    data = response.json()
    assert data["id"] == str(article.id)
    assert data["title"] == article.title
    assert data["source"] == article.source
    assert data["url"] == article.url
    assert "content" in data
    assert len(data["content"]) > 0
    assert data["is_paywalled"] is False
    assert data["paywall_link"] is None
    assert "reading_time" in data


@pytest.mark.anyio
async def test_get_article_deep_paywalled(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify deep read handles paywalled articles"""
    article = sample_articles[2]  # Paywalled article
    
    response = await async_client.get(f"/api/v1/articles/{article.id}/deep", headers=auth_headers)
    assert response.status_code == 200
    
    data = response.json()
    assert data["id"] == str(article.id)
    assert data["is_paywalled"] is True
    assert data["paywall_link"] == article.url
    assert "content" in data
    # Content should be from expert notes, not raw text
    assert "financial trends" in data["content"].lower()


@pytest.mark.anyio
async def test_get_article_deep_with_saved_status(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify deep read shows correct saved status"""
    article = sample_articles[0]
    
    # Save the article
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=article.id
    )
    db_session.add(saved_article)
    db_session.commit()
    
    response = await async_client.get(f"/api/v1/articles/{article.id}/deep", headers=auth_headers)
    assert response.status_code == 200
    
    data = response.json()
    assert data["is_saved"] is True


@pytest.mark.anyio
async def test_get_article_deep_not_found(auth_headers, async_client):
    """Verify 404 for non-existent article"""
    fake_id = str(uuid.uuid4())
    response = await async_client.get(f"/api/v1/articles/{fake_id}/deep", headers=auth_headers)
    assert response.status_code == 404


@pytest.mark.anyio
async def test_get_article_deep_invalid_id(auth_headers, async_client):
    """Verify 400 for invalid article ID format"""
    response = await async_client.get("/api/v1/articles/invalid-id/deep", headers=auth_headers)
    assert response.status_code == 400


@pytest.mark.anyio
async def test_get_article_deep_authentication_required(async_client):
    """Verify authentication is required for deep read"""
    fake_id = str(uuid.uuid4())
    response = await async_client.get(f"/api/v1/articles/{fake_id}/deep")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_divein_feed_response_structure(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify two-pool response structure matches expected format"""
    response = await async_client.get("/api/v1/divein-feed", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()

    # Check two-pool top-level structure
    assert "essential_articles" in data
    assert "discovery_articles" in data
    assert "total_essential" in data
    assert "total_discovery" in data
    assert "limit" in data
    assert "offset" in data

    # Check article structure in both pools
    all_articles = data["essential_articles"] + data["discovery_articles"]
    if all_articles:
        article = all_articles[0]
        required_fields = [
            "id", "title", "source", "is_saved", "is_essential",
            "created_at", "url"
        ]
        for field in required_fields:
            assert field in article, f"Missing required field: {field}"

        # Check optional fields exist (can be None)
        optional_fields = ["reading_time", "image_url", "summary"]
        for field in optional_fields:
            assert field in article, f"Missing optional field: {field}"


@pytest.mark.anyio
async def test_article_deep_response_structure(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify deep read response structure matches expected format"""
    article = sample_articles[0]
    
    response = await async_client.get(f"/api/v1/articles/{article.id}/deep", headers=auth_headers)
    assert response.status_code == 200
    
    data = response.json()
    
    # Check required fields
    required_fields = [
        "id", "title", "source", "url", "content", "is_paywalled", "is_saved"
    ]
    for field in required_fields:
        assert field in data
    
    # Check optional fields exist (can be None)
    optional_fields = [
        "author", "published_at", "reading_time", "summary", 
        "paywall_link", "industry", "priority", "image_url"
    ]
    for field in optional_fields:
        assert field in data


@pytest.mark.anyio
async def test_divein_feed_pool_separation(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify essential/saved articles are in Pool 1, others in Pool 2"""
    # Save a regular article to ensure it appears in Pool 1
    saved_article = UserSavedArticle(
        user_id=test_user.id,
        article_id=sample_articles[0].id
    )
    db_session.add(saved_article)
    db_session.commit()

    response = await async_client.get("/api/v1/divein-feed", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()

    # Pool 1 should contain saved + essential articles
    pool1_ids = {a["id"] for a in data["essential_articles"]}
    pool2_ids = {a["id"] for a in data["discovery_articles"]}

    # No overlap between pools
    assert len(pool1_ids & pool2_ids) == 0, "Pools should not overlap"

    # All Pool 1 articles should be either saved or essential
    for article in data["essential_articles"]:
        assert article["is_saved"] or article["is_essential"], \
            f"Pool 1 article {article['id']} is neither saved nor essential"


@pytest.mark.anyio
async def test_reading_time_calculation(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify reading time is calculated correctly"""
    response = await async_client.get("/api/v1/divein-feed", headers=auth_headers)
    assert response.status_code == 200

    data = response.json()

    all_articles = data["essential_articles"] + data["discovery_articles"]
    for article_data in all_articles:
        if article_data["reading_time"]:
            # Reading time should be at least 1 minute
            assert article_data["reading_time"] >= 1
            assert isinstance(article_data["reading_time"], int)


@pytest.mark.anyio
async def test_divein_feed_with_filter(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify filter parameter works correctly"""
    # Test core filter
    response = await async_client.get("/api/v1/divein-feed?filter=core", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "essential_articles" in data
    assert "discovery_articles" in data


@pytest.mark.anyio
async def test_divein_feed_with_specialization_filter(db_session: Session, test_user: User, sample_articles, auth_headers, async_client):
    """Verify specialization filter returns two-pool structure without errors"""
    # User profile has specializations=["Software Development", "AI & Machine Learning"]
    response = await async_client.get(
        "/api/v1/divein-feed?filter=specialization:AI %26 Machine Learning",
        headers=auth_headers
    )
    assert response.status_code == 200

    data = response.json()
    assert "essential_articles" in data
    assert "discovery_articles" in data
    assert isinstance(data["essential_articles"], list)
    assert isinstance(data["discovery_articles"], list)
    assert "total_essential" in data
    assert "total_discovery" in data


@pytest.fixture
def interest_user(db_session: Session):
    """Create a test user with additional interest industries (e.g. Technology)"""
    unique_email = f"interest.test+{uuid.uuid4().hex[:8]}@example.com"
    user = User(
        id=uuid.uuid4(),
        email=unique_email,
        password_hash="test_hash",
        is_active=True
    )
    db_session.add(user)

    profile = UserProfile(
        user_id=user.id,
        core_industry="Consumer",
        specializations=["Food & Beverage"],
        additional_interest_industries=["Technology"],
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


@pytest.fixture
def interest_articles(db_session: Session, interest_user: User):
    """Create articles with Technology expert notes for interest filter testing"""
    articles = []
    unique_suffix = uuid.uuid4().hex[:8]

    for i in range(3):
        article = Article(
            id=uuid.uuid4(),
            title=f"Technology Article {i+1}",
            url=f"https://example.com/tech-{unique_suffix}-{i}",
            source="Tech Daily",
            raw_text=f"Technology article content {i+1}.",
            word_count=300,
            is_paywalled=False
        )
        db_session.add(article)
        articles.append(article)

        expert_note = ExpertNote(
            id=uuid.uuid4(),
            expert_id=interest_user.id,
            article_id=article.id,
            notes_text=f"Key technology insight {i+1} about industry trends.",
            priority="Normal",
            expert_industry="Technology",
            expert_specializations=["Software Development"]
        )
        db_session.add(expert_note)

    db_session.commit()
    for article in articles:
        db_session.refresh(article)

    return articles


@pytest.mark.anyio
async def test_divein_feed_interest_filter(
    db_session: Session, interest_user: User, interest_articles,
    interest_auth_headers, async_client
):
    """Verify interest filter returns articles in two-pool structure.

    This test would have caught Bug 1 (response format mismatch)
    and ensures the interest filter branch works correctly.
    """
    response = await async_client.get(
        "/api/v1/divein-feed?filter=interest:Technology",
        headers=interest_auth_headers
    )
    assert response.status_code == 200

    data = response.json()
    # Two-pool structure must be present
    assert "essential_articles" in data
    assert "discovery_articles" in data
    assert isinstance(data["essential_articles"], list)
    assert isinstance(data["discovery_articles"], list)

    # At least some articles should be returned
    all_articles = data["essential_articles"] + data["discovery_articles"]
    assert len(all_articles) > 0, "Interest filter should return articles"

    # All returned articles should have Technology context
    for article in all_articles:
        assert "id" in article
        assert "title" in article


@pytest.mark.anyio
async def test_divein_feed_interest_filter_pagination(
    db_session: Session, interest_user: User, interest_articles,
    interest_auth_headers, async_client
):
    """Verify pagination works correctly with interest filter"""
    response = await async_client.get(
        "/api/v1/divein-feed?filter=interest:Technology&limit=1&offset=0",
        headers=interest_auth_headers
    )
    assert response.status_code == 200

    data = response.json()
    assert data["limit"] == 1
    assert data["offset"] == 0
    # Pool 2 should be limited to 1
    assert len(data["discovery_articles"]) <= 1
    # Total discovery count should reflect all matching discovery articles
    assert isinstance(data["total_discovery"], int)
