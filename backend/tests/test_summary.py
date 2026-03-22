"""
Test suite for Claude API integration and summary generation functionality
"""
import pytest
import uuid
from unittest.mock import patch, MagicMock
from datetime import datetime

from app.utils.llm_utils import ClaudeClient, get_claude_client
from app.services.summary_service import (
    generate_article_summary, generate_personal_prompt,
    generate_article_questions, analyze_article_sentiment,
    extract_article_topics
)
from app.tasks.summary_tasks import (
    generate_summaries_batch, generate_questions_batch,
    analyze_sentiment_batch, extract_topics_batch
)
from app.models.article import Article, ExpertNote
from app.models.user import User, UserProfile
from app.models.storyboard import Storyboard
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base


@pytest.fixture
def db_session():
    """Create a test database session"""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    
    yield session
    
    session.close()


@pytest.fixture
def sample_article(db_session):
    """Create a sample article for testing"""
    article = Article(
        id=uuid.uuid4(),
        url="https://example.com/test-article",
        title="Test Article About Food Innovation",
        source="example.com",
        raw_text="This is a comprehensive article about food innovation and technology. It discusses new trends in plant-based proteins, sustainable packaging, and consumer behavior changes. The article provides insights into how companies are adapting to meet evolving consumer demands for healthier and more sustainable food options.",
        word_count=45,
        is_paywalled=False
    )
    
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    
    return article


@pytest.fixture
def paywalled_article_with_notes(db_session):
    """Create a paywalled article with expert notes"""
    article = Article(
        id=uuid.uuid4(),
        url="https://premium.com/paywalled-article",
        title="Premium Industry Analysis",
        source="premium.com",
        raw_text=None,
        word_count=0,
        is_paywalled=True
    )
    
    db_session.add(article)
    db_session.commit()
    
    # Add expert note
    expert_note = ExpertNote(
        expert_id=uuid.uuid4(),
        article_id=article.id,
        notes_text="This premium article discusses key market trends and provides valuable insights for industry professionals.",
        priority="High",
        expert_industry="Consumer",
        expert_specializations=["Food & Beverage"]
    )
    
    db_session.add(expert_note)
    db_session.commit()
    db_session.refresh(article)
    
    return article


@pytest.fixture
def sample_user_profile(db_session):
    """Create a sample user profile for testing"""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        password_hash="hashed_password",
        is_active=True
    )
    
    db_session.add(user)
    db_session.commit()
    
    profile = UserProfile(
        user_id=user.id,
        core_industry="Consumer",
        specializations=["Food & Beverage", "Sustainability"],
        total_weekly_capacity_band="Medium",
        catchup_daily_goal_minutes=30,
        catchup_daily_max_minutes=60,
        divein_weekly_goal_minutes=120,
        recap_weekly_goal_minutes=60
    )
    
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)
    
    return profile


@pytest.fixture
def sample_storyboard(db_session, sample_article):
    """Create a sample storyboard for testing"""
    storyboard = Storyboard(
        id=uuid.uuid4(),
        industry="Consumer",
        specializations=["Food & Beverage"],
        headline_article_id=sample_article.id,
        summary="A collection of articles about recent innovations in the food industry, including plant-based alternatives and sustainable packaging solutions."
    )
    
    db_session.add(storyboard)
    db_session.commit()
    db_session.refresh(storyboard)
    
    return storyboard


