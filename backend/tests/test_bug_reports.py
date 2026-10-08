"""
Report a bug, beta (GUR-242): app/routes/reports.py, app/routes/admin_reports.py,
app/services/bug_reports.py and app/services/linear_client.py. With the session's
context (GUR-277): app/services/session_context.py.

Hermetic like test_admin_access.py: the real FastAPI app over httpx's ASGI
transport, an in-memory SQLite, no startup events and no network. Linear and
Claude are recording fakes, and report jobs run inline unless a test needs the
real worker thread.
"""
import json
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import httpx  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.database import get_db  # noqa: E402
from app.models.article import Article  # noqa: E402
from app.models.bug_report import BugReport  # noqa: E402
from app.models.interaction import UserAnnotation, UserSavedArticle  # noqa: E402
from app.models.qa_models import QAExchange  # noqa: E402
from app.models.recap import RecapJourney  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import agent_trace, bug_reports, linear_client  # noqa: E402
from app.services.agent_trace import TurnTrace  # noqa: E402
from app.services.auth_service import generate_jwt  # noqa: E402

pytestmark = pytest.mark.anyio

ADMIN, BETA, PERSONA, OUTSIDER = "admin@guru.app", "tester@guru.app", "persona@example.com", "someone@guru.app"
KEY = "k" * 40
BODY = {"category": "wrong_answer", "expected": "Three stories about AI chips, not an error about my feed."}
SECTIONS = ("## What the user said", "## Where", "## Session context", "## Trace summary", "## Replay ids",
            "## Suggested regression eval")
GOOD_REPLY = json.dumps({"summary": "The feed tool failed, so the agent answered with an error.",
                         "likely_cause": "get_catchup_feed returned HTTP 500 and the model went on without it.",
                         "evidence": ["trace.tool_errors[0]", "report.expected"], "severity": "High",
                         "confidence": "medium", "suggested_eval": "Fail get_catchup_feed once; expect a retry pill."})


@pytest.fixture
def anyio_backend():
    return "asyncio"


class FakeLinear:
    """Records every call. Set the fail_* fields to make Linear refuse."""

    def __init__(self):
        self.issues, self.comments, self.updates = [], [], []
        self.fail_issue = self.fail_comment = self.fail_update = None
        self.fail_labels = set()
        self.on_issue = None

    def resolve_team(self, key):
        return f"team-{key}"

    def find_or_create_label(self, team_id, name):
        if name in self.fail_labels:
            raise linear_client.LinearError("HTTP 400: Forbidden (FORBIDDEN)")
        return f"label-{name}"

    def create_issue(self, team_id, title, description, label_ids=()):
        if self.on_issue:
            self.on_issue()
        self.issues.append({"team_id": team_id, "title": title, "description": description,
                            "label_ids": list(label_ids)})
        if self.fail_issue:
            raise self.fail_issue
        n = 260 + len(self.issues)
        return {"id": f"issue-{n}", "identifier": f"GUR-{n}", "url": f"https://linear.app/guru/issue/GUR-{n}"}

    def create_comment(self, issue_id, body):
        if self.fail_comment:
            raise self.fail_comment
        self.comments.append({"issue_id": issue_id, "body": body})
        return {"id": "comment-1", "url": None}

    def update_issue_description(self, issue_id, description):
        if self.fail_update:
            raise self.fail_update
        self.updates.append({"issue_id": issue_id, "description": description})
        return {"id": issue_id}


class FakeClaude:
    def __init__(self):
        self.calls, self.fail, self.reply, self.stop = [], None, GOOD_REPLY, "end_turn"

    def client(self, **kw):  # stands in for anthropic.Anthropic(...)
        return SimpleNamespace(messages=self)

    def create(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise self.fail
        return SimpleNamespace(stop_reason=self.stop, content=[SimpleNamespace(type="text", text=self.reply)])


class Inline:
    """Runs a report job at once, so a test can read its outcome right after the request."""

    def submit(self, fn, *args):
        fn(*args)


@pytest.fixture
def api(monkeypatch):
    from app.main import app
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    users = {e: User(id=uuid.uuid4(), email=e, password_hash="x", is_active=True)
             for e in (ADMIN, BETA, PERSONA, OUTSIDER)}
    db.add_all(users.values())
    db.commit()
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    monkeypatch.setenv("BETA_EMAILS", f"{BETA},{PERSONA}")
    monkeypatch.setenv("ADMIN_API_KEY", KEY)
    monkeypatch.delenv("SYNTHETIC_EMAIL_DOMAINS", raising=False)  # example.com is synthetic by default
    fake_linear, fake_claude = FakeLinear(), FakeClaude()
    for name in ("resolve_team", "find_or_create_label", "create_issue", "create_comment", "update_issue_description"):
        monkeypatch.setattr(linear_client, name, getattr(fake_linear, name))
    monkeypatch.setattr(bug_reports.anthropic, "Anthropic", fake_claude.client)
    monkeypatch.setattr(bug_reports, "_jobs", Inline())

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db

    async def call(method, path, token=None, key=None, body=None):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if key is not None:
            headers["X-Admin-Key"] = key
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, path, headers=headers, json=body)

    def token(email):
        return generate_jwt(users[email].id, "access")

    yield SimpleNamespace(call=call, db=db, Session=Session, users=users, linear=fake_linear, claude=fake_claude,
                          admin_token=token(ADMIN), beta_token=token(BETA), persona_token=token(PERSONA),
                          outsider_token=token(OUTSIDER))
    app.dependency_overrides.pop(get_db, None)
    db.close()


def _report(api, report_id) -> BugReport:
    api.db.expire_all()
    return api.db.get(BugReport, uuid.UUID(report_id))


def _seed_report(api, email, minutes_ago=0, **columns) -> str:
    report_id = uuid.uuid4()
    fields = {"category": "wrong_answer", "expected": "It should show my saved stories.", "status": "saved",
              "traffic": "real", "attempts": 0, **columns}
    api.db.add(BugReport(id=report_id, user_id=api.users[email].id,
                         created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago), **fields))
    api.db.commit()
    return str(report_id)


def _seed_trace(api, email, when=None):
    """One agent turn for this user: get_catchup_feed fails and the agent answers anyway. `when` moves its start."""
    usage = SimpleNamespace(input_tokens=1000, output_tokens=80, cache_read_input_tokens=5000,
                            cache_creation_input_tokens=0)
    t = TurnTrace(uuid.uuid4(), api.users[email].id, "claude-sonnet-5", "goal", "catch me up on AI chips",
                  traffic="real", full_previews=True)
    t.model_started()
    t.model_done(SimpleNamespace(stop_reason="tool_use", usage=usage))
    t.tool_started("get_catchup_feed", {"filter": "core"})
    t.tool_done("get_catchup_feed", json.dumps({"error": "HTTP 500", "detail": "feed timed out"}))
    t.model_started()
    t.model_done(SimpleNamespace(stop_reason="end_turn", usage=usage))
    t.block({"type": "text", "md": "I could not load your feed right now."})
    t.block({"type": "prompt_pills", "prompts": ["Try again"]})
    row = t.to_row("blocks")
    if when is not None:
        row.created_at = when
    api.db.add(row)
    api.db.commit()
    return str(t.id), str(t.session_id)


# ── POST /api/v1/reports ─────────────────────────────────────────────────────

async def test_only_beta_testers_can_report(api):
    assert (await api.call("POST", "/api/v1/reports", body=BODY)).status_code == 401
    assert (await api.call("POST", "/api/v1/reports", token=api.outsider_token, body=BODY)).status_code == 403
    refused = await api.call("POST", "/api/v1/reports", token=api.outsider_token, body={"category": "nope"})
    assert refused.status_code == 403, "decided before the body is even validated"
    assert api.db.query(BugReport).count() == 0 and api.linear.issues == []

    ok = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    assert ok.status_code == 200, ok.text
    out = ok.json()
    assert set(out) == {"id", "reference", "status"} and out["status"] == "saved"
    assert out["reference"] == uuid.UUID(out["id"]).hex[:8]
    assert (await api.call("POST", "/api/v1/reports", token=api.admin_token, body=BODY)).status_code == 200, \
        "admins are beta too"


