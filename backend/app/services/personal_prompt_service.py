"""
Personal Prompt Service

Generates contextual, <12 word personal prompts for storyboard cards
using Claude Haiku 4.5 for fast, cost-effective generation.

Roles are derived dynamically from IndustriesConfig (central config) —
no hardcoded industry/specialization maps.
"""
import logging
import re
from typing import Optional
from anthropic import Anthropic
from app.config import settings
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)


class PersonalPromptService:
    """Service for generating personal prompts for storyboards"""

    def __init__(self):
        """Initialize the service with Anthropic client"""
        try:
            self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            logger.info("PersonalPromptService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize PersonalPromptService: {e}")
            self.client = None

    def _get_role_from_config(self, spec_id: str) -> str:
        """Derive a role label from the central industries config.

        Looks up the sub-industry display name and its parent industry name
        from IndustriesConfig, then constructs a role like
        'Food & Beverage professional in Consumer'.
        Falls back to 'Industry Executive' if lookup fails.
        """
        try:
            config = IndustriesConfig.get_instance()
            for industry in config._config.get("industries", []):
                for spec in industry.get("specializations", []):
                    if spec["id"] == spec_id:
                        return f"{spec['name']} professional in {industry['name']}"
        except Exception:
            pass
        return "Industry Executive"

    def generate_prompt(
        self,
        user_spec: str,
        theme: str,
        summary: str,
        max_retries: int = 2
    ) -> Optional[str]:
        """
        Generate a personal, contextual prompt for a storyboard.

        Args:
            user_spec: User's specialization ID (e.g., "food_beverage")
            theme: Storyboard theme/headline
            summary: Storyboard summary
            max_retries: Number of retry attempts if generation fails

        Returns:
            Personal prompt string (<12 words) or None if generation fails
        """
        if not self.client:
            logger.warning("Anthropic client not initialized, skipping prompt generation")
            return None

        # Derive role dynamically from central config
        role = self._get_role_from_config(user_spec)

        # Construct prompt for Claude
        system_prompt = """You are an expert at generating thought-provoking, actionable questions
for business professionals. Generate questions that:
- Hook the reader with strategic implications
- Are extremely concise (under 12 words)
- Start with "How", "What", "Why", "Should", "Could"
- Are specific to the reader's role and industry
- Drive strategic thinking and action

CRITICAL: Output ONLY the question. No word counts, no explanations, no extra text."""

        user_prompt = f"""Generate ONE strategic question for a {role} reading about: {theme}

Summary: {summary}

Requirements:
- EXACTLY 11 words or fewer (count carefully)
- Question format that hooks the reader
- Specific to their role as {role}
- Implies strategic importance and urgency
- NO word count, NO explanations, JUST the question

Examples:
- "How would this reshape your unit economics?"
- "Should you pivot your pricing strategy now?"
- "What does this mean for your Q2 roadmap?"

Generate ONLY the question:"""
        
        for attempt in range(max_retries + 1):
            try:
                response = self.client.messages.create(
                    model=settings.CLAUDE_HAIKU_MODEL,  # Claude Haiku 4.5 from env - fast & cheap
                    max_tokens=50,
                    temperature=0.7,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}]
                )
                
                prompt = response.content[0].text.strip()
                
                # Remove quotes if present
                prompt = prompt.strip('"').strip("'")
                
                # Remove any debug text like "(Word count: X)" or "**Word count: X**"
                prompt = re.sub(r'\s*\(Word count:.*?\)', '', prompt, flags=re.IGNORECASE)
                prompt = re.sub(r'\s*\*\*Word count:.*?\*\*', '', prompt, flags=re.IGNORECASE)
                prompt = re.sub(r'\s*Word count:.*$', '', prompt, flags=re.IGNORECASE)
                prompt = prompt.strip()
                
                # Validate word count
                word_count = len(prompt.split())
                if word_count <= 12:
                    logger.info(f"Generated prompt ({word_count} words): {prompt}")
                    return prompt
                else:
                    logger.warning(f"Generated prompt too long ({word_count} words), retrying...")
                    if attempt < max_retries:
                        continue
                    else:
                        # Truncate to 12 words as fallback
                        words = prompt.split()[:12]
                        truncated = ' '.join(words)
                        if not truncated.endswith('?'):
                            truncated += '?'
                        logger.warning(f"Using truncated prompt: {truncated}")
                        return truncated
                        
            except Exception as e:
                logger.error(f"Error generating prompt (attempt {attempt + 1}/{max_retries + 1}): {e}")
                if attempt < max_retries:
                    continue
                else:
                    return None
        
        return None
    
    def generate_fallback_prompt(self, user_spec: str) -> str:
        """
        Generate a generic fallback prompt if LLM generation fails.

        Args:
            user_spec: User's specialization ID

        Returns:
            Generic but relevant prompt using the sub-industry name from config
        """
        role = self._get_role_from_config(user_spec)
        if role != "Industry Executive":
            # Extract just the sub-industry name for a cleaner fallback
            spec_name = role.split(" professional in ")[0] if " professional in " in role else role
            return f"How would this impact your {spec_name} strategy?"
        return "How would this impact your strategy?"
