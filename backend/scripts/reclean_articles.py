"""
One-time cleanup: strip boilerplate from existing articles, delete junk, re-score.

Usage:
    cd backend && python3 scripts/reclean_articles.py
    cd backend && python3 scripts/reclean_articles.py --dry-run   # preview only
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.models.article import Article, ExpertNote, ArticleAnnotation
from app.models.storyboard import StoryboardArticle, Storyboard
from app.models.interaction import UserSavedArticle
from app.models.qa_models import QAExchange
from app.models.article_rich_content import ArticleRichContent
from app.services.ingestion_service import strip_boilerplate
from app.services.content_quality_service import ContentQualityService
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# Sources known to be test/seed data
TEST_SOURCES = {
    'Test Source', 'Tech News', 'AI Weekly', 'Finance Premium',
    'Tech Daily', 'Consumer Monthly', 'Tech Health',
    'Healthcare News', 'Finance News', 'Energy News',
}

# Title patterns for test/seed data
TEST_TITLE_PATTERNS = [
    'Test Article', 'Technology Article', 'Regular Tech',
    'Essential AI', 'Paywalled Finance',
]

# Error page title patterns
ERROR_TITLE_PATTERNS = [
    '403', 'forbidden', 'access denied', 'access to this page',
    'just a moment', 'cloudflare', 'blocked',
]


def is_test_article(article: Article) -> bool:
    title = (article.title or '').strip()
    source = (article.source or '').strip()
    if source in TEST_SOURCES:
        return True
    if any(p in title for p in TEST_TITLE_PATTERNS):
        return True
    return False


def is_error_page(article: Article) -> bool:
    title = (article.title or '').lower().strip()
    if not title:
        return True  # No title = failed scrape
    return any(p in title for p in ERROR_TITLE_PATTERNS)


def reclean_articles(dry_run: bool = False):
    db: Session = SessionLocal()
    quality_service = ContentQualityService.get_instance()

    stats = {
        'total': 0,
        'deleted_test': 0,
        'deleted_error': 0,
        'deleted_no_text': 0,
        'cleaned': 0,
        'score_dropped': 0,
        'flagged_thin': 0,
        'unchanged': 0,
    }

    try:
        all_articles = db.query(Article).all()
        stats['total'] = len(all_articles)
        logger.info(f"Processing {stats['total']} articles...")

        to_delete = []
        to_update = []

        for article in all_articles:
            # 3A: Delete junk
            if is_test_article(article):
                to_delete.append(('test', article))
                stats['deleted_test'] += 1
                continue

            if is_error_page(article):
                to_delete.append(('error', article))
                stats['deleted_error'] += 1
                continue

            raw_text = article.raw_text or ''
            if not raw_text.strip():
                to_delete.append(('no_text', article))
                stats['deleted_no_text'] += 1
                continue

            # 3B: Re-clean content with strip_boilerplate
            cleaned = strip_boilerplate(raw_text)
            changed = cleaned != raw_text

            if changed:
                word_count = len(cleaned.split())
                stats['cleaned'] += 1

                # Recompute quality score
                tier = article.ingestion_tier or 'tier3_discovery'
                passed, new_score, reason = quality_service.assess_post_scrape(
                    cleaned, None, tier
                )

                old_score = article.quality_score or 0.0
                if not passed:
                    stats['score_dropped'] += 1
                    logger.info(
                        f"  DROPPED: {(article.title or '')[:60]} "
                        f"({article.source}) score {old_score:.2f} -> {new_score:.2f} ({reason})"
                    )

                # 3C: Flag thin articles
                if word_count < 200:
                    stats['flagged_thin'] += 1
                    logger.info(
                        f"  THIN: {(article.title or '')[:60]} "
                        f"({article.source}) {word_count} words after cleaning"
                    )

                to_update.append((article, cleaned, new_score, word_count))
            else:
                stats['unchanged'] += 1

        # Execute changes
        if dry_run:
            logger.info("\n--- DRY RUN (no changes made) ---")
        else:
            # Delete junk
            delete_ids = [a.id for _, a in to_delete]
            if delete_ids:
                # Delete all dependent records first
                db.query(StoryboardArticle).filter(StoryboardArticle.article_id.in_(delete_ids)).delete(synchronize_session=False)
                db.query(ExpertNote).filter(ExpertNote.article_id.in_(delete_ids)).delete(synchronize_session=False)
                db.query(UserSavedArticle).filter(UserSavedArticle.article_id.in_(delete_ids)).delete(synchronize_session=False)
                db.query(QAExchange).filter(QAExchange.article_id.in_(delete_ids)).delete(synchronize_session=False)
                db.query(ArticleAnnotation).filter(ArticleAnnotation.article_id.in_(delete_ids)).delete(synchronize_session=False)
                db.query(ArticleRichContent).filter(ArticleRichContent.article_id.in_(delete_ids)).delete(synchronize_session=False)
                # Also remove storyboards that reference deleted articles as headlines
                db.query(Storyboard).filter(Storyboard.headline_article_id.in_(delete_ids)).delete(synchronize_session=False)
                # Now delete the articles
                db.query(Article).filter(Article.id.in_(delete_ids)).delete(synchronize_session=False)

            # Update cleaned articles
            for article, cleaned, new_score, word_count in to_update:
                article.raw_text = cleaned
                article.quality_score = new_score
                article.word_count = word_count

            db.commit()
            logger.info("\n--- Changes committed ---")

        # Print summary
        logger.info(f"\n{'='*50}")
        logger.info(f"CLEANUP SUMMARY")
        logger.info(f"{'='*50}")
        logger.info(f"Total articles:      {stats['total']}")
        logger.info(f"Deleted (test/seed): {stats['deleted_test']}")
        logger.info(f"Deleted (error pg):  {stats['deleted_error']}")
        logger.info(f"Deleted (no text):   {stats['deleted_no_text']}")
        logger.info(f"Cleaned:             {stats['cleaned']}")
        logger.info(f"Score dropped:       {stats['score_dropped']}")
        logger.info(f"Flagged thin (<200): {stats['flagged_thin']}")
        logger.info(f"Unchanged:           {stats['unchanged']}")
        remaining = stats['total'] - stats['deleted_test'] - stats['deleted_error'] - stats['deleted_no_text']
        logger.info(f"Remaining articles:  {remaining}")

    except Exception as e:
        logger.error(f"Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    reclean_articles(dry_run=dry_run)
