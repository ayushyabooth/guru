"""
Script to scrape hero images for existing articles.
Uses og:image, twitter:image, or first valid content image.
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.models.article import Article
from app.services.image_scraping_service import ImageScrapingService
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def scrape_images_for_articles():
    """
    Scrape images for all articles that don't have an image URL yet.
    """
    db: Session = SessionLocal()
    image_service = ImageScrapingService()
    
    try:
        # Find articles without images
        articles_to_scrape = db.query(Article).filter(
            (Article.article_image_url == None) | (Article.article_image_url == '')
        ).all()
        
        logger.info(f"Found {len(articles_to_scrape)} articles without images")
        
        success_count = 0
        failed_count = 0
        
        for i, article in enumerate(articles_to_scrape):
            if not article.url:
                logger.warning(f"Skipping article without URL: {article.id}")
                continue
            
            title_preview = article.title[:50] if article.title else 'Untitled'
            logger.info(f"[{i+1}/{len(articles_to_scrape)}] Scraping image: {title_preview}...")
            
            try:
                # Scrape the image
                image_url = image_service.scrape_image_url(article.url)
                
                if image_url:
                    article.article_image_url = image_url
                    article.scrape_attempted = True
                    article.image_source = 'scraped'
                    db.commit()
                    success_count += 1
                    logger.info(f"  ✅ Found image: {image_url[:80]}...")
                else:
                    article.scrape_attempted = True
                    article.image_source = 'none'
                    db.commit()
                    failed_count += 1
                    logger.info(f"  ⚠️ No valid image found")
                
                # Small delay to be nice to servers
                time.sleep(0.5)
                
            except Exception as e:
                failed_count += 1
                logger.error(f"  ❌ Error scraping {article.url}: {e}")
                continue
        
        logger.info("\n" + "="*60)
        logger.info("IMAGE SCRAPING SUMMARY")
        logger.info("="*60)
        logger.info(f"Total articles processed: {len(articles_to_scrape)}")
        logger.info(f"✅ Images found: {success_count}")
        logger.info(f"⚠️ No image found: {failed_count}")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"Error in scraping process: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting image scraping process...")
    scrape_images_for_articles()
    logger.info("Image scraping complete!")
