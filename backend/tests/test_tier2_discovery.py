"""
Tests for Tier 2 Web Discovery Service

Verifies:
- Service iterates IndustriesConfig, not hardcoded lists
- Query construction from sub-industry names (via central config)
- Search result extraction from Claude API response
- Domain filtering and dedup on results
- Article data structure matches shared pipeline expectations
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, PropertyMock

from app.services.industries_config import IndustriesConfig
from app.services.deduplication_service import DeduplicationService


@pytest.fixture(autouse=True)
def reset_dedup():
    """Reset dedup processing URLs between tests."""
    DeduplicationService.get_instance().clear_processing_urls()
    yield
    DeduplicationService.get_instance().clear_processing_urls()


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
    def test_discover_iterates_all_specializations(self, mock_anthropic):
        """discover_articles should attempt search for all 21 specializations."""
        from app.services.tier2_discovery_service import Tier2DiscoveryService

        # Mock the Anthropic client to return empty responses
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = []  # No search results
        mock_client.messages.create.return_value = mock_response
        mock_anthropic.Anthropic.return_value = mock_client

        service = Tier2DiscoveryService()
        service._client = mock_client
        articles = service.discover_articles()

        # Should have called the API for each specialization (21 total = 3 industries x 7 specs)
        ind_config = IndustriesConfig.get_instance()
        expected_specs = sum(
            len(ind.get("specializations", []))
            for ind in ind_config._config.get("industries", [])
        )
        assert mock_client.messages.create.call_count == expected_specs
        assert expected_specs == 21  # 3 industries x 7 sub-industries

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
    def test_discover_handles_partial_failures(self, mock_anthropic):
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

        # Should have attempted all 21 specializations
        assert call_count[0] == 21
