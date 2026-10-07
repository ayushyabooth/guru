"""
Contract tests for the agentic Guru tab (backend/app/routes/agent.py).

No network, no database: the Anthropic client is a scripted fake, tools are
recorded instead of called, and the session lives in a fake DB. Runs in a few
seconds, so it belongs in CI and in the definition of done for any agent change.

What is covered:
  1. Tool registry - well-formed schemas, every tool dispatches to a real route
  2. Output parsing - the tolerant block parser and the streaming block parser
  3. History hygiene - the sanitizer never leads with an orphaned tool_result
  4. Whole turns - SSE event order, the approval gate (approve / decline /
     ignore), the catch-up headline strip, the iteration cap, error handling
Every model call made during a turn is checked for a valid conversation
(each tool_use answered by a tool_result) - the bug class behind GUR-231.
"""
import copy
import functools
import json
import os
import sys
import uuid
from types import SimpleNamespace

import pytest
from fastapi.dependencies.utils import get_flat_dependant
from fastapi.routing import APIRoute
from pydantic import BaseModel
from starlette.routing import Match

# Hermetic defaults only when there is no local .env, so a full local run keeps
# the real settings for the tests that need them.
_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

from app.routes import agent  # noqa: E402
from app.models.agent_session import AgentSession  # noqa: E402
from app.models.agent_turn_trace import AgentTurnTrace  # noqa: E402
from app.services.agent_trace import TurnTrace  # noqa: E402

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ── Fakes ─────────────────────────────────────────────────────────────────────

def _text(t):
    return SimpleNamespace(type="text", text=t)


def _tool_use(name, tool_input=None, tid=None):
    return SimpleNamespace(type="tool_use", id=tid or f"tu_{uuid.uuid4().hex[:8]}", name=name, input=tool_input or {})


USAGE = dict(input_tokens=1000, output_tokens=50, cache_read_input_tokens=800, cache_creation_input_tokens=0)


def tool_turn(name, tool_input=None, tid=None):
    """One model response that calls a tool (no streamed text)."""
    return ([], SimpleNamespace(content=[_tool_use(name, tool_input, tid)], stop_reason="tool_use",
                                usage=SimpleNamespace(**USAGE)))