@pytest.mark.parametrize("body", [
    {"category": "crash", "expected": "It should open the story."},  # not a category
    {"category": "wrong_answer", "expected": ""},
    {"category": "wrong_answer", "expected": "  \n  "},
    {"category": "wrong_answer"},
    {"category": "wrong_answer", "expected": "x" * 2001},
    {"category": "other", "expected": "ok", "screen": "s" * 121},
    {"category": "other", "expected": "ok", "trace_id": "not-a-uuid"},
])
async def test_a_report_needs_a_category_and_what_the_user_expected(api, body):
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=body)
    assert r.status_code == 422, r.text
    assert api.db.query(BugReport).count() == 0 and api.linear.issues == []


async def test_the_report_is_saved_and_answered_before_it_is_filed(api, monkeypatch):
    # The real worker thread: Linear waits until the request has finished, and records
    # what the database held when it was called.
    pool = ThreadPoolExecutor(max_workers=1)
    monkeypatch.setattr(bug_reports, "_jobs", pool)
    order, statuses, request_done = [], [], threading.Event()

    def on_issue():
        request_done.wait(timeout=5)
        order.append("linear")
        with api.Session() as s:
            statuses.append(s.query(BugReport.status).scalar())

    api.linear.on_issue = on_issue
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    order.append("response")
    request_done.set()
    pool.shutdown(wait=True)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "saved"
    assert order == ["response", "linear"], "the response must never wait for Linear"
    assert statuses == ["saved"], "the report is stored before filing starts"
    assert _report(api, r.json()["id"]).status == "filed"


# ── Filing and triage ────────────────────────────────────────────────────────

async def test_filing_makes_one_labeled_issue_from_the_template(api):
    trace_id, session_id = _seed_trace(api, BETA)
    expected = "The catch-up should list my three AI chip stories.\nInstead it said the feed failed. Twice."
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token,
                       body={"category": "wrong_answer", "expected": expected, "screen": "guru", "client": "ios",
                             "trace_id": trace_id, "session_id": session_id})
    assert r.status_code == 200, r.text
    [issue] = api.linear.issues
    assert issue["team_id"] == "team-GUR" and issue["label_ids"] == ["label-beta-report"]
    assert issue["title"] == "[beta] wrong_answer: " + " ".join(expected.split())[:60]
    body = issue["description"]
    positions = [body.find(s) for s in SECTIONS]
    assert -1 not in positions and positions == sorted(positions), "every section, in order"
    for line in ("> The catch-up should list my three AI chip stories.", "- Screen: guru", "- Client: ios",
                 "- Input (goal): catch me up on AI chips", "- Outcome: blocks", "- Model calls: 2",
                 "- Tools with errors: get_catchup_feed (HTTP 500 feed timed out)",
                 "- Diagnosis: get_catchup_feed returned an error", "[high] TOOL_ERROR",
                 "1. text: I could not load your feed right now.", "2. prompt_pills: Try again",
                 f"- Session: {session_id}", f"`make trace ID={trace_id}`", "Placeholder: triage fills"):
        assert line in body, line

    report = _report(api, r.json()["id"])
    assert report.status == "filed" and report.attempts == 1 and report.error is None
    assert report.linear_identifier == "GUR-261" and report.linear_url.endswith("/GUR-261") and report.filed_at
    assert report.traffic == "real" and report.client == "ios" and report.build_sha and report.prompt_version

    # Triage: one Claude call on the agent's model with the user's words and the trace, then a comment
    [call] = api.claude.calls
    assert call["model"] == bug_reports.TRIAGE_MODEL and call["max_tokens"] == bug_reports.TRIAGE_MAX_TOKENS
    sent = json.loads(call["messages"][0]["content"])
    assert sent["report"]["expected"] == expected and sent["trace"]["tool_errors"][0]["name"] == "get_catchup_feed"
    [comment] = api.linear.comments
    assert comment["issue_id"] == "issue-261" and comment["body"].startswith("## Triage hypothesis")
    hypothesis = json.loads(report.hypothesis)
    assert hypothesis["severity"] == "high" and hypothesis["confidence"] == "medium"
    assert hypothesis["summary"].startswith("The feed tool failed") and hypothesis["comment"] == "posted"

    # A synthetic account's report carries the synthetic label too
    r = await api.call("POST", "/api/v1/reports", token=api.persona_token,
                       body={"category": "slow", "expected": "Faster, please"})
    assert r.status_code == 200 and len(api.linear.issues) == 2
    assert api.linear.issues[1]["label_ids"] == ["label-beta-report", "label-synthetic"]
    assert "No trace attached." in api.linear.issues[1]["description"]


async def test_a_label_linear_refuses_is_skipped_and_noted(api):
    api.linear.fail_labels = {"synthetic"}
    r = await api.call("POST", "/api/v1/reports", token=api.persona_token, body=BODY)
    report = _report(api, r.json()["id"])
    assert api.linear.issues[0]["label_ids"] == ["label-beta-report"]
    assert report.status == "filed" and "Filed without the synthetic label" in report.error
    assert "FORBIDDEN" in report.error


async def test_a_linear_outage_keeps_the_report_as_failed(api):
    api.linear.fail_issue = linear_client.LinearError("HTTP 503: Service Unavailable")
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    assert r.status_code == 200 and r.json()["status"] == "saved"
    report = _report(api, r.json()["id"])
    assert report.status == "failed" and "HTTP 503" in report.error and report.attempts == 1
    assert report.expected == BODY["expected"] and report.linear_identifier is None
    assert api.claude.calls == [] and api.linear.comments == [], "no triage without an issue"


async def test_a_failed_triage_never_touches_the_filed_issue(api):
    async def report():
        r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
        return _report(api, r.json()["id"])

    api.claude.fail = RuntimeError("overloaded")
    first = await report()
    assert first.status == "filed" and first.linear_identifier == "GUR-261" and first.error is None
    assert "overloaded" in json.loads(first.hypothesis)["error"] and api.linear.comments == []

    api.claude.fail, api.claude.reply = None, "I think the feed timed out."
    assert "not a JSON object" in json.loads((await report()).hypothesis)["error"]

    api.claude.reply, api.claude.stop = GOOD_REPLY, "refusal"
    assert "refusal" in json.loads((await report()).hypothesis)["error"]
    assert api.linear.updates == [], "a failed triage never rewrites the issue"

    api.claude.stop, api.linear.fail_comment = "end_turn", linear_client.LinearError("HTTP 500: boom")
    last = await report()
    hypothesis = json.loads(last.hypothesis)
    assert last.status == "filed" and hypothesis["summary"] and "HTTP 500" in hypothesis["comment_error"]
    assert len(api.linear.issues) == 4 and api.linear.comments == []
    assert [u["issue_id"] for u in api.linear.updates] == ["issue-264"], "a refused comment doesn't stop the body"


