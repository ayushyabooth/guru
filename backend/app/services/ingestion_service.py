"""
URL ingestion service for fetching and extracting article content
"""
import requests
import trafilatura
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from datetime import datetime
from typing import Dict, Optional
import logging
import re

try:
    import cloudscraper
    CLOUDSCRAPER_AVAILABLE = True
except ImportError:
    CLOUDSCRAPER_AVAILABLE = False

logger = logging.getLogger(__name__)


def clean_article_text(raw_text: str) -> str:
    """
    Clean extracted article text by removing markdown artifacts, image references, and link formatting.
    Produces clean, readable paragraphs suitable for Reader Mode.
    
    Args:
        raw_text: Raw extracted text that may contain markdown-like artifacts
        
    Returns:
        Clean text with proper paragraph structure
    """
    if not raw_text:
        return ""
    
    text = raw_text
    
    # Remove image captions that start with "FILE -" or "FILE:" (AP/Reuters photo captions)
    text = re.sub(r'^\s*FILE\s*[-–—:]\s*[^\n]+$', '', text, flags=re.MULTILINE | re.IGNORECASE)
    
    # Remove photo credit lines (Photo: ..., Image: ..., Credit: ..., etc.)
    text = re.sub(r'^\s*(Photo|Image|Credit|Picture|Caption|Source)\s*[:]\s*[^\n]+$', '', text, flags=re.MULTILINE | re.IGNORECASE)
    
    # Remove standalone photo attribution lines (e.g., "(AP Photo/Name)" or "[Photo by Name]")
    text = re.sub(r'\((?:AP|AFP|Reuters|Getty|EPA)\s*Photo[^)]*\)', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[(?:Photo|Image|Credit)[^\]]*\]', '', text, flags=re.IGNORECASE)
    
    # Remove markdown image syntax: ![alt text](url) or ![alt text]
    text = re.sub(r'!\[([^\]]*)\]\([^)]+\)', '', text)
    text = re.sub(r'!\[([^\]]*)\]', '', text)
    
    # Convert markdown links to just the text: [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    
    # Remove standalone URLs
    text = re.sub(r'https?://[^\s]+', '', text)
    
    # Preserve markdown headers (## Header) — used for heading detection in reader

    # Remove markdown bold/italic markers
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # **bold**
    text = re.sub(r'\*([^*]+)\*', r'\1', text)      # *italic*
    text = re.sub(r'__([^_]+)__', r'\1', text)      # __bold__
    text = re.sub(r'_([^_]+)_', r'\1', text)        # _italic_
    
    # Remove horizontal rules
    text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    
    # Preserve list markers (- and 1.) for structured rendering in reader
    # Only normalize varied bullet styles (*, +) to dash
    text = re.sub(r'^\s*[*+]\s+', '- ', text, flags=re.MULTILINE)
    
    # Remove excessive whitespace while preserving paragraph breaks
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    
    # Clean up lines
    lines = []
    for line in text.split('\n'):
        line = line.strip()
        if line:
            lines.append(line)
    
    # Rejoin with proper paragraph breaks
    text = '\n\n'.join(lines)

    # Strip boilerplate (sidebars, CTAs, bios)
    text = strip_boilerplate(text)

    # Remove consecutive duplicate paragraphs (extraction artifacts)
    paragraphs = text.split('\n\n')
    deduped = []
    for p in paragraphs:
        if not deduped or p.strip() != deduped[-1].strip():
            deduped.append(p)
    text = '\n\n'.join(deduped)

    return text.strip()


# ── Boilerplate stripping ────────────────────────────────────────

# Section headers that indicate everything below is non-article content
_SECTION_MARKERS = [
    re.compile(p, re.IGNORECASE) for p in [
        r'^Most Popular\s*$',
        r'^Most Read\s*$',
        r'^Trending\s*(Stories|Now|Articles)?\s*$',
        r'^Related (Stories|Articles|Posts|Research)\s*$',
        r'^Recommended (Stories|Articles|For You)\s*$',
        r'^You May Also Like\s*$',
        r'^Also Read\s*$',
        r'^Read More\s*$',
        r'^Editor.?s? Picks?\s*$',
        r'^Popular (Stories|Articles|Posts)\s*$',
        r'^What to Read Next\s*$',
        r'^More (Stories |Articles )?From',
        r'^Latest (Stories|Articles|News)\s*$',
        r'^Don.t Miss\s*$',
        r'^More In\b',
        r'^Our Picks\s*$',
        r'^How to access this report\s*$',
        r'^Report details\s*$',
    ]
]

