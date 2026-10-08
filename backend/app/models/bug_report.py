import uuid
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey, JSON
from sqlalchemy.sql import func

from app.db.base import Base
from app.db.types import UUID


class BugReport(Base):
    """One beta bug report (Report a bug, GUR-242): what the tester expected,
    where they were, and the agent turn it is about, if any.

    Saved before anything else happens, then filed to Linear after the response,
    so a Linear outage never loses a report: it stays "failed" with the error
    until an admin retries it. Created automatically by Base.metadata.create_all();
    the columns added since then reach an existing table through
    _run_column_migrations() in app/db/database.py.
    """
    __tablename__ = "bug_reports"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id = Column(UUID(), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    category = Column(String(32), nullable=False)    # wrong_answer | slow | broken_ui | missing | other
    expected = Column(Text, nullable=False)          # what the user expected, in their words
    screen = Column(String(120))                     # route name the report came from
    client = Column(String(64))                      # sent by the app, else web | ios | android | other
    # No foreign key: a trace is written after its turn commits, so a report can arrive first.
    trace_id = Column(UUID(), index=True)
    session_id = Column(UUID())                      # the agent session
    build_sha = Column(String(40))                   # what the server ran when the report arrived
    prompt_version = Column(String(16))
    traffic = Column(String(16))                     # real | synthetic (persona and test accounts)

    status = Column(String(16), nullable=False, default="saved")   # saved | filed | failed
    attempts = Column(Integer, nullable=False, default=0)          # filing attempts
    error = Column(Text)                             # why filing failed, or a label that could not be applied
    linear_identifier = Column(String(32))           # e.g. GUR-261
    linear_url = Column(String(500))
    filed_at = Column(DateTime(timezone=True))
    hypothesis = Column(Text)                        # JSON: Claude's triage hypothesis, or why triage failed

    # The session's context (GUR-277), see services/session_context.py. None is stored as SQL NULL.
    client_context = Column(JSON(none_as_null=True))   # what the app sent, as validated; null from an older app
    context_error = Column(Text)                     # why the app's context was dropped, if it was
    session_context = Column(JSON(none_as_null=True))  # the reporter's own activity before the report, joined at filing
