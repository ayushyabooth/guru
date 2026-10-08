"""
Run the Guru agent evals and print the report.

    python -m evals.run                    # T1: scripted model, offline, free, seconds
    python -m evals.run --live             # T1 + T2: the live model too (costs cents)
    python -m evals.run --case APR-06,UI-11
    python -m evals.run --live --case QA-03 --runs 1
    python -m evals.run --live --no-judge  # live, without the LLM judge
    python -m evals.run --save-baseline    # make this run the baseline the next runs compare to
    python -m evals.run --no-upload        # keep this run off the admin Issues tab
    python -m evals.run --live --trigger scheduled   # how the run started: scheduled, manual (the default) or demo
    python -m evals.run --live --jobs 1    # one run at a time in this process (a live run uses 4 workers)
    python -m evals.run --upload-latest    # send the saved out/latest.json to the Issues tab again

Exit code 1 when a case labeled GREEN fails (a regression) or a scenario crashes.
A red case that starts passing is reported as NOW GREEN: update its label.

The report opens with the graded eval score (score.py, rubrics.yaml): one number, 0-100, for how good
the answers are, with the safety gate printed beside it and never averaged in.

On a live run, the T2 cases with judge: true are also graded by the LLM judge (judge.py). It is
report-only: it never changes a verdict or the exit code until calibration.yaml has judge_gates: true.

After the report, every run goes to the admin Issues tab (POST /admin/eval-runs on GURU_API_URL,
production by default), sent with ADMIN_API_KEY: each case's verdict, what happened, why and the
fix, and the judge's read of each run it graded, never a transcript. Each run is labeled as what it is
(GUR-282): live or offline, whole or partial (a --case run), and how it started (--trigger). The tab's
ship gate reads only the newest whole live run, so a partial or offline run lands in its Eval runs view
and never makes the gate look clearer than it is. --no-upload keeps a run local. Without the key it
says so in one line. A failed upload is one line too, and never changes the exit code.
"""
import argparse
import asyncio
import hashlib
import json
import logging
import math
import multiprocessing
import os
import statistics
import subprocess
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

import httpx
import yaml

from app.config import settings
from app.routes import admin_issues, agent
from app.services.agent_trace import BUILD_SHA

from evals import calibrate, judge, score
from evals.checks import run_checks
from evals.harness import Harness
from evals.scenarios import SCENARIOS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BASELINE = os.path.join(HERE, "baseline.json")
# Sonnet 5 list prices per million tokens (platform.claude.com pricing, checked 10/7: the $2/$10
# launch price became the standard price), for a cost estimate, not billing.
PRICE = {"in": 2.00, "out": 10.00, "cache_read": 0.20, "cache_write": 2.50}
CHECKS = [f"K{i}" for i in range(1, 13)]
PROD_API = "https://guru-production-1b4f.up.railway.app/api/v1"  # scripts/traces.py's, so make traces reads the same server
UPLOAD_TIMEOUT_S = 15
UPLOAD_TEXT_CHARS = 2000  # per text field; the server takes up to 4,000
UPLOAD_REASON_CHARS = 300  # the judge's one-line reason on one run; the server takes up to 600
LIVE_JOBS = 4  # worker processes on a live run unless --jobs says otherwise; offline runs stay in one process
TRIGGERS = ("scheduled", "manual", "demo")  # how a run started, as the Eval runs view labels it (admin_issues.Trigger)
GIT_TIMEOUT_S = 5  # naming the checkout's commit (build_sha) never holds up a run


def load_cases():
    with open(os.path.join(HERE, "cases.yaml")) as f:
        return yaml.safe_load(f)


def p95(values):
    v = sorted(values)
    return v[max(0, math.ceil(0.95 * len(v)) - 1)] if v else None


def _cost(turns):
    tok = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
    for t in turns:
        tr = t.trace
        if tr is None:
            continue
        tok["in"] += getattr(tr, "tokens_in", 0) or 0
        tok["out"] += getattr(tr, "tokens_out", 0) or 0
        tok["cache_read"] += getattr(tr, "cache_read_tokens", 0) or 0
        tok["cache_write"] += getattr(tr, "cache_write_tokens", 0) or 0
    return tok, sum(tok[k] * PRICE[k] for k in tok) / 1e6


def _run_count(case, runs_override):
    return 1 if case["tier"] == "T1" else (runs_override or case.get("runs", 3))


def _to_judge(case, live, judging):
    """True when the LLM judge grades this case's runs: a live run of a T2 case with judge: true."""
    return bool(judging and live and case["tier"] == "T2" and case.get("judge"))


async def _run_once(case, live, i, want_transcript=False):
    """Run i of a case: its scenario in a fresh Harness. Returns (out, turns). out is JSON-ready, the same
    from this process or a worker's: the run's result, its K1-K12 tallies, its tokens and, with
    want_transcript, the judge's transcript of it. turns are the harness's own; only this process keeps them."""
    h = Harness(live=(case["tier"] == "T2" and live), poison=bool(case.get("poison")))
    with h:
        try:
            ok, detail, turns, metric = await SCENARIOS[case["id"]](h)
        except Exception as e:  # a crashed scenario is a harness failure, never a pass
            ok, detail, turns, metric = None, f"scenario crashed: {type(e).__name__}: {e}", [], None
            traceback.print_exc(file=sys.stderr)
    checks = {c: [0, 0, []] for c in CHECKS}
    if case["tier"] == "T2":
        fetched = []
        for t in turns:
            fetched += t.tool_calls  # provenance: only what the session had fetched by the end of this turn
            for cid, (cok, cdetail) in run_checks(t, list(fetched)).items():
                if cok is None:
                    continue
                checks[cid][1] += 1
                if cok:
                    checks[cid][0] += 1
                else:
                    checks[cid][2].append(f"{case['id']} run {i + 1}: {cdetail}")
    out = {"run": {"ok": ok, "detail": detail, "metric": metric}, "checks": checks,
           "tokens": _cost(turns)[0] if (case["tier"] == "T2" and live) else {}}
    if want_transcript and turns:
        out["transcript"] = judge.transcript(turns)  # what judge_run builds from the turns in this process
    return out, turns