# Individual lines to remove (can appear anywhere)
_LINE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r'^Sign up for .{5,80}(newsletter|updates)',
        r'^Subscribe (to|for) .{5,80}(newsletter|updates|news)',
        r'^Get the latest .{5,80}(inbox|email|delivered)',
        r'^Follow us on .{5,80}(Twitter|LinkedIn|Facebook|YouTube|Instagram|X)',
        r'^Share this (article|story|post)',
        r'^\[Favorite\]\s*$',
        r'^Tags?\s*:\s*',
        r'^Filed (under|in)\s*:\s*',
        r'^(Cookie|Privacy) (Policy|Notice)',
        r'^Terms (of|and) (Service|Use)',
        r'^(©|Copyright)\s*\d{4}',
        r'^Contact .{3,60}@.{3,40}\..{2,6}\s*$',
        r'^Create an account to continue reading',
        r'^Register for free\s*$',
        r'^Gain instant access to our',
        r'^Not for publication,? email or dissemination',
        r'^Download the Report\s*$',
        r'^Complete the form below',
        r'^By submitting this form,? you agree',
        r'^Enquire about subscription\s*$',
        r'^Contact our research team\s*$',
        r'^Learn more\s*$',
        r'^\d+ reports? a year\s*$',
        r'^\d+ million data points\s*$',
        r'^Over \d+ metrics\s*$',
        r'^THR Newsletters\s*$',
        r'^Subscribe Sign Up\s*$',
        r'^We.d love to be your preferred source',
        r'^Please add us to your preferred sources',
        r'^Advertisement:?\s*Scroll to Continue\s*$',
    ]
]

# Signals that a short trailing paragraph is an author bio
_AUTHOR_BIO_SIGNALS = [
    'years of experience', 'graduated from', 'prior to joining',
    'has been writing', "bachelor's", "master's degree",
    'reports on', 'joined in', 'based in',
]


def strip_boilerplate(text: str) -> str:
    """
    Strip boilerplate content from article text.

    Phase A: Truncate at section markers (Most Popular, Related Stories, etc.)
    Phase B: Remove individual boilerplate lines (newsletter CTAs, legal, etc.)
    Phase C: Remove trailing author bios
    """
    if not text:
        return text

    paragraphs = text.split('\n\n')

    # Phase A: Section truncation — find first marker, cut everything after
    truncated = []
    for para in paragraphs:
        first_line = para.strip().split('\n')[0].strip()
        if any(m.match(first_line) for m in _SECTION_MARKERS):
            break  # Truncate from here
        truncated.append(para)
    paragraphs = truncated

    # Phase B: Line-level removal
    cleaned = []
    for para in paragraphs:
        lines = para.split('\n')
        kept = [l for l in lines if not any(p.match(l.strip()) for p in _LINE_PATTERNS)]
        if kept:
            cleaned.append('\n'.join(kept))
    paragraphs = cleaned

    # Phase C: Trailing author bio detection
    # Check last 3 paragraphs for short bio-like content
    if len(paragraphs) >= 2:
        trim_from = len(paragraphs)
        for i in range(len(paragraphs) - 1, max(len(paragraphs) - 4, -1), -1):
            para = paragraphs[i]
            word_count = len(para.split())
            if word_count > 60:
                break  # Real content paragraph, stop checking
            lower = para.lower()
            signal_count = sum(1 for s in _AUTHOR_BIO_SIGNALS if s in lower)
            if signal_count >= 2:
                trim_from = i
            else:
                break  # Not a bio, stop checking
        paragraphs = paragraphs[:trim_from]

    return '\n\n'.join(paragraphs)


def _strip_leading_title(text: str, title: str) -> str:
    """Remove leading paragraphs that repeat the article title or are short category labels."""
    if not text or not title:
        return text

    # Normalize title for comparison (strip " | SiteName" suffix)
    clean_title = re.sub(r'\s*\|.*$', '', title).strip().lower()

    paragraphs = text.split('\n\n')
    strip_count = 0
    for para in paragraphs[:3]:  # Only check first 3 paragraphs
        stripped = para.strip()
        # Remove ## prefix for comparison
        content = re.sub(r'^#{1,6}\s+', '', stripped).strip()
        content_lower = content.lower()

        # Remove if it matches the title
        if content_lower and (content_lower == clean_title
                              or clean_title in content_lower
                              or content_lower in clean_title):
            strip_count += 1
            continue

        # Remove short category labels (1-2 words, < 30 chars) at the very start
        if strip_count == 0 and content and len(content.split()) <= 2 and len(content) < 30:
            strip_count += 1
            continue

        break  # Real content starts here

    if strip_count > 0:
        paragraphs = paragraphs[strip_count:]

    return '\n\n'.join(paragraphs)


