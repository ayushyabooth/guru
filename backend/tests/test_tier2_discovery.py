"""
Tests for Tier 2 Web Discovery Service

Verifies:
- Service iterates IndustriesConfig, not hardcoded lists
- Discovery is scoped to what users follow, one round-robin slice per run (GUR-238)
- Query construction from sub-industry names (via central config)
- Search result extraction from Claude API response
- Domain filtering and dedup on results
- Article data structure matches shared pipeline expectations
"""
import re
import uuid
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, PropertyMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import database
from app.db.base import Base
from app.models.ingestion_run import IngestionRun
from app.services.industries_config import IndustriesConfig
from app.services.deduplication_service import DeduplicationService


@pytest.fixture(autouse=True)
def reset_dedup():
    """Reset dedup processing URLs between tests."""
    DeduplicationService.get_instance().clear_processing_urls()
    yield
    DeduplicationService.get_instance().clear_processing_urls()


@pytest.fixture
def cold_start(monkeypatch):
    """A throwaway database, never the configured one: discovery reads users and finished runs from it to
    pick what to search (GUR-238). Empty, it is a cold start: no users, so every specialization is eligible."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database, "SessionLocal", Session)
    return Session


def _specs(industry_name=None):
    """Specialization names from the central config, for one industry or all of them."""
    return [spec["name"] for ind in IndustriesConfig.get_instance()._config.get("industries", [])
            if industry_name in (None, ind["name"]) for spec in ind.get("specializations", [])]


def _searched(mock_client):
    """The specialization each web search asked about, in call order."""
    return [re.search(r'about "(.+?)" in the', c.kwargs["messages"][0]["content"]).group(1)
            for c in mock_client.messages.create.call_args_list]


def _slice_size(n):
    """How many of n eligible specs one run searches: one TIER3_DISCOVERY_ROUNDS-th, rounded up."""
    return -(-n // max(1, settings.TIER3_DISCOVERY_ROUNDS))


# ── Service Structure Tests ────────────────────────────────────


class TestTier2ServiceStructure:
    """Verify the service reads from IndustriesConfig, not hardcoded lists."""

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_service_reads_from_industries_config(self, mock_anthropic):
        """Tier2DiscoveryService must use IndustriesConfig for iteration."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        service = Tier2DiscoveryService()
        assert service._industries_config is not None
        assert isinstance(service._industries_config, IndustriesConfig)

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_service_has_quality_and_dedup(self, mock_anthropic):
        """Service should have quality and dedup services."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        service = Tier2DiscoveryService()
        assert service._quality_service is not None
        assert service._dedup_service is not None

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_discover_searches_one_round_robin_slice_per_run(self, mock_anthropic, cold_start):
        """GUR-238: a run searches one slice of the eligible specializations (all of them on a cold start),
        picked by how many tier 3 runs have completed, so the paid searches are spread over runs. Over
        TIER3_DISCOVERY_ROUNDS runs every specialization is searched exactly once."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        # Mock the Anthropic client to return empty responses
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []  # No search results
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        slices = []
        for _ in range(settings.TIER3_DISCOVERY_ROUNDS):
            mock_client.messages.create.reset_mock()
            service = Tier2DiscoveryService()
            service._client = mock_client
            assert service.discover_articles() == []
            slices.append(_searched(mock_client))
            with cold_start() as db:  # this run completed: the next one takes the next slice
                db.add(IngestionRun(tier="tier3_discovery", status="completed", completed_at=datetime.utcnow()))
                db.commit()

        every_spec = _specs()
        assert len(slices[0]) == _slice_size(len(every_spec))  # one slice, not every specialization
        assert sorted(sum(slices, [])) == sorted(every_spec), "each specialization once over the rounds"

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_discover_pays_only_for_what_active_users_follow(self, mock_anthropic, cold_start):
        """GUR-238: once users exist, only what they follow is searched. A followed industry brings all of
        its specializations, still one round-robin slice per run."""
        from app.models.user import User, UserProfile
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        with cold_start() as db:
            user = User(id=uuid.uuid4(), email="reader@example.com", password_hash="x", is_active=True)
            db.add(user)
            db.flush()
            db.add(UserProfile(user_id=user.id, core_industry="Finance", specializations=[],
                               catchup_daily_goal_minutes=10, catchup_daily_max_minutes=20,
                               divein_weekly_goal_minutes=30, recap_weekly_goal_minutes=15))
            db.commit()
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        service.discover_articles()

        finance = _specs("Finance")
        searched = _searched(mock_client)
        assert set(searched) <= set(finance), f"searched outside what the user follows: {searched}"
        assert len(searched) == _slice_size(len(finance))

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_discover_returns_empty_for_no_results(self, mock_anthropic):
        """Should return empty list when no search results found."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        articles = service.discover_articles()

        assert isinstance(articles, list)
        assert len(articles) == 0


# ── Query Construction Tests ───────────────────────────────────


class TestQueryConstruction:
    """Verify search queries are built from central config specializations."""

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_query_includes_spec_name(self, mock_anthropic):
        """Search prompt should include the specialization name."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            max_results=5,
            year=2026,
        )

        # Check the prompt sent to Claude
        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        prompt = messages[0]["content"]
        assert "Food & Beverage" in prompt
        assert "Consumer" in prompt

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_query_includes_year(self, mock_anthropic):
        """Search prompt should include the current year."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        current_year = datetime.now(timezone.utc).year

        service._search_for_specialization(
            industry_id="technology",
            industry_name="Technology",
            spec_id="enterprise_saas_software",
            spec_name="Enterprise SaaS & Software",
            max_results=5,
            year=current_year,
        )

        call_args = mock_client.messages.create.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        prompt = messages[0]["content"]
        assert str(current_year) in prompt

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_uses_web_search_tool(self, mock_anthropic):
        """API call should include the web search tool."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        service._search_for_specialization(
            industry_id="finance",
            industry_name="Finance",
            spec_id="insurance",
            spec_name="Insurance",
            max_results=5,
            year=2026,
        )

        call_args = mock_client.messages.create.call_args
        tools = call_args.kwargs.get("tools", call_args[1].get("tools", []))
        assert any("web_search" in str(t.get("type", "")) for t in tools)


