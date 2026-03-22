"""
Celery tasks for background article ingestion and processing
"""
import asyncio
import os
import uuid
from datetime import datetime
from typing import List, Dict
import logging

# Note: Celery setup would be configured separately in production
# For now, we'll create the task structure without actual Celery decorators

from sqlalchemy.orm import sessionmaker
from app.db.database import engine
from app.services.ingestion_service import ingest_url
from app.services.image_scraping_service import ImageScrapingService
from app.services.rich_summary_service import RichSummaryService
from app.models.article import Article, ExpertNote
from app.models.ingestion import IngestionStatus
from app.services.csv_ingestion_service import parse_expert_links_csv
from app.services.ingestion_state_service import IngestionStateService
from app.services.markdown_ingestion_service import (
    parse_expert_links_md_with_state,
    get_expert_links_filepath
)
from app.services.industries_config import IndustriesConfig
from app.services.content_quality_service import ContentQualityService

logger = logging.getLogger(__name__)

# Create a session factory for background tasks
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def load_expert_links_from_md(filepath: str = "auto") -> Dict:
    """
    Load expert links from markdown file and queue ingestion tasks.

    Args:
        filepath: Path to expert-links.md file, or "auto" to auto-detect latest

    Returns:
        Dictionary with processing results
    """
    result = {
        'processed': 0,
        'skipped': 0,
        'errors': 0,
        'queued_for_ingestion': 0,
        'file_used': None
    }

    # Auto-detect the file path
    try:
        actual_filepath = get_expert_links_filepath(filepath)
        result['file_used'] = actual_filepath
    except FileNotFoundError as e:
        logger.warning(str(e))
        return result

    if not os.path.exists(actual_filepath):
        logger.warning(f"Expert links file not found: {actual_filepath}")
        return result

    filepath = actual_filepath  # Use the resolved path
    
    # Parse the CSV file
    articles = parse_expert_links_csv(filepath)
    logger.info(f"Found {len(articles)} articles in {filepath}")
    
    db = SessionLocal()
    try:
        for article_data in articles:
            url = article_data['url']
            result['processed'] += 1
            
            # Check if article already exists
            existing_article = db.query(Article).filter(Article.url == url).first()
            if existing_article:
                logger.debug(f"Article already exists, skipping: {url}")
                result['skipped'] += 1
                continue
            
            # Queue ingestion task
            try:
                ingest_article(
                    url=url,
                    notes=article_data.get('notes'),
                    priority=article_data.get('priority', 'Normal'),
                    category=article_data.get('category', 'General'),
                    article_data=article_data
                )
                result['queued_for_ingestion'] += 1
                logger.info(f"Queued article for ingestion: {url}")
                
            except Exception as e:
                logger.error(f"Error queuing article {url}: {e}")
                result['errors'] += 1
    
    finally:
        db.close()
    
    logger.info(f"Expert links processing complete: {result}")
    return result


def _get_expiration_settings() -> tuple:
    """
    Get expiration settings from config.

    Returns:
        Tuple of (expiration_days, auto_cleanup_enabled)
    """
    try:
        from app.services.industries_config import IndustriesConfig
        config = IndustriesConfig.get_instance()
        settings = config._config.get("settings", {})
        expiration_days = settings.get("article_expiration_days", 30)
        auto_cleanup = settings.get("auto_cleanup_on_startup", True)
        return expiration_days, auto_cleanup
    except Exception as e:
        logger.warning(f"Could not load expiration settings, using defaults: {e}")
        return 30, True