def final_turn(blocks, chunks=3):
    """One model response that ends the turn with a {"blocks": [...]} payload,
    streamed in a few chunks the way the real SDK delivers text deltas."""
    payload = json.dumps({"blocks": blocks})
    size = max(1, len(payload) // chunks)
    parts = [payload[i:i + size] for i in range(0, len(payload), size)]
    return (parts, SimpleNamespace(content=[_text(payload)], stop_reason="end_turn", usage=SimpleNamespace(**USAGE)))


class _FakeStream:
    def __init__(self, chunks, final, error=None):
        self._chunks, self._final, self._error = chunks, final, error

    def __enter__(self):
        if self._error:
            raise self._error
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        return iter(self._chunks)

    def get_final_message(self):
        return self._final


class _FakeMessages:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []  # deep copies of the messages sent on each model call

    def stream(self, **kw):
        self.calls.append(copy.deepcopy(kw["messages"]))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            return _FakeStream([], None, error=item)
        chunks, final = item
        return _FakeStream(chunks, final)


class _FakeClient:
    def __init__(self, script):
        self.messages = _FakeMessages(script)


class _FakeQuery:
    def __init__(self, db):
        self.db = db

    def filter(self, *a, **k):
        return self

    def first(self):
        return self.db.sess


class _FakeDB:
    def __init__(self, sess=None):
        self.sess, self.commits, self.rollbacks = sess, 0, 0
        self.added = []  # everything else written in the turn, e.g. traces

    def query(self, model):
        return _FakeQuery(self)

    def add(self, obj):
        if isinstance(obj, AgentSession):
            self.sess = obj
        else:
            self.added.append(obj)

    @property
    def traces(self):
        return [o for o in self.added if isinstance(o, AgentTurnTrace)]

    def commit(self):
        self.commits += 1

    def refresh(self, obj):
        pass

    def rollback(self):
        self.rollbacks += 1


USER = SimpleNamespace(id=uuid.uuid4(), profile=None)
REQUEST = SimpleNamespace(headers={"authorization": "Bearer test"}, app=object())


@pytest.fixture
def harness(monkeypatch):
    """Patches the model client, the tool executor and the internal API call.
    Returns a small object to script the model and inspect what happened."""
    state = SimpleNamespace(client=None, executed=[], tool_results={})

    def set_script(*turns):
        state.client = _FakeClient(turns)

    async def fake_execute(app, token, name, tool_input):
        state.executed.append((name, tool_input))
        return state.tool_results.get(name, json.dumps({"ok": True, "tool": name}))

    async def fake_call_api(app, token, method, path, json_body=None, params=None):
        return 200, {"commitment": None}

    monkeypatch.setattr(agent, "_execute_tool", fake_execute)
    monkeypatch.setattr(agent, "_call_api", fake_call_api)
    monkeypatch.setattr(agent.anthropic, "Anthropic", lambda api_key=None, **kw: state.client)
    state.set_script = set_script
    return state


async def run_turn(db, input_type="goal", text=None, approved=None, session_id=None):
    body = agent.AgentTurnRequest(
        session_id=session_id,
        input=agent.AgentInput(type=input_type, text=text, approved=approved,
                               approval_id="apr_test" if input_type == "decision" else None),
    )
    resp = await agent.agent_turn(body=body, request=REQUEST, current_user=USER, db=db)
    events = []
    async for chunk in resp.body_iterator:
        chunk = chunk.decode() if isinstance(chunk, bytes) else chunk
        for line in chunk.split("\n"):
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
    return events


def assert_valid_conversation(messages, allow_dangling_tail=False):
    """Every assistant tool_use must be answered by a tool_result in the next
    user message, and no message may start with an orphaned tool_result."""
    assert messages, "empty conversation"
    first = messages[0]
    assert first["role"] == "user", "conversation must start with a user turn"
    if isinstance(first["content"], list):
        assert not any(b.get("type") == "tool_result" for b in first["content"]), "leads with an orphaned tool_result"
    for i, m in enumerate(messages):
        if m["role"] != "assistant" or not isinstance(m["content"], list):
            continue
        ids = {b["id"] for b in m["content"] if b.get("type") == "tool_use"}
        if not ids:
            continue
        if i == len(messages) - 1:
            assert allow_dangling_tail, f"tool_use {ids} never answered"
            continue
        nxt = messages[i + 1]
        answered = {b.get("tool_use_id") for b in nxt["content"]} if isinstance(nxt["content"], list) else set()
        assert ids <= answered, f"tool_use {ids - answered} has no tool_result"


def event_kinds(events):
    out = []
    for e in events:
        if e["event"] == "block":
            out.append(f"block:{e['block']['type']}")
        else:
            out.append(e["event"])
    return out


def session_with_pending_write(note="Evals are a product surface, not a QA step."):
    """A session paused on an add_note approval, exactly as a WRITE turn leaves it."""
    tid = "tu_pending"
    sess = AgentSession(id=uuid.uuid4(), user_id=USER.id, title="t", messages=json.dumps([
        {"role": "user", "content": "go deeper on the evals article"},
        {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "add_note",
                                           "input": {"article_id": "a1", "note": note, "title": "Evals"}}]},
    ]))
    sess.pending_action = json.dumps({"approval_id": "apr_test", "tool_use_id": tid, "name": "add_note",
                                      "input": {"article_id": "a1", "note": note, "title": "Evals"}})
    return sess


# ── 1. Tool registry ──────────────────────────────────────────────────────────

TOOL_NAMES = [t["name"] for t in agent.TOOLS]


def test_tool_registry_is_well_formed():
    # Changing the count is a contract change: update CLAUDE.md and README.md too.
    assert len(agent.TOOLS) == 18
    assert len(set(TOOL_NAMES)) == len(TOOL_NAMES), "duplicate tool names"
    for t in agent.TOOLS:
        assert t["description"].strip(), f"{t['name']} has no description"
        schema = t["input_schema"]
        assert schema["type"] == "object"
        for req in schema.get("required", []):
            assert req in schema.get("properties", {}), f"{t['name']}: required '{req}' not in properties"
    assert agent.WRITE_TOOLS <= set(TOOL_NAMES), "a WRITE tool is missing from the registry"
    # Which writes need approval is a product decision, not a refactor detail:
    # notes and commitments commit the user; saves and dismissals are one tap to undo.
    assert agent.WRITE_TOOLS == {"add_note", "set_commitment"}


def _dummy_input(tool, required_only=False):
    schema = tool["input_schema"]
    props = schema.get("properties", {})
    keys = schema.get("required", []) if required_only else props
    return {k: (0 if props[k].get("type") == "integer" else "x") for k in keys}


@functools.lru_cache(maxsize=None)
def _real_app():
    from app.main import app as real_app  # imported lazily: the hermetic env defaults above must apply first
    return real_app


