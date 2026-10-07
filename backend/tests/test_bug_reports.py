"""
Report a bug, beta (GUR-242): app/routes/reports.py, app/routes/admin_reports.py,
app/services/bug_reports.py and app/services/linear_client.py.

Hermetic like test_admin_access.py: the real FastAPI app over httpx's ASGI
transport, an in-memory SQLite, no startup events and no network. Linear and
Claude are recording fakes, and report jobs run inline unless a test needs the
real worker thread.
"""
import json
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
from app.models.bug_report import BugReport  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import bug_reports, linear_client  # noqa: E402
from app.services.agent_trace import TurnTrace  # noqa: E402
from app.services.auth_service import generate_jwt  # noqa: E402

pytestmark = pytest.mark.anyio

ADMIN, BETA, PERSONA, OUTSIDER = "admin@guru.app", "tester@guru.app", "persona@example.com", "someone@guru.app"
KEY = "k" * 40
BODY = {"category": "wrong_answer", "expected": "Three stories about AI chips, not an error about my feed."}
SECTIONS = ("## What the user said", "## Where", "## Trace summary", "## Replay ids", "## Suggested regression eval")
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
        self.issues, self.comments = [], []
        self.fail_issue = self.fail_comment = None
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
    for name in ("resolve_team", "find_or_create_label", "create_issue", "create_comment"):
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


def _seed_trace(api, email):
    """One agent turn for this user: get_catchup_feed fails and the agent answers anyway."""
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
    api.db.add(t.to_row("blocks"))
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

    api.claude.stop, api.linear.fail_comment = "end_turn", linear_client.LinearError("HTTP 500: boom")
    last = await report()
    hypothesis = json.loads(last.hypothesis)
    assert last.status == "filed" and hypothesis["summary"] and "HTTP 500" in hypothesis["comment_error"]
    assert len(api.linear.issues) == 4 and api.linear.comments == []


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