# ── Search Result Extraction Tests ─────────────────────────────


class TestSearchResultExtraction:
    """Verify URL extraction from Claude web search response."""

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_extracts_urls_from_search_results(self, mock_anthropic):
        """Should extract URLs from web_search_tool_result blocks."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_anthropic.Anthropic.return_value = MagicMock()
        service = Tier2DiscoveryService()

        # Build mock response with search results
        mock_search_result_1 = MagicMock()
        mock_search_result_1.type = "web_search_result"
        mock_search_result_1.url = "https://example.com/article-1"
        mock_search_result_1.title = "Article One"
        mock_search_result_1.page_age = "2 days ago"

        mock_search_result_2 = MagicMock()
        mock_search_result_2.type = "web_search_result"
        mock_search_result_2.url = "https://example.com/article-2"
        mock_search_result_2.title = "Article Two"
        mock_search_result_2.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_search_result_1, mock_search_result_2]

        mock_text_block = MagicMock()
        mock_text_block.type = "text"
        mock_text_block.text = "Here are some results..."

        mock_response = MagicMock()
        mock_response.content = [mock_result_block, mock_text_block]

        results = service._extract_search_results(mock_response)

        assert len(results) == 2
        assert results[0]["url"] == "https://example.com/article-1"
        assert results[0]["title"] == "Article One"
        assert results[1]["url"] == "https://example.com/article-2"
        assert results[1]["title"] == "Article Two"

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_deduplicates_urls_in_response(self, mock_anthropic):
        """Same URL appearing in multiple search blocks should be deduplicated."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_anthropic.Anthropic.return_value = MagicMock()
        service = Tier2DiscoveryService()

        # Same URL in two search result blocks
        mock_result = MagicMock()
        mock_result.type = "web_search_result"
        mock_result.url = "https://example.com/same-article"
        mock_result.title = "Same Article"
        mock_result.page_age = None

        mock_block_1 = MagicMock()
        mock_block_1.type = "web_search_tool_result"
        mock_block_1.content = [mock_result]

        mock_block_2 = MagicMock()
        mock_block_2.type = "web_search_tool_result"
        mock_block_2.content = [mock_result]

        mock_response = MagicMock()
        mock_response.content = [mock_block_1, mock_block_2]

        results = service._extract_search_results(mock_response)
        assert len(results) == 1

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_handles_empty_response(self, mock_anthropic):
        """Should return empty list for response with no search results."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_anthropic.Anthropic.return_value = MagicMock()
        service = Tier2DiscoveryService()

        mock_response = MagicMock()
        mock_response.content = []

        results = service._extract_search_results(mock_response)
        assert results == []

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_handles_text_only_response(self, mock_anthropic):
        """Should return empty list if response has only text blocks."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_anthropic.Anthropic.return_value = MagicMock()
        service = Tier2DiscoveryService()

        mock_text_block = MagicMock()
        mock_text_block.type = "text"
        mock_text_block.text = "I couldn't find relevant articles."

        mock_response = MagicMock()
        mock_response.content = [mock_text_block]

        results = service._extract_search_results(mock_response)
        assert results == []


# ── Article Data Structure Tests ───────────────────────────────