def cleanup_expired_articles(db, expiration_days: int = None) -> Dict:
    """
    Delete articles older than the expiration period.

    Args:
        db: Database session
        expiration_days: Number of days after which articles expire.
                        If None, reads from config.

    Returns:
        Dictionary with cleanup results
    """
    from datetime import timedelta

    if expiration_days is None:
        expiration_days, _ = _get_expiration_settings()

    result = {
        'deleted_articles': 0,
        'deleted_notes': 0,
        'deleted_rich_content': 0,
        'expiration_days': expiration_days
    }

    try:
        cutoff_date = datetime.now() - timedelta(days=expiration_days)

        # Find expired articles
        expired_articles = db.query(Article).filter(
            Article.created_at < cutoff_date
        ).all()

        if not expired_articles:
            logger.info(f"No expired articles found (older than {expiration_days} days)")
            return result

        logger.info(f"🗑️ Found {len(expired_articles)} expired articles (older than {expiration_days} days)")

        for article in expired_articles:
            try:
                # Delete associated expert notes
                deleted_notes = db.query(ExpertNote).filter(
                    ExpertNote.article_id == article.id
                ).delete()
                result['deleted_notes'] += deleted_notes

                # Delete associated rich content
                from app.models.article_rich_content import ArticleRichContent
                deleted_rich = db.query(ArticleRichContent).filter(
                    ArticleRichContent.article_id == article.id
                ).delete()
                result['deleted_rich_content'] += deleted_rich

                # Delete the article
                db.delete(article)
                result['deleted_articles'] += 1

                logger.debug(f"Deleted expired article: {article.title[:50]}...")

            except Exception as e:
                logger.error(f"Error deleting article {article.id}: {e}")
                continue

        db.commit()
        logger.info(f"✅ Cleaned up {result['deleted_articles']} expired articles, "
                   f"{result['deleted_notes']} notes, {result['deleted_rich_content']} rich content entries")

    except Exception as e:
        db.rollback()
        logger.error(f"Error during expired article cleanup: {e}")

    return result


def find_new_urls_in_file(filepath: str, db) -> List[str]:
    """
    Find URLs in the file that don't exist in the database.

    Args:
        filepath: Path to the expert links file
        db: Database session

    Returns:
        List of new URLs not yet in database
    """
    from app.services.csv_ingestion_service import parse_expert_links_csv

    try:
        articles = parse_expert_links_csv(filepath)
        file_urls = {article['url'] for article in articles}

        # Get all existing URLs from database
        existing_urls = {row[0] for row in db.query(Article.url).all()}

        # Find URLs that are in file but not in database
        new_urls = file_urls - existing_urls

        return list(new_urls)

    except Exception as e:
        logger.error(f"Error finding new URLs: {e}")
        return []


