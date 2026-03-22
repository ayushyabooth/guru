"""
Celery tasks for batch summary generation and processing
"""
import uuid
from typing import List, Dict
import logging
from datetime import datetime

from sqlalchemy.orm import sessionmaker
from app.db.database import engine
from app.models.article import Article
from app.services.summary_service import (
    generate_article_summary, generate_article_questions,
    analyze_article_sentiment, extract_article_topics
)

logger = logging.getLogger(__name__)

# Create a session factory for background tasks
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def generate_summaries_batch(article_ids: List[uuid.UUID]) -> Dict:
    """
    Generate summaries for a batch of articles
    
    Args:
        article_ids: List of article UUIDs to process
    
    Returns:
        Dictionary with batch processing results
    """
    result = {
        'total': len(article_ids),
        'successful': 0,
        'failed': 0,
        'errors': [],
        'processing_time': None
    }
    
    start_time = datetime.now()
    
    db = SessionLocal()
    try:
        for article_id in article_ids:
            try:
                logger.info(f"Processing summary for article {article_id}")
                
                # Generate summary
                summary_result = generate_article_summary(article_id, db=db)
                
                if summary_result['success']:
                    # Update article with summary (if we had a summary field)
                    # For now, we'll just log the success
                    result['successful'] += 1
                    logger.info(f"Successfully generated summary for article {article_id}")
                else:
                    result['failed'] += 1
                    result['errors'].append({
                        'article_id': str(article_id),
                        'error': summary_result.get('error', 'Unknown error')
                    })
                    logger.error(f"Failed to generate summary for article {article_id}: {summary_result.get('error')}")
                
            except Exception as e:
                result['failed'] += 1
                result['errors'].append({
                    'article_id': str(article_id),
                    'error': str(e)
                })
                logger.error(f"Exception processing article {article_id}: {e}")
    
    finally:
        db.close()
    
    end_time = datetime.now()
    result['processing_time'] = (end_time - start_time).total_seconds()
    
    logger.info(f"Batch summary generation complete: {result}")
    return result


def generate_questions_batch(article_ids: List[uuid.UUID], questions_per_article: int = 3) -> Dict:
    """
    Generate questions for a batch of articles
    
    Args:
        article_ids: List of article UUIDs to process
        questions_per_article: Number of questions to generate per article
    
    Returns:
        Dictionary with batch processing results
    """
    result = {
        'total': len(article_ids),
        'successful': 0,
        'failed': 0,
        'total_questions': 0,
        'errors': []
    }
    
    db = SessionLocal()
    try:
        for article_id in article_ids:
            try:
                logger.info(f"Generating questions for article {article_id}")
                
                questions_result = generate_article_questions(
                    article_id, 
                    count=questions_per_article, 
                    db=db
                )
                
                if questions_result['success']:
                    result['successful'] += 1
                    result['total_questions'] += len(questions_result['questions'])
                    logger.info(f"Generated {len(questions_result['questions'])} questions for article {article_id}")
                else:
                    result['failed'] += 1
                    result['errors'].append({
                        'article_id': str(article_id),
                        'error': questions_result.get('error', 'Unknown error')
                    })
                
            except Exception as e:
                result['failed'] += 1
                result['errors'].append({
                    'article_id': str(article_id),
                    'error': str(e)
                })
                logger.error(f"Exception generating questions for article {article_id}: {e}")
    
    finally:
        db.close()
    
    logger.info(f"Batch question generation complete: {result}")
    return result


def analyze_sentiment_batch(article_ids: List[uuid.UUID]) -> Dict:
    """
    Analyze sentiment for a batch of articles
    
    Args:
        article_ids: List of article UUIDs to process
    
    Returns:
        Dictionary with batch processing results
    """
    result = {
        'total': len(article_ids),
        'successful': 0,
        'failed': 0,
        'sentiment_distribution': {},
        'errors': []
    }
    
    db = SessionLocal()
    try:
        for article_id in article_ids:
            try:
                logger.info(f"Analyzing sentiment for article {article_id}")
                
                sentiment_result = analyze_article_sentiment(article_id, db=db)
                
                if sentiment_result['success']:
                    result['successful'] += 1
                    sentiment = sentiment_result['sentiment']
                    
                    # Track sentiment distribution
                    if sentiment in result['sentiment_distribution']:
                        result['sentiment_distribution'][sentiment] += 1
                    else:
                        result['sentiment_distribution'][sentiment] = 1
                    
                    logger.info(f"Analyzed sentiment for article {article_id}: {sentiment}")
                else:
                    result['failed'] += 1
                    result['errors'].append({
                        'article_id': str(article_id),
                        'error': sentiment_result.get('error', 'Unknown error')
                    })
                
            except Exception as e:
                result['failed'] += 1
                result['errors'].append({
                    'article_id': str(article_id),
                    'error': str(e)
                })
                logger.error(f"Exception analyzing sentiment for article {article_id}: {e}")
    
    finally:
        db.close()
    
    logger.info(f"Batch sentiment analysis complete: {result}")
    return result