def _extract_structured_text_from_html(html_content: str) -> Optional[str]:
    """
    Extract article text from HTML using trafilatura's XML/TEI output,
    preserving headings (## ) and list markers (- and 1.) in plain text.

    Returns structured plain text, or None if extraction fails.
    """
    try:
        xml_text = trafilatura.extract(html_content, output_format='xmltei')
        if not xml_text:
            return None
        import defusedxml.ElementTree as ET
        ns = '{http://www.tei-c.org/ns/1.0}'
        root = ET.fromstring(xml_text)
        body = root.find(f'.//{ns}body')
        if body is None:
            return None

        parts = []

        def _walk(element):
            """Recursively walk TEI elements, emitting structured text."""
            tag = element.tag.replace(ns, '')

            if tag == 'ab':
                text = ''.join(element.itertext()).strip()
                if not text:
                    return
                if element.get('type') == 'header':
                    parts.append(f'## {text}')
                else:
                    parts.append(text)
            elif tag == 'p':
                text = ''.join(element.itertext()).strip()
                if text:
                    parts.append(text)
            elif tag == 'list':
                list_type = element.get('rend', 'ul')
                for idx, item in enumerate(element.findall(f'{ns}item')):
                    text = ''.join(item.itertext()).strip()
                    if text:
                        if list_type == 'ol':
                            parts.append(f'{idx + 1}. {text}')
                        else:
                            parts.append(f'- {text}')
            else:
                # Recurse into unknown container elements
                for child in element:
                    _walk(child)

        for child in body:
            _walk(child)

        if not parts:
            return None

        return '\n\n'.join(parts)
    except Exception as e:
        logger.debug(f"TEI extraction failed: {e}")
        return None


def _extract_headings_from_html(html_content: str) -> set:
    """Extract heading texts from HTML using trafilatura's XML/TEI output.
    Fallback for when full TEI extraction isn't used."""
    try:
        xml_text = trafilatura.extract(html_content, output_format='xmltei')
        if not xml_text:
            return set()
        import defusedxml.ElementTree as ET
        ns = '{http://www.tei-c.org/ns/1.0}'
        root = ET.fromstring(xml_text)
        headings = set()
        for ab in root.iter(f'{ns}ab'):
            if ab.get('type') == 'header' and ab.text and ab.text.strip():
                text = ab.text.strip()
                headings.add(text)
                stripped = re.sub(r'^\d+\.\s+', '', text)
                if stripped != text:
                    headings.add(stripped)
        return headings
    except Exception:
        return set()


def _apply_heading_markers(text: str, headings: set) -> str:
    """Prefix heading lines with ## in plain text."""
    if not headings:
        return text
    lines = text.split('\n')
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and not stripped.startswith('## ') and stripped in headings:
            lines[i] = f'## {stripped}'
    return '\n'.join(lines)


def extract_structured_content(raw_text: str) -> list:
    """
    Parse article text into structured sections (paragraphs) for Reader Mode.
    
    Args:
        raw_text: Cleaned article text
        
    Returns:
        List of section dictionaries with type and content
    """
    if not raw_text:
        return []
    
    cleaned = clean_article_text(raw_text)
    paragraphs = cleaned.split('\n\n')
    
    sections = []
    for i, para in enumerate(paragraphs):
        para = para.strip()
        # Detect markdown headings (## Header)
        header_match = re.match(r'^(#{1,6})\s+(.*)', para)
        if header_match:
            sections.append({
                'order': i,
                'type': 'heading',
                'level': len(header_match.group(1)),
                'content': header_match.group(2)
            })
        elif re.match(r'^(\d+\.\s|- )', para):
            # List block — group consecutive list items
            sections.append({
                'order': i,
                'type': 'list',
                'content': para
            })
        elif len(para) > 20:  # Skip very short fragments
            sections.append({
                'order': i,
                'type': 'paragraph',
                'content': para
            })

    return sections


# Common paywall indicators - more specific to avoid false positives
PAYWALL_INDICATORS = [
    'subscriber-only-content', 'paywall-message', 'subscription-required-message',
    'premium-content-wall', 'member-exclusive-article', 'sign-in-to-continue',
    'login-to-read-more', 'subscribe-to-continue', 'membership-wall'
]

# Error page titles that indicate blocked/failed scraping - should skip these articles
ERROR_PAGE_TITLES = [
    'access denied', 'access to this page has been denied',
    '403 forbidden', '403 - forbidden', 'forbidden',
    'just a moment', 'checking your browser', 'please wait',
    'cloudflare', 'ddos protection', 'security check',
    'page not found', '404 not found', '404 error',
    'error', 'blocked', 'unauthorized', '401',
    'robot check', 'captcha', 'verify you are human',
    'please enable javascript', 'enable cookies'
]