class TestClaudeClient:
    """Test Claude API client functionality"""
    
    @patch('app.utils.llm_utils.anthropic.Anthropic')
    def test_claude_client_initialization(self, mock_anthropic):
        """Test Claude client initialization"""
        mock_client = MagicMock()
        mock_anthropic.return_value = mock_client
        
        client = ClaudeClient(api_key="test-key")
        
        assert client.api_key == "test-key"
        assert client.model == "claude-sonnet-4-5-20250929"
        mock_anthropic.assert_called_once_with(api_key="test-key")
    
    @patch('app.utils.llm_utils.anthropic.Anthropic')
    def test_generate_summary_success(self, mock_anthropic):
        """Test successful summary generation"""
        # Mock Claude response
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = "This article discusses innovative food technologies and their impact on consumer behavior and sustainability."
        
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.return_value = mock_client
        
        client = ClaudeClient(api_key="test-key")
        
        text = "Long article about food innovation and technology trends..."
        summary = client.generate_summary(text, max_words=50)
        
        assert summary == "This article discusses innovative food technologies and their impact on consumer behavior and sustainability."
        mock_client.messages.create.assert_called_once()
    
    @patch('app.utils.llm_utils.anthropic.Anthropic')
    def test_generate_summary_api_error(self, mock_anthropic):
        """Test summary generation with API error (should fallback)"""
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API Error")
        mock_anthropic.return_value = mock_client
        
        client = ClaudeClient(api_key="test-key")
        
        text = "This is a short test article about food innovation."
        summary = client.generate_summary(text, max_words=50)
        
        # Should fallback to truncation
        assert "food innovation" in summary
        assert len(summary.split()) <= 50
    
    @patch('app.utils.llm_utils.anthropic.Anthropic')
    def test_generate_personal_prompt(self, mock_anthropic):
        """Test personal prompt generation"""
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = "How might these food innovation trends impact your sustainability initiatives in the consumer goods sector?"
        
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.return_value = mock_client
        
        client = ClaudeClient(api_key="test-key")
        
        context = "Article about food innovation trends"
        user_spec = "Industry: Consumer, Specializations: Food & Beverage, Sustainability"
        
        prompt = client.generate_personal_prompt(context, user_spec)
        
        assert "food innovation" in prompt.lower()
        assert "sustainability" in prompt.lower()
        assert prompt.endswith("?")
    
    @patch('app.utils.llm_utils.anthropic.Anthropic')
    def test_generate_questions(self, mock_anthropic):
        """Test question generation"""
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = """1. What are the key drivers behind the growth in plant-based food alternatives?
2. How might these innovations impact traditional food supply chains?
3. What challenges do companies face when implementing sustainable packaging solutions?"""
        
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.return_value = mock_client
        
        client = ClaudeClient(api_key="test-key")
        
        content = "Article about food innovation and sustainability trends"
        questions = client.generate_questions(content, count=3)
        
        assert len(questions) == 3
        assert all(q.endswith("?") for q in questions)
        assert "plant-based" in questions[0].lower()


class TestSummaryService:
    """Test summary service functionality"""
    
    def test_generate_summary_full_text(self, sample_article, db_session):
        """Test summary generation from full article text"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.generate_summary.return_value = "Concise summary of food innovation trends and their market impact."
            mock_get_client.return_value = mock_client
            
            result = generate_article_summary(sample_article.id, db=db_session)
            
            assert result['success'] is True
            assert result['source'] == 'claude'
            assert "food innovation" in result['summary'].lower()
            assert result['word_count'] > 0
            assert result['error'] is None
    
    def test_generate_summary_paywalled(self, paywalled_article_with_notes, db_session):
        """Test summary generation for paywalled article (should use expert notes)"""
        result = generate_article_summary(paywalled_article_with_notes.id, db=db_session)
        
        assert result['success'] is True
        assert result['source'] == 'expert_notes'
        assert "market trends" in result['summary'].lower()
        assert result['word_count'] > 0
        assert result['error'] is None
    
    def test_generate_summary_nonexistent_article(self, db_session):
        """Test summary generation for non-existent article"""
        fake_id = uuid.uuid4()
        result = generate_article_summary(fake_id, db=db_session)
        
        assert result['success'] is False
        assert result['error'] == f"Article not found: {fake_id}"
    
    def test_generate_personal_prompt(self, sample_storyboard, sample_user_profile, db_session):
        """Test personal prompt generation for user context"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.generate_personal_prompt.return_value = "How do these food innovation trends align with your sustainability goals in the consumer sector?"
            mock_get_client.return_value = mock_client
            
            result = generate_personal_prompt(
                sample_storyboard.id, 
                sample_user_profile.user_id, 
                db=db_session
            )
            
            assert result['success'] is True
            assert "sustainability" in result['prompt'].lower()
            assert result['error'] is None
    
    def test_claude_api_error_handling(self, sample_article, db_session):
        """Test graceful handling of Claude API errors"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.generate_summary.side_effect = Exception("Claude API Error")
            mock_get_client.return_value = mock_client
            
            result = generate_article_summary(sample_article.id, db=db_session)
            
            # Should fallback to expert notes or handle gracefully
            assert "Claude API error" in result['error']
    
    def test_summary_length(self, sample_article, db_session):
        """Test that generated summaries are approximately the requested length"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            # Generate a summary that's approximately 50 words
            mock_summary = "This comprehensive analysis explores emerging food innovation trends including plant-based alternatives sustainable packaging solutions and evolving consumer preferences that are reshaping the industry landscape through technological advancement market adaptation strategic partnerships regulatory compliance environmental considerations health consciousness demographic shifts economic factors competitive dynamics supply chain optimization distribution channels marketing strategies consumer education brand positioning product development research investment manufacturing processes quality assurance."
            mock_client.generate_summary.return_value = mock_summary
            mock_get_client.return_value = mock_client
            
            result = generate_article_summary(sample_article.id, db=db_session)
            
            assert result['success'] is True
            # Check that word count is reasonable (allowing some flexibility)
            word_count = result['word_count']
            assert 30 <= word_count <= 70  # Allow some flexibility around 50 words
    
    def test_generate_article_questions(self, sample_article, db_session):
        """Test question generation for articles"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.generate_questions.return_value = [
                "What are the main drivers of food innovation?",
                "How do consumer preferences influence product development?",
                "What role does sustainability play in food technology?"
            ]
            mock_get_client.return_value = mock_client
            
            result = generate_article_questions(sample_article.id, count=3, db=db_session)
            
            assert result['success'] is True
            assert len(result['questions']) == 3
            assert all(q.endswith("?") for q in result['questions'])
    
    def test_analyze_article_sentiment(self, sample_article, db_session):
        """Test sentiment analysis for articles"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.analyze_sentiment.return_value = "optimistic"
            mock_get_client.return_value = mock_client
            
            result = analyze_article_sentiment(sample_article.id, db=db_session)
            
            assert result['success'] is True
            assert result['sentiment'] == "optimistic"
            assert result['error'] is None
    
    def test_extract_article_topics(self, sample_article, db_session):
        """Test topic extraction for articles"""
        with patch('app.services.summary_service.get_claude_client') as mock_get_client:
            mock_client = MagicMock()
            mock_client.extract_key_topics.return_value = [
                "food innovation", "plant-based proteins", "sustainable packaging", 
                "consumer behavior", "technology trends"
            ]
            mock_get_client.return_value = mock_client
            
            result = extract_article_topics(sample_article.id, max_topics=5, db=db_session)
            
            assert result['success'] is True
            assert len(result['topics']) == 5
            assert "food innovation" in result['topics']