def extract_topics_batch(article_ids: List[uuid.UUID], max_topics_per_article: int = 5) -> Dict:
    """
    Extract topics for a batch of articles
    
    Args:
        article_ids: List of article UUIDs to process
        max_topics_per_article: Maximum topics to extract per article
    
    Returns:
        Dictionary with batch processing results
    """
    result = {
        'total': len(article_ids),
        'successful': 0,
        'failed': 0,
        'all_topics': [],
        'topic_frequency': {},
        'errors': []
    }
    
    db = SessionLocal()
    try:
        for article_id in article_ids:
            try:
                logger.info(f"Extracting topics for article {article_id}")
                
                topics_result = extract_article_topics(
                    article_id, 
                    max_topics=max_topics_per_article, 
                    db=db
                )
                
                if topics_result['success']:
                    result['successful'] += 1
                    topics = topics_result['topics']
                    result['all_topics'].extend(topics)
                    
                    # Track topic frequency
                    for topic in topics:
                        topic_lower = topic.lower()
                        if topic_lower in result['topic_frequency']:
                            result['topic_frequency'][topic_lower] += 1
                        else:
                            result['topic_frequency'][topic_lower] = 1
                    
                    logger.info(f"Extracted {len(topics)} topics for article {article_id}")
                else:
                    result['failed'] += 1
                    result['errors'].append({
                        'article_id': str(article_id),
                        'error': topics_result.get('error', 'Unknown error')
                    })
                
            except Exception as e:
                result['failed'] += 1
                result['errors'].append({
                    'article_id': str(article_id),
                    'error': str(e)
                })
                logger.error(f"Exception extracting topics for article {article_id}: {e}")
    
    finally:
        db.close()
    
    logger.info(f"Batch topic extraction complete: {result}")
    return result


def process_new_articles_full_analysis(article_ids: List[uuid.UUID]) -> Dict:
    """
    Run full Claude analysis on new articles (summary, questions, sentiment, topics)
    
    Args:
        article_ids: List of article UUIDs to process
    
    Returns:
        Dictionary with comprehensive processing results
    """
    result = {
        'total': len(article_ids),
        'summary_results': {},
        'questions_results': {},
        'sentiment_results': {},
        'topics_results': {},
        'overall_success': 0,
        'overall_failed': 0
    }
    
    logger.info(f"Starting full analysis for {len(article_ids)} articles")
    
    # Run all analysis tasks
    try:
        # Generate summaries
        logger.info("Generating summaries...")
        result['summary_results'] = generate_summaries_batch(article_ids)
        
        # Generate questions
        logger.info("Generating questions...")
        result['questions_results'] = generate_questions_batch(article_ids)
        
        # Analyze sentiment
        logger.info("Analyzing sentiment...")
        result['sentiment_results'] = analyze_sentiment_batch(article_ids)
        
        # Extract topics
        logger.info("Extracting topics...")
        result['topics_results'] = extract_topics_batch(article_ids)
        
        # Calculate overall success rate
        total_tasks = 4 * len(article_ids)  # 4 tasks per article
        successful_tasks = (
            result['summary_results']['successful'] +
            result['questions_results']['successful'] +
            result['sentiment_results']['successful'] +
            result['topics_results']['successful']
        )
        
        result['overall_success'] = successful_tasks
        result['overall_failed'] = total_tasks - successful_tasks
        
        logger.info(f"Full analysis complete: {successful_tasks}/{total_tasks} tasks successful")
        
    except Exception as e:
        logger.error(f"Error in full analysis processing: {e}")
        result['error'] = str(e)
    
    return result


def cleanup_old_analysis_data(days_old: int = 30) -> Dict:
    """
    Clean up old analysis data (placeholder for future implementation)
    
    Args:
        days_old: Remove analysis data older than this many days
    
    Returns:
        Dictionary with cleanup results
    """
    result = {
        'cleaned_summaries': 0,
        'cleaned_questions': 0,
        'cleaned_analysis': 0
    }
    
    # This would be implemented when we have persistent storage for analysis results
    logger.info(f"Cleanup task completed: {result}")
    return result


# Celery task decorators would be added in production:
# @celery_app.task(bind=True, max_retries=3)
# def generate_summaries_batch_task(self, article_ids: List[str]):
#     article_uuids = [uuid.UUID(aid) for aid in article_ids]
#     return generate_summaries_batch(article_uuids)

# @celery_app.task(bind=True, max_retries=2)
# def process_new_articles_full_analysis_task(self, article_ids: List[str]):
#     article_uuids = [uuid.UUID(aid) for aid in article_ids]
#     return process_new_articles_full_analysis(article_uuids)
