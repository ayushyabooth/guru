"""
Image Scraping Service

Scrapes images from article URLs with validation and timeout handling.
"""
import logging
import requests
from typing import Optional
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)


class ImageScrapingService:
    """Service for scraping and validating article images"""
    
    # Timeout settings
    SOFT_TIMEOUT = 5.0  # seconds (increased for slow sites)
    IMAGE_TIMEOUT = 3.0  # seconds for image validation
    
    # Image dimension constraints (relaxed for more results)
    MIN_WIDTH = 200  # Reduced from 300
    MAX_WIDTH = 8000
    MIN_HEIGHT = 150  # Reduced from 200
    MAX_HEIGHT = 8000
    
    # Aspect ratio constraints (relaxed)
    ASPECT_RATIO_MIN = 0.2  # Tall images (1:5)
    ASPECT_RATIO_MAX = 5.0  # Wide images (5:1)
    
    # Suspicious patterns to filter out
    SUSPICIOUS_PATTERNS = [
        'ad', 'logo', 'twitter', 'facebook', 'linkedin', 
        'icon', '1x1', 'pixel', 'badge', 'button', 'banner'
    ]
    
    def scrape_image_url(self, article_url: str) -> Optional[str]:
        """
        Scrape primary image from article URL.
        
        Strategy:
        1. Fetch article with soft timeout
        2. Look for og:image meta tag (most reliable)
        3. Extract images from content
        4. Validate dimensions + aspect ratio
        5. Return first valid image URL
        
        Args:
            article_url: URL of the article to scrape
            
        Returns:
            Image URL string or None if no valid image found
        """
        try:
            # Fetch article with timeout
            response = requests.get(
                article_url, 
                timeout=self.SOFT_TIMEOUT,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; GuruBot/1.0)'}
            )
            response.raise_for_status()
            
        except requests.exceptions.Timeout:
            logger.warning(f"Image scrape timeout for {article_url}")
            return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"Error fetching article {article_url}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error fetching article: {e}")
            return None
        
        try:
            # Parse HTML
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Strategy 1: Try og:image meta tag first (most reliable) - TRUST IT without full validation
            og_image = soup.find('meta', property='og:image')
            if og_image and og_image.get('content'):
                image_url = og_image['content']
                # Handle relative URLs
                if image_url.startswith('//'):
                    image_url = 'https:' + image_url
                elif image_url.startswith('/'):
                    image_url = urljoin(article_url, image_url)
                # Trust og:image - it's usually the hero image
                if image_url.startswith('http'):
                    logger.info(f"Found og:image for {article_url}")
                    return image_url
            
            # Strategy 2: Try twitter:image meta tag - also trust it
            twitter_image = soup.find('meta', attrs={'name': 'twitter:image'})
            if twitter_image and twitter_image.get('content'):
                image_url = twitter_image['content']
                if image_url.startswith('//'):
                    image_url = 'https:' + image_url
                elif image_url.startswith('/'):
                    image_url = urljoin(article_url, image_url)
                if image_url.startswith('http'):
                    logger.info(f"Found twitter:image for {article_url}")
                    return image_url
            
            # Strategy 3: Extract images from article content
            # Look for images in article body (common class names)
            article_containers = soup.find_all(['article', 'main', 'div'], 
                                              class_=['article', 'post', 'content', 'entry'])
            
            for container in article_containers:
                for img in container.find_all('img'):
                    img_url = img.get('src') or img.get('data-src')
                    if img_url and self._is_valid_image(img_url, article_url):
                        logger.info(f"Found content image for {article_url}")
                        return img_url
            
            # Strategy 4: Any img tag in body (last resort)
            for img in soup.find_all('img'):
                img_url = img.get('src') or img.get('data-src')
                if img_url and self._is_valid_image(img_url, article_url):
                    logger.info(f"Found fallback image for {article_url}")
                    return img_url
            
            logger.info(f"No valid images found for {article_url}")
            return None
            
        except Exception as e:
            logger.error(f"Error parsing HTML for {article_url}: {e}")
            return None
    
    def _is_valid_image(self, image_url: str, article_url: str) -> bool:
        """
        Validate image URL:
        - Must be absolute URL
        - Must be accessible
        - Must have valid dimensions
        - Must have valid aspect ratio
        - Must not be ad/logo/social embed
        
        Args:
            image_url: URL of the image to validate
            article_url: URL of the article (for relative URL resolution)
            
        Returns:
            True if image is valid, False otherwise
        """
        try:
            # Handle relative URLs
            if image_url.startswith('//'):
                image_url = 'https:' + image_url
            elif image_url.startswith('/'):
                image_url = urljoin(article_url, image_url)
            
            # Must be http/https
            parsed = urlparse(image_url)
            if parsed.scheme not in ['http', 'https']:
                return False
            
            # Filter out suspicious patterns
            image_url_lower = image_url.lower()
            if any(pattern in image_url_lower for pattern in self.SUSPICIOUS_PATTERNS):
                logger.debug(f"Filtered suspicious image: {image_url}")
                return False
            
            # Fetch image with timeout
            img_response = requests.get(
                image_url, 
                timeout=self.IMAGE_TIMEOUT,
                stream=True,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; GuruBot/1.0)'}
            )
            img_response.raise_for_status()
            
            # Validate content type
            content_type = img_response.headers.get('Content-Type', '')
            if not content_type.startswith('image/'):
                logger.debug(f"Invalid content type: {content_type}")
                return False
            
            # Validate dimensions
            img = Image.open(BytesIO(img_response.content))
            width, height = img.size
            
            if not (self.MIN_WIDTH <= width <= self.MAX_WIDTH):
                logger.debug(f"Invalid width: {width}")
                return False
            
            if not (self.MIN_HEIGHT <= height <= self.MAX_HEIGHT):
                logger.debug(f"Invalid height: {height}")
                return False
            
            # Validate aspect ratio
            aspect_ratio = width / height
            if not (self.ASPECT_RATIO_MIN <= aspect_ratio <= self.ASPECT_RATIO_MAX):
                logger.debug(f"Invalid aspect ratio: {aspect_ratio}")
                return False
            
            logger.debug(f"Valid image: {image_url} ({width}x{height})")
            return True
            
        except requests.exceptions.Timeout:
            logger.debug(f"Image validation timeout: {image_url}")
            return False
        except requests.exceptions.RequestException as e:
            logger.debug(f"Image validation request error: {e}")
            return False
        except Exception as e:
            logger.debug(f"Image validation failed: {e}")
            return False