def _real_route(method, path):
    """The FastAPI route that would serve this call, or None (a 404/405 in production)."""
    for r in _real_app().router.routes:
        if isinstance(r, APIRoute) and r.matches({"type": "http", "path": path, "method": method})[0] == Match.FULL:
            return r
    return None


def _missing_required(route, params, json_body):
    """Required query params and body fields the call leaves out. Each one is a 422."""
    flat = get_flat_dependant(route.dependant)
    missing = [f"query '{p.alias}'" for p in flat.query_params if p.required and p.alias not in (params or {})]
    for p in flat.body_params:
        model = p.type_
        if len(flat.body_params) == 1 and isinstance(model, type) and issubclass(model, BaseModel):
            missing += [f"body '{f.alias or n}'" for n, f in model.model_fields.items()
                        if f.is_required() and (f.alias or n) not in (json_body or {})]
        elif p.required and p.alias not in (json_body or {}):
            missing.append(f"body '{p.alias}'")
    return missing


@pytest.mark.parametrize("name", TOOL_NAMES)
async def test_every_tool_call_matches_a_real_route(name, monkeypatch):
    # Checked against the real FastAPI routes, not just the path prefix. A tool call
    # that leaves out a required query param or body field gets a 422 in production:
    # mark_not_relevant shipped without ?filter= and every agent Skip failed.
    # Both the minimal input (only required fields, as the model may send) and the
    # full input must produce a valid call.
    tool = next(t for t in agent.TOOLS if t["name"] == name)
    for variant in ("required_only", "all_fields"):
        calls = []

        async def record(app, token, method, path, json_body=None, params=None):
            calls.append((method, path, params, json_body))
            return 200, {}

        monkeypatch.setattr(agent, "_call_api", record)
        result = await agent._execute_tool(object(), "Bearer t", name, _dummy_input(tool, variant == "required_only"))
        assert "unknown tool" not in result
        assert len(calls) == 1 and calls[0][1].startswith("/api/v1/"), calls
        method, path, params, json_body = calls[0]
        if name in agent.WRITE_TOOLS:
            assert method == "POST"
        route = _real_route(method, path)
        assert route is not None, f"{name} ({variant}): no route serves {method} {path}"
        assert _missing_required(route, params, json_body) == [], f"{name} ({variant}) -> {method} {route.path}"


async def test_unknown_tool_returns_an_error_instead_of_raising():
    result = await agent._execute_tool(object(), "Bearer t", "drop_database", {})
    assert json.loads(result) == {"error": "unknown tool drop_database"}


@pytest.mark.parametrize("name", sorted(agent.WRITE_TOOLS))
def test_every_write_tool_has_a_specific_approval_card(name):
    tool = next(t for t in agent.TOOLS if t["name"] == name)
    block = agent._approval_block(name, {**_dummy_input(tool), "note": "full note text", "text": "full text"}, "apr_1")
    assert block["type"] == "approval" and block["approval_id"] == "apr_1"
    assert block["title"] != "Proceed?", "write tool falls through to the generic card"
    assert block["confirm_label"] and block["cancel_label"]


def test_approval_card_shows_the_full_note_never_a_cut_preview():
    long_note = "x" * 600
    block = agent._approval_block("add_note", {"note": long_note, "title": "T"}, "apr_1")
    assert any(long_note in line for line in block["detail_lines"])


# ── 2. Output parsing ─────────────────────────────────────────────────────────

def test_parse_blocks_reads_plain_json():
    raw = json.dumps({"blocks": [{"type": "text", "md": "hi"}, {"type": "prompt_pills", "prompts": ["a"]}]})
    assert [b["type"] for b in agent._parse_blocks(raw)] == ["text", "prompt_pills"]


def test_parse_blocks_strips_code_fences_and_leading_prose():
    fenced = "```json\n" + json.dumps({"blocks": [{"type": "text", "md": "hi"}]}) + "\n```"
    assert agent._parse_blocks(fenced)[0]["type"] == "text"
    prose = "Here you go: " + json.dumps({"blocks": [{"type": "rings", "c": 0.5}]})
    assert agent._parse_blocks(prose)[0]["type"] == "rings"


def test_parse_blocks_drops_items_without_a_type():
    raw = json.dumps({"blocks": [{"md": "no type"}, "a string", {"type": "text", "md": "ok"}]})
    assert agent._parse_blocks(raw) == [{"type": "text", "md": "ok"}]


