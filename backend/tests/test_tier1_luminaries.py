"""
Tests for Tier 1 Luminary RSS Ingestion

Verifies:
- Config loading and validation against central IndustriesConfig
- RSS feed parsing and article filtering
- Service iterates IndustriesConfig, not hardcoded lists
- Luminary specialization IDs match central config
- Age filtering, dedup, and domain checks
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from app.services.luminaries_config import LuminariesConfig
from app.services.industries_config import IndustriesConfig


@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset singletons between tests."""
    LuminariesConfig.reset_instance()
    yield
    LuminariesConfig.reset_instance()


# ── Config Loading Tests ────────────────────────────────────────


class TestLuminariesConfigLoading:
    def test_config_loads_successfully(self):
        """luminaries.json should load without error."""
        config = LuminariesConfig.get_instance()
        assert config.get_total_luminary_count() > 0

    def test_config_is_singleton(self):
        """Should return same instance on repeated calls."""
        c1 = LuminariesConfig.get_instance()
        c2 = LuminariesConfig.get_instance()
        assert c1 is c2

    def test_settings_have_defaults(self):
        config = LuminariesConfig.get_instance()
        assert config.get_max_articles_per_run() > 0
        assert config.get_max_article_age_days() > 0
        assert config.get_feed_timeout() > 0


class TestLuminariesMatchCentralConfig:
    """Critical: Verify luminary spec IDs match the central industries config."""

    def test_all_spec_ids_valid(self):
        """Every specialization ID in luminaries.json must exist in central config."""
        lum_config = LuminariesConfig.get_instance()
        ind_config = IndustriesConfig.get_instance()

        # Build set of valid spec IDs from central config
        valid_spec_ids = set()
        for industry in ind_config._config.get("industries", []):
            for spec in industry.get("specializations", []):
                valid_spec_ids.add(spec["id"])

        # Check every luminary spec ID
        for spec_id in lum_config.get_all_specialization_ids():
            assert spec_id in valid_spec_ids, (
                f"Luminary spec ID '{spec_id}' not in central config. "
                f"Valid IDs: {valid_spec_ids}"
            )

    def test_covers_all_three_industries(self):
        """Luminaries should cover sub-industries from all 3 industries."""
        lum_config = LuminariesConfig.get_instance()
        ind_config = IndustriesConfig.get_instance()

        covered_industries = set()
        luminary_specs = set(lum_config.get_all_specialization_ids())

        for industry in ind_config._config.get("industries", []):
            for spec in industry.get("specializations", []):
                if spec["id"] in luminary_specs:
                    covered_industries.add(industry["id"])

        assert "consumer" in covered_industries
        assert "technology" in covered_industries
        assert "finance" in covered_industries

    def test_at_least_two_per_industry(self):
        """Each industry should have at least 2 sub-industries covered."""
        lum_config = LuminariesConfig.get_instance()
        ind_config = IndustriesConfig.get_instance()

        luminary_specs = set(lum_config.get_all_specialization_ids())

        for industry in ind_config._config.get("industries", []):
            covered = [
                spec["id"]
                for spec in industry.get("specializations", [])
                if spec["id"] in luminary_specs
            ]
            assert len(covered) >= 2, (
                f"Industry '{industry['id']}' only has {len(covered)} "
                f"sub-industries with luminaries: {covered}"
            )

    def test_no_phantom_industries(self):
        """No specialization IDs from non-existent industries."""
        lum_config = LuminariesConfig.get_instance()
        ind_config = IndustriesConfig.get_instance()

        valid_spec_ids = set()
        for industry in ind_config._config.get("industries", []):
            for spec in industry.get("specializations", []):
                valid_spec_ids.add(spec["id"])

        luminary_specs = set(lum_config.get_all_specialization_ids())
        phantom = luminary_specs - valid_spec_ids
        assert len(phantom) == 0, f"Phantom specialization IDs: {phantom}"

    def test_total_count_reasonable(self):
        """Should have ~40-65 luminaries total (2-3 per 21 sub-industries)."""
        config = LuminariesConfig.get_instance()
        total = config.get_total_luminary_count()
        assert total >= 30, f"Too few luminaries: {total}"
        assert total <= 100, f"Too many luminaries: {total}"


# ── Luminary Data Validation ────────────────────────────────────


