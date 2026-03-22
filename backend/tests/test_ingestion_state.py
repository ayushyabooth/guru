"""
Comprehensive tests for smart ingestion state management
"""
import pytest
import os
import tempfile
import shutil
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, MagicMock

from app.db.database import Base
from app.models.ingestion import IngestionState, IngestionLog, IngestionStatus
from app.models.article import Article
from app.models.article import ExpertNote
from app.services.ingestion_state_service import IngestionStateService
from app.services.markdown_ingestion_service import parse_expert_links_md_with_state
from app.tasks.ingestion_tasks import smart_ingest_expert_links


class TestIngestionState:
    """Test suite for ingestion state management"""
    
    @classmethod
    def setup_class(cls):
        """Set up test database and session"""
        # Create in-memory SQLite database for testing
        cls.engine = create_engine("sqlite:///:memory:", echo=False)
        Base.metadata.create_all(cls.engine)
        
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        
        # Create temporary directory for test files
        cls.temp_dir = tempfile.mkdtemp()
        
        # Sample expert-links.md content
        cls.sample_content = """# Guru Reading List – Test Articles

S.No,Title,URL,Domain,Type,Importance
1,"Test Article 1","https://example.com/article1","example.com","Insight/Op-ed","Essential"
2,"Test Article 2","https://example.com/article2","example.com","News/Update","Normal"
3,"Test Article 3","https://example.com/article3","tech.com","Insight/Op-ed","Essential"
"""
    
    @classmethod
    def teardown_class(cls):
        """Clean up test environment"""
        shutil.rmtree(cls.temp_dir)
    
    def setup_method(self):
        """Set up for each test method"""
        self.db = self.SessionLocal()
        
        # Clear all tables
        self.db.query(IngestionLog).delete()
        self.db.query(IngestionState).delete()
        self.db.query(ExpertNote).delete()
        self.db.query(Article).delete()
        self.db.commit()
        
        # Create test file
        self.test_file = os.path.join(self.temp_dir, "test-expert-links.md")
        with open(self.test_file, 'w') as f:
            f.write(self.sample_content)
    
    def teardown_method(self):
        """Clean up after each test method"""
        self.db.close()
        if os.path.exists(self.test_file):
            os.remove(self.test_file)
    
    def test_compute_file_hash(self):
        """Test file hash computation"""
        # Test with existing file
        hash1 = IngestionStateService.compute_file_hash(self.test_file)
        assert hash1
        assert len(hash1) == 64  # SHA256 hex string
        
        # Same file should produce same hash
        hash2 = IngestionStateService.compute_file_hash(self.test_file)
        assert hash1 == hash2
        
        # Different content should produce different hash
        with open(self.test_file, 'a') as f:
            f.write("\n# Additional content")
        
        hash3 = IngestionStateService.compute_file_hash(self.test_file)
        assert hash3 != hash1
        
        # Test with non-existent file
        with pytest.raises(FileNotFoundError):
            IngestionStateService.compute_file_hash("non-existent-file.md")
    
    def test_create_ingestion_state(self):
        """Test creating ingestion state"""
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        assert state.id
        assert state.file_path == self.test_file
        assert state.file_hash
        assert state.status == IngestionStatus.PENDING
        assert state.total_articles_ingested == 0
        assert state.created_at
        
        # Verify it's in database
        db_state = self.db.query(IngestionState).filter(IngestionState.id == state.id).first()
        assert db_state
        assert db_state.file_path == self.test_file
    
    def test_has_file_changed_no_previous_state(self):
        """Test file change detection with no previous state"""
        # No previous state should return True
        assert IngestionStateService.has_file_changed(self.test_file, self.db) == True
    
    def test_has_file_changed_with_previous_state(self):
        """Test file change detection with previous state"""
        # Create initial state
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        IngestionStateService.update_ingestion_state(
            str(state.id), 
            IngestionStatus.COMPLETED, 
            total_articles=3,
            db=self.db
        )
        
        # File hasn't changed - should return False
        assert IngestionStateService.has_file_changed(self.test_file, self.db) == False
        
        # Modify file
        with open(self.test_file, 'a') as f:
            f.write("\n4,\"New Article\",\"https://example.com/new\",\"example.com\",\"News\",\"Normal\"")
        
        # File has changed - should return True
        assert IngestionStateService.has_file_changed(self.test_file, self.db) == True
    
    def test_update_ingestion_state(self):
        """Test updating ingestion state"""
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        # Update to in_progress
        success = IngestionStateService.update_ingestion_state(
            str(state.id),
            IngestionStatus.IN_PROGRESS,
            db=self.db
        )
        assert success
        
        # Verify update
        updated_state = self.db.query(IngestionState).filter(IngestionState.id == state.id).first()
        assert updated_state.status == IngestionStatus.IN_PROGRESS
        
        # Update to completed with article count
        success = IngestionStateService.update_ingestion_state(
            str(state.id),
            IngestionStatus.COMPLETED,
            total_articles=5,
            db=self.db
        )
        assert success
        
        # Verify completion update
        completed_state = self.db.query(IngestionState).filter(IngestionState.id == state.id).first()
        assert completed_state.status == IngestionStatus.COMPLETED
        assert completed_state.total_articles_ingested == 5
        assert completed_state.last_ingested_at is not None
        
        # Update to failed with error message
        success = IngestionStateService.update_ingestion_state(
            str(state.id),
            IngestionStatus.FAILED,
            error_message="Test error",
            db=self.db
        )
        assert success
        
        # Verify failure update
        failed_state = self.db.query(IngestionState).filter(IngestionState.id == state.id).first()
        assert failed_state.status == IngestionStatus.FAILED
        assert failed_state.error_message == "Test error"
    
    def test_log_ingestion_action(self):
        """Test logging ingestion actions"""
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        # Log parsing started
        success = IngestionStateService.log_ingestion_action(
            str(state.id),
            'parsing_started',
            details="Starting to parse test file",
            db=self.db
        )
        assert success
        
        # Log article creation
        success = IngestionStateService.log_ingestion_action(
            str(state.id),
            'created_article',
            article_id="test-article-id",
            details="Created test article",
            db=self.db
        )
        assert success
        
        # Verify logs in database
        logs = self.db.query(IngestionLog).filter(
            IngestionLog.ingestion_state_id == state.id
        ).order_by(IngestionLog.timestamp).all()
        
        assert len(logs) == 2
        assert logs[0].action == 'parsing_started'
        assert logs[0].details == "Starting to parse test file"
        assert logs[1].action == 'created_article'
        assert logs[1].article_id == "test-article-id"
    
    @patch('app.services.ingestion_service.ingest_url')
    def test_parse_expert_links_md_with_state(self, mock_ingest_url):
        """Test parsing with state tracking"""
        # Mock the URL ingestion
        mock_ingest_url.return_value = {
            'title': 'Mocked Article Title',
            'source': 'example.com',
            'publish_date': None,
            'raw_text': 'Mocked article content',
            'word_count': 100,
            'is_paywalled': False
        }
        
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        # Parse with state tracking
        result = parse_expert_links_md_with_state(
            self.test_file,
            str(state.id),
            self.db
        )
        
        # Verify results
        assert result['created'] == 3  # 3 articles in sample content
        assert result['skipped'] == 0
        assert result['errors'] == 0
        
        # Verify articles were created
        articles = self.db.query(Article).all()
        assert len(articles) == 3
        
        # Verify expert notes were created
        notes = self.db.query(ExpertNote).all()
        assert len(notes) == 3
        
        # Verify logs were created
        logs = self.db.query(IngestionLog).filter(
            IngestionLog.ingestion_state_id == state.id
        ).all()
        assert len(logs) > 0
        
        # Test parsing again (should skip existing articles)
        result2 = parse_expert_links_md_with_state(
            self.test_file,
            str(state.id),
            self.db
        )
        
        assert result2['created'] == 0
        assert result2['skipped'] == 3  # All articles already exist
    
    @patch('app.services.ingestion_service.ingest_url')
    async def test_smart_ingest_skips_unchanged_file(self, mock_ingest_url):
        """Test that smart ingestion skips unchanged files"""
        # Mock the URL ingestion
        mock_ingest_url.return_value = {
            'title': 'Mocked Article Title',
            'source': 'example.com',
            'publish_date': None,
            'raw_text': 'Mocked article content',
            'word_count': 100,
            'is_paywalled': False
        }
        
        # First ingestion
        result1 = await smart_ingest_expert_links(self.test_file)
        
        assert result1['status'] == 'success'
        assert result1['action'] == 'ingested'
        assert result1['total_created'] == 3
        
        # Second ingestion without file change
        result2 = await smart_ingest_expert_links(self.test_file)
        
        assert result2['status'] == 'success'
        assert result2['action'] == 'skipped'
        assert result2['total_skipped'] == 3
        assert 'unchanged since last successful ingestion' in result2['message']
    
    @patch('app.services.ingestion_service.ingest_url')
    async def test_smart_ingest_re_ingests_changed_file(self, mock_ingest_url):
        """Test that smart ingestion re-ingests changed files"""
        # Mock the URL ingestion
        mock_ingest_url.return_value = {
            'title': 'Mocked Article Title',
            'source': 'example.com',
            'publish_date': None,
            'raw_text': 'Mocked article content',
            'word_count': 100,
            'is_paywalled': False
        }
        
        # First ingestion
        result1 = await smart_ingest_expert_links(self.test_file)
        assert result1['action'] == 'ingested'
        assert result1['total_created'] == 3
        
        # Modify file
        with open(self.test_file, 'a') as f:
            f.write('\n4,"New Article","https://example.com/new","example.com","News","Normal"')
        
        # Second ingestion with file change
        result2 = await smart_ingest_expert_links(self.test_file)
        
        assert result2['status'] == 'success'
        assert result2['action'] == 'ingested'
        assert result2['total_created'] == 1  # Only the new article
        assert result2['total_skipped'] == 3  # Existing articles skipped
    
    def test_ingestion_error_handling(self):
        """Test ingestion error handling"""
        # Create state
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        # Simulate error by using non-existent file
        non_existent_file = os.path.join(self.temp_dir, "non-existent.md")
        
        with pytest.raises(Exception):
            parse_expert_links_md_with_state(
                non_existent_file,
                str(state.id),
                self.db
            )
    
    def test_get_ingestion_history(self):
        """Test getting ingestion history"""
        # Create multiple states
        state1 = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        state2 = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        
        # Get history
        history = IngestionStateService.get_ingestion_history(self.test_file, limit=10, db=self.db)
        
        assert len(history) == 2
        # Should be ordered by creation date (newest first)
        assert history[0].id == state2.id
        assert history[1].id == state1.id
        
        # Test with limit
        limited_history = IngestionStateService.get_ingestion_history(self.test_file, limit=1, db=self.db)
        assert len(limited_history) == 1
        assert limited_history[0].id == state2.id
    
    def test_get_ingestion_stats(self):
        """Test getting ingestion statistics"""
        # Create some test data
        state = IngestionStateService.create_ingestion_state(self.test_file, self.db)
        IngestionStateService.update_ingestion_state(
            str(state.id),
            IngestionStatus.COMPLETED,
            total_articles=5,
            db=self.db
        )
        
        # Get stats
        stats = IngestionStateService.get_ingestion_stats(self.db)
        
        assert 'total_articles' in stats
        assert 'total_ingestion_states' in stats
        assert 'last_ingestion' in stats
        assert 'articles_by_industry' in stats
        assert 'articles_by_priority' in stats
        
        assert stats['total_ingestion_states'] == 1
    
    @patch('app.services.ingestion_service.ingest_url')
    async def test_smart_ingest_with_ingestion_failure(self, mock_ingest_url):
        """Test smart ingestion with ingestion failure"""
        # Mock ingestion to raise an exception
        mock_ingest_url.side_effect = Exception("Mocked ingestion error")
        
        result = await smart_ingest_expert_links(self.test_file)
        
        assert result['status'] == 'failed'
        assert result['action'] == 'failed'
        assert 'Mocked ingestion error' in result['message']
        assert result['errors'] == 1
        
        # Verify state was marked as failed
        states = IngestionStateService.get_ingestion_history(self.test_file, db=self.SessionLocal())
        assert len(states) == 1
        assert states[0].status == IngestionStatus.FAILED
        assert 'Mocked ingestion error' in states[0].error_message


def run_ingestion_state_tests():
    """
    Run all ingestion state tests
    Usage: python -m pytest tests/test_ingestion_state.py -v
    """
    import subprocess
    import sys
    
    try:
        result = subprocess.run([
            sys.executable, '-m', 'pytest', 
            'tests/test_ingestion_state.py', 
            '-v', '--tb=short'
        ], capture_output=True, text=True, cwd='/Users/ayushya/MatajiKaPrakop/guru-mvp/backend')
        
        print("🧪 Ingestion State Test Results:")
        print("=" * 50)
        print(result.stdout)
        
        if result.stderr:
            print("Errors:")
            print(result.stderr)
        
        return result.returncode == 0
        
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return False


if __name__ == "__main__":
    run_ingestion_state_tests()