def test_parse_blocks_falls_back_to_one_text_block_on_malformed_json():
    raw = '{"blocks": [{"type": "text", "md": "unterminated'
    assert agent._parse_blocks(raw) == [{"type": "text", "md": raw}]
    assert agent._parse_blocks("") == []


def test_stream_parser_emits_each_block_the_moment_it_closes():
    payload = json.dumps({"blocks": [
        {"type": "text", "md": 'braces } and { and an escaped quote \\" inside a string'},
        {"type": "plan", "steps": [{"n": 1, "title": "read"}]},
        {"no_type": True},
    ]}) + " trailing prose the parser must ignore {\"type\": \"text\"}"
    p = agent._BlockStreamParser()
    seen = []
    for i in range(0, len(payload), 7):  # tiny chunks, splitting tokens mid-way
        seen.extend(p.feed(payload[i:i + 7]))
    assert [b["type"] for b in seen] == ["text", "plan"]
    assert p.emitted == 2 and p.done


# ── 3. History hygiene ────────────────────────────────────────────────────────

def _realistic_history(rounds=12):
    msgs = []
    for r in range(rounds):
        msgs.append({"role": "user", "content": f"goal {r}"})
        tid = f"tu_{r}"
        msgs.append({"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": "get_metrics", "input": {}}]})
        msgs.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "{}"}]})
        msgs.append({"role": "assistant", "content": [{"type": "text", "text": '{"blocks": []}'}]})
    return msgs


def test_sanitizer_drops_a_leading_orphaned_tool_result():
    msgs = _realistic_history(2)[2:]  # starts with a tool_result whose tool_use was cut
    cleaned = agent._sanitize_history(msgs)
    assert cleaned[0] == {"role": "user", "content": "goal 1"}
    assert_valid_conversation(cleaned)


def test_sanitizer_never_leads_with_an_orphan_at_any_cut_point():
    # Regression for GUR-231: bounded slicing used to corrupt every later turn.
    msgs = _realistic_history()
    for cut in range(len(msgs)):
        cleaned = agent._sanitize_history(msgs[cut:])
        if cleaned:
            assert_valid_conversation(cleaned)


def test_sanitizer_keeps_the_dangling_write_at_the_tail():
    # A WRITE turn ends on an unanswered tool_use; the next turn's approval
    # resume appends its result, so trimming it would break approvals.
    msgs = json.loads(session_with_pending_write().messages)
    assert agent._sanitize_history(msgs) == msgs


def test_sanitizer_returns_empty_when_there_is_no_genuine_user_turn():
    only_results = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": ""}]}]
    assert agent._sanitize_history(only_results) == []


# ── 4. Whole turns ────────────────────────────────────────────────────────────

async def test_read_tool_runs_immediately_and_events_arrive_in_order(harness):
    harness.set_script(
        tool_turn("get_metrics"),
        final_turn([{"type": "rings", "c": 0.5, "d": 0.2, "r": 0.0}, {"type": "prompt_pills", "prompts": ["Next"]}]),
    )
    db = _FakeDB()
    events = await run_turn(db, text="show my progress")

    assert harness.executed == [("get_metrics", {})]
    assert event_kinds(events) == ["status", "status", "status", "block:rings", "block:prompt_pills", "done"]
    assert events[1]["text"] == agent.STATUS_TEXT["get_metrics"]
    for call in harness.client.messages.calls:
        assert_valid_conversation(call)
    saved = json.loads(db.sess.messages)
    assert_valid_conversation(saved)
    assert db.sess.pending_action is None


async def test_write_tool_pauses_for_approval_and_does_not_execute(harness):
    note = "Evals are a product surface, not a QA step."
    harness.set_script(tool_turn("add_note", {"article_id": "a1", "note": note, "title": "Evals"}, tid="tu_w"))
    db = _FakeDB()
    events = await run_turn(db, text="save that as a note")

    assert harness.executed == [], "a WRITE tool ran before the user approved it"
    approval = next(e["block"] for e in events if e["event"] == "block")
    assert approval["type"] == "approval" and approval["title"] == "Add this note to the article?"
    assert any(note in line for line in approval["detail_lines"])
    assert events[-1]["event"] == "done"
    pending = json.loads(db.sess.pending_action)
    assert pending["tool_use_id"] == "tu_w" and pending["name"] == "add_note"
    assert_valid_conversation(json.loads(db.sess.messages), allow_dangling_tail=True)


