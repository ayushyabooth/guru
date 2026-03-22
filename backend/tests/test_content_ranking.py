"""
Tests for Content Ranking System

- Headline selection via composite score (quality + priority + freshness + tier)
- Within-storyboard article ranking (similarity + quality + priority)
- Storyboard-level ranking score
- Source tier scoring
- Freshness decay
- Auto-essential detection
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from app.services.clustering_service import (
    _get_source_tier_score,
    _get_freshness_score,
    _get_priority_score,
    _select_headline_article,
    _compute_storyboard_ranking_score,
)
from app.services.content_quality_service import ContentQualityService


# ── Helpers ─────────────────────────────────────────────────────


_SENTINEL = object()


def _make_article(
    quality_score=None,
    ingestion_tier=None,
    created_at=_SENTINEL,
    article_id=None,
):
    """Create a mock Article object for testing."""
    article = MagicMock()
    article.id = article_id or MagicMock()
    article.quality_score = quality_score
    article.ingestion_tier = ingestion_tier
    article.created_at = datetime.now() if created_at is _SENTINEL else created_at
    article.title = "Test Article"
    article.word_count = 500
    return article


def _mock_db_with_priorities(priority_map):
    """Create a mock DB session that returns ExpertNote priorities.

    priority_map: dict mapping article.id -> priority string (e.g., "Essential", "High", "Normal")
    """
    db = MagicMock()

    def query_side_effect(*args):
        mock_query = MagicMock()

        def filter_side_effect(*filter_args):
            mock_filter = MagicMock()

            # Extract article_id from the filter
            for arg in filter_args:
                # Try to find the article_id from the comparison
                for aid, priority in priority_map.items():
                    note = MagicMock()
                    note.priority = priority
                    mock_filter.all.return_value = [note]
                    # We need to match by article ID, use a simple approach
                    break

            # Default: return Normal priority note
            note = MagicMock()
            note.priority = "Normal"
            mock_filter.all.return_value = [note]
            return mock_filter

        mock_query.filter.side_effect = filter_side_effect
        return mock_query

    db.query.side_effect = query_side_effect
    return db


# ── Source Tier Score Tests ──────────────────────────────────────


class TestSourceTierScore:
    def test_tier2_luminary_highest(self):
        article = _make_article(ingestion_tier="tier2_luminary")
        assert _get_source_tier_score(article) == 0.9

    def test_tier1_expert_medium(self):
        article = _make_article(ingestion_tier="tier1_expert")
        assert _get_source_tier_score(article) == 0.7

    def test_tier3_discovery_lowest(self):
        article = _make_article(ingestion_tier="tier3_discovery")
        assert _get_source_tier_score(article) == 0.5

    def test_unknown_tier_defaults(self):
        article = _make_article(ingestion_tier=None)
        assert _get_source_tier_score(article) == 0.5

    def test_luminary_greater_than_expert(self):
        a_lum = _make_article(ingestion_tier="tier2_luminary")
        a_exp = _make_article(ingestion_tier="tier1_expert")
        assert _get_source_tier_score(a_lum) > _get_source_tier_score(a_exp)

    def test_expert_greater_than_discovery(self):
        a_exp = _make_article(ingestion_tier="tier1_expert")
        a_disc = _make_article(ingestion_tier="tier3_discovery")
        assert _get_source_tier_score(a_exp) > _get_source_tier_score(a_disc)


# ── Freshness Score Tests ────────────────────────────────────────


class TestFreshnessScore:
    def test_brand_new_article_scores_1(self):
        article = _make_article(created_at=datetime.now())
        score = _get_freshness_score(article)
        assert score > 0.95

    def test_15_day_old_article(self):
        article = _make_article(created_at=datetime.now() - timedelta(days=15))
        score = _get_freshness_score(article)
        assert 0.45 < score < 0.55  # Should be ~0.5

    def test_30_day_old_article_scores_0(self):
        article = _make_article(created_at=datetime.now() - timedelta(days=30))
        score = _get_freshness_score(article)
        assert score == 0.0

    def test_60_day_old_article_clamped_at_0(self):
        article = _make_article(created_at=datetime.now() - timedelta(days=60))
        score = _get_freshness_score(article)
        assert score == 0.0

    def test_newer_article_scores_higher(self):
        new_article = _make_article(created_at=datetime.now() - timedelta(days=1))
        old_article = _make_article(created_at=datetime.now() - timedelta(days=20))
        assert _get_freshness_score(new_article) > _get_freshness_score(old_article)

    def test_no_created_at_scores_0(self):
        article = _make_article(created_at=None)
        assert _get_freshness_score(article) == 0.0


# ── Priority Score Tests ─────────────────────────────────────────


class TestPriorityScore:
    def test_essential_returns_1(self):
        article = _make_article()
        db = MagicMock()
        note = MagicMock()
        note.priority = "Essential"
        db.query.return_value.filter.return_value.all.return_value = [note]
        assert _get_priority_score(article, db) == 1.0

    def test_high_returns_07(self):
        article = _make_article()
        db = MagicMock()
        note = MagicMock()
        note.priority = "High"
        db.query.return_value.filter.return_value.all.return_value = [note]
        assert _get_priority_score(article, db) == 0.7

    def test_normal_returns_03(self):
        article = _make_article()
        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]
        assert _get_priority_score(article, db) == 0.3

    def test_no_notes_returns_03(self):
        article = _make_article()
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        assert _get_priority_score(article, db) == 0.3

    def test_essential_takes_precedence(self):
        """If an article has both Essential and Normal notes, Essential wins."""
        article = _make_article()
        db = MagicMock()
        note1 = MagicMock()
        note1.priority = "Normal"
        note2 = MagicMock()
        note2.priority = "Essential"
        db.query.return_value.filter.return_value.all.return_value = [note1, note2]
        assert _get_priority_score(article, db) == 1.0


# ── Headline Selection Tests ────────────────────────────────────


class TestHeadlineSelection:
    def test_higher_quality_selected_as_headline(self):
        """Higher quality article should be selected as headline, all else equal."""
        a_high = _make_article(quality_score=0.9, ingestion_tier="tier1_expert")
        a_low = _make_article(quality_score=0.3, ingestion_tier="tier1_expert")

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        result = _select_headline_article([a_low, a_high], db)
        assert result == a_high

    def test_essential_beats_low_quality(self):
        """Essential priority can beat quality if quality difference isn't huge."""
        a_essential = _make_article(quality_score=0.5, ingestion_tier="tier1_expert")
        a_normal = _make_article(quality_score=0.6, ingestion_tier="tier1_expert")

        db = MagicMock()

        def filter_side_effect(*args):
            mock = MagicMock()
            # Check which article is being queried
            note = MagicMock()
            # We'll check based on the filter args
            for arg in args:
                pass
            note.priority = "Normal"
            mock.all.return_value = [note]
            return mock

        # Make Essential article return Essential priority
        call_count = [0]

        def query_side_effect(*args):
            mock_query = MagicMock()

            def filter_fn(*filter_args):
                mock_filter = MagicMock()
                note = MagicMock()
                # First call is for a_essential, second for a_normal
                if call_count[0] % 2 == 0:
                    note.priority = "Essential"
                else:
                    note.priority = "Normal"
                call_count[0] += 1
                mock_filter.all.return_value = [note]
                return mock_filter

            mock_query.filter.side_effect = filter_fn
            return mock_query

        db.query.side_effect = query_side_effect

        result = _select_headline_article([a_essential, a_normal], db)
        # Essential priority (0.30 * 1.0 = 0.30) vs Normal (0.30 * 0.3 = 0.09)
        # Plus quality difference: 0.40 * 0.5 = 0.20 vs 0.40 * 0.6 = 0.24
        # Essential total: 0.20 + 0.30 = 0.50, Normal total: 0.24 + 0.09 = 0.33
        assert result == a_essential

    def test_luminary_preferred_over_discovery(self):
        """Same quality, same priority - Luminary should edge out Discovery."""
        a_tier1 = _make_article(quality_score=0.7, ingestion_tier="tier2_luminary")
        a_tier2 = _make_article(quality_score=0.7, ingestion_tier="tier3_discovery")

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        result = _select_headline_article([a_tier2, a_tier1], db)
        assert result == a_tier1

    def test_single_article_returns_itself(self):
        article = _make_article(quality_score=0.5)
        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        result = _select_headline_article([article], db)
        assert result == article


