"""
Test suite for markdown-based content ingestion functionality
"""
import pytest
import os
import tempfile
from datetime import datetime, date
from unittest.mock import patch, MagicMock
import uuid

from app.services.markdown_ingestion_service import (
    parse_expert_links_md, append_to_expert_links_md, 
    validate_expert_links_format, get_categories_from_md
)
from app.services.ingestion_service import ingest_url, validate_url, get_domain_from_url
from app.tasks.ingestion_tasks import ingest_article, load_expert_links_from_md
from app.models.article import Article, ExpertNote
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
def sample_markdown_content():
    """Sample expert-links.md content for testing"""
    return """# Expert Links

## Food & Beverage

- [Plant-Based Meat Market Growth](https://example.com/plant-meat) - Analysis of alternative protein trends (Priority: High) [Date: 2024-01-15]
- [Coffee Supply Chain Issues](https://example.com/coffee-supply) - Impact of climate change on coffee production [Date: 2024-01-10]

## Technology

- [AI in Food Production](https://example.com/ai-food) - Machine learning applications in agriculture (Priority: Essential) [Date: 2024-01-20]

## General

- [Consumer Behavior Trends](https://example.com/consumer-trends) - Post-pandemic shopping patterns [Date: 2024-01-05]
"""


@pytest.fixture
def temp_markdown_file(sample_markdown_content):
    """Create a temporary markdown file for testing"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(sample_markdown_content)
        temp_path = f.name
    
    yield temp_path
    
    # Cleanup
    if os.path.exists(temp_path):
        os.unlink(temp_path)


def test_parse_expert_links_md(temp_markdown_file):
    """Test parsing of expert-links.md file structure"""
    articles = parse_expert_links_md(temp_markdown_file)
    
    # Verify correct number of articles parsed
    assert len(articles) == 4
    
    # Test first article (with priority and date)
    first_article = articles[0]
    assert first_article['url'] == 'https://example.com/plant-meat'
    assert first_article['title'] == 'Plant-Based Meat Market Growth'
    assert first_article['notes'] == 'Analysis of alternative protein trends'
    assert first_article['priority'] == 'High'
    assert first_article['category'] == 'Food & Beverage'
    assert first_article['date_added'] == date(2024, 1, 15)
    
    # Test article without priority (should default to Normal)
    second_article = articles[1]
    assert second_article['priority'] == 'Normal'
    assert second_article['category'] == 'Food & Beverage'
    
    # Test article in different category
    tech_article = articles[2]
    assert tech_article['category'] == 'Technology'
    assert tech_article['priority'] == 'Essential'
    
    # Test article in General category
    general_article = articles[3]
    assert general_article['category'] == 'General'


def test_parse_expert_links_md_nonexistent_file():
    """Test parsing non-existent file returns empty list"""
    articles = parse_expert_links_md('/nonexistent/file.md')
    assert articles == []


def test_append_to_expert_links_md():
    """Test appending new entries to expert-links.md"""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write("# Expert Links\n\n## Food & Beverage\n\n")
        temp_path = f.name
    
    try:
        # Append new entry
        success = append_to_expert_links_md(
            filepath=temp_path,
            url="https://example.com/new-article",
            title="New Food Trend",
            notes="Interesting development in food tech",
            priority="High",
            category="Food & Beverage"
        )
        
        assert success is True
        
        # Verify the entry was added
        with open(temp_path, 'r') as f:
            content = f.read()
        
        assert "New Food Trend" in content
        assert "https://example.com/new-article" in content
        assert "Priority: High" in content
        assert "Interesting development in food tech" in content
        
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def test_validate_expert_links_format(temp_markdown_file):
    """Test validation of expert-links.md format"""
    validation_result = validate_expert_links_format(temp_markdown_file)
    
    assert validation_result['valid_entries'] == 4
    assert validation_result['invalid_entries'] == 0
    assert len(validation_result['errors']) == 0


def test_get_categories_from_md(temp_markdown_file):
    """Test extraction of categories from markdown file"""
    categories = get_categories_from_md(temp_markdown_file)
    
    expected_categories = ['Food & Beverage', 'Technology', 'General']
    assert categories == expected_categories


@patch('app.services.ingestion_service.requests.get')
def test_ingest_url_success(mock_get):
    """Test successful URL ingestion with real content"""
    # Mock successful HTTP response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = """
    <html>
        <head>
            <title>Test Article Title</title>
            <meta property="og:title" content="Test Article Title">
            <meta name="publishdate" content="2024-01-15">
        </head>
        <body>
            <article>
                <h1>Test Article Title</h1>
                <p>This is the main content of the test article. It contains valuable information about the topic.</p>
                <p>This is another paragraph with more detailed information and analysis.</p>
            </article>
        </body>
    </html>
    """
    mock_get.return_value = mock_response
    
    result = ingest_url("https://example.com/test-article")
    
    assert result['error'] is None
    assert result['title'] == "Test Article Title"
    assert result['source'] == "example.com"
    assert result['raw_text'] is not None
    assert result['word_count'] > 0
    assert result['is_paywalled'] is False


@patch('app.services.ingestion_service.requests.get')
def test_ingest_url_paywalled(mock_get):
    """Test URL ingestion with paywall detection"""
    # Mock response with paywall indicators
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = """
    <html>
        <head><title>Premium Article</title></head>
        <body>
            <div class="paywall">
                <p>This content is for subscribers only. Please subscribe to read more.</p>
            </div>
        </body>
    </html>
    """
    mock_get.return_value = mock_response
    
    result = ingest_url("https://premium-site.com/article")
    
    assert result['is_paywalled'] is True
    assert result['raw_text'] is None
    assert result['word_count'] == 0


@patch('app.services.ingestion_service.requests.get')
def test_ingest_url_404(mock_get):
    """Test URL ingestion with 404 error handling"""
    # Mock 404 response
    mock_response = MagicMock()
    mock_response.status_code = 404
    mock_get.return_value = mock_response
    
    result = ingest_url("https://example.com/nonexistent")
    
    assert result['error'] == "Page not found (404)"
    assert result['raw_text'] is None


@patch('app.services.ingestion_service.requests.get')
def test_ingest_url_timeout(mock_get):
    """Test URL ingestion with timeout handling"""
    # Mock timeout exception
    import requests
    mock_get.side_effect = requests.exceptions.Timeout()
    
    result = ingest_url("https://slow-site.com/article")
    
    assert result['error'] == "Request timeout"


def test_validate_url():
    """Test URL validation function"""
    # Valid URLs
    assert validate_url("https://example.com/article") is True
    assert validate_url("http://test.org/page") is True
    
    # Invalid URLs
    assert validate_url("not-a-url") is False
    assert validate_url("ftp://example.com") is True  # Valid but different protocol
    assert validate_url("") is False
    assert validate_url("https://") is False


def test_get_domain_from_url():
    """Test domain extraction from URLs"""
    assert get_domain_from_url("https://example.com/article") == "example.com"
    assert get_domain_from_url("http://test.org/page?param=value") == "test.org"
    assert get_domain_from_url("invalid-url") is None


@patch('app.tasks.ingestion_tasks.ingest_url')
def test_ingest_article_success(mock_ingest_url, db_session):
    """Test successful article ingestion and database creation"""
    # Mock successful URL ingestion
    mock_ingest_url.return_value = {
        'title': 'Test Article',
        'source': 'example.com',
        'publish_date': datetime(2024, 1, 15),
        'raw_text': 'This is test content for the article.',
        'word_count': 8,
        'is_paywalled': False,
        'error': None
    }
    
    # Patch the database session in the task
    with patch('app.tasks.ingestion_tasks.SessionLocal') as mock_session:
        mock_session.return_value = db_session
        
        result = ingest_article(
            url="https://example.com/test",
            notes="Expert analysis of this article",
            priority="High",
            category="Technology"
        )
    
    assert result['success'] is True
    assert result['article_id'] is not None
    assert result['error'] is None
    
    # Verify article was created in database
    article = db_session.query(Article).first()
    assert article is not None
    assert article.url == "https://example.com/test"
    assert article.title == "Test Article"
    assert article.word_count == 8
    
    # Verify expert note was created
    expert_note = db_session.query(ExpertNote).first()
    assert expert_note is not None
    assert expert_note.notes_text == "Expert analysis of this article"
    assert expert_note.priority == "High"


def test_ingest_article_duplicate_url(db_session):
    """Test that duplicate URLs are not re-ingested"""
    # Create existing article
    existing_article = Article(
        id=uuid.uuid4(),
        url="https://example.com/existing",
        title="Existing Article"
    )
    db_session.add(existing_article)
    db_session.commit()
    
    # Patch the database session in the task
    with patch('app.tasks.ingestion_tasks.SessionLocal') as mock_session:
        mock_session.return_value = db_session
        
        result = ingest_article(url="https://example.com/existing")
    
    assert result['success'] is False
    assert "already exists" in result['error']
    assert result['article_id'] == str(existing_article.id)


def test_load_expert_links_from_md_skip_duplicates(temp_markdown_file, db_session):
    """Test that existing articles are skipped during bulk loading"""
    # Create existing article
    existing_article = Article(
        id=uuid.uuid4(),
        url="https://example.com/plant-meat",
        title="Existing Plant Meat Article"
    )
    db_session.add(existing_article)
    db_session.commit()
    
    # Patch the database session and ingestion function
    with patch('app.tasks.ingestion_tasks.SessionLocal') as mock_session:
        mock_session.return_value = db_session
        
        with patch('app.tasks.ingestion_tasks.ingest_article') as mock_ingest:
            result = load_expert_links_from_md(temp_markdown_file)
    
    # Should process 4 articles, skip 1 existing, queue 3 for ingestion
    assert result['processed'] == 4
    assert result['skipped'] == 1
    assert result['queued_for_ingestion'] == 3


def test_markdown_parsing_edge_cases():
    """Test markdown parsing with various edge cases"""
    edge_case_content = """# Expert Links

