import uuid
from sqlalchemy import Column, String, DateTime, Text, Boolean
from sqlalchemy.sql import func

from app.db.base import Base
from app.db.types import UUID


class EvalRun(Base):
    """One agent eval run (make evals), uploaded by evals/run.py for the admin Issues tab (GUR-273).

    Verdicts only: each case's result, what happened, why and the fix, never a
    transcript, so a row carries no user data. The upload keeps the newest 50 runs
    and deletes the rest. Created automatically by Base.metadata.create_all().
    """
    __tablename__ = "eval_runs"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)  # when the server got it
    run_at = Column(DateTime(timezone=True), nullable=False, index=True)                # when the run happened

    live = Column(Boolean, nullable=False, default=False)   # T2 on the live model too, not only the scripted T1
    build_sha = Column(String(40))                          # what the runner ran: Railway's commit, "local" on a laptop
    prompt_version = Column(String(16))                     # hash of the agent's system prompt + tool schemas
    evals_version = Column(String(16))                      # hash of the eval code (cases, scenarios, checks, fixtures)
    judge_version = Column(String(16))                      # the LLM judge's version, null when it didn't run

    summary = Column(Text)                                  # JSON: counts by verdict, e.g. {"red_as_labeled": 9, "pass": 3}
    cases = Column(Text)                                    # JSON: one entry per case (routes/admin_issues.py, CaseIn)
    uploaded_by = Column(String(255))                       # the admin's email, or "admin-key"