async def smart_ingest_expert_links(filepath: str = "auto") -> Dict:
    """
    Truly smart ingestion that:
    1. Checks for new URLs in the file (not just file hash)
    2. Ingests only new articles
    3. Auto-deletes expired articles based on config

    This runs on every startup and will:
    - Skip if no new URLs are found
    - Ingest only new URLs if some are missing from DB
    - Clean up expired articles based on article_expiration_days config

    Args:
        filepath: Path to the expert-links.md file, or "auto" to auto-detect latest

    Returns:
        Dictionary with ingestion results and timing information
    """
    import time
    start_time = time.time()

    result = {
        'status': 'success',
        'action': 'unknown',
        'duration_seconds': 0,
        'total_created': 0,
        'total_updated': 0,
        'total_skipped': 0,
        'total_expired_deleted': 0,
        'errors': 0,
        'message': ''
    }

    db = SessionLocal()

    try:
        logger.info(f"🔍 Starting smart ingestion check for {filepath}")

        # Step 1: Clean up expired articles first
        expiration_days, auto_cleanup = _get_expiration_settings()
        if auto_cleanup:
            logger.info(f"🗑️ Checking for expired articles (older than {expiration_days} days)...")
            cleanup_result = cleanup_expired_articles(db, expiration_days)
            result['total_expired_deleted'] = cleanup_result['deleted_articles']
            if cleanup_result['deleted_articles'] > 0:
                logger.info(f"✅ Cleaned up {cleanup_result['deleted_articles']} expired articles")

        # Step 2: Check for new URLs in the file (not just file hash)
        new_urls = find_new_urls_in_file(filepath, db)

        if not new_urls:
            # No new URLs found - nothing to ingest
            total_in_db = db.query(Article).count()
            result.update({
                'action': 'skipped',
                'message': f'No new articles to ingest. {total_in_db} articles already in database.',
                'total_skipped': total_in_db
            })
            logger.info(f"✅ No new articles found - {total_in_db} articles already ingested")
            return result

        # New URLs found - proceed with ingestion
        logger.info(f"📰 Found {len(new_urls)} new articles to ingest")

        # Create new ingestion state
        ingestion_state = IngestionStateService.create_ingestion_state(filepath, db)

        # Update state to in_progress
        IngestionStateService.update_ingestion_state(
            str(ingestion_state.id),
            IngestionStatus.IN_PROGRESS,
            db=db
        )

        try:
            # Parse and ingest with state tracking
            # This will automatically skip existing articles
            ingestion_result = parse_expert_links_md_with_state(
                filepath,
                str(ingestion_state.id),
                db
            )

            # Update result
            result.update({
                'action': 'ingested',
                'total_created': ingestion_result['created'],
                'total_updated': ingestion_result['updated'],
                'total_skipped': ingestion_result['skipped'],
                'errors': ingestion_result['errors'],
                'message': f"Ingested {ingestion_result['created']} new articles, skipped {ingestion_result['skipped']} existing"
            })

            if result['total_expired_deleted'] > 0:
                result['message'] += f", deleted {result['total_expired_deleted']} expired"

            # Update state to completed
            total_articles = ingestion_result['created'] + ingestion_result['updated']
            IngestionStateService.update_ingestion_state(
                str(ingestion_state.id),
                IngestionStatus.COMPLETED,
                total_articles=total_articles,
                db=db
            )

            logger.info(f"✅ Smart ingestion completed: {result['message']}")

        except Exception as e:
            # Update state to failed
            error_msg = str(e)
            IngestionStateService.update_ingestion_state(
                str(ingestion_state.id),
                IngestionStatus.FAILED,
                error_message=error_msg,
                db=db
            )

            result.update({
                'status': 'failed',
                'action': 'failed',
                'message': f'Ingestion failed: {error_msg}',
                'errors': 1
            })

            logger.error(f"❌ Smart ingestion failed: {error_msg}")
            raise

    except Exception as e:
        result.update({
            'status': 'failed',
            'action': 'failed',
            'message': f'Smart ingestion error: {str(e)}',
            'errors': 1
        })
        logger.error(f"❌ Smart ingestion error: {e}")

    finally:
        result['duration_seconds'] = round(time.time() - start_time, 2)
        db.close()

    return result


