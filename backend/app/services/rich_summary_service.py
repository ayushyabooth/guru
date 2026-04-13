"""
Rich Summary Service for P1 "In Focus" Storyboard Experience

Generates multi-part summaries and Socratic prompts for articles using Claude.
"""
import logging
import json
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from app.models.article import Article, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.utils.llm_utils import get_claude_client

logger = logging.getLogger(__name__)


class RichSummaryService:
    """
    Service for generating rich article summaries with multiple components:
    - What's in the article
    - Why it matters to you (personalized)
    - Between the lines (hidden context)
    - Spotlight quotes
    - Socratic prompts
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.claude = get_claude_client()
    
    def generate_rich_content(
        self,
        article: Article,
        industry: str,
        specialization: str,
        related_article_titles: Optional[List[str]] = None
    ) -> Optional[ArticleRichContent]:
        """
        Generate rich content for an article.
        
        Args:
            article: The article to generate content for
            industry: User's industry context (e.g., "Consumer")
            specialization: User's specialization (e.g., "Food & Beverage")
            related_article_titles: Titles of related articles in the same storyboard
            
        Returns:
            ArticleRichContent object or None if generation fails
        """
        try:
            # Get article text (fallback to expert notes if paywalled)
            article_text = self._get_article_text(article)
            if not article_text:
                logger.warning(f"No text available for article {article.id}")
                return None
            
            # Build the prompt
            prompt = self._build_prompt(
                article_title=article.title,
                article_text=article_text,
                article_source=article.source,
                industry=industry,
                specialization=specialization,
                related_articles=related_article_titles or []
            )
            
            # Call Claude (use client.messages since self.claude is ClaudeClient wrapper)
            from app.config import settings
            response = self.claude.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=3000,  # Increased for context_summary field
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Parse response
            content = response.content[0].text
            parsed = self._parse_response(content)
            
            if not parsed:
                logger.warning(f"Failed to parse rich content for article {article.id}")
                return None
            
            # Create and save the rich content
            rich_content = ArticleRichContent(
                article_id=article.id,
                summary_whats_in=parsed.get("whats_in", ""),
                summary_why_matters=parsed.get("why_matters", ""),
                summary_between_lines=parsed.get("between_lines", ""),
                spotlight_quotes=parsed.get("spotlight_quotes", []),
                socratic_prompts=parsed.get("socratic_prompts", []),
                context_summary=parsed.get("context_summary", ""),
                industry_context=industry,
                specialization_context=specialization,
                model_used=settings.CLAUDE_HAIKU_MODEL
            )
            
            self.db.add(rich_content)
            self.db.commit()
            self.db.refresh(rich_content)
            
            logger.info(f"Generated rich content for article {article.id}")
            return rich_content
            
        except Exception as e:
            logger.error(f"Error generating rich content for article {article.id}: {e}")
            self.db.rollback()
            return None
    
    def get_or_generate_rich_content(
        self,
        article: Article,
        industry: str,
        specialization: str,
        related_article_titles: Optional[List[str]] = None
    ) -> Optional[ArticleRichContent]:
        """
        Get existing rich content or generate new if not exists.
        """
        # Check for existing
        existing = self.db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id == article.id
        ).first()
        
        if existing:
            return existing
        
        # Generate new
        return self.generate_rich_content(
            article, industry, specialization, related_article_titles
        )
    
    def _get_article_text(self, article: Article) -> Optional[str]:
        """Get article text, falling back to expert notes if paywalled."""
        if article.raw_text and len(article.raw_text) > 100:
            return article.raw_text[:5000]  # Limit to 5000 chars
        
        # Try expert notes
        expert_note = self.db.query(ExpertNote).filter(
            ExpertNote.article_id == article.id
        ).first()
        
        if expert_note and expert_note.notes_text:
            return f"Expert notes: {expert_note.notes_text}"
        
        return None
    
    def _build_prompt(
        self,
        article_title: str,
        article_text: str,
        article_source: str,
        industry: str,
        specialization: str,
        related_articles: List[str]
    ) -> str:
        """Build the prompt for Claude."""
        related_context = ""
        if related_articles:
            related_context = f"\n\nRelated articles in this storyboard cluster:\n" + "\n".join(f"- {title}" for title in related_articles[:5])
        
        return f"""You are an expert business analyst helping professionals stay informed. Analyze this article and generate rich content for a {specialization} professional in the {industry} industry.

ARTICLE TITLE: {article_title}
SOURCE: {article_source}

ARTICLE CONTENT:
{article_text}
{related_context}

Generate the following components in JSON format:

1. "whats_in" (2-3 sentences): Summarize the key content of the article. Be concise and factual.

2. "why_matters" (2-3 sentences): Explain why this matters specifically to a {specialization} professional. Be specific about implications for their work, decisions, or strategy.

3. "between_lines" (2-3 sentences): Identify hidden context, unstated assumptions, or connections to broader industry trends. If related articles are provided, connect the dots between them.

4. "spotlight_quotes" (array of 0-3 strings): Extract the most meaningful quotes from the article that a professional would want to remember. Only include if genuinely impactful. If no great quotes, return empty array.

5. "socratic_prompts" (array of 2-4 strings): Generate thought-provoking questions using the Socratic method. Questions should:
   - Challenge assumptions
   - Encourage application to the reader's work
   - Prompt deeper thinking about implications
   - Be specific to {specialization} context

6. "context_summary" (string, 500-1000 words): Write a dense factual summary of the article optimized for use as Q&A context. Include all key facts, data points, names, dates, and arguments. This is NOT user-facing — it will be used as context for an AI assistant answering questions about the article. Be comprehensive and factual, not editorial.

Return ONLY valid JSON with these 6 keys. Example format:
{{
  "whats_in": "...",
  "why_matters": "...",
  "between_lines": "...",
  "spotlight_quotes": ["quote 1", "quote 2"],
  "socratic_prompts": ["question 1?", "question 2?", "question 3?"],
  "context_summary": "..."
}}"""
    
    def _parse_response(self, content: str) -> Optional[Dict[str, Any]]:
        """Parse the JSON response from Claude."""
        try:
            # Try to find JSON in the response
            content = content.strip()
            
            # Handle markdown code blocks
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1])
            
            parsed = json.loads(content)
            
            # Validate required fields
            required = ["whats_in", "why_matters", "between_lines", "socratic_prompts"]
            for field in required:
                if field not in parsed:
                    logger.warning(f"Missing required field: {field}")
                    return None
            
            # Ensure arrays
            if not isinstance(parsed.get("spotlight_quotes"), list):
                parsed["spotlight_quotes"] = []
            if not isinstance(parsed.get("socratic_prompts"), list):
                parsed["socratic_prompts"] = []
            
            return parsed
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            return None