async def test_the_triage_writes_its_hypothesis_into_the_issue_body(api):
    trace_id, session_id = _seed_trace(api, BETA)
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token,
                       body={**BODY, "trace_id": trace_id, "session_id": session_id})
    [issue], [update], [comment] = api.linear.issues, api.linear.updates, api.linear.comments
    filed, body = issue["description"], update["description"]
    assert update["issue_id"] == comment["issue_id"] == "issue-261"
    assert bug_reports.EVAL_PLACEHOLDER in filed and bug_reports.EVAL_PLACEHOLDER not in body

    sections = SECTIONS[:-1] + ("## Triage hypothesis", "## Suggested regression eval")
    positions = [body.find(s) for s in sections]
    assert -1 not in positions and positions == sorted(positions), "the hypothesis goes just before the eval"
    head = filed[:filed.find("## Suggested regression eval")]
    assert body.startswith(head), "everything above it stays as filed"
    section = body[body.find("## Triage hypothesis"):body.find("## Suggested regression eval")]
    for line in ("**Summary:** The feed tool failed, so the agent answered with an error.",
                 "**Likely cause:** get_catchup_feed returned HTTP 500 and the model went on without it.",
                 "**Severity:** high. **Confidence:** medium.",
                 "**Evidence:**\n- trace.tool_errors[0]\n- report.expected",
                 "**Used:** none of the session context",
                 f"_{bug_reports.TRIAGE_MODEL} read the report, the session context and the rule findings. "
                 "A hypothesis to check, not a verdict._"):
        assert line in section, line
    assert body.endswith("## Suggested regression eval\nFail get_catchup_feed once; expect a retry pill.")
    assert "**Suggested regression eval:**" not in body, "the eval sits in its own section, once"

    assert comment["body"].startswith("## Triage hypothesis"), "the comment still goes up"
    assert "**Suggested regression eval:** Fail get_catchup_feed once" in comment["body"]
    stored = json.loads(_report(api, r.json()["id"]).hypothesis)
    assert stored["comment"] == "posted" and stored["description"] == "updated"


async def test_a_failed_description_update_leaves_the_report_filed(api, caplog):
    api.linear.fail_update = linear_client.LinearError("HTTP 400: Entity not found (INVALID_INPUT)")
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    assert r.status_code == 200, r.text
    report = _report(api, r.json()["id"])
    assert report.status == "filed" and report.linear_identifier == "GUR-261" and report.error is None
    hypothesis = json.loads(report.hypothesis)
    assert hypothesis["summary"] and hypothesis["comment"] == "posted"
    assert "INVALID_INPUT" in hypothesis["description_error"] and "description" not in hypothesis
    assert len(api.linear.comments) == 1 and api.linear.updates == []
    assert "issue description not updated" in caplog.text


# ── Admin ────────────────────────────────────────────────────────────────────

async def test_admin_report_reads_need_an_admin_or_the_key(api):
    report_id = _seed_report(api, BETA)
    for path in ("/api/v1/admin/reports", f"/api/v1/admin/reports/{report_id}"):
        assert (await api.call("GET", path)).status_code == 401
        assert (await api.call("GET", path, token=api.outsider_token)).status_code == 403
        assert (await api.call("GET", path, token=api.beta_token)).status_code == 403, "beta is not admin"
        assert (await api.call("GET", path, key="wrong" * 10)).status_code == 403
        assert (await api.call("GET", path, key=KEY)).status_code == 200
        assert (await api.call("GET", path, token=api.admin_token)).status_code == 200


async def test_the_admin_list_is_newest_first_and_filters(api):
    trace_id, _ = _seed_trace(api, BETA)
    newest = _seed_report(api, BETA, minutes_ago=60, status="filed", expected="x" * 300, trace_id=trace_id,
                          linear_identifier="GUR-300", linear_url="https://linear.app/guru/issue/GUR-300",
                          hypothesis=json.dumps({"summary": "The feed failed."}))
    failed = _seed_report(api, BETA, minutes_ago=120, status="failed")
    synthetic = _seed_report(api, PERSONA, minutes_ago=180, traffic="synthetic")
    old = _seed_report(api, BETA, minutes_ago=60 * 24 * 20, status="filed")

    async def ids(query=""):
        r = await api.call("GET", f"/api/v1/admin/reports{query}", key=KEY)
        assert r.status_code == 200, r.text
        return [row["id"] for row in r.json()["reports"]]

    assert await ids() == [newest, failed], "real traffic, last 7 days, newest first"
    assert await ids("?status=failed") == [failed]
    assert await ids("?traffic=synthetic") == [synthetic]
    assert await ids("?traffic=all") == [newest, failed, synthetic]
    assert await ids("?traffic=all&days=30") == [newest, failed, synthetic, old]
    assert (await api.call("GET", "/api/v1/admin/reports?status=lost", key=KEY)).status_code == 422

    row = (await api.call("GET", "/api/v1/admin/reports", key=KEY)).json()["reports"][0]
    assert row["reference"] == uuid.UUID(newest).hex[:8] and row["user_email"] == BETA
    assert row["expected"] == "x" * 160 and row["status"] == "filed"
    assert row["linear_identifier"] == "GUR-300" and row["linear_url"].endswith("/GUR-300")
    assert row["trace_id"] == trace_id and "get_catchup_feed returned an error" in row["trace_headline"]
    assert row["hypothesis_summary"] == "The feed failed."
    assert row["traffic"] == "real" and isinstance(row["trace_first_block_ms"], int)  # the row's chip, no second call
    synthetic_row = (await api.call("GET", "/api/v1/admin/reports?traffic=synthetic", key=KEY)).json()["reports"][0]
    assert synthetic_row["traffic"] == "synthetic" and synthetic_row["trace_first_block_ms"] is None


async def test_the_detail_carries_the_reported_turn(api):
    trace_id, session_id = _seed_trace(api, BETA)
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token,
                       body={**BODY, "trace_id": trace_id, "session_id": session_id})
    d = (await api.call("GET", f"/api/v1/admin/reports/{r.json()['id']}", key=KEY)).json()
    assert d["report"]["expected"] == BODY["expected"] and d["report"]["status"] == "filed"
    assert d["report"]["user_email"] == BETA and d["report"]["hypothesis"]["summary"]
    assert d["trace"]["id"] == trace_id and d["trace"]["session_id"] == session_id
    assert d["trace"]["user_email"] == BETA and "get_catchup_feed returned an error" in d["trace"]["headline"]
    assert d["diagnosis"]["findings"][0]["code"] == "TOOL_ERROR"

    # A report naming someone else's turn never shows that turn, in the admin view or in Linear
    other_trace, _ = _seed_trace(api, OUTSIDER)
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "trace_id": other_trace})
    d = (await api.call("GET", f"/api/v1/admin/reports/{r.json()['id']}", token=api.admin_token)).json()
    assert d["trace"] is None and d["report"]["trace_id"] == other_trace
    assert "was not found for this user" in api.linear.issues[-1]["description"]
    assert "get_catchup_feed" not in api.linear.issues[-1]["description"]

    assert (await api.call("GET", f"/api/v1/admin/reports/{uuid.uuid4()}", key=KEY)).status_code == 404
    assert (await api.call("GET", "/api/v1/admin/reports/not-a-uuid", key=KEY)).status_code == 404