async def test_approved_decision_executes_the_pending_write_and_resumes(harness):
    harness.set_script(final_turn([{"type": "text", "md": "Saved."}, {"type": "prompt_pills", "prompts": ["Next"]}]))
    db = _FakeDB(session_with_pending_write())
    events = await run_turn(db, input_type="decision", approved=True, session_id=str(db.sess.id))

    assert [n for n, _ in harness.executed] == ["add_note"]
    sent = harness.client.messages.calls[0]
    assert_valid_conversation(sent)
    assert sent[-1]["content"][0]["content"].startswith("User APPROVED")
    assert db.sess.pending_action is None
    assert "block:text" in event_kinds(events)


async def test_declined_decision_never_executes_the_write(harness):
    harness.set_script(final_turn([{"type": "text", "md": "No problem."}]))
    db = _FakeDB(session_with_pending_write())
    await run_turn(db, input_type="decision", approved=False, session_id=str(db.sess.id))

    assert harness.executed == []
    sent = harness.client.messages.calls[0]
    assert_valid_conversation(sent)
    assert sent[-1]["content"][0]["content"].startswith("User DECLINED")
    assert db.sess.pending_action is None


async def test_new_message_while_a_write_is_pending_resolves_it_as_declined(harness):
    harness.set_script(final_turn([{"type": "text", "md": "Sure, switching topics."}]))
    db = _FakeDB(session_with_pending_write())
    await run_turn(db, text="actually, show my progress", session_id=str(db.sess.id))

    assert harness.executed == []
    sent = harness.client.messages.calls[0]
    assert_valid_conversation(sent)
    assert sent[-2]["content"][0]["content"] == "User did not decide; treat as declined."
    assert sent[-1] == {"role": "user", "content": "actually, show my progress"}


async def test_catchup_feed_streams_headline_cards_before_the_model_answers(harness):
    feed = {"storyboards": [{"in_focus_article": {"article_id": f"a{i}", "title": f"Story {i}"}} for i in range(3)]}
    harness.tool_results["get_catchup_feed"] = json.dumps(feed)
    harness.set_script(tool_turn("get_catchup_feed"), final_turn([{"type": "text", "md": "Here is today."}]))
    events = await run_turn(_FakeDB(), text="catch me up")

    blocks = [e["block"] for e in events if e["event"] == "block"]
    minis = [b for b in blocks if b.get("variant") == "mini"]
    assert [b["article_id"] for b in minis] == ["a0", "a1", "a2"]
    assert blocks.index(minis[0]) < blocks.index(next(b for b in blocks if b["type"] == "text"))


async def test_a_runaway_tool_loop_stops_at_max_iters(harness):
    # Known gap (docs/known-gaps.md): the turn ends with no blocks and no
    # message to the user. This test pins the current behavior so a fix is visible.
    harness.set_script(*[tool_turn("get_metrics") for _ in range(agent.MAX_ITERS)])
    db = _FakeDB()
    events = await run_turn(db, text="loop forever")

    assert len(harness.client.messages.calls) == agent.MAX_ITERS
    assert not any(e["event"] == "block" for e in events)
    assert events[-1]["event"] == "done"
    assert_valid_conversation(json.loads(db.sess.messages))


async def test_a_model_error_becomes_an_error_event_and_rolls_back(harness):
    harness.set_script(RuntimeError("overloaded"))
    db = _FakeDB()
    events = await run_turn(db, text="catch me up")

    assert events[-1]["event"] == "error" and "overloaded" in events[-1]["message"]
    assert db.rollbacks == 1


async def test_saved_history_is_bounded_and_never_leads_with_an_orphan(harness):
    harness.set_script(final_turn([{"type": "text", "md": "ok"}]))
    sess = AgentSession(id=uuid.uuid4(), user_id=USER.id, title="t", messages=json.dumps(_realistic_history(15)))
    db = _FakeDB(sess)
    await run_turn(db, text="one more", session_id=str(sess.id))

    saved = json.loads(db.sess.messages)
    assert len(saved) <= agent.MAX_HISTORY_MSGS
    assert_valid_conversation(saved)


# ── 5. Tracing (the sensor layer behind latency, cost and trajectory evals) ──

async def test_every_turn_writes_one_trace_with_timings_tools_and_blocks(harness):
    harness.set_script(
        tool_turn("get_metrics"),
        final_turn([{"type": "rings", "c": 0.5, "d": 0.2, "r": 0.0}, {"type": "prompt_pills", "prompts": ["Next"]}]),
    )
    db = _FakeDB()
    await run_turn(db, text="show my progress")

    assert len(db.traces) == 1
    t = db.traces[0]
    assert t.outcome == "blocks" and t.iterations == 2 and t.input_type == "goal"
    assert [c["name"] for c in json.loads(t.tool_calls)] == ["get_metrics"]
    assert [b["type"] for b in json.loads(t.blocks)] == ["rings", "prompt_pills"]
    assert t.first_block_ms is not None and 0 <= t.first_block_ms <= t.total_ms
    assert (t.tokens_in, t.tokens_out, t.cache_read_tokens) == (2000, 100, 1600)
    assert [c["stop_reason"] for c in json.loads(t.model_calls)] == ["tool_use", "end_turn"]


