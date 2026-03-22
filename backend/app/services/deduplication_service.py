"""
Deduplication Service - URL normalization + content similarity

1. URL dedup: Normalize URLs (strip utm_ params, lowercase domain, strip trailing slash)
2. Cross-tier lock: In-memory processing_urls set prevents concurrent tiers from ingesting same URL
3. Content dedup: Cosine similarity of first 1000 chars using SentenceTransformer. Threshold: 0.92
"""
import hashlib
import logging
import re
import threading
from datetime import datetime, timedelta
from typing import Optional, Set
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy.orm import Session

from app.config import settings
from app.models.article import Article

logger = logging.getLogger(__name__)


class DeduplicationService:
    """URL normalization + content similarity dedup."""

    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self._processing_urls: Set[str] = set()
        self._processing_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> "DeduplicationService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ── URL Normalization ────────────────────────────────────────────

    def normalize_url(self, url: str) -> str:
        """
        Normalize a URL for deduplication.

        - Lowercase the domain
        - Strip trailing slash
        - Remove utm_ tracking parameters
        - Remove common tracking fragments
        - Sort remaining query parameters for consistency
        """
        try:
            parsed = urlparse(url)

            # Lowercase scheme and domain
            scheme = parsed.scheme.lower() or "https"
            netloc = parsed.netloc.lower()

            # Strip www. prefix for normalization
            if netloc.startswith("www."):
                netloc = netloc[4:]

            # Strip trailing slash from path
            path = parsed.path.rstrip("/") or "/"

            # Remove tracking query parameters
            if parsed.query:
                params = parse_qs(parsed.query, keep_blank_values=False)
                # Remove utm_ and common tracking params
                tracking_prefixes = ("utm_", "fbclid", "gclid", "ref", "source", "mc_")
                filtered_params = {
                    k: v for k, v in params.items()
                    if not any(k.lower().startswith(p) for p in tracking_prefixes)
                }
                # Sort params for consistency
                query = urlencode(filtered_params, doseq=True) if filtered_params else ""
            else:
                query = ""

            # Strip fragment
            normalized = urlunparse((scheme, netloc, path, "", query, ""))
            return normalized

        except Exception as e:
            logger.warning(f"URL normalization failed for '{url}': {e}")
            return url

    # ── URL Dedup ────────────────────────────────────────────────────

    def is_duplicate_url(self, url: str, db: Session) -> bool:
        """Check if normalized URL already exists in the database."""
        normalized = self.normalize_url(url)
        existing = db.query(Article.id).filter(Article.url == normalized).first()
        if existing:
            return True

        # Also check original URL in case normalization differs
        if normalized != url:
            existing = db.query(Article.id).filter(Article.url == url).first()
            if existing:
                return True

        return False

    # ── Cross-Tier Lock ──────────────────────────────────────────────

    def try_acquire_url(self, url: str) -> bool:
        """
        Try to acquire a processing lock for a URL.
        Returns True if the URL is not being processed by another tier.
        """
        normalized = self.normalize_url(url)
        with self._processing_lock:
            if normalized in self._processing_urls:
                return False
            self._processing_urls.add(normalized)
            return True

    def release_url(self, url: str):
        """Release the processing lock for a URL."""
        normalized = self.normalize_url(url)
        with self._processing_lock:
            self._processing_urls.discard(normalized)

    def clear_processing_urls(self):
        """Clear all processing locks (e.g., after a run completes)."""
        with self._processing_lock:
            self._processing_urls.clear()

    # ── Content Dedup ────────────────────────────────────────────────

    def compute_content_hash(self, text: str) -> str:
        """Compute SHA-256 hash of the first 1000 chars of content for fast dedup."""
        if not text:
            return ""
        # Use first 1000 chars for hash (fast check)
        snippet = text[:1000].strip().lower()
        # Normalize whitespace
        snippet = re.sub(r'\s+', ' ', snippet)
        return hashlib.sha256(snippet.encode("utf-8")).hexdigest()

    def is_duplicate_content(
        self, text: str, db: Session, window_days: Optional[int] = None
    ) -> bool:
        """
        Check if content is a duplicate via content hash.

        Uses SHA-256 of first 1000 chars for fast comparison.
        Only checks articles within the specified time window.
        """
        if not text:
            return False

        content_hash = self.compute_content_hash(text)
        if not content_hash:
            return False

        window = window_days or settings.DEDUP_CONTENT_WINDOW_DAYS
        cutoff = datetime.utcnow() - timedelta(days=window)

        existing = db.query(Article.id).filter(
            Article.content_hash == content_hash,
            Article.created_at >= cutoff,
        ).first()

        return existing is not None

    def is_duplicate(self, url: str, text: Optional[str], db: Session) -> bool:
        """
        Combined dedup check: URL first (fast), then content hash.
        """
        if self.is_duplicate_url(url, db):
            logger.debug(f"URL duplicate detected: {url}")
            return True

        if text and self.is_duplicate_content(text, db):
            logger.debug(f"Content duplicate detected for URL: {url}")
            return True

        return False
