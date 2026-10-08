import uuid
from sqlalchemy import Column, String, DateTime, Text, Boolean, Float, Integer
from sqlalchemy.sql import func

from app.db.base import Base
from app.db.types import UUID


class EvalRun(Base):
    """One agent eval run (make evals), uploaded by evals/run.py for the admin Issues tab (GUR-273).

    Verdicts only: each case's result, what happened, why and the fix, never a
    transcript, so a row carries no user data. The upload keeps the newest 50 runs,
    and the newest whole live run, which the ship gate reads, and deletes the rest.
    Created automatically by Base.metadata.create_all().
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

    # The graded eval score (GUR-268, evals/score.py): null for a run uploaded without one.
    score = Column(Float)                                   # the topline, 0-100
    score_baseline = Column(Float)                          # the baseline's topline under the same weights, or null
    weights_version = Column(String(16))                    # evals/rubrics.yaml's version: compare scores only within one
    score_areas = Column(Text)                              # JSON: each area's key, label, weight, score and baseline

    # Every run uploads, labeled as what it is (GUR-282), and the gate reads only the newest whole live one.
    # Null on a run uploaded before these columns: those were all whole runs, started by hand.
    scope = Column(String(16))                              # "whole", or "partial" for a --case run
    trigger = Column(String(16))                            # how it started: "scheduled", "manual" or "demo"
    n_cases = Column(Integer)                               # how many cases it ran
    case_set = Column(String(16))                           # a hash of their sorted ids: scores compare only on the same set
