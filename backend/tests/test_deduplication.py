"""
Tests for Deduplication Service

- URL normalization (utm params stripped, lowercase, trailing slash)
- Cross-tier URL dedup via processing_urls set
- Content hash dedup
"""
import pytest
from app.services.deduplication_service import DeduplicationService


@pytest.fixture
def dedup_service():
    """Create a fresh DeduplicationService for testing."""
    service = DeduplicationService()
    service._processing_urls = set()
    return service


# ── URL Normalization Tests ──────────────────────────────────────


class TestURLNormalization:
    def test_strips_utm_params(self, dedup_service):
        url = "https://example.com/article?utm_source=twitter&utm_medium=social&id=123"
        normalized = dedup_service.normalize_url(url)
        assert "utm_source" not in normalized
        assert "utm_medium" not in normalized
        assert "id=123" in normalized

    def test_lowercase_domain(self, dedup_service):
        url = "https://EXAMPLE.COM/Article"
        normalized = dedup_service.normalize_url(url)
        assert "example.com" in normalized
        # Path case should be preserved
        assert "/Article" in normalized

    def test_strips_trailing_slash(self, dedup_service):
        url = "https://example.com/article/"
        normalized = dedup_service.normalize_url(url)
        assert normalized.endswith("/article")

    def test_strips_www(self, dedup_service):
        url = "https://www.example.com/article"
        normalized = dedup_service.normalize_url(url)
        assert "www." not in normalized
        assert "example.com" in normalized

    def test_strips_fragment(self, dedup_service):
        url = "https://example.com/article#section-2"
        normalized = dedup_service.normalize_url(url)
        assert "#" not in normalized

    def test_strips_tracking_params(self, dedup_service):
        url = "https://example.com/article?fbclid=abc&gclid=def&real_param=123"
        normalized = dedup_service.normalize_url(url)
        assert "fbclid" not in normalized
        assert "gclid" not in normalized
        assert "real_param=123" in normalized

    def test_same_url_different_tracking_normalizes_same(self, dedup_service):
        url1 = "https://www.Example.com/article/?utm_source=twitter"
        url2 = "https://example.com/article?utm_medium=email"
        assert dedup_service.normalize_url(url1) == dedup_service.normalize_url(url2)

    def test_different_urls_stay_different(self, dedup_service):
        url1 = "https://example.com/article-one"
        url2 = "https://example.com/article-two"
        assert dedup_service.normalize_url(url1) != dedup_service.normalize_url(url2)

    def test_empty_url(self, dedup_service):
        # Should not crash
        result = dedup_service.normalize_url("")
        assert isinstance(result, str)


# ── Cross-Tier Lock Tests ────────────────────────────────────────


class TestCrossTierLock:
    def test_acquire_url_succeeds_first_time(self, dedup_service):
        assert dedup_service.try_acquire_url("https://example.com/article") is True

    def test_acquire_same_url_fails(self, dedup_service):
        dedup_service.try_acquire_url("https://example.com/article")
        assert dedup_service.try_acquire_url("https://example.com/article") is False

    def test_release_allows_reacquire(self, dedup_service):
        url = "https://example.com/article"
        dedup_service.try_acquire_url(url)
        dedup_service.release_url(url)
        assert dedup_service.try_acquire_url(url) is True

    def test_normalized_url_dedup(self, dedup_service):
        """Same URL with different tracking params should be treated as same."""
        url1 = "https://www.example.com/article?utm_source=twitter"
        url2 = "https://example.com/article"
        dedup_service.try_acquire_url(url1)
        assert dedup_service.try_acquire_url(url2) is False

    def test_clear_releases_all(self, dedup_service):
        dedup_service.try_acquire_url("https://example.com/a")
        dedup_service.try_acquire_url("https://example.com/b")
        dedup_service.clear_processing_urls()
        assert dedup_service.try_acquire_url("https://example.com/a") is True
        assert dedup_service.try_acquire_url("https://example.com/b") is True


# ── Content Hash Tests ───────────────────────────────────────────


class TestContentHash:
    def test_same_content_same_hash(self, dedup_service):
        text = "This is an article about important things." * 20
        h1 = dedup_service.compute_content_hash(text)
        h2 = dedup_service.compute_content_hash(text)
        assert h1 == h2

    def test_different_content_different_hash(self, dedup_service):
        text1 = "This is article one about topic A." * 20
        text2 = "This is article two about topic B." * 20
        assert dedup_service.compute_content_hash(text1) != dedup_service.compute_content_hash(text2)

    def test_empty_text_returns_empty(self, dedup_service):
        assert dedup_service.compute_content_hash("") == ""
        assert dedup_service.compute_content_hash(None) == ""

    def test_whitespace_normalization(self, dedup_service):
        text1 = "This is   an   article.\n\nWith   spaces."
        text2 = "This is an article.\nWith spaces."
        assert dedup_service.compute_content_hash(text1) == dedup_service.compute_content_hash(text2)

    def test_uses_first_1000_chars(self, dedup_service):
        """Hash only uses first 1000 chars - different endings should produce same hash."""
        base = "A" * 1000
        text1 = base + " ending one"
        text2 = base + " ending two"
        assert dedup_service.compute_content_hash(text1) == dedup_service.compute_content_hash(text2)
