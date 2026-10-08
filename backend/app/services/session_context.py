"""
The session's context on a bug report (GUR-277): what the app saw just before the report, and what the
reporter did in the 30 minutes before it.

    read_context(raw)        the app's context, validated: (what to store, None) or (None, why it was dropped)
    collect(db, report)      the reporter's own activity in the window, joined once at filing
    fill_title(db, client)   the app's context with the title of the article on screen
    section_lines(report)    the issue's Session context section; make report prints the same lines
    for_triage(report)       the same context for Claude's triage, every item named by a ref (T1, F1, A1)
    labels(report)           each ref in a few words, and used_line() for the hypothesis's "Used:" line

Two snapshots sit on the report, so the Linear issue, the admin detail and make report show the same thing.
client_context is what the app sent, as validated: the screen and step, the ids on screen, the last screens
and the last API calls that failed, never a body or a query string. It is best effort: the tester's report
is the payload, so a context that breaks a rule is dropped, with the reason in context_error, and the report
files anyway. session_context is what the server joined at filing: notes and highlights, saves, questions,
recap answers and, when the report names no turn, the latest agent turn. Every query filters on the
reporter's own user id, so another user's row never reaches a report.

Text follows the traces' privacy setting (TRACE_FULL_TEXT in agent_trace.py). While it is on, the default
before beta, each item keeps its text, clipped. In privacy mode every text and article title is null; kinds,
counts, times, ids and details (positions such as "stage 3, reply 2", never the user's words) stay.
"""
import json
import re
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func

from app.models.agent_turn_trace import AgentTurnTrace
from app.models.article import Article
from app.models.interaction import UserAnnotation, UserSavedArticle
from app.models.qa_models import QAExchange
from app.models.recap import RecapJourney
from app.services import agent_trace
from app.services import trace_insights as ti