# User agent to avoid bot blocking - updated to latest Chrome
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# Cloudflare challenge indicators
CLOUDFLARE_INDICATORS = [
    'just a moment', 'checking your browser', 'please wait',
    'cloudflare', 'ddos protection', 'security check',
    'enable javascript', 'enable cookies', 'ray id'
]


def _is_cloudflare_challenge(html_content: str, title: str = None) -> bool:
    """Check if the response is a Cloudflare challenge page"""
    html_lower = html_content.lower()
    title_lower = (title or '').lower()

    # Check title
    if 'just a moment' in title_lower or 'cloudflare' in title_lower:
        return True

    # Check content for Cloudflare indicators
    cloudflare_count = sum(1 for ind in CLOUDFLARE_INDICATORS if ind in html_lower)
    if cloudflare_count >= 2:  # Multiple indicators suggest Cloudflare
        return True

    # Check for Cloudflare-specific elements
    if 'cf-browser-verification' in html_lower or 'cf_chl_opt' in html_lower:
        return True

    return False


def _fetch_with_cloudscraper(url: str, timeout: int = 30) -> Optional[str]:
    """Try to fetch URL using cloudscraper to bypass Cloudflare"""
    if not CLOUDSCRAPER_AVAILABLE:
        logger.warning("cloudscraper not available, cannot bypass Cloudflare")
        return None

    try:
        scraper = cloudscraper.create_scraper()
        response = scraper.get(url, timeout=timeout)

        if response.status_code == 200:
            # Verify we got real content
            if not _is_cloudflare_challenge(response.text):
                logger.info(f"Successfully bypassed Cloudflare for {url}")
                return response.text
            else:
                logger.warning(f"cloudscraper still got Cloudflare challenge for {url}")
                return None
        else:
            logger.warning(f"cloudscraper got status {response.status_code} for {url}")
            return None
    except Exception as e:
        logger.error(f"cloudscraper failed for {url}: {e}")
        return None