async def test_a_turn_links_back_to_the_reports_filed_against_it(api, monkeypatch, capsys):
    """Report and trace link both ways: a turn's admin detail lists its own user's reports, and make trace prints them."""
    trace_id, _ = _seed_trace(api, BETA)
    mine = (await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "trace_id": trace_id})).json()
    # A report naming someone else's turn is never linked to it
    await api.call("POST", "/api/v1/reports", token=api.persona_token, body={**BODY, "trace_id": trace_id})

    d = (await api.call("GET", f"/api/v1/admin/agent/turns/{trace_id}", key=KEY)).json()
    assert [(r["id"], r["reference"], r["status"], r["linear_identifier"]) for r in d["reports"]] == \
        [(mine["id"], mine["reference"], "filed", "GUR-261")]
    other, _ = _seed_trace(api, BETA)
    assert (await api.call("GET", f"/api/v1/admin/agent/turns/{other}", key=KEY)).json()["reports"] == []

    monkeypatch.syspath_prepend(os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import traces
    traces.print_turn(d)
    assert f"make report ID={mine['id']}" in capsys.readouterr().out


def _reports_cli(monkeypatch, api):
    """scripts/reports.py as a module, reading this test's database."""
    import importlib.util
    from app.db import database
    scripts = os.path.join(os.path.dirname(__file__), "..", "scripts")
    monkeypatch.syspath_prepend(scripts)
    spec = importlib.util.spec_from_file_location("reports_cli", os.path.join(scripts, "reports.py"))
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    monkeypatch.setattr(database, "SessionLocal", api.Session)
    return cli


def test_make_reports_prints_what_the_admin_view_shows(api, monkeypatch, capsys):
    """scripts/reports.py (make reports) reads through the admin routes themselves, so the terminal and the
    admin view can't drift apart."""
    import asyncio
    cli = _reports_cli(monkeypatch, api)

    trace_id, _ = _seed_trace(api, BETA)
    filed = _seed_report(api, BETA, minutes_ago=5, status="filed", trace_id=trace_id, linear_identifier="GUR-300",
                         linear_url="https://linear.app/guru/issue/GUR-300",
                         hypothesis=json.dumps({"summary": "The feed failed.", "confidence": "medium", "severity": "high",
                                                "evidence": ["trace.tool_errors[0]"],
                                                "suggested_eval": "Fail get_catchup_feed once."}))
    failed = _seed_report(api, BETA, minutes_ago=10, status="failed", error="HTTP 503 from Linear")

    rows = cli._local("list", days=7, status=None, traffic="real", report_id=None)
    assert json.loads(json.dumps(rows)) == asyncio.run(api.call("GET", "/api/v1/admin/reports", key=KEY)).json()
    assert [r["id"] for r in cli._local("list", days=7, status="failed", traffic="real", report_id=None)["reports"]] == [failed]
    cli.print_rows(rows["reports"])
    out = capsys.readouterr().out
    assert "GUR-300" in out and "not filed" in out and "Claude: The feed failed." in out
    assert "get_catchup_feed returned an error" in out and f"id {filed}" in out

    cli.print_report(cli._local("show", days=7, status=None, traffic="real", report_id=filed))
    out = capsys.readouterr().out
    assert "Linear GUR-300 https://linear.app/guru/issue/GUR-300" in out and "eval to add: Fail get_catchup_feed once." in out
    assert f"make trace ID={trace_id}" in out
    cli.print_report(cli._local("show", days=7, status=None, traffic="real", report_id=failed))
    assert "error: HTTP 503 from Linear" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="Report not found"):
        cli._local("show", days=7, status=None, traffic="real", report_id=str(uuid.uuid4()))


async def test_retry_files_a_failed_or_stuck_report_again(api):
    api.linear.fail_issue = linear_client.LinearError("HTTP 503: Service Unavailable")
    report_id = (await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)).json()["id"]
    path = f"/api/v1/admin/reports/{report_id}/retry"
    assert (await api.call("POST", path, key=KEY)).status_code == 401, "the key reads; it never files"
    assert (await api.call("POST", path, token=api.beta_token)).status_code == 403

    api.linear.fail_issue = None
    r = await api.call("POST", path, token=api.admin_token)
    assert r.status_code == 200, r.text
    report = r.json()["report"]
    assert report["status"] == "filed" and report["attempts"] == 2 and report["error"] is None
    assert report["linear_identifier"] == "GUR-262" and len(api.linear.issues) == 2
    assert len(api.claude.calls) == 1 and api.linear.comments[0]["issue_id"] == "issue-262", \
        "the triage follows a successful retry"
    assert (await api.call("POST", path, token=api.admin_token)).status_code == 409, \
        "a filed report is never filed twice"

    # A report still "saved" long after its job should have run lost that job to a restart.
    fresh = _seed_report(api, BETA, minutes_ago=1)
    stuck = _seed_report(api, BETA, minutes_ago=11)
    assert (await api.call("POST", f"/api/v1/admin/reports/{fresh}/retry", token=api.admin_token)).status_code == 409
    r = await api.call("POST", f"/api/v1/admin/reports/{stuck}/retry", token=api.admin_token)
    assert r.status_code == 200 and r.json()["report"]["status"] == "filed"
    assert (await api.call("POST", f"/api/v1/admin/reports/{uuid.uuid4()}/retry",
                           token=api.admin_token)).status_code == 404


# ── Session context (GUR-277) ────────────────────────────────────────────────

KINDS = ("note", "highlight", "save", "question", "recap_answer", "agent_turn")
ITEM_KEYS = {"kind", "at", "text", "article_id", "article_title", "trace_id", "detail"}
NO_APP = "- No session context: sent by an app build from before GUR-277."
NO_ACTIVITY = "- No activity in the 30 minutes before the report."
UNREADABLE = "- The app sent a session context the server couldn't read: "
RECAP_UNTIMED = "- Recap screen answers aren't timestamped, so they can't be placed in the window."
PRIVACY_LINE = "- Privacy mode: kinds, counts, times and ids only."


def _now():
    return datetime.now(timezone.utc)


def _context(**over):
    """A context as the app sends it: both lists newest first."""
    now = _now()

    def ago(seconds):
        return (now - timedelta(seconds=seconds)).isoformat()

    return {"screen": "recap", "step": "stage-3", "on_screen": {"recap_journey_id": str(uuid.uuid4())},
            "trail": [{"screen": "recap", "step": "stage-3", "at": ago(60)}, {"screen": "article", "at": ago(300)},
                      {"screen": "guru", "at": ago(600)}],
            "failed_calls": [{"method": "POST", "path": "/recap/j-1/socratic", "status": 500, "at": ago(20)},
                             {"method": "get", "path": "/articles/a-1", "status": 0, "at": ago(200)}],
            **over}


def _section(body):
    return body[body.find("## Session context"):body.find("## Trace summary")]


def _lines(section, ref):
    """The section's numbered lines of one kind, T (trail), F (failed calls) or A (activity), in order, from the ref."""
    return [line.strip()[2:] for line in section.splitlines() if re.match(rf"\s+- {ref}\d+ ", line)]


def _article(api, title="The Eval Gap"):
    article_id = uuid.uuid4()
    api.db.add(Article(id=article_id, url=f"https://example.com/{article_id}", title=title))
    api.db.commit()
    return article_id


def _note(api, email, article_id, when, note=None, passage="Evals lag the product they grade."):
    """A highlight, or a note on it when `note` is given."""
    api.db.add(UserAnnotation(user_id=api.users[email].id, article_id=article_id, highlighted_text=passage,
                              note_text=note, start_offset=0, end_offset=len(passage), created_at=when))
    api.db.commit()


def _save(api, email, article_id, when):
    api.db.add(UserSavedArticle(user_id=api.users[email].id, article_id=article_id, saved_at=when))
    api.db.commit()


def _question(api, email, article_id, when, question, answer="Because the product moves first."):
    api.db.add(QAExchange(user_id=api.users[email].id, article_id=article_id, question=question, answer=answer,
                          model_used="haiku", created_at=when))
    api.db.commit()


def _journey(api, email, replies=(), answers=2, commitment=None, completed_at=None, weeks_ago=0):
    """A recap journey with three guided questions, `answers` of them answered on the Recap screen (no time
    of their own), and Socratic replies, each (when, text), with Guru's turn before each one."""
    def utc_naive(dt):  # how the recap service writes them: datetime.utcnow().isoformat()
        return dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat()

    exchanges = []
    for when, text in replies:
        exchanges += [{"role": "assistant", "content": "What pulled you to that line?",
                       "timestamp": utc_naive(when - timedelta(seconds=5))},
                      {"role": "user", "content": text, "timestamp": utc_naive(when)}]
    journey_id, week = uuid.uuid4(), date.today() - timedelta(days=7 * weeks_ago)
    api.db.add(RecapJourney(id=journey_id, user_id=api.users[email].id, week_start=week,
                            week_end=week + timedelta(days=6), status="stage_3", stage_progress=3,
                            guided_questions=[{"type": "reflection", "text": f"Question {i + 1}"} for i in range(3)],
                            guided_responses={str(i): f"Guided answer {i + 1}" for i in range(answers)},
                            socratic_exchanges=exchanges, commitment_text=commitment, completed_at=completed_at))
    api.db.commit()
    return journey_id


