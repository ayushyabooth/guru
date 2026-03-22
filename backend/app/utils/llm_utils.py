"""
LLM utilities for Claude API integration
"""
import anthropic
from typing import List, Optional
import logging
from app.config import settings

logger = logging.getLogger(__name__)


class ClaudeClient:
    """
    Claude API client for generating summaries, prompts, and questions
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Claude client
        
        Args:
            api_key: Anthropic API key (defaults to config value)
        """
        self.api_key = api_key or settings.ANTHROPIC_API_KEY
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = settings.CLAUDE_SONNET_MODEL
        
    def generate_summary(self, text: str, max_words: int = 50) -> str:
        """
        Generate a concise summary of article text
        
        Args:
            text: Full article text to summarize
            max_words: Maximum words in summary (default 50)
            
        Returns:
            Generated summary text
        """
        if not text or not text.strip():
            return ""
        
        # Truncate very long text to avoid token limits
        max_chars = 8000  # Roughly 2000 tokens
        if len(text) > max_chars:
            text = text[:max_chars] + "..."
        
        prompt = f"""Please provide a concise summary of the following article in approximately {max_words} words. Focus on the key insights, main findings, and practical implications. Make it informative and engaging for business professionals.

Article text:
{text}

Summary (approximately {max_words} words):"""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=200,  # Enough for ~50-100 words
                temperature=0.3,  # Lower temperature for more consistent summaries
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            summary = response.content[0].text.strip()
            logger.info(f"Generated summary ({len(summary.split())} words)")
            return summary
            
        except Exception as e:
            logger.error(f"Error generating summary with Claude: {e}")
            # Fallback to simple truncation
            words = text.split()
            if len(words) <= max_words:
                return text
            return " ".join(words[:max_words]) + "..."
    
    def generate_personal_prompt(self, context: str, user_spec: str) -> str:
        """
        Generate a personalized one-line prompt based on user context
        
        Args:
            context: Article or storyboard context
            user_spec: User specializations and industry info
            
        Returns:
            Personalized prompt string
        """
        if not context or not user_spec:
            return "What insights from this content apply to your industry?"
        
        prompt = f"""Based on the following content and user profile, generate a single, engaging question (one sentence) that helps the user connect this content to their specific industry and expertise.

Content context:
{context}

User profile:
{user_spec}

Generate a personalized question that:
1. Is specific to their industry/specialization
2. Encourages practical application
3. Is engaging and thought-provoking
4. Is exactly one sentence

Personalized question:"""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=100,
                temperature=0.5,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            personal_prompt = response.content[0].text.strip()
            # Ensure it's a single sentence
            if '?' not in personal_prompt:
                personal_prompt += "?"
            
            logger.info(f"Generated personal prompt: {personal_prompt}")
            return personal_prompt
            
        except Exception as e:
            logger.error(f"Error generating personal prompt with Claude: {e}")
            return f"How does this content relate to your work in {user_spec}?"
    
    def generate_questions(self, content: str, count: int = 3) -> List[str]:
        """
        Generate thought-provoking questions based on content
        
        Args:
            content: Article or content text
            count: Number of questions to generate (default 3)
            
        Returns:
            List of generated questions
        """
        if not content or not content.strip():
            return []
        
        # Truncate very long content
        max_chars = 6000
        if len(content) > max_chars:
            content = content[:max_chars] + "..."
        
        prompt = f"""Based on the following content, generate {count} thought-provoking questions that would help business professionals:
1. Think critically about the implications
2. Consider practical applications
3. Explore deeper insights

Content:
{content}

Generate exactly {count} questions, each on a new line, numbered 1-{count}:"""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=300,
                temperature=0.6,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            questions_text = response.content[0].text.strip()
            
            # Parse questions from numbered list
            questions = []
            for line in questions_text.split('\n'):
                line = line.strip()
                if line and (line[0].isdigit() or line.startswith('-')):
                    # Remove numbering and clean up
                    question = line.split('.', 1)[-1].strip()
                    if question.startswith('-'):
                        question = question[1:].strip()
                    if question and not question.endswith('?'):
                        question += "?"
                    if question:
                        questions.append(question)
            
            # Ensure we have the right number of questions
            questions = questions[:count]
            
            logger.info(f"Generated {len(questions)} questions")
            return questions
            
        except Exception as e:
            logger.error(f"Error generating questions with Claude: {e}")
            # Fallback questions
            return [
                "What are the key implications of this content for your industry?",
                "How might you apply these insights in your current role?",
                "What challenges or opportunities does this present?"
            ][:count]
    
    def analyze_sentiment(self, text: str) -> str:
        """
        Analyze the sentiment/tone of content
        
        Args:
            text: Text to analyze
            
        Returns:
            Sentiment description (positive, negative, neutral, etc.)
        """
        if not text or not text.strip():
            return "neutral"
        
        prompt = f"""Analyze the overall sentiment and tone of the following text. Respond with a single word from: positive, negative, neutral, optimistic, pessimistic, analytical, urgent, cautionary.

Text:
{text}

Sentiment:"""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=20,
                temperature=0.1,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            sentiment = response.content[0].text.strip().lower()
            logger.info(f"Analyzed sentiment: {sentiment}")
            return sentiment
            
        except Exception as e:
            logger.error(f"Error analyzing sentiment with Claude: {e}")
            return "neutral"
    
    def extract_key_topics(self, text: str, max_topics: int = 5) -> List[str]:
        """
        Extract key topics/themes from content
        
        Args:
            text: Text to analyze
            max_topics: Maximum number of topics to extract
            
        Returns:
            List of key topics
        """
        if not text or not text.strip():
            return []
        
        prompt = f"""Extract the {max_topics} most important topics or themes from the following text. Return them as a simple comma-separated list of 2-3 word phrases.

Text:
{text}

Key topics (comma-separated):"""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=100,
                temperature=0.3,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            
            topics_text = response.content[0].text.strip()
            topics = [topic.strip() for topic in topics_text.split(',')]
            topics = [topic for topic in topics if topic][:max_topics]
            
            logger.info(f"Extracted {len(topics)} key topics")
            return topics
            
        except Exception as e:
            logger.error(f"Error extracting topics with Claude: {e}")
            return []


    def generate_raw(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        max_tokens: int = 1000,
        temperature: float = 0.5
    ) -> str:
        """
        Generate raw text response from Claude with custom system prompt.
        
        Args:
            prompt: User prompt
            system_prompt: Optional system prompt for context
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature
            
        Returns:
            Raw text response from Claude
        """
        try:
            messages = [{"role": "user", "content": prompt}]
            
            kwargs = {
                "model": self.model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages
            }
            
            if system_prompt:
                kwargs["system"] = system_prompt
            
            response = self.client.messages.create(**kwargs)
            return response.content[0].text.strip()
            
        except Exception as e:
            logger.error(f"Error in generate_raw: {e}")
            raise


# Global client instance
_claude_client = None

def get_claude_client() -> ClaudeClient:
    """
    Get global Claude client instance (singleton pattern)
    
    Returns:
        ClaudeClient instance
    """
    global _claude_client
    if _claude_client is None:
        _claude_client = ClaudeClient()
    return _claude_client
