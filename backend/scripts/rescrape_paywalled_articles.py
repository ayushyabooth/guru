"""
Re-scrape articles marked as paywalled with improved scraping logic
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


def rescrape_paywalled_articles():
    """
    Re-scrape articles marked as paywalled with improved detection logic
    """
    db: Session = SessionLocal()
    
    try:
        # Find articles marked as paywalled
        paywalled_articles = db.query(Article).filter(
            Article.is_paywalled == True
        ).all()
        
        logger.info(f"Found {len(paywalled_articles)} articles marked as paywalled")
        
        scraped_count = 0
        still_paywalled = 0
        bot_blocked = 0
        failed_count = 0
        
        for article in paywalled_articles:
            if not article.url:
                continue
                
            title = article.title if article.title else 'Untitled'
            logger.info(f"Re-scraping: {title[:60]}... ({article.url})")
            
            try:
                # Re-scrape the article with improved logic
                ingestion_data = ingest_url(article.url)
                
                if not ingestion_data:
                    logger.error(f"No data returned for {article.url}")
                    failed_count += 1
                    continue
                
                # Update article with new scraping results
                if ingestion_data.get('raw_text') and ingestion_data.get('word_count', 0) > 100:
                    article.raw_text = ingestion_data['raw_text']
                    article.word_count = ingestion_data.get('word_count', 0)
                    article.is_paywalled = False  # Successfully scraped, not paywalled
                    
                    # Update title if we got a better one
                    if ingestion_data.get('title') and ingestion_data['title'] != 'Untitled':
                        article.title = ingestion_data['title']
                    
                    # Update publish date if we got one
                    if ingestion_data.get('publish_date'):
                        article.publish_date = ingestion_data['publish_date']
                    
                    db.commit()
                    scraped_count += 1
                    logger.info(f"✅ Successfully scraped: {title[:50]}... ({article.word_count} words)")
                    
                elif ingestion_data.get('error') and '403' in str(ingestion_data.get('error')):
                    # Bot blocking, not necessarily paywalled
                    bot_blocked += 1
                    logger.warning(f"🤖 Bot blocked: {title[:50]}...")
                    
                elif ingestion_data.get('is_paywalled'):
                    # Still paywalled after re-check
                    still_paywalled += 1
                    logger.warning(f"🔒 Still paywalled: {title[:50]}...")
                    
                else:
                    failed_count += 1
                    error_msg = ingestion_data.get('error', 'Unknown error')
                    logger.error(f"❌ Failed: {title[:50]}... - {error_msg}")
                    
            except Exception as e:
                failed_count += 1
                logger.error(f"❌ Error re-scraping {article.url}: {e}")
                continue
        
        logger.info("\n" + "="*60)
        logger.info("RE-SCRAPING SUMMARY")
        logger.info("="*60)
        logger.info(f"Total articles re-processed: {len(paywalled_articles)}")
        logger.info(f"✅ Successfully scraped (now have content): {scraped_count}")
        logger.info(f"🤖 Bot blocked (403 errors): {bot_blocked}")
        logger.info(f"🔒 Still paywalled: {still_paywalled}")
        logger.info(f"❌ Failed: {failed_count}")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"Error in re-scraping process: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting article re-scraping process with improved logic...")
    rescrape_paywalled_articles()
    logger.info("Re-scraping process complete!")