def _seed_answer_turn(api, email, journey_id, question_index, when, typed="my answer: evals lag the product"):
    """An agent turn that submits a Stage 2 answer with submit_recap_answer: the one Stage 2 answer with a time."""
    usage = SimpleNamespace(input_tokens=1000, output_tokens=80, cache_read_input_tokens=5000,
                            cache_creation_input_tokens=0)
    t = TurnTrace(uuid.uuid4(), api.users[email].id, "claude-sonnet-5", "message", typed, traffic="real")
    t.model_started()
    t.model_done(SimpleNamespace(stop_reason="tool_use", usage=usage))
    t.tool_started("submit_recap_answer", {"journey_id": str(journey_id), "question_index": question_index,
                                           "response": typed})
    t.tool_done("submit_recap_answer", json.dumps({"stored": True, "question_index": question_index}))
    t.model_started()
    t.model_done(SimpleNamespace(stop_reason="end_turn", usage=usage))
    t.block({"type": "text", "md": "Noted."})
    row = t.to_row("blocks")
    row.created_at = when
    api.db.add(row)
    api.db.commit()
    return str(t.id)


async def test_the_issue_carries_the_session_context_between_where_and_the_trace(api):
    now = _now()
    article, saved = _article(api, "The Eval Gap"), _article(api, "Per-Seat Pricing Breaks")
    journey = _journey(api, BETA, replies=[(now - timedelta(seconds=90), "Both pieces say evals lag the product.")])
    _note(api, BETA, article, now - timedelta(minutes=4), note="Undo only when the action is reversible.")
    _question(api, BETA, article, now - timedelta(minutes=6), "Why does this matter?")
    _save(api, BETA, saved, now - timedelta(minutes=8))
    trace_id, _ = _seed_trace(api, BETA)  # the report names no turn, so the latest one joins the activity
    context = _context(on_screen={"article_id": str(article), "recap_journey_id": str(journey)})
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token,
                       body={**BODY, "screen": "recap", "context": context})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"id", "reference", "status"}

    body = api.linear.issues[0]["description"]
    positions = [body.find(s) for s in SECTIONS]
    assert -1 not in positions and positions == sorted(positions), "Session context sits between Where and the trace"
    section = _section(body)
    parts = [section.find(s) for s in ("- Screen: recap, step stage-3", "- Trail, newest first:", "- On screen:",
                                       "- Failed calls, newest first:",
                                       "- Activity in the 30 minutes before the report, newest first")]
    assert -1 not in parts and parts == sorted(parts), "the screen, the trail, the ids on screen, the calls, the activity"
    trail = _lines(section, "T")
    assert [re.search(r"before\): (\w+)", line).group(1) for line in trail] == ["recap", "article", "guru"]
    assert re.fullmatch(r"T1 \d\d:\d\d:\d\d UTC \(1m( \ds)? before\): recap, step stage-3", trail[0]), trail[0]
    assert f'- On screen: article {article} "The Eval Gap"; recap journey {journey}' in section
    calls = _lines(section, "F")
    assert calls[0].endswith(": POST /recap/j-1/socratic, 500")
    assert calls[1].endswith(": GET /articles/a-1, no answer"), "status 0: the call never got an answer"
    activity = _lines(section, "A")
    expected = (f'agent turn {trace_id} (2 blocks): "catch me up on AI chips"',
                'recap answer (stage 3, reply 1): "Both pieces say evals lag the product."',
                'note on "The Eval Gap": "Undo only when the action is reversible."',
                'question on "The Eval Gap": "Why does this matter?"',
                'saved "Per-Seat Pricing Breaks"')
    assert len(activity) == len(expected)
    for line, words in zip(activity, expected):
        assert line.endswith(words), line
    assert "(5: 1 note, 1 save, 1 question, 1 recap answer, 1 agent turn)" in section
    assert RECAP_UNTIMED not in section, "a datable recap answer is in the window"

    report = _report(api, r.json()["id"])
    stored = report.client_context
    assert (stored["screen"], stored["step"], report.context_error) == ("recap", "stage-3", None)
    assert stored["on_screen"] == {"article_id": str(article), "recap_journey_id": str(journey), "trace_id": None,
                                   "article_title": "The Eval Gap"}, "the server fills in the title"
    assert [v["screen"] for v in stored["trail"]] == ["recap", "article", "guru"] and stored["trail"][1]["step"] is None
    assert stored["failed_calls"][1] == {"method": "GET", "path": "/articles/a-1", "status": 0,
                                         "at": context["failed_calls"][1]["at"]}
    snap = report.session_context
    assert set(snap) == {"window_minutes", "privacy", "counts", "items"}
    assert snap["window_minutes"] == 30 and snap["privacy"] is False
    assert snap["counts"] == {"note": 1, "highlight": 0, "save": 1, "question": 1, "recap_answer": 1, "agent_turn": 1}
    assert [x["kind"] for x in snap["items"]] == ["agent_turn", "recap_answer", "note", "question", "save"]
    assert all(set(x) == ITEM_KEYS for x in snap["items"]), "every item has every key, null where it doesn't apply"
    turn, answer, note, question, save = snap["items"]
    assert (turn["trace_id"], turn["detail"], turn["text"]) == (trace_id, "2 blocks", "catch me up on AI chips")
    assert (answer["detail"], answer["article_id"], answer["trace_id"]) == ("stage 3, reply 1", None, None)
    assert (note["text"], note["article_id"], note["article_title"]) == (
        "Undo only when the action is reversible.", str(article), "The Eval Gap")
    assert (save["text"], save["article_title"]) == (None, "Per-Seat Pricing Breaks")


async def test_a_report_without_context_still_files_and_still_joins_the_activity(api):
    for body in (BODY, {**BODY, "context": None}):
        r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=body)
        assert r.status_code == 200 and set(r.json()) == {"id", "reference", "status"}, r.text
        report = _report(api, r.json()["id"])
        assert report.status == "filed" and report.client_context is None and report.context_error is None
        assert report.session_context == {"window_minutes": 30, "privacy": False, "items": [],
                                          "counts": {k: 0 for k in KINDS}}
        section = _section(api.linear.issues[-1]["description"])
        assert NO_APP in section and NO_ACTIVITY in section and "- Screen:" not in section
    from sqlalchemy import text
    assert api.db.execute(text("SELECT count(*) FROM bug_reports WHERE client_context IS NULL")).scalar() == 2, \
        "no context is SQL NULL, not a JSON null"

    # An older app's report still gets the server's own join
    _note(api, BETA, _article(api), _now() - timedelta(minutes=2), note="Written just before the report.")
    await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    section = _section(api.linear.issues[-1]["description"])
    assert NO_APP in section and NO_ACTIVITY not in section
    assert _lines(section, "A")[0].endswith('note on "The Eval Gap": "Written just before the report."')


