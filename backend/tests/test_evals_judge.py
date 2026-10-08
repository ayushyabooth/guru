"""
Offline tests for the LLM judge, version 2 (evals/judge.py), and its place in an eval run (evals/run.py).
The Anthropic client is a fake: no test reaches the network. Calibration is tested in
tests/test_evals_calibrate.py, planted mistakes in tests/test_evals_planted.py.

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


def _verdict(meets=True, score=5, **scores):
    """A version 2 verdict the way the model returns it. scores sets one dimension's score (None: n/a)."""
    v = {"evidence": ['"Load unpacked"'], "reason": "All five install facts are there.", "meets_expectation": meets}
    for k in judge.RUBRICS:
        s = scores.get(k, score)
        v[k] = {"problems": [] if s in (None, 5) else [f'"a quote" is a {k} problem'], "score": s,
                "reason": f"{k} reason"}
    return v


def _reply(verdict=None, stop_reason="end_turn", text=None):
    """A response the way Opus 5.5 sends one: an (empty) thinking block, then the structured output as text."""
    body = text if text is not None else json.dumps(verdict or _verdict())
    return SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=body)],
                           stop_reason=stop_reason, usage=SimpleNamespace(input_tokens=3000, output_tokens=600))


@pytest.fixture(autouse=True)
def no_network(monkeypatch, tmp_path):
    """Every test starts with a client that refuses (a test that wants the judge to answer installs a fake),
    and with the labeling pool, store and labels in tmp_path: a judged run is queued for labeling as it
    finishes, and a test must never write into the owner's pool."""
    def refuse():
        raise AssertionError("a test reached for the real Anthropic client")
    monkeypatch.setattr(judge, "_client", refuse)
    monkeypatch.setattr(calibrate, "POOL", str(tmp_path / "judged_runs.jsonl"))
    monkeypatch.setattr(calibrate, "STORE", str(tmp_path / "labeled_transcripts.jsonl"))
    monkeypatch.setattr(calibrate, "LABELS", str(tmp_path / "calibration.yaml"))


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
        "expect": "The install steps, exact.", "grader": "exact strings", "judge": True, "label": "GREEN",
        "must": ["chrome://extensions", "Load unpacked"], "exact": True}
LOOSE = {k: v for k, v in CASE.items() if k not in ("must", "exact")} | {"id": "PLAN-07"}  # no must list, not exact


def _scenario(ok=True):
    async def scenario(h):  # the code check's verdict, without the live model
        return ok, "all five install facts present" if ok else "missing: setup", [_turn()], None
    return scenario


# ── the judge call ────────────────────────────────────────────────────────────

def test_the_judge_parses_its_structured_output_into_the_verdict(monkeypatch):
    client = _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=True, score=4, faithfulness=None))))
    v = judge.judge_run(CASE, [_turn()])
    assert "error" not in v
    assert v["meets_expectation"] is True and v["reason"] == "All five install facts are there."
    assert v["evidence"] == ['"Load unpacked"']
    assert v["faithfulness"] == {"problems": [], "score": None, "reason": "faithfulness reason"}  # not applicable
    assert v["consent"] == {"problems": ['"a quote" is a consent problem'], "score": 4, "reason": "consent reason"}
    assert [k for k in v if k in judge.RUBRICS] == list(judge.RUBRICS)
    assert v["tokens"] == {"in": 3000, "out": 600}
    assert v["cost_usd"] == pytest.approx((3000 * 4.00 + 600 * 20.00) / 1e6)
    assert (v["model"], v["version"]) == ("claude-opus-5-5", judge.VERSION)
    # The wording it judged against, kept for labeling: the expectation and the must list.
    assert v["expect"] == "The install steps, exact." and v["must"] == ["chrome://extensions", "Load unpacked"]
    assert v["transcript"][0]["user"] == "How do I install the Guru extension?"

    # One call: structured output against the schema. No forced tool, temperature or thinking, each a 400 on Opus 5.5.
    (kw,) = client.messages.calls
    assert (kw["model"], kw["max_tokens"]) == ("claude-opus-5-5", judge.MAX_TOKENS)
    assert not {"temperature", "thinking", "tool_choice", "tools"} & set(kw)
    assert kw["extra_body"]["output_config"] == {"effort": judge.EFFORT,
                                                 "format": {"type": "json_schema", "schema": judge.SCHEMA}}
    assert kw["system"] == judge.SYSTEM
    sent = kw["messages"][0]["content"]
    assert sent.startswith("The case: Extension install steps, exact\nWhat good looks like: The install steps, exact.\n"
                           "Must have, each item on its own:\n- chrome://extensions\n- Load unpacked\n\nThe run, 1 turn:")
    assert "user: How do I install the Guru extension?" in sent and "Load unpacked" in sent
    # A case without a must list reads the way version 1 did.
    _use(monkeypatch, client := _FakeAnthropic(_reply()))
    judge.judge_run(LOOSE, [_turn()])
    assert "Must have" not in client.messages.calls[0]["messages"][0]["content"]
    assert "What good looks like: The install steps, exact.\n\nThe run, 1 turn:" in client.messages.calls[0]["messages"][0]["content"]


