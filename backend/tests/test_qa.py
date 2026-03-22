"""
Tests for Q&A service and API endpoints
"""
import pytest
import httpx
from sqlalchemy.orm import Session
import uuid
from datetime import datetime
from unittest.mock import Mock, patch

from app.main import app
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.qa_models import QAExchange
from app.services.qa_service import QAService
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
    unique_email = f"qa.test+{uuid.uuid4()}@example.com"
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
def sample_article(db_session: Session, test_user: User):
    """Create a sample article with expert notes"""
    article = Article(
        id=uuid.uuid4(),
        title="AI Revolution in Healthcare",
        url="https://example.com/ai-healthcare",
        source="Tech Health",
        raw_text="This article discusses the revolutionary impact of AI in healthcare, including machine learning applications in diagnosis, treatment planning, and patient care optimization.",
        word_count=150,
        is_paywalled=False
    )
    db_session.add(article)
    
    # Add expert note
    expert_note = ExpertNote(
        id=uuid.uuid4(),
        expert_id=test_user.id,
        article_id=article.id,
        notes_text="This article provides insights into AI applications in healthcare, focusing on diagnostic accuracy improvements and personalized treatment approaches.",
        priority="Essential",
        expert_industry="Healthcare",
        expert_specializations=["AI & Machine Learning", "Healthcare Technology"]
    )
    db_session.add(expert_note)
    
    db_session.commit()
    db_session.refresh(article)
    
    return article


@pytest.fixture
def paywalled_article(db_session: Session, test_user: User):
    """Create a paywalled article with expert notes"""
    article = Article(
        id=uuid.uuid4(),
        title="Premium Finance Insights",
        url="https://example.com/premium-finance",
        source="Finance Premium",
        raw_text="Limited preview content...",
        word_count=500,
        is_paywalled=True
    )
    db_session.add(article)
    
    # Add expert note for paywalled content
    expert_note = ExpertNote(
        id=uuid.uuid4(),
        expert_id=test_user.id,
        article_id=article.id,
        notes_text="This premium article covers advanced financial strategies, market analysis, and investment opportunities in emerging markets.",
        priority="Normal",
        expert_industry="Finance",
        expert_specializations=["Investment Banking", "Market Analysis"]
    )
    db_session.add(expert_note)
    
    db_session.commit()
    db_session.refresh(article)
    
    return article


