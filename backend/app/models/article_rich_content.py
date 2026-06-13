"""
Article Rich Content Model for P1 "In Focus" Storyboard Experience

Stores LLM-generated rich summaries and Socratic prompts for articles.
"""
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class ArticleRichContent(Base):
    """
    Rich content generated for articles at ingestion time.
    Includes multi-part summaries and Socratic prompts.
    """
    __tablename__ = "article_rich_content"
    
    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    article_id = Column(UUID(), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    
    # Rich Summary Components (LLM-generated)
    summary_whats_in = Column(Text)           # "What's in the article" - 2-3 sentences
    summary_why_matters = Column(Text)        # "Why it matters to you" - personalized relevance
    summary_between_lines = Column(Text)      # "Between the lines" - hidden context, connections
    spotlight_quotes = Column(JSON)           # Max 2-3 meaningful quotes (optional)

    # Crux fields (GUR-231) — generated in the SAME LLM pass as the summaries.
    # Nullable: rows generated before GUR-231 won't have them; readers must
    # tolerate None. Backfill via POST /api/v1/admin/backfill-crux.
    core_argument = Column(Text)              # Article's thesis in 1-2 sentences
    strongest_evidence = Column(JSON)         # Array of 2-3 short bullets: strongest support
    counterpoints = Column(JSON)              # Array of 2 short bullets: strongest objections

    # Socratic Prompts (LLM-generated)
    socratic_prompts = Column(JSON)           # 2-4 thought-provoking questions

    # Context Summary for RAG Q&A (LLM-generated)
    # Dense ~500-1000 word factual summary optimized for Q&A context.
    # Replaces raw_text as the context source for Socratic chat and direct Q&A.
    context_summary = Column(Text)            # Factual summary for RAG, not user-facing
    
    # Metadata
    industry_context = Column(String(100))    # Industry used for personalization
    specialization_context = Column(String(100))  # Specialization used for personalization
    model_used = Column(String(100))          # e.g., "claude-sonnet-4-5-20250929"
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationship
    article = relationship("Article", backref="rich_content")