WINDOW = timedelta(minutes=30)
MINUTES = int(WINDOW.total_seconds() // 60)
MAX_ITEMS = 10                  # activity items stored and shown, newest first
TEXT_CHARS = 200                # each text, cut at a word
RECAP_WEEKS = 4                 # recap journeys read for answers: one a week, the newest four
TURNS_READ = 30                 # agent turns read for Stage 2 answers; a 30-minute window rarely holds more
CONTEXT_MAX_BYTES = 16 * 1024   # a bigger context is dropped, never refused
REASON_CHARS = 300
TRAIL_MAX, FAILED_CALLS_MAX = 10, 5
SCREEN_CHARS, STEP_CHARS, ID_CHARS, PATH_CHARS = 120, 64, 64, 200
SCREENS = ("home", "catchup", "divein", "recap", "guru", "article", "other")
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
KINDS = {"note": ("note", "notes"), "highlight": ("highlight", "highlights"), "save": ("save", "saves"),
         "question": ("question", "questions"), "recap_answer": ("recap answer", "recap answers"),
         "agent_turn": ("agent turn", "agent turns")}

NO_APP_CONTEXT = "No session context: sent by an app build from before GUR-277."
UNREADABLE = "The app sent a session context the server couldn't read: "
NO_ACTIVITY = f"No activity in the {MINUTES} minutes before the report."
NOT_COLLECTED = "Activity: not collected for this report."
RECAP_UNTIMED = "Recap screen answers aren't timestamped, so they can't be placed in the window."
PRIVACY_NOTE = "Privacy mode: kinds, counts, times and ids only."

_ID = re.compile(r"^[A-Za-z0-9_.:-]+$")
_NOT_BARE = re.compile(r"[#\s\x00-\x1f\x7f]")
_REF = re.compile(r"^(?:[TFA]\d{1,2}|screen|on_screen|trail)$", re.I)


# ── small helpers ────────────────────────────────────────────────────────────

def _utc(dt):
    """Any datetime in UTC; one without a zone is taken as UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _time(value):
    """A UTC datetime from a datetime or an ISO string, or None."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    return _utc(value) if isinstance(value, datetime) else None


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def _clip(text, n=TEXT_CHARS):
    """Whitespace folded, then cut at a word and marked. Never mid-word, like the agent's _trunc."""
    if text is None:
        return None
    t = " ".join(str(text).split())
    if len(t) <= n:
        return t or None
    cut = t[:n]
    if t[n] != " ":
        i = cut.rfind(" ")
        cut = cut[:i] if i > 0 else cut
    return cut.rstrip(" ,;:-") + "…"


def _get(report, key):
    """A field of the report: the model's attribute, or the admin detail's key (make report reads that)."""
    return report.get(key) if isinstance(report, dict) else getattr(report, key, None)


# ── the app's context: validated, never a reason to lose the report ──────────

class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")  # a field outside the contract drops the context


def _screen_name(v):
    """A known screen in any case, else "other": a newer build's new screen still files."""
    if v is None:
        return None
    v = v.strip().lower()
    return v if v in SCREENS else "other"


class _Visit(_Strict):
    screen: str = Field(..., max_length=SCREEN_CHARS)
    step: Optional[str] = Field(None, max_length=STEP_CHARS)
    at: datetime

    @field_validator("screen")
    @classmethod
    def _known(cls, v):
        return _screen_name(v)

    @field_validator("at")
    @classmethod
    def _in_utc(cls, v):
        return _utc(v)


class _FailedCall(_Strict):
    method: str
    path: str = Field(..., max_length=PATH_CHARS)
    status: int = Field(..., ge=0, le=599)  # 0: the call never got an answer
    at: datetime

    @field_validator("method", mode="before")
    @classmethod
    def _method(cls, v):
        if not isinstance(v, str) or v.strip().upper() not in METHODS:
            raise ValueError(f"must be one of {', '.join(METHODS)}")
        return v.strip().upper()

    @field_validator("path")
    @classmethod
    def _bare(cls, v):
        if "?" in v:
            raise ValueError("has a query string")
        if _NOT_BARE.search(v):
            raise ValueError("is not a bare path")
        return v

    @field_validator("at")
    @classmethod
    def _in_utc(cls, v):
        return _utc(v)


class _OnScreen(_Strict):
    article_id: Optional[str] = Field(None, max_length=ID_CHARS)
    recap_journey_id: Optional[str] = Field(None, max_length=ID_CHARS)
    trace_id: Optional[str] = Field(None, max_length=ID_CHARS)

    @field_validator("article_id", "recap_journey_id", "trace_id")
    @classmethod
    def _an_id(cls, v):
        if not v:
            return None
        if not _ID.match(v):
            raise ValueError("is not an id")
        return v


class AppContext(_Strict):
    """What the app may send with a report. Both lists come newest first and are stored in that order."""
    screen: Optional[str] = Field(None, max_length=SCREEN_CHARS)
    step: Optional[str] = Field(None, max_length=STEP_CHARS)
    on_screen: Optional[_OnScreen] = None
    trail: Optional[Annotated[List[_Visit], Field(max_length=TRAIL_MAX)]] = None
    failed_calls: Optional[Annotated[List[_FailedCall], Field(max_length=FAILED_CALLS_MAX)]] = None

    @field_validator("screen")
    @classmethod
    def _known(cls, v):
        return _screen_name(v)

    def stored(self) -> dict:
        """client_context: every key, times in UTC, and the on-screen article's title for filing to fill in."""
        on = self.on_screen or _OnScreen()
        return {"screen": self.screen, "step": self.step, "on_screen": {**on.model_dump(), "article_title": None},
                "trail": [{"screen": v.screen, "step": v.step, "at": v.at.isoformat()} for v in self.trail or []],
                "failed_calls": [{"method": c.method, "path": c.path, "status": c.status, "at": c.at.isoformat()}
                                 for c in self.failed_calls or []]}


_ITEM = {"trail": "trail item", "failed_calls": "failed call"}


def _where(loc) -> tuple:
    """('trail', 2, 'at') -> ('trail item 3', 'at'); ('on_screen', 'trace_id') -> ('on_screen', 'trace_id')."""
    where, field = "the context", None
    for part in loc:
        if isinstance(part, int):
            where, field = f"{_ITEM.get(field, 'item')} {part + 1}", None
        elif field is not None:
            where, field = field, " ".join(str(part).split())[:40]
        else:
            field = " ".join(str(part).split())[:40]
    return where, field


def _problem(err) -> str:
    """One validation error in words: where, and which rule. Never the value the app sent."""
    where, field = _where(err.get("loc") or ())
    kind, ctx = err.get("type", ""), err.get("ctx") or {}
    target = where if field is None else (f"'{field}'" if where == "the context" else f"{where} '{field}'")
    if kind == "missing":
        return f"{where} has no '{field}'"
    if kind == "extra_forbidden":
        return f"{where} has a field the server doesn't take: '{field}'"
    if kind == "too_long":
        return f"{target} has more than {ctx.get('max_length')} items"
    if kind == "string_too_long":
        return f"{target} is longer than {ctx.get('max_length')} characters"
    if kind.startswith("int_") or kind in ("less_than_equal", "greater_than_equal"):  # status is the one number
        return f"{target} must be a whole number from 0 to 599"
    if kind.startswith("datetime_"):
        return f"{target} is not a time"
    if kind in ("model_type", "model_attributes_type", "dict_type"):
        return f"{target} is not an object"
    if kind == "list_type":
        return f"{target} is not a list"
    if kind == "string_type":
        return f"{target} is not text"
    if kind == "value_error":
        return f"{target} {str(err.get('msg') or '').removeprefix('Value error, ')}"
    return f"{target} breaks a rule ({kind})"


def read_context(raw: Any) -> tuple:
    """The app's context as client_context stores it, or why it was dropped: (stored, None) or (None, reason).
    No context at all is (None, None), from an app build before GUR-277."""
    if raw is None:
        return None, None
    try:
        size = len(json.dumps(raw, separators=(",", ":"), ensure_ascii=False).encode())
    except (TypeError, ValueError):
        return None, "the context is not JSON"
    if size > CONTEXT_MAX_BYTES:
        return None, f"the context is {size:,} bytes; the limit is {CONTEXT_MAX_BYTES:,}"
    try:
        return AppContext.model_validate(raw).stored(), None
    except ValidationError as e:
        errors = e.errors()
        more = f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""
        return None, (_problem(errors[0]) + more)[:REASON_CHARS]


# ── the join, at filing ──────────────────────────────────────────────────────

def _item(kind, at, *, text=None, article_id=None, trace_id=None, detail=None) -> dict:
    return {"kind": kind, "at": at, "text": _clip(text), "article_id": str(article_id) if article_id else None,
            "article_title": None, "trace_id": str(trace_id) if trace_id else None, "detail": detail}


def _annotations(db, uid, since, until):
    """Notes and highlights, at the time each was last written: a note added to an older highlight is activity."""
    when = func.coalesce(UserAnnotation.updated_at, UserAnnotation.created_at)
    q = db.query(UserAnnotation).filter(UserAnnotation.user_id == uid, when >= since, when <= until)
    rows = q.order_by(when.desc()).limit(MAX_ITEMS).all()
    notes = q.filter(func.length(func.trim(func.coalesce(UserAnnotation.note_text, ""))) > 0).count()
    items = []
    for r in rows:
        noted = bool((r.note_text or "").strip(" "))  # the same test as trim() in the count
        items.append(_item("note" if noted else "highlight", _utc(r.updated_at or r.created_at),
                           text=r.note_text if noted else r.highlighted_text, article_id=r.article_id))
    return items, {"note": notes, "highlight": q.count() - notes}


def _saves(db, uid, since, until):
    q = db.query(UserSavedArticle).filter(UserSavedArticle.user_id == uid, UserSavedArticle.saved_at >= since,
                                          UserSavedArticle.saved_at <= until)
    rows = q.order_by(UserSavedArticle.saved_at.desc()).limit(MAX_ITEMS).all()
    return [_item("save", _utc(r.saved_at), article_id=r.article_id) for r in rows], {"save": q.count()}


def _questions(db, uid, since, until):
    q = db.query(QAExchange).filter(QAExchange.user_id == uid, QAExchange.created_at >= since,
                                    QAExchange.created_at <= until)
    rows = q.order_by(QAExchange.created_at.desc()).limit(MAX_ITEMS).all()
    return [_item("question", _utc(r.created_at), text=r.question, article_id=r.article_id,
                  detail=r.exchange_type if r.exchange_type not in (None, "direct") else None)
            for r in rows], {"question": q.count()}


def _tool_calls(row) -> list:
    try:
        calls = json.loads(row.tool_calls or "[]")
    except ValueError:
        return []
    return [c for c in calls if isinstance(c, dict)] if isinstance(calls, list) else []


def _agent_stage2_answers(db, uid, since, until, turns) -> list:
    """Stage 2 answers the agent sent with submit_recap_answer, each at its traced call: the turn's start plus the
    call's offset. The answer's text is what the journey holds now for that question."""
    calls = []
    for row in turns:
        start = _utc(row.created_at)
        for c in _tool_calls(row):
            if c.get("name") != "submit_recap_answer" or c.get("status") != "ok":
                continue
            at = start + timedelta(milliseconds=c.get("start_ms") or 0)
            args = c.get("args") or {}
            index = args.get("question_index")
            if since <= at <= until:
                calls.append((at, _uuid(args.get("journey_id")), index if isinstance(index, int) else None))
    ids = sorted({j for _, j, _ in calls if j})
    journeys = {j.id: j for j in db.query(RecapJourney.id, RecapJourney.guided_questions, RecapJourney.guided_responses)
                .filter(RecapJourney.user_id == uid, RecapJourney.id.in_(ids)).all()} if ids else {}
    out = []
    for at, journey_id, index in calls:
        j = journeys.get(journey_id)
        total = len(j.guided_questions or []) if j else 0
        detail = "stage 2, answer" + (f" {index + 1}" if index is not None else "") + (
            f" of {total}" if index is not None and total else "")
        text = (j.guided_responses or {}).get(str(index)) if j and index is not None else None
        out.append(_item("recap_answer", at, text=text, detail=detail))
    return out


def _recap_answers(db, uid, since, until, turns):
    """Recap answers in the window. RecapJourney is the live model (nothing writes the legacy RecapSession), and
    its fields decide what "answered in the window" can mean:
    - a Stage 3 reply is one of the user's own messages in socratic_exchanges; each message carries its own
      timestamp (naive UTC, written with datetime.utcnow()), so a reply counts when that time is in the window;
    - the commitment counts when completed_at is in the window: storing the commitment is what sets it;
    - a Stage 2 answer has no time of its own. guided_responses maps a question index to the answer, the
      journey has no updated_at, and the follow-up is never stored. The one time that exists is the agent's:
      an answer sent through submit_recap_answer is a traced tool call. So a Stage 2 answer counts when that
      call is in the window, and an answer typed on the Recap screen itself is never counted; section_lines
      says so when the session was on Recap and no recap answer could be placed."""
    out = []
    journeys = (db.query(RecapJourney.socratic_exchanges, RecapJourney.commitment_text, RecapJourney.completed_at)
                .filter(RecapJourney.user_id == uid).order_by(RecapJourney.week_start.desc())
                .limit(RECAP_WEEKS).all())
    for exchanges, commitment, completed in journeys:
        replies = [m for m in exchanges or [] if isinstance(m, dict) and m.get("role") == "user"]
        for n, m in enumerate(replies, 1):
            at = _time(m.get("timestamp"))
            if at is not None and since <= at <= until:
                out.append(_item("recap_answer", at, text=m.get("content"), detail=f"stage 3, reply {n}"))
        done = _utc(completed)
        if commitment and done is not None and since <= done <= until:
            out.append(_item("recap_answer", done, text=commitment, detail="commitment"))
    out += _agent_stage2_answers(db, uid, since, until, turns)
    out.sort(key=lambda x: x["at"], reverse=True)
    return out[:MAX_ITEMS], {"recap_answer": len(out)}


def _latest_turn(turns, report):
    """The newest agent turn in the window, when the report names none: a named turn has its own trace section."""
    if report.trace_id or not turns:
        return [], {"agent_turn": 0}
    t = ti.parse(turns[0])
    n = len(t["blocks"])
    blocks = f"{n} block{'s' if n != 1 else ''}"
    detail = blocks if t["outcome"] == "blocks" else f"{t['outcome'] or 'unknown'}, {blocks}"
    return [_item("agent_turn", _utc(t["created_at"]), text=t["input_preview"], trace_id=t["id"],
                  detail=detail)], {"agent_turn": 1}


def _titles(db, article_ids) -> dict:
    keys = [k for k in (_uuid(a) for a in article_ids) if k]
    if not keys:
        return {}
    return {str(a): _clip(title) for a, title in db.query(Article.id, Article.title).filter(Article.id.in_(keys))
            if title}


def collect(db, report) -> dict:
    """The reporter's own activity in the 30 minutes before the report, newest first, as session_context
    stores it. The report's created_at fixes the window, both ends included, so a late retry joins the same
    rows. Counts are every row of each kind in the window; the items are the newest ten of them all."""
    until = _utc(report.created_at)
    since = until - WINDOW
    uid = report.user_id
    # Only the columns read here: a full-text trace can be large. trace_insights.parse fills in the rest.
    turns = (db.query(AgentTurnTrace.id, AgentTurnTrace.created_at, AgentTurnTrace.input_preview,
                      AgentTurnTrace.outcome, AgentTurnTrace.tool_calls, AgentTurnTrace.blocks)
             .filter(AgentTurnTrace.user_id == uid, AgentTurnTrace.created_at >= since,
                     AgentTurnTrace.created_at <= until)
             .order_by(AgentTurnTrace.created_at.desc()).limit(TURNS_READ).all())
    found, counts = [], Counter()
    for items, n in (_annotations(db, uid, since, until), _saves(db, uid, since, until),
                     _questions(db, uid, since, until), _recap_answers(db, uid, since, until, turns),
                     _latest_turn(turns, report)):
        found += items
        counts.update(n)
    found.sort(key=lambda x: x["at"], reverse=True)
    items, privacy = found[:MAX_ITEMS], not agent_trace.FULL_TEXT_FOR_ALL
    titles = {} if privacy else _titles(db, {x["article_id"] for x in items if x["article_id"]})
    for x in items:
        x["at"] = x["at"].isoformat()
        x["article_title"] = titles.get(x["article_id"])
        if privacy:
            x["text"] = None
    return {"window_minutes": MINUTES, "privacy": privacy, "counts": {k: counts.get(k, 0) for k in KINDS},
            "items": items}


def fill_title(db, client):
    """client_context with the title of the article on screen, when the article exists and text is kept."""
    on = (client or {}).get("on_screen") or {}
    article_id = _uuid(on.get("article_id"))
    if article_id is None or not agent_trace.FULL_TEXT_FOR_ALL:
        return client
    title = db.query(Article.title).filter(Article.id == article_id).scalar()
    return {**client, "on_screen": {**on, "article_title": _clip(title)}} if title else client


# ── reading it back: the issue, make report, triage ──────────────────────────

def _span(seconds) -> str:
    s = abs(int(round(seconds)))
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m" + (f" {s % 60}s" if s % 60 else "")
    if s < 86400:
        return f"{s // 3600}h" + (f" {s % 3600 // 60}m" if s % 3600 // 60 else "")
    return f"{s // 86400}d" + (f" {s % 86400 // 3600}h" if s % 86400 // 3600 else "")


def _ago(at, anchor) -> str:
    t = _time(at)
    if t is None or anchor is None:
        return "at an unknown time"
    seconds = (anchor - t).total_seconds()
    return f"{_span(seconds)} {'before' if seconds >= 0 else 'after'}"


def _when(at, anchor) -> str:
    """'19:37:58 UTC (29s before)', with the date when it isn't the report's own day."""
    t = _time(at)
    if t is None:
        return "at an unknown time"
    clock = t.strftime("%H:%M:%S" if anchor is not None and t.date() == anchor.date() else "%m-%d %H:%M:%S")
    return f"{clock} UTC ({_ago(t, anchor)})" if anchor is not None else f"{clock} UTC"


def _seconds_before(at, anchor):
    t = _time(at)
    return int(round((anchor - t).total_seconds())) if t is not None and anchor is not None else None


def _screen_text(screen, step) -> str:
    return (screen or "not given") + (f", step {step}" if step else "")


def _call_text(c) -> str:
    return f"{c.get('method')} {c.get('path')}, {c.get('status') or 'no answer'}"


def _on_screen_text(ids) -> str:
    ids, parts = ids or {}, []
    if ids.get("article_id"):
        title = ids.get("article_title")
        parts.append(f"article {ids['article_id']}" + (f' "{title}"' if title else ""))
    if ids.get("recap_journey_id"):
        parts.append(f"recap journey {ids['recap_journey_id']}")
    if ids.get("trace_id"):
        parts.append(f"agent turn {ids['trace_id']}")
    return "; ".join(parts) or "nothing named"


def _kind(kind) -> str:
    return KINDS.get(kind, (kind or "item",))[0]


def _describe(x) -> str:
    """One activity item in words: 'note on "The Eval Gap": "..."', or 'note on article <id>' in privacy mode."""
    kind, detail = x.get("kind"), x.get("detail")
    on = None
    if x.get("article_id"):
        on = f'"{x["article_title"]}"' if x.get("article_title") else f"article {x['article_id']}"
    if kind == "save":
        head = f"saved {on}"
    elif kind == "agent_turn":
        head = f"agent turn {x.get('trace_id')}"
    else:
        head = f"{_kind(kind)} on {on}" if on else _kind(kind)
    head += f" ({detail})" if detail else ""
    return head + (f': "{x["text"]}"' if x.get("text") else "")


def _counts_text(counts) -> str:
    return ", ".join(f"{n} {KINDS[k][0 if n == 1 else 1]}" for k, n in
                     ((k, (counts or {}).get(k, 0)) for k in KINDS) if n)


def _app_lines(client, anchor) -> list:
    lines = [f"- Screen: {_screen_text(client.get('screen'), client.get('step'))}"]
    trail = client.get("trail") or []
    if trail:
        lines.append("- Trail, newest first:")
        lines += [f"  - T{i} {_when(v.get('at'), anchor)}: {_screen_text(v.get('screen'), v.get('step'))}"
                  for i, v in enumerate(trail, 1)]
    else:
        lines.append("- Trail: none")
    lines.append(f"- On screen: {_on_screen_text(client.get('on_screen'))}")
    calls = client.get("failed_calls") or []
    if calls:
        lines.append("- Failed calls, newest first:")
        lines += [f"  - F{i} {_when(c.get('at'), anchor)}: {_call_text(c)}" for i, c in enumerate(calls, 1)]
    else:
        lines.append("- Failed calls: none")
    return lines


def _activity_lines(session, anchor) -> list:
    if session is None:  # the join failed, or the report predates it
        return [f"- {NOT_COLLECTED}"]
    items, counts = session.get("items") or [], session.get("counts") or {}
    if not items:
        return [f"- {NO_ACTIVITY}"]
    total = sum(counts.values()) or len(items)
    lines = [f"- Activity in the {session.get('window_minutes') or MINUTES} minutes before the report, newest first "
             f"({total}: {_counts_text(counts)}):"]
    lines += [f"  - A{i} {_when(x.get('at'), anchor)}: {_describe(x)}" for i, x in enumerate(items, 1)]
    if total > len(items):
        lines.append(f"  - ...and {total - len(items)} older")
    if session.get("privacy"):
        lines.append(f"- {PRIVACY_NOTE}")
    return lines


def _recap_untimed(report) -> bool:
    """The session was on Recap, but no recap answer in the window has a time. Say why, so an empty list doesn't
    read as "no answer given". On Recap: the app's screen, a trail entry or the ids on screen name it, or the
    report's own screen is "recap"."""
    session, client = _get(report, "session_context"), _get(report, "client_context") or {}
    if session is None or (session.get("counts") or {}).get("recap_answer"):
        return False
    return bool(client.get("screen") == "recap" or any(v.get("screen") == "recap" for v in client.get("trail") or [])
                or (client.get("on_screen") or {}).get("recap_journey_id")
                or (_get(report, "screen") or "").strip().lower() == "recap")


def _app_absent(report):
    """What stands in for the app's context when there is none: why it was dropped, or the build was older."""
    error = _get(report, "context_error")
    return f"{UNREADABLE}{error}." if error else NO_APP_CONTEXT


def section_lines(report) -> list:
    """The Session context section below its heading: the app's part (the screen, the trail, the ids on screen,
    the failed calls), then the activity. The issue and make report print these same lines."""
    client, anchor = _get(report, "client_context"), _time(_get(report, "created_at"))
    lines = _app_lines(client, anchor) if client is not None else [f"- {_app_absent(report)}"]
    lines += _activity_lines(_get(report, "session_context"), anchor)
    return lines + ([f"- {RECAP_UNTIMED}"] if _recap_untimed(report) else [])


def for_triage(report) -> dict:
    """The context as Claude's triage reads it: every item with its ref, times as seconds before the report."""
    client, session = _get(report, "client_context"), _get(report, "session_context")
    anchor = _time(_get(report, "created_at"))
    if client is None:
        app = _app_absent(report)
    else:
        app = {"screen": {"ref": "screen", "screen": client.get("screen"), "step": client.get("step")},
               "on_screen": {"ref": "on_screen", **(client.get("on_screen") or {})},
               "trail": [{"ref": f"T{i}", "screen": v.get("screen"), "step": v.get("step"),
                          "seconds_before": _seconds_before(v.get("at"), anchor)}
                         for i, v in enumerate(client.get("trail") or [], 1)],
               "failed_calls": [{"ref": f"F{i}", "method": c.get("method"), "path": c.get("path"),
                                 "status": c.get("status"), "seconds_before": _seconds_before(c.get("at"), anchor)}
                                for i, c in enumerate(client.get("failed_calls") or [], 1)]}
    if session is None:
        activity = NOT_COLLECTED
    else:
        activity = {"window_minutes": session.get("window_minutes"), "privacy": session.get("privacy"),
                    "counts": session.get("counts"),
                    "items": [{"ref": f"A{i}", **{k: v for k, v in x.items() if k != "at" and v is not None},
                               "seconds_before": _seconds_before(x.get("at"), anchor)}
                              for i, x in enumerate(session.get("items") or [], 1)]}
    out = {"app": app, "activity": activity}
    if _recap_untimed(report):
        out["note"] = RECAP_UNTIMED
    return out


def labels(report) -> dict:
    """Each ref for_triage gives, in a few words, for the hypothesis's "Used:" line."""
    client, session = _get(report, "client_context"), _get(report, "session_context")
    anchor, out = _time(_get(report, "created_at")), {}
    if client is not None:
        out.update({"screen": f"the screen ({_screen_text(client.get('screen'), client.get('step'))})",
                    "on_screen": "the ids on screen", "trail": "the screen trail"})
        for i, v in enumerate(client.get("trail") or [], 1):
            out[f"T{i}"] = f"T{i} ({_screen_text(v.get('screen'), v.get('step'))}, {_ago(v.get('at'), anchor)})"
        for i, c in enumerate(client.get("failed_calls") or [], 1):
            out[f"F{i}"] = f"F{i} ({_call_text(c)})"
    for i, x in enumerate((session or {}).get("items") or [], 1):
        out[f"A{i}"] = f"A{i} ({_kind(x.get('kind'))}, {_ago(x.get('at'), anchor)})"
    return out


def used_line(used, refs) -> str:
    """The refs triage relied on, in words. A ref the context doesn't hold is marked, so a made-up item can't
    pass for evidence; anything else the model wrote is shown as it is."""
    out = []
    for name in used or []:
        key = name.upper() if re.match(r"^[tfa]\d", name, re.I) else name.lower()
        out.append(refs.get(key) or (f"{name} (not in the session context)" if _REF.match(name) else name))
    return "; ".join(out) or "none of the session context"
