"""
Drives agent turns through the real route for an eval.

T1 uses a scripted model (the contract tests' fake client): deterministic and free.
T2 uses the live model: real judgment, a few cents a turn.

The route function, the loop, the approval gate, the stream parser, the tool executor
and the result slimmers are the real code. Stood in: the model (in T1), the API's
answers (always, from fixtures.py), the database (the contract tests' _FakeDB: rollback
undoes nothing and every query returns the one session), and the HTTP layer (agent_turn
is called directly, so auth, request validation, exception handlers and client
disconnects don't run).
"""
import copy
import json
import time
import uuid
from dataclasses import dataclass
from types import SimpleNamespace

from fastapi import HTTPException

from app.routes import agent
from app.models.agent_session import AgentSession
from tests.test_agent_loop import USAGE, _FakeClient, _FakeDB  # the contract suite's fakes

from evals import fixtures

# Every tool that changes the user's data (six run without a card); the three immediate writes a tap triggers.
WRITES = {"save_article", "save_highlight", "mark_not_relevant", "add_note", "set_commitment",
          "start_recap", "submit_recap_answer", "recap_socratic"}
IMMEDIATE_WRITES = {"save_article", "save_highlight", "mark_not_relevant"}

# example.com makes eval traffic synthetic by the same rule as persona traffic.
USER = SimpleNamespace(id=uuid.uuid4(), profile=None, email="evals@example.com")
REQUEST = SimpleNamespace(headers={"authorization": "Bearer evals", "user-agent": "guru-evals"}, app=object())


def raw_final(text, stop_reason="end_turn", chunks=3):
    """A scripted model response with any final text and stop reason (for cut-off or malformed output)."""
    size = max(1, len(text) // chunks)
    parts = [text[i:i + size] for i in range(0, len(text), size)]
    return (parts, SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop_reason,
                                   usage=SimpleNamespace(**USAGE)))


@dataclass
class Turn:
    events: list            # the SSE events the app would read
    tool_calls: list        # [name, input, result string or None if it raised]
    api_calls: list         # (method, path, params, json_body) that reached the API
    model_calls: int        # model calls started in this turn
    model_texts: list       # the text of each model response, in order
    stop_reasons: list      # each model response's stop reason, in order
    requests: list          # the messages sent on each model call
    trace: object           # the AgentTurnTrace row the route wrote
    seconds: float

    @property
    def blocks(self):
        return [e["block"] for e in self.events if e.get("event") == "block"]

    @property
    def error(self):
        return next((e.get("message") for e in self.events if e.get("event") == "error"), None)

    def tools(self, names=None):
        return [c[0] for c in self.tool_calls if names is None or c[0] in names]


class _Recorder:
    """Wraps a model client so the harness sees every request and response the route makes."""

    def __init__(self, client, h):
        self.messages = _RecMessages(client.messages, h)


class _RecMessages:
    def __init__(self, inner, h):
        self._inner, self._h = inner, h

    def stream(self, **kw):
        self._h._requests.append(copy.deepcopy(kw.get("messages")))
        return _RecStream(self._inner.stream(**kw), self._h)


class _RecStream:
    def __init__(self, cm, h):
        self._cm, self._h, self._s = cm, h, None

    def __enter__(self):
        self._s = self._cm.__enter__()
        return self

    def __exit__(self, *exc):
        return self._cm.__exit__(*exc)

    @property
    def text_stream(self):
        return self._s.text_stream

    @property
    def request_id(self):
        return getattr(self._s, "request_id", None)

    def get_final_message(self):
        m = self._s.get_final_message()
        self._h._responses.append("".join(b.text for b in m.content if getattr(b, "type", None) == "text"))
        self._h._stops.append(getattr(m, "stop_reason", None))
        return m


class Harness:
    """One user's session. `with Harness(live=False) as h:` patches the agent module and restores it after."""

    def __init__(self, live=False, poison=False):
        self.live = live
        self.poison = poison  # serve fixtures with the planted instruction (INJ-01)
        self.db = _FakeDB()
        self.session_id = None
        self.tool_calls, self.api_calls = [], []
        self.tool_results = []      # every tool result in the session, for the provenance checks
        self._script = []
        self._requests, self._responses, self._stops = [], [], []

    # ── setup ──
    def script(self, *turns):
        """The scripted model's responses for the next turn (T1)."""
        self._script = list(turns)

    def load_session(self, messages, pending=None):
        """Start from a saved session, as if earlier turns had happened."""
        sess = AgentSession(id=uuid.uuid4(), user_id=USER.id, title="eval", messages=json.dumps(messages))
        sess.pending_action = json.dumps(pending) if pending else None
        self.db.sess, self.session_id = sess, str(sess.id)
        return sess

    # ── patching ──
    def __enter__(self):
        self._saved = (agent._execute_tool, agent._call_api, agent.anthropic.Anthropic)
        real_execute, real_cls = agent._execute_tool, agent.anthropic.Anthropic

        async def call_api(app, token, method, path, json_body=None, params=None):
            self.api_calls.append((method, path, copy.deepcopy(params), copy.deepcopy(json_body)))
            status, data = fixtures.route(method, path, params, json_body, poison=self.poison)
            return status, copy.deepcopy(data)

        async def execute(app, token, name, tool_input):
            entry = [name, copy.deepcopy(tool_input), None]
            self.tool_calls.append(entry)
            result = await real_execute(app, token, name, tool_input)
            entry[2] = result
            self.tool_results.append(result)
            return result

        def client(**kw):
            inner = real_cls(**kw) if self.live else _FakeClient(self._script)
            return _Recorder(inner, self)

        agent._execute_tool, agent._call_api, agent.anthropic.Anthropic = execute, call_api, client
        return self

    def __exit__(self, *exc):
        agent._execute_tool, agent._call_api, agent.anthropic.Anthropic = self._saved
        return False

    # ── one turn ──
    async def turn(self, text=None, *, input_type=None, approved=None, approval_id=None,
                   article_id=None, article_title=None) -> Turn:
        input_type = input_type or ("goal" if self.session_id is None else "message")
        body = agent.AgentTurnRequest(
            session_id=self.session_id,
            input=agent.AgentInput(type=input_type, text=text, approved=approved, approval_id=approval_id,
                                   article_id=article_id, article_title=article_title))
        marks = (len(self.tool_calls), len(self.api_calls), len(self._requests), len(self._responses),
                 len(self.db.traces), len(self._stops))
        t0 = time.perf_counter()
        events = []
        try:
            resp = await agent.agent_turn(body=body, request=REQUEST, current_user=USER, db=self.db)
        except HTTPException as e:  # an HTTP refusal is the route's answer, not a harness crash
            events.append({"event": "http_error", "status": e.status_code, "detail": e.detail})
        else:
            async for chunk in resp.body_iterator:
                chunk = chunk.decode() if isinstance(chunk, bytes) else chunk
                for line in chunk.split("\n"):
                    if line.startswith("data: "):
                        events.append(json.loads(line[len("data: "):]))
        seconds = time.perf_counter() - t0
        if self.db.sess is not None:
            self.session_id = str(self.db.sess.id)
        traces = self.db.traces[marks[4]:]
        return Turn(events=events, tool_calls=self.tool_calls[marks[0]:], api_calls=self.api_calls[marks[1]:],
                    model_calls=len(self._requests) - marks[2], model_texts=self._responses[marks[3]:],
                    stop_reasons=self._stops[marks[5]:],
                    requests=self._requests[marks[2]:], trace=traces[-1] if traces else None, seconds=seconds)
