"""
Tests for Recap API endpoints and weekly synthesis functionality
"""
import pytest
import httpx
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

from app.main import app
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.qa_models import QAExchange
from app.models.recap import RecapSession, RecapSessionPublish
from app.services.recap_service import RecapService
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
    unique_email = f"recap.test+{uuid.uuid4()}@example.com"
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
        specializations=["Software Development", "AI & Machine Learning"],
        additional_interest_industries=[],
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
def sample_articles_and_qa(db_session: Session, test_user: User):
    """Create sample articles and Q&A exchanges for testing"""
    articles = []
    qa_exchanges = []
    
    # Create articles from different industries
    industries = ["Technology", "Healthcare", "Finance", "Energy"]
    
    for i, industry in enumerate(industries):
        article = Article(
            id=uuid.uuid4(),
            title=f"{industry} Article {i+1}",
            url=f"https://example.com/{industry.lower()}-{i+1}",
            source=f"{industry} News",
            raw_text=f"This is a comprehensive article about {industry} trends and developments.",
            word_count=200,
            is_paywalled=False
        )
        db_session.add(article)
        articles.append(article)
        
        # Add expert note
        expert_note = ExpertNote(
            id=uuid.uuid4(),
            expert_id=test_user.id,
            article_id=article.id,
            notes_text=f"Expert insights on {industry} developments and future trends.",
            priority="Normal",
            expert_industry=industry,
            expert_specializations=[f"{industry} Analysis"]
        )
        db_session.add(expert_note)
    
    db_session.commit()
    
    # Create Q&A exchanges from this week
    week_start = datetime.now() - timedelta(days=3)  # Mid-week
    
    for i, article in enumerate(articles):
        qa_exchange = QAExchange(
            user_id=test_user.id,
            article_id=article.id,
            question=f"What are the key trends in {article.title}?",
            answer=f"The key trends in {article.title} include innovation, growth, and strategic developments that will shape the future of the industry.",
            model_used="claude-sonnet-4-5-20250929"
        )
        # Set created_at to be within the week
        qa_exchange.created_at = week_start + timedelta(days=i)
        db_session.add(qa_exchange)
        qa_exchanges.append(qa_exchange)
    
    db_session.commit()
    
    return {
        "articles": articles,
        "qa_exchanges": qa_exchanges,
        "week_start": week_start
    }


class TestRecapService:
    """Test cases for RecapService"""
    
    def test_collect_weekly_qa(self, db_session: Session, test_user: User, sample_articles_and_qa):
        """Verify weekly Q&A collection works"""
        week_start = sample_articles_and_qa["week_start"]
        
        exchanges = RecapService.collect_weekly_qa(str(test_user.id), week_start, db_session)
        
        assert len(exchanges) == 4  # Should find all 4 exchanges
        assert all(isinstance(e, QAExchange) for e in exchanges)
        
        # Verify they're from the correct week
        week_end = week_start + timedelta(days=7)
        for exchange in exchanges:
            assert week_start <= exchange.created_at < week_end
    
    def test_generate_recap_session(self, db_session: Session, test_user: User, sample_articles_and_qa):
        """Verify recap session generation works"""
        week_start = sample_articles_and_qa["week_start"]
        
        result = RecapService.generate_recap_session(str(test_user.id), week_start, db_session)
        
        assert "error" not in result
        assert "recap_id" in result
        assert len(result["questions"]) == 4
        
        # Verify questions have required fields
        for question in result["questions"]:
            assert "order" in question
            assert "article_id" in question
            assert "question_preview" in question
            assert "category" in question
    
    def test_generate_recap_session_insufficient_qa(self, db_session: Session, test_user: User):
        """Verify error when not enough Q&A exchanges"""
        week_start = datetime.now() - timedelta(days=14)  # Two weeks ago (no Q&A)
        
        result = RecapService.generate_recap_session(str(test_user.id), week_start, db_session)
        
        assert "error" in result
        assert "Not enough" in result["error"]
    
    @patch('app.services.recap_service.get_claude_client')
    def test_generate_synthesis(self, mock_claude_client, db_session: Session, test_user: User, sample_articles_and_qa):
        """Verify synthesis generation with Claude Opus"""
        # Create recap session first
        week_start = sample_articles_and_qa["week_start"]
        session_result = RecapService.generate_recap_session(str(test_user.id), week_start, db_session)
        recap_id = session_result["recap_id"]
        
        # Mock Claude Opus response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = """This week's Q&A exchanges reveal fascinating patterns across technology, healthcare, finance, and energy sectors. 

