"""
Test suite for filter-driven semantic clustering functionality
"""
import pytest
import uuid
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from app.services.clustering_service import (
    parse_filter_context, get_articles_for_filter, compute_article_embeddings,
    cluster_articles_for_context, get_or_build_storyboards_for_filter
)
from app.models.article import Article, ExpertNote
from app.models.user import User, UserProfile
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.cache import StoryboardCache
from app.models.interaction import UserNotRelevant, UserSavedArticle
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
def sample_user_with_profile(db_session):
    """Create a sample user with profile for testing"""
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
        additional_interest_industries=["Technology"],
        total_weekly_capacity_band="Medium",
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
def sample_articles_with_notes(db_session):
    """Create sample articles with expert notes for testing"""
    articles = []
    
    # F&B Articles
    fb_articles = [
        {
            "title": "Plant-Based Meat Market Growth",
            "url": "https://example.com/plant-meat",
            "raw_text": "The plant-based meat market is experiencing unprecedented growth driven by consumer demand for sustainable protein alternatives.",
            "industry": "Consumer",
            "specializations": ["Food & Beverage"],
            "priority": "Essential"
        },
        {
            "title": "Sustainable Packaging Innovations",
            "url": "https://example.com/packaging",
            "raw_text": "New biodegradable packaging solutions are revolutionizing the food industry's approach to environmental sustainability.",
            "industry": "Consumer", 
            "specializations": ["Food & Beverage", "Sustainability"],
            "priority": "High"
        },
        {
            "title": "Consumer Food Preferences 2024",
            "url": "https://example.com/preferences",
            "raw_text": "Consumer preferences are shifting towards healthier, more sustainable food options with transparency in sourcing.",
            "industry": "Consumer",
            "specializations": ["Food & Beverage"],
            "priority": "Normal"
        }
    ]
    
    # Tech Articles
    tech_articles = [
        {
            "title": "AI in Agriculture",
            "url": "https://example.com/ai-agriculture",
            "raw_text": "Artificial intelligence is transforming agricultural practices through precision farming and predictive analytics.",
            "industry": "Technology",
            "specializations": ["Agriculture", "AI"],
            "priority": "High"
        },
        {
            "title": "Blockchain Supply Chain",
            "url": "https://example.com/blockchain",
            "raw_text": "Blockchain technology is enabling transparent and traceable supply chains across various industries.",
            "industry": "Technology",
            "specializations": ["Supply Chain", "Blockchain"],
            "priority": "Normal"
        }
    ]
    
    all_article_data = fb_articles + tech_articles
    
    for article_data in all_article_data:
        # Create article
        article = Article(
            id=uuid.uuid4(),
            url=article_data["url"],
            title=article_data["title"],
            source="example.com",
            raw_text=article_data["raw_text"],
            word_count=len(article_data["raw_text"].split()),
            is_paywalled=False
        )
        
        db_session.add(article)
        db_session.commit()
        db_session.refresh(article)
        
        # Create expert note
        expert_note = ExpertNote(
            expert_id=uuid.uuid4(),
            article_id=article.id,
            notes_text=f"Expert analysis: {article_data['title']}",
            priority=article_data["priority"],
            expert_industry=article_data["industry"],
            expert_specializations=article_data["specializations"]
        )
        
        db_session.add(expert_note)
        db_session.commit()
        
        articles.append(article)
    
    return articles


class TestFilterParsing:
    """Test filter context parsing functionality"""
    
    def test_parse_filter_context_core(self):
        """Test parsing core filter"""
        result = parse_filter_context("core")
        assert result == {"type": "core"}
    
    def test_parse_filter_context_industry(self):
        """Test parsing industry filter"""
        result = parse_filter_context("industry:Consumer")
        assert result == {"type": "industry", "value": "Consumer"}
    
    def test_parse_filter_context_specialization(self):
        """Test parsing specialization filter"""
        result = parse_filter_context("specialization:Food & Beverage")
        assert result == {"type": "specialization", "value": "Food & Beverage"}
    
    def test_parse_filter_context_interest(self):
        """Test parsing interest filter"""
        result = parse_filter_context("interest:Technology")
        assert result == {"type": "interest", "value": "Technology"}
    
    def test_parse_filter_context_empty(self):
        """Test parsing empty filter defaults to core"""
        result = parse_filter_context("")
        assert result == {"type": "core"}
    
    def test_parse_filter_context_invalid(self):
        """Test parsing invalid filter defaults to core"""
        result = parse_filter_context("invalid_format")
        assert result == {"type": "core"}


