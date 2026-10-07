"""
Per-turn tracing for the agentic Guru tab - the sensor layer for evals.

Records what a turn did and when each part happened: model calls (tokens, cache
hits, time to first streamed text, Anthropic request id), tool calls (arguments,
timing, status), every UI block streamed, other phases such as loading context,
any approval pause, and the outcome. Every span carries its start offset from
the beginning of the turn, so a timeline can be drawn and every millisecond
attributed. Calls are recorded when they START, so a call that fails or is cut
off by the user leaving still shows up, with its status. Each turn also records
the build and prompt version that served it, the client, and whether the
account is real or a synthetic test persona.

Privacy: for real users a trace keeps ids, enums, sizes and timings, never the
user's own writing (notes, recap answers, reflections, quotes) beyond the
typed input preview. Synthetic persona and test accounts keep full previews,
because they hold no real person's data.

One AgentTurnTrace row per turn, plus one greppable log line:

    [agent-turn] id=... session=... outcome=blocks iters=2 first_block_ms=1840 total_ms=5210 ...

Tracing must never change or break a turn: every method swallows its own
errors, and the route writes the row in its own transaction after the user's
turn is committed.
"""
import contextlib
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone

from app.models.agent_turn_trace import AgentTurnTrace

logger = logging.getLogger(__name__)

INPUT_PREVIEW_CHARS = 200
FULL_TOOL_INPUT_CHARS = 4000     # synthetic accounts only
ERROR_CHARS = 300
BLOCK_PREVIEW_CHARS = 160        # synthetic accounts only
# Tool arguments that identify things rather than carry the user's writing.
SAFE_ARG_KEYS = {"article_id", "storyboard_id", "journey_id", "session_id", "question_index",
                 "filter", "days", "limit", "stage", "variant"}


def _build_label() -> str:
    sha = os.getenv("RAILWAY_GIT_COMMIT_SHA")
    if sha:
        return sha[:12]
    dep = os.getenv("RAILWAY_DEPLOYMENT_ID")
    return f"dep-{dep[:8]}" if dep else "local"


BUILD_SHA = _build_label()


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _clean(text) -> str:
    return (text or "").replace("\x00", "")


def error_text(e: BaseException) -> str:
    """'TimeoutError: ...' - never empty, always typed."""
    msg = str(e).strip()
    return f"{type(e).__name__}: {msg}" if msg else type(e).__name__


_INPUT_ECHO = re.compile(r"""(['"]input['"]\s*:\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\{[^}]*\}|\[[^\]]*\]|[^,}\]]+)""")


def _block_preview(block: dict):
    for key in ("title", "md", "text", "goal", "summary", "question", "prompt"):
        v = block.get(key)
        if isinstance(v, str) and v.strip():
            return _clean(v).strip()[:BLOCK_PREVIEW_CHARS]
    if isinstance(block.get("prompts"), list):
        return " | ".join(str(p) for p in block["prompts"])[:BLOCK_PREVIEW_CHARS]
    return None


