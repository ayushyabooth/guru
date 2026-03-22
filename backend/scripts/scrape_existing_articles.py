"""
Script to scrape content for existing articles that don't have raw_text
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.models.article import Article
from app.services.ingestion_service import ingest_url
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def scrape_articles_without_content():
    """
    Scrape and update articles that don't have raw_text content
    """
    db: Session = SessionLocal()
    
    try:
        # Find articles without raw_text or with empty raw_text
        articles_to_scrape = db.query(Article).filter(
            (Article.raw_text == None) | (Article.raw_text == '')
        ).all()
        
        logger.info(f"Found {len(articles_to_scrape)} articles without content")
        
        scraped_count = 0
        failed_count = 0
        paywall_count = 0
        
        for article in articles_to_scrape:
            if not article.url:
                logger.warning(f"Skipping article without URL: {article.title}")
                continue
                
            logger.info(f"Scraping article: {article.title[:50] if article.title else 'Untitled'}... ({article.url})")
            
            try:
                # Scrape the article
                ingestion_data = ingest_url(article.url)
                
                if not ingestion_data:
                    logger.error(f"No data returned for {article.url}")
                    failed_count += 1
                    continue
                
                # Update article with scraped content
                if ingestion_data.get('raw_text'):
                    article.raw_text = ingestion_data['raw_text']
                    article.word_count = ingestion_data.get('word_count', 0)
                    article.is_paywalled = ingestion_data.get('is_paywalled', False)
                    
                    # Update title if we got a better one
                    if ingestion_data.get('title') and ingestion_data['title'] != 'Untitled':
                        article.title = ingestion_data['title']
                    
                    # Update publish date if we got one
                    if ingestion_data.get('publish_date'):
                        article.publish_date = ingestion_data['publish_date']
                    
                    db.commit()
                    scraped_count += 1
                    logger.info(f"✅ Successfully scraped: {article.title[:50]}... ({article.word_count} words)")
                    
                elif ingestion_data.get('is_paywalled'):
                    article.is_paywalled = True
                    db.commit()
                    paywall_count += 1
                    logger.warning(f"🔒 Paywalled: {article.title[:50]}...")
                    
                else:
                    failed_count += 1
                    error_msg = ingestion_data.get('error', 'Unknown error')
                    logger.error(f"❌ Failed to scrape: {article.title[:50]}... - {error_msg}")
                    
            except Exception as e:
                failed_count += 1
                logger.error(f"❌ Error scraping {article.url}: {e}")
                continue
        
        logger.info("\n" + "="*60)
        logger.info("SCRAPING SUMMARY")
        logger.info("="*60)
        logger.info(f"Total articles processed: {len(articles_to_scrape)}")
        logger.info(f"✅ Successfully scraped: {scraped_count}")
        logger.info(f"🔒 Paywalled: {paywall_count}")
        logger.info(f"❌ Failed: {failed_count}")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"Error in scraping process: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting article scraping process...")
    scrape_articles_without_content()
    logger.info("Scraping process complete!")