class TestArticleFiltering:
    """Test article filtering by context"""
    
    def test_get_articles_for_filter_core(self, sample_user_with_profile, sample_articles_with_notes, db_session):
        """Test getting articles for core filter (user's industry + specializations)"""
        articles = get_articles_for_filter(sample_user_with_profile, "core", db=db_session)
        
        # Should return F&B articles (user's specialization)
        assert len(articles) == 3
        titles = [a.title for a in articles]
        assert "Plant-Based Meat Market Growth" in titles
        assert "Sustainable Packaging Innovations" in titles
        assert "Consumer Food Preferences 2024" in titles
    
    def test_get_articles_for_filter_specialization(self, sample_user_with_profile, sample_articles_with_notes, db_session):
        """Test getting articles for specific specialization filter"""
        articles = get_articles_for_filter(
            sample_user_with_profile, 
            "specialization:Food & Beverage", 
            db=db_session
        )
        
        # Should return only F&B articles
        assert len(articles) == 3
        for article in articles:
            expert_notes = db_session.query(ExpertNote).filter(ExpertNote.article_id == article.id).all()
            assert any("Food & Beverage" in note.expert_specializations for note in expert_notes)
    
    def test_get_articles_for_filter_industry(self, sample_user_with_profile, sample_articles_with_notes, db_session):
        """Test getting articles for specific industry filter"""
        articles = get_articles_for_filter(
            sample_user_with_profile, 
            "industry:Technology", 
            db=db_session
        )
        
        # Should return only tech articles
        assert len(articles) == 2
        titles = [a.title for a in articles]
        assert "AI in Agriculture" in titles
        assert "Blockchain Supply Chain" in titles
    
    def test_get_articles_for_filter_interest(self, sample_user_with_profile, sample_articles_with_notes, db_session):
        """Test getting articles for interest filter"""
        articles = get_articles_for_filter(
            sample_user_with_profile, 
            "interest:Technology", 
            db=db_session
        )
        
        # Should return tech articles (user has Technology as additional interest)
        assert len(articles) == 2
    
    def test_get_articles_for_filter_no_profile(self, db_session):
        """Test getting articles when user has no profile"""
        user = User(
            id=uuid.uuid4(),
            email="noprofile@example.com",
            password_hash="hashed",
            is_active=True
        )
        db_session.add(user)
        db_session.commit()
        
        articles = get_articles_for_filter(user, "core", db=db_session)
        assert len(articles) == 0


class TestEmbeddings:
    """Test article embedding computation"""
    
    @patch('app.services.clustering_service.get_embedding_model')
    def test_compute_article_embeddings(self, mock_get_model, sample_articles_with_notes):
        """Test computing embeddings for articles"""
        # Mock the embedding model
        mock_model = MagicMock()
        mock_model.encode.return_value = [np.random.rand(384) for _ in range(len(sample_articles_with_notes))]
        mock_get_model.return_value = mock_model
        
        embeddings = compute_article_embeddings(sample_articles_with_notes)
        
        assert len(embeddings) == len(sample_articles_with_notes)
        for article in sample_articles_with_notes:
            assert article.id in embeddings
            assert isinstance(embeddings[article.id], np.ndarray)
    
    def test_compute_article_embeddings_empty(self):
        """Test computing embeddings for empty article list"""
        embeddings = compute_article_embeddings([])
        assert embeddings == {}
    
    @patch('app.services.clustering_service.get_embedding_model')
    def test_compute_article_embeddings_no_text(self, mock_get_model, db_session):
        """Test computing embeddings for articles with no text"""
        # Create article with no title or text
        article = Article(
            id=uuid.uuid4(),
            url="https://example.com/empty",
            title=None,
            raw_text=None,
            is_paywalled=False
        )
        
        embeddings = compute_article_embeddings([article])
        assert len(embeddings) == 0


class TestClustering:
    """Test semantic clustering functionality"""
    
    @patch('app.services.clustering_service.get_embedding_model')
    @patch('app.services.clustering_service._generate_cluster_summary')
    @patch('app.services.clustering_service._generate_cluster_theme')
    def test_cluster_articles_for_context_groups_similar(
        self, mock_theme, mock_summary, mock_get_model, 
        sample_user_with_profile, sample_articles_with_notes, db_session
    ):
        """Test that clustering groups similar articles together"""
        # Mock embedding model to return similar embeddings for F&B articles
        mock_model = MagicMock()
        
        # Create embeddings where F&B articles are similar to each other
        fb_embedding = np.array([1.0, 0.0, 0.0])
        tech_embedding = np.array([0.0, 1.0, 0.0])
        
        def mock_encode(texts):
            embeddings = []
            for text in texts:
                if any(keyword in text.lower() for keyword in ['plant', 'packaging', 'food']):
                    # F&B articles get similar embeddings
                    embeddings.append(fb_embedding + np.random.normal(0, 0.1, 3))
                else:
                    # Tech articles get different embeddings
                    embeddings.append(tech_embedding + np.random.normal(0, 0.1, 3))
            return embeddings
        
        mock_model.encode = mock_encode
        mock_get_model.return_value = mock_model
        
        # Mock LLM responses
        mock_summary.return_value = "Summary of F&B trends"
        mock_theme.return_value = "Food Innovation"
        
        # Test clustering with F&B specialization filter
        storyboards = cluster_articles_for_context(
            sample_user_with_profile, 
            "specialization:Food & Beverage", 
            db=db_session
        )
        
        # Should create at least one storyboard
        assert len(storyboards) >= 1
        
        # Verify storyboard has F&B articles
        for storyboard in storyboards:
            storyboard_articles = db_session.query(StoryboardArticle).filter(
                StoryboardArticle.storyboard_id == storyboard.id
            ).all()
            assert len(storyboard_articles) >= 2  # At least 2 articles in cluster
    
    def test_cluster_articles_for_context_insufficient_articles(
        self, sample_user_with_profile, db_session
    ):
        """Test clustering with insufficient articles"""
        # Create only one article
        article = Article(
            id=uuid.uuid4(),
            url="https://example.com/single",
            title="Single Article",
            raw_text="This is a single article",
            is_paywalled=False
        )
        db_session.add(article)
        db_session.commit()
        
        expert_note = ExpertNote(
            expert_id=uuid.uuid4(),
            article_id=article.id,
            expert_industry="Consumer",
            expert_specializations=["Food & Beverage"]
        )
        db_session.add(expert_note)
        db_session.commit()
        
        storyboards = cluster_articles_for_context(
            sample_user_with_profile, 
            "specialization:Food & Beverage", 
            db=db_session
        )
        
        # Should return empty list (not enough articles)
        assert len(storyboards) == 0