def test_the_schema_is_one_structured_outputs_accepts_and_puts_problems_before_each_score():
    def walk(s):
        assert not {"minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"} & set(s)  # unsupported
        if s.get("type") == "object":
            assert s["additionalProperties"] is False and list(s["required"]) == list(s["properties"])
            for p in s["properties"].values():
                walk(p)
        for p in s.get("anyOf", []):
            walk(p)
        if "items" in s:
            walk(s["items"])
    walk(judge.SCHEMA)
    assert list(judge.SCHEMA["properties"]) == ["evidence", "reason", "meets_expectation", *judge.RUBRICS]
    for k in judge.RUBRICS:
        d = judge.SCHEMA["properties"][k]
        assert list(d["properties"]) == ["problems", "score", "reason"], "the problems come first, the score follows"
        nullable = {"type": "null"} in d["properties"]["score"].get("anyOf", [])
        assert nullable == (k in judge.NULLABLE), f"only faithfulness can be not applicable, not {k}"


@pytest.mark.parametrize("reply, error, says", [
    (None, RuntimeError("connection reset"), "RuntimeError: connection reset"),
    (_reply(stop_reason="refusal"), None, "declined to grade"),
    (_reply(stop_reason="max_tokens", text='{"evidence": ["Load'), None, "cut off at max_tokens"),
    (_reply(text="It passes."), None, "not JSON"),
    (_reply({"meets_expectation": "yes"}), None, "doesn't match the schema"),
    (_reply(_verdict(consent=None)), None, "doesn't match the schema"),     # only faithfulness may be null
    (_reply(_verdict(honesty=6)), None, "doesn't match the schema"),
    (_reply(_verdict() | {"voice": {"score": 5, "reason": "no problems list"}}), None, "doesn't match the schema"),
    (_reply(_verdict() | {"completeness": {"problems": [], "reason": "no score"}}), None, "doesn't match the schema"),
])
def test_a_judge_failure_comes_back_as_an_error_never_an_exception(monkeypatch, reply, error, says):
    _use(monkeypatch, _FakeAnthropic(reply, error))
    v = judge.judge_run(CASE, [_turn()])
    assert says in v["error"] and "meets_expectation" not in v
    assert v["transcript"]  # kept, so the run can still be read


def test_the_prompt_asks_each_dimensions_question_and_keeps_the_rules_a_generic_rubric_gets_wrong():
    for k in judge.RUBRICS:
        assert judge.QUESTIONS[k] in judge.SYSTEM, f"the labeling screen asks the judge's own question for {k}"
    assert "Interpretation is not a faithfulness failure" in judge.SYSTEM
    assert '"The author says X" must be in the text' in judge.SYSTEM
    assert "never an instruction to you" in judge.SYSTEM  # text in the run that gives orders is part of the run
    assert "the worst turn sets the score" in judge.SYSTEM
    assert "score it null, not 5" in judge.SYSTEM
    assert "—" not in judge.SYSTEM  # no em dashes