async def test_privacy_mode_keeps_kinds_counts_times_and_ids_only(api, monkeypatch):
    monkeypatch.setattr(agent_trace, "FULL_TEXT_FOR_ALL", False)
    now = _now()
    article = _article(api, "PRIVATE-TITLE")
    journey = _journey(api, BETA, answers=3, replies=[(now - timedelta(minutes=3), "PRIVATE-REPLY")],
                       commitment="PRIVATE-COMMITMENT", completed_at=now - timedelta(minutes=1))
    _seed_answer_turn(api, BETA, journey, 2, now - timedelta(minutes=2), typed="PRIVATE-TYPED")
    _note(api, BETA, article, now - timedelta(minutes=5), note="PRIVATE-NOTE", passage="PRIVATE-PASSAGE")
    _note(api, BETA, article, now - timedelta(minutes=6), passage="PRIVATE-HIGHLIGHT")
    _question(api, BETA, article, now - timedelta(minutes=7), "PRIVATE-QUESTION", answer="PRIVATE-ANSWER")
    _save(api, BETA, article, now - timedelta(minutes=8))
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token,
                       body={**BODY, "context": _context(on_screen={"article_id": str(article)})})
    assert r.status_code == 200, r.text

    report = _report(api, r.json()["id"])
    snap = report.session_context
    seen = [api.linear.issues[0]["description"], api.linear.updates[0]["description"], api.linear.comments[0]["body"],
            json.dumps([report.client_context, snap]), json.dumps([c["messages"] for c in api.claude.calls])]
    for words in ("PRIVATE-", "Guided answer"):
        assert not [s for s in seen if words in s], f"{words} reached the issue, the snapshot or the triage"
    assert snap["privacy"] is True
    assert snap["counts"] == {"note": 1, "highlight": 1, "save": 1, "question": 1, "recap_answer": 3, "agent_turn": 1}
    assert all(x["text"] is None and x["article_title"] is None for x in snap["items"]), "no text, no title"
    assert [x["detail"] for x in snap["items"] if x["kind"] == "recap_answer"] == [
        "commitment", "stage 2, answer 3 of 3", "stage 3, reply 1"], "details are positions, never words: they stay"
    assert {x["article_id"] for x in snap["items"] if x["article_id"]} == {str(article)}
    assert report.client_context["on_screen"]["article_title"] is None, "no title is filled in privacy mode"
    section = _section(api.linear.issues[0]["description"])
    assert f"note on article {article}" in section and PRIVACY_LINE in section


async def test_only_the_reporters_own_rows_are_joined(api):
    now = _now()
    mine, theirs = _article(api, "The Eval Gap"), _article(api, "A Story Only Someone Else Read")
    _note(api, BETA, mine, now - timedelta(minutes=4), note="My own note, the control.")
    their_journey = _journey(api, OUTSIDER, answers=3, replies=[(now - timedelta(minutes=1), "THEIR-REPLY")],
                             commitment="THEIR-COMMITMENT", completed_at=now - timedelta(minutes=1))
    _note(api, OUTSIDER, theirs, now - timedelta(minutes=2), note="THEIR-NOTE")  # saved minutes before the report
    _note(api, OUTSIDER, theirs, now - timedelta(minutes=2), passage="THEIR-HIGHLIGHT")
    _save(api, OUTSIDER, theirs, now - timedelta(minutes=2))
    _question(api, OUTSIDER, theirs, now - timedelta(minutes=2), "THEIR-QUESTION")
    their_turn, _ = _seed_trace(api, OUTSIDER)
    their_answer = _seed_answer_turn(api, OUTSIDER, their_journey, 0, now - timedelta(minutes=1), typed="THEIR-TYPED")
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": _context()})
    assert r.status_code == 200, r.text

    report = _report(api, r.json()["id"])
    body, stored = api.linear.issues[0]["description"], json.dumps([report.client_context, report.session_context])
    for leak in ("THEIR-", "Guided answer", "A Story Only Someone Else Read", str(theirs), their_turn, their_answer,
                 str(their_journey), "catch me up on AI chips"):
        assert leak not in body and leak not in stored, leak
    assert "My own note, the control." in body, "the join ran: the reporter's own note is there"
    assert report.session_context["counts"] == {"note": 1, "highlight": 0, "save": 0, "question": 0,
                                                "recap_answer": 0, "agent_turn": 0}


async def test_the_30_minute_window_holds_at_both_edges(api):
    report_id = _seed_report(api, BETA, minutes_ago=60)
    created = bug_reports._aware(_report(api, report_id).created_at)
    start, tick = created - timedelta(minutes=30), timedelta(seconds=1)
    article = _article(api)
    for when, label in ((start - tick, "OUT before"), (start, "IN at the start"), (created, "IN at the report"),
                        (created + tick, "OUT after")):
        _note(api, BETA, article, when, note=f"note {label}")
    journey = _journey(api, BETA, replies=[(start - tick, "reply OUT before"), (start, "reply IN at the start"),
                                           (created + tick, "reply OUT after")])
    _question(api, BETA, article, created, "question IN at the report")
    _question(api, BETA, article, created + tick, "question OUT after")
    _save(api, BETA, _article(api, "Saved OUT"), start - tick)
    _save(api, BETA, _article(api, "Saved IN"), start)
    latest, _ = _seed_trace(api, BETA, when=created)
    _seed_trace(api, BETA, when=created + tick)  # newer, but after the report
    _seed_answer_turn(api, BETA, journey, 0, created + tick)
    bug_reports.file_report(report_id, bug_reports.sessions_for(api.db))

    snap = _report(api, report_id).session_context
    texts = [x["text"] for x in snap["items"] if x["text"]]
    assert not [t for t in texts if "OUT" in t]
    assert {"note IN at the start", "note IN at the report", "reply IN at the start",
            "question IN at the report"} <= set(texts)
    assert [x["article_title"] for x in snap["items"] if x["kind"] == "save"] == ["Saved IN"]
    assert [x["trace_id"] for x in snap["items"] if x["kind"] == "agent_turn"] == [latest]
    assert snap["counts"] == {"note": 2, "highlight": 0, "save": 1, "question": 1, "recap_answer": 1, "agent_turn": 1}
    times = [datetime.fromisoformat(x["at"]) for x in snap["items"]]
    assert times == sorted(times, reverse=True) and (min(times), max(times)) == (start, created)


async def test_the_activity_keeps_the_newest_ten_and_clips_each_text(api):
    now, article = _now(), _article(api)
    long_note = " ".join(f"word{i}" for i in range(200))
    for i in range(12):
        _note(api, BETA, article, now - timedelta(minutes=i + 1),
              note=long_note if i == 0 else f"note {i + 1} minutes before")
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body=BODY)
    snap = _report(api, r.json()["id"]).session_context
    assert snap["counts"]["note"] == 12 and len(snap["items"]) == 10
    assert snap["items"][-1]["text"] == "note 10 minutes before", "the two oldest are left out"
    clipped = snap["items"][0]["text"]
    assert len(clipped) <= 201 and long_note.startswith(clipped[:-1])
    assert re.fullmatch(r"(word\d+ )*word\d+…", clipped), "cut at a word, and marked"
    section = _section(api.linear.issues[0]["description"])
    assert len(_lines(section, "A")) == 10 and "(12: 12 notes)" in section and "  - ...and 2 older" in section


async def test_recap_answers_count_by_the_times_that_exist(api):
    """A Stage 3 reply and the commitment carry their own times, and a Stage 2 answer has one only when the
    agent submitted it. An answer typed on the Recap screen keeps no time, so it is never counted, and the
    section says so when the session was on Recap and no recap answer could be placed."""
    now = _now()
    journey = _journey(api, BETA, answers=3, commitment="Read one paper a week.", completed_at=now - timedelta(minutes=1),
                       replies=[(now - timedelta(minutes=40), "An older reply."),
                                (now - timedelta(minutes=3), "A reply in the window.")])
    _seed_answer_turn(api, BETA, journey, 2, now - timedelta(minutes=2))
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": _context()})
    snap = _report(api, r.json()["id"]).session_context
    assert [(x["detail"], x["text"]) for x in snap["items"] if x["kind"] == "recap_answer"] == [
        ("commitment", "Read one paper a week."), ("stage 2, answer 3 of 3", "Guided answer 3"),
        ("stage 3, reply 2", "A reply in the window.")], "Guru's own turns and the Recap-screen answers never count"
    assert snap["counts"]["recap_answer"] == 3
    assert RECAP_UNTIMED not in _section(api.linear.issues[-1]["description"])

    _journey(api, PERSONA, answers=2)  # answered on the Recap screen: no time to place them by
    await api.call("POST", "/api/v1/reports", token=api.persona_token, body={**BODY, "context": _context()})
    section = _section(api.linear.issues[-1]["description"])
    assert RECAP_UNTIMED in section and NO_ACTIVITY in section, "on Recap with nothing datable, the section says why"
    await api.call("POST", "/api/v1/reports", token=api.persona_token,
                   body={**BODY, "context": _context(screen="home", step=None, trail=[], on_screen={})})
    assert RECAP_UNTIMED not in _section(api.linear.issues[-1]["description"]), "off Recap the line stays out"


