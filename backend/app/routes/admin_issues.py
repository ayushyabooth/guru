"""
The admin Issues tab (GUR-271, GUR-273): every open issue in Guru, whatever found it, each with
its evidence and next step, under a ship gate from the latest eval run. Checked on the server.

    POST /api/v1/admin/eval-runs     evals/run.py uploads a finished run; the admin key may write this one
    GET  /api/v1/admin/evals/latest  the newest run in full
    GET  /api/v1/admin/issues        the gate, counts per source, and the merged list, newest first

Three sources, one list:
- eval: the newest run's cases that didn't pass, except a NOW GREEN (it only needs its label updated)
- report: beta bug reports in the window, any traffic (the Reports tab's rows, admin_reports.py)
- production: real-traffic turns in the window the trace rules call bad or warn (trace_insights.py)

The gate is blocked when a safety case fails in the newest run (STAY RED included), or when a case
regressed or crashed: the same cases that make run.py exit 1. Open reports show under the gate but
never block it on their own. The graded score lands with GUR-268; until then it is null.
"""
import json
import re
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.bug_report import BugReport
from app.models.eval_run import EvalRun
from app.routes import admin_agent, admin_reports
from app.services import bug_reports as br
from app.services import trace_insights as ti
from app.services.access import AdminReader, require_admin_reader

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

KEEP_RUNS = 50                  # each upload deletes the runs older than the newest 50
MAX_CASES = 200
MAX_RUNS_PER_CASE = 100
TEXT_CHARS = 4000               # expect, what happened, why, fix; the runner clips at half this
NO_RUN = "no eval run uploaded yet"
EPOCH = datetime.min.replace(tzinfo=timezone.utc)
Source = Literal["all", "eval", "report", "production"]
Verdict = Literal["pass", "red_as_labeled", "regression", "now_green", "flaky", "crashed"]
# The report sheet's chips, as the app labels them (mobile/services/report-service.ts).
CATEGORY_LABELS = {"wrong_answer": "Wrong answer", "slow": "Slow", "broken_ui": "Looks broken",
                   "missing": "Something missing", "other": "Other"}
# A turn report's screen is "guru/<mode>". The app sends it, so only a short lowercase word is shown.
MODE = re.compile(r"^[a-z][a-z-]{0,23}$")


# ── the upload ───────────────────────────────────────────────────────────────

class JudgeMeans(BaseModel):
    voice: Optional[float] = Field(None, ge=1, le=5)
    honesty: Optional[float] = Field(None, ge=1, le=5)
    journey: Optional[float] = Field(None, ge=1, le=5)


class JudgeIn(BaseModel):
    meets: str = Field(..., max_length=20)                       # "2 of 3": runs it passed, of the runs it graded
    means: JudgeMeans                                            # each rubric's mean score, 1 to 5
    reason: Optional[str] = Field(None, max_length=TEXT_CHARS)   # its reason on the first run it and the code disagree


class RunIn(BaseModel):
    ok: Optional[bool] = None                                    # null: the scenario crashed


class CaseIn(BaseModel):
    """One case of a run, as evals/run.py sends it. No transcripts."""
    id: str = Field(..., min_length=1, max_length=32)
    title: str = Field(..., min_length=1, max_length=200)
    tier: str = Field(..., pattern=r"^T\d$")                     # T1 scripted, T2 live
    area: Optional[str] = Field(None, max_length=40)             # safety, latency, consent...
    label: str = Field(..., min_length=1, max_length=40)         # GREEN, RED change N, STAY RED N
    verdict: Verdict
    passed: bool
    n_runs: int = Field(..., ge=0, le=MAX_RUNS_PER_CASE)
    n_passed: int = Field(..., ge=0, le=MAX_RUNS_PER_CASE)
    expect: Optional[str] = Field(None, max_length=TEXT_CHARS)
    what_happened: str = Field(..., min_length=1, max_length=TEXT_CHARS)  # the first failing run's detail, else the summary
    why: Optional[str] = Field(None, max_length=TEXT_CHARS)
    fix: Optional[str] = Field(None, max_length=TEXT_CHARS)
    runs: List[RunIn] = Field(..., max_length=MAX_RUNS_PER_CASE)
    judge: Optional[JudgeIn] = None

    @model_validator(mode="after")
    def _counts_add_up(self):
        if len(self.runs) != self.n_runs or self.n_passed > self.n_runs:
            raise ValueError("n_runs must count the runs, and n_passed can't be more than n_runs")
        return self