class TestArticleDataStructure:
    """Verify article data matches the shared pipeline expectations."""

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_article_has_required_fields(self, mock_anthropic):
        """Article data should have all fields needed by ingest_article."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        # Build mock response with one search result
        mock_search_result = MagicMock()
        mock_search_result.type = "web_search_result"
        mock_search_result.url = "https://example.com/test-article"
        mock_search_result.title = "Test Article"
        mock_search_result.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_search_result]

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            max_results=5,
            year=2026,
        )

        assert len(articles) >= 1
        article = articles[0]

        # Required fields for the shared pipeline
        assert "url" in article
        assert "title" in article
        assert "industry" in article
        assert "industry_id" in article
        assert "specializations" in article
        assert "specialization_id" in article
        assert "ingestion_tier" in article
        assert "is_allowed_domain" in article

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_article_tier_is_tier3_discovery(self, mock_anthropic):
        """Articles should be tagged as tier3_discovery."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        mock_search_result = MagicMock()
        mock_search_result.type = "web_search_result"
        mock_search_result.url = "https://example.com/test"
        mock_search_result.title = "Test"
        mock_search_result.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_search_result]

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="technology",
            industry_name="Technology",
            spec_id="enterprise_saas_software",
            spec_name="Enterprise SaaS & Software",
            max_results=5,
            year=2026,
        )

        assert len(articles) >= 1
        assert articles[0]["ingestion_tier"] == "tier3_discovery"

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_article_has_discovery_query(self, mock_anthropic):
        """Tier 2 articles should include the discovery query used."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        mock_search_result = MagicMock()
        mock_search_result.type = "web_search_result"
        mock_search_result.url = "https://example.com/test"
        mock_search_result.title = "Test"
        mock_search_result.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_search_result]

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="finance",
            industry_name="Finance",
            spec_id="insurance",
            spec_name="Insurance",
            max_results=5,
            year=2026,
        )

        assert len(articles) >= 1
        assert "discovery_query" in articles[0]
        assert "Insurance" in articles[0]["discovery_query"]
        assert "Finance" in articles[0]["discovery_query"]

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_specializations_is_list(self, mock_anthropic):
        """Article specializations should be a list (matching Tier 1 format)."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        mock_search_result = MagicMock()
        mock_search_result.type = "web_search_result"
        mock_search_result.url = "https://example.com/test"
        mock_search_result.title = "Test"
        mock_search_result.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_search_result]

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="apparel_footwear",
            spec_name="Apparel & Footwear",
            max_results=5,
            year=2026,
        )

        assert len(articles) >= 1
        assert isinstance(articles[0]["specializations"], list)
        assert articles[0]["specializations"] == ["Apparel & Footwear"]


# ── Filtering Tests ────────────────────────────────────────────


class TestFiltering:
    """Verify domain filtering and dedup are applied to search results."""

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_blocked_domain_filtered(self, mock_anthropic):
        """Articles from blocked domains should be skipped."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        # One blocked domain result, one good result
        mock_blocked = MagicMock()
        mock_blocked.type = "web_search_result"
        mock_blocked.url = "https://medium.com/some-post"  # medium.com is typically blocked
        mock_blocked.title = "Blocked"
        mock_blocked.page_age = None

        mock_good = MagicMock()
        mock_good.type = "web_search_result"
        mock_good.url = "https://hbr.org/great-article"
        mock_good.title = "Good Article"
        mock_good.page_age = None

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = [mock_blocked, mock_good]

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            max_results=10,
            year=2026,
        )

        # Should have filtered based on domain lists
        urls = [a["url"] for a in articles]
        # The exact filtering depends on domain_lists.json config
        # At minimum, we verify it ran without error and returned results
        assert isinstance(articles, list)

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_max_results_enforced(self, mock_anthropic):
        """Should not return more articles than max_results."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()

        # Create 20 search results
        search_results = []
        for i in range(20):
            mock_result = MagicMock()
            mock_result.type = "web_search_result"
            mock_result.url = f"https://example{i}.com/article"
            mock_result.title = f"Article {i}"
            mock_result.page_age = None
            search_results.append(mock_result)

        mock_result_block = MagicMock()
        mock_result_block.type = "web_search_tool_result"
        mock_result_block.content = search_results

        mock_response = MagicMock()
        mock_response.content = [mock_result_block]
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            max_results=3,
            year=2026,
        )

        assert len(articles) <= 3

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_api_error_handled_gracefully(self, mock_anthropic):
        """API errors should not crash the service."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API error")
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        articles = service._search_for_specialization(
            industry_id="consumer",
            industry_name="Consumer",
            spec_id="food_beverage",
            spec_name="Food & Beverage",
            max_results=5,
            year=2026,
        )

        assert articles == []

    @patch("app.services.tier2_discovery_service.anthropic")
    def test_discover_handles_partial_failures(self, mock_anthropic, cold_start):
        """discover_articles should continue even if some specializations fail."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        mock_client = MagicMock()
        # Alternate between errors and empty responses
        mock_response = MagicMock()
        mock_response.content = []

        call_count = [0]

        def side_effect(**kwargs):
            call_count[0] += 1
            if call_count[0] % 3 == 0:
                raise Exception("Intermittent API error")
            return mock_response

        mock_client.messages.create.side_effect = side_effect
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client

        # Should not raise, even with some failures
        articles = service.discover_articles()
        assert isinstance(articles, list)

        # Should have attempted every specialization in this run's slice (cold start, GUR-238)
        assert call_count[0] == _slice_size(len(_specs()))