async def test_an_approval_pause_is_traced_as_its_own_outcome(harness):
    harness.set_script(tool_turn("add_note", {"article_id": "a1", "note": "n", "title": "T"}))
    db = _FakeDB()
    await run_turn(db, text="save that")

    t = db.traces[0]
    assert t.outcome == "approval" and t.approval_tool == "add_note"
    assert [b["type"] for b in json.loads(t.blocks)] == ["approval"]
    assert json.loads(t.tool_calls) == [], "the write must not appear as executed"


async def test_an_approved_write_is_traced_as_executed(harness):
    harness.set_script(final_turn([{"type": "text", "md": "Saved."}]))
    db = _FakeDB(session_with_pending_write())
    await run_turn(db, input_type="decision", approved=True, session_id=str(db.sess.id))

    t = db.traces[0]
    assert t.input_type == "decision"
    assert [c["name"] for c in json.loads(t.tool_calls)] == ["add_note"]


async def test_the_iteration_cap_is_traced(harness):
    harness.set_script(*[tool_turn("get_metrics") for _ in range(agent.MAX_ITERS)])
    db = _FakeDB()
    await run_turn(db, text="loop forever")

    t = db.traces[0]
    assert t.outcome == "max_iters" and t.iterations == agent.MAX_ITERS and t.first_block_ms is None


async def test_a_failed_turn_still_leaves_a_trace(harness):
    harness.set_script(RuntimeError("overloaded"))
    db = _FakeDB()
    await run_turn(db, text="catch me up")

    t = db.traces[0]
    assert t.outcome == "error" and "overloaded" in t.error
    assert db.rollbacks == 1