class TestQAService:
    """Test cases for QAService"""
    
    @patch('app.services.qa_service.get_claude_client')
    def test_generate_suggested_questions(self, mock_claude_client, db_session: Session, sample_article: Article):
        """Verify suggested questions are generated"""
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = '''[
            {"question": "How does AI improve diagnostic accuracy in healthcare?"},
            {"question": "What are the main challenges in implementing AI in hospitals?"},
            {"question": "How can healthcare professionals prepare for AI integration?"}
        ]'''
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_claude_client.return_value = mock_client
        
        # Test question generation
        questions = QAService.generate_suggested_questions(str(sample_article.id), db_session)
        
        assert len(questions) == 3
        assert all(isinstance(q, str) for q in questions)
        assert all(len(q) > 5 for q in questions)
        assert "AI" in questions[0]
        
        # Verify Claude was called with correct model
        mock_client.client.messages.create.assert_called_once()
        call_args = mock_client.client.messages.create.call_args
        assert call_args[1]['model'] == "claude-haiku-4-5-20251001"
    
    @patch('app.services.qa_service.get_claude_client')
    def test_generate_suggested_questions_fallback(self, mock_claude_client, db_session: Session, sample_article: Article):
        """Verify fallback questions when Claude fails"""
        # Mock Claude to return invalid JSON
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "Invalid JSON response"
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_claude_client.return_value = mock_client
        
        # Test question generation with fallback
        questions = QAService.generate_suggested_questions(str(sample_article.id), db_session)
        
        assert len(questions) == 3
        assert "main point" in questions[0].lower()
        assert "healthcare" in questions[1].lower()  # Should use industry context
    
    @patch('app.services.qa_service.get_claude_client')
    def test_answer_question(self, mock_claude_client, db_session: Session, sample_article: Article, test_user: User):
        """Verify question answering works"""
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "AI improves healthcare by enhancing diagnostic accuracy through machine learning algorithms that can analyze medical images and patient data more precisely than traditional methods."
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        # Test question answering
        result = QAService.answer_question(
            str(sample_article.id),
            "How does AI improve healthcare?",
            str(test_user.id),
            db_session
        )
        
        assert "answer" in result
        assert len(result["answer"]) > 0
        assert "created_at" in result
        assert "id" in result
        assert result["model_used"] == "claude-sonnet-4-5-20250929"
        
        # Verify Claude was called with latest Sonnet model
        mock_client.client.messages.create.assert_called_once()
    
    def test_answer_question_stored_in_db(self, db_session: Session, sample_article: Article, test_user: User):
        """Verify answers are stored in database"""
        with patch('app.services.qa_service.get_claude_client') as mock_claude_client:
            # Mock Claude response
            mock_response = Mock()
            mock_response.content = [Mock()]
            mock_response.content[0].text = "Test answer from Claude"
            
            mock_client = Mock()
            mock_client.client.messages.create.return_value = mock_response
            mock_client.model = "claude-sonnet-4-5-20250929"
            mock_claude_client.return_value = mock_client
            
            # Generate answer
            QAService.answer_question(
                str(sample_article.id),
                "Test question?",
                str(test_user.id),
                db_session
            )
            
            # Query from DB
            exchange = db_session.query(QAExchange).filter(
                QAExchange.article_id == sample_article.id,
                QAExchange.user_id == test_user.id
            ).first()
            
            assert exchange is not None
            assert exchange.question == "Test question?"
            assert exchange.answer == "Test answer from Claude"
            assert exchange.model_used == "claude-sonnet-4-5-20250929"
    
    @patch('app.services.qa_service.get_claude_client')
    def test_answer_question_paywalled_article(self, mock_claude_client, db_session: Session, paywalled_article: Article, test_user: User):
        """Verify paywalled articles use expert notes for context"""
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "Based on the expert analysis, this article covers advanced financial strategies and market opportunities."
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        # Test with paywalled article
        result = QAService.answer_question(
            str(paywalled_article.id),
            "What does this article cover?",
            str(test_user.id),
            db_session
        )
        
        assert "answer" in result
        assert "financial strategies" in result["answer"]
        
        # Verify Claude was called with expert notes content
        call_args = mock_client.client.messages.create.call_args
        prompt_content = call_args[1]['messages'][0]['content']
        assert "advanced financial strategies" in prompt_content
    
    def test_get_qa_history(self, db_session: Session, sample_article: Article, test_user: User):
        """Verify Q&A history retrieval"""
        # Create some Q&A exchanges
        exchange1 = QAExchange(
            user_id=test_user.id,
            article_id=sample_article.id,
            question="First question?",
            answer="First answer",
            model_used="claude-sonnet-4-5-20250929"
        )
        exchange2 = QAExchange(
            user_id=test_user.id,
            article_id=sample_article.id,
            question="Second question?",
            answer="Second answer",
            model_used="claude-sonnet-4-5-20250929"
        )
        
        db_session.add_all([exchange1, exchange2])
        db_session.commit()
        
        # Test history retrieval
        history = QAService.get_qa_history(str(test_user.id), db=db_session)
        
        assert len(history) == 2
        assert history[0]["question"] == "Second question?"  # Most recent first
        assert history[1]["question"] == "First question?"


