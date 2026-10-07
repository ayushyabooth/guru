"""
Offline tests for the LLM judge (evals/judge.py), its place in an eval run (evals/run.py) and the
calibration math (evals/calibrate.py). The Anthropic client is a fake: no test reaches the network.

    cd backend && venv/bin/python -m pytest -q tests/test_evals_judge.py
"""
import asyncio
import json
from types import SimpleNamespace

import pytest

from evals import calibrate, judge, run
from evals.harness import Turn
from app.routes import agent


# ── fakes ─────────────────────────────────────────────────────────────────────

class _FakeMessages:
    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.calls = reply, error, []

    def create(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.reply


class _FakeAnthropic:
    def __init__(self, reply=None, error=None):
        self.messages = _FakeMessages(reply, error)


def _verdict(meets=True, score=5):
    return {"evidence": ['"Load unpacked"'], "reason": "All five install facts are there.",
            "meets_expectation": meets, **{k: {"reason": f"{k} is fine", "score": score} for k in judge.RUBRICS}}


def _reply(verdict=None, stop_reason="end_turn", text=None):
    """A response the way Opus 5.5 sends one: an (empty) thinking block, then the structured output as text."""
    body = text if text is not None else json.dumps(verdict or _verdict())
    return SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=body)],
                           stop_reason=stop_reason, usage=SimpleNamespace(input_tokens=3000, output_tokens=600))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Every test starts with a client that refuses; a test that wants the judge to answer installs a fake."""
    def refuse():
        raise AssertionError("a test reached for the real Anthropic client")
    monkeypatch.setattr(judge, "_client", refuse)


def _use(monkeypatch, client):
    monkeypatch.setattr(judge, "_client", lambda: client)
    return client


INSTALL = [{"type": "text", "md": "Download https://mobile-guru8.vercel.app/guru-extension.zip, then Load unpacked."},
           {"type": "prompt_pills", "prompts": ["Open Setup", "Catch me up"]}]


def _turn(user="How do I install the Guru extension?", events=None, tools=None):
    events = events if events is not None else [{"event": "block", "block": b} for b in INSTALL] + [{"event": "done"}]
    return Turn(events=events, tool_calls=tools or [], api_calls=[], model_calls=1, model_texts=[], stop_reasons=[],
                requests=[[{"role": "user", "content": user}]], trace=None, seconds=0.1)


CASE = {"id": "QA-03", "tier": "T2", "runs": 3, "title": "Extension install steps, exact",
        "expect": "The install steps, exact.", "grader": "exact strings", "judge": True, "label": "GREEN"}


def _scenario(ok=True):
    async def scenario(h):  # the code check's verdict, without the live model
        return ok, "all five install facts present" if ok else "missing: setup", [_turn()], None
    return scenario


# ── the judge call ────────────────────────────────────────────────────────────

def test_the_judge_parses_its_structured_output_into_the_verdict(monkeypatch):
    client = _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=True, score=4))))
    v = judge.judge_run(CASE, [_turn()])
    assert "error" not in v
    assert v["meets_expectation"] is True and v["reason"] == "All five install facts are there."
    assert v["evidence"] == ['"Load unpacked"']
    assert {k: v[k] for k in judge.RUBRICS} == {k: {"score": 4, "reason": f"{k} is fine"} for k in judge.RUBRICS}
    assert v["tokens"] == {"in": 3000, "out": 600}
    assert v["cost_usd"] == pytest.approx((3000 * 4.00 + 600 * 20.00) / 1e6)
    assert (v["model"], v["version"]) == ("claude-opus-5-5", judge.VERSION)
    assert v["expect"] == "The install steps, exact."  # the wording it judged against, kept for labeling
    assert v["transcript"][0]["user"] == "How do I install the Guru extension?"

    # One call: structured output against the schema. No forced tool, temperature or thinking, each a 400 on Opus 5.5.
    (kw,) = client.messages.calls
    assert (kw["model"], kw["max_tokens"]) == ("claude-opus-5-5", judge.MAX_TOKENS)
    assert not {"temperature", "thinking", "tool_choice", "tools"} & set(kw)
    assert kw["extra_body"]["output_config"] == {"effort": judge.EFFORT,
                                                 "format": {"type": "json_schema", "schema": judge.SCHEMA}}
    sent = kw["messages"][0]["content"]
    assert "The case: Extension install steps, exact\nWhat good looks like: The install steps, exact." in sent
    assert "user: How do I install the Guru extension?" in sent and "Load unpacked" in sent


def test_the_schema_is_one_structured_outputs_accepts():
    def walk(s):
        assert not {"minimum", "maximum", "minLength", "maxLength"} & set(s)  # unsupported constraints
        if s.get("type") == "object":
            assert s["additionalProperties"] is False and set(s["required"]) == set(s["properties"])
            for p in s["properties"].values():
                walk(p)
    walk(judge.SCHEMA)


@pytest.mark.parametrize("reply, error, says", [
    (None, RuntimeError("connection reset"), "RuntimeError: connection reset"),
    (_reply(stop_reason="refusal"), None, "declined to grade"),
    (_reply(stop_reason="max_tokens", text='{"evidence": ["Load'), None, "cut off at max_tokens"),
    (_reply(text="It passes."), None, "not JSON"),
    (_reply({"meets_expectation": "yes"}), None, "doesn't match the schema"),
])
def test_a_judge_failure_comes_back_as_an_error_never_an_exception(monkeypatch, reply, error, says):
    _use(monkeypatch, _FakeAnthropic(reply, error))
    v = judge.judge_run(CASE, [_turn()])
    assert says in v["error"] and "meets_expectation" not in v
    assert v["transcript"]  # kept, so the run can still be read


def test_the_transcript_is_what_the_user_saw_in_order_without_ids_or_links():
    card = {"type": "article_card", "variant": "mini", "article_id": "art-evalgap", "title": "The Eval Gap",
            "url": "https://example.com/art-evalgap", "image_url": "https://images.example.com/x.jpg"}
    events = [{"event": "status", "text": "thinking…"},
              {"event": "block", "block": {"type": "text", "md": "Saved it for you."}},
              {"event": "status", "text": "working…"},  # save_article has no status text of its own
              {"event": "status", "text": agent.STATUS_TEXT["get_catchup_feed"]},
              {"event": "block", "block": card},
              {"event": "error", "message": "Overloaded"}]
    tools = [["save_article", {"article_id": "art-agents"}, '{"saved": true}'],
             ["get_catchup_feed", {"filter": "core"}, '{"storyboards": []}'],
             ["get_metrics", {}, '{"error": "HTTP 500", "detail": "boom"}'],  # never placed by a status: goes first
             ["ask_guru", {"question": "why?"}, None]]
    (turn,) = judge.transcript([_turn(user="Catch me up", events=events, tools=tools)])
    assert turn["user"] == "Catch me up"
    assert turn["steps"] == [
        {"tool": "get_metrics", "input": {}, "status": "error: HTTP 500 boom"},
        {"tool": "ask_guru", "input": {"question": "why?"}, "status": "raised"},
        {"block": "text", "shows": {"md": "Saved it for you."}},  # the claim comes before the save it claims
        {"tool": "save_article", "input": {"article_id": "art-agents"}, "status": "ok"},
        {"tool": "get_catchup_feed", "input": {"filter": "core"}, "status": "empty"},
        {"block": "article_card", "shows": {"variant": "mini", "title": "The Eval Gap"}},
        {"error": "Overloaded"}]
    text = judge.render([turn])
    assert "art-evalgap" not in text and "example.com" not in text

    # A tap on an approval card: no typed text (the trace says what happened), and the approved write ran first.
    tap = Turn(events=[{"event": "status", "text": "thinking…"},
                       {"event": "block", "block": {"type": "text", "md": "Noted."}}],
               tool_calls=[["add_note", {"article_id": "art-agents", "note": "Undo beats confirm."}, '{"id": "ann-1"}']],
               api_calls=[], model_calls=1, model_texts=[], stop_reasons=[],
               requests=[[{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"}]}]],
               trace=SimpleNamespace(input_type="decision", decision="approved", input_preview=""), seconds=0.1)
    assert judge.transcript([tap]) == [{"user": "(a tap on the approval card: approved)", "steps": [
        {"tool": "add_note", "input": {"article_id": "art-agents", "note": "Undo beats confirm."}, "status": "ok"},
        {"block": "text", "shows": {"md": "Noted."}}]}]


# ── in the eval run ──────────────────────────────────────────────────────────

def test_a_judge_error_is_recorded_and_the_run_goes_on(monkeypatch):
    monkeypatch.setitem(run.SCENARIOS, "QA-03", _scenario(ok=True))
    _use(monkeypatch, _FakeAnthropic(error=RuntimeError("judge down")))
    r = asyncio.run(run.run_case(CASE, live=True, runs_override=2))
    assert [x["judge"]["error"] for x in r["runs"]] == ["RuntimeError: judge down"] * 2
    assert all(x["transcript"] for x in r["runs"])
    assert r["passed"] and r["summary"] == "2/2" and run.verdict(r) == "ok" and run.exit_code([r]) == 0


def test_a_judge_fail_never_changes_passed_or_the_exit_code_while_it_is_report_only(monkeypatch):
    monkeypatch.setitem(run.SCENARIOS, "QA-03", _scenario(ok=True))
    _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=False, score=1))))
    r = asyncio.run(run.run_case(CASE, live=True, runs_override=3, gates=False))
    assert [x["judge"]["meets_expectation"] for x in r["runs"]] == [False] * 3
    assert all(x["ok"] and "code_ok" not in x for x in r["runs"])
    assert r["passed"] and r["summary"] == "3/3" and run.verdict(r) == "ok" and run.exit_code([r]) == 0


def test_with_judge_gates_on_a_live_run_passes_only_if_the_judge_passes_it_too(monkeypatch):
    monkeypatch.setitem(run.SCENARIOS, "QA-03", _scenario(ok=True))
    _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=False, score=2))))
    r = asyncio.run(run.run_case(CASE, live=True, runs_override=2, gates=True))
    assert not r["passed"] and run.verdict(r) == "UNEXPECTED RED" and run.exit_code([r]) == 1
    assert r["runs"][0]["code_ok"] is True
    assert r["runs"][0]["detail"] == "the judge failed it: All five install facts are there."


def test_only_live_runs_of_judge_cases_are_judged(monkeypatch):
    monkeypatch.setitem(run.SCENARIOS, "QA-03", _scenario(ok=True))
    monkeypatch.setitem(run.SCENARIOS, "PERF-01", _scenario(ok=True))
    perf = {k: v for k, v in CASE.items() if k != "judge"} | {"id": "PERF-01"}
    for case, live, judging in ((CASE, True, False), (CASE, False, True), (perf, True, True)):
        r = asyncio.run(run.run_case(case, live=live, runs_override=1, judging=judging))
        assert "judge" not in r["runs"][0] and "transcript" not in r["runs"][0]


def test_every_live_case_but_the_latency_ones_asks_for_the_judge():
    cases = run.load_cases()
    assert {c["id"] for c in cases if c.get("judge")} == {
        c["id"] for c in cases if c["tier"] == "T2" and "p95_ms" not in c}


def test_the_report_shows_the_judge_beside_the_code_check(capsys):
    runs = [{"ok": True, "detail": "all five install facts present", "metric": None,
             "judge": _verdict(meets=m, score=s) | {"tokens": {"in": 3000, "out": 600}, "cost_usd": 0.024}}
            for m, s in ((True, 5), (False, 3))]
    runs.append({"ok": True, "detail": "all five install facts present", "metric": None,
                 "judge": {"error": "RateLimitError: slow down", "tokens": {"in": 0, "out": 0}, "cost_usd": 0.0}})
    r = {"id": "QA-03", "tier": "T2", "label": "GREEN", "title": CASE["title"], "passed": True, "crashed": False,
         "summary": "3/3", "runs": runs, "checks": {c: [0, 0, []] for c in run.CHECKS}, "tokens": {}, "cost_usd": 0.0}
    run.print_report([r], run.load_cases(), True, None)
    out = capsys.readouterr().out
    assert "judge: meets 1/2, 1 error | voice 4.0 honesty 4.0 journey 4.0 (report-only until calibrated)" in out
    assert "LLM judge (claude-opus-5-5, effort low), report-only until calibrated" in out
    assert "agreement with the code check: 1/2 runs (QA-03 1/2)" in out
    assert "voice 4 (1/2 pass)" in out
    assert "QA-03 run 2: code pass, judge fail. The judge: All five install facts are there." in out
    assert "judge error, QA-03 run 3: RateLimitError: slow down" in out
    assert "judge cost estimate: $0.05 for 3 calls (6,000 tokens in, 1,200 out" in out


# ── calibration ──────────────────────────────────────────────────────────────

def _labels(agree, disagree, case="QA-03", version=None):
    v = version or judge.VERSION
    return ([{"case": case, "run": i, "run_at": "t", "label": "pass", "judge": "pass", "judge_version": v}
             for i in range(agree)] +
            [{"case": case, "run": 100 + i, "run_at": "t", "label": "fail", "judge": "pass", "judge_version": v}
             for i in range(disagree)])


def test_calibration_agreement_and_the_gate():
    s = calibrate.agreement(_labels(17, 3))  # 20 labels at exactly 85%: met
    assert (s["n"], s["agree"], s["met"]) == (20, 17, True)
    assert not calibrate.agreement(_labels(16, 4))["met"]  # 80%
    assert not calibrate.agreement(_labels(19, 0))["met"]  # every one agrees, but only 19 labels
    assert not calibrate.agreement([])["met"]

    # Per case, and only labels made against this judge: an older judge's verdicts say nothing about this one.
    s = calibrate.agreement(_labels(10, 0) + _labels(8, 2, "PLAN-07") + _labels(5, 0, version="an-older-judge"))
    assert s["per_case"] == {"QA-03": [10, 10], "PLAN-07": [8, 10]}
    assert (s["n"], s["agree"], s["stale"], len(s["disagree"]), s["met"]) == (20, 18, 5, 2, True)


def test_labeling_appends_to_the_labels_file_and_never_shows_the_judge_first(tmp_path, capsys):
    def judged(meets, **said):
        return {"ok": True, "detail": "d", "transcript": judge.transcript([_turn()]),
                "judge": _verdict(meets=meets) | {"model": judge.MODEL, "version": judge.VERSION} | said}
    errored = {"ok": True, "detail": "d", "transcript": judge.transcript([_turn()]),
               "judge": {"error": "RateLimitError: slow down", "version": judge.VERSION}}
    latest = {"at": "2026-10-07T17:00:00",
              "results": [{"id": "QA-03", "title": CASE["title"],
                           "runs": [judged(True, expect="The wording the judge read."), judged(False), errored]}]}
    lp, cp = tmp_path / "latest.json", tmp_path / "calibration.yaml"
    lp.write_text(json.dumps(latest))
    calibrate.save({"judge_gates": True, "labels": []}, str(cp))  # the owner's flag must survive a save

    answers = iter(["maybe", "p looks right", "f never pointed to Setup"])
    assert calibrate.label(str(lp), str(cp), ask=lambda prompt: next(answers)) == 2
    out = capsys.readouterr().out
    assert "All five install facts" not in out  # the judge's reason stays hidden
    # The owner labels against the wording the judge read; a run judged before that was recorded shows cases.yaml's.
    assert "What good looks like: The wording the judge read." in out
    assert f"What good looks like: {calibrate._expectations()['QA-03']}" in out
    assert cp.read_text().startswith(calibrate.HEADER)
    data = calibrate.load(str(cp))
    assert data["judge_gates"] is True
    assert [(lb["case"], lb["run"], lb["label"], lb["note"], lb["judge"], lb["judge_version"])
            for lb in data["labels"]] == [("QA-03", 1, "pass", "looks right", "pass", judge.VERSION),
                                          ("QA-03", 2, "fail", "never pointed to Setup", "fail", judge.VERSION)]
    assert [lb["expect"] for lb in data["labels"]] == ["The wording the judge read.", calibrate._expectations()["QA-03"]]
    assert calibrate.agreement(data["labels"])["agree"] == 2
    # Nothing is offered twice, and a run the judge couldn't grade is never offered.
    assert calibrate.label(str(lp), str(cp), ask=lambda prompt: pytest.fail("asked again")) == 0


def test_judge_gates_turns_on_only_when_the_owner_writes_true(tmp_path):
    p = tmp_path / "calibration.yaml"
    assert calibrate.judge_gates(str(p)) is False  # no file
    p.write_text("judge_gates: true\nlabels: []\n")
    assert calibrate.judge_gates(str(p)) is True
    p.write_text("judge_gates: false\nlabels: []\n")
    assert calibrate.judge_gates(str(p)) is False
    p.write_text("judge_gates: [unclosed\n")
    assert calibrate.judge_gates(str(p)) is False  # a broken file never turns the judge on