async def test_a_tracing_failure_never_breaks_the_turn(harness, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("trace store down")
    monkeypatch.setattr(TurnTrace, "to_row", boom)
    harness.set_script(final_turn([{"type": "text", "md": "still works"}]))
    events = await run_turn(_FakeDB(), text="hello")

    assert events[-1]["event"] == "done"
    assert "block:text" in event_kinds(events)


class _TraceStoreDownDB(_FakeDB):
    """The trace insert fails at commit time, the way a real database rejects a bad row."""
    def __init__(self, sess=None):
        super().__init__(sess)
        self.pending_traces_at_commit = []

    def commit(self):
        self.pending_traces_at_commit.append(len(self.traces))
        if self.traces:
            self.added = [o for o in self.added if not isinstance(o, AgentTurnTrace)]
            raise RuntimeError("trace table unavailable")
        super().commit()


async def test_a_trace_database_error_never_costs_the_user_their_turn(harness):
    harness.set_script(tool_turn("get_metrics"), final_turn([{"type": "text", "md": "here you go"}]))
    db = _TraceStoreDownDB()
    events = await run_turn(db, text="show my progress")

    assert events[-1]["event"] == "done", "the user sees a finished turn"
    assert "block:text" in event_kinds(events)
    # The user's turn was committed BEFORE the trace row existed, so it survives.
    assert db.pending_traces_at_commit[-2] == 0 and db.commits >= 1
    assert db.rollbacks == 1, "only the trace write was rolled back"
    assert_valid_conversation(json.loads(db.sess.messages))


async def test_the_trace_carries_a_timeline_context_and_previews(harness):
    harness.tool_results["get_metrics"] = json.dumps({"error": "HTTP 500", "detail": "metrics down"})
    harness.set_script(
        tool_turn("get_metrics", {"filter": "core"}),
        final_turn([{"type": "text", "md": "Your week in one line."}, {"type": "prompt_pills", "prompts": ["Next"]}]),
    )
    db = _FakeDB()
    await run_turn(db, text="show my progress")
    t = db.traces[0]

    calls, tools, blocks = json.loads(t.model_calls), json.loads(t.tool_calls), json.loads(t.blocks)
    # Every span has a start offset, in order, so a timeline can be drawn.
    assert [c["iter"] for c in calls] == [1, 2]
    assert calls[0]["start_ms"] <= tools[0]["start_ms"] <= calls[1]["start_ms"] <= blocks[0]["at_ms"]
    assert all(c["cache_read"] == 800 for c in calls)
    # Tools are tied to the model call that asked for them, with their ids and why they failed.
    assert tools[0]["iter"] == 1 and tools[0]["args"] == {"filter": "core"} and tools[0]["tool_use_id"]
    assert tools[0]["error"] and tools[0]["status"] == "http_error" and "metrics down" in tools[0]["error_msg"]
    assert [c["status"] for c in calls] == ["ok", "ok"]
    # Pre-beta, every user's trace keeps sizes and previews of what they saw.
    assert [b["iter"] for b in blocks] == [2, 2] and blocks[0]["chars"] > 0
    assert blocks[0]["preview"] == "Your week in one line."
    assert [p["name"] for p in json.loads(t.phases)] == ["load_context"]
    # What served the turn.
    assert t.prompt_version == agent.PROMPT_VERSION and len(t.prompt_version) == 12
    assert t.build_sha and t.traffic == "real" and t.client == "unknown" and t.decision is None


async def test_persona_accounts_are_traced_as_synthetic(harness, monkeypatch):
    monkeypatch.delenv("SYNTHETIC_EMAIL_DOMAINS", raising=False)
    monkeypatch.setattr(sys.modules[__name__], "USER",
                        SimpleNamespace(id=uuid.uuid4(), profile=None, email="maya@example.com"))
    harness.set_script(final_turn([{"type": "text", "md": "hi"}]))
    db = _FakeDB()
    await run_turn(db, text="what matters today")
    assert db.traces[0].traffic == "synthetic"


async def test_decision_turns_record_what_the_user_decided(harness):
    harness.set_script(final_turn([{"type": "text", "md": "Kept as is."}]))
    db = _FakeDB(session_with_pending_write())
    await run_turn(db, input_type="decision", approved=False, session_id=str(db.sess.id))
    assert db.traces[0].decision == "declined"


def test_a_tool_error_is_flagged_in_the_trace():
    t = TurnTrace(uuid.uuid4(), USER.id, "m", "goal", "x")
    t.tool_started("get_metrics")
    t.tool_done("get_metrics", json.dumps({"error": "HTTP 500", "detail": "boom"}))
    t.tool_started("get_commitment")
    t.tool_done("get_commitment", json.dumps({"commitment": None}))
    assert [c["error"] for c in t.tool_calls] == [True, False]
    assert t.tool_calls[0]["error_msg"] == "HTTP 500 boom" and t.tool_calls[1]["error_msg"] is None


# ── 6. Trace hardening (independent review, 10/7) ────────────────────────────

def _agen(resp):
    return resp.body_iterator


async def _start_turn(db, text="catch me up"):
    body = agent.AgentTurnRequest(session_id=None, input=agent.AgentInput(type="goal", text=text))
    return await agent.agent_turn(body=body, request=REQUEST, current_user=USER, db=db)


async def test_a_user_who_leaves_mid_answer_leaves_an_abandoned_trace(harness):
    harness.set_script(final_turn([{"type": "text", "md": "one"}, {"type": "text", "md": "two"}], chunks=6))
    db = _FakeDB()
    gen = _agen(await _start_turn(db))
    async for chunk in gen:
        if '"event": "block"' in (chunk.decode() if isinstance(chunk, bytes) else chunk):
            break  # the user closes the app as the first block arrives
    await gen.aclose()

    t = db.traces[0]
    assert t.outcome == "abandoned"
    assert json.loads(t.model_calls)[0]["status"] == "abandoned", "the call that was running is named"
    assert db.rollbacks == 1, "the half-finished turn is never saved"


async def test_a_raising_tool_is_named_in_the_trace(harness, monkeypatch):
    async def boom(app, token, name, tool_input):
        raise KeyError("article_id")
    monkeypatch.setattr(agent, "_execute_tool", boom)
    harness.set_script(tool_turn("ask_guru", {"question": "why?"}))
    db = _FakeDB()
    events = await run_turn(db, text="why does this matter")

    t = db.traces[0]
    tool = json.loads(t.tool_calls)[0]
    assert events[-1]["event"] == "error" and t.outcome == "error"
    assert tool["name"] == "ask_guru" and tool["status"] == "raised" and "KeyError" in tool["error_msg"]
    assert t.error.startswith("KeyError")


async def test_a_failed_model_call_is_typed_even_with_an_empty_message(harness):
    harness.set_script(TimeoutError())
    db = _FakeDB()
    events = await run_turn(db, text="catch me up")

    t = db.traces[0]
    assert t.error == "TimeoutError", "never a null error"
    assert events[-1]["message"] == "TimeoutError"


async def test_every_users_trace_keeps_full_text_while_pre_beta(harness):
    note = "My private reflection about my manager"
    harness.set_script(final_turn([{"type": "text", "md": "Saved."}]))
    db = _FakeDB(session_with_pending_write(note=note))
    await run_turn(db, input_type="decision", approved=True, session_id=str(db.sess.id))

    t = db.traces[0]
    tool = json.loads(t.tool_calls)[0]
    assert t.traffic == "real" and note in tool["input"]
    assert json.loads(t.blocks)[0]["preview"] == "Saved."


async def test_privacy_mode_keeps_real_users_writing_out_of_the_trace(harness, monkeypatch):
    monkeypatch.setattr("app.services.agent_trace.FULL_TEXT_FOR_ALL", False)
    note = "My private reflection about my manager"
    harness.set_script(final_turn([{"type": "text", "md": "Saved."}]))
    db = _FakeDB(session_with_pending_write(note=note))
    await run_turn(db, input_type="decision", approved=True, session_id=str(db.sess.id))

    t = db.traces[0]
    stored = " ".join(str(getattr(t, c)) for c in ("model_calls", "tool_calls", "blocks", "context", "error"))
    assert note not in stored and "preview" not in json.loads(t.blocks)[0]
    tool = json.loads(t.tool_calls)[0]
    assert tool["args"] == {"article_id": "a1"} and tool["text_chars"]["note"] == len(note)


async def test_synthetic_accounts_keep_full_previews(harness, monkeypatch):
    monkeypatch.delenv("SYNTHETIC_EMAIL_DOMAINS", raising=False)
    monkeypatch.setattr(sys.modules[__name__], "USER",
                        SimpleNamespace(id=uuid.uuid4(), profile=None, email="lena@example.com"))
    harness.set_script(tool_turn("ask_guru", {"article_id": "a1", "question": "why?"}),
                       final_turn([{"type": "text", "md": "Because."}]))
    db = _FakeDB()
    await run_turn(db, text="why")
    t = db.traces[0]
    assert json.loads(json.loads(t.tool_calls)[0]["input"]) == {"article_id": "a1", "question": "why?"}
    assert json.loads(t.blocks)[0]["preview"] == "Because."


async def test_typing_past_an_approval_card_is_recorded_as_ignored(harness):
    harness.set_script(final_turn([{"type": "text", "md": "ok"}]))
    db = _FakeDB(session_with_pending_write())
    await run_turn(db, input_type="message", text="actually, something else", session_id=str(db.sess.id))
    t = db.traces[0]
    assert t.decision == "ignored" and json.loads(t.context)["approval_id"] == "apr_test"


async def test_approval_cards_and_decisions_carry_the_card_id(harness):
    harness.set_script(tool_turn("add_note", {"article_id": "a1", "note": "n", "title": "T"}))
    db = _FakeDB()
    await run_turn(db, text="note that")
    assert json.loads(db.traces[0].context)["approval_id"].startswith("apr_")

    harness.set_script(final_turn([{"type": "text", "md": "Noted."}]))
    db2 = _FakeDB(session_with_pending_write())
    await run_turn(db2, input_type="decision", approved=True, session_id=str(db2.sess.id))
    ctx = json.loads(db2.traces[0].context)
    assert ctx["approval_id"] == "apr_test" and ctx["approval_matched"] is True


def test_unknown_input_types_are_refused_before_the_turn_starts():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        agent.AgentInput(type="drop_tables", text="x")


async def test_every_trace_has_its_id_and_start_time_from_the_first_moment(harness):
    harness.set_script(final_turn([{"type": "text", "md": "hi"}]))
    db = _FakeDB()
    await run_turn(db, text="hello")
    t = db.traces[0]
    assert t.id is not None and t.created_at is not None and t.created_at.tzinfo is not None


async def test_the_admins_own_turns_keep_previews_and_count_as_real(harness, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.com")
    monkeypatch.delenv("SYNTHETIC_EMAIL_DOMAINS", raising=False)
    monkeypatch.setattr(sys.modules[__name__], "USER",
                        SimpleNamespace(id=uuid.uuid4(), profile=None, email="owner@example.com"))
    harness.set_script(final_turn([{"type": "text", "md": "Your catch-up."}]))
    db = _FakeDB()
    await run_turn(db, text="catch me up")
    t = db.traces[0]
    assert t.traffic == "real" and json.loads(t.blocks)[0]["preview"] == "Your catch-up."