def ingest_url(url: str, timeout: int = 30) -> Dict:
    """
    Fetch URL and extract article metadata and content
    
    Args:
        url: URL to fetch and process
        timeout: Request timeout in seconds
    
    Returns:
        Dictionary with article information:
        {
            'title': str,
            'source': str,
            'publish_date': datetime or None,
            'raw_text': str or None,
            'is_paywalled': bool,
            'word_count': int,
            'error': str or None
        }
    """
    result = {
        'title': None,
        'source': None,
        'publish_date': None,
        'raw_text': None,
        'is_paywalled': False,
        'word_count': 0,
        'inline_images': [],
        'error': None
    }
    
    try:
        # Validate URL
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            result['error'] = "Invalid URL format"
            return result
        
        result['source'] = parsed_url.netloc
        
        # Set up headers to avoid bot blocking
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }
        
        # Fetch the page
        logger.info(f"Fetching URL: {url}")
        response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)

        # Check for HTTP errors
        if response.status_code == 404:
            result['error'] = "Page not found (404)"
            return result
        elif response.status_code == 403:
            # 403 might be bot blocking, not necessarily a paywall
            # Try to extract content anyway before marking as paywalled
            logger.warning(f"403 error for {url}, attempting extraction anyway")
        elif response.status_code >= 400:
            result['error'] = f"HTTP error {response.status_code}"
            return result

        html_content = response.text

        # Check for Cloudflare challenge and retry with cloudscraper if needed
        if _is_cloudflare_challenge(html_content):
            logger.info(f"Cloudflare challenge detected for {url}, retrying with cloudscraper")
            cf_content = _fetch_with_cloudscraper(url, timeout)
            if cf_content:
                html_content = cf_content
            else:
                # Could not bypass Cloudflare
                result['error'] = "Cloudflare protection - unable to access content"
                result['is_paywalled'] = True
                logger.warning(f"Could not bypass Cloudflare for {url}")
                return result
        
        # Check for paywall indicators in HTML
        if _detect_paywall(html_content, response.status_code):
            result['is_paywalled'] = True
            logger.info(f"Paywall detected for URL: {url}")
        
        # Primary: Extract structured text from TEI XML (preserves headings + lists)
        structured_text = _extract_structured_text_from_html(html_content)

        # Also get JSON extraction for metadata (image URL, etc.)
        import json
        extracted_json = trafilatura.extract(
            html_content,
            include_comments=False,
            include_tables=True,
            include_images=True,
            include_links=False,
            output_format='json'
        )
        json_metadata = {}
        if extracted_json:
            try:
                json_metadata = json.loads(extracted_json)
            except (json.JSONDecodeError, TypeError):
                pass

        if structured_text:
            # Use TEI-extracted text which has ## headings and - list markers
            result['raw_text'] = clean_article_text(structured_text)
            result['word_count'] = len(result['raw_text'].split())
            if json_metadata.get('image'):
                result['images'] = [json_metadata['image']]
        elif json_metadata.get('text'):
            # Fallback to JSON text with heading markers only
            raw_text = json_metadata['text'].strip()
            headings = _extract_headings_from_html(html_content)
            if headings:
                raw_text = _apply_heading_markers(raw_text, headings)
            result['raw_text'] = clean_article_text(raw_text)
            result['word_count'] = len(result['raw_text'].split())
            if json_metadata.get('image'):
                result['images'] = [json_metadata['image']]
        elif extracted_json:
            # Fallback to plain text from trafilatura
            raw_text = extracted_json.strip()
            headings = _extract_headings_from_html(html_content)
            if headings:
                raw_text = _apply_heading_markers(raw_text, headings)
            result['raw_text'] = clean_article_text(raw_text)
            result['word_count'] = len(result['raw_text'].split())
        else:
            # Last resort: BeautifulSoup
            logger.warning(f"Trafilatura extraction failed for {url}, trying BeautifulSoup")
            extracted_text = _extract_with_beautifulsoup(html_content)
            if extracted_text:
                result['raw_text'] = clean_article_text(extracted_text.strip())
                result['word_count'] = len(result['raw_text'].split())
        
        # Extract metadata using BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract title
        title = _extract_title(soup)
        if title:
            result['title'] = title
            # Check if title indicates an error page (bot blocking, etc.)
            if _is_error_page_title(title):
                result['error'] = f"Error page detected: {title}"
                result['raw_text'] = None
                result['word_count'] = 0
                logger.warning(f"Skipping error page for {url}: {title}")
                return result
        
        # Strip leading title repetition and category labels
        if result.get('raw_text') and result.get('title'):
            result['raw_text'] = _strip_leading_title(result['raw_text'], result['title'])
            result['word_count'] = len(result['raw_text'].split())

        # Extract publish date
        publish_date = _extract_publish_date(soup, html_content)
        if publish_date:
            result['publish_date'] = publish_date
        
        # Extract inline images with positions
        inline_images = extract_inline_images(html_content, url)
        if inline_images:
            result['inline_images'] = inline_images
        
        # Only clear text if truly paywalled AND no content was extracted
        if result['is_paywalled'] and not result.get('raw_text'):
            result['raw_text'] = None
            result['word_count'] = 0
        elif result.get('raw_text') and result['word_count'] > 100:
            # If we extracted substantial content, it's not paywalled
            result['is_paywalled'] = False

        # Reject paywall stubs — too little content after cleaning
        if result['is_paywalled'] and result.get('raw_text') and result['word_count'] < 100:
            logger.info(f"Rejecting paywall stub for {url}: only {result['word_count']} words")
            result['raw_text'] = None
            result['word_count'] = 0
        
        logger.info(f"Successfully processed URL: {url} (paywalled: {result['is_paywalled']})")
        
    except requests.exceptions.Timeout:
        result['error'] = "Request timeout"
        logger.error(f"Timeout fetching URL: {url}")
    except requests.exceptions.ConnectionError:
        result['error'] = "Connection error"
        logger.error(f"Connection error fetching URL: {url}")
    except requests.exceptions.RequestException as e:
        result['error'] = f"Request error: {str(e)}"
        logger.error(f"Request error fetching URL {url}: {e}")
    except Exception as e:
        result['error'] = f"Unexpected error: {str(e)}"
        logger.error(f"Unexpected error processing URL {url}: {e}")
    
    return result


def _detect_paywall(html_content: str, status_code: int) -> bool:
    """
    Detect if the page is behind a paywall
    
    Args:
        html_content: HTML content of the page
        status_code: HTTP status code
    
    Returns:
        True if paywall detected, False otherwise
    """
    # Check status codes that often indicate paywalls
    if status_code in [402, 403]:  # Payment Required, Forbidden
        return True
    
    # Convert to lowercase for case-insensitive matching
    content_lower = html_content.lower()
    
    # Check for paywall indicators in HTML content
    for indicator in PAYWALL_INDICATORS:
        if indicator in content_lower:
            return True
    
    # Check for common paywall CSS classes and IDs
    paywall_selectors = [
        'paywall', 'subscription-wall', 'premium-wall',
        'subscriber-only', 'login-wall', 'registration-wall'
    ]
    
    soup = BeautifulSoup(html_content, 'html.parser')
    for selector in paywall_selectors:
        if soup.find(class_=selector) or soup.find(id=selector):
            return True
    
    # Check for subscription-related meta tags
    meta_tags = soup.find_all('meta')
    for meta in meta_tags:
        content = meta.get('content', '').lower()
        name = meta.get('name', '').lower()
        if any(indicator in content or indicator in name for indicator in PAYWALL_INDICATORS):
            return True
    
    # Check for very short content (often indicates paywall truncation)
    text_content = soup.get_text().strip()
    if len(text_content.split()) < 50:  # Less than 50 words might indicate truncated content
        # But only if there are subscription-related keywords
        if any(indicator in content_lower for indicator in ['subscribe', 'subscription', 'premium']):
            return True
    
    return False


