"""
Tier 2 Web Discovery Service

Uses Claude Web Search API to discover high-quality articles for each sub-industry.
Iterates sub-industries from the central IndustriesConfig — no hardcoded industry lists.
"""
import logging
import math
from datetime import datetime, timezone
from typing import Dict, List, Set, Tuple

import anthropic

from app.config import settings
from app.services.industries_config import IndustriesConfig
from app.services.deduplication_service import DeduplicationService
from app.services.content_quality_service import ContentQualityService
from app.services.usage_logging import log_claude_usage

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
        Discover articles from web search, scoped to what users actually follow.

        GUR-238 cost controls (paid web search was the dominant ingestion cost):
        1. Scope: only specializations active users follow are eligible — we
           don't pay to discover content nobody can see in a filter-driven feed.
        2. Round-robin: each run searches one slice of the eligible set; full
           coverage every TIER3_DISCOVERY_ROUNDS runs.
        3. Early-exit: stop once we have enough fresh candidates for the cap.

        Returns list of article dicts ready for the shared ingestion pipeline.
        """
        all_articles = []
        max_per_spec = settings.TIER3_RESULTS_PER_SPECIALIZATION
        current_year = datetime.now(timezone.utc).year

        # 1. Build the eligible (industry, spec) set scoped to active users.
        eligible = self._eligible_specs()
        if not eligible:
            logger.info("Tier 3 discovery: no eligible specializations — skipping")
            return all_articles

        # 2. Round-robin: this run only searches one partition of the eligible set.
        run_slice = self._round_robin_slice(eligible)

        # 3. Candidate headroom: discover ~1.5x the ingest cap, then stop early —
        #    downstream ingestion is capped at MAX_ARTICLES_PER_INGESTION_RUN anyway.
        candidate_cap = math.ceil(settings.MAX_ARTICLES_PER_INGESTION_RUN * 1.5)

        logger.info(
            f"Tier 3 discovery: {len(eligible)} eligible specs, searching "
            f"{len(run_slice)} this run (round-robin, {settings.TIER3_DISCOVERY_ROUNDS} rounds), "
            f"candidate cap {candidate_cap}"
        )

        for industry_id, industry_name, spec_id, spec_name in run_slice:
            if len(all_articles) >= candidate_cap:
                logger.info(
                    f"Tier 3 discovery: hit candidate cap ({candidate_cap}) — "
                    f"stopping early before the rest of the slice"
                )
                break
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
            f"Tier 3 discovery complete: {len(all_articles)} articles "
            f"from {len(run_slice)} web searches"
        )
        return all_articles

    def _eligible_specs(self) -> List[Tuple[str, str, str, str]]:
        """Return (industry_id, industry_name, spec_id, spec_name) tuples that
        at least one active user follows — explicitly (a chosen specialization)
        or via a followed industry (core or interest).

        Cold-start fallback: if there are no active users with a profile yet,
        return ALL specs so a fresh deployment still seeds content.
        """
        followed_specs: Set[str] = set()
        followed_industries: Set[str] = set()
        has_users = False

        try:
            import json
            from app.db.database import SessionLocal
            from app.models.user import User, UserProfile

            db = SessionLocal()
            try:
                profiles = (
                    db.query(UserProfile)
                    .join(User, User.id == UserProfile.user_id)
                    .filter(User.is_active == True)  # noqa: E712
                    .all()
                )
                for p in profiles:
                    has_users = True
                    if p.core_industry:
                        followed_industries.add(p.core_industry.strip().lower())
                    # Specializations feed the spec set; interest industries feed
                    # the industry set (a followed industry makes all its specs eligible).
                    for raw, target in (
                        (p.specializations, followed_specs),
                        (p.additional_interest_industries, followed_industries),
                    ):
                        if not raw:
                            continue
                        try:
                            vals = json.loads(raw) if isinstance(raw, str) else raw
                        except (ValueError, TypeError):
                            continue
                        for v in (vals or []):
                            if v:
                                target.add(str(v).strip().lower())
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Tier 3 eligibility lookup failed ({e}) — discovering all specs")
            has_users = False

        all_pairs: List[Tuple[str, str, str, str]] = []
        eligible: List[Tuple[str, str, str, str]] = []
        for industry in self._industries_config._config.get("industries", []):
            industry_id = industry["id"]
            industry_name = industry["name"]
            ind_followed = industry_name.strip().lower() in followed_industries
            for spec in industry.get("specializations", []):
                pair = (industry_id, industry_name, spec["id"], spec["name"])
                all_pairs.append(pair)
                if ind_followed or spec["name"].strip().lower() in followed_specs:
                    eligible.append(pair)

        # Cold start (no users) → seed everything.
        if not has_users:
            return all_pairs
        # Users exist but nothing matched → almost certainly a name-mismatch, not a
        # genuine "nobody follows anything". Fail open to protect feed freshness.
        if not eligible:
            logger.warning(
                "Tier 3 eligibility matched 0 specs despite active users — "
                "likely a profile/config name mismatch; falling back to all specs"
            )
            return all_pairs
        return eligible

    def _round_robin_slice(
        self, eligible: List[Tuple[str, str, str, str]]
    ) -> List[Tuple[str, str, str, str]]:
        """Partition `eligible` into TIER3_DISCOVERY_ROUNDS groups and return the
        one for this run, chosen by the count of completed Tier-3 runs so the
        rotation persists across restarts."""
        rounds = max(1, settings.TIER3_DISCOVERY_ROUNDS)
        if rounds == 1 or len(eligible) <= rounds:
            return eligible

        run_index = 0
        try:
            from app.db.database import SessionLocal
            from app.models.ingestion_run import IngestionRun

            db = SessionLocal()
            try:
                completed = (
                    db.query(IngestionRun)
                    .filter(
                        IngestionRun.tier == "tier3_discovery",
                        IngestionRun.status == "completed",
                    )
                    .count()
                )
                run_index = completed % rounds
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Round-robin index lookup failed ({e}) — using slice 0")
            run_index = 0

        # Stable, interleaved partition: every `rounds`-th item starting at run_index.
        ordered = sorted(eligible)
        return [pair for i, pair in enumerate(ordered) if i % rounds == run_index]

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
                model=settings.CLAUDE_HAIKU_MODEL,  # Downgraded from Sonnet to save cost
                # GUR-238: trimmed from 4096 (we only extract URLs/titles) and
                # capped web_search uses to bound the per-search surcharge.
                max_tokens=settings.TIER3_DISCOVERY_MAX_TOKENS,
                tools=[{
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": settings.TIER3_WEB_SEARCH_MAX_USES,
                }],
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as e:
            logger.error(f"Claude API error for {spec_id}: {e}")
            return []

        # GUR-238: ground-truth cost attribution per discovery call.
        log_claude_usage(response, "tier3_discovery", spec=spec_name, model=settings.CLAUDE_HAIKU_MODEL)

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
