"""
Test suite for Guru PostgreSQL models
"""
import pytest
import uuid
from datetime import datetime, date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.storyboard import Storyboard, StoryboardArticle
from app.models.interaction import UserSavedArticle, UserNotRelevant
from app.models.recap import RecapSession, RecapSessionPublish
from app.models.metric import TimeLog, DailyMetric


@pytest.fixture
def db_session():
    """Create a test database session"""
    # Use SQLite for testing to avoid PostgreSQL dependency
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    
    yield session
    
    session.close()


def test_user_creation(db_session):
    """Test user creation and verify id is UUID"""
    # Create a user
    user = User(
        email="test@guru.com",
        password_hash="hashed_password_123",
        is_active=True
    )
    
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    # Verify user was created
    assert user.id is not None
    assert isinstance(user.id, uuid.UUID)
    assert user.email == "test@guru.com"
    assert user.password_hash == "hashed_password_123"
    assert user.is_active is True
    assert user.created_at is not None
    assert user.updated_at is not None
    
    # Verify user can be retrieved
    retrieved_user = db_session.query(User).filter(User.email == "test@guru.com").first()
    assert retrieved_user is not None
    assert retrieved_user.id == user.id
    assert isinstance(retrieved_user.id, uuid.UUID)


def test_user_profile_creation(db_session):
    """Test user profile creation with defaults"""
    # First create a user
    user = User(
        email="profile_test@guru.com",
        password_hash="hashed_password_123",
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    # Create user profile with defaults
    profile = UserProfile(
        user_id=user.id,
        core_industry="Consumer",
        specializations=["Food & Beverage", "Personal Care"],
        additional_interest_industries=["Technology"],
        total_weekly_capacity_band="~2h",
        catchup_daily_goal_minutes=20,
        catchup_daily_max_minutes=45,
        divein_weekly_goal_minutes=90,
        recap_weekly_goal_minutes=30
    )
    
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)
    
    # Verify profile was created with correct defaults
    assert profile.user_id == user.id
    assert isinstance(profile.user_id, uuid.UUID)
    assert profile.core_industry == "Consumer"
    assert profile.specializations == ["Food & Beverage", "Personal Care"]
    assert profile.additional_interest_industries == ["Technology"]
    assert profile.total_weekly_capacity_band == "~2h"
    assert profile.catchup_daily_goal_minutes == 20
    assert profile.catchup_daily_max_minutes == 45
    assert profile.divein_weekly_goal_minutes == 90
    assert profile.recap_weekly_goal_minutes == 30
    assert profile.created_at is not None
    assert profile.updated_at is not None
    
    # Test relationship
    user_with_profile = db_session.query(User).filter(User.id == user.id).first()
    assert user_with_profile.profile is not None
    assert user_with_profile.profile.core_industry == "Consumer"


def test_article_creation(db_session):
    """Test article creation with paywall flag"""
    # Test regular article
    article = Article(
        url="https://example.com/test-article",
        title="Test Article Title",
        source="Test Source",
        publish_date=datetime.now(),
        raw_text="This is test article content...",
        word_count=500,
        is_paywalled=False
    )
    
    db_session.add(article)
    db_session.commit()
    db_session.refresh(article)
    
    # Verify article was created
    assert article.id is not None
    assert isinstance(article.id, uuid.UUID)
    assert article.url == "https://example.com/test-article"
    assert article.title == "Test Article Title"
    assert article.source == "Test Source"
    assert article.raw_text == "This is test article content..."
    assert article.word_count == 500
    assert article.is_paywalled is False
    assert article.created_at is not None
    assert article.updated_at is not None
    
    # Test paywalled article
    paywalled_article = Article(
        url="https://paywall.com/premium-article",
        title="Premium Article Behind Paywall",
        source="Premium Source",
        publish_date=datetime.now(),
        raw_text=None,  # No raw text for paywalled content
        word_count=0,
        is_paywalled=True
    )
    
    db_session.add(paywalled_article)
    db_session.commit()
    db_session.refresh(paywalled_article)
    
    # Verify paywalled article
    assert paywalled_article.id is not None
    assert isinstance(paywalled_article.id, uuid.UUID)
    assert paywalled_article.is_paywalled is True
    assert paywalled_article.raw_text is None
    assert paywalled_article.word_count == 0
    
    # Verify both articles can be retrieved
    articles = db_session.query(Article).all()
    assert len(articles) == 2
    
    # Test filtering by paywall status
    free_articles = db_session.query(Article).filter(Article.is_paywalled == False).all()
    paywalled_articles = db_session.query(Article).filter(Article.is_paywalled == True).all()
    
    assert len(free_articles) == 1
    assert len(paywalled_articles) == 1
    assert free_articles[0].url == "https://example.com/test-article"
    assert paywalled_articles[0].url == "https://paywall.com/premium-article"