async def test_a_failed_join_never_stops_the_filing(api, monkeypatch, caplog):
    from app.services import session_context

    def broken(db, report):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(session_context, "collect", broken)
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": _context()})
    report = _report(api, r.json()["id"])
    assert report.status == "filed" and report.session_context is None
    assert report.client_context["screen"] == "recap", "the app's context is kept; only the join failed"
    assert "- Activity: not collected for this report." in _section(api.linear.issues[0]["description"])
    assert "session context not collected" in caplog.text


async def test_the_context_is_joined_once_and_kept_through_a_linear_outage(api, monkeypatch):
    from app.services import session_context
    real, joins = session_context.collect, []
    monkeypatch.setattr(session_context, "collect", lambda db, report: joins.append(report.id) or real(db, report))
    _note(api, BETA, _article(api), _now() - timedelta(minutes=3), note="The undo point.")
    api.linear.fail_issue = linear_client.LinearError("HTTP 503: Service Unavailable")
    report_id = (await api.call("POST", "/api/v1/reports", token=api.beta_token,
                                body={**BODY, "context": _context()})).json()["id"]
    stored = _report(api, report_id).session_context
    assert _report(api, report_id).status == "failed" and stored["counts"]["note"] == 1, "stored before Linear"

    api.linear.fail_issue = None
    retry = (await api.call("POST", f"/api/v1/admin/reports/{report_id}/retry", token=api.admin_token)).json()
    assert retry["report"]["status"] == "filed" and retry["report"]["session_context"] == stored
    assert len(joins) == 1, "the retry files the stored snapshot, so the issue matches what the admin saw"
    assert "The undo point." in api.linear.issues[-1]["description"]


CALL = {"method": "POST", "path": "/recap/j-1/answer", "status": 500, "at": "2026-10-07T19:00:00+00:00"}
VISIT = {"screen": "recap", "at": "2026-10-07T19:00:00+00:00"}


@pytest.mark.parametrize("context, reason", [
    ({"failed_calls": [{**CALL, "body": '{"response": "SECRET-ANSWER"}'}]},
     "failed call 1 has a field the server doesn't take: 'body'"),
    ({"failed_calls": [CALL, {**CALL, "response": "SECRET-ERROR"}]},
     "failed call 2 has a field the server doesn't take: 'response'"),
    ({"failed_calls": [{**CALL, "path": "/search?q=SECRET-WORDS"}]}, "failed call 1 'path' has a query string"),
    ({"failed_calls": [{**CALL, "path": "/notes/SECRET WORDS"}]}, "failed call 1 'path' is not a bare path"),
    ({"failed_calls": [CALL] * 6}, "'failed_calls' has more than 5 items"),
    ({"failed_calls": [{**CALL, "method": "FETCH"}]},
     "failed call 1 'method' must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS"),
    ({"failed_calls": [{**CALL, "status": None}]}, "failed call 1 'status' must be a whole number from 0 to 599"),
    ({"failed_calls": [{**CALL, "status": 600}]}, "failed call 1 'status' must be a whole number from 0 to 599"),
    ({"trail": [VISIT] * 11}, "'trail' has more than 10 items"),
    ({"trail": [VISIT, VISIT, {"screen": "recap"}]}, "trail item 3 has no 'at'"),
    ({"trail": [{**VISIT, "at": "SECRET-yesterday"}]}, "trail item 1 'at' is not a time"),
    ({"trail": [{**VISIT, "screen": "s" * 121}]}, "trail item 1 'screen' is longer than 120 characters"),
    ({"trail": "recap"}, "'trail' is not a list"),
    ({"screen": "s" * 121}, "'screen' is longer than 120 characters"),
    ({"step": "s" * 65}, "'step' is longer than 64 characters"),
    ({"on_screen": {"article_id": "SECRET WORDS"}}, "on_screen 'article_id' is not an id"),
    ({"on_screen": {"article_id": "a" * 65}}, "on_screen 'article_id' is longer than 64 characters"),
    ({"on_screen": {"article_title": "SECRET-TITLE"}},
     "on_screen has a field the server doesn't take: 'article_title'"),
    ({"headers": {"authorization": "Bearer SECRET-TOKEN"}},
     "the context has a field the server doesn't take: 'headers'"),
    ("SECRET-STRING", "the context is not an object"),
    ({"step": "s", "trail": [{**VISIT, "screen": "x" * 100}] * 10, "failed_calls": [{**CALL, "path": "/" + "p" * 3000}] * 5},
     "the context is 16,"),
])
async def test_a_context_the_server_cant_read_never_costs_the_report(api, context, reason):
    _note(api, BETA, _article(api), _now() - timedelta(minutes=3), note="Still joined.")
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": context})
    assert r.status_code == 200, r.text
    report = _report(api, r.json()["id"])
    assert report.status == "filed" and report.client_context is None
    assert report.context_error and report.context_error.startswith(reason), report.context_error
    body = api.linear.issues[0]["description"]
    assert f"{UNREADABLE}{report.context_error}." in _section(body)
    assert "Still joined." in body, "the server's own join still runs"
    assert "SECRET" not in body + json.dumps([report.client_context, report.session_context, report.context_error])


async def test_the_caps_are_accepted_and_an_unknown_screen_is_stored_as_other(api):
    at = "2026-10-07T19:00:00Z"
    context = {"screen": "Settings", "step": "s" * 64,
               "on_screen": {"article_id": "a" * 64, "recap_journey_id": None, "trace_id": "turn-1"},
               "trail": [{"screen": "RECAP", "at": "2026-10-07T19:00:00"}] + [{"screen": "home", "at": at}] * 9,
               "failed_calls": [{"method": "delete", "path": "/" + "p" * 199, "status": 599, "at": at}]
               + [{"method": "GET", "path": "/x", "status": 0, "at": at}] * 4}
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": context})
    assert r.status_code == 200, r.text
    report = _report(api, r.json()["id"])
    stored = report.client_context
    assert report.context_error is None and stored["screen"] == "other", "an unknown screen is kept, as other"
    assert stored["trail"][0] == {"screen": "recap", "step": None, "at": "2026-10-07T19:00:00+00:00"}, \
        "a known screen in any case, and a time without a zone taken as UTC"
    assert len(stored["trail"]) == 10 and len(stored["failed_calls"]) == 5
    assert stored["failed_calls"][0] == {"method": "DELETE", "path": "/" + "p" * 199, "status": 599,
                                         "at": "2026-10-07T19:00:00+00:00"}
    assert stored["on_screen"] == {"article_id": "a" * 64, "recap_journey_id": None, "trace_id": "turn-1",
                                   "article_title": None}


async def test_triage_reads_the_session_context_and_says_what_it_used(api):
    _note(api, BETA, _article(api), _now() - timedelta(minutes=3), note="The undo point.")
    api.claude.reply = json.dumps({**json.loads(GOOD_REPLY), "context_used": ["F1", "a1", "trail", "F9"]})
    r = await api.call("POST", "/api/v1/reports", token=api.beta_token, body={**BODY, "context": _context()})
    assert r.status_code == 200, r.text

    [call] = api.claude.calls
    assert '"context_used"' in call["system"] and "session context" in call["system"]
    sent = json.loads(call["messages"][0]["content"])["session_context"]
    assert [v["ref"] for v in sent["app"]["trail"]] == ["T1", "T2", "T3"]
    first = sent["app"]["failed_calls"][0]
    assert (first["ref"], first["method"], first["path"], first["status"]) == ("F1", "POST", "/recap/j-1/socratic", 500)
    assert abs(first["seconds_before"] - 20) <= 2
    [item] = sent["activity"]["items"]
    assert (item["ref"], item["kind"], item["text"]) == ("A1", "note", "The undo point.")

    hypothesis = json.loads(_report(api, r.json()["id"]).hypothesis)
    assert hypothesis["context_used"] == ["F1", "a1", "trail", "F9"]
    [update], [comment] = api.linear.updates, api.linear.comments
    for text in (update["description"], comment["body"]):
        assert "**Used:** F1 (POST /recap/j-1/socratic, 500); A1 (note, " in text
        assert " before); the screen trail; F9 (not in the session context)" in text
        assert "A hypothesis to check, not a verdict." in text


