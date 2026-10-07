import uuid
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey
from sqlalchemy.sql import func

from app.db.base import Base
from app.db.types import UUID


class AgentTurnTrace(Base):
    """One row per agent turn: the sensor layer behind latency, cost,
    trajectory and generated-UI evals, and behind online evals on real use.

    Written at the end of every /agent/turn (success, approval pause,
    iteration cap or error). Never blocks or alters the user's response.
    Created automatically by Base.metadata.create_all().
    """
    __tablename__ = "agent_turn_traces"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(), index=True, nullable=False)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    model = Column(String(64))
    input_type = Column(String(16))            # goal | message | decision
    input_preview = Column(String(200))        # first 200 chars of the user's text

    outcome = Column(String(16))               # blocks | approval | max_iters | error
    iterations = Column(Integer, default=0)    # model calls in this turn
    first_block_ms = Column(Integer)           # time to first UI block (null if none)
    total_ms = Column(Integer)

    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    cache_read_tokens = Column(Integer, default=0)
    cache_write_tokens = Column(Integer, default=0)

    # Every span carries start_ms (offset from the start of the turn) so a timeline
    # can be drawn; iter links tools and blocks to the model call that caused them.
    model_calls = Column(Text)                 # JSON: [{iter, start_ms, ms, first_text_ms, stop_reason, in, out, cache_read, cache_write, request_id}]
    tool_calls = Column(Text)                  # JSON: [{name, iter, start_ms, ms, chars, error, error_msg, input}]
    blocks = Column(Text)                      # JSON: [{type, variant, at_ms, iter, preview}]
    phases = Column(Text)                      # JSON: [{name, start_ms, ms}] work outside model and tools, e.g. load_context
    approval_tool = Column(String(64))         # write tool that paused the turn, if any
    error = Column(Text)

    # What served the turn, so a regression can be tied to a deploy or a prompt change
    build_sha = Column(String(40))             # Railway's git commit, "local" in development
    prompt_version = Column(String(16))        # hash of the system prompt + tool schemas
    traffic = Column(String(16), index=True)   # real | synthetic (persona and test accounts)
    client = Column(String(32))                # web | ios | android | other, from the User-Agent
    decision = Column(String(16))              # approved | declined | stale, on decision turns
    ai_hypothesis = Column(Text)               # JSON: cached LLM explanation from the admin view