# ── Storyboard Ranking Score Tests ───────────────────────────────


class TestStoryboardRankingScore:
    def test_high_quality_storyboard_scores_higher(self):
        """Storyboard with high-quality articles should score higher."""
        high_articles = [
            _make_article(quality_score=0.9, ingestion_tier="tier2_luminary"),
            _make_article(quality_score=0.8, ingestion_tier="tier2_luminary"),
        ]
        low_articles = [
            _make_article(quality_score=0.3, ingestion_tier="tier3_discovery"),
            _make_article(quality_score=0.2, ingestion_tier="tier3_discovery"),
        ]

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        high_score = _compute_storyboard_ranking_score(
            high_articles, high_articles[0], db
        )
        low_score = _compute_storyboard_ranking_score(
            low_articles, low_articles[0], db
        )

        assert high_score > low_score

    def test_essential_ratio_boosts_score(self):
        """Storyboard with Essential articles should score higher than all Normal."""
        articles = [
            _make_article(quality_score=0.5, ingestion_tier="tier1_expert"),
            _make_article(quality_score=0.5, ingestion_tier="tier1_expert"),
        ]

        # DB that returns Essential for first article, Normal for second
        db_essential = MagicMock()
        call_count = [0]

        def query_essential(*args):
            mock = MagicMock()

            def filter_fn(*fa):
                mf = MagicMock()
                note = MagicMock()
                note.priority = "Essential" if call_count[0] % 2 == 0 else "Normal"
                call_count[0] += 1
                mf.all.return_value = [note]
                return mf

            mock.filter.side_effect = filter_fn
            return mock

        db_essential.query.side_effect = query_essential

        # DB that returns all Normal
        db_normal = MagicMock()
        note_normal = MagicMock()
        note_normal.priority = "Normal"
        db_normal.query.return_value.filter.return_value.all.return_value = [note_normal]

        score_with_essential = _compute_storyboard_ranking_score(
            articles, articles[0], db_essential
        )
        score_all_normal = _compute_storyboard_ranking_score(
            articles, articles[0], db_normal
        )

        assert score_with_essential > score_all_normal

    def test_score_in_valid_range(self):
        """Ranking score should be between 0 and 1."""
        articles = [_make_article(quality_score=0.7, ingestion_tier="tier2_luminary")]
        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        score = _compute_storyboard_ranking_score(articles, articles[0], db)
        assert 0.0 <= score <= 1.0

    def test_empty_articles_returns_0(self):
        db = MagicMock()
        score = _compute_storyboard_ranking_score([], _make_article(), db)
        assert score == 0.0

    def test_luminary_storyboard_outranks_discovery(self):
        """Luminary storyboard should rank higher than Discovery, same quality."""
        tier1_articles = [
            _make_article(quality_score=0.6, ingestion_tier="tier2_luminary"),
        ]
        tier2_articles = [
            _make_article(quality_score=0.6, ingestion_tier="tier3_discovery"),
        ]

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        score_t1 = _compute_storyboard_ranking_score(
            tier1_articles, tier1_articles[0], db
        )
        score_t2 = _compute_storyboard_ranking_score(
            tier2_articles, tier2_articles[0], db
        )

        assert score_t1 > score_t2