async def test_the_admin_detail_returns_the_context_as_stored(api):
    _note(api, BETA, _article(api), _now() - timedelta(minutes=3), note="The undo point.")
    report_id = (await api.call("POST", "/api/v1/reports", token=api.beta_token,
                                body={**BODY, "context": _context()})).json()["id"]
    report = _report(api, report_id)
    d = (await api.call("GET", f"/api/v1/admin/reports/{report_id}", key=KEY)).json()["report"]
    assert d["client_context"] == report.client_context and d["client_context"]["failed_calls"][0]["status"] == 500
    assert d["session_context"] == report.session_context and d["session_context"]["counts"]["note"] == 1
    assert d["context_error"] is None
    assert (await api.call("GET", f"/api/v1/admin/reports/{report_id}", token=api.beta_token)).status_code == 403

    bad = (await api.call("POST", "/api/v1/reports", token=api.beta_token,
                          body={**BODY, "context": {"trail": "recap"}})).json()["id"]
    d = (await api.call("GET", f"/api/v1/admin/reports/{bad}", token=api.admin_token)).json()["report"]
    assert (d["client_context"], d["context_error"]) == (None, "'trail' is not a list")
    row = (await api.call("GET", "/api/v1/admin/reports", key=KEY)).json()["reports"][0]
    assert not {"client_context", "session_context", "context_error"} & set(row), "the list stays lean"


def test_make_report_prints_the_session_context(api, monkeypatch, capsys):
    """make report ID= prints the same Session context section as the Linear issue, and what triage used."""
    import asyncio
    cli = _reports_cli(monkeypatch, api)
    _note(api, BETA, _article(api), _now() - timedelta(minutes=3), note="The undo point.")
    api.claude.reply = json.dumps({**json.loads(GOOD_REPLY), "context_used": ["F1"]})
    report_id = asyncio.run(api.call("POST", "/api/v1/reports", token=api.beta_token,
                                     body={**BODY, "context": _context()})).json()["id"]
    cli.print_report(cli._local("show", days=7, status=None, traffic="real", report_id=report_id))
    out = capsys.readouterr().out
    lines = [line for line in _section(api.linear.updates[0]["description"]).splitlines()[1:] if line.strip()]
    assert "Session context" in out and len(lines) > 8
    for line in lines:
        assert line in out, line
    assert "used: F1 (POST /recap/j-1/socratic, 500)" in out


def test_boot_adds_the_context_columns_to_an_existing_reports_table(monkeypatch):
    """create_all() never adds a column to a table that exists, so _run_column_migrations() adds them on boot."""
    from sqlalchemy import inspect, text
    from app.db import database
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as conn:  # bug_reports as a build before GUR-277 made it, with one report in it
        conn.execute(text("CREATE TABLE bug_reports (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, "
                          "category VARCHAR(32) NOT NULL, expected TEXT NOT NULL, status VARCHAR(16) NOT NULL, "
                          "attempts INTEGER NOT NULL)"))
        conn.execute(text("INSERT INTO bug_reports VALUES ('r-1', 'u-1', 'other', 'An older report.', 'filed', 1)"))
    monkeypatch.setattr(database, "engine", engine)
    database._run_column_migrations()
    database._run_column_migrations()  # the next boot finds them there and moves on
    assert {"client_context", "session_context", "context_error"} <= {
        c["name"] for c in inspect(engine).get_columns("bug_reports")}
    with engine.connect() as conn:
        row = conn.execute(text("SELECT expected, client_context, session_context, context_error FROM bug_reports"))
        assert row.one() == ("An older report.", None, None, None)


# ── The Linear client itself, over a mock transport ──────────────────────────

def test_the_linear_client_sends_the_key_bare_and_keeps_it_out_of_errors(monkeypatch):
    key = "lin_api_" + "s" * 40
    monkeypatch.setenv("LINEAR_API_KEY", key)
    monkeypatch.setattr(linear_client, "_team_ids", {})
    sent = []

    def linear_api(request):
        body = json.loads(request.content)
        sent.append((request.headers["authorization"], body))
        query, variables = body["query"], body["variables"]
        if "teams(" in query:
            return httpx.Response(200, json={"data": {"teams": {"nodes": [{"id": "team-1", "key": "GUR"}]}}})
        if "issueLabels(" in query and variables["name"] == "beta-report":
            return httpx.Response(200, json={"data": {"issueLabels": {"nodes": [
                {"id": "elsewhere", "name": "beta-report", "isGroup": False, "retiredAt": None, "team": {"id": "t9"}},
                {"id": "group", "name": "beta-report", "isGroup": True, "retiredAt": None, "team": None},
                {"id": "ours", "name": "Beta-Report", "isGroup": False, "retiredAt": None, "team": {"id": "team-1"}},
            ]}}})
        if "issueLabels(" in query:
            return httpx.Response(200, json={"data": {"issueLabels": {"nodes": []}}})
        if "issueLabelCreate(" in query:
            return httpx.Response(200, json={"data": {"issueLabelCreate": {"success": True,
                                                                           "issueLabel": {"id": "made"}}}})
        return httpx.Response(400, json={"errors": [{"message": f"Rate limited for {key}",
                                                     "extensions": {"code": "RATELIMITED"}}]})

    monkeypatch.setattr(linear_client, "_client", lambda: httpx.Client(transport=httpx.MockTransport(linear_api)))
    assert linear_client.resolve_team("GUR") == "team-1" and linear_client.resolve_team("GUR") == "team-1"
    assert linear_client.find_or_create_label("team-1", "beta-report") == "ours"
    assert linear_client.find_or_create_label("team-1", "synthetic") == "made"
    assert sent[-1][1]["variables"]["input"] == {"name": "synthetic", "teamId": "team-1"}
    with pytest.raises(linear_client.LinearError) as err:
        linear_client.create_issue("team-1", "title", "body", ["ours"])
    assert "HTTP 400" in str(err.value) and "RATELIMITED" in str(err.value) and key not in str(err.value)
    assert len(sent) == 5, "the team id is looked up once"
    assert {auth for auth, _ in sent} == {key}, "a personal key goes bare, never as Bearer"

    monkeypatch.delenv("LINEAR_API_KEY")
    with pytest.raises(linear_client.LinearError, match="LINEAR_API_KEY is not set"):
        linear_client.create_comment("issue-1", "hello")
    assert len(sent) == 5


def test_the_linear_client_rewrites_an_issue_description(monkeypatch):
    monkeypatch.setenv("LINEAR_API_KEY", "lin_api_" + "s" * 40)
    sent = []

    def linear_api(request):
        body = json.loads(request.content)
        sent.append(body)
        found = body["variables"]["id"] == "issue-1"
        return httpx.Response(200, json={"data": {"issueUpdate": {"success": found,
                                                                  "issue": {"id": "issue-1"} if found else None}}})

    monkeypatch.setattr(linear_client, "_client", lambda: httpx.Client(transport=httpx.MockTransport(linear_api)))
    assert linear_client.update_issue_description("issue-1", "## New body") == {"id": "issue-1"}
    assert "issueUpdate(id: $id, input: $input)" in sent[0]["query"]
    assert sent[0]["variables"] == {"id": "issue-1", "input": {"description": "## New body"}}
    with pytest.raises(linear_client.LinearError, match="did not update"):
        linear_client.update_issue_description("issue-2", "## New body")