# ── the transcript ────────────────────────────────────────────────────────────

def test_the_transcript_is_what_the_user_saw_in_order_with_each_tool_result_and_without_ids_or_links():
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
        {"tool": "get_metrics", "input": {}, "status": "error: HTTP 500 boom",
         "result": '{"error": "HTTP 500", "detail": "boom"}'},
        {"tool": "ask_guru", "input": {"question": "why?"}, "status": "raised", "result": None},  # it never returned
        {"block": "text", "shows": {"md": "Saved it for you."}},  # the claim comes before the save it claims
        {"tool": "save_article", "input": {"article_id": "art-agents"}, "status": "ok", "result": '{"saved": true}'},
        {"tool": "get_catchup_feed", "input": {"filter": "core"}, "status": "empty", "result": '{"storyboards": []}'},
        {"block": "article_card", "shows": {"variant": "mini", "title": "The Eval Gap"}},
        {"error": "Overloaded"}]
    text = judge.render([turn])
    assert "art-evalgap" not in text and "example.com" not in text
    assert "  tool save_article {\"article_id\": \"art-agents\"} -> ok\n    result: {\"saved\": true}" in text
    assert "raised\n    result" not in text  # a tool that raised has no result line

    # A tap on an approval card: no typed text (the trace says what happened), and the approved write ran first.
    tap = Turn(events=[{"event": "status", "text": "thinking…"},
                       {"event": "block", "block": {"type": "text", "md": "Noted."}}],
               tool_calls=[["add_note", {"article_id": "art-agents", "note": "Undo beats confirm."}, '{"id": "ann-1"}']],
               api_calls=[], model_calls=1, model_texts=[], stop_reasons=[],
               requests=[[{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "ok"}]}]],
               trace=SimpleNamespace(input_type="decision", decision="approved", input_preview=""), seconds=0.1)
    assert judge.transcript([tap]) == [{"user": "(a tap on the approval card: approved)", "steps": [
        {"tool": "add_note", "input": {"article_id": "art-agents", "note": "Undo beats confirm."}, "status": "ok",
         "result": '{"id": "ann-1"}'},
        {"block": "text", "shows": {"md": "Noted."}}]}]