## Category with Spaces

- [Article with (parentheses)](https://example.com/parens) - Notes with (Priority: High) and more text [Date: 2024-01-01]
- [Article without date](https://example.com/no-date) - Just notes here
- [Article without notes](https://example.com/no-notes) [Date: 2024-01-02]

## Empty Category

## Another Category

- [Simple article](https://example.com/simple)
"""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(edge_case_content)
        temp_path = f.name
    
    try:
        articles = parse_expert_links_md(temp_path)
        
        assert len(articles) == 4
        
        # Test article with parentheses in title and notes
        first_article = articles[0]
        assert "parentheses" in first_article['title']
        assert first_article['priority'] == 'High'
        
        # Test article without date
        second_article = articles[1]
        assert second_article['date_added'] is None
        
        # Test article without notes
        third_article = articles[2]
        assert third_article['notes'] == '' or third_article['notes'] is None
        
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@patch('app.services.ingestion_service.requests.get')
def test_paywall_detection_methods(mock_get):
    """Test various paywall detection methods"""
    # Test different paywall indicators
    paywall_scenarios = [
        ('<div class="paywall">Subscribe now</div>', True),
        ('<p>This is subscriber-only content</p>', True),
        ('<meta name="subscription" content="required">', True),
        ('<div>Regular article content here</div>', False),
    ]
    
    for html_content, should_be_paywalled in paywall_scenarios:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = f"<html><body>{html_content}</body></html>"
        mock_get.return_value = mock_response
        
        result = ingest_url("https://example.com/test")
        assert result['is_paywalled'] == should_be_paywalled


def test_article_content_extraction_fallback():
    """Test content extraction with BeautifulSoup fallback"""
    html_with_article_tag = """
    <html>
        <body>
            <article>
                <h1>Main Article Title</h1>
                <p>First paragraph of content.</p>
                <p>Second paragraph with more information.</p>
            </article>
        </body>
    </html>
    """
    
    with patch('app.services.ingestion_service.trafilatura.extract') as mock_trafilatura:
        with patch('app.services.ingestion_service.requests.get') as mock_get:
            # Make trafilatura fail to test BeautifulSoup fallback
            mock_trafilatura.return_value = None
            
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = html_with_article_tag
            mock_get.return_value = mock_response
            
            result = ingest_url("https://example.com/test")
            
            # Should still extract content using BeautifulSoup
            assert result['raw_text'] is not None
            assert "First paragraph" in result['raw_text']
            assert result['word_count'] > 0


class TestImageExtraction:
    """Tests for inline image extraction and caption filtering"""
    
    def test_clean_article_text_removes_file_captions(self):
        """Test that FILE - captions are removed from article text"""
        from app.services.ingestion_service import clean_article_text
        
        text_with_file_caption = """
        FILE - Federal Reserve Chairman Jerome Powell speaks at a conference.
        
        This is the actual article content that should remain.
        
        FILE: Another photo caption that should be removed.
        
        More article content here.
        """
        
        cleaned = clean_article_text(text_with_file_caption)
        
        assert "FILE -" not in cleaned
        assert "FILE:" not in cleaned
        assert "actual article content" in cleaned
        assert "More article content" in cleaned
    
    def test_clean_article_text_removes_photo_credits(self):
        """Test that photo credits are removed from article text"""
        from app.services.ingestion_service import clean_article_text
        
        text_with_credits = """
        Photo: John Smith/AP
        
        This is the article text.
        
        Image: Getty Images
        
        More content here (AP Photo/Jane Doe) with inline credit.
        """
        
        cleaned = clean_article_text(text_with_credits)
        
        assert "Photo:" not in cleaned
        assert "Image:" not in cleaned
        assert "(AP Photo/Jane Doe)" not in cleaned
        assert "article text" in cleaned
        assert "More content here" in cleaned
    
    def test_extract_inline_images_basic(self):
        """Test basic inline image extraction from HTML"""
        from app.services.ingestion_service import extract_inline_images
        
        html_content = """
        <html>
            <body>
                <article>
                    <p>First paragraph of content.</p>
                    <figure>
                        <img src="/images/photo1.jpg" alt="A test photo" width="800" height="600">
                        <figcaption>This is the caption</figcaption>
                    </figure>
                    <p>Second paragraph after the image.</p>
                </article>
            </body>
        </html>
        """
        
        images = extract_inline_images(html_content, "https://example.com")
        
        assert len(images) >= 1
        assert images[0]['url'] == "https://example.com/images/photo1.jpg"
        assert images[0]['alt'] == "A test photo"
        assert images[0]['caption'] == "This is the caption"
    
    def test_extract_inline_images_skips_small_images(self):
        """Test that small images (icons) are skipped"""
        from app.services.ingestion_service import extract_inline_images
        
        html_content = """
        <html>
            <body>
                <article>
                    <p>Some content</p>
                    <img src="/icon.png" width="32" height="32" alt="icon">
                    <img src="/logo.png" alt="logo">
                    <img src="/real-photo.jpg" width="800" height="600" alt="Real photo">
                </article>
            </body>
        </html>
        """
        
        images = extract_inline_images(html_content, "https://example.com")
        
        # Should only get the real photo, not the icon or logo
        assert len(images) == 1
        assert "real-photo" in images[0]['url']
    
    def test_extract_inline_images_skips_file_captions(self):
        """Test that FILE - captions are cleared from images"""
        from app.services.ingestion_service import extract_inline_images
        
        html_content = """
        <html>
            <body>
                <article>
                    <figure>
                        <img src="/photo.jpg" width="800" height="600">
                        <figcaption>FILE - This is a file caption that should be cleared</figcaption>
                    </figure>
                </article>
            </body>
        </html>
        """
        
        images = extract_inline_images(html_content, "https://example.com")
        
        assert len(images) == 1
        assert images[0]['caption'] == ''  # Caption should be cleared
    
    def test_extract_inline_images_deduplicates(self):
        """Test that duplicate images are removed"""
        from app.services.ingestion_service import extract_inline_images
        
        html_content = """
        <html>
            <body>
                <article>
                    <img src="/same-photo.jpg" width="800" height="600">
                    <img src="/same-photo.jpg" width="400" height="300">
                    <img src="/different-photo.jpg" width="800" height="600">
                </article>
            </body>
        </html>
        """
        
        images = extract_inline_images(html_content, "https://example.com")
        
        # Should have 2 unique images, not 3
        urls = [img['url'] for img in images]
        assert len(set(urls)) == len(urls)  # All unique


class TestIngestUrlWithImages:
    """Tests for URL ingestion including inline images"""
    
    @patch('app.services.ingestion_service.requests.get')
    def test_ingest_url_includes_inline_images(self, mock_get):
        """Test that ingest_url returns inline_images field"""
        html_content = """
        <html>
            <head><title>Test Article</title></head>
            <body>
                <article>
                    <h1>Test Article Title</h1>
                    <p>First paragraph of the article content.</p>
                    <figure>
                        <img src="/images/main.jpg" width="800" height="600" alt="Main image">
                    </figure>
                    <p>Second paragraph with more content here.</p>
                </article>
            </body>
        </html>
        """
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = html_content
        mock_get.return_value = mock_response
        
        with patch('app.services.ingestion_service.trafilatura.extract') as mock_trafilatura:
            mock_trafilatura.return_value = '{"text": "First paragraph. Second paragraph.", "image": null}'
            
            result = ingest_url("https://example.com/test-article")
            
            assert 'inline_images' in result
            assert isinstance(result['inline_images'], list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
