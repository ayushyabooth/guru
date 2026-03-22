"""
Backfill inline images for articles that are missing them.

This script:
1. Finds all articles with real URLs (not example.com) that have no inline_images
2. Re-fetches the HTML and extracts inline images
3. Updates the database

Run from backend directory:
    python scripts/backfill_inline_images.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
import logging
from app.db.database import SessionLocal
from app.models.article import Article
from app.services.ingestion_service import extract_inline_images

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def backfill_images():
    db = SessionLocal()

    try:
        # Find articles with real URLs that have no inline images
        articles = db.query(Article).filter(
            Article.url.like('http%'),
            ~Article.url.like('%example.com%'),
            (Article.inline_images == None) | (Article.inline_images == [])
        ).all()

        logger.info(f"Found {len(articles)} articles to process")

        updated = 0
        failed = 0
        skipped = 0

        for article in articles:
            try:
                logger.info(f"Processing: {article.url[:60]}...")

                # Fetch the page
                headers = {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                }

                response = requests.get(article.url, headers=headers, timeout=15)

                if response.status_code != 200:
                    logger.warning(f"  HTTP {response.status_code} - skipping")
                    skipped += 1
                    continue

                # Check for bot blocking pages
                if 'just a moment' in response.text.lower() or 'cloudflare' in response.text.lower()[:2000]:
                    logger.warning(f"  Bot blocking detected - skipping")
                    skipped += 1
                    continue

                # Extract images
                images = extract_inline_images(response.text, article.url)

                if images:
                    article.inline_images = images
                    db.commit()
                    logger.info(f"  ✓ Found {len(images)} images")
                    updated += 1
                else:
                    logger.info(f"  No images found")
                    skipped += 1

            except requests.exceptions.Timeout:
                logger.warning(f"  Timeout - skipping")
                skipped += 1
            except requests.exceptions.RequestException as e:
                logger.warning(f"  Request error: {e}")
                failed += 1
            except Exception as e:
                logger.error(f"  Error: {e}")
                failed += 1

        logger.info(f"\n{'='*60}")
        logger.info(f"SUMMARY:")
        logger.info(f"  Updated: {updated}")
        logger.info(f"  Skipped: {skipped}")
        logger.info(f"  Failed:  {failed}")
        logger.info(f"  Total:   {len(articles)}")

    finally:
        db.close()


if __name__ == '__main__':
    backfill_images()
