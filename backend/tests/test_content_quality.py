"""
Tests for Content Quality Pipeline - Gate + Score

Tests verify the high bar for content quality:
- Domain filtering (allowed/blocked)
- Structural quality (word count, link ratio, paragraphs, density)
- Quality scoring (0-1 range, tier-specific boosts)
- Auto-essential detection
"""
import pytest
from unittest.mock import patch

from app.services.content_quality_service import ContentQualityService


@pytest.fixture
def quality_service():
    """Create a fresh ContentQualityService for testing."""
    service = ContentQualityService()
    service._allowed_domains = {
        "mckinsey.com", "hbr.org", "deloitte.com", "forbes.com",
    }
    service._blocked_domains = {
        "pinterest.com", "buzzfeed.com", "clickbait-example.com",
    }
    return service


# ── Domain Filtering Tests ───────────────────────────────────────


class TestDomainFiltering:
    def test_allowed_domain_passes(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape(
            "https://www.mckinsey.com/some-article"
        )
        assert passed is True
        assert is_allowed is True

    def test_blocked_domain_rejected(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape(
            "https://www.pinterest.com/pin/12345"
        )
        assert passed is False
        assert "blocked" in reason.lower()

    def test_unknown_domain_proceeds(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape(
            "https://some-unknown-blog.com/article"
        )
        assert passed is True
        assert is_allowed is False

    def test_subdomain_of_blocked(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape(
            "https://blog.buzzfeed.com/article"
        )
        assert passed is False

    def test_subdomain_of_allowed(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape(
            "https://insights.mckinsey.com/report"
        )
        assert passed is True
        assert is_allowed is True

    def test_invalid_url_rejected(self, quality_service):
        passed, reason, is_allowed = quality_service.assess_pre_scrape("")
        assert passed is False


# ── Structural Quality Tests ─────────────────────────────────────


def _make_article_text(word_count: int, paragraphs: int = 5) -> str:
    """Generate test article text with specified word count and paragraphs."""
    words_per_paragraph = max(1, word_count // paragraphs)
    paras = []
    for i in range(paragraphs):
        words = " ".join([f"word{j}" for j in range(words_per_paragraph)])
        paras.append(f"This is paragraph {i}. {words}")
    return "\n\n".join(paras)


class TestStructuralQuality:
    def test_too_few_words_rejected(self, quality_service):
        text = _make_article_text(100, 2)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is False
        assert "Too few words" in reason

    def test_too_many_words_rejected(self, quality_service):
        text = _make_article_text(20000, 50)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is False
        assert "Too many words" in reason

    def test_good_word_count_passes(self, quality_service):
        text = _make_article_text(800, 8)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True
        assert score > 0

    def test_link_farm_rejected(self, quality_service):
        # Create text with lots of links
        links = " ".join([f"https://example.com/page{i}" for i in range(50)])
        text = f"Some intro text about things.\n\n{links}\n\nMore text here."
        # Add enough words to pass word count
        text += "\n\n" + _make_article_text(400, 4)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier3_discovery")
        assert passed is False
        assert "links" in reason.lower()

    def test_too_few_quality_paragraphs_rejected(self, quality_service):
        # Text with enough words but only 2 real paragraphs
        text = "Short.\n\nAlso short.\n\n" + " ".join(["word"] * 350)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is False
        assert "paragraph" in reason.lower()

    def test_low_content_density_rejected(self, quality_service):
        text = _make_article_text(500, 5)
        # HTML much larger than text content
        html = "<html><body>" + "<div>" * 1000 + text + "</div>" * 1000 + "</body></html>"
        # Make HTML 100x bigger
        html = html + "<script>" + "x" * len(text) * 100 + "</script>"
        passed, score, reason = quality_service.assess_post_scrape(text, html, "tier1_expert")
        assert passed is False
        assert "density" in reason.lower()

    def test_good_content_density_passes(self, quality_service):
        text = _make_article_text(800, 8)
        html = f"<html><body><article>{text}</article></body></html>"
        passed, score, reason = quality_service.assess_post_scrape(text, html, "tier1_expert")
        assert passed is True


# ── Quality Score Tests ──────────────────────────────────────────


class TestQualityScoring:
    def test_score_in_valid_range(self, quality_service):
        text = _make_article_text(1000, 10)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True
        assert 0.0 <= score <= 1.0

    def test_higher_quality_scores_higher(self, quality_service):
        # Good article: lots of quality paragraphs, good word count
        good_text = _make_article_text(1500, 12)
        _, good_score, _ = quality_service.assess_post_scrape(good_text, None, "tier1_expert")

        # Mediocre article: barely passes
        mediocre_text = _make_article_text(400, 4)
        _, mediocre_score, _ = quality_service.assess_post_scrape(mediocre_text, None, "tier1_expert")

        assert good_score > mediocre_score

    def test_allowed_domain_gets_boost(self, quality_service):
        text = _make_article_text(1000, 10)
        checks = quality_service._build_checks(text, None)

        score_without = quality_service._compute_quality_score(checks, "tier1_expert", is_allowed_domain=False)
        score_with = quality_service._compute_quality_score(checks, "tier1_expert", is_allowed_domain=True)

        assert score_with > score_without
        assert score_with - score_without == pytest.approx(0.15, abs=0.01)

    def test_discovery_higher_threshold(self, quality_service):
        """Tier 3 (web discovery) has higher quality gate than Tier 1/2."""
        assert quality_service._get_gate_threshold("tier3_discovery") > quality_service._get_gate_threshold("tier2_luminary")
        assert quality_service._get_gate_threshold("tier3_discovery") > quality_service._get_gate_threshold("tier1_expert")

    def test_expert_and_luminary_same_threshold(self, quality_service):
        assert quality_service._get_gate_threshold("tier2_luminary") == quality_service._get_gate_threshold("tier1_expert")


# ── Auto-Essential Detection Tests ───────────────────────────────


class TestAutoEssential:
    def test_high_score_any_tier_is_essential(self, quality_service):
        assert quality_service.should_auto_essential(0.90, "tier3_discovery") is True
        assert quality_service.should_auto_essential(0.85, "tier1_expert") is True

    def test_luminary_lower_threshold(self, quality_service):
        # 0.75 is enough for luminary (Tier 2) but not for expert/discovery
        assert quality_service.should_auto_essential(0.75, "tier2_luminary") is True
        assert quality_service.should_auto_essential(0.75, "tier3_discovery") is False
        assert quality_service.should_auto_essential(0.75, "tier1_expert") is False

    def test_below_threshold_not_essential(self, quality_service):
        assert quality_service.should_auto_essential(0.50, "tier2_luminary") is False
        assert quality_service.should_auto_essential(0.50, "tier3_discovery") is False
        assert quality_service.should_auto_essential(0.50, "tier1_expert") is False

    def test_boundary_scores(self, quality_service):
        # Exact boundary values
        assert quality_service.should_auto_essential(0.85, "tier3_discovery") is True
        assert quality_service.should_auto_essential(0.849, "tier3_discovery") is False
        assert quality_service.should_auto_essential(0.75, "tier2_luminary") is True
        assert quality_service.should_auto_essential(0.749, "tier2_luminary") is False


# ── Combined Assessment Tests ────────────────────────────────────


class TestCombinedAssessment:
    def test_blocked_domain_rejected_before_scrape(self, quality_service):
        passed, score, reason = quality_service.compute_quality_score_with_domain(
            "Great article text " * 100,
            None,
            "tier1_expert",
            "https://buzzfeed.com/article",
        )
        assert passed is False
        assert "blocked" in reason.lower()

    def test_good_article_from_allowed_domain(self, quality_service):
        text = _make_article_text(1000, 10)
        passed, score, reason = quality_service.compute_quality_score_with_domain(
            text, None, "tier1_expert", "https://mckinsey.com/article"
        )
        assert passed is True
        assert score > 0.5  # Should get domain boost


# ── Content Trickle-Through Tests ────────────────────────────────
# These tests verify that realistic articles PASS the quality gate,
# ensuring content actually shows up in the feed.


def _make_realistic_article(word_count: int = 800) -> str:
    """Generate realistic article text that mimics a real industry article."""
    paragraphs = []
    words_used = 0
    para_num = 0
    while words_used < word_count:
        para_num += 1
        # Alternate between 40-80 word paragraphs (realistic)
        para_words = 50 + (para_num * 7) % 30
        para_words = min(para_words, word_count - words_used)
        if para_words < 10:
            break
        para = " ".join(
            [f"industry analysis insight trend market growth strategy opportunity challenge factor"
             for _ in range(para_words // 10 + 1)]
        )[:para_words * 6]  # Approximate words
        paragraphs.append(f"In the evolving landscape of paragraph {para_num}, {para}")
        words_used += len(paragraphs[-1].split())
    return "\n\n".join(paragraphs)


class TestContentTrickleThrough:
    """Verify realistic content passes quality gate and surfaces in feed.

    These are the most critical tests - if they fail, users see empty feeds.
    """

    def test_typical_800_word_article_passes_expert(self, quality_service):
        """An 800-word article with good structure should pass Tier 1 (expert) easily."""
        text = _make_realistic_article(800)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True, f"800-word article rejected: {reason}"
        assert score >= 0.35, f"Score {score} below gate 0.35"

    def test_typical_500_word_article_passes_expert(self, quality_service):
        """A 500-word article should pass Tier 1 (expert) gate."""
        text = _make_realistic_article(500)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True, f"500-word article rejected: {reason}"
        assert score >= 0.35, f"Score {score} below gate 0.35"

    def test_minimum_300_word_article_passes_expert(self, quality_service):
        """Even a 300-word article with 3+ decent paragraphs should pass Tier 1 (expert)."""
        text = _make_realistic_article(350)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True, f"350-word article rejected: {reason}"

    def test_typical_article_passes_luminary(self, quality_service):
        """Tier 2 (luminary) articles should pass with same gate as Tier 1 (expert)."""
        text = _make_realistic_article(600)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier2_luminary")
        assert passed is True, f"600-word Tier 1 article rejected: {reason}"

    def test_typical_article_passes_discovery(self, quality_service):
        """Tier 3 (discovery) has higher gate (0.50) but a good article should still pass."""
        text = _make_realistic_article(1000)
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier3_discovery")
        assert passed is True, f"1000-word Tier 2 article rejected: {reason}"

    def test_article_with_some_links_passes(self, quality_service):
        """Articles with a few links should not be rejected."""
        text = _make_realistic_article(800)
        # Add a few links (normal for articles to reference sources)
        text += "\n\nFor more see https://example.com/source1 and https://example.com/source2"
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        assert passed is True, f"Article with 2 links rejected: {reason}"

    def test_article_with_html_wrapper_passes(self, quality_service):
        """Article content wrapped in reasonable HTML should pass density check."""
        text = _make_realistic_article(800)
        html = f"<html><head><title>Article</title></head><body><main><article>{text}</article></main></body></html>"
        passed, score, reason = quality_service.assess_post_scrape(text, html, "tier1_expert")
        assert passed is True, f"Article with HTML wrapper rejected: {reason}"

    def test_score_distribution_realistic(self, quality_service):
        """Verify score distribution across article sizes makes sense."""
        small_text = _make_realistic_article(400)
        medium_text = _make_realistic_article(1000)
        large_text = _make_realistic_article(2500)

        _, small_score, _ = quality_service.assess_post_scrape(small_text, None, "tier1_expert")
        _, medium_score, _ = quality_service.assess_post_scrape(medium_text, None, "tier1_expert")
        _, large_score, _ = quality_service.assess_post_scrape(large_text, None, "tier1_expert")

        # All should pass
        assert small_score >= 0.35
        assert medium_score >= 0.35
        assert large_score >= 0.35

        # Medium/large should score higher than small
        assert medium_score >= small_score
        assert large_score >= small_score

    def test_paywalled_expert_article_not_blocked(self, quality_service):
        """Paywalled Tier 3 articles should still pass if expert curated.

        Even if scraped text is minimal (paywall), expert curation IS the quality signal.
        """
        # Paywalled articles might have very little text after scraping
        # But for Tier 3, we should still store them
        text = "This premium article requires a subscription. Subscribe for full access."
        passed, score, reason = quality_service.assess_post_scrape(text, None, "tier1_expert")
        # This WILL fail the quality gate - which is expected!
        # The ingestion code must handle paywalled articles specially.
        # This test documents that the quality service itself rejects thin content.
        assert passed is False  # Expected: quality service rejects thin content

    def test_unknown_domain_article_passes(self, quality_service):
        """Articles from unknown domains should pass if content is good."""
        text = _make_realistic_article(800)
        passed, score, reason = quality_service.compute_quality_score_with_domain(
            text, None, "tier1_expert", "https://unknown-but-good-blog.com/great-article"
        )
        assert passed is True, f"Unknown domain good article rejected: {reason}"

    def test_gate_thresholds_are_reasonable(self, quality_service):
        """Gate thresholds should allow most expert-curated content through."""
        expert_gate = quality_service._get_gate_threshold("tier1_expert")
        luminary_gate = quality_service._get_gate_threshold("tier2_luminary")
        discovery_gate = quality_service._get_gate_threshold("tier3_discovery")

        # Expert and luminary gates should be ≤ 0.40 (trusted sources)
        assert expert_gate <= 0.40, f"Expert gate too high: {expert_gate}"
        assert luminary_gate <= 0.40, f"Luminary gate too high: {luminary_gate}"
        # Discovery gate should be ≤ 0.55 (untrusted but not impossible)
        assert discovery_gate <= 0.55, f"Discovery gate too high: {discovery_gate}"