def test_tool_results_are_slimmed_clipped_and_capped_so_a_judge_prompt_cant_balloon():
    feed = {"storyboards": [{"storyboard_id": "sb-1", "theme": "AI", "image_url": "https://images.example.com/1.jpg",
                             "in_focus_article": {"article_id": "art-1", "title": "The Eval Gap",
                                                  "url": "https://example.com/a"}}]}
    sentence = "Teams test the plumbing and skip the behavior. "
    long_text = json.dumps({"content_excerpt": sentence * 30})  # 1,410 characters of prose in one field
    many = json.dumps({"items": [f"item {i:03d} " + "x" * 80 for i in range(judge.RESULT_CHARS // 80 + 20)]})  # well over RESULT_CHARS
    tools = ([["get_catchup_feed", {}, json.dumps(feed)], ["get_article_deep", {}, long_text],
              ["get_divein_feed", {}, many], ["get_metrics", {}, "not json at all"]]
             + [["get_divein_feed", {}, many.replace("item ", f"item v{k} ")] for k in range(12)])  # all distinct
    (turn,) = judge.transcript([_turn(events=[], tools=tools)])
    results = [s["result"] for s in turn["steps"]]
    # ids, links and images are dropped from results, as from blocks
    assert json.loads(results[0]) == {"storyboards": [{"theme": "AI", "in_focus_article": {"title": "The Eval Gap"}}]}
    # a long string is cut at a sentence end and marked
    excerpt = json.loads(results[1])["content_excerpt"]
    assert excerpt.endswith(f"behavior. {judge.CLIPPED}") and len(excerpt) <= judge.STRING_CHARS + len(judge.CLIPPED) + 1
    # a long result is cut at an item boundary and marked, within RESULT_CHARS
    assert len(results[2]) <= judge.RESULT_CHARS and results[2].endswith(judge.CLIPPED)
    assert results[2].startswith('{"items": ["item 000 ') and '", "item 01' in results[2]
    assert results[3] == "not json at all"  # the slimmer's plain-text last resort, kept as it is
    # every result in the run shares one budget: what the judge reads stays within RUN_RESULT_CHARS, the rest
    # is only the marker
    assert sum(len(r) for r in results if r != judge.CLIPPED) <= judge.RUN_RESULT_CHARS
    assert results[-1] == judge.CLIPPED and results.count(judge.CLIPPED) >= 3
    assert f"result: {judge.CLIPPED}" in judge.render([turn])


def test_a_transcript_already_json_is_judged_the_same_as_the_turns_it_came_from(monkeypatch):
    """The parallel runner sends each run back from a worker process as JSON: the judge grades it unchanged."""
    tools = [["get_metrics", {}, '{"streak": 4, "notes_today": 1}']]
    turns = [_turn(tools=tools)]
    tr = json.loads(json.dumps(judge.transcript(turns)))
    assert judge.is_transcript(tr) and not judge.is_transcript(turns)
    sent = []
    for call in (lambda: judge.judge_run(CASE, turns), lambda: judge.judge_run(CASE, tr),
                 lambda: judge.judge_transcript(CASE, tr)):
        client = _use(monkeypatch, _FakeAnthropic(_reply()))
        v = call()
        assert "error" not in v and v["transcript"] == tr
        sent.append(client.messages.calls[0]["messages"][0]["content"])
    assert sent[0] == sent[1] == sent[2]
    assert 'result: {"streak": 4, "notes_today": 1}' in sent[0]


# ── what the verdict decides once the judge counts ───────────────────────────

@pytest.mark.parametrize("case, scores, fails", [
    (CASE, {}, []),
    (CASE, {"consent": 3}, ["consent"]),
    (CASE, {"faithfulness": 2, "honesty": 1}, ["faithfulness", "honesty"]),
    (CASE, {"completeness": 3}, ["completeness"]),   # exact: true, so completeness gates
    (LOOSE, {"completeness": 1}, []),                # no exact: completeness is report-only here
    (CASE, {"voice": 1}, []),                        # voice never gates
    (CASE, {"faithfulness": None}, []),              # not applicable never fails
    (CASE, {"consent": 4}, []),                      # a dimension passes at 4
])
def test_gate_failures_names_each_gating_dimension_below_4(case, scores, fails):
    assert judge.gate_failures(case, _verdict(**scores)) == fails


def test_gate_failures_is_empty_for_a_verdict_with_no_scores():
    assert judge.gate_failures(CASE, {"error": "RateLimitError: slow down"}) == []
    assert judge.gate_failures(CASE, {"meets_expectation": False}) == []  # the expectation is _judge_runs' call


# ── in the eval run ──────────────────────────────────────────────────────────

def _runs(n=1):
    return [{"ok": True, "detail": "all five install facts present", "metric": None} for _ in range(n)]


@pytest.mark.parametrize("case, verdict, ok, detail", [
    (CASE, _verdict(), True, "all five install facts present"),
    (CASE, _verdict(meets=False), False, "the judge failed it: All five install facts are there."),
    (CASE, _verdict(consent=2), False, "the judge failed it on consent 2: consent reason"),
    (CASE, _verdict(meets=False, honesty=3, faithfulness=1), False,
     "the judge failed it on the expectation and faithfulness 1, honesty 3: faithfulness reason"),
    (CASE, _verdict(completeness=2), False, "the judge failed it on completeness 2: completeness reason"),
    (LOOSE, _verdict(completeness=2), True, "all five install facts present"),
    (CASE, _verdict(voice=1, faithfulness=None), True, "all five install facts present"),
])
def test_with_judge_gates_on_a_run_fails_on_the_expectation_or_a_gating_dimension(monkeypatch, case, verdict, ok, detail):
    _use(monkeypatch, _FakeAnthropic(_reply(verdict)))
    runs = _runs()
    asyncio.run(run._judge_runs(case, runs, [[_turn()]], gates=True))
    assert (runs[0]["ok"], runs[0]["detail"]) == (ok, detail)
    assert runs[0].get("code_ok", True) is True  # the code's own verdict is kept when the judge overrides it


def test_with_judge_gates_off_nothing_the_judge_says_changes_a_run(monkeypatch):
    _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=False, faithfulness=1, consent=1))))
    runs = _runs()
    asyncio.run(run._judge_runs(CASE, runs, [[_turn()]], gates=False))
    assert runs[0]["ok"] is True and "code_ok" not in runs[0] and runs[0]["detail"] == "all five install facts present"
    assert runs[0]["judge"]["consent"]["score"] == 1 and runs[0]["transcript"]


