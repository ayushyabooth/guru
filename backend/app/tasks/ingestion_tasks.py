"""
Celery tasks for background article ingestion and processing
"""
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
from app.services.industries_config import IndustriesConfig
from app.services.content_quality_service import ContentQualityService

logger = logging.getLogger(__name__)

# Create a session factory for background tasks
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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
            ingestion_tier=ingestion_tier,
            quality_score=quality_score,
            luminary_id=article_data.get('luminary_id') if article_data else None,
            discovery_query=article_data.get('discovery_query') if article_data else None,
            industries=[_industry] if _industry else [],
            specializations=_specializations if _specializations else [],
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
        
        # NOTE: Previously called generate_summaries_batch([article_id]) here, but
        # Article has no `summary` column — the Haiku call's result was discarded.
        # Rich content (below) is what actually gets persisted and shown to users.
        # Removing this dead call eliminates one Haiku invocation per ingested article.

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
# def ingest_article_task(self, url: str, notes: str = None, priority: str = "Normal", category: str = "General"):
#     return ingest_article(url, notes, priority, category)