def _is_error_page_title(title: str) -> bool:
    """
    Check if title indicates an error/blocked page rather than real article content
    
    Args:
        title: Page title to check
    
    Returns:
        True if title indicates an error page, False otherwise
    """
    if not title:
        return False
    
    title_lower = title.lower().strip()
    
    # Check against known error page titles
    for error_title in ERROR_PAGE_TITLES:
        if error_title in title_lower:
            return True
    
    # Also check for very short generic titles that often indicate errors
    if len(title_lower) < 20 and any(word in title_lower for word in ['error', 'denied', 'forbidden', 'blocked']):
        return True
    
    return False


def _extract_title(soup: BeautifulSoup) -> Optional[str]:
    """
    Extract article title from HTML
    
    Args:
        soup: BeautifulSoup object
    
    Returns:
        Article title or None
    """
    # Try different title extraction methods in order of preference
    
    # 1. Open Graph title
    og_title = soup.find('meta', property='og:title')
    if og_title and og_title.get('content'):
        return og_title['content'].strip()
    
    # 2. Twitter title
    twitter_title = soup.find('meta', attrs={'name': 'twitter:title'})
    if twitter_title and twitter_title.get('content'):
        return twitter_title['content'].strip()
    
    # 3. HTML title tag
    title_tag = soup.find('title')
    if title_tag and title_tag.string:
        return title_tag.string.strip()
    
    # 4. H1 tag (first one)
    h1_tag = soup.find('h1')
    if h1_tag:
        return h1_tag.get_text().strip()
    
    return None


def _extract_publish_date(soup: BeautifulSoup, html_content: str) -> Optional[datetime]:
    """
    Extract publish date from HTML
    
    Args:
        soup: BeautifulSoup object
        html_content: Raw HTML content
    
    Returns:
        Publish date as datetime object or None
    """
    # Try different date extraction methods
    
    # 1. JSON-LD structured data
    json_ld_scripts = soup.find_all('script', type='application/ld+json')
    for script in json_ld_scripts:
        try:
            import json
            data = json.loads(script.string)
            if isinstance(data, dict):
                date_published = data.get('datePublished')
                if date_published:
                    return _parse_date_string(date_published)
        except:
            continue
    
    # 2. Meta tags
    date_meta_selectors = [
        ('meta', {'property': 'article:published_time'}),
        ('meta', {'name': 'publishdate'}),
        ('meta', {'name': 'date'}),
        ('meta', {'name': 'DC.date.issued'}),
        ('meta', {'property': 'og:updated_time'}),
    ]
    
    for tag_name, attrs in date_meta_selectors:
        meta_tag = soup.find(tag_name, attrs)
        if meta_tag and meta_tag.get('content'):
            date = _parse_date_string(meta_tag['content'])
            if date:
                return date
    
    # 3. Time tags with datetime attribute
    time_tags = soup.find_all('time')
    for time_tag in time_tags:
        datetime_attr = time_tag.get('datetime')
        if datetime_attr:
            date = _parse_date_string(datetime_attr)
            if date:
                return date
    
    return None


def _parse_date_string(date_string: str) -> Optional[datetime]:
    """
    Parse various date string formats
    
    Args:
        date_string: Date string to parse
    
    Returns:
        Datetime object or None
    """
    import dateparser
    
    try:
        # Use dateparser for flexible date parsing
        parsed_date = dateparser.parse(date_string)
        return parsed_date
    except:
        return None