def _aggregate(case, outs, live):
    """A case's result from its runs' outs, in run order, after any judging: the one aggregation both paths
    share, so --jobs 1 and --jobs N print the same report."""
    runs, checks = [o["run"] for o in outs], {c: [0, 0, []] for c in CHECKS}
    tok = {k: 0 for k in PRICE} if (case["tier"] == "T2" and live) else {}
    for o in outs:
        for c, (ok, n, fails) in o["checks"].items():
            checks[c][0] += ok
            checks[c][1] += n
            checks[c][2] += fails
        for k, v in o["tokens"].items():
            tok[k] = tok.get(k, 0) + v
    crashed = any(r["ok"] is None for r in runs)
    if "p95_ms" in case:
        ms = [r["metric"] for r in runs if r["metric"] is not None]
        value = p95(ms)
        # A run that errored is a failed run, however fast its first block was.
        passed = (not crashed) and all(r["ok"] for r in runs) and value is not None and value <= case["p95_ms"]
        stat = "p95" if len(ms) >= 20 else "max"  # under 20 runs, the 95th percentile is the slowest run
        summary = (f"{stat} {value} ms (p50 {sorted(ms)[len(ms) // 2]} ms, n={len(ms)})" if ms else "no timings")
    else:
        n_ok = sum(1 for r in runs if r["ok"])
        passed = (not crashed) and n_ok == len(runs)
        summary = f"{n_ok}/{len(runs)}" if case["tier"] == "T2" else ("PASS" if passed else "FAIL")
    cost = sum(tok[k] * PRICE[k] for k in tok) / 1e6
    return {"id": case["id"], "tier": case["tier"], "label": case["label"], "title": case["title"],
            "passed": passed, "crashed": crashed, "summary": summary, "runs": runs, "checks": checks,
            "tokens": tok, "cost_usd": round(cost, 4)}


async def run_case(case, live, runs_override, judging=True, gates=False, run_at=None):
    """One case in this process, run after run: the --jobs 1 path. judging: grade each live run of a judge:
    true case with the LLM judge. gates: let its verdict count (calibration.yaml judge_gates); without it
    the judge is report-only. run_at names this eval run in the labeling pool."""
    outs, per_run = [], []
    for i in range(_run_count(case, runs_override)):
        out, turns = await _run_once(case, live, i)
        outs.append(out)
        per_run.append(turns)
    if _to_judge(case, live, judging):
        runs = [o["run"] for o in outs]
        await _judge_runs(case, runs, per_run, gates)
        for i, run in enumerate(runs):
            _enqueue(case, i, run, run_at)
    return _aggregate(case, outs, live)


def _enqueue(case, i, run, run_at=None):
    """Hand a judged run to the labeling pool (calibrate.enqueue, GUR-267) as soon as it's judged, so
    make evals-calibrate FOLLOW=1 can label it while the eval run goes on. i counts from 0; the pool
    counts runs from 1. Never raises: labeling is a side road, never a reason to stop the run."""
    enqueue = getattr(calibrate, "enqueue", None)
    if enqueue is None or not isinstance(run.get("judge"), dict) or not run.get("transcript"):
        return
    try:
        enqueue(case, i + 1, run["transcript"], run["judge"], code_ok=run.get("code_ok", run["ok"]), run_at=run_at)
    except Exception as e:
        print(f"Not queued for labeling, {case['id']} run {i + 1}: {type(e).__name__}: {e}"[:200], file=sys.stderr)


async def _run_parallel(cases, live, runs_override, judging=True, gates=False, jobs=LIVE_JOBS, verbose=False,
                        run_at=None, pool=None):
    """Every run of every case in worker processes, up to `jobs` at once: the --jobs N path.

    The Harness patches the agent module and the Anthropic client for its whole process while a scenario
    runs, so two scenarios in one process would see each other's patches. Each run therefore gets a
    worker process and a full Harness of its own, and sends its out back as JSON (_run_once), with the
    judge's transcript when the run is to be judged. The parent judges each run the moment it arrives
    (the judge calls run in threads here, where nothing is patched) and queues it for labeling, then
    aggregates each case as run_case does. pool: an executor to use instead of worker processes (tests)."""
    plan = [(case, i) for case in cases for i in range(_run_count(case, runs_override))]
    own = pool is None
    if own:
        pool = ProcessPoolExecutor(max_workers=max(1, min(jobs, len(plan))), initializer=_init_worker,
                                   initargs=(verbose,), mp_context=multiprocessing.get_context("spawn"))
    outs = {}

    async def one(case, i):
        judged = _to_judge(case, live, judging)
        try:
            out = json.loads(await asyncio.wrap_future(pool.submit(_worker, case, live, i, judged)))
        except Exception as e:  # a worker that died, or a run it couldn't send back, is a crash, never a pass
            out = {"run": {"ok": None, "detail": f"worker crashed: {type(e).__name__}: {e}", "metric": None},
                   "checks": {c: [0, 0, []] for c in CHECKS}, "tokens": {}}
        outs[case["id"], i] = out
        transcript = out.pop("transcript", None)
        if judged:
            await _judge_runs(case, [out["run"]], [transcript], gates)
            _enqueue(case, i, out["run"], run_at)

    try:
        await asyncio.gather(*(one(case, i) for case, i in plan))
    finally:
        if own:
            pool.shutdown(wait=True, cancel_futures=True)
    return [_aggregate(case, [outs[case["id"], i] for i in range(_run_count(case, runs_override))], live)
            for case in cases]