class TestSummaryTasks:
    """Test batch summary processing tasks"""
    
    def test_generate_summaries_batch(self, sample_article, db_session):
        """Test batch summary generation"""
        with patch('app.tasks.summary_tasks.SessionLocal') as mock_session:
            mock_session.return_value = db_session
            
            with patch('app.tasks.summary_tasks.generate_article_summary') as mock_generate:
                mock_generate.return_value = {
                    'success': True,
                    'summary': 'Test summary',
                    'source': 'claude',
                    'word_count': 10,
                    'error': None
                }
                
                result = generate_summaries_batch([sample_article.id])
                
                assert result['total'] == 1
                assert result['successful'] == 1
                assert result['failed'] == 0
                assert result['processing_time'] is not None
    
    def test_generate_questions_batch(self, sample_article, db_session):
        """Test batch question generation"""
        with patch('app.tasks.summary_tasks.SessionLocal') as mock_session:
            mock_session.return_value = db_session
            
            with patch('app.tasks.summary_tasks.generate_article_questions') as mock_generate:
                mock_generate.return_value = {
                    'success': True,
                    'questions': ['Question 1?', 'Question 2?', 'Question 3?'],
                    'error': None
                }
                
                result = generate_questions_batch([sample_article.id])
                
                assert result['total'] == 1
                assert result['successful'] == 1
                assert result['total_questions'] == 3
    
    def test_analyze_sentiment_batch(self, sample_article, db_session):
        """Test batch sentiment analysis"""
        with patch('app.tasks.summary_tasks.SessionLocal') as mock_session:
            mock_session.return_value = db_session
            
            with patch('app.tasks.summary_tasks.analyze_article_sentiment') as mock_analyze:
                mock_analyze.return_value = {
                    'success': True,
                    'sentiment': 'positive',
                    'error': None
                }
                
                result = analyze_sentiment_batch([sample_article.id])
                
                assert result['total'] == 1
                assert result['successful'] == 1
                assert result['sentiment_distribution']['positive'] == 1


def test_get_claude_client_singleton():
    """Test that get_claude_client returns singleton instance"""
    client1 = get_claude_client()
    client2 = get_claude_client()
    
    assert client1 is client2  # Should be the same instance


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
