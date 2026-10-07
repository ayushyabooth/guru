"""
Per-turn tracing for the agentic Guru tab - the sensor layer for evals.

Records what a turn did and when each part happened: model calls (tokens, cache
hits, time to first streamed text, Anthropic request id), tool calls (what was
asked, how long, any error), every UI block streamed (with a short preview),
other phases such as loading context, any approval pause, and the outcome. Every
span carries its start offset from the beginning of the turn, so a timeline can
be drawn and every millisecond attributed. Each turn also records the build and
prompt version that served it, the client, and whether the account is real or
a synthetic test persona.

One AgentTurnTrace row per turn, plus one greppable log line:

    [agent-turn] outcome=blocks iters=2 first_block_ms=1840 total_ms=5210 ...

Tracing must never change or break a turn: every method swallows its own
errors, and the route writes the row in its own transaction after the user's
turn is committed.
"""
import contextlib
import json
import logging
import os
import time

from app.models.agent_turn_trace import AgentTurnTrace

logger = logging.getLogger(__name__)

INPUT_PREVIEW_CHARS = 200
TOOL_INPUT_CHARS = 300
ERROR_CHARS = 300
BLOCK_PREVIEW_CHARS = 160
BUILD_SHA = (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "local")[:12]


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _block_preview(block: dict):
    for key in ("title", "md", "text", "goal", "summary", "question", "prompt"):
        v = block.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()[:BLOCK_PREVIEW_CHARS]
    if isinstance(block.get("prompts"), list):
        return " | ".join(str(p) for p in block["prompts"])[:BLOCK_PREVIEW_CHARS]
    return None


class TurnTrace:
    def __init__(self, session_id, user_id, model: str, input_type: str, input_text: str = None,
                 *, prompt_version: str = None, traffic: str = None, client: str = None, decision: str = None):
        self.t0 = time.perf_counter()
        self.session_id, self.user_id, self.model = session_id, user_id, model
        self.input_type = input_type
        self.input_preview = (input_text or "")[:INPUT_PREVIEW_CHARS]
        self.prompt_version, self.traffic, self.client, self.decision = prompt_version, traffic, client, decision
        self.model_calls, self.tool_calls, self.blocks, self.phases = [], [], [], []
        self.tokens = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
        self.first_block_ms = None
        self.approval_tool = None
        self.iter = 0          # model calls started so far; tools and blocks are tagged with it
        self._call = None
        self._tool = None

    def now_ms(self) -> int:
        return _ms(time.perf_counter() - self.t0)

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

    # ── model calls ──
    def model_started(self):
        try:
            self.iter += 1
            self._call = {"start": time.perf_counter(), "start_ms": self.now_ms(),
                          "first_text_ms": None, "request_id": None}
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
                self._call["first_text_ms"] = _ms(time.perf_counter() - self._call["start"])
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
            c = self._call or {}
            self.model_calls.append({
                "iter": self.iter,
                "start_ms": c.get("start_ms"),
                "ms": _ms(time.perf_counter() - c["start"]) if c.get("start") else None,
                "first_text_ms": c.get("first_text_ms"),
                "stop_reason": getattr(resp, "stop_reason", None),
                "in": tin, "out": tout, "cache_read": cread, "cache_write": cwrite,
                "request_id": c.get("request_id"),
            })
        except Exception:
            pass
        self._call = None

    # ── tools ──
    def tool_started(self, name: str, tool_input=None):
        try:
            preview = json.dumps(tool_input, default=str)[:TOOL_INPUT_CHARS] if tool_input else None
        except Exception:
            preview = None
        self._tool = (name, time.perf_counter(), self.now_ms(), preview)

    def tool_done(self, name: str, result: str):
        try:
            started = self._tool if self._tool and self._tool[0] == name else None
            is_error, error_msg = False, None
            try:
                parsed = json.loads(result)
                if isinstance(parsed, dict) and "error" in parsed:
                    is_error = True
                    error_msg = " ".join(str(parsed.get(k) or "") for k in ("error", "detail")).strip()[:ERROR_CHARS]
            except Exception:
                pass
            self.tool_calls.append({
                "name": name,
                "iter": self.iter,
                "start_ms": started[2] if started else None,
                "ms": _ms(time.perf_counter() - started[1]) if started else None,
                "chars": len(result or ""),
                "error": is_error,
                "error_msg": error_msg,
                "input": started[3] if started else None,
            })
        except Exception:
            pass
        self._tool = None

    # ── UI blocks ──
    def block(self, block: dict):
        try:
            at = self.now_ms()
            if self.first_block_ms is None:
                self.first_block_ms = at
            self.blocks.append({"type": block.get("type"), "variant": block.get("variant"), "at_ms": at,
                                "iter": self.iter, "preview": _block_preview(block)})
        except Exception:
            pass

    def approval(self, tool_name: str):
        self.approval_tool = tool_name

    # ── finish ──
    def to_row(self, outcome: str, error: str = None) -> AgentTurnTrace:
        total = self.now_ms()
        row = AgentTurnTrace(
            session_id=self.session_id, user_id=self.user_id, model=self.model,
            input_type=self.input_type, input_preview=self.input_preview,
            outcome=outcome, iterations=len(self.model_calls),
            first_block_ms=self.first_block_ms, total_ms=total,
            tokens_in=self.tokens["in"], tokens_out=self.tokens["out"],
            cache_read_tokens=self.tokens["cache_read"], cache_write_tokens=self.tokens["cache_write"],
            model_calls=json.dumps(self.model_calls), tool_calls=json.dumps(self.tool_calls),
            blocks=json.dumps(self.blocks), phases=json.dumps(self.phases),
            approval_tool=self.approval_tool,
            error=(error or None) and error[:1000],
            build_sha=BUILD_SHA, prompt_version=self.prompt_version,
            traffic=self.traffic, client=self.client, decision=self.decision,
        )
        try:
            logger.info(
                "[agent-turn] outcome=%s iters=%d first_block_ms=%s total_ms=%d tools=%s blocks=%s "
                "tok_in=%d tok_out=%d cache_read=%d model=%s traffic=%s build=%s",
                outcome, len(self.model_calls), self.first_block_ms, total,
                ",".join(t["name"] for t in self.tool_calls) or "-",
                ",".join(b["type"] or "?" for b in self.blocks) or "-",
                self.tokens["in"], self.tokens["out"], self.tokens["cache_read"], self.model,
                self.traffic, BUILD_SHA,
            )
        except Exception:
            pass
        return row