def test_expert_note_creation(db_session):
    """Test expert note creation and relationship with articles"""
    # Create an article first
    article = Article(
        url="https://example.com/expert-article",
        title="Article with Expert Notes",
        source="Expert Source",
        is_paywalled=True
    )
    db_session.add(article)
    db_session.commit()
    
    # Create expert note
    expert_id = uuid.uuid4()
    expert_note = ExpertNote(
        expert_id=expert_id,
        article_id=article.id,
        notes_text="Expert insights: This article discusses key trends...",
        priority="Essential",
        expert_industry="Consumer",
        expert_specializations=["Food & Beverage", "Retail"]
    )
    
    db_session.add(expert_note)
    db_session.commit()
    db_session.refresh(expert_note)
    
    # Verify expert note
    assert expert_note.id is not None
    assert isinstance(expert_note.id, uuid.UUID)
    assert expert_note.expert_id == expert_id
    assert expert_note.article_id == article.id
    assert expert_note.priority == "Essential"
    assert expert_note.expert_specializations == ["Food & Beverage", "Retail"]
    
    # Test relationship
    article_with_notes = db_session.query(Article).filter(Article.id == article.id).first()
    assert len(article_with_notes.expert_notes) == 1
    assert article_with_notes.expert_notes[0].priority == "Essential"


def test_storyboard_creation(db_session):
    """Test storyboard creation and article relationships"""
    # Create articles first
    headline_article = Article(
        url="https://example.com/headline",
        title="Headline Article",
        source="News Source"
    )
    related_article = Article(
        url="https://example.com/related",
        title="Related Article",
        source="Related Source"
    )
    
    db_session.add_all([headline_article, related_article])
    db_session.commit()
    
    # Create storyboard
    storyboard = Storyboard(
        industry="Consumer",
        specializations=["Food & Beverage"],
        headline_article_id=headline_article.id,
        summary="This storyboard covers recent F&B trends..."
    )
    
    db_session.add(storyboard)
    db_session.commit()
    db_session.refresh(storyboard)
    
    # Create storyboard article relationship
    storyboard_article = StoryboardArticle(
        storyboard_id=storyboard.id,
        article_id=related_article.id,
        rank=1
    )
    
    db_session.add(storyboard_article)
    db_session.commit()
    
    # Verify storyboard
    assert storyboard.id is not None
    assert isinstance(storyboard.id, uuid.UUID)
    assert storyboard.industry == "Consumer"
    assert storyboard.specializations == ["Food & Beverage"]
    assert storyboard.headline_article_id == headline_article.id
    
    # Test relationships
    assert len(storyboard.storyboard_articles) == 1
    assert storyboard.storyboard_articles[0].rank == 1


def test_user_interactions(db_session):
    """Test user interaction models (saved articles, not relevant)"""
    # Create user and article
    user = User(email="interaction_test@guru.com", password_hash="hash")
    article = Article(url="https://example.com/save-test", title="Save Test")
    
    db_session.add_all([user, article])
    db_session.commit()
    
    # Create storyboard with proper headline_article_id
    storyboard = Storyboard(
        industry="Consumer",
        specializations=["Tech"],
        headline_article_id=article.id,
        summary="Test storyboard"
    )
    
    db_session.add(storyboard)
    db_session.commit()
    
    # Test saved article
    saved_article = UserSavedArticle(
        user_id=user.id,
        article_id=article.id
    )
    db_session.add(saved_article)
    db_session.commit()
    
    # Test not relevant storyboard
    not_relevant = UserNotRelevant(
        user_id=user.id,
        storyboard_id=storyboard.id
    )
    db_session.add(not_relevant)
    db_session.commit()
    
    # Verify interactions
    assert saved_article.id is not None
    assert isinstance(saved_article.id, uuid.UUID)
    assert not_relevant.id is not None
    assert isinstance(not_relevant.id, uuid.UUID)
    
    # Test relationships
    user_with_interactions = db_session.query(User).filter(User.id == user.id).first()
    assert len(user_with_interactions.saved_articles) == 1
    assert len(user_with_interactions.not_relevant_storyboards) == 1


