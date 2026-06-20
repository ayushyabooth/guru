"""
Cluster Narrative Service

Generates "Also in this story:" narratives with colored bullets
and LLM-generated context for storyboard cards.
"""
import logging
from typing import List, Optional
from app.models.article import Article
from app.config import settings
from anthropic import Anthropic

logger = logging.getLogger(__name__)


class ClusterNarrativeService:
    """Service for generating cluster narratives for storyboards"""
    
    # Colored bullets that rotate through articles
    BULLETS = ['🔵', '🟢', '🟡']
    
    def __init__(self):
        """Initialize the service with Anthropic client"""
        try:
            self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            logger.info("ClusterNarrativeService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ClusterNarrativeService: {e}")
            self.client = None
    
    def generate_narrative(
        self,
        articles: List[Article],
        theme: Optional[str] = None,
        include_context: bool = True
    ) -> Optional[str]:
        """
        Generate "Also in this story:" format with colored bullets.
        
        Format:
        Also in this story:
        🔵 Article Title (X min)
        🟢 Article Title (Y min)
        🟡 Article Title (Z min)
        
        Args:
            articles: List of articles in the cluster (includes headline)
            
        Returns:
            Formatted narrative string or None if insufficient articles
        """
        try:
            # Need at least 2 articles total (1 headline + 1 related)
            if not articles or len(articles) < 2:
                logger.info(f"Not enough articles ({len(articles) if articles else 0}) for narrative")
                return None
            
            lines = []
            
            # Generate context explanation if requested and theme provided
            if include_context and theme and self.client:
                context = self.generate_context_explanation(theme, articles)
                if context:
                    lines.append(context)
                    lines.append("")  # Blank line for spacing
            
            lines.append("Also in this story:")
            
            # Use articles 1-5 (skip index 0, which is the headline)
            # Show up to 5 related articles
            related_articles = articles[1:6]
            
            for i, article in enumerate(related_articles):
                bullet = self.BULLETS[i % len(self.BULLETS)]
                
                # Calculate reading time (estimate if not available)
                reading_time = self._get_reading_time(article)
                
                # Truncate title if too long
                title = self._truncate_title(article.title, max_length=50)
                
                # Format: 🔵 Article Title (X min)
                line = f"{bullet} {title} ({reading_time} min)"
                lines.append(line)
            
            narrative = "\n".join(lines)
            logger.info(f"Generated narrative with {len(related_articles)} articles")
            return narrative
            
        except Exception as e:
            logger.error(f"Error generating cluster narrative: {e}")
            return None
    
    def generate_context_explanation(
        self,
        theme: str,
        articles: List[Article],
        max_retries: int = 2
    ) -> Optional[str]:
        """
        Generate LLM-powered context explaining why these articles are grouped.
        
        Format: "These articles explore [common theme/angle] from different perspectives."
        
        Args:
            theme: Storyboard theme
            articles: List of articles in the cluster
            max_retries: Number of retry attempts
            
        Returns:
            Context explanation string or None
        """
        if not self.client:
            logger.warning("Anthropic client not initialized, skipping context generation")
            return None
        
        if not articles or len(articles) < 2:
            return None
        
        try:
            # Collect article titles
            titles = [a.title for a in articles[:4] if a.title]  # Use up to 4 articles
            titles_text = "\n".join([f"- {title}" for title in titles])
            
            prompt = f"""Given this cluster theme and article titles, write 2-3 concise sentences (30-50 words total) explaining what connects these articles and why they matter.

Theme: {theme}

Articles:
{titles_text}

Requirements:
- 2-3 sentences (30-50 words total)
- Start with "These articles" or "This cluster"
- First sentence: Explain the common thread/perspective
- Second sentence: Add context on why this matters or what's at stake
- Professional and insightful
- No quotes or extra formatting

Example: "These articles explore how Gen Z spending habits are reshaping restaurant strategies across delivery and in-store experiences. The shift represents a fundamental change in how QSR brands must balance digital convenience with authentic in-person engagement to capture this demographic."

Context:"""
            
            for attempt in range(max_retries + 1):
                try:
                    response = self.client.messages.create(
                        model=settings.CLAUDE_HAIKU_MODEL,  # Fast & cheap
                        max_tokens=100,  # Increased for 2-3 sentences
                        temperature=0.5,
                        messages=[{"role": "user", "content": prompt}]
                    )

                    from app.services.usage_logging import log_claude_usage  # GUR-238
                    log_claude_usage(response, "cluster_narrative", model=settings.CLAUDE_HAIKU_MODEL)

                    context = response.content[0].text.strip()
                    
                    # Remove quotes if present
                    context = context.strip('"').strip("'")
                    
                    # Validate word count (30-60 words is acceptable for 2-3 sentences)
                    word_count = len(context.split())
                    if 25 <= word_count <= 70:
                        logger.info(f"Generated context ({word_count} words): {context}")
                        return context
                    else:
                        logger.warning(f"Context length off ({word_count} words), retrying...")
                        if attempt < max_retries:
                            continue
                        else:
                            # Use it anyway if we're out of retries
                            return context
                            
                except Exception as e:
                    logger.error(f"Error generating context (attempt {attempt + 1}): {e}")
                    if attempt < max_retries:
                        continue
                    else:
                        return None
            
            return None
            
        except Exception as e:
            logger.error(f"Error generating context explanation: {e}")
            return None
    
    def _get_reading_time(self, article: Article) -> int:
        """
        Get reading time for an article.
        
        Args:
            article: Article object
            
        Returns:
            Reading time in minutes
        """
        # If word_count is available, calculate reading time
        # Average reading speed: 200-250 words per minute
        # We'll use 225 words/min
        if article.word_count and article.word_count > 0:
            reading_time = max(1, round(article.word_count / 225))
            return reading_time
        
        # Fallback: estimate based on whether it's paywalled
        # Paywalled articles tend to be longer
        if article.is_paywalled:
            return 8  # Assume longer article
        else:
            return 5  # Assume medium article
    
    def _truncate_title(self, title: str, max_length: int = 50) -> str:
        """
        Truncate article title if too long.
        
        Args:
            title: Article title
            max_length: Maximum length before truncation
            
        Returns:
            Truncated title with ellipsis if needed
        """
        if not title:
            return "Untitled Article"
        
        if len(title) <= max_length:
            return title
        
        # Truncate and add ellipsis
        return title[:max_length].rsplit(' ', 1)[0] + "..."
    
    def generate_narrative_from_article_data(
        self,
        article_data: List[dict]
    ) -> Optional[str]:
        """
        Generate narrative from article dictionaries (for API responses).
        
        Args:
            article_data: List of article dicts with title, word_count, is_paywalled
            
        Returns:
            Formatted narrative string or None
        """
        try:
            if not article_data or len(article_data) < 2:
                return None
            
            lines = ["Also in this story:"]
            
            # Use articles 1-3 (skip first, which is headline)
            for i, article_dict in enumerate(article_data[1:4]):
                bullet = self.BULLETS[i % len(self.BULLETS)]
                
                # Get reading time
                word_count = article_dict.get('word_count', 0)
                is_paywalled = article_dict.get('is_paywalled', False)
                
                if word_count and word_count > 0:
                    reading_time = max(1, round(word_count / 225))
                else:
                    reading_time = 8 if is_paywalled else 5
                
                # Get and truncate title
                title = article_dict.get('title', 'Untitled Article')
                if len(title) > 50:
                    title = title[:50].rsplit(' ', 1)[0] + "..."
                
                line = f"{bullet} {title} ({reading_time} min)"
                lines.append(line)
            
            return "\n".join(lines)
            
        except Exception as e:
            logger.error(f"Error generating narrative from article data: {e}")
            return None
