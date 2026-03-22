"""
Comprehensive E2E test suite for the full ingestion-to-frontend flow
Tests the complete pipeline from expert-links.md to working storyboards in the catchup feed
"""
import pytest
import sqlite3
import os
import requests
import uuid
from datetime import datetime
from app.services.csv_ingestion_service import parse_expert_links_csv
from app.tasks.ingestion_tasks import load_expert_links_from_md
from app.services.clustering_service import cluster_articles_for_context
from app.services.auth_service import generate_jwt, hash_password
from app.models.user import User, UserProfile
from app.db.database import SessionLocal, create_tables


class TestE2EIngestionFlow:
    """
    End-to-end test suite covering the complete Guru ingestion pipeline
    """
    
    @classmethod
    def setup_class(cls):
        """Set up test environment"""
        cls.test_db_path = 'test_e2e.db'
        cls.expert_links_path = 'expert-links.md'
        cls.backend_url = 'http://localhost:8000'
        
        # Clean up any existing test database
        if os.path.exists(cls.test_db_path):
            os.remove(cls.test_db_path)
    
    @classmethod
    def teardown_class(cls):
        """Clean up test environment"""
        if os.path.exists(cls.test_db_path):
            os.remove(cls.test_db_path)
    
    def test_01_expert_links_parsing(self):
        """Test CSV parsing of expert-links.md file"""
        # Verify expert-links.md exists
        assert os.path.exists(self.expert_links_path), "expert-links.md file not found"
        
        # Parse the CSV file
        articles = parse_expert_links_csv(self.expert_links_path)
        
        # Verify parsing results
        assert len(articles) > 0, "No articles parsed from expert-links.md"
        assert len(articles) >= 70, f"Expected at least 70 articles, got {len(articles)}"
        
        # Verify article structure
        sample_article = articles[0]
        required_fields = ['url', 'title', 'industry', 'specializations', 'priority']
        for field in required_fields:
            assert field in sample_article, f"Missing required field: {field}"
        
        # Verify URL format
        assert sample_article['url'].startswith('http'), "Invalid URL format"
        
        # Verify industry mapping
        industries = set(article['industry'] for article in articles)
        expected_industries = {'Consumer', 'Technology', 'Finance', 'Healthcare'}
        assert industries.intersection(expected_industries), "No valid industries found"
        
        print(f"✅ Parsed {len(articles)} articles from expert-links.md")
        print(f"   Industries: {sorted(industries)}")
    
    def test_02_database_setup(self):
        """Test database table creation"""
        # Create database tables
        create_tables()
        
        # Verify tables exist
        conn = sqlite3.connect('guru.db')
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        required_tables = [
            'users', 'user_profiles', 'articles', 'expert_notes', 
            'storyboards', 'storyboard_articles'
        ]
        
        for table in required_tables:
            assert table in tables, f"Required table {table} not found"
        
        conn.close()
        print("✅ Database tables created successfully")
    
    def test_03_article_ingestion(self):
        """Test full article ingestion pipeline"""
        # Run ingestion
        result = load_expert_links_from_md(self.expert_links_path)
        
        # Verify ingestion results
        assert result['processed'] > 0, "No articles processed"
        assert result['queued_for_ingestion'] > 0, "No articles queued for ingestion"
        assert result['errors'] == 0, f"Ingestion errors: {result['errors']}"
        
        # Verify database content
        conn = sqlite3.connect('guru.db')
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM articles')
        article_count = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM expert_notes')
        note_count = cursor.fetchone()[0]
        
        assert article_count > 0, "No articles in database"
        assert note_count > 0, "No expert notes in database"
        assert article_count == note_count, "Article and expert note counts don't match"
        
        # Verify industry distribution
        cursor.execute('SELECT expert_industry, COUNT(*) FROM expert_notes GROUP BY expert_industry')
        industries = dict(cursor.fetchall())
        
        assert len(industries) >= 3, "Expected at least 3 different industries"
        assert 'Consumer' in industries, "Consumer industry not found"
        
        conn.close()
        print(f"✅ Ingested {article_count} articles with {note_count} expert notes")
        print(f"   Industry distribution: {industries}")
    
    def test_04_user_creation_and_auth(self):
        """Test user creation and JWT authentication"""
        db = SessionLocal()
        
        try:
            # Create test user
            user_id = uuid.uuid4()
            hashed_password = hash_password('testpass123')
            
            test_user = User(
                id=user_id,
                email='e2e.test@example.com',
                password_hash=hashed_password,
                is_active=True
            )
            db.add(test_user)
            
            # Create user profile
            profile = UserProfile(
                user_id=user_id,
                core_industry='Consumer',
                specializations=['Food & Beverage'],
                additional_interest_industries=['Technology', 'Finance'],
                total_weekly_capacity_band='2-3 hours',
                catchup_daily_goal_minutes=20,
                catchup_daily_max_minutes=45,
                divein_weekly_goal_minutes=60,
                recap_weekly_goal_minutes=30
            )
            db.add(profile)
            db.commit()
            
            # Generate JWT token
            token = generate_jwt(str(user_id), 'access')
            assert token, "Failed to generate JWT token"
            
            # Store for later tests
            self.test_user_id = str(user_id)
            self.test_token = token
            
            print(f"✅ Created test user: e2e.test@example.com")
            print(f"   JWT token generated: {token[:50]}...")
            
        finally:
            db.close()
    
    def test_05_storyboard_generation(self):
        """Test filter-driven storyboard clustering"""
        db = SessionLocal()
        
        try:
            # Get test user
            test_user = db.query(User).filter(User.id == self.test_user_id).first()
            assert test_user, "Test user not found"
            
            # Generate storyboards for different filter contexts
            contexts = ['core', 'specialization:Food & Beverage', 'interest:Technology']
            
            total_storyboards = 0
            for context in contexts:
                storyboards = cluster_articles_for_context(test_user, context, db=db)
                assert len(storyboards) >= 0, f"Error generating storyboards for {context}"
                total_storyboards += len(storyboards)
                
                # Verify storyboard structure
                for sb in storyboards:
                    assert sb.industry, "Storyboard missing industry"
                    assert sb.headline_article_id, "Storyboard missing headline article"
                    assert sb.summary, "Storyboard missing summary"
            
            assert total_storyboards > 0, "No storyboards generated"
            
            print(f"✅ Generated {total_storyboards} storyboards across {len(contexts)} filter contexts")
            
        finally:
            db.close()
    
    def test_06_catchup_feed_api(self):
        """Test catchup feed API with real authentication"""
        # Test API endpoint
        headers = {'Authorization': f'Bearer {self.test_token}'}
        response = requests.get(
            f'{self.backend_url}/catchup-feed?filter=core&limit=5&offset=0',
            headers=headers
        )
        
        assert response.status_code == 200, f"API request failed: {response.status_code}"
        
        data = response.json()
        
        # Verify response structure
        assert 'storyboards' in data, "Response missing storyboards"
        assert 'total' in data, "Response missing total count"
        assert 'filter' in data, "Response missing filter"
        
        # Verify storyboard content
        storyboards = data['storyboards']
        if len(storyboards) > 0:
            sb = storyboards[0]
            
            required_fields = [
                'id', 'industry', 'summary', 'headline_article', 'related_articles'
            ]
            for field in required_fields:
                assert field in sb, f"Storyboard missing field: {field}"
            
            # Verify headline article structure
            headline = sb['headline_article']
            assert 'title' in headline, "Headline article missing title"
            assert 'source' in headline, "Headline article missing source"
            assert 'url' in headline, "Headline article missing URL"
            
            print(f"✅ Catchup feed API returned {len(storyboards)} storyboards")
            print(f"   Sample: {headline['title'][:50]}...")
        else:
            print("⚠️ No storyboards returned (may be expected for some filters)")
    
    def test_07_frontend_integration_readiness(self):
        """Test that frontend can integrate with the backend"""
        # Verify backend is running
        try:
            response = requests.get(f'{self.backend_url}/health')
            assert response.status_code == 200, "Backend health check failed"
        except requests.exceptions.ConnectionError:
            pytest.fail("Backend not running - start with: uvicorn app.main:app --reload")
        
        # Verify test authentication utility
        test_auth_path = '../mobile/utils/test-auth.ts'
        if os.path.exists(test_auth_path):
            with open(test_auth_path, 'r') as f:
                content = f.read()
                assert 'useExistingTestToken' in content, "Test auth utility missing"
                assert self.test_token[:20] in content, "Test token not updated in auth utility"
        
        print("✅ Frontend integration ready")
        print(f"   Backend running at: {self.backend_url}")
        print(f"   Test token available in utils/test-auth.ts")
    
    def test_08_data_quality_verification(self):
        """Verify the quality and meaningfulness of ingested data"""
        conn = sqlite3.connect('guru.db')
        cursor = conn.cursor()
        
        try:
            # Check article content quality
            cursor.execute('SELECT COUNT(*) FROM articles WHERE word_count > 0')
            articles_with_content = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM articles')
            total_articles = cursor.fetchone()[0]
            
            content_ratio = articles_with_content / total_articles if total_articles > 0 else 0
            
            # Check source diversity
            cursor.execute('SELECT COUNT(DISTINCT source) FROM articles')
            unique_sources = cursor.fetchone()[0]
            
            # Check priority distribution
            cursor.execute('SELECT priority, COUNT(*) FROM expert_notes GROUP BY priority')
            priorities = dict(cursor.fetchall())
            
            # Assertions for data quality
            assert total_articles >= 50, f"Expected at least 50 articles, got {total_articles}"
            assert unique_sources >= 20, f"Expected at least 20 unique sources, got {unique_sources}"
            assert content_ratio > 0.1, f"Too few articles with content: {content_ratio:.2%}"
            assert 'Essential' in priorities, "No Essential priority articles found"
            
            print(f"✅ Data quality verified:")
            print(f"   Total articles: {total_articles}")
            print(f"   Articles with content: {articles_with_content} ({content_ratio:.1%})")
            print(f"   Unique sources: {unique_sources}")
            print(f"   Priority distribution: {priorities}")
            
        finally:
            conn.close()


def run_e2e_test_suite():
    """
    Run the complete E2E test suite
    Usage: python -m pytest tests/test_e2e_ingestion_flow.py -v
    """
    print("🚀 Starting Guru E2E Ingestion Flow Test Suite")
    print("=" * 60)
    
    # Run tests in order
    test_instance = TestE2EIngestionFlow()
    test_instance.setup_class()
    
    try:
        test_instance.test_01_expert_links_parsing()
        test_instance.test_02_database_setup()
        test_instance.test_03_article_ingestion()
        test_instance.test_04_user_creation_and_auth()
        test_instance.test_05_storyboard_generation()
        test_instance.test_06_catchup_feed_api()
        test_instance.test_07_frontend_integration_readiness()
        test_instance.test_08_data_quality_verification()
        
        print("\n🎉 All E2E tests passed successfully!")
        print("✅ Full ingestion pipeline working from expert-links.md to frontend")
        
    except Exception as e:
        print(f"\n❌ E2E test failed: {e}")
        raise
    finally:
        test_instance.teardown_class()


if __name__ == "__main__":
    run_e2e_test_suite()