The common thread connecting these diverse inquiries is the focus on transformative trends that are reshaping traditional industries. From AI integration in healthcare to fintech innovations, each question explored how emerging technologies are creating new opportunities and challenges.

What's particularly striking is how these seemingly separate domains are converging around themes of digital transformation, sustainability, and human-centered innovation. This suggests a broader shift toward interconnected solutions that transcend industry boundaries."""
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_claude_client.return_value = mock_client
        
        # Generate synthesis
        result = RecapService.generate_synthesis(recap_id, db_session)
        
        assert "error" not in result
        assert "synthesis_text" in result
        assert "key_insights" in result
        assert len(result["synthesis_text"]) > 100
        
        # Verify Claude Opus was used
        mock_client.client.messages.create.assert_called()
        call_args = mock_client.client.messages.create.call_args
        assert call_args[1]['model'] == "claude-opus-4-5-20251101"
    
    def test_select_diverse_exchanges(self, db_session: Session, sample_articles_and_qa):
        """Verify diverse exchange selection algorithm"""
        exchanges = sample_articles_and_qa["qa_exchanges"]
        
        selected = RecapService._select_diverse_exchanges(exchanges, 4, db_session)
        
        assert len(selected) == 4
        
        # Check that different industries are represented
        industries = set()
        for exchange in selected:
            article = db_session.query(Article).filter(Article.id == exchange.article_id).first()
            if article and article.expert_notes:
                industries.add(article.expert_notes[0].expert_industry)
        
        assert len(industries) >= 3  # Should have at least 3 different industries


