"""
Content Quality Pipeline - Gate + Score

Multi-stage quality assessment for ingested articles.
Stage 1: Domain check (pre-scrape, free)
Stage 2: Word count check (post-scrape, free)
Stage 3: Link ratio check (post-scrape, free)
Stage 4: Paragraph quality check (post-scrape, free)
Stage 5: Content density check (post-scrape, free)

Articles below quality threshold are rejected (never stored).
Articles that pass get a quality_score (0.0-1.0) used for ranking.
"""
import json
import logging
import re
from pathlib import Path
from typing import Tuple, Optional, Dict
from urllib.parse import urlparse

from app.config import settings

logger = logging.getLogger(__name__)


class ContentQualityService:
    """Multi-stage quality assessment: Gate + Score."""

    _instance = None
    _allowed_domains: set = set()
    _blocked_domains: set = set()

    def __init__(self):
        self._load_domain_lists()

    @classmethod
    def get_instance(cls) -> "ContentQualityService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load_domain_lists(self):
        """Load allowed/blocked domain lists from config."""
        config_path = Path(__file__).parent.parent.parent / "config" / "domain_lists.json"
        try:
            with open(config_path, "r") as f:
                data = json.load(f)
            self._allowed_domains = set(data.get("allowed_domains", []))
            self._blocked_domains = set(data.get("blocked_domains", []))
            logger.info(
                f"Loaded domain lists: {len(self._allowed_domains)} allowed, "
                f"{len(self._blocked_domains)} blocked"
            )
        except Exception as e:
            logger.warning(f"Could not load domain lists: {e}")
            self._allowed_domains = set()
            self._blocked_domains = set()

    def _extract_domain(self, url: str) -> str:
        """Extract root domain from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            # Strip www. prefix
            if domain.startswith("www."):
                domain = domain[4:]
            return domain
        except Exception:
            return ""

    def _is_subdomain_of(self, domain: str, domain_list: set) -> bool:
        """Check if domain or any parent domain is in the list."""
        parts = domain.split(".")
        for i in range(len(parts) - 1):
            candidate = ".".join(parts[i:])
            if candidate in domain_list:
                return True
        return False

    # ── Stage 1: Domain Check (pre-scrape) ──────────────────────────

    def assess_pre_scrape(self, url: str) -> Tuple[bool, str, bool]:
        """
        Stage 1: Domain check against allowed/blocked lists.

        Returns:
            (passed, reason, is_allowed_domain)
            - passed: True if not blocked
            - reason: rejection reason if blocked
            - is_allowed_domain: True if domain is in allowed list (quality boost)
        """
        domain = self._extract_domain(url)
        if not domain:
            return False, "Could not parse domain from URL", False

        if self._is_subdomain_of(domain, self._blocked_domains):
            return False, f"Domain '{domain}' is blocked", False

        is_allowed = self._is_subdomain_of(domain, self._allowed_domains)
        return True, "", is_allowed

    # ── Stages 2-5: Post-scrape structural checks ───────────────────

    def assess_post_scrape(
        self,
        text: str,
        html: Optional[str],
        tier: str,
    ) -> Tuple[bool, float, str]:
        """
        Stages 2-5: Structural quality checks on scraped content.

        Returns:
            (passed_gate, quality_score, rejection_reason)
        """
        checks = {}

        # Stage 2: Word count
        word_count = len(text.split()) if text else 0
        checks["word_count"] = word_count
        if word_count < settings.QUALITY_MIN_WORD_COUNT:
            return False, 0.0, f"Too few words: {word_count} (min {settings.QUALITY_MIN_WORD_COUNT})"
        if word_count > settings.QUALITY_MAX_WORD_COUNT:
            return False, 0.0, f"Too many words: {word_count} (max {settings.QUALITY_MAX_WORD_COUNT})"

        # Stage 3: Link ratio
        if text:
            link_count = len(re.findall(r'https?://\S+', text))
            link_ratio = link_count / max(word_count, 1)
            checks["link_ratio"] = link_ratio
            if link_ratio > settings.QUALITY_MAX_LINK_RATIO:
                return False, 0.0, f"Too many links: ratio {link_ratio:.3f} (max {settings.QUALITY_MAX_LINK_RATIO})"
        else:
            checks["link_ratio"] = 0.0

        # Stage 4: Paragraph quality
        paragraphs = self._extract_paragraphs(text)
        quality_paragraphs = [
            p for p in paragraphs
            if len(p.split()) >= settings.QUALITY_MIN_PARAGRAPH_WORDS
        ]
        checks["total_paragraphs"] = len(paragraphs)
        checks["quality_paragraphs"] = len(quality_paragraphs)
        if len(quality_paragraphs) < settings.QUALITY_MIN_PARAGRAPHS:
            return (
                False, 0.0,
                f"Too few quality paragraphs: {len(quality_paragraphs)} "
                f"(min {settings.QUALITY_MIN_PARAGRAPHS} with {settings.QUALITY_MIN_PARAGRAPH_WORDS}+ words)"
            )

        # Stage 5: Content density (text vs HTML ratio)
        if html and len(html) > 0:
            content_density = len(text) / len(html)
            checks["content_density"] = content_density
            if content_density < settings.QUALITY_MIN_CONTENT_DENSITY:
                return (
                    False, 0.0,
                    f"Low content density: {content_density:.3f} (min {settings.QUALITY_MIN_CONTENT_DENSITY})"
                )
        else:
            checks["content_density"] = 1.0  # No HTML to compare, assume good

        # All checks passed - compute quality score
        quality_score = self._compute_quality_score(checks, tier)

        # Apply gate threshold
        gate_threshold = self._get_gate_threshold(tier)
        if quality_score < gate_threshold:
            return (
                False, quality_score,
                f"Below quality gate: {quality_score:.3f} (threshold {gate_threshold})"
            )

        return True, quality_score, ""

    def _extract_paragraphs(self, text: str) -> list:
        """Extract paragraphs from text (split by double newline or single newline with blank line)."""
        if not text:
            return []
        # Split on double newlines or patterns that indicate paragraph breaks
        paragraphs = re.split(r'\n\s*\n', text)
        # Filter empty paragraphs
        return [p.strip() for p in paragraphs if p.strip()]

    def _compute_quality_score(self, checks: Dict, tier: str, is_allowed_domain: bool = False) -> float:
        """
        Compute 0.0-1.0 quality score from structural metrics.

        Scoring breakdown:
        - Word count score (0-0.25): Sweet spot 500-3000 words
        - Link ratio score (0-0.20): Lower is better
        - Paragraph quality score (0-0.25): More quality paragraphs is better
        - Content density score (0-0.15): Higher density is better
        - Domain boost (0-0.15): Allowed domains get a boost
        """
        score = 0.0

        # Word count score (0-0.25): optimal range 500-3000
        wc = checks.get("word_count", 0)
        if wc < 500:
            wc_score = wc / 500 * 0.15
        elif wc <= 3000:
            wc_score = 0.25
        elif wc <= 8000:
            wc_score = 0.25 - (wc - 3000) / 5000 * 0.10
        else:
            wc_score = 0.15
        score += wc_score

        # Link ratio score (0-0.20): lower is better
        lr = checks.get("link_ratio", 0.0)
        lr_score = max(0, 0.20 * (1 - lr / settings.QUALITY_MAX_LINK_RATIO))
        score += lr_score

        # Paragraph quality score (0-0.25): more quality paragraphs is better
        qp = checks.get("quality_paragraphs", 0)
        if qp >= 10:
            pq_score = 0.25
        elif qp >= 5:
            pq_score = 0.15 + (qp - 5) / 5 * 0.10
        else:
            pq_score = qp / 5 * 0.15
        score += pq_score

        # Content density score (0-0.15): higher is better
        cd = checks.get("content_density", 0.0)
        cd_score = min(0.15, cd * 0.5)
        score += cd_score

        # Domain boost (0-0.15)
        if is_allowed_domain:
            score += 0.15

        return min(1.0, score)

    def compute_quality_score_with_domain(
        self, text: str, html: Optional[str], tier: str, url: str
    ) -> Tuple[bool, float, str]:
        """
        Full quality assessment including domain check.
        Convenience method combining pre-scrape and post-scrape checks.
        """
        # Stage 1: Domain check
        passed_domain, reason, is_allowed = self.assess_pre_scrape(url)
        if not passed_domain:
            return False, 0.0, reason

        # Stages 2-5: Structural checks
        passed, score, reason = self.assess_post_scrape(text, html, tier)
        if not passed:
            return False, score, reason

        # Recompute with domain boost if applicable
        if is_allowed and text:
            checks = self._build_checks(text, html)
            score = self._compute_quality_score(checks, tier, is_allowed_domain=True)

        return True, score, ""

    def _build_checks(self, text: str, html: Optional[str]) -> Dict:
        """Build checks dict from text/html for score computation."""
        word_count = len(text.split()) if text else 0
        link_count = len(re.findall(r'https?://\S+', text)) if text else 0
        paragraphs = self._extract_paragraphs(text)
        quality_paragraphs = [
            p for p in paragraphs
            if len(p.split()) >= settings.QUALITY_MIN_PARAGRAPH_WORDS
        ]
        content_density = len(text) / len(html) if html and len(html) > 0 else 1.0

        return {
            "word_count": word_count,
            "link_ratio": link_count / max(word_count, 1),
            "total_paragraphs": len(paragraphs),
            "quality_paragraphs": len(quality_paragraphs),
            "content_density": content_density,
        }

    def _get_gate_threshold(self, tier: str) -> float:
        """Get quality gate threshold for a tier."""
        thresholds = {
            "tier1_expert": settings.QUALITY_GATE_TIER1,
            "tier2_luminary": settings.QUALITY_GATE_TIER2,
            "tier3_discovery": settings.QUALITY_GATE_TIER3,
        }
        return thresholds.get(tier, 0.35)

    def should_auto_essential(self, quality_score: float, tier: str) -> bool:
        """
        Determine if an article should be auto-tagged as Essential.

        Rules:
        - quality_score >= 0.85 from any tier -> Essential
        - quality_score >= 0.75 AND tier2_luminary -> Essential
        """
        if quality_score >= settings.AUTO_ESSENTIAL_SCORE_ANY_TIER:
            return True
        if tier == "tier2_luminary" and quality_score >= settings.AUTO_ESSENTIAL_SCORE_TIER2:
            return True
        return False
