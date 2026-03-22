"""
Markdown-based content ingestion service for parsing expert-links.md files
"""
import re
import os
import glob
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from sqlalchemy.orm import Session
import logging
from urllib.parse import urlparse

from app.models.article import Article, ExpertNote
from app.services.ingestion_state_service import IngestionStateService
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)

# Default directory for expert links files
# Configurable via EXPERT_LINKS_DIR env var (set on Railway to /app/data/expert-links)
# Falls back to local path relative to backend
def _get_expert_links_dir() -> str:
    from app.config import settings
    if settings.EXPERT_LINKS_DIR:
        return settings.EXPERT_LINKS_DIR
    # In production (Docker), use /app/data/expert-links
    if settings.APP_ENV == "production" or os.path.exists("/app/data/expert-links"):
        return "/app/data/expert-links"
    # Local dev: relative to backend directory
    return os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "expert-links")
    )

EXPERT_LINKS_DIR = _get_expert_links_dir()


def find_latest_expert_links_file(directory: str = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Find the most recent expert links file in the specified directory.

    Files are expected to be named: Expert_Links_YYYY-MM-DD.md

    Args:
        directory: Directory to search in. Defaults to EXPERT_LINKS_DIR.

    Returns:
        Tuple of (filepath, date_string) or (None, None) if no file found.
    """
    if directory is None:
        directory = EXPERT_LINKS_DIR

    # Normalize the directory path
    directory = os.path.normpath(os.path.abspath(directory))

    if not os.path.exists(directory):
        logger.warning(f"Expert links directory not found: {directory}")
        return None, None

    if not os.path.isdir(directory):
        logger.warning(f"Path is not a directory: {directory}")
        return None, None

    # Find all matching files
    pattern = os.path.join(directory, "Expert_Links_*.md")
    files = glob.glob(pattern)

    if not files:
        # Try case-insensitive pattern
        pattern_lower = os.path.join(directory, "expert_links_*.md")
        files = glob.glob(pattern_lower)

    if not files:
        logger.warning(f"No Expert_Links_*.md files found in {directory}")
        return None, None

    # Extract dates from filenames and sort
    date_pattern = re.compile(r'Expert_Links_(\d{4}-\d{2}-\d{2})\.md$', re.IGNORECASE)
    dated_files = []

    for filepath in files:
        filename = os.path.basename(filepath)
        match = date_pattern.search(filename)
        if match:
            date_str = match.group(1)
            try:
                date_obj = datetime.strptime(date_str, '%Y-%m-%d')
                dated_files.append((filepath, date_str, date_obj))
            except ValueError:
                logger.warning(f"Invalid date format in filename: {filename}")
                continue

    if not dated_files:
        logger.warning(f"No files with valid date pattern found in {directory}")
        return None, None

    # Sort by date (newest first) and return the latest
    dated_files.sort(key=lambda x: x[2], reverse=True)
    latest_file, latest_date, _ = dated_files[0]

    logger.info(f"📂 Found latest expert links file: {os.path.basename(latest_file)} (date: {latest_date})")
    return latest_file, latest_date


def get_expert_links_filepath(filepath: str = None) -> str:
    """
    Get the filepath to use for expert links ingestion.

    If a specific filepath is provided, use it.
    Otherwise, find the latest file in the expert-links directory.
    Falls back to the legacy expert-links.md in the backend directory.

    Args:
        filepath: Optional explicit filepath. If "auto" or None, auto-detect.

    Returns:
        Path to the expert links file to use.

    Raises:
        FileNotFoundError: If no valid expert links file can be found.
    """
    # If explicit filepath provided and it's not "auto", use it
    if filepath and filepath != "auto" and filepath != "expert-links.md":
        if os.path.exists(filepath):
            logger.info(f"Using specified expert links file: {filepath}")
            return filepath
        else:
            raise FileNotFoundError(f"Specified expert links file not found: {filepath}")

    # Try to find the latest file in the expert-links directory
    latest_file, latest_date = find_latest_expert_links_file()
    if latest_file:
        logger.info(f"📂 Auto-detected latest expert links file: {os.path.basename(latest_file)} (date: {latest_date})")
        return latest_file

    # Fallback to legacy location
    legacy_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "expert-links.md")
    if os.path.exists(legacy_path):
        logger.info(f"Falling back to legacy expert links file: {legacy_path}")
        return legacy_path

    raise FileNotFoundError(
        "No expert links file found. Please ensure either:\n"
        "  1. expert-links/Expert_Links_YYYY-MM-DD.md exists, or\n"
        "  2. expert-links.md exists in the backend directory"
    )


def parse_expert_links_md(filepath: str) -> List[Dict]:
    """
    Parse expert-links.md file and extract article information
    
    Args:
        filepath: Path to the expert-links.md file
    
    Returns:
        List of dictionaries with article information:
        [{ url, title, notes, priority, date_added, category }, ...]
    """
    if not os.path.exists(filepath):
        logger.warning(f"Expert links file not found: {filepath}")
        return []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
    except Exception as e:
        logger.error(f"Error reading file {filepath}: {e}")
        return []
    
    articles = []
    current_category = None
    
    # Split content into lines for processing
    lines = content.split('\n')
    
    for line in lines:
        line = line.strip()
        
        # Skip empty lines and comments
        if not line or line.startswith('<!--'):
            continue
        
        # Detect category headers (## Category Name)
        category_match = re.match(r'^##\s+(.+)', line)
        if category_match:
            current_category = category_match.group(1).strip()
            continue
        
        # Parse markdown bullet points with links
        # Format: - [Title](URL) - Notes (Priority: High/Normal) [Date: YYYY-MM-DD]
        bullet_pattern = r'^-\s*\[([^\]]+)\]\(([^)]+)\)\s*-?\s*(.*)$'
        match = re.match(bullet_pattern, line)
        
        if match:
            title = match.group(1).strip()
            url = match.group(2).strip()
            rest = match.group(3).strip()
            
            # Extract priority and date from the rest of the line
            priority = "Normal"
            date_added = None
            notes = rest
            
            # Extract priority (Priority: High/Normal/Essential)
            priority_match = re.search(r'\(Priority:\s*(High|Normal|Essential)\)', rest, re.IGNORECASE)
            if priority_match:
                priority = priority_match.group(1).capitalize()
                # Remove priority from notes
                notes = re.sub(r'\(Priority:\s*[^)]+\)', '', notes).strip()
            
            # Extract date [Date: YYYY-MM-DD]
            date_match = re.search(r'\[Date:\s*(\d{4}-\d{2}-\d{2})\]', rest)
            if date_match:
                try:
                    date_added = datetime.strptime(date_match.group(1), '%Y-%m-%d').date()
                except ValueError:
                    logger.warning(f"Invalid date format in line: {line}")
                # Remove date from notes
                notes = re.sub(r'\[Date:[^\]]+\]', '', notes).strip()
            
            # Clean up notes (remove extra dashes and spaces)
            notes = re.sub(r'^-\s*', '', notes).strip()
            notes = re.sub(r'\s*-\s*$', '', notes).strip()
            
            article_info = {
                'url': url,
                'title': title,
                'notes': notes if notes else None,
                'priority': priority,
                'date_added': date_added,
                'category': current_category or 'General'
            }
            
            articles.append(article_info)
            logger.debug(f"Parsed article: {title} ({url})")
    
    logger.info(f"Parsed {len(articles)} articles from {filepath}")
    return articles


def append_to_expert_links_md(
    filepath: str, 
    url: str, 
    title: str, 
    notes: str, 
    priority: str = "Normal", 
    category: str = "General"
) -> bool:
    """
    Append new link to expert-links.md file in markdown format
    
    Args:
        filepath: Path to the expert-links.md file
        url: Article URL
        title: Article title
        notes: Expert notes about the article
        priority: Priority level (Normal, High, Essential)
        category: Category for the article (F&B, Tech, etc.)
    
    Returns:
        True if successful, False otherwise
    """
    try:
        # Create file if it doesn't exist
        if not os.path.exists(filepath):
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as file:
                file.write(f"# Expert Links\n\n## {category}\n\n")
        
        # Read existing content
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Check if category exists
        category_pattern = f"## {category}"
        if category_pattern not in content:
            # Add new category section
            content += f"\n## {category}\n\n"
        
        # Format the new entry
        current_date = datetime.now().strftime('%Y-%m-%d')
        priority_text = f" (Priority: {priority})" if priority != "Normal" else ""
        notes_text = f" - {notes}" if notes else ""
        
        new_entry = f"- [{title}]({url}){notes_text}{priority_text} [Date: {current_date}]\n"
        
        # Find the category section and append the entry
        lines = content.split('\n')
        new_lines = []
        in_target_category = False
        entry_added = False
        
        for i, line in enumerate(lines):
            new_lines.append(line)
            
            # Check if we're entering the target category
            if line.strip() == f"## {category}":
                in_target_category = True
                continue
            
            # Check if we're leaving the target category (entering a new section)
            if in_target_category and line.strip().startswith('## ') and line.strip() != f"## {category}":
                # Insert before this new section
                new_lines.insert(-1, new_entry)
                entry_added = True
                in_target_category = False
        
        # If we're still in the target category at the end, append there
        if in_target_category and not entry_added:
            new_lines.append(new_entry)
            entry_added = True
        
        # If category wasn't found, this shouldn't happen due to our earlier check
        if not entry_added:
            new_lines.append(new_entry)
        
        # Write back to file
        with open(filepath, 'w', encoding='utf-8') as file:
            file.write('\n'.join(new_lines))
        
        logger.info(f"Added new entry to {filepath}: {title}")
        return True
        
    except Exception as e:
        logger.error(f"Error appending to {filepath}: {e}")
        return False


def validate_expert_links_format(filepath: str) -> Dict[str, List[str]]:
    """
    Validate the format of expert-links.md file and return any issues found
    
    Args:
        filepath: Path to the expert-links.md file
    
    Returns:
        Dictionary with validation results:
        {
            'errors': [list of error messages],
            'warnings': [list of warning messages],
            'valid_entries': [count of valid entries],
            'invalid_entries': [count of invalid entries]
        }
    """
    validation_result = {
        'errors': [],
        'warnings': [],
        'valid_entries': 0,
        'invalid_entries': 0
    }
    
    if not os.path.exists(filepath):
        validation_result['errors'].append(f"File not found: {filepath}")
        return validation_result
    
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
    except Exception as e:
        validation_result['errors'].append(f"Error reading file: {e}")
        return validation_result
    
    lines = content.split('\n')
    line_number = 0
    
    for line in lines:
        line_number += 1
        line = line.strip()
        
        if not line or line.startswith('#') or line.startswith('<!--'):
            continue
        
        # Check for bullet points with links
        if line.startswith('- ['):
            # Validate link format
            link_pattern = r'^-\s*\[([^\]]+)\]\(([^)]+)\)'
            if re.match(link_pattern, line):
                validation_result['valid_entries'] += 1
                
                # Check for URL validity (basic check)
                url_match = re.search(r'\(([^)]+)\)', line)
                if url_match:
                    url = url_match.group(1)
                    if not (url.startswith('http://') or url.startswith('https://')):
                        validation_result['warnings'].append(
                            f"Line {line_number}: URL may not be valid: {url}"
                        )
            else:
                validation_result['invalid_entries'] += 1
                validation_result['errors'].append(
                    f"Line {line_number}: Invalid markdown link format: {line}"
                )
        elif line.startswith('- '):
            validation_result['warnings'].append(
                f"Line {line_number}: Bullet point without proper link format: {line}"
            )
    
    return validation_result


def get_categories_from_md(filepath: str) -> List[str]:
    """
    Extract all categories from expert-links.md file
    
    Args:
        filepath: Path to the expert-links.md file
    
    Returns:
        List of category names found in the file
    """
    categories = []
    
    if not os.path.exists(filepath):
        return categories
    
    try:
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Find all category headers (## Category Name)
        category_matches = re.findall(r'^##\s+(.+)$', content, re.MULTILINE)
        categories = [match.strip() for match in category_matches]
        
    except Exception as e:
        logger.error(f"Error reading categories from {filepath}: {e}")
    
    return categories


def parse_expert_links_md_with_state(filepath: str, ingestion_state_id: str, db: Session) -> Dict:
    """
    Parse expert-links.md file with state tracking for smart ingestion
    
    Args:
        filepath: Path to the expert-links.md file
        ingestion_state_id: UUID of the ingestion state to track progress
        db: Database session
        
    Returns:
        Dictionary with ingestion results: {'created': int, 'updated': int, 'skipped': int, 'errors': int}
    """
    result = {
        'created': 0,
        'updated': 0,
        'skipped': 0,
        'errors': 0
    }
    
    # Log parsing start
    IngestionStateService.log_ingestion_action(
        ingestion_state_id, 
        'parsing_started', 
        details=f"Starting to parse {filepath}",
        db=db
    )
    
    # Parse the markdown file (use CSV parser since we're using CSV format)
    from app.services.csv_ingestion_service import parse_expert_links_csv
    try:
        articles = parse_expert_links_csv(filepath)
        
        IngestionStateService.log_ingestion_action(
            ingestion_state_id,
            'parsed',
            details=f"Parsed {len(articles)} articles from {filepath}",
            db=db
        )
        
    except Exception as e:
        logger.error(f"Error parsing {filepath}: {e}")
        IngestionStateService.log_ingestion_action(
            ingestion_state_id,
            'parse_error',
            details=f"Error parsing file: {str(e)}",
            db=db
        )
        result['errors'] += 1
        return result
    
    # Import quality and dedup services
    from app.services.content_quality_service import ContentQualityService
    from app.services.deduplication_service import DeduplicationService

    quality_service = ContentQualityService()
    dedup_service = DeduplicationService.get_instance()

    # Track rejections for observability
    result['rejected'] = 0
    result['rejection_log'] = []

    # Process each article
    for article_data in articles:
        try:
            url = article_data['url']

            # ── URL dedup check (normalized) ──────────────────────
            if not dedup_service.try_acquire_url(url):
                IngestionStateService.log_ingestion_action(
                    ingestion_state_id,
                    'skipped',
                    details=f"URL already being processed: {url}",
                    db=db
                )
                result['skipped'] += 1
                continue

            # Check if article already exists in DB
            existing_article = db.query(Article).filter(Article.url == url).first()

            if existing_article:
                dedup_service.release_url(url)
                IngestionStateService.log_ingestion_action(
                    ingestion_state_id,
                    'skipped',
                    article_id=str(existing_article.id),
                    details=f"Article already exists: {article_data['title'][:50]}...",
                    db=db
                )
                result['skipped'] += 1
                continue

            # ── Pre-scrape quality check (domain) ─────────────────
            pre_passed, pre_reason, is_allowed = quality_service.assess_pre_scrape(url)
            if not pre_passed:
                dedup_service.release_url(url)
                result['rejected'] += 1
                result['rejection_log'].append({'url': url, 'reason': pre_reason})
                logger.info(f"Tier 3 rejected (pre-scrape): {url} - {pre_reason}")
                continue

            # Create new article
            from app.services.ingestion_service import ingest_url
            from app.services.image_scraping_service import ImageScrapingService
            import uuid

            # Fetch article content
            ingestion_data = ingest_url(url)

            raw_text = ingestion_data.get('raw_text', '')
            html_content = ingestion_data.get('html_content', '')

            # ── Post-scrape quality check ─────────────────────────
            is_paywalled = ingestion_data.get('is_paywalled', False)
            post_passed, quality_score, post_reason = quality_service.assess_post_scrape(
                raw_text, html_content, 'tier1_expert'
            )
            if not post_passed:
                # For Tier 3 (expert-curated), paywalled articles bypass quality gate
                # since expert curation IS the quality signal
                if is_paywalled:
                    quality_score = max(quality_score, 0.40)  # Floor score for expert paywalled
                    logger.info(f"Tier 3 paywalled article bypasses quality gate: {url}")
                else:
                    dedup_service.release_url(url)
                    result['rejected'] += 1
                    result['rejection_log'].append({'url': url, 'reason': post_reason, 'score': quality_score})
                    logger.info(f"Tier 3 rejected (post-scrape): {url} - {post_reason} (score={quality_score:.2f})")
                    continue

            # ── Content hash dedup ────────────────────────────────
            content_hash = dedup_service.compute_content_hash(raw_text)

            # Scrape image from article URL
            image_url = None
            image_source = None
            try:
                image_service = ImageScrapingService()
                image_url = image_service.scrape_image_url(url)
                if image_url:
                    image_source = 'scraped'
                    logger.info(f"Scraped image for {url}: {image_url[:80]}...")
            except Exception as img_err:
                logger.warning(f"Image scraping failed for {url}: {img_err}")

            # Create Article record with tier tagging and quality score
            article_id = uuid.uuid4()
            new_article = Article(
                id=article_id,
                url=url,
                title=ingestion_data.get('title', article_data['title']),
                source=ingestion_data.get('source', ''),
                publish_date=ingestion_data.get('publish_date'),
                raw_text=raw_text,
                word_count=ingestion_data.get('word_count', 0),
                is_paywalled=ingestion_data.get('is_paywalled', False),
                article_image_url=image_url,
                scrape_attempted=True,
                image_source=image_source,
                inline_images=ingestion_data.get('inline_images', []),
                ingestion_tier='tier1_expert',
                quality_score=quality_score,
                content_hash=content_hash,
            )

            db.add(new_article)
            db.flush()  # Get the ID without committing

            # ── Auto-essential detection ──────────────────────────
            priority = article_data.get('priority', 'Normal')
            auto_generated = False
            if priority == 'Normal' and quality_service.should_auto_essential(quality_score, 'tier1_expert'):
                priority = 'Essential'
                auto_generated = True
                logger.info(f"Auto-essential: {url} (score={quality_score:.2f})")

            # Create ExpertNote if notes provided
            notes = article_data.get('notes')
            if notes:
                expert_id = uuid.uuid4()  # Placeholder expert ID

                expert_note = ExpertNote(
                    expert_id=expert_id,
                    article_id=article_id,
                    notes_text=notes,
                    priority=priority,
                    auto_generated=auto_generated,
                    expert_industry=IndustriesConfig.get_instance().normalize_industry_name(
                        article_data.get('industry', IndustriesConfig.get_instance().get_defaults()['industry_name'])
                    ),
                    expert_specializations=article_data.get('specializations', [IndustriesConfig.get_instance().get_defaults()['specialization_name']])
                )

                db.add(expert_note)

            db.commit()

            # Generate rich content immediately (consistent with Tier 2/3 pipeline)
            try:
                from app.services.rich_summary_service import RichSummaryService
                defaults = IndustriesConfig.get_instance().get_defaults()
                industry_name = article_data.get('industry', defaults['industry_name'])
                specs = article_data.get('specializations', [defaults['specialization_name']])
                specialization = specs[0] if specs else 'General'

                rich_service = RichSummaryService(db)
                rich_content = rich_service.generate_rich_content(
                    article=new_article,
                    industry=industry_name,
                    specialization=specialization,
                    related_article_titles=None
                )
                if rich_content:
                    logger.info(f"Rich content generated for: {new_article.title[:50]}...")
            except Exception as e:
                logger.warning(f"Rich content generation failed for {url}: {e}")

            # Log successful creation
            IngestionStateService.log_ingestion_action(
                ingestion_state_id,
                'created_article',
                article_id=str(article_id),
                details=f"Created article (quality={quality_score:.2f}, tier=tier1_expert): {article_data['title'][:50]}...",
                db=db
            )
            result['created'] += 1

        except Exception as e:
            logger.error(f"Error processing article {article_data.get('url', 'unknown')}: {e}")
            IngestionStateService.log_ingestion_action(
                ingestion_state_id,
                'article_error',
                details=f"Error processing {article_data.get('title', 'unknown')[:50]}...: {str(e)}",
                db=db
            )
            result['errors'] += 1
            db.rollback()
            # Release URL lock on error
            try:
                dedup_service.release_url(article_data.get('url', ''))
            except Exception:
                pass
            continue
    
    # Log completion
    IngestionStateService.log_ingestion_action(
        ingestion_state_id,
        'parsing_completed',
        details=f"Completed parsing. Created: {result['created']}, Skipped: {result['skipped']}, Errors: {result['errors']}",
        db=db
    )
    
    return result