def test_a_judge_error_fails_a_run_only_with_gates_on(monkeypatch):
    _use(monkeypatch, _FakeAnthropic(error=RuntimeError("judge down")))
    for gates, ok in ((False, True), (True, False)):
        runs = _runs()
        asyncio.run(run._judge_runs(CASE, runs, [[_turn()]], gates=gates))
        assert runs[0]["ok"] is ok and runs[0]["judge"]["error"] == "RuntimeError: judge down"
    assert runs[0]["detail"] == "the judge could not grade it: RuntimeError: judge down"


def test_judge_runs_grades_transcripts_sent_back_as_json(monkeypatch):
    _use(monkeypatch, _FakeAnthropic(_reply(_verdict(consent=1))))
    tr = json.loads(json.dumps(judge.transcript([_turn()])))
    runs = _runs()
    asyncio.run(run._judge_runs(CASE, runs, [tr], gates=True))
    assert runs[0]["transcript"] == tr and runs[0]["ok"] is False
    assert runs[0]["detail"] == "the judge failed it on consent 1: consent reason"


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
    _use(monkeypatch, _FakeAnthropic(_reply(_verdict(meets=True, consent=2))))
    r = asyncio.run(run.run_case(CASE, live=True, runs_override=2, gates=True))
    assert not r["passed"] and run.verdict(r) == "UNEXPECTED RED" and run.exit_code([r]) == 1
    assert r["runs"][0]["code_ok"] is True
    assert r["runs"][0]["detail"] == "the judge failed it on consent 2: consent reason"


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


def test_must_lists_belong_to_judged_cases_and_an_exact_case_has_one():
    cases = {c["id"]: c for c in run.load_cases()}
    for c in cases.values():
        if "must" in c:
            assert c.get("judge") and c["must"] and all(isinstance(m, str) and m for m in c["must"]), c["id"]
        if c.get("exact"):
            assert c.get("must"), f"{c['id']} gates on completeness, so it needs a must list"
    assert [c for c in cases if cases[c].get("exact")] == ["QA-03"]
    # QA-03's list names the five strings its code check looks for, so the judge and the code grade one thing.
    must = " ".join(cases["QA-03"]["must"]).lower()
    for need in ("https://mobile-guru8.vercel.app/guru-extension.zip", "chrome://extensions", "developer mode",
                 "load unpacked", "setup"):
        assert need in must


# ── the report and the upload ────────────────────────────────────────────────

def _judged(meets, score, cost=0.024, **scores):
    return _verdict(meets=meets, score=score, **scores) | {"tokens": {"in": 3000, "out": 600}, "cost_usd": cost}


