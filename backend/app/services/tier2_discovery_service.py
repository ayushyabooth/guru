"""
Tier 2 Web Discovery Service

Uses Claude Web Search API to discover high-quality articles for each sub-industry.
Iterates sub-industries from the central IndustriesConfig — no hardcoded industry lists.
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List

import anthropic

from app.config import settings
from app.services.industries_config import IndustriesConfig
from app.services.deduplication_service import DeduplicationService
from app.services.content_quality_service import ContentQualityService

logger = logging.getLogger(__name__)


class Tier2DiscoveryService:
    """Discovers articles via Claude Web Search for each sub-industry."""

    def __init__(self):
        self._industries_config = IndustriesConfig.get_instance()
        self._dedup_service = DeduplicationService.get_instance()
        self._quality_service = ContentQualityService.get_instance()
        self._client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def discover_articles(self) -> List[Dict]:
        """
        Discover articles from web search across all sub-industries.

        Iterates IndustriesConfig → specializations → runs web search.
        Returns list of article dicts ready for the shared ingestion pipeline.
        """
        all_articles = []
        max_per_spec = settings.TIER3_RESULTS_PER_SPECIALIZATION
        current_year = datetime.now(timezone.utc).year

        for industry in self._industries_config._config.get("industries", []):
            industry_id = industry["id"]
            industry_name = industry["name"]

            for spec in industry.get("specializations", []):
                spec_id = spec["id"]
                spec_name = spec["name"]

                try:
                    articles = self._search_for_specialization(
                        industry_id=industry_id,
                        industry_name=industry_name,
                        spec_id=spec_id,
                        spec_name=spec_name,
                        max_results=max_per_spec,
                        year=current_year,
                    )
                    all_articles.extend(articles)
                except Exception as e:
                    logger.error(
                        f"Web search failed for {industry_id}/{spec_id}: {e}"
                    )

        logger.info(
            f"Tier 2 discovery complete: {len(all_articles)} articles "
            f"from web search"
        )
        return all_articles

    def _search_for_specialization(
        self,
        industry_id: str,
        industry_name: str,
        spec_id: str,
        spec_name: str,
        max_results: int,
        year: int,
    ) -> List[Dict]:
        """Run web search for a single specialization and extract article candidates."""

        prompt = (
            f'Find recent high-quality industry articles, analysis, and reports about '
            f'"{spec_name}" in the {industry_name} industry published in {year}. '
            f'Focus on expert analysis, market trends, research reports, and thought leadership. '
            f'Provide the most relevant and substantive articles.'
        )

        logger.debug(f"Tier 2 searching: {industry_name}/{spec_name}")

        try:
            response = self._client.messages.create(
                model=settings.CLAUDE_SONNET_MODEL,
                max_tokens=4096,
                tools=[{"type": "web_search_20250305", "name": "web_search"}],
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            logger.error(f"Claude API error for {spec_id}: {e}")
            return []

        # Extract URLs from web search results
        raw_results = self._extract_search_results(response)

        if not raw_results:
            logger.debug(f"  {spec_name}: no search results")
            return []

        # Filter through quality + dedup checks
        articles = []
        for result in raw_results:
            if len(articles) >= max_results:
                break

            url = result.get("url", "")
            if not url:
                continue

            # Pre-scrape domain check
            passed, reason, is_allowed = self._quality_service.assess_pre_scrape(url)
            if not passed:
                logger.debug(f"  Skipping {url}: {reason}")
                continue

            # URL dedup check
            normalized_url = self._dedup_service.normalize_url(url)
            if not self._dedup_service.try_acquire_url(normalized_url):
                logger.debug(f"  Skipping duplicate URL: {url}")
                continue

            articles.append({
                "url": url,
                "title": result.get("title", "Untitled"),
                "published_date": None,
                "industry": industry_name,
                "industry_id": industry_id,
                "specializations": [spec_name],
                "specialization_id": spec_id,
                "ingestion_tier": "tier3_discovery",
                "discovery_query": f"{spec_name} {industry_name} {year}",
                "is_allowed_domain": is_allowed,
            })

        logger.debug(
            f"  {spec_name}: {len(articles)} articles "
            f"(from {len(raw_results)} search results)"
        )
        return articles

    def _extract_search_results(self, response) -> List[Dict]:
        """Extract article URLs and titles from Claude web search response."""
        results = []
        seen_urls = set()

        for block in response.content:
            if getattr(block, "type", None) == "web_search_tool_result":
                for result in getattr(block, "content", []):
                    if getattr(result, "type", None) == "web_search_result":
                        url = getattr(result, "url", "")
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            results.append({
                                "url": url,
                                "title": getattr(result, "title", ""),
                                "page_age": getattr(result, "page_age", None),
                            })

        return results