def _extract_with_beautifulsoup(html_content: str) -> Optional[str]:
    """
    Fallback content extraction using BeautifulSoup
    
    Args:
        html_content: HTML content
    
    Returns:
        Extracted text or None
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "header", "footer", "aside"]):
            script.decompose()
        
        # Try to find main content areas
        content_selectors = [
            'article', '.article-content', '.post-content', '.entry-content',
            '.content', 'main', '.main-content', '.story-body'
        ]
        
        for selector in content_selectors:
            content_div = soup.select_one(selector)
            if content_div:
                text = content_div.get_text()
                # Clean up whitespace
                text = re.sub(r'\s+', ' ', text).strip()
                if len(text) > 100:  # Only return if substantial content
                    return text
        
        # Fallback: get all paragraph text
        paragraphs = soup.find_all('p')
        if paragraphs:
            text = ' '.join([p.get_text() for p in paragraphs])
            text = re.sub(r'\s+', ' ', text).strip()
            return text if len(text) > 50 else None
        
    except Exception as e:
        logger.error(f"BeautifulSoup extraction failed: {e}")
    
    return None


def validate_url(url: str) -> bool:
    """
    Validate if URL is properly formatted and not targeting internal/private networks.

    Args:
        url: URL to validate

    Returns:
        True if valid and safe, False otherwise
    """
    try:
        parsed = urlparse(url)
        if not (parsed.scheme in ('http', 'https') and parsed.netloc):
            return False
        # Block private/internal IPs (SSRF protection)
        import socket
        from ipaddress import ip_address
        hostname = parsed.netloc.split(':')[0]
        try:
            resolved_ip = ip_address(socket.gethostbyname(hostname))
            if resolved_ip.is_private or resolved_ip.is_loopback or resolved_ip.is_reserved or resolved_ip.is_link_local:
                logger.warning(f"SSRF blocked: {url} resolves to private IP {resolved_ip}")
                return False
        except (socket.gaierror, ValueError):
            pass  # DNS resolution failure or non-IP hostname — allow but will fail on fetch
        return True
    except:
        return False


def get_domain_from_url(url: str) -> Optional[str]:
    """
    Extract domain from URL
    
    Args:
        url: URL to extract domain from
    
    Returns:
        Domain name or None
    """
    try:
        parsed = urlparse(url)
        return parsed.netloc if parsed.netloc else None
    except:
        return None


def extract_inline_images(html_content: str, base_url: str) -> list:
    """
    Extract inline images from article HTML with their approximate positions.

    Args:
        html_content: Raw HTML content
        base_url: Base URL for resolving relative image URLs

    Returns:
        List of image dictionaries with url, alt, caption, and position_after_paragraph
    """
    from urllib.parse import urljoin

    images = []
    try:
        soup = BeautifulSoup(html_content, 'html.parser')

        # Remove nav, header, footer, aside, ads - non-content areas
        for elem in soup(['nav', 'header', 'footer', 'aside', 'script', 'style']):
            elem.decompose()

        # Remove related/recommended article sections (common patterns)
        related_selectors = [
            # Class-based selectors
            '[class*="related"]', '[class*="recommended"]', '[class*="more-stories"]',
            '[class*="also-read"]', '[class*="you-may-like"]', '[class*="trending"]',
            '[class*="popular"]', '[class*="latest-news"]', '[class*="local-news"]',
            '[class*="sidebar"]', '[class*="widget"]', '[class*="tab_content"]',
            '[class*="more-from"]', '[class*="around-the-web"]', '[class*="outbrain"]',
            '[class*="taboola"]', '[class*="sponsored"]', '[class*="promoted"]',
            # ID-based selectors
            '[id*="related"]', '[id*="recommended"]', '[id*="sidebar"]',
            '[id*="widget"]', '[id*="more-stories"]',
            # Semantic elements commonly used for related content
            '.related-posts', '.related-articles', '.more-news', '.additional-stories',
            '#related', '#recommended', '#sidebar',
        ]
        for selector in related_selectors:
            for elem in soup.select(selector):
                elem.decompose()

        # Remove author bio / about-the-author sections
        author_selectors = [
            '[class*="author"]', '[class*="byline"]', '[class*="bio"]',
            '[class*="contributor"]', '[class*="writer"]', '[class*="about-the-author"]',
            '[id*="author"]', '[id*="byline"]', '[id*="bio"]',
            '[data-module*="author"]', '[data-component*="author"]',
            '.author-box', '.author-info', '.author-card', '.author-profile',
        ]
        for selector in author_selectors:
            for elem in soup.select(selector):
                elem.decompose()
        
        # Find main content area
        content_selectors = [
            'article', '.article-content', '.post-content', '.entry-content',
            '.content', 'main', '.main-content', '.story-body', '.article-body'
        ]
        
        content_area = None
        for selector in content_selectors:
            content_area = soup.select_one(selector)
            if content_area:
                break
        
        if not content_area:
            content_area = soup.body if soup.body else soup
        
        # Get all paragraphs to establish position context
        paragraphs = content_area.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
        
        # Find all images in content area
        img_tags = content_area.find_all('img')
        
        for img in img_tags:
            src = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
            if not src:
                continue
            
            # Skip tiny images (icons, tracking pixels)
            width = img.get('width', '')
            height = img.get('height', '')
            try:
                if width and int(width) < 100:
                    continue
                if height and int(height) < 100:
                    continue
            except (ValueError, TypeError):
                pass
            
            # Skip common non-content image patterns
            src_lower = src.lower()
            if any(skip in src_lower for skip in ['logo', 'icon', 'avatar', 'ad-', 'tracking', 'pixel', 'badge', 'button', 'play.svg', '.svg', 'sprite', 'spacer']):
                continue

            # Skip images that look like thumbnails (common in related articles)
            # Thumbnail patterns: 400x300, 300x200, 150x150, -thumb, -thumbnail, etc.
            if any(thumb_pattern in src_lower for thumb_pattern in [
                '400x300', '300x200', '200x150', '150x150', '100x100', '80x80',
                '-thumb', '-thumbnail', '_thumb', '_thumbnail', '/thumb/', '/thumbnails/',
                'small-', 'teaser-', 'preview-'
            ]):
                continue

            # Skip images inside links that look like related article links
            parent_link = img.find_parent('a')
            if parent_link:
                href = parent_link.get('href', '').lower()
                # If parent link goes to another article, this is likely a related article thumbnail
                link_text = parent_link.get_text().strip()
                # Skip if link has substantial text (article title) - indicates related article
                if link_text and len(link_text) > 20 and href and '/news/' in href:
                    continue
            
            # Resolve relative URLs
            full_url = urljoin(base_url, src)
            
            # Get alt text
            alt = img.get('alt', '').strip()
            
            # Skip if alt text indicates it's a non-content image
            alt_lower = alt.lower()
            if any(skip in alt_lower for skip in ['logo', 'icon', 'advertisement', 'ad ', 'sponsor']):
                continue

            # Skip author headshot/bio images
            if any(pattern in alt_lower for pattern in [
                'picture of', 'headshot', 'portrait', 'profile photo',
                'author photo', 'contributor', 'head shot',
            ]):
                continue

            # Skip images inside author/bio containers that survived earlier removal
            author_ancestor = False
            for parent_el in img.parents:
                parent_classes = ' '.join(parent_el.get('class', [])).lower()
                parent_id = (parent_el.get('id') or '').lower()
                if any(kw in parent_classes or kw in parent_id for kw in [
                    'author', 'byline', 'bio', 'contributor', 'writer',
                ]):
                    author_ancestor = True
                    break
            if author_ancestor:
                continue
            
            # Try to find caption (figcaption or nearby text)
            caption = ''
            parent = img.parent
            if parent and parent.name == 'figure':
                figcaption = parent.find('figcaption')
                if figcaption:
                    caption = figcaption.get_text().strip()
            
            # Skip if caption is a FILE - type caption (will be filtered anyway)
            if caption and re.match(r'^FILE\s*[-–—:]', caption, re.IGNORECASE):
                caption = ''  # Clear the caption, image is still valid
            
            # Determine position: find nearest paragraph before this image
            position = 0
            for idx, para in enumerate(paragraphs):
                # Check if paragraph comes before image in document
                if img in para.find_all_next():
                    break
                position = idx
            
            images.append({
                'url': full_url,
                'alt': alt if alt and len(alt) < 500 else '',  # Skip overly long alt text
                'caption': caption[:500] if caption else '',  # Limit caption length
                'position_after_paragraph': position
            })
        
        # Deduplicate by URL and by base filename (same image at different sizes)
        seen_urls = set()
        seen_basenames = set()
        unique_images = []
        for img in images:
            if img['url'] in seen_urls:
                continue
            # Extract base filename without query params/size suffixes
            from urllib.parse import urlparse
            path = urlparse(img['url']).path
            basename = path.rsplit('/', 1)[-1].split('?')[0] if path else ''
            if basename and basename in seen_basenames:
                continue  # Same image at different size/resolution
            seen_urls.add(img['url'])
            if basename:
                seen_basenames.add(basename)
            unique_images.append(img)
        
        # Limit to 8 images max - most articles have 2-5 real content images
        # More than that usually indicates we're picking up unrelated images
        max_images = 8
        result_count = len(unique_images[:max_images])
        logger.info(f"📸 IMAGE EXTRACTION: {result_count} images from {base_url[:60]}...")
        if result_count > 0:
            logger.info(f"   └─ First image: {unique_images[0]['url'][:80]}...")
        return unique_images[:max_images]
        
    except Exception as e:
        logger.error(f"Failed to extract inline images: {e}")
        return []