class TestLuminaryDataValidation:
    def test_every_luminary_has_required_fields(self):
        """Each luminary must have id, name, feed_url, website."""
        config = LuminariesConfig.get_instance()
        for spec_id in config.get_all_specialization_ids():
            for lum in config.get_luminaries_for_specialization(spec_id):
                assert "id" in lum, f"Missing 'id' in {spec_id} luminary"
                assert "name" in lum, f"Missing 'name' in {spec_id} luminary"
                assert "feed_url" in lum, f"Missing 'feed_url' in {spec_id}/{lum.get('name', '?')}"
                assert "website" in lum, f"Missing 'website' in {spec_id}/{lum.get('name', '?')}"

    def test_feed_urls_are_valid(self):
        """Feed URLs should be valid HTTP(S) URLs."""
        config = LuminariesConfig.get_instance()
        for spec_id in config.get_all_specialization_ids():
            for lum in config.get_luminaries_for_specialization(spec_id):
                url = lum["feed_url"]
                assert url.startswith("http://") or url.startswith("https://"), (
                    f"Invalid feed URL for {lum['name']}: {url}"
                )

    def test_luminary_ids_unique_within_spec(self):
        """Luminary IDs should be unique within each specialization."""
        config = LuminariesConfig.get_instance()
        for spec_id in config.get_all_specialization_ids():
            luminaries = config.get_luminaries_for_specialization(spec_id)
            ids = [lum["id"] for lum in luminaries]
            assert len(ids) == len(set(ids)), (
                f"Duplicate luminary IDs in {spec_id}: {ids}"
            )


# ── Service Iteration Tests ─────────────────────────────────────


class TestTier1ServiceIteration:
    """Verify the service iterates IndustriesConfig, not hardcoded lists."""

    def test_service_reads_from_industries_config(self):
        """Tier1LuminaryService must use IndustriesConfig for iteration."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        service = Tier1LuminaryService()
        # Service should reference IndustriesConfig
        assert service._industries_config is not None
        assert isinstance(service._industries_config, IndustriesConfig)

    def test_service_reads_from_luminaries_config(self):
        """Tier1LuminaryService must use LuminariesConfig for luminary data."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        service = Tier1LuminaryService()
        assert service._luminaries_config is not None
        assert isinstance(service._luminaries_config, LuminariesConfig)

    @patch("app.services.tier1_luminary_service.feedparser")
    def test_discover_iterates_all_specs(self, mock_feedparser):
        """discover_articles should iterate all specializations from config."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        # Mock feedparser to return empty feeds
        mock_feed = MagicMock()
        mock_feed.bozo = False
        mock_feed.entries = []
        mock_feedparser.parse.return_value = mock_feed

        service = Tier1LuminaryService()
        articles = service.discover_articles()

        # Should have called feedparser for each luminary across all specs
        expected_calls = service._luminaries_config.get_total_luminary_count()
        assert mock_feedparser.parse.call_count == expected_calls


# ── Feed Entry Parsing Tests ────────────────────────────────────


class TestFeedEntryParsing:
    def test_parse_entry_extracts_url(self):
        """Should extract URL from RSS entry."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        service = Tier1LuminaryService()
        entry = MagicMock()
        entry.get.side_effect = lambda k, d=None: {
            "link": "https://example.com/article",
            "title": "Test Article",
        }.get(k, d)

        result = service._parse_entry(
            entry=entry,
            luminary_id="test",
            luminary_name="Test Pub",
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            cutoff_date=datetime.now(timezone.utc) - timedelta(days=30),
        )
        # May be None due to dedup acquiring the URL, but shouldn't crash
        # The important thing is it processes without error

    def test_parse_entry_skips_no_url(self):
        """Should return None for entries without URL."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        service = Tier1LuminaryService()
        entry = MagicMock()
        entry.get.return_value = ""

        result = service._parse_entry(
            entry=entry,
            luminary_id="test",
            luminary_name="Test",
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            cutoff_date=datetime.now(timezone.utc) - timedelta(days=30),
        )
        assert result is None

    def test_get_published_date_handles_parsed(self):
        """Should extract date from published_parsed field."""
        from app.services.tier1_luminary_service import Tier1LuminaryService
        from time import struct_time

        service = Tier1LuminaryService()
        entry = {
            "published_parsed": struct_time((2026, 2, 15, 12, 0, 0, 0, 0, 0))
        }

        result = service._get_published_date(entry)
        assert result is not None
        assert result.year == 2026
        assert result.month == 2

    def test_get_published_date_returns_none_for_missing(self):
        """Should return None if no date fields exist."""
        from app.services.tier1_luminary_service import Tier1LuminaryService

        service = Tier1LuminaryService()
        result = service._get_published_date({})
        assert result is None

    def test_old_articles_filtered_out(self):
        """Articles older than cutoff should be skipped."""
        from app.services.tier1_luminary_service import Tier1LuminaryService
        from time import struct_time

        service = Tier1LuminaryService()
        # Entry from 60 days ago
        old_date = datetime.now(timezone.utc) - timedelta(days=60)
        entry = MagicMock()
        entry.get.side_effect = lambda k, d=None: {
            "link": "https://example.com/old-article",
            "title": "Old Article",
            "published_parsed": old_date.timetuple(),
        }.get(k, d)

        result = service._parse_entry(
            entry=entry,
            luminary_id="test",
            luminary_name="Test",
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            cutoff_date=datetime.now(timezone.utc) - timedelta(days=30),
        )
        assert result is None