# ── Auto-Essential Detection Tests ───────────────────────────────


class TestAutoEssentialDetection:
    @pytest.fixture
    def quality_service(self):
        return ContentQualityService()

    def test_high_score_any_tier_auto_essential(self, quality_service):
        """quality_score >= 0.85 from any tier -> auto Essential."""
        assert quality_service.should_auto_essential(0.85, "tier3_discovery") is True
        assert quality_service.should_auto_essential(0.90, "tier1_expert") is True

    def test_luminary_lower_threshold(self, quality_service):
        """Luminary (Tier 2) + quality_score >= 0.75 -> auto Essential."""
        assert quality_service.should_auto_essential(0.75, "tier2_luminary") is True
        assert quality_service.should_auto_essential(0.80, "tier2_luminary") is True

    def test_luminary_below_threshold_not_essential(self, quality_service):
        """Luminary with score < 0.75 should not be auto-essential."""
        assert quality_service.should_auto_essential(0.74, "tier2_luminary") is False

    def test_below_threshold_not_essential(self, quality_service):
        """Score below 0.85 for non-luminary tiers should not be auto-essential."""
        assert quality_service.should_auto_essential(0.84, "tier3_discovery") is False
        assert quality_service.should_auto_essential(0.50, "tier1_expert") is False

    def test_boundary_values(self, quality_service):
        """Test exact boundary values."""
        assert quality_service.should_auto_essential(0.85, "tier1_expert") is True
        assert quality_service.should_auto_essential(0.75, "tier2_luminary") is True
        assert quality_service.should_auto_essential(0.749, "tier2_luminary") is False
        assert quality_service.should_auto_essential(0.849, "tier3_discovery") is False


# ── Freshness Decay Integration Tests ────────────────────────────


class TestFreshnessDecayIntegration:
    def test_fresh_article_dominates_stale_high_quality(self):
        """Very fresh low-quality article should NOT beat old high-quality."""
        fresh = _make_article(
            quality_score=0.3,
            created_at=datetime.now(),
            ingestion_tier="tier3_discovery"
        )
        stale = _make_article(
            quality_score=0.9,
            created_at=datetime.now() - timedelta(days=25),
            ingestion_tier="tier2_luminary"
        )

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        # Quality dominates (40% weight) vs freshness (20% weight)
        result = _select_headline_article([fresh, stale], db)
        assert result == stale

    def test_same_quality_fresh_wins(self):
        """Same quality - fresher article should win."""
        fresh = _make_article(
            quality_score=0.7,
            created_at=datetime.now(),
            ingestion_tier="tier1_expert"
        )
        stale = _make_article(
            quality_score=0.7,
            created_at=datetime.now() - timedelta(days=20),
            ingestion_tier="tier1_expert"
        )

        db = MagicMock()
        note = MagicMock()
        note.priority = "Normal"
        db.query.return_value.filter.return_value.all.return_value = [note]

        result = _select_headline_article([stale, fresh], db)
        assert result == fresh