def test_recap_session_flow(db_session):
    """Test recap session, questions, and responses"""
    # Create user
    user = User(email="recap_test@guru.com", password_hash="hash")
    db_session.add(user)
    db_session.commit()
    
    # Create recap session
    recap_session = RecapSession(
        user_id=user.id,
        week_start=date(2026, 1, 1),
        week_end=date(2026, 1, 7),
        status="in_progress"
    )
    db_session.add(recap_session)
    db_session.commit()
    
    # Create recap question
    question = RecapQuestion(
        recap_session_id=recap_session.id,
        question_number=1,
        question_text="What was the main insight from this week?",
        question_type="reflection"
    )
    db_session.add(question)
    db_session.commit()
    
    # Create recap response
    response = RecapResponse(
        question_id=question.id,
        response_text="The main insight was about market trends...",
        response_option=None
    )
    db_session.add(response)
    db_session.commit()
    
    # Verify recap flow
    assert recap_session.id is not None
    assert isinstance(recap_session.id, uuid.UUID)
    assert question.id is not None
    assert isinstance(question.id, uuid.UUID)
    assert response.id is not None
    assert isinstance(response.id, uuid.UUID)
    
    # Test relationships
    session_with_questions = db_session.query(RecapSession).filter(
        RecapSession.id == recap_session.id
    ).first()
    assert len(session_with_questions.questions) == 1
    assert len(session_with_questions.questions[0].responses) == 1


def test_metrics_tracking(db_session):
    """Test time logs and daily metrics"""
    # Create user
    user = User(email="metrics_test@guru.com", password_hash="hash")
    db_session.add(user)
    db_session.commit()
    
    # Create time log
    time_log = TimeLog(
        user_id=user.id,
        ring_type="catchup",
        duration_seconds=1200,  # 20 minutes
        context_id="storyboard_123",
        started_at=datetime.now(),
        ended_at=datetime.now()
    )
    db_session.add(time_log)
    db_session.commit()
    
    # Create daily metric
    daily_metric = DailyMetric(
        user_id=user.id,
        metric_date=date.today(),
        catchup_minutes=20,
        catchup_goal_met=True,
        divein_minutes=0,
        recap_completed=False
    )
    db_session.add(daily_metric)
    db_session.commit()
    
    # Verify metrics
    assert time_log.id is not None
    assert isinstance(time_log.id, uuid.UUID)
    assert time_log.ring_type == "catchup"
    assert time_log.duration_seconds == 1200
    
    assert daily_metric.id is not None
    assert isinstance(daily_metric.id, uuid.UUID)
    assert daily_metric.catchup_goal_met is True
    
    # Test relationships
    user_with_metrics = db_session.query(User).filter(User.id == user.id).first()
    assert len(user_with_metrics.time_logs) == 1
    assert len(user_with_metrics.daily_metrics) == 1


def test_database_constraints(db_session):
    """Test database constraints and unique indexes"""
    # Test unique email constraint
    user1 = User(email="unique_test@guru.com", password_hash="hash1")
    user2 = User(email="unique_test@guru.com", password_hash="hash2")
    
    db_session.add(user1)
    db_session.commit()
    
    # This should raise an integrity error due to unique email constraint
    db_session.add(user2)
    with pytest.raises(Exception):  # SQLite will raise IntegrityError
        db_session.commit()
    
    db_session.rollback()
    
    # Test unique URL constraint for articles
    article1 = Article(url="https://unique-test.com/article", title="Article 1")
    article2 = Article(url="https://unique-test.com/article", title="Article 2")
    
    db_session.add(article1)
    db_session.commit()
    
    db_session.add(article2)
    with pytest.raises(Exception):  # SQLite will raise IntegrityError
        db_session.commit()
