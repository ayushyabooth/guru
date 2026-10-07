"""
Report a bug (beta, GUR-242): a beta tester says what they expected, and it lands in Linear.

    POST /api/v1/reports   save the report and answer at once; filing runs after the response

Saved first, then filed: the row is committed before the response, and filing to
Linear and the Claude triage run afterwards on a worker thread
(services/bug_reports.py), so a Linear outage never loses a report. Beta only,
decided on the server (BETA_EMAILS; admins count as beta).
"""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.bug_report import BugReport
from app.models.user import User
from app.routes.agent import PROMPT_VERSION, _client_kind
from app.services import bug_reports
from app.services.access import is_synthetic, require_beta
from app.services.agent_trace import BUILD_SHA

router = APIRouter(prefix="/api/v1", tags=["reports"])

Category = Literal["wrong_answer", "slow", "broken_ui", "missing", "other"]


class ReportRequest(BaseModel):
    category: Category
    expected: str = Field(..., max_length=2000)    # what the user expected, in their words
    screen: Optional[str] = Field(None, max_length=120)
    trace_id: Optional[uuid.UUID] = None           # the agent turn the report is about
    session_id: Optional[uuid.UUID] = None
    client: Optional[str] = Field(None, max_length=64)

    @field_validator("expected")
    @classmethod
    def _says_something(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("expected must say what the user expected")
        return v.strip()


@router.post("/reports")
async def create_report(
    body: ReportRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_beta),
    db: Session = Depends(get_db),
):
    report_id = uuid.uuid4()
    db.add(BugReport(
        id=report_id, created_at=datetime.now(timezone.utc), user_id=user.id,
        category=body.category, expected=body.expected, screen=body.screen,
        client=body.client or _client_kind(request.headers.get("user-agent", "")),
        trace_id=body.trace_id, session_id=body.session_id,
        build_sha=BUILD_SHA, prompt_version=PROMPT_VERSION,
        traffic="synthetic" if is_synthetic(user) else "real",
        status="saved", attempts=0,
    ))
    db.commit()
    background_tasks.add_task(bug_reports.start, bug_reports.process_report, str(report_id),
                              bug_reports.sessions_for(db))
    return {"id": str(report_id), "reference": bug_reports.reference(report_id), "status": "saved"}