def _init_worker(verbose):
    """Where each worker process starts: quiet the agent's error log as main() does (ERR-03 logs a traceback
    on purpose, and the report already says it)."""
    if not verbose:
        logging.getLogger("app.routes.agent").setLevel(logging.CRITICAL)


def _worker(case, live, i, want_transcript):
    """Run i of a case, in a worker process, sent back as JSON."""
    out, _ = asyncio.run(_run_once(case, live, i, want_transcript))
    return json.dumps(out, default=str)


async def _judge_runs(case, runs, per_run, gates):
    """One judge call per run, in parallel since each takes seconds. Runs only after every scenario
    has finished, so no harness is patching the anthropic client. per_run holds each run's harness
    turns, or its transcript already as JSON (judge_run takes either). Each run keeps its transcript
    (for labeling) and the judge's verdict. With gates on, a run passes only if the code check passes,
    the judge says it meets the expectation, and no gating dimension scores below 4 (judge.gate_failures);
    the detail names what failed, and the code's own verdict stays in code_ok."""
    todo = [i for i, turns in enumerate(per_run) if turns and runs[i]["ok"] is not None]
    verdicts = await asyncio.gather(*(asyncio.to_thread(judge.judge_run, case, per_run[i]) for i in todo))
    for i, v in zip(todo, verdicts):
        run = runs[i]
        run["transcript"] = v.pop("transcript", None)
        run["judge"] = v
        failed = judge.gate_failures(case, v)
        if gates and run["ok"] and (v.get("meets_expectation") is not True or failed):
            run["code_ok"], run["ok"] = True, False
            run["detail"] = _judge_failed(v, failed)


def _judge_failed(v, failed):
    """Why the judge failed a run the code passed, e.g. 'the judge failed it on consent 2: it hid the story'."""
    if "error" in v:
        return f"the judge could not grade it: {v['error']}"
    if not failed:
        return f"the judge failed it: {v.get('reason')}"
    dims = ", ".join(f"{k} {judge.dimension_score(v, k)}" for k in failed)
    also = "the expectation and " if v.get("meets_expectation") is not True else ""
    return f"the judge failed it on {also}{dims}: {v[failed[0]].get('reason') or v.get('reason')}"


