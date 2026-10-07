"""
The diagnosis engine behind the admin Agent view (app/services/trace_insights.py).

Every hypothesis sentence must come from rules over trace fields, with the
numbers it cites, so these tests pin the rules: what fires, what the sentence
says, and how takeaways rank across turns. Pure functions: no database.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import trace_insights as ti

NOW = datetime(2026, 10, 7, 16, 0, tzinfo=timezone.utc)


def turn(outcome="blocks", first=1500, total=5000, calls=None, tools=None, blocks=None, phases=None,
         decision=None, context=None, error=None, build="b1", prompt="p1", minutes_ago=0, **tokens):
    calls = calls if calls is not None else [
        {"iter": 1, "start_ms": 40, "ms": 1400, "first_text_ms": 900, "stop_reason": "end_turn", "status": "ok",
         "in": 1000, "out": 120, "cache_read": 6000, "cache_write": 0}]
    blocks = blocks if blocks is not None else [
        {"type": "text", "at_ms": first, "iter": 1, "chars": 300},
        {"type": "prompt_pills", "at_ms": first + 50, "iter": 1, "chars": 80}]
    row = SimpleNamespace(
        id=uuid.uuid4(), created_at=NOW - timedelta(minutes=minutes_ago), session_id=uuid.uuid4(),
        user_id=uuid.uuid4(), model="claude-sonnet-5", input_type="goal", input_preview="catch me up",
        outcome=outcome, iterations=len(calls), first_block_ms=first, total_ms=total,
        tokens_in=tokens.get("tin", sum(c.get("in", 0) for c in calls)), tokens_out=sum(c.get("out", 0) for c in calls),
        cache_read_tokens=tokens.get("cread", sum(c.get("cache_read", 0) for c in calls)),
        cache_write_tokens=tokens.get("cwrite", sum(c.get("cache_write", 0) for c in calls)),
        model_calls=json.dumps(calls), tool_calls=json.dumps(tools or []), blocks=json.dumps(blocks),
        phases=json.dumps(phases or [{"name": "load_context", "start_ms": 0, "ms": 30}]),
        context=json.dumps(context) if context else None, approval_tool=None, error=error,
        build_sha=build, prompt_version=prompt, traffic="real", client="web", decision=decision, ai_hypothesis=None)
    return ti.parse(row)


def codes(t):
    return [f["code"] for f in ti.diagnose(t)["findings"]]


def test_a_healthy_turn_says_so_with_its_numbers():
    d = ti.diagnose(turn())
    assert d["severity"] == "ok" and d["findings"] == []
    assert d["headline"] == "Healthy: first content in 1.5s, 5.0s in total, 1 model call."


def test_a_slow_first_block_is_decomposed_into_its_parts():
    t = turn(first=6200, total=9000,
             calls=[{"iter": 1, "start_ms": 40, "ms": 2100, "first_text_ms": None, "stop_reason": "tool_use", "status": "ok",
                     "in": 1500, "out": 80, "cache_read": 6000, "cache_write": 0},
                    {"iter": 2, "start_ms": 4400, "ms": 3000, "first_text_ms": 1700, "stop_reason": "end_turn",
                     "status": "ok", "in": 9000, "out": 400, "cache_read": 0, "cache_write": 0}],
             tools=[{"name": "get_catchup_feed", "iter": 1, "start_ms": 2150, "ms": 2200, "chars": 5400, "status": "ok"}],
             blocks=[{"type": "text", "at_ms": 6200, "iter": 2, "chars": 900},
                     {"type": "prompt_pills", "at_ms": 6300, "iter": 2, "chars": 80}])
    d = ti.diagnose(t)
    assert d["severity"] == "warn" and "SLOW_FIRST_BLOCK" in codes(t) and "CACHE_MISS" in codes(t)
    head = d["headline"]
    assert head.startswith("First content took 6.2s:")
    assert "2.1s waiting on model call 1 (7,500 input tokens, 80% from cache)" in head
    assert "2.2s in get_catchup_feed" in head
    assert head.endswith("with a cache miss on model call 2.")


def test_a_failure_names_the_step_and_the_error():
    t = turn(outcome="error", first=1200, total=4000, error="KeyError: 'article_id'",
             tools=[{"name": "ask_guru", "iter": 1, "start_ms": 1500, "ms": 20, "status": "raised", "error": True,
                     "error_msg": "KeyError: 'article_id'"}],
             blocks=[{"type": "text", "at_ms": 1200, "iter": 1, "chars": 100}])
    d = ti.diagnose(t)
    assert d["severity"] == "bad"
    assert d["headline"] == "The turn failed in the ask_guru tool (KeyError: 'article_id') after 1 block reached the user."


def test_an_abandoned_turn_says_when_and_where():
    t = turn(outcome="abandoned", first=3000, total=11000,
             calls=[{"iter": 1, "start_ms": 40, "ms": 10900, "status": "abandoned", "in": 0, "out": 0}],
             blocks=[{"type": "article_card", "variant": "mini", "at_ms": 3000, "iter": 1, "chars": 200}])
    d = ti.diagnose(t)
    assert d["severity"] == "bad"
    assert d["headline"] == ("The user left after 11.0s. The last thing they saw was a article_card at 3.0s, "
                             "and the agent was in model call 1.")


def test_a_runaway_loop_names_the_repeated_tool():
    calls = [{"iter": i, "start_ms": i * 100, "ms": 90, "stop_reason": "tool_use", "status": "ok"} for i in range(1, 9)]
    tools = [{"name": "get_metrics", "iter": i, "start_ms": i * 100 + 50, "ms": 10, "status": "ok", "chars": 300}
             for i in range(1, 9)]
    t = turn(outcome="max_iters", first=None, total=25000, calls=calls, tools=tools, blocks=[])
    d = ti.diagnose(t)
    assert d["headline"] == "The agent made 8 model calls without answering, calling get_metrics 8 times in a row."


def test_cut_off_answers_tool_errors_and_layout_breaks_are_flagged():
    t = turn(calls=[{"iter": 1, "start_ms": 40, "ms": 9000, "first_text_ms": 800, "stop_reason": "max_tokens",
                     "status": "ok", "in": 2000, "out": 4096, "cache_read": 6000, "cache_write": 0}],
             tools=[{"name": "get_metrics", "iter": 0, "start_ms": 10, "ms": 30, "status": "http_error",
                     "error": True, "error_msg": "HTTP 500 boom"}],
             blocks=[{"type": "article_card", "variant": "hero", "at_ms": 1500, "iter": 1, "chars": 300},
                     {"type": "article_card", "variant": "hero", "at_ms": 1600, "iter": 1, "chars": 300}])
    c = codes(t)
    assert "CUT_OFF" in c and "TOOL_ERROR" in c and "LAYOUT" in c


def test_the_timeline_puts_every_span_on_one_axis_in_order():
    t = turn(tools=[{"name": "get_catchup_feed", "iter": 1, "start_ms": 500, "ms": 300, "status": "ok", "chars": 4000}])
    items = ti.timeline(t)
    assert [i["kind"] for i in items][:3] == ["phase", "model", "tool"]
    assert all(items[k]["start_ms"] <= items[k + 1]["start_ms"] for k in range(len(items) - 1))
    assert items[1]["detail"].startswith("end_turn, 7,000 in (86% cached)")


def test_cache_share_counts_cached_tokens_in_the_total():
    # Anthropic's input_tokens excludes cache reads: 3,000 uncached + 12,000 cached is 80% from cache, not 400%.
    t = turn(tin=3000, cread=12000, cwrite=0)
    assert ti.cache_share([t]) == 0.8


def test_takeaways_rank_a_broken_tool_first_and_flag_small_samples():
    bad_tool = [{"name": "mark_not_relevant", "iter": 1, "start_ms": 100, "ms": 40, "status": "http_error",
                 "error": True, "error_msg": "HTTP 422 missing filter"}]
    turns = [turn(tools=bad_tool, minutes_ago=i) for i in range(4)] + [turn(minutes_ago=10 + i) for i in range(6)]
    s = ti.summarize(turns, days=7, traffic="real")
    top = s["takeaways"][0]
    assert top["severity"] == "bad" and top["text"].startswith("mark_not_relevant failed on 4 of 4 calls (100%)")
    assert len(top["turn_ids"]) == 4
    assert s["takeaways"][-1]["text"] == "Only 10 turns in this window, so read the percentiles loosely."
    assert s["tiles"]["turns"] == 10 and s["tiles"]["outcomes"] == {"blocks": 10}
    assert s["tools"][0]["name"] == "mark_not_relevant" and s["tools"][0]["errors"] == 4


def test_a_quiet_window_says_what_is_healthy():
    s = ti.summarize([turn(minutes_ago=i) for i in range(25)], days=7, traffic="real")
    assert s["takeaways"][0]["severity"] == "good"
    assert s["takeaways"][0]["text"].startswith("No problems across 25 turns")


def test_a_build_that_raises_errors_is_called_out():
    old = [turn(build="old", minutes_ago=100 + i) for i in range(6)]
    new = [turn(build="new", outcome="error", error="RuntimeError: x", minutes_ago=i) for i in range(3)] + \
          [turn(build="new", minutes_ago=10 + i) for i in range(3)]
    texts = [k["text"] for k in ti.summarize(old + new)["takeaways"]]
    assert any(t.startswith("Errors rose with build new: 50% of turns vs 0% on old.") for t in texts)


def test_turn_rows_match_the_admin_contract():
    t = turn()
    row = ti.turn_row(t, ti.diagnose(t), "a@b.com")
    assert set(row) == {"id", "created_at", "user_id", "user_email", "session_id", "input_type", "input_preview",
                        "outcome", "first_block_ms", "total_ms", "iterations", "tools", "severity", "headline",
                        "traffic", "build_sha"}