class TestStoryboardCaching:
    """Test storyboard caching functionality"""
    
    @patch('app.services.clustering_service.cluster_articles_for_context')
    def test_get_or_build_storyboards_uses_cache(
        self, mock_cluster, sample_user_with_profile, db_session
    ):
        """Test that cached storyboards are returned when available"""
        # Create a cached storyboard
        storyboard = Storyboard(
            id=uuid.uuid4(),
            industry="Consumer",
            specializations=["Food & Beverage"],
            headline_article_id=uuid.uuid4(),
            summary="Cached storyboard"
        )
        db_session.add(storyboard)
        db_session.commit()
        
        # Create cache entry
        cache_entry = StoryboardCache(
            user_id=sample_user_with_profile.id,
            filter_context="specialization:Food & Beverage",
            cache_date=datetime.now().strftime('%Y-%m-%d'),
            storyboard_ids=[str(storyboard.id)],
            expires_at=datetime.now() + timedelta(hours=6)
        )
        db_session.add(cache_entry)
        db_session.commit()
        
        # Get storyboards
        storyboards = get_or_build_storyboards_for_filter(
            sample_user_with_profile,
            "specialization:Food & Beverage",
            db=db_session
        )
        
        # Should return cached storyboard without calling clustering
        assert len(storyboards) == 1
        assert storyboards[0].id == storyboard.id
        mock_cluster.assert_not_called()
    
    @patch('app.services.clustering_service.cluster_articles_for_context')
    def test_get_or_build_storyboards_builds_new(
        self, mock_cluster, sample_user_with_profile, db_session
    ):
        """Test that new storyboards are built when cache is empty"""
        # Mock clustering to return a storyboard
        mock_storyboard = Storyboard(
            id=uuid.uuid4(),
            industry="Consumer",
            specializations=["Food & Beverage"],
            headline_article_id=uuid.uuid4(),
            summary="New storyboard"
        )
        mock_cluster.return_value = [mock_storyboard]
        
        storyboards = get_or_build_storyboards_for_filter(
            sample_user_with_profile,
            "specialization:Food & Beverage",
            db=db_session
        )
        
        # Should call clustering and return new storyboard
        mock_cluster.assert_called_once()
        assert len(storyboards) == 1


class TestSameArticleDifferentFilters:
    """Test that same article can appear in different filter contexts"""
    
    def test_same_article_appears_in_different_filter_clusters(
        self, sample_user_with_profile, db_session
    ):
        """Test that an article can appear in different clusters for different filters"""
        # Create an article that matches multiple filters
        article = Article(
            id=uuid.uuid4(),
            url="https://example.com/multi-filter",
            title="Sustainable Food Technology",
            raw_text="This article covers sustainable technology in the food industry",
            is_paywalled=False
        )
        db_session.add(article)
        db_session.commit()
        
        # Create expert notes for multiple contexts
        expert_note_fb = ExpertNote(
            expert_id=uuid.uuid4(),
            article_id=article.id,
            expert_industry="Consumer",
            expert_specializations=["Food & Beverage"]
        )
        
        expert_note_tech = ExpertNote(
            expert_id=uuid.uuid4(),
            article_id=article.id,
            expert_industry="Technology",
            expert_specializations=["Sustainability"]
        )
        
        db_session.add(expert_note_fb)
        db_session.add(expert_note_tech)
        db_session.commit()
        
        # Get articles for F&B filter
        fb_articles = get_articles_for_filter(
            sample_user_with_profile, 
            "specialization:Food & Beverage", 
            db=db_session
        )
        
        # Get articles for Technology filter
        tech_articles = get_articles_for_filter(
            sample_user_with_profile, 
            "industry:Technology", 
            db=db_session
        )
        
        # Article should appear in both contexts
        fb_article_ids = [a.id for a in fb_articles]
        tech_article_ids = [a.id for a in tech_articles]
        
        assert article.id in fb_article_ids
        assert article.id in tech_article_ids


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
