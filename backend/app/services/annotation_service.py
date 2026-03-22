"""
Annotation Generation Service for Reader Mode
Uses Claude AI to analyze article content and generate contextually relevant inline annotations.
"""
import logging
import json
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
import uuid

from app.utils.llm_utils import ClaudeClient
from app.services.ingestion_service import extract_structured_content
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)


class AnnotationService:
    """Service for generating and managing inline annotations for Reader Mode."""
    
    # Annotation types
    ANNOTATION_TYPES = {
        'reflection': {
            'icon': '💭',
            'label': 'Moment of Reflection',
            'description': 'Prompts deeper thinking about the content'
        },
        'expert_insight': {
            'icon': '💡', 
            'label': 'Expert Insight',
            'description': 'Expert notes and takeaways at relevant sections'
        },
        'leading_question': {
            'icon': '❓',
            'label': 'Leading Question', 
            'description': 'Socratic method prompts for engagement'
        }
    }
    
    def __init__(self):
        self.claude_client = ClaudeClient()
    
    def generate_annotations_for_article(
        self, 
        article_id: str,
        article_text: str,
        article_title: str,
        industry: Optional[str] = None,
        max_annotations: int = 3
    ) -> List[Dict]:
        """
        Generate inline annotations for an article using Claude AI.

        Args:
            article_id: UUID of the article
            article_text: Full cleaned article text
            article_title: Article headline
            industry: Industry context for relevant insights
            max_annotations: Maximum number of annotations to generate
            
        Returns:
            List of annotation dictionaries with position, type, and text
        """
        if not industry:
            try:
                _, industry = IndustriesConfig.get_instance().get_default_industry()
            except Exception:
                industry = "Consumer"

        if not article_text or len(article_text) < 200:
            logger.warning(f"Article {article_id} too short for annotations")
            return []

        # Parse article into sections
        sections = extract_structured_content(article_text)
        if len(sections) < 2:
            logger.warning(f"Article {article_id} has too few sections for annotations")
            return []
        
        # Build prompt for Claude
        prompt = self._build_annotation_prompt(
            article_title=article_title,
            sections=sections,
            industry=industry,
            max_annotations=max_annotations
        )
        
        try:
            # Call Claude to generate annotations
            response = self.claude_client.generate_raw(
                prompt=prompt,
                system_prompt=self._get_system_prompt(),
                max_tokens=2000
            )
            
            # Parse Claude's response
            annotations = self._parse_annotation_response(response, article_id, sections)
            logger.info(f"Generated {len(annotations)} annotations for article {article_id}")
            return annotations
            
        except Exception as e:
            logger.error(f"Error generating annotations for article {article_id}: {e}")
            return self._generate_fallback_annotations(article_id, sections)
    
    def _get_system_prompt(self) -> str:
        """Get the system prompt for annotation generation."""
        return """You are an expert content analyst for a professional knowledge platform. 
Your role is to analyze business articles and identify the most impactful moments for reader engagement.

You will generate inline annotations that:
1. Prompt deeper reflection on key insights
2. Provide expert context that adds value
3. Ask leading questions that encourage Socratic thinking

Guidelines:
- Place annotations at genuinely insightful moments, not just arbitrary positions
- Reflection prompts should connect the content to broader industry implications
- Expert insights should provide context readers might not have
- Leading questions should encourage strategic thinking
- Be concise but thought-provoking
- Tailor language to a professional, executive audience"""

    def _build_annotation_prompt(
        self, 
        article_title: str,
        sections: List[Dict],
        industry: str,
        max_annotations: int
    ) -> str:
        """Build the prompt for Claude to generate annotations."""
        
        # Format sections for the prompt
        sections_text = "\n\n".join([
            f"[Section {s['order']}]: {s['content'][:500]}{'...' if len(s['content']) > 500 else ''}"
            for s in sections[:15]  # Limit to first 15 sections
        ])
        
        return f"""Analyze this article and generate {max_annotations} inline annotations.

ARTICLE TITLE: {article_title}
INDUSTRY CONTEXT: {industry}

ARTICLE SECTIONS:
{sections_text}

Generate exactly {max_annotations} annotations. For each annotation, provide:
1. position_after_section: The section number (0-indexed) after which to place the annotation
2. type: One of "reflection", "expert_insight", or "leading_question"
3. text: The annotation text (1-2 sentences, thought-provoking)

IMPORTANT: 
- Spread annotations throughout the article (beginning, middle, end)
- Each annotation type should appear at least once if generating 3+ annotations
- Position numbers must be valid section indices (0 to {len(sections) - 1})

Return your response as a JSON array:
[
  {{"position_after_section": 0, "type": "reflection", "text": "..."}},
  {{"position_after_section": 4, "type": "expert_insight", "text": "..."}},
  {{"position_after_section": 8, "type": "leading_question", "text": "..."}}
]

Only output the JSON array, no other text."""

    def _parse_annotation_response(
        self, 
        response: str, 
        article_id: str,
        sections: List[Dict]
    ) -> List[Dict]:
        """Parse Claude's response into annotation dictionaries."""
        try:
            # Extract JSON from response
            response = response.strip()
            if response.startswith('```'):
                # Remove code block markers
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
            
            annotations_data = json.loads(response)
            
            annotations = []
            max_position = len(sections) - 1
            
            for ann in annotations_data:
                position = ann.get('position_after_section', 0)
                ann_type = ann.get('type', 'reflection')
                text = ann.get('text', '')
                
                # Validate
                if position < 0 or position > max_position:
                    position = min(max(0, position), max_position)
                
                if ann_type not in self.ANNOTATION_TYPES:
                    ann_type = 'reflection'
                
                if text and len(text) > 10:
                    annotations.append({
                        'id': str(uuid.uuid4()),
                        'article_id': article_id,
                        'position_after_section': position,
                        'type': ann_type,
                        'text': text,
                        'generated_by': 'ai'
                    })
            
            return annotations
            
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.error(f"Error parsing annotation response: {e}")
            return self._generate_fallback_annotations(article_id, sections)
    
    def _generate_fallback_annotations(
        self, 
        article_id: str, 
        sections: List[Dict]
    ) -> List[Dict]:
        """Generate fallback annotations when AI generation fails."""
        if not sections:
            return []
        
        annotations = []
        num_sections = len(sections)
        
        # Reflection at start
        if num_sections > 0:
            annotations.append({
                'id': str(uuid.uuid4()),
                'article_id': article_id,
                'position_after_section': 0,
                'type': 'reflection',
                'text': 'What patterns or trends do you notice in this opening? How might this affect your industry perspective?',
                'generated_by': 'fallback'
            })
        
        # Expert insight in middle
        if num_sections > 2:
            mid_position = num_sections // 2
            annotations.append({
                'id': str(uuid.uuid4()),
                'article_id': article_id,
                'position_after_section': mid_position,
                'type': 'expert_insight',
                'text': 'This section highlights a key industry shift. Consider how similar dynamics have played out in related sectors.',
                'generated_by': 'fallback'
            })
        
        # Leading question near end
        if num_sections > 3:
            annotations.append({
                'id': str(uuid.uuid4()),
                'article_id': article_id,
                'position_after_section': num_sections - 2,
                'type': 'leading_question',
                'text': 'Based on what you\'ve read, what strategic implications might this have for businesses in your space?',
                'generated_by': 'fallback'
            })
        
        return annotations


# Singleton instance
_annotation_service = None

def get_annotation_service() -> AnnotationService:
    """Get or create the annotation service singleton."""
    global _annotation_service
    if _annotation_service is None:
        _annotation_service = AnnotationService()
    return _annotation_service