class EvalRunIn(BaseModel):
    run_at: datetime
    live: bool
    build_sha: str = Field(..., min_length=1, max_length=40)
    prompt_version: str = Field(..., min_length=1, max_length=16)
    evals_version: str = Field(..., min_length=1, max_length=16)
    judge_version: Optional[str] = Field(None, max_length=16)
    cases: List[CaseIn] = Field(..., min_length=1, max_length=MAX_CASES)

    @model_validator(mode="after")
    def _each_case_once(self):
        ids = [c.id for c in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError("each case id may appear only once")
        return self


# ── small helpers ────────────────────────────────────────────────────────────

def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _utc(dt: datetime) -> datetime:
    """A naive time is read as UTC. Stored as UTC, so SQLite, which drops the offset, reads it back right."""
    return _aware(dt).astimezone(timezone.utc)


def _loads(text, default):
    try:
        v = json.loads(text) if text else default
    except ValueError:
        return default
    return v if v is not None else default


def _line(text) -> str:
    return " ".join(str(text).split()) if text else ""


def _secs(ms) -> str:
    return f"{ms / 1000:.1f}s"


def _newest_first(q):
    return q.order_by(EvalRun.run_at.desc(), EvalRun.created_at.desc())


def _latest(db: Session):
    return _newest_first(db.query(EvalRun)).first()


def _run_row(run: EvalRun) -> dict:
    return {"id": str(run.id), "run_at": br.iso(run.run_at), "live": bool(run.live), "build_sha": run.build_sha,
            "prompt_version": run.prompt_version}


def _open(case) -> bool:
    """A case that needs work: anything but a pass, and a NOW GREEN only needs its label updated."""
    return case.get("verdict") not in ("pass", "now_green")


def _live(case) -> bool:
    return case.get("tier") != "T1" and (case.get("n_runs") or 0) > 0


# ── the three sources ────────────────────────────────────────────────────────

def _eval_status(case) -> str:
    label, verdict = case.get("label") or "", case.get("verdict")
    if verdict == "crashed":
        return "Crashed"
    if verdict == "regression":              # only a GREEN case regresses (run.py's verdict)
        return "Regression"
    if label.startswith("STAY RED"):
        return "Stays red · safety" if case.get("area") == "safety" else "Stays red"
    if label.startswith("RED"):
        change = label[len("RED"):].strip()  # "change 4"
        return f"Red · {change}" if change else "Red"
    return label or verdict


def _eval_rows(run, cases) -> list:
    """The newest run's open cases, in the run's own order."""
    if run is None:
        return []
    at, rows = _aware(run.run_at), []
    for c in cases:
        if not _open(c):
            continue
        chip = " · ".join(x for x in (c.get("area"), f"{c.get('n_passed')} of {c.get('n_runs')}" if _live(c) else None)
                          if x)
        rows.append((at, {
            "key": f"eval:{c['id']}", "source": "eval", "at": br.iso(at),
            "title": f"{c['id']} · {c.get('title')}",
            "status": {"text": _eval_status(c), "tone": "red"},
            "body": _line(c.get("what_happened")),
            "chip": {"text": chip, "tone": "indigo"} if chip else None,
            "footer": None, "ref": {"case_id": c["id"]}, "linear_url": None,
        }))
    return rows


def _report_status(r: BugReport) -> dict:
    if r.status == "filed":
        return {"text": f"Filed {r.linear_identifier}" if r.linear_identifier else "Filed", "tone": "green"}
    if r.status == "saved":
        return {"text": "Saved, filing", "tone": "amber"}
    if r.status == "failed":
        return {"text": "Failed", "tone": "red"}
    return {"text": r.status or "Unknown", "tone": "neutral"}


def _mode(screen):
    if not screen or not screen.startswith("guru/"):
        return None
    mode = screen[len("guru/"):].strip()
    return mode if MODE.match(mode) else None


def _turn_chip(screen, t: dict) -> dict:
    """The reported turn, by the Reports tab's rule: the mode it came from and its first-block time,
    amber over the budget. "turn" when there is neither."""
    first = t["first_block_ms"]
    text = " ".join(x for x in (_mode(screen), _secs(first) if first is not None else None) if x) or "turn"
    slow = first is not None and first > ti.BUDGET_FIRST_BLOCK_MS
    return {"text": text, "tone": "amber" if slow else "indigo"}


def _report_rows(db: Session, days: int) -> list:
    """Every beta report in the window, any traffic. A turn shows only when it is the reporter's own."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    reports = (db.query(BugReport).filter(BugReport.created_at >= since)
               .order_by(BugReport.created_at.desc()).limit(admin_reports.MAX_ROWS).all())
    emails, turns = admin_reports._emails(db, reports), admin_reports._own_traces(db, reports)
    rows = []
    for r in reports:
        t, name = turns.get(r.id), (emails.get(r.user_id) or "").split("@")[0] or "beta tester"
        rows.append((_aware(r.created_at) or EPOCH, {
            "key": f"report:{r.id}", "source": "report", "at": br.iso(r.created_at),
            "title": CATEGORY_LABELS.get(r.category, "Other"),
            "status": _report_status(r),
            "body": _line(r.expected)[:admin_reports.EXPECTED_PREVIEW_CHARS].rstrip(),
            "chip": _turn_chip(r.screen, t) if t else None,
            "footer": f"{name} · {r.traffic or 'real'}",
            "ref": {"report_id": str(r.id)}, "linear_url": r.linear_url,
        }))
    return rows


def _production_rows(db: Session, days: int) -> list:
    """Real-traffic turns the trace rules call bad or warn, the Agent view's flagged turns."""
    _, turns = admin_agent._window(db, days, "real")
    rows = []
    for t in turns:
        d = ti.diagnose(t)
        if d["severity"] not in ("bad", "warn"):
            continue
        first = t["first_block_ms"]
        slow = first is not None and first > ti.BUDGET_FIRST_BLOCK_MS
        rows.append((t["created_at"] or EPOCH, {
            "key": f"turn:{t['id']}", "source": "production", "at": br.iso(t["created_at"]),
            "title": d["findings"][0]["title"] if d["findings"] else d["headline"],
            "status": {"text": "Bad", "tone": "red"} if d["severity"] == "bad" else {"text": "Warn", "tone": "amber"},
            "body": d["headline"],
            "chip": {"text": f"{_secs(first)} first content", "tone": "amber"} if slow else None,
            "footer": "trace rules", "ref": {"trace_id": t["id"]}, "linear_url": None,
        }))
    return rows


# ── the gate ─────────────────────────────────────────────────────────────────

def _safety_text(case) -> str:
    if case.get("verdict") == "crashed":
        return f"{case['id']} crashed"
    if _live(case):
        return f"{case['id']} {case.get('n_passed')} of {case.get('n_runs')}"
    if (case.get("label") or "").startswith("STAY RED"):
        return f"{case['id']} stays red"
    return case["id"]


def _gate(run, cases, open_reports: int) -> dict:
    reports = {"kind": "reports", "ok": open_reports == 0, "text": str(open_reports)}  # never blocks on its own
    if run is None:
        return {"state": "unknown", "reasons": [{"kind": "safety", "ok": False, "text": NO_RUN},
                                                {"kind": "regressions", "ok": False, "text": NO_RUN}, reports],
                "run": None, "score": None}
    unsafe = [c for c in cases if c.get("area") == "safety" and _open(c)]
    regressed = [c for c in cases if c.get("verdict") in ("regression", "crashed")]  # what makes run.py exit 1
    return {
        "state": "blocked" if unsafe or regressed else "clear",
        "reasons": [
            {"kind": "safety", "ok": not unsafe, "text": ", ".join(_safety_text(c) for c in unsafe) or "all green"},
            {"kind": "regressions", "ok": not regressed,
             "text": ", ".join(c["id"] + (" crashed" if c.get("verdict") == "crashed" else "")
                               for c in regressed) or "none"},
            reports,
        ],
        "run": _run_row(run),
        "score": None,  # the graded score lands with GUR-268
    }


# ── routes ───────────────────────────────────────────────────────────────────

@router.post("/eval-runs", status_code=201)
async def upload_eval_run(body: EvalRunIn, db: Session = Depends(get_db),
                          reader: AdminReader = Depends(require_admin_reader)):
    """evals/run.py sends each finished run here. Unlike every other admin write, the admin key may
    write this one: a run is verdicts and the cases' own words, never a transcript, so it carries no
    user data, and storing it costs nothing. The runner holds only the key. Keeps the newest 50 runs."""
    cases = [c.model_dump() for c in body.cases]
    run = EvalRun(id=uuid.uuid4(), created_at=datetime.now(timezone.utc), run_at=_utc(body.run_at),
                  live=body.live, build_sha=body.build_sha, prompt_version=body.prompt_version,
                  evals_version=body.evals_version, judge_version=body.judge_version,
                  summary=json.dumps(dict(Counter(c["verdict"] for c in cases))), cases=json.dumps(cases),
                  uploaded_by=reader.user.email if reader.kind == "user" else "admin-key")
    db.add(run)
    db.flush()
    old = [row.id for row in _newest_first(db.query(EvalRun.id)).offset(KEEP_RUNS).all()]
    if old:
        db.query(EvalRun).filter(EvalRun.id.in_(old)).delete(synchronize_session=False)
    db.commit()
    return {"id": str(run.id)}


@router.get("/evals/latest")
async def latest_eval_run(db: Session = Depends(get_db), _reader=Depends(require_admin_reader)):
    run = _latest(db)
    if run is None:
        raise HTTPException(status_code=404, detail="No eval run uploaded yet")
    return {**_run_row(run), "evals_version": run.evals_version, "judge_version": run.judge_version,
            "uploaded_by": run.uploaded_by, "summary": _loads(run.summary, {}), "cases": _loads(run.cases, [])}


@router.get("/issues")
async def list_issues(
    days: int = Query(7, ge=1, le=90),
    source: Source = "all",
    db: Session = Depends(get_db),
    _reader=Depends(require_admin_reader),
):
    """The gate and the counts always cover every source; `source` only filters the list."""
    run = _latest(db)
    cases = _loads(run.cases, []) if run else []
    reports = _report_rows(db, days)
    rows = _eval_rows(run, cases) + reports + _production_rows(db, days)
    rows.sort(key=lambda r: r[0], reverse=True)  # newest first; stable, so a run's cases keep the run's order
    issues = [row for _, row in rows]
    counts = Counter(i["source"] for i in issues)
    return {
        "gate": _gate(run, cases, len(reports)),
        "counts": {"all": len(issues), **{s: counts.get(s, 0) for s in ("eval", "report", "production")}},
        "issues": [i for i in issues if source in ("all", i["source"])],
    }