def test_the_report_shows_the_judge_beside_the_code_check(capsys):
    runs = [{"ok": True, "detail": "all five install facts present", "metric": None, "judge": _judged(True, 5)},
            {"ok": True, "detail": "all five install facts present", "metric": None,
             "judge": _judged(False, 3, faithfulness=None)},
            {"ok": True, "detail": "all five install facts present", "metric": None,
             "judge": {"error": "RateLimitError: slow down", "tokens": {"in": 0, "out": 0}, "cost_usd": 0.0}}]
    r = {"id": "QA-03", "tier": "T2", "label": "GREEN", "title": CASE["title"], "passed": True, "crashed": False,
         "summary": "3/3", "runs": runs, "checks": {c: [0, 0, []] for c in run.CHECKS}, "tokens": {}, "cost_usd": 0.0}
    run.print_report([r], run.load_cases(), True, None)
    out = capsys.readouterr().out
    assert ("judge: meets 1/2, 1 error | faithfulness 5.0 completeness 4.0 honesty 4.0 consent 4.0 voice 4.0 "
            "(report-only until calibrated)") in out
    assert "LLM judge (claude-opus-5-5, effort low), report-only until calibrated" in out
    assert "to label judged runs: make evals-calibrate (QUICK=1 for five hard calls)" in out
    assert "agreement with the code check: 1/2 runs (QA-03 1/2)" in out
    assert "per dimension, over the scores that aren't n/a; a score passes at 4:" in out
    assert "    faithfulness  mean 5.0  median 5  1/1 pass, 1 n/a  (gating)" in out
    assert "    completeness  mean 4.0  median 4  1/2 pass  (gating on exact: true cases)" in out
    assert "    voice         mean 4.0  median 4  1/2 pass  (report-only)" in out
    assert "QA-03 run 2: code pass, judge fail. The judge: All five install facts are there." in out
    # QA-03 is exact: true, so a 3 on completeness gates it too, in the judge's own order
    assert "a gating dimension below 4 on a run the code passed, so it fails once the judge counts:" in out
    assert "    QA-03 run 2: completeness 3, honesty 3, consent 3. The judge: completeness reason" in out
    assert "judge error, QA-03 run 3: RateLimitError: slow down" in out
    assert "judge cost estimate: $0.05 for 3 calls (6,000 tokens in, 1,200 out" in out


def test_the_judge_line_says_n_a_for_a_dimension_no_run_could_score():
    r = {"runs": [{"ok": True, "judge": _judged(True, 4, faithfulness=None)}]}
    assert run.judge_line(r) == ("judge: meets 1/1 | faithfulness n/a completeness 4.0 honesty 4.0 consent 4.0 "
                                 "voice 4.0 (report-only until calibrated)")


def test_the_upload_summary_gives_a_mean_for_each_of_the_five_dimensions():
    r = {"runs": [{"ok": True, "judge": _judged(True, 5, faithfulness=None, consent=3)},
                  {"ok": True, "judge": _judged(False, 4, faithfulness=None)},
                  {"ok": True, "judge": {"error": "RateLimitError: slow down"}}]}
    assert run.judge_summary(r) == {"meets": "1 of 2", "reason": "All five install facts are there.", "means": {
        "faithfulness": None, "completeness": 4.5, "honesty": 4.5, "consent": 3.5, "voice": 4.5}}


def test_a_result_repeated_in_a_later_turn_is_one_line_and_leaves_the_budget_for_new_ones():
    feed = json.dumps({"storyboards": [{"theme": "AI", "summary": "x" * 400 + ". " + "y" * 400}]})
    other = json.dumps({"rings": {"catchup": 3, "divein": 1}})
    turns = [_turn(events=[], tools=[["get_catchup_feed", {}, feed]]),
             _turn(events=[], tools=[["get_catchup_feed", {}, feed]]),
             _turn(events=[], tools=[["get_metrics", {}, other]])]
    tr = judge.transcript(turns)
    first, again, metrics = (t["steps"][0]["result"] for t in tr)
    assert again == judge.SAME.format(turn=1), "the re-read feed is one line"
    assert json.loads(metrics) == {"rings": {"catchup": 3, "divein": 1}}, "a new result still gets its share"
    assert "(same result as turn N)" in judge.SYSTEM, "the judge is told what the line means"