class TestQAEndpoints:
    """Test cases for Q&A API endpoints"""
    
    @patch('app.services.qa_service.get_claude_client')
    def test_get_suggested_questions_endpoint(self, mock_claude_client, db_session: Session, sample_article: Article, auth_headers):
        """Verify GET /articles/{id}/questions works"""
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = '''[
            {"question": "What are the key benefits of AI in healthcare?"},
            {"question": "How can hospitals implement AI systems?"},
            {"question": "What are the ethical considerations?"}
        ]'''
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_claude_client.return_value = mock_client
        
        # Test endpoint
        response = client.get(
            f"/api/v1/articles/{sample_article.id}/questions",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "questions" in data
        assert len(data["questions"]) == 3
        assert data["article_id"] == str(sample_article.id)
        
        # Check question structure
        question = data["questions"][0]
        assert "text" in question
        assert "rank" in question
        assert question["rank"] == 1
    
    @patch('app.services.qa_service.get_claude_client')
    def test_ask_question_endpoint(self, mock_claude_client, db_session: Session, sample_article: Article, auth_headers):
        """Verify POST /articles/{id}/ask works"""
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "AI revolutionizes healthcare by providing more accurate diagnoses and personalized treatment plans through advanced machine learning algorithms."
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        # Test endpoint
        response = client.post(
            f"/api/v1/articles/{sample_article.id}/ask",
            json={"question_text": "How does AI revolutionize healthcare?"},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "answer" in data
        assert "id" in data
        assert "created_at" in data
        assert "article_id" in data
        assert data["article_id"] == str(sample_article.id)
        assert "AI revolutionizes healthcare" in data["answer"]
    
    def test_ask_question_validation(self, sample_article: Article, auth_headers):
        """Verify request validation for ask endpoint"""
        # Test missing question_text
        response = client.post(
            f"/api/v1/articles/{sample_article.id}/ask",
            json={},
            headers=auth_headers
        )
        assert response.status_code == 422  # Validation error
        
        # Test empty question_text
        response = client.post(
            f"/api/v1/articles/{sample_article.id}/ask",
            json={"question_text": ""},
            headers=auth_headers
        )
        assert response.status_code == 400
        
        # Test invalid article ID
        response = client.post(
            "/api/v1/articles/invalid-id/ask",
            json={"question_text": "Valid question?"},
            headers=auth_headers
        )
        assert response.status_code == 400
    
    def test_get_qa_history_endpoint(self, db_session: Session, sample_article: Article, test_user: User, auth_headers):
        """Verify GET /qa/history works"""
        # Create Q&A exchange
        exchange = QAExchange(
            user_id=test_user.id,
            article_id=sample_article.id,
            question="Test question?",
            answer="Test answer",
            model_used="claude-sonnet-4-5-20250929"
        )
        db_session.add(exchange)
        db_session.commit()
        
        # Test endpoint
        response = client.get("/api/v1/qa/history", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        
        assert "exchanges" in data
        assert len(data["exchanges"]) == 1
        assert data["exchanges"][0]["question"] == "Test question?"
        assert data["user_id"] == str(test_user.id)
    
    def test_authentication_required(self, sample_article: Article):
        """Verify authentication is required for all endpoints"""
        # Test questions endpoint
        response = client.get(f"/api/v1/articles/{sample_article.id}/questions")
        assert response.status_code == 401
        
        # Test ask endpoint
        response = client.post(
            f"/api/v1/articles/{sample_article.id}/ask",
            json={"question_text": "Test question?"}
        )
        assert response.status_code == 401
        
        # Test history endpoint
        response = client.get("/api/v1/qa/history")
        assert response.status_code == 401
    
    def test_article_not_found(self, auth_headers):
        """Verify 404 for non-existent articles"""
        fake_id = str(uuid.uuid4())
        
        # Test questions endpoint
        response = client.get(f"/api/v1/articles/{fake_id}/questions", headers=auth_headers)
        assert response.status_code == 404
        
        # Test ask endpoint
        response = client.post(
            f"/api/v1/articles/{fake_id}/ask",
            json={"question_text": "Test question?"},
            headers=auth_headers
        )
        assert response.status_code == 404


class TestQAPerformance:
    """Test cases for Q&A performance requirements"""
    
    @patch('app.services.qa_service.get_claude_client')
    def test_suggested_questions_performance(self, mock_claude_client, db_session: Session, sample_article: Article):
        """Verify suggested questions generation is fast (<2s)"""
        import time
        
        # Mock fast Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = '''[
            {"question": "Question 1?"},
            {"question": "Question 2?"},
            {"question": "Question 3?"}
        ]'''
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_claude_client.return_value = mock_client
        
        # Measure performance
        start_time = time.time()
        questions = QAService.generate_suggested_questions(str(sample_article.id), db_session)
        duration = time.time() - start_time
        
        assert len(questions) == 3
        assert duration < 2.0  # Should be under 2 seconds
    
    @patch('app.services.qa_service.get_claude_client')
    def test_answer_question_performance(self, mock_claude_client, db_session: Session, sample_article: Article, test_user: User):
        """Verify question answering is reasonably fast (<3s)"""
        import time
        
        # Mock Claude response
        mock_response = Mock()
        mock_response.content = [Mock()]
        mock_response.content[0].text = "Detailed answer from Claude"
        
        mock_client = Mock()
        mock_client.client.messages.create.return_value = mock_response
        mock_client.model = "claude-sonnet-4-5-20250929"
        mock_claude_client.return_value = mock_client
        
        # Measure performance
        start_time = time.time()
        result = QAService.answer_question(
            str(sample_article.id),
            "Test question?",
            str(test_user.id),
            db_session
        )
        duration = time.time() - start_time
        
        assert "answer" in result
        assert duration < 3.0  # Should be under 3 seconds