def ingest_article(url: str, notes: str = None, priority: str = "Normal", category: str = "General", article_data: Dict = None, ingestion_tier: str = None) -> Dict:
    """
    Ingest a single article from URL and create database records

    Args:
        url: Article URL to ingest
        notes: Expert notes about the article
        priority: Priority level (Normal, High, Essential)
        category: Article category
        ingestion_tier: Tier tag ('tier1_expert', 'tier2_luminary', 'tier3_discovery')

    Returns:
        Dictionary with ingestion results
    """
    result = {
        'success': False,
        'article_id': None,
        'error': None,
        'is_paywalled': False,
        'word_count': 0
    }
    
    db = SessionLocal()
    try:
        # Check if article already exists
        existing_article = db.query(Article).filter(Article.url == url).first()
        if existing_article:
            result['error'] = "Article already exists"
            result['article_id'] = str(existing_article.id)
            return result
        
        # Fetch and process the URL
        logger.info(f"Ingesting article: {url}")
        ingestion_data = ingest_url(url)
        
        if ingestion_data.get('error'):
            result['error'] = ingestion_data['error']
            return result
        
        # Scrape image from article URL (P0 Phase 3)
        image_url = None
        image_source = None
        try:
            image_service = ImageScrapingService()
            image_url = image_service.scrape_image_url(url)
            if image_url:
                image_source = 'scraped'
                logger.info(f"Scraped image for {url}: {image_url}")
            else:
                logger.info(f"No image found for {url}")
        except Exception as e:
            logger.error(f"Image scraping error for {url}: {e}")
        
        # ── Quality scoring ───────────────────────────────────────────
        quality_score = None
        is_paywalled = ingestion_data.get('is_paywalled', False)
        raw_text = ingestion_data.get('raw_text', '')
        word_count = ingestion_data.get('word_count', 0)

        try:
            quality_service = ContentQualityService.get_instance()
            tier_for_scoring = ingestion_tier or 'tier2_luminary'

            if is_paywalled:
                # Paywalled articles get a floor score (kept for visibility)
                quality_score = 0.40
            elif raw_text and word_count > 0:
                passed, score, reason = quality_service.assess_post_scrape(
                    text=raw_text,
                    html=None,
                    tier=tier_for_scoring,
                )
                if passed:
                    quality_score = score
                else:
                    logger.info(f"Quality gate rejected {url}: {reason} (score={score:.3f})")
                    result['error'] = f"Quality rejected: {reason}"
                    return result
        except Exception as e:
            logger.warning(f"Quality scoring failed for {url}, continuing without score: {e}")

        # ── Create Article record ────────────────────────────────────
        article_id = uuid.uuid4()

        # Extract industry/specialization tags from article_data
        _defaults = IndustriesConfig.get_instance().get_defaults()
        _raw_industry = article_data.get('industry', _defaults['industry_name']) if article_data else _defaults['industry_name']
        _industry = IndustriesConfig.get_instance().normalize_industry_name(_raw_industry)
        _specializations = article_data.get('specializations', [_defaults['specialization_name']]) if article_data else [_defaults['specialization_name']]

        new_article = Article(
            id=article_id,
            url=url,
            title=ingestion_data.get('title'),
            source=ingestion_data.get('source'),
            publish_date=ingestion_data.get('publish_date'),
            raw_text=raw_text,
            word_count=word_count,
            is_paywalled=is_paywalled,
            article_image_url=image_url,
            scrape_attempted=True,
            image_source=image_source,
            inline_images=ingestion_data.get('inline_images', []),
            industries=[_industry],
            specializations=_specializations,
            ingestion_tier=ingestion_tier,
            quality_score=quality_score,
            luminary_id=article_data.get('luminary_id') if article_data else None,
            discovery_query=article_data.get('discovery_query') if article_data else None,
        )

        db.add(new_article)
        db.commit()
        db.refresh(new_article)

        # Create ExpertNote if notes provided
        if notes:
            expert_id = uuid.uuid4()  # Placeholder - should be actual expert ID

            # Extract industry and specializations from article_data, normalize casing
            defaults = IndustriesConfig.get_instance().get_defaults()
            raw_industry = article_data.get('industry', defaults['industry_name']) if article_data else defaults['industry_name']
            specializations = article_data.get('specializations', [defaults['specialization_name']]) if article_data else [defaults['specialization_name']]

            # Normalize industry name to canonical casing from IndustriesConfig
            industry = IndustriesConfig.get_instance().normalize_industry_name(raw_industry)

            expert_note = ExpertNote(
                expert_id=expert_id,
                article_id=article_id,
                notes_text=notes,
                priority=priority,
                expert_industry=industry,
                expert_specializations=specializations
            )

            db.add(expert_note)
            db.commit()
        
        # Queue summary generation for the new article
        try:
            from app.tasks.summary_tasks import generate_summaries_batch
            # In production, this would be: generate_summaries_batch.delay([article_id])
            generate_summaries_batch([article_id])
            logger.info(f"Queued summary generation for article {article_id}")
        except Exception as e:
            logger.warning(f"Failed to queue summary generation for {article_id}: {e}")
        
        # P1: Generate rich content (4-part summary + Socratic prompts)
        try:
            _defaults = IndustriesConfig.get_instance().get_defaults()
            industry = article_data.get('industry', _defaults['industry_name']) if article_data else _defaults['industry_name']
            specializations = article_data.get('specializations', [_defaults['specialization_name']]) if article_data else [_defaults['specialization_name']]
            specialization = specializations[0] if specializations else 'General'
            
            rich_service = RichSummaryService(db)
            rich_content = rich_service.generate_rich_content(
                article=new_article,
                industry=industry,
                specialization=specialization,
                related_article_titles=None  # Will be populated during storyboard creation
            )
            if rich_content:
                logger.info(f"Generated rich content for article {article_id}")
            else:
                logger.warning(f"Failed to generate rich content for article {article_id}")
        except Exception as e:
            logger.warning(f"Failed to generate rich content for {article_id}: {e}")
        
        result['success'] = True
        result['article_id'] = str(article_id)
        result['is_paywalled'] = ingestion_data.get('is_paywalled', False)
        result['word_count'] = ingestion_data.get('word_count', 0)
        
        logger.info(f"Successfully ingested article {article_id}: {url}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error ingesting article {url}: {e}")
        result['error'] = str(e)
    
    finally:
        db.close()
    
    return result


