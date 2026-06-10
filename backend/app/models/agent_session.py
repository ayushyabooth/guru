import uuid
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from app.db.base import Base
from app.db.types import UUID


class AgentSession(Base):
    """Conversation state for the agentic Guru tab (Epic H, GUR-228).

    Stores the full Claude message history as JSON so the manual tool-use loop
    can resume across turns — including the approval round-trip, where a write
    tool call pauses the turn (pending_action) until the client returns the
    user's decision. Created automatically by Base.metadata.create_all().
    """
    __tablename__ = "agent_sessions"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=True)        # first goal text, for history lists
    messages = Column(Text, nullable=False, default="[]")       # JSON: Claude messages array
    pending_action = Column(Text, nullable=True)                # JSON: {tool_use_id, name, input}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
