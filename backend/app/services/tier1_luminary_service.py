"""
Tier 1 Luminary RSS Ingestion Service

Fetches articles from RSS feeds of industry luminaries (publications, blogs, thought leaders).
Iterates sub-industries from the central IndustriesConfig — no hardcoded industry lists.
Feeds are configured in config/luminaries.json, validated against central config at load time.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from time import mktime

try:
    import feedparser
    _FEEDPARSER_AVAILABLE = True
except ImportError:
    feedparser = None  # type: ignore
    _FEEDPARSER_AVAILABLE = False

from app.services.industries_config import IndustriesConfig
from app.services.luminaries_config import LuminariesConfig
from app.services.deduplication_service import DeduplicationService
from app.services.content_quality_service import ContentQualityService

logger = logging.getLogger(__name__)


class Tier1LuminaryService:
    """Fetches and filters articles from luminary RSS feeds."""

    def __init__(self):
        self._luminaries_config = LuminariesConfig.get_instance()
        self._industries_config = IndustriesConfig.get_instance()
        self._dedup_service = DeduplicationService.get_instance()
        self._quality_service = ContentQualityService.get_instance()

    def discover_articles(self) -> List[Dict]:
        """
        Discover articles from all luminary RSS feeds across all sub-industries.

        Iterates IndustriesConfig → specializations → luminaries from config.
        Returns list of article dicts ready for the shared ingestion pipeline.
        """
        all_articles = []
        max_age_days = self._luminaries_config.get_max_article_age_days()
        max_per_luminary = self._luminaries_config.get_max_articles_per_run()
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_age_days)

        # Iterate all industries and specializations from central config
        for industry in self._industries_config._config.get("industries", []):
            industry_id = industry["id"]
            industry_name = industry["name"]

            for spec in industry.get("specializations", []):
                spec_id = spec["id"]
                spec_name = spec["name"]

                luminaries = self._luminaries_config.get_luminaries_for_specialization(spec_id)
                if not luminaries:
                    logger.debug(f"No luminaries configured for {industry_id}/{spec_id}")
                    continue

                for luminary in luminaries:
                    try:
                        articles = self._fetch_feed_articles(
                            luminary=luminary,
                            industry_id=industry_id,
                            industry_name=industry_name,
                            spec_id=spec_id,
                            spec_name=spec_name,
                            cutoff_date=cutoff_date,
                            max_articles=max_per_luminary,
                        )
                        all_articles.extend(articles)
                    except Exception as e:
                        logger.error(
                            f"Error fetching feed for {luminary['name']} "
                            f"({spec_id}): {e}"
                        )

        logger.info(
            f"Tier 1 discovery complete: {len(all_articles)} articles "
            f"from luminary RSS feeds"
        )
        return all_articles

    def _fetch_feed_articles(
        self,
        luminary: Dict,
        industry_id: str,
        industry_name: str,
        spec_id: str,
        spec_name: str,
        cutoff_date: datetime,
        max_articles: int,
    ) -> List[Dict]:
        """Fetch and filter articles from a single luminary's RSS feed."""
        feed_url = luminary["feed_url"]
        luminary_name = luminary["name"]
        luminary_id = luminary.get("id", luminary_name.lower().replace(" ", "_"))
        timeout = self._luminaries_config.get_feed_timeout()

        logger.debug(f"Fetching RSS feed: {luminary_name} ({feed_url})")

        if not _FEEDPARSER_AVAILABLE:
            logger.error("feedparser is not installed — cannot fetch RSS feeds. "
                         "Ensure feedparser is in requirements.txt and the container was rebuilt.")
            return []

        import socket
        old_timeout = socket.getdefaulttimeout()
        try:
            socket.setdefaulttimeout(timeout)
            feed = feedparser.parse(feed_url, request_headers={"User-Agent": "Guru-MVP/1.0"})
        except Exception as e:
            logger.warning(f"feedparser.parse() raised for {luminary_name}: {e}")
            return []
        finally:
            socket.setdefaulttimeout(old_timeout)

        if feed.bozo and not feed.entries:
            logger.warning(
                f"Feed error for {luminary_name}: {feed.bozo_exception}"
            )
            return []

        articles = []
        for entry in feed.entries[:max_articles * 2]:  # Fetch extra to account for filtering
            if len(articles) >= max_articles:
                break

            # Extract article data
            article = self._parse_entry(
                entry=entry,
                luminary_id=luminary_id,
                luminary_name=luminary_name,
                industry_id=industry_id,
                industry_name=industry_name,
                spec_id=spec_id,
                spec_name=spec_name,
                cutoff_date=cutoff_date,
            )
            if article:
                articles.append(article)

        logger.debug(
            f"  {luminary_name}: {len(articles)} articles "
            f"(from {len(feed.entries)} entries)"
        )
        return articles

    def _parse_entry(
        self,
        entry,
        luminary_id: str,
        luminary_name: str,
        industry_id: str,
        industry_name: str,
        spec_id: str,
        spec_name: str,
        cutoff_date: datetime,
    ) -> Optional[Dict]:
        """Parse a single RSS feed entry into an article dict."""
        # Extract URL
        url = entry.get("link", "")
        if not url:
            return None

        # Filter by age
        published = self._get_published_date(entry)
        if published and published < cutoff_date:
            return None

        # Pre-scrape domain check
        passed, reason, is_allowed = self._quality_service.assess_pre_scrape(url)
        if not passed:
            logger.debug(f"  Skipping {url}: {reason}")
            return None

        # URL dedup check
        normalized_url = self._dedup_service.normalize_url(url)
        if not self._dedup_service.try_acquire_url(normalized_url):
            logger.debug(f"  Skipping duplicate URL: {url}")
            return None

        title = entry.get("title", "Untitled")

        return {
            "url": url,
            "title": title,
            "published_date": published,
            "luminary_id": luminary_id,
            "luminary_name": luminary_name,
            "industry": industry_name,
            "industry_id": industry_id,
            "specializations": [spec_name],
            "specialization_id": spec_id,
            "ingestion_tier": "tier2_luminary",
            "is_allowed_domain": is_allowed,
        }

    def _get_published_date(self, entry) -> Optional[datetime]:
        """Extract published date from RSS entry."""
        for date_field in ("published_parsed", "updated_parsed"):
            parsed = entry.get(date_field)
            if parsed:
                try:
                    return datetime.fromtimestamp(mktime(parsed), tz=timezone.utc)
                except (ValueError, OverflowError):
                    continue

        # Try raw date string
        for date_field in ("published", "updated"):
            raw = entry.get(date_field)
            if raw:
                try:
                    from email.utils import parsedate_to_datetime
                    return parsedate_to_datetime(raw)
                except (ValueError, TypeError):
                    continue

        return None
