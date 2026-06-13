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
            # NOTE: context_summary is NOT generated here — it's lazily generated
            # on first Q&A access via ensure_context_summary() to save tokens.
            # Most articles are never opened for Q&A, so generating upfront is wasteful.
            from app.config import settings
            response = self.claude.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                # 1300: 5 display fields + 3 crux fields (GUR-231). This is a cap,
                # not spend — billing is on tokens actually generated.
                max_tokens=1300,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Parse response
            content = response.content[0].text
            parsed = self._parse_response(content)
            
            if not parsed:
                logger.warning(f"Failed to parse rich content for article {article.id}")
                return None
            
            # Create and save the rich content (context_summary deferred, see above)
            rich_content = ArticleRichContent(
                article_id=article.id,
                summary_whats_in=parsed.get("whats_in", ""),
                summary_why_matters=parsed.get("why_matters", ""),
                summary_between_lines=parsed.get("between_lines", ""),
                spotlight_quotes=parsed.get("spotlight_quotes", []),
                socratic_prompts=parsed.get("socratic_prompts", []),
                core_argument=parsed.get("core_argument"),
                strongest_evidence=parsed.get("strongest_evidence", []),
                counterpoints=parsed.get("counterpoints", []),
                context_summary=None,  # Lazy — generated on first Q&A access
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
    
    def regenerate_rich_content(
        self,
        article: Article,
        industry: str,
        specialization: str,
        existing: Optional[ArticleRichContent] = None,
    ) -> Optional[ArticleRichContent]:
        """
        Re-run the SAME single-pass generation and update the existing row
        in place (GUR-231 crux backfill). Preserves context_summary (which is
        lazily generated and expensive) and avoids delete-then-insert, so a
        failed LLM call never destroys an existing row.

        Falls back to generate_rich_content() if no row exists yet.
        """
        if existing is None:
            existing = self.db.query(ArticleRichContent).filter(
                ArticleRichContent.article_id == article.id
            ).first()
        if existing is None:
            return self.generate_rich_content(article, industry, specialization)

        try:
            article_text = self._get_article_text(article)
            if not article_text:
                logger.warning(f"No text available for article {article.id}")
                return None

            prompt = self._build_prompt(
                article_title=article.title,
                article_text=article_text,
                article_source=article.source,
                industry=industry,
                specialization=specialization,
                related_articles=[]
            )

            from app.config import settings
            response = self.claude.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=1300,
                messages=[{"role": "user", "content": prompt}]
            )
            parsed = self._parse_response(response.content[0].text)
            if not parsed:
                logger.warning(f"Failed to parse regenerated rich content for article {article.id}")
                return None

            existing.summary_whats_in = parsed.get("whats_in", "")
            existing.summary_why_matters = parsed.get("why_matters", "")
            existing.summary_between_lines = parsed.get("between_lines", "")
            existing.spotlight_quotes = parsed.get("spotlight_quotes", [])
            existing.socratic_prompts = parsed.get("socratic_prompts", [])
            existing.core_argument = parsed.get("core_argument")
            existing.strongest_evidence = parsed.get("strongest_evidence", [])
            existing.counterpoints = parsed.get("counterpoints", [])
            existing.industry_context = industry
            existing.specialization_context = specialization
            existing.model_used = settings.CLAUDE_HAIKU_MODEL
            # context_summary intentionally untouched — lazily generated, still valid

            self.db.commit()
            self.db.refresh(existing)
            logger.info(f"Regenerated rich content (crux backfill) for article {article.id}")
            return existing

        except Exception as e:
            logger.error(f"Error regenerating rich content for article {article.id}: {e}")
            self.db.rollback()
            return None

    def ensure_context_summary(self, article: Article) -> Optional[str]:
        """
        Lazily generate the dense Q&A context summary on first access.
        Cached on ArticleRichContent.context_summary after first call.

        Cost: one Haiku call (~1500 tokens out) per article the first time
        any user opens Q&A for it. Most articles never hit this path.
        """
        rc = self.db.query(ArticleRichContent).filter(
            ArticleRichContent.article_id == article.id
        ).first()

        if rc and rc.context_summary:
            return rc.context_summary

        article_text = self._get_article_text(article)
        if not article_text:
            return None

        from app.config import settings
        prompt = f"""Write a dense factual summary of this article optimized for use as Q&A context. Include all key facts, data points, names, dates, quotes, and arguments. Be comprehensive and factual, not editorial. Aim for 500-1000 words. This is NOT user-facing — it will be used as context for an AI assistant answering questions.

ARTICLE TITLE: {article.title}
SOURCE: {article.source}

ARTICLE CONTENT:
{article_text}

Return only the summary, no preamble."""

        try:
            response = self.claude.client.messages.create(
                model=settings.CLAUDE_HAIKU_MODEL,
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}]
            )
            summary = response.content[0].text.strip()

            if rc:
                rc.context_summary = summary
                self.db.commit()
            else:
                # Shouldn't usually happen — rich content is generated at ingestion
                rc = ArticleRichContent(
                    article_id=article.id,
                    context_summary=summary,
                    model_used=settings.CLAUDE_HAIKU_MODEL,
                )
                self.db.add(rc)
                self.db.commit()

            logger.info(f"Lazily generated context_summary for article {article.id}")
            return summary
        except Exception as e:
            logger.error(f"Failed to lazy-generate context_summary for {article.id}: {e}")
            self.db.rollback()
            return None

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

6. "core_argument" (1-2 sentences): The article's thesis — what the author is really claiming, stated plainly.

7. "strongest_evidence" (array of 2-3 short strings): The strongest support in the piece. Each bullet is one crisp sentence citing a specific fact, data point, or argument from the article.

8. "counterpoints" (array of exactly 2 short strings): The strongest objections to the core argument — what a sharp skeptic would say, or what evidence would change the author's mind. One crisp sentence each.

Return ONLY valid JSON with these 8 keys. Example format:
{{
  "whats_in": "...",
  "why_matters": "...",
  "between_lines": "...",
  "spotlight_quotes": ["quote 1", "quote 2"],
  "socratic_prompts": ["question 1?", "question 2?", "question 3?"],
  "core_argument": "...",
  "strongest_evidence": ["bullet 1", "bullet 2"],
  "counterpoints": ["objection 1", "objection 2"]
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

            # Crux fields (GUR-231) — soft validation: never fail the whole
            # generation if the model omits or mistypes them.
            if not isinstance(parsed.get("core_argument"), str):
                parsed["core_argument"] = None
            for crux_list in ("strongest_evidence", "counterpoints"):
                value = parsed.get(crux_list)
                if not isinstance(value, list):
                    parsed[crux_list] = []
                else:
                    parsed[crux_list] = [str(item) for item in value if item]

            return parsed
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            return None