class TurnTrace:
    def __init__(self, session_id, user_id, model: str, input_type: str, input_text: str = None,
                 *, prompt_version: str = None, traffic: str = None, client: str = None, decision: str = None):
        self.t0 = time.perf_counter()
        self.id = uuid.uuid4()
        self.started_at = datetime.now(timezone.utc)
        self.session_id, self.user_id, self.model = session_id, user_id, model
        self.input_type = input_type
        self.input_preview = _clean(input_text)[:INPUT_PREVIEW_CHARS]
        self.prompt_version, self.traffic, self.client, self.decision = prompt_version, traffic, client, decision
        self.full = traffic == "synthetic"
        self.model_calls, self.tool_calls, self.blocks, self.phases = [], [], [], []
        self.context = {}
        self.tokens = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
        self.first_block_ms = None
        self.approval_tool = None
        self.iter = 0          # model calls started so far; tools and blocks are tagged with it
        self._call = None      # the running model call entry
        self._tool = None      # the running tool call entry

    def now_ms(self) -> int:
        return _ms(time.perf_counter() - self.t0)

    def note(self, **kv):
        """Turn context for the viewer (approval ids, history size, ...)."""
        try:
            self.context.update({k: v for k, v in kv.items() if v is not None})
        except Exception:
            pass

    # ── phases that are neither model nor tool (e.g. loading user context) ──
    @contextlib.contextmanager
    def span(self, name: str):
        start = self.now_ms()
        try:
            yield
        finally:
            try:
                self.phases.append({"name": name, "start_ms": start, "ms": self.now_ms() - start})
            except Exception:
                pass

    # ── model calls: the entry exists from the moment the call starts ──
    def model_started(self):
        try:
            self.iter += 1
            self._call = {"iter": self.iter, "start_ms": self.now_ms(), "ms": None, "first_text_ms": None,
                          "stop_reason": None, "status": "running", "in": 0, "out": 0,
                          "cache_read": 0, "cache_write": 0, "request_id": None, "_t": time.perf_counter()}
            self.model_calls.append(self._call)
        except Exception:
            self._call = None

    def model_request_id(self, request_id):
        try:
            if self._call is not None and request_id:
                self._call["request_id"] = str(request_id)[:64]
        except Exception:
            pass

    def model_first_text(self):
        try:
            if self._call and self._call["first_text_ms"] is None:
                self._call["first_text_ms"] = _ms(time.perf_counter() - self._call["_t"])
        except Exception:
            pass

    def model_done(self, resp):
        try:
            u = getattr(resp, "usage", None)
            tin = getattr(u, "input_tokens", 0) or 0
            tout = getattr(u, "output_tokens", 0) or 0
            cread = getattr(u, "cache_read_input_tokens", 0) or 0
            cwrite = getattr(u, "cache_creation_input_tokens", 0) or 0
            self.tokens["in"] += tin
            self.tokens["out"] += tout
            self.tokens["cache_read"] += cread
            self.tokens["cache_write"] += cwrite
            c = self._call
            if c is None:  # done without a recorded start: still count it
                self.iter += 1
                c = {"iter": self.iter, "start_ms": None, "first_text_ms": None, "request_id": None, "_t": None}
                self.model_calls.append(c)
            c.update({"ms": _ms(time.perf_counter() - c["_t"]) if c.get("_t") else None,
                      "stop_reason": getattr(resp, "stop_reason", None), "status": "ok",
                      "in": tin, "out": tout, "cache_read": cread, "cache_write": cwrite})
        except Exception:
            pass
        self._call = None

    # ── tools ──
    def tool_started(self, name: str, tool_input=None, tool_use_id: str = None):
        try:
            args, text_chars, full = {}, {}, None
            if isinstance(tool_input, dict):
                for k, v in tool_input.items():
                    if k in SAFE_ARG_KEYS and isinstance(v, (str, int, float, bool)):
                        args[k] = v if not isinstance(v, str) else v[:80]
                    elif isinstance(v, str):
                        text_chars[k] = len(v)
                if self.full:
                    full = json.dumps(tool_input, default=str)[:FULL_TOOL_INPUT_CHARS]
            self._tool = {"name": name, "iter": self.iter, "start_ms": self.now_ms(), "ms": None,
                          "status": "running", "chars": None, "error": False, "error_msg": None,
                          "args": args, "text_chars": text_chars or None, "tool_use_id": tool_use_id,
                          "_t": time.perf_counter()}
            if full is not None:
                self._tool["input"] = full
            self.tool_calls.append(self._tool)
        except Exception:
            self._tool = None

    def _error_msg(self, parsed: dict) -> str:
        text = " ".join(str(parsed.get(k) or "") for k in ("error", "detail")).strip()
        if not self.full:
            text = _INPUT_ECHO.sub(r"\1…", text)  # a 422 detail can echo the user's request body
        return _clean(text)[:ERROR_CHARS]

    def tool_done(self, name: str, result: str):
        try:
            t = self._tool if self._tool and self._tool.get("name") == name else None
            if t is None:  # done without a recorded start: still count it
                t = {"name": name, "iter": self.iter, "start_ms": None, "args": {}, "_t": None}
                self.tool_calls.append(t)
            is_error, error_msg = False, None
            try:
                parsed = json.loads(result)
                if isinstance(parsed, dict) and "error" in parsed:
                    is_error, error_msg = True, self._error_msg(parsed)
            except Exception:
                pass
            t.update({"ms": _ms(time.perf_counter() - t["_t"]) if t.get("_t") else None,
                      "chars": len(result or ""), "error": is_error, "error_msg": error_msg,
                      "status": "http_error" if is_error else "ok"})
        except Exception:
            pass
        self._tool = None

    # ── failures: name the step that was running ──
    def fail(self, e: BaseException):
        try:
            if self._tool is not None and self._tool.get("status") == "running":
                self._tool.update({"status": "raised", "error": True,
                                   "ms": _ms(time.perf_counter() - self._tool["_t"]) if self._tool.get("_t") else None,
                                   "error_msg": _clean(error_text(e))[:ERROR_CHARS]})
            if self._call is not None and self._call.get("status") == "running":
                self._call.update({"status": "failed",
                                   "ms": _ms(time.perf_counter() - self._call["_t"]) if self._call.get("_t") else None})
                rid = getattr(e, "request_id", None)
                if rid and not self._call.get("request_id"):
                    self._call["request_id"] = str(rid)[:64]
        except Exception:
            pass

    def abandon(self):
        """The client went away mid-turn: close whatever was running."""
        try:
            for entry in (self._tool, self._call):
                if entry is not None and entry.get("status") == "running":
                    entry.update({"status": "abandoned",
                                  "ms": _ms(time.perf_counter() - entry["_t"]) if entry.get("_t") else None})
        except Exception:
            pass

    # ── UI blocks ──
    def block(self, block: dict):
        try:
            at = self.now_ms()
            if self.first_block_ms is None:
                self.first_block_ms = at
            entry = {"type": block.get("type"), "variant": block.get("variant"), "at_ms": at,
                     "iter": self.iter, "chars": len(json.dumps(block, default=str))}
            if self.full:
                entry["preview"] = _block_preview(block)
            self.blocks.append(entry)
        except Exception:
            pass

    def approval(self, tool_name: str, approval_id: str = None):
        self.approval_tool = tool_name
        self.note(approval_id=approval_id)

    # ── finish ──
    @staticmethod
    def _public(entries):
        return [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]

    def to_row(self, outcome: str, error: str = None) -> AgentTurnTrace:
        total = self.now_ms()
        row = AgentTurnTrace(
            id=self.id, created_at=self.started_at,
            session_id=self.session_id, user_id=self.user_id, model=self.model,
            input_type=(self.input_type or "")[:16], input_preview=self.input_preview,
            outcome=outcome, iterations=len(self.model_calls),
            first_block_ms=self.first_block_ms, total_ms=total,
            tokens_in=self.tokens["in"], tokens_out=self.tokens["out"],
            cache_read_tokens=self.tokens["cache_read"], cache_write_tokens=self.tokens["cache_write"],
            model_calls=json.dumps(self._public(self.model_calls)),
            tool_calls=json.dumps(self._public(self.tool_calls)),
            blocks=json.dumps(self.blocks), phases=json.dumps(self.phases),
            context=json.dumps(self.context) if self.context else None,
            approval_tool=self.approval_tool,
            error=(_clean(error)[:1000] or None) if error else None,
            build_sha=BUILD_SHA, prompt_version=self.prompt_version,
            traffic=self.traffic, client=self.client, decision=self.decision,
        )
        try:
            logger.info(
                "[agent-turn] id=%s session=%s outcome=%s iters=%d first_block_ms=%s total_ms=%d tools=%s "
                "blocks=%s tok_in=%d tok_out=%d cache_read=%d model=%s traffic=%s build=%s",
                self.id, self.session_id, outcome, len(self.model_calls), self.first_block_ms, total,
                ",".join(t["name"] for t in self.tool_calls) or "-",
                ",".join(b["type"] or "?" for b in self.blocks) or "-",
                self.tokens["in"], self.tokens["out"], self.tokens["cache_read"], self.model,
                self.traffic, BUILD_SHA,
            )
        except Exception:
            pass
        return row