def _git(*args):
    """One read-only git command in this checkout, its output, or None when git can't answer (no git, no repo)."""
    try:
        r = subprocess.run(["git", "--no-optional-locks", *args], cwd=HERE, capture_output=True, text=True,
                           timeout=GIT_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def build_sha():
    """The code a run ran, for the Issues tab: Railway's commit where Railway sets one (agent_trace's BUILD_SHA),
    else this checkout's short commit, with "+dirty" when tracked files have uncommitted changes, so a run from
    a laptop names its code too. BUILD_SHA ("local") when git can't say. Read when the run ends."""
    if os.getenv("RAILWAY_GIT_COMMIT_SHA"):
        return BUILD_SHA
    sha = (_git("rev-parse", "--short", "HEAD") or "").strip()
    if not sha:
        return BUILD_SHA
    changed = _git("status", "--porcelain", "--untracked-files=no")
    return sha[:12] + ("+dirty" if changed and changed.strip() else "")


def evals_version():
    """A hash of the eval code itself: a baseline made by other cases, checks or fixtures is not comparable."""
    h = hashlib.sha256()
    for name in ("cases.yaml", "scenarios.py", "checks.py", "fixtures.py", "harness.py"):
        with open(os.path.join(HERE, name), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


def verdict(r):
    expect_pass = r["label"] == "GREEN"
    if r["crashed"]:
        return "CRASHED"
    n_ok = sum(1 for x in r["runs"] if x["ok"])
    if 0 < n_ok < len(r["runs"]):  # anything between all and none is flaky, its own finding
        return f"FLAKY {n_ok}/{len(r['runs'])}" + (", a regression" if expect_pass else "")
    if expect_pass:
        return "ok" if r["passed"] else "UNEXPECTED RED"
    return "NOW GREEN - update the label" if r["passed"] else "red, as labeled"


def exit_code(results):
    """1 when a case labeled GREEN fails (a regression) or a scenario crashes, else 0."""
    bad = [r for r in results if verdict(r) in ("UNEXPECTED RED", "CRASHED") or verdict(r).endswith("a regression")]
    return 1 if bad else 0


def verdict_kind(r):
    """verdict() in one word, for the Issues tab: pass, red_as_labeled, regression, now_green, flaky or
    crashed. regression and crashed are exactly the cases exit_code() counts."""
    v = verdict(r)
    if v == "ok":
        return "pass"
    if v == "CRASHED":
        return "crashed"
    if v == "UNEXPECTED RED" or v.endswith("a regression"):
        return "regression"
    if v.startswith("NOW GREEN"):
        return "now_green"
    return "flaky" if v.startswith("FLAKY") else "red_as_labeled"


def _judged(r):
    """(run number, run) for each run of a case result the judge graded or tried to."""
    return [(n, x) for n, x in enumerate(r["runs"], 1) if x.get("judge")]


def _code_ok(x):
    return bool(x.get("code_ok", x["ok"]))


def _scores(verdicts, k):
    """One dimension's scores over these verdicts, leaving out not applicable (null)."""
    return [s for s in (judge.dimension_score(v, k) for v in verdicts) if s is not None]


def _mean(verdicts, k):
    s = _scores(verdicts, k)
    return round(statistics.mean(s), 1) if s else None


def judge_line(r, gates=False):
    """The line under a judged case, e.g. 'judge: meets 3/3 | faithfulness 4.7 completeness 5.0 ... (...)'.
    A dimension every run scored not applicable shows n/a."""
    js = [x["judge"] for _, x in _judged(r)]
    if not js:
        return None
    ok = [j for j in js if "error" not in j]
    errors = len(js) - len(ok)
    if not ok:
        return f"judge: {errors} error{'s' if errors != 1 else ''}, the first: {js[0]['error'][:120]}"
    meets = f"meets {sum(1 for j in ok if j['meets_expectation'])}/{len(ok)}"
    if errors:
        meets += f", {errors} error{'s' if errors != 1 else ''}"
    means = " ".join(f"{k} {'n/a' if _mean(ok, k) is None else format(_mean(ok, k), '.1f')}" for k in judge.RUBRICS)
    return f"judge: {meets} | {means} ({'counts toward the verdict' if gates else 'report-only until calibrated'})"


def print_judge_section(results, gates=False):
    judged = [(r, n, x) for r in results for n, x in _judged(r)]
    if not judged:
        return
    graded = [(r, n, x) for r, n, x in judged if "error" not in x["judge"]]
    print(f"\nLLM judge ({judge.MODEL}, effort {judge.EFFORT}), "
          + ("counting toward each live verdict" if gates else "report-only until calibrated"))
    try:
        print(f"  calibration: {calibrate.status()}")
    except Exception as e:  # a broken labels file never breaks the report
        print(f"  calibration: {calibrate.LABELS} unreadable ({type(e).__name__}: {e})")
    print(f"  to label judged runs: make evals-calibrate (QUICK=1 for five hard calls); they wait in "
          f"{os.path.relpath(calibrate.POOL, os.path.dirname(HERE))} until labeled")
    errors = len(judged) - len(graded)
    print(f"  judged runs: {len(judged)}" + (f", {errors} error{'s' if errors != 1 else ''}" if errors else ""))
    if graded:
        per_case = {}
        for r, _, x in graded:
            a = per_case.setdefault(r["id"], [0, 0])
            a[0] += x["judge"]["meets_expectation"] == _code_ok(x)
            a[1] += 1
        agree, total = sum(a for a, _ in per_case.values()), sum(n for _, n in per_case.values())
        print(f"  agreement with the code check: {agree}/{total} runs ("
              + ", ".join(f"{cid} {a}/{n}" for cid, (a, n) in per_case.items()) + ")")
        verdicts = [x["judge"] for _, _, x in graded]
        print(f"  per dimension, over the scores that aren't n/a; a score passes at {judge.PASS_AT}:")
        for k in judge.RUBRICS:
            s, na = _scores(verdicts, k), sum(1 for v in verdicts if judge.dimension_score(v, k) is None)
            line = (f"mean {statistics.mean(s):.1f}  median {statistics.median(s):g}  "
                    f"{sum(1 for v in s if v >= judge.PASS_AT)}/{len(s)} pass") if s else "no scores"
            print(f"    {k:<13} {line}" + (f", {na} n/a" if na else "") + f"  ({judge.role(k)})")
        split = [(r, n, x) for r, n, x in graded if x["judge"]["meets_expectation"] != _code_ok(x)]
        if split:
            print("  judge and code disagree, the runs to read first:")
            for r, n, x in split:
                code, jv = ("pass", "fail") if _code_ok(x) else ("fail", "pass")
                print(f"    {r['id']} run {n}: code {code}, judge {jv}. The judge: {x['judge']['reason']}")
                if code == "fail":
                    print(f"      the code: {x['detail']}")
        try:
            cases = {c["id"]: c for c in load_cases()}  # a case's exact: true makes completeness gate it
        except Exception:
            cases = {}
        below = [(r, n, x, judge.gate_failures(cases.get(r["id"], {}), x["judge"]))
                 for r, n, x in graded if _code_ok(x)]
        below = [b for b in below if b[3]]
        if below:
            print("  a gating dimension below 4 on a run the code passed, "
                  + ("so the judge failed it:" if gates else "so it fails once the judge counts:"))
            for r, n, x, dims in below:
                scores = ", ".join(f"{k} {judge.dimension_score(x['judge'], k)}" for k in dims)
                why = x["judge"][dims[0]].get("reason") or x["judge"].get("reason")
                print(f"    {r['id']} run {n}: {scores}. The judge: {why}")
    for r, n, x in judged:
        if "error" in x["judge"]:
            print(f"  judge error, {r['id']} run {n}: {x['judge']['error']}")
    cost = sum(x["judge"].get("cost_usd", 0) for _, _, x in judged)
    tin = sum(x["judge"].get("tokens", {}).get("in", 0) for _, _, x in judged)
    tout = sum(x["judge"].get("tokens", {}).get("out", 0) for _, _, x in judged)
    print(f"  judge cost estimate: ${cost:.2f} for {len(judged)} calls ({tin:,} tokens in, {tout:,} out, "
          f"thinking included) at Opus 5.5 list prices (not billing)")


def eval_score(results, cases, live, gates=False, baseline=None):
    """This run's graded score (score.py), with the baseline scored again under the same weights. baseline:
    the baseline's results by case id, as main() loads them. Never raises: a broken rubrics.yaml comes back
    as {"error": ...}, printed where the score goes, and the verdicts and the exit code stand."""
    try:
        return score.score_run(results, cases, live, judge_counts=gates,
                               baseline=list(baseline.values()) if baseline else None)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def ship_gate(results, cases):
    """This run's ship gate, from the Issues tab's own rule (admin_issues.ship_gate), so the terminal and the
    tab never disagree: blocked while a safety case fails, STAY RED included, or a case regressed or crashed."""
    by_id = {c["id"]: c for c in cases}
    return admin_issues.ship_gate([upload_case(r, by_id.get(r["id"], {})) for r in results])


def score_lines(scored, results, cases):
    """The block the report opens with: the score beside the safety gate, the areas, the counts."""
    if "error" in scored:
        return [f"Guru eval score: not computed ({scored['error']})"]
    try:
        gate = ship_gate(results, cases)
    except Exception as e:  # the score still prints without its gate
        return score.lines(scored) + [f"  safety gate: not computed ({type(e).__name__}: {e})"]
    return score.lines(scored, gate)


def print_report(results, cases, live, baseline, baseline_at=None, gates=False, scored=None):
    """The report. It opens with the graded score (scored, from eval_score; computed here when not given),
    then the cases: STAY REDs first, then the reds, then the greens."""
    by_id = {c["id"]: c for c in cases}
    print()
    for line in score_lines(scored or eval_score(results, cases, live, gates, baseline), results, cases):
        print(line)
    when = datetime.now().strftime("%Y-%m-%d %H:%M")
    print(f"\nGuru agent evals  {when}  model {agent.AGENT_MODEL}  prompt {agent.PROMPT_VERSION}"
          f"  tiers {'T1 + T2 (live)' if live else 'T1 (scripted, offline)'}")
    groups = [("STAY RED, on purpose", lambda r: r["label"].startswith("STAY RED")),
              ("RED TODAY, each fixed by a change on the menu", lambda r: r["label"].startswith("RED")),
              ("GREEN", lambda r: r["label"] == "GREEN")]
    for title, pick in groups:
        rows = [r for r in results if pick(r)]
        if not rows:
            continue
        print(f"\n{title}")
        for r in rows:
            c = by_id[r["id"]]
            res = "CRASHED" if r["crashed"] else r["summary"]
            print(f"  {r['id']:<8} {r['tier']}  {res:<34} {c['title']}")
            jl = judge_line(r, gates)
            if jl:
                print(f"           {jl}")
            v = verdict(r)
            if v != "ok":
                print(f"           -> {v}")
            first_bad = next((x["detail"] for x in r["runs"] if not x["ok"]), None)
            if first_bad and (not r["passed"]):
                print(f"           what happened: {first_bad}")
            if not r["passed"] and not r["crashed"] and c.get("why"):
                print(f"           why: {c['why']}")
                print(f"           fix: {c['fix']}")
            if c.get("note"):
                print(f"           note: {c['note']}")
            if baseline and r["id"] in baseline and baseline[r["id"]]["passed"] != r["passed"]:
                was = "pass" if baseline[r["id"]]["passed"] else "fail"
                print(f"           changed since the baseline (was {was})")
    if not live and baseline:
        base_t2 = sorted((r for r in baseline.values() if r["tier"] == "T2" and r["id"] in by_id),
                         key=lambda r: (not r["label"].startswith("STAY RED"), r["id"]))
        if base_t2:
            print(f"\nLIVE (T2), from the baseline run at {baseline_at}, not re-run (LIVE=1 re-runs them)")
            for r in base_t2:
                c = by_id[r["id"]]
                print(f"  {r['id']:<8} T2  {r['summary']:<34} {c['title']}")
                v = verdict({**r, "label": c["label"]})  # judge the stored result against today's label
                if v != "ok":
                    print(f"           -> {v} ({c['label']})")
    t2 = [r for r in results if r["tier"] == "T2"]
    if t2:
        print("\nK1-K12 on every live turn")
        agg = {c: [0, 0, []] for c in CHECKS}
        for r in t2:
            for c, (ok, n, fails) in r["checks"].items():
                agg[c][0] += ok
                agg[c][1] += n
                agg[c][2] += fails
        line = "  " + "  ".join(f"{c} {ok}/{n}" if n else f"{c} n/a" for c, (ok, n, _) in agg.items())
        print(line)
        for c, (_, _, fails) in agg.items():
            for f in fails[:2]:
                print(f"  {c} failed: {f}")
        cost = sum(r["cost_usd"] for r in t2)
        print(f"\nLive cost estimate: ${cost:.2f} at Sonnet 5 list prices (not billing)")
    print_judge_section(results, gates)
    counts = {}
    for r in results:
        counts[verdict(r)] = counts.get(verdict(r), 0) + 1
    print("\nSummary: " + ", ".join(f"{n} {v}" for v, n in counts.items()))


# ── the admin Issues tab ─────────────────────────────────────────────────────

def judge_summary(r):
    """The judge on one case: how many of the runs it graded it passed, each dimension's mean over the scores
    that aren't n/a (None when there are none), and its reason on the first run where it and the code check
    disagree (the run to read first). None if nothing was judged."""
    judged = [x for _, x in _judged(r)]
    if not judged:
        return None
    graded = [x for x in judged if "error" not in x["judge"]]
    split = next((x["judge"]["reason"] for x in graded if x["judge"]["meets_expectation"] != _code_ok(x)), None)
    return {"meets": f"{sum(1 for x in graded if x['judge']['meets_expectation'])} of {len(graded)}",
            "means": {k: _mean([x["judge"] for x in graded], k) for k in judge.RUBRICS},
            "reason": _clip(split)}


def _clip(text, n=UPLOAD_TEXT_CHARS):
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= n else text[:n - 3].rstrip() + "..."


def judge_runs(r):
    """The judge's read of each run of a case it graded or tried to, for the Eval runs view (GUR-282): the run's
    number, the code check's verdict, the judge's (None when its call failed), its five scores (None: not
    applicable) and its reason on one line, or why the call failed. From these the view counts agreement and
    lists the runs where the two disagree. Never the transcript or the judge's evidence quotes."""
    out = []
    for n, x in _judged(r):
        j = x["judge"]
        failed = "error" in j
        out.append({"run": n, "code_ok": _code_ok(x), "meets": None if failed else bool(j["meets_expectation"]),
                    "scores": None if failed else {k: judge.dimension_score(j, k) for k in judge.RUBRICS},
                    "reason": _clip(" ".join(str(j["error"] if failed else j.get("reason") or "").split()),
                                    UPLOAD_REASON_CHARS) or None})
    return out


def upload_case(r, case, scored=None):
    """One case as the Issues tab keeps it: the verdict, what happened, why and the fix, its graded score
    from scored (eval_score), and the judge's summary with its read of each run (judge_runs). No transcripts.
    A latency case passes on its percentile, not run by run, so there a run counts as passed only when it
    also came in within the case's bar: "0 of 5", never "5 of 5" on a case that failed."""
    first_bad = next((x["detail"] for x in r["runs"] if not x["ok"]), None)  # what the report prints, too
    bar = case.get("p95_ms")
    oks = [x["ok"] if bar is None or not x["ok"] else (x.get("metric") is not None and x["metric"] <= bar)
           for x in r["runs"]]
    summary = judge_summary(r)
    if summary is not None:
        summary["runs"] = judge_runs(r)
    return {"id": r["id"], "title": r["title"], "tier": r["tier"], "area": case.get("area"), "label": r["label"],
            "verdict": verdict_kind(r), "passed": bool(r["passed"]), "n_runs": len(oks),
            "n_passed": sum(1 for ok in oks if ok), "expect": _clip(case.get("expect")),
            "what_happened": _clip(first_bad or r["summary"]), "why": _clip(case.get("why")),
            "fix": _clip(case.get("fix")), "runs": [{"ok": ok} for ok in oks], "judge": summary,
            "score": ((scored or {}).get("cases") or {}).get(r["id"]),
            "exact": bool(case.get("exact"))}  # completeness gates this case too, once the judge counts


def upload_payload(results, cases, live, judging, scored=None, meta=None):
    """The run as POST /admin/eval-runs takes it (app/routes/admin_issues.py, EvalRunIn), with its graded
    score. meta: the run's own header, as out/latest.json keeps it (run_at, build_sha, prompt_version,
    evals_version, judge, scope, trigger), so a run re-sent later (--upload-latest) goes up with its own
    time, versions and labels, not today's. Without it, now, this checkout's versions, and a whole run
    started by hand."""
    by_id, m = {c["id"]: c for c in cases}, meta or {}
    payload = {"run_at": m.get("run_at") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "live": bool(live), "build_sha": m.get("build_sha") or BUILD_SHA,
               "prompt_version": m.get("prompt_version") or agent.PROMPT_VERSION,
               "evals_version": m.get("evals_version") or evals_version(),
               "judge_version": ((m["judge"] or {}).get("version") if "judge" in m
                                 else judge.VERSION if judging else None),
               "scope": m.get("scope") or "whole", "trigger": m.get("trigger") or "manual",
               "cases": [upload_case(r, by_id.get(r["id"], {}), scored) for r in results]}
    sent = score.upload(scored)
    if sent:
        payload["score"] = sent
    return payload


def _refused_field(r):
    """The first field the server refused, from FastAPI's 422 body, e.g. cases.3.title and why."""
    try:
        e = r.json()["detail"][0]
        return f", {'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}"[:200]
    except Exception:
        return ""


def _labels_runs(base, key):
    """False when the server predates GUR-282: it has no GET /admin/eval-runs (404, or 405 beside the POST).
    Such a server ignores a run's scope, stores every run as a whole live one, and its gate reads the newest,
    so a partial or offline run would make that gate look clearer than it is. Any other answer, a refused key
    or a dead connection included, is left to the upload itself to report."""
    try:
        r = httpx.get(f"{base}/admin/eval-runs", params={"limit": 1}, headers={"X-Admin-Key": key},
                      timeout=UPLOAD_TIMEOUT_S)
    except Exception:
        return True
    return r.status_code not in (404, 405)


def upload(results, cases, live, judging, scored=None, meta=None):
    """Send the run to the admin Issues tab, with its score (scored) and its own header and labels (meta, see
    upload_payload). Any run goes: the server's gate reads only the newest whole live one. A partial or
    offline run first checks the server labels runs (_labels_runs), since an older one would gate on it.
    One line either way, saying what was sent, and it never raises: a failed upload can't change the exit
    code. The key goes in a header and is never printed."""
    key = os.getenv("ADMIN_API_KEY")
    if not key:
        print("Not uploaded: set ADMIN_API_KEY to send this run to the Issues tab.")
        return False
    base = os.getenv("GURU_API_URL", PROD_API).rstrip("/")
    try:
        payload = upload_payload(results, cases, live, judging, scored, meta)
        kind = ", ".join(w for w, on in (("offline", not payload["live"]), ("partial", payload["scope"] == "partial"))
                         if on)
        if kind and not _labels_runs(base, key):
            print(f"Not uploaded: {base} doesn't label runs yet, so its gate would read this {kind} run as a whole "
                  f"live one. Deploy the server, then make evals-upload.")
            return False
        r = httpx.post(f"{base}/admin/eval-runs", json=payload, headers={"X-Admin-Key": key},
                       timeout=UPLOAD_TIMEOUT_S)
    except Exception as e:
        print(f"Not uploaded ({base}): {type(e).__name__}: {e}".replace(key, "***")[:300])
        return False
    if r.status_code != 201:
        why = {401: ", the key was refused", 403: ", the key does not match ADMIN_API_KEY on the server",
               404: ", the Issues tab isn't on this server yet", 422: _refused_field(r)}.get(r.status_code, "")
        print(f"Not uploaded: {base} answered HTTP {r.status_code}{why}.")
        return False
    try:
        run_id = r.json().get("id")
    except Exception:
        run_id = None
    print(f"Uploaded to the Issues tab: run {run_id}, {'live' if payload['live'] else 'offline'}, "
          f"{payload['scope']}, {payload['trigger']}, on {base}.")
    return True


def main():
    ap = argparse.ArgumentParser(description="Guru agent evals")
    ap.add_argument("--live", action="store_true", help="also run the T2 cases against the live model")
    ap.add_argument("--case", help="comma-separated case ids to run")
    ap.add_argument("--runs", type=int, help="override the run count for T2 cases")
    ap.add_argument("--save-baseline", action="store_true", help="store this run as the baseline")
    ap.add_argument("--no-judge", action="store_true", help="skip the LLM judge on live runs")
    ap.add_argument("--no-upload", action="store_true", help="keep this run off the admin Issues tab")
    ap.add_argument("--trigger", choices=TRIGGERS, help="how this run started, as the Eval runs view labels it: "
                    "scheduled (the nightly run), manual (the default) or demo")
    ap.add_argument("--jobs", type=int, help=f"worker processes running the cases' runs at once (default "
                    f"{LIVE_JOBS} on a live run, 1 offline); 1 runs them one at a time in this process")
    ap.add_argument("--upload-latest", action="store_true", help="send the run saved in out/latest.json to the "
                    "Issues tab again, without running a case (after a deploy that teaches the server new fields)")
    ap.add_argument("--verbose", action="store_true", help="show the agent's own error logs")
    args = ap.parse_args()
    if args.upload_latest:
        clash = [flag for flag, on in (("--live", args.live), ("--case", args.case), ("--runs", args.runs),
                                       ("--save-baseline", args.save_baseline), ("--no-judge", args.no_judge),
                                       ("--no-upload", args.no_upload), ("--jobs", args.jobs),
                                       ("--trigger", args.trigger)) if on]
        if clash:
            ap.error(f"--upload-latest sends out/latest.json as it is, so it takes no {', '.join(clash)}")
        sys.exit(upload_latest())
    if args.jobs is not None and args.jobs < 1:
        ap.error("--jobs needs 1 or more")
    if not args.verbose:  # ERR-03 makes the route log a traceback on purpose; the report already says it
        logging.getLogger("app.routes.agent").setLevel(logging.CRITICAL)

    cases = load_cases()
    unknown = [c["id"] for c in cases if c["id"] not in SCENARIOS]
    if unknown:
        sys.exit(f"cases without a scenario: {unknown}")
    if args.case:
        want = {x.strip() for x in args.case.split(",")}
        cases = [c for c in cases if c["id"] in want]
        if not cases:
            sys.exit(f"no case matches {sorted(want)}")
    if not args.live:
        skipped = [c["id"] for c in cases if c["tier"] == "T2"]
        cases = [c for c in cases if c["tier"] == "T1"]
        if skipped:
            print(f"Skipping {len(skipped)} live (T2) cases; add --live to run them: {', '.join(skipped)}")
    elif not (settings.ANTHROPIC_API_KEY or "").strip() or settings.ANTHROPIC_API_KEY == "test-key":
        sys.exit("--live needs ANTHROPIC_API_KEY in backend/.env")

    judging = args.live and not args.no_judge
    gates = judging and calibrate.judge_gates()  # only the owner turns this on, in calibration.yaml
    if args.live and args.no_judge and calibrate.judge_gates():
        print("judge_gates is on in calibration.yaml, but --no-judge skips the judge: "
              "these live verdicts are the code check's alone.")
    jobs = args.jobs or (LIVE_JOBS if args.live else 1)
    # When the run started, with its offset: it names the run in the labeling pool, out/latest.json and the
    # Issues tab, so a run sent again later (--upload-latest) keeps its own time.
    run_at = datetime.now().astimezone().isoformat(timespec="seconds")
    t0 = time.perf_counter()
    results = asyncio.run(_run_all(cases, args.live, args.runs, judging, gates, jobs=jobs, verbose=args.verbose,
                                   run_at=run_at))
    baseline, baseline_at = _load_baseline() if not args.save_baseline else (None, None)
    all_cases = load_cases()
    scored = eval_score(results, all_cases, args.live, gates, baseline)
    print_report(results, all_cases, args.live, baseline, baseline_at, gates, scored)
    n = len(results)
    print(f"Ran {n} case{'s' if n != 1 else ''} in {time.perf_counter() - t0:.1f}s"
          + (f", up to {jobs} at a time in worker processes." if jobs > 1 else "."))

    os.makedirs(OUT, exist_ok=True)
    # "live", "scope" and "trigger" label the run on the Issues tab, now and when --upload-latest sends it again.
    payload = {"at": datetime.now().isoformat(timespec="seconds"), "run_at": run_at, "model": agent.AGENT_MODEL,
               "build_sha": build_sha(), "prompt_version": agent.PROMPT_VERSION, "evals_version": evals_version(),
               "live": args.live, "case": args.case or None, "scope": "partial" if args.case else "whole",
               "trigger": args.trigger or "manual",
               "judge": ({"model": judge.MODEL, "version": judge.VERSION, "effort": judge.EFFORT, "gates": gates}
                         if judging else None),
               "score": scored, "results": results}
    with open(os.path.join(OUT, "latest.json"), "w") as f:
        json.dump(payload, f, indent=2, default=str)
    # Judged transcripts wait to be labeled in the pool (out/judged_runs.jsonl), where each run went the
    # moment it was judged (_enqueue); a later run never replaces them.
    if args.save_baseline:  # merge by case id, so a T1-only or --case run never erases the other rows
        old = json.load(open(BASELINE)) if os.path.exists(BASELINE) else {"results": []}
        fresh = {r["id"] for r in results}
        # Transcripts are for labeling, from the pool; the baseline keeps verdicts only.
        stamped = [dict(r, at=payload["at"], evals_version=payload["evals_version"],
                        runs=[{k: v for k, v in x.items() if k != "transcript"} for x in r["runs"]])
                   for r in results]
        base = dict(payload, results=[r for r in old["results"] if r["id"] not in fresh] + stamped)
        base.pop("score", None)  # the merged rows are scored again from their runs on every read
        with open(BASELINE, "w") as f:
            json.dump(base, f, indent=2, default=str)
        print(f"Saved as the baseline: {os.path.relpath(BASELINE)}")
    if not args.no_upload:  # every run, labeled as what it is; the server's gate reads only a whole live one
        upload(results, cases, args.live, judging, scored, payload)
    sys.exit(exit_code(results))


def _load_baseline():
    """(the baseline's results by case id, when it was saved), or (None, None) without a baseline.json."""
    if not os.path.exists(BASELINE):
        return None, None
    with open(BASELINE) as f:
        base = json.load(f)
    return {r["id"]: r for r in base["results"]}, base.get("at")


def _saved_scope(saved, cases):
    """whole or partial, for a run saved in out/latest.json. A file saved before "scope" was recorded is
    partial when it was a --case run ("case"), or, saved before that too, when it lacks a case its kind of
    run would have run (offline, only the T1 cases run)."""
    if saved.get("scope") in ("whole", "partial"):
        return saved["scope"]
    if "case" in saved:
        return "partial" if saved["case"] else "whole"
    ran = {r.get("id") for r in saved.get("results") or []}
    return "whole" if {c["id"] for c in cases if saved.get("live") or c["tier"] == "T1"} <= ran else "partial"


def upload_latest(path=None):
    """--upload-latest: send the run saved in out/latest.json to the Issues tab again without running a
    case, e.g. one kept local with --no-upload, or after a deploy that teaches the server a field the first
    upload lost. Any run goes, labeled as it was saved: live or offline, whole or partial, and how it started.
    It rebuilds the payload with upload_payload (the run's own score, time, versions and labels, never a
    transcript) and sends it with upload(). Returns the run's own exit code, as the run itself did: a failed
    upload never changes it."""
    path = path or os.path.join(OUT, "latest.json")
    if not os.path.exists(path):
        sys.exit(f"Nothing to upload: no {os.path.relpath(path)} yet. Run make evals first.")
    with open(path) as f:
        saved = json.load(f)
    results, cases, live = saved.get("results") or [], load_cases(), bool(saved.get("live"))
    if not saved.get("run_at") and saved.get("at"):  # saved before run_at was: "at" is local time, without its offset
        saved["run_at"] = datetime.fromisoformat(saved["at"]).astimezone().isoformat(timespec="seconds")
    saved["scope"] = _saved_scope(saved, cases)
    saved["trigger"] = saved.get("trigger") if saved.get("trigger") in TRIGGERS else "manual"
    print(f"{os.path.relpath(path)}: the eval run at {saved.get('run_at')}, {'live' if live else 'offline'}, "
          f"{saved['scope']}, {saved['trigger']}, {len(results)} case{'s' if len(results) != 1 else ''}.")
    gates = bool((saved.get("judge") or {}).get("gates"))
    scored = saved.get("score")
    if not isinstance(scored, dict) or "error" in scored:  # saved without a score: grade it now
        scored = eval_score(results, cases, live, gates, _load_baseline()[0])
    upload(results, cases, live, saved.get("judge") is not None, scored, saved)
    return exit_code(results)


async def _run_all(cases, live, runs, judging=True, gates=False, jobs=1, verbose=False, run_at=None):
    """Every case's runs: one at a time in this process (jobs 1, the original way), or in up to `jobs`
    worker processes at once (_run_parallel). Both give the same results, in case order."""
    if jobs > 1:
        return await _run_parallel(cases, live, runs, judging, gates, jobs, verbose, run_at)
    return [await run_case(c, live, runs, judging, gates, run_at) for c in cases]


if __name__ == "__main__":
    main()