def generate_article_summary(raw_text: str) -> str:
    """
    Generate a summary of the article content
    
    Args:
        raw_text: Full article text
    
    Returns:
        Generated summary
    """
    # Simple extractive summarization - take first few sentences
    # In production, this would use AI/ML for better summarization
    
    if not raw_text:
        return ""
    
    sentences = raw_text.split('. ')
    
    # Take first 3 sentences or first 200 words, whichever is shorter
    summary_sentences = []
    word_count = 0
    
    for sentence in sentences[:5]:  # Max 5 sentences
        sentence_words = sentence.split()
        if word_count + len(sentence_words) > 200:
            break
        summary_sentences.append(sentence.strip())
        word_count += len(sentence_words)
        
        if len(summary_sentences) >= 3:
            break
    
    summary = '. '.join(summary_sentences)
    if summary and not summary.endswith('.'):
        summary += '.'
    
    return summary


def batch_ingest_articles(urls: List[str], default_category: str = "General") -> Dict:
    """
    Batch ingest multiple articles
    
    Args:
        urls: List of URLs to ingest
        default_category: Default category for articles
    
    Returns:
        Dictionary with batch processing results
    """
    result = {
        'total': len(urls),
        'successful': 0,
        'failed': 0,
        'skipped': 0,
        'errors': []
    }
    
    for url in urls:
        try:
            ingestion_result = ingest_article(url, category=default_category)
            
            if ingestion_result['success']:
                result['successful'] += 1
            elif "already exists" in ingestion_result.get('error', ''):
                result['skipped'] += 1
            else:
                result['failed'] += 1
                result['errors'].append({
                    'url': url,
                    'error': ingestion_result.get('error')
                })
                
        except Exception as e:
            result['failed'] += 1
            result['errors'].append({
                'url': url,
                'error': str(e)
            })
            logger.error(f"Batch ingestion error for {url}: {e}")
    
    logger.info(f"Batch ingestion complete: {result}")
    return result


def cleanup_failed_ingestions(days_old: int = 7) -> Dict:
    """
    Clean up articles that failed to ingest properly
    
    Args:
        days_old: Remove failed ingestions older than this many days
    
    Returns:
        Dictionary with cleanup results
    """
    result = {
        'cleaned_articles': 0,
        'cleaned_notes': 0
    }
    
    db = SessionLocal()
    try:
        # Find articles with no content and older than specified days
        cutoff_date = datetime.now() - timedelta(days=days_old)
        
        failed_articles = db.query(Article).filter(
            Article.raw_text.is_(None),
            Article.is_paywalled == False,
            Article.created_at < cutoff_date
        ).all()
        
        for article in failed_articles:
            # Delete associated expert notes first
            deleted_notes = db.query(ExpertNote).filter(
                ExpertNote.article_id == article.id
            ).delete()
            
            # Delete the article
            db.delete(article)
            
            result['cleaned_articles'] += 1
            result['cleaned_notes'] += deleted_notes
            
            logger.info(f"Cleaned up failed article: {article.url}")
        
        db.commit()
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error during cleanup: {e}")
        
    finally:
        db.close()
    
    logger.info(f"Cleanup complete: {result}")
    return result


# Celery task decorators would be added in production:
# @celery_app.task(bind=True, max_retries=3)
# def load_expert_links_from_md_task(self, filepath: str):
#     return load_expert_links_from_md(filepath)

# @celery_app.task(bind=True, max_retries=3)
# def ingest_article_task(self, url: str, notes: str = None, priority: str = "Normal", category: str = "General"):
#     return ingest_article(url, notes, priority, category)