class TestRecapEndpoints:
    """Test cases for Recap API endpoints"""
    
    @pytest.mark.anyio
    async def test_start_recap_session_endpoint(self, db_session: Session, sample_articles_and_qa, auth_headers, async_client):
        """Verify POST /recap/start-session works"""
        week_start = sample_articles_and_qa["week_start"]
        
        response = await async_client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "recap_id" in data
        assert "questions" in data
        assert len(data["questions"]) == 4
        assert data["status"] == "in_progress"
        
        # Verify question structure
        question = data["questions"][0]
        assert "order" in question
        assert "article_id" in question
        assert "article_title" in question
        assert "question_preview" in question
        assert "category" in question
    
    @pytest.mark.anyio
    async def test_start_recap_session_duplicate(self, db_session: Session, sample_articles_and_qa, auth_headers, async_client):
        """Verify error when trying to create duplicate recap session"""
        week_start = sample_articles_and_qa["week_start"]
        
        # Create first session
        response1 = await async_client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        assert response1.status_code == 200
        
        # Try to create duplicate
        response2 = await async_client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        assert response2.status_code == 409  # Conflict
    
    @pytest.mark.anyio
    async def test_answer_recap_question_endpoint(self, db_session: Session, sample_articles_and_qa, auth_headers, async_client):
        """Verify POST /recap/{id}/answer works"""
        week_start = sample_articles_and_qa["week_start"]
        
        # Create recap session
        session_response = await async_client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        recap_id = session_response.json()["recap_id"]
        
        # Answer a question
        response = await async_client.post(
            f"/api/v1/recap/{recap_id}/answer",
            json={
                "question_order": 1,
                "response_text": "This question made me think about the interconnections between different technologies."
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["stored"] is True
        assert data["question_order"] == 1
    
    def test_answer_recap_question_validation(self, db_session: Session, sample_articles_and_qa, auth_headers):
        """Verify validation for recap question answers"""
        week_start = sample_articles_and_qa["week_start"]
        
        # Create recap session
        session_response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        recap_id = session_response.json()["recap_id"]
        
        # Test invalid question order
        response = client.post(
            f"/api/v1/recap/{recap_id}/answer",
            json={"question_order": 5, "response_text": "Valid response"},
            headers=auth_headers
        )
        assert response.status_code == 400
        
        # Test empty response
        response = client.post(
            f"/api/v1/recap/{recap_id}/answer",
            json={"question_order": 1, "response_text": ""},
            headers=auth_headers
        )
        assert response.status_code == 400
    
    @patch('app.services.recap_service.get_claude_client')
    def test_get_synthesis_endpoint(self, mock_claude_client, db_session: Session, sample_articles_and_qa, auth_headers):
        """Verify GET /recap/{id}/synthesis works"""
        # Mock Claude responses
        mock_synthesis_response = Mock()
        mock_synthesis_response.content = [Mock()]
        mock_synthesis_response.content[0].text = "This week's learning journey revealed important patterns across multiple domains."
        
        mock_insights_response = Mock()
        mock_insights_response.content = [Mock()]
        mock_insights_response.content[0].text = '["Key insight 1", "Key insight 2", "Key insight 3"]'
        
        mock_client = Mock()
        mock_client.client.messages.create.side_effect = [mock_synthesis_response, mock_insights_response]
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        week_start = sample_articles_and_qa["week_start"]
        
        # Create recap session
        session_response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        recap_id = session_response.json()["recap_id"]
        
        # Get synthesis
        response = client.get(
            f"/api/v1/recap/{recap_id}/synthesis",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "synthesis_text" in data
        assert "key_insights" in data
        assert "generated_at" in data
        assert len(data["synthesis_text"]) > 0
        assert isinstance(data["key_insights"], list)
    
    @patch('app.services.recap_service.get_claude_client')
    def test_publish_recap_endpoint(self, mock_claude_client, db_session: Session, sample_articles_and_qa, auth_headers):
        """Verify POST /recap/{id}/publish works"""
        # Mock Claude for synthesis generation
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "Weekly synthesis content"
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        week_start = sample_articles_and_qa["week_start"]
        
        # Create recap session
        session_response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        recap_id = session_response.json()["recap_id"]
        
        # Generate synthesis first
        client.get(f"/api/v1/recap/{recap_id}/synthesis", headers=auth_headers)
        
        # Publish recap
        response = client.post(
            f"/api/v1/recap/{recap_id}/publish",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "share_url" in data
        assert "share_key" in data
        assert data["share_url"].startswith("/shared-recap/")
    
    @patch('app.services.recap_service.get_claude_client')
    def test_view_shared_recap_endpoint(self, mock_claude_client, db_session: Session, sample_articles_and_qa, auth_headers):
        """Verify GET /recap/shared/{share_key} works (public endpoint)"""
        # Mock Claude for synthesis
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "Public shared synthesis content"
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        week_start = sample_articles_and_qa["week_start"]
        
        # Create and publish recap
        session_response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        recap_id = session_response.json()["recap_id"]
        
        # Generate synthesis and publish
        client.get(f"/api/v1/recap/{recap_id}/synthesis", headers=auth_headers)
        publish_response = client.post(f"/api/v1/recap/{recap_id}/publish", headers=auth_headers)
        share_key = publish_response.json()["share_key"]
        
        # View shared recap (no auth required)
        response = client.get(f"/api/v1/recap/shared/{share_key}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "synthesis" in data
        assert "insights" in data
        assert "published_at" in data
        assert "views" in data
        assert data["views"] == 1  # First view
        
        # View again to test view counter
        response2 = client.get(f"/api/v1/recap/shared/{share_key}")
        assert response2.status_code == 200
        assert response2.json()["views"] == 2
    
    def test_get_user_recap_sessions_endpoint(self, db_session: Session, sample_articles_and_qa, auth_headers):
        """Verify GET /recap/user/sessions works"""
        week_start = sample_articles_and_qa["week_start"]
        
        # Create a recap session
        client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        
        # Get user sessions
        response = client.get("/api/v1/recap/user/sessions", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "sessions" in data
        assert "total" in data
        assert data["total"] == 1
        assert len(data["sessions"]) == 1
        
        session = data["sessions"][0]
        assert "id" in session
        assert "week_start" in session
        assert "status" in session
        assert "has_synthesis" in session
        assert "is_published" in session
    
    def test_authentication_required(self, sample_articles_and_qa):
        """Verify authentication is required for protected endpoints"""
        week_start = sample_articles_and_qa["week_start"]
        
        # Test start session without auth
        response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()}
        )
        assert response.status_code == 401
        
        # Test user sessions without auth
        response = client.get("/api/v1/recap/user/sessions")
        assert response.status_code == 401
    
    def test_shared_recap_no_auth_required(self):
        """Verify shared recap endpoint doesn't require authentication"""
        # Test with non-existent share key
        response = client.get("/api/v1/recap/shared/nonexistent-key")
        assert response.status_code == 404  # Not 401 (unauthorized)


class TestRecapIntegration:
    """Integration tests for complete recap workflow"""
    
    @patch('app.services.recap_service.get_claude_client')
    def test_complete_recap_workflow(self, mock_claude_client, db_session: Session, sample_articles_and_qa, auth_headers):
        """Test complete recap workflow from start to sharing"""
        # Mock Claude responses
        mock_synthesis_response = Mock()
        mock_synthesis_response.content = [Mock()]
        mock_synthesis_response.content[0].text = "Complete workflow synthesis demonstrating the full recap journey."
        
        mock_insights_response = Mock()
        mock_insights_response.content = [Mock()]
        mock_insights_response.content[0].text = '["Workflow insight 1", "Workflow insight 2"]'
        
        mock_client = Mock()
        mock_client.client.messages.create.side_effect = [mock_synthesis_response, mock_insights_response]
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        week_start = sample_articles_and_qa["week_start"]
        
        # Step 1: Start recap session
        session_response = client.post(
            "/api/v1/recap/start-session",
            json={"week_start": week_start.isoformat()},
            headers=auth_headers
        )
        assert session_response.status_code == 200
        recap_id = session_response.json()["recap_id"]
        
        # Step 2: Answer questions
        for i in range(1, 5):
            answer_response = client.post(
                f"/api/v1/recap/{recap_id}/answer",
                json={
                    "question_order": i,
                    "response_text": f"My reflection on question {i} about this week's learning."
                },
                headers=auth_headers
            )
            assert answer_response.status_code == 200
        
        # Step 3: Generate synthesis
        synthesis_response = client.get(
            f"/api/v1/recap/{recap_id}/synthesis",
            headers=auth_headers
        )
        assert synthesis_response.status_code == 200
        synthesis_data = synthesis_response.json()
        assert len(synthesis_data["synthesis_text"]) > 0
        
        # Step 4: Publish recap
        publish_response = client.post(
            f"/api/v1/recap/{recap_id}/publish",
            headers=auth_headers
        )
        assert publish_response.status_code == 200
        share_key = publish_response.json()["share_key"]
        
        # Step 5: View shared recap
        shared_response = client.get(f"/api/v1/recap/shared/{share_key}")
        assert shared_response.status_code == 200
        shared_data = shared_response.json()
        assert shared_data["synthesis"] == synthesis_data["synthesis_text"]
        assert shared_data["views"] == 1
        
        # Verify Claude Opus was used for synthesis
        assert mock_client.client.messages.create.call_count >= 1
        synthesis_call = mock_client.client.messages.create.call_args_list[0]
        assert synthesis_call[1]['model'] == "claude-opus-4-5-20251101"
