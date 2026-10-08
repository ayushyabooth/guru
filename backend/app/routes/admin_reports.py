"""
Admin view of beta bug reports (Report a bug, GUR-242), checked on the server.
Reads take a signed-in admin or the X-Admin-Key header. Retry takes a signed-in
admin only: it files to Linear and spends a Claude call.

    GET  /api/v1/admin/reports              newest first, with the turn's headline and the hypothesis
    GET  /api/v1/admin/reports/{id}         everything, plus the reported turn's row from the Agent view
                                            and the session's context as stored (GUR-277)
    POST /api/v1/admin/reports/{id}/retry   file a failed (or stuck) report again
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.agent_turn_trace import AgentTurnTrace
from app.models.bug_report import BugReport
from app.models.user import User
from app.services import bug_reports as br
from app.services import trace_insights as ti
from app.services.access import require_admin, require_admin_reader

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

MAX_ROWS = 500
EXPECTED_PREVIEW_CHARS = 160
Traffic = Literal["real", "synthetic", "all"]
Status = Literal["saved", "filed", "failed"]


def _id(value):
    return str(value) if value else None


def _emails(db: Session, reports) -> dict:
    ids = {r.user_id for r in reports}
    if not ids:
        return {}
    return {u.id: u.email for u in db.query(User.id, User.email).filter(User.id.in_(ids)).all()}


def _own_traces(db: Session, reports) -> dict:
    """Parsed turns by report id, only where the turn is the reporter's own."""
    ids = {r.trace_id for r in reports if r.trace_id}
    if not ids:
        return {}
    turns = {row.id: row for row in db.query(AgentTurnTrace).filter(AgentTurnTrace.id.in_(ids)).all()}
    out = {}
    for r in reports:
        row = turns.get(r.trace_id)
        if row is not None and row.user_id == r.user_id:
            out[r.id] = ti.parse(row)
    return out


def _report(r: BugReport, email) -> dict:
    return {
        "id": str(r.id), "reference": br.reference(r.id), "created_at": br.iso(r.created_at),
        "user_id": str(r.user_id), "user_email": email, "category": r.category, "expected": r.expected,
        "screen": r.screen, "client": r.client, "trace_id": _id(r.trace_id), "session_id": _id(r.session_id),
        "build_sha": r.build_sha, "prompt_version": r.prompt_version, "traffic": r.traffic,
        "status": r.status, "attempts": r.attempts, "error": r.error,
        "linear_identifier": r.linear_identifier, "linear_url": r.linear_url, "filed_at": br.iso(r.filed_at),
        "hypothesis": br.hypothesis_of(r),
        # As stored: what the app sent (or why it was dropped) and the activity joined at filing
        "client_context": r.client_context, "context_error": r.context_error, "session_context": r.session_context,
    }


def _load(db: Session, report_id: str) -> BugReport:
    try:
        rid = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Report not found")
    report = db.query(BugReport).filter(BugReport.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


def _detail(db: Session, report: BugReport) -> dict:
    email = _emails(db, [report]).get(report.user_id)
    t = br.load_trace(db, report)
    diag = ti.diagnose(t) if t else None
    return {"report": _report(report, email),
            "trace": ti.turn_row(t, diag, email) if t else None,  # links straight to the turn in the Agent view
            "diagnosis": diag}


@router.get("/reports")
async def list_reports(
    days: int = Query(7, ge=1, le=90),
    status: Optional[Status] = None,
    traffic: Traffic = "real",
    db: Session = Depends(get_db),
    _reader=Depends(require_admin_reader),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = db.query(BugReport).filter(BugReport.created_at >= since)
    if status:
        q = q.filter(BugReport.status == status)
    if traffic == "real":
        q = q.filter(or_(BugReport.traffic == "real", BugReport.traffic.is_(None)))
    elif traffic == "synthetic":
        q = q.filter(BugReport.traffic == "synthetic")
    reports = q.order_by(BugReport.created_at.desc()).limit(MAX_ROWS).all()
    emails, turns = _emails(db, reports), _own_traces(db, reports)
    rows = []
    for r in reports:
        t, h = turns.get(r.id), br.hypothesis_of(r) or {}
        rows.append({
            "id": str(r.id), "reference": br.reference(r.id), "created_at": br.iso(r.created_at),
            "user_email": emails.get(r.user_id), "category": r.category, "traffic": r.traffic or "real",
            "expected": (r.expected or "")[:EXPECTED_PREVIEW_CHARS], "screen": r.screen, "status": r.status,
            "linear_identifier": r.linear_identifier, "linear_url": r.linear_url, "trace_id": _id(r.trace_id),
            "trace_headline": ti.diagnose(t)["headline"] if t else None,
            "trace_first_block_ms": t["first_block_ms"] if t else None,  # the list's chip, with the mode in `screen`
            "hypothesis_summary": h.get("summary"),
        })
    return {"reports": rows, "total": len(rows)}


@router.get("/reports/{report_id}")
async def report_detail(report_id: str, db: Session = Depends(get_db), _reader=Depends(require_admin_reader)):
    return _detail(db, _load(db, report_id))


@router.post("/reports/{report_id}/retry")
async def retry_report(
    report_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Files again at once so the admin sees the outcome; the triage follows after the response."""
    report = _load(db, report_id)
    if not br.can_retry(report):
        raise HTTPException(status_code=409, detail=f"Only a failed report, or one still saved after "
                                                    f"{int(br.STUCK_AFTER.total_seconds() // 60)} minutes, "
                                                    f"can be retried; this one is {report.status}")
    rid, sessions = str(report.id), br.sessions_for(db)
    issue_id = await asyncio.to_thread(br.file_report, rid, sessions)  # never block the event loop on Linear
    if issue_id:
        background_tasks.add_task(br.start, br.triage_report, rid, sessions, issue_id)
    db.expire_all()
    return _detail(db, _load(db, report_id))
