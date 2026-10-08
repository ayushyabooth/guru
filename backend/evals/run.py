"""
Run the Guru agent evals and print the report.

    python -m evals.run                    # T1: scripted model, offline, free, seconds
    python -m evals.run --live             # T1 + T2: the live model too (costs cents)
    python -m evals.run --case APR-06,UI-11
    python -m evals.run --live --case QA-03 --runs 1
    python -m evals.run --live --no-judge  # live, without the LLM judge
    python -m evals.run --save-baseline    # make this run the baseline the next runs compare to
    python -m evals.run --no-upload        # keep this run off the admin Issues tab

Exit code 1 when a case labeled GREEN fails (a regression) or a scenario crashes.
A red case that starts passing is reported as NOW GREEN: update its label.

On a live run, the T2 cases with judge: true are also graded by the LLM judge (judge.py). It is
report-only: it never changes a verdict or the exit code until calibration.yaml has judge_gates: true.

After the report, a whole live run goes to the admin Issues tab (POST /admin/eval-runs on GURU_API_URL,
production by default), sent with ADMIN_API_KEY: each case's verdict, what happened, why and the
fix, never a transcript. Without the key it says so in one line. A failed upload is one line too,
and never changes the exit code. An offline run and a --case run stay local: the tab's ship gate
reads a whole live run, and a partial one would make the gate look clearer than it is.
"""
import argparse
import asyncio
import hashlib
import json
import logging
import math
import os
import shutil
import statistics
import sys
import time
import traceback
from datetime import datetime, timezone

import httpx
import yaml

from app.config import settings
from app.routes import agent
from app.services.agent_trace import BUILD_SHA

from evals import calibrate, judge
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


async def run_case(case, live, runs_override, judging=True, gates=False):
    """judging: grade each live run of a judge: true case with the LLM judge. gates: let its verdict count
    (calibration.yaml judge_gates); without it the judge is report-only."""
    fn = SCENARIOS[case["id"]]
    k = 1 if case["tier"] == "T1" else (runs_override or case.get("runs", 3))
    runs, checks, all_turns, per_run = [], {c: [0, 0, []] for c in CHECKS}, [], []
    for i in range(k):
        h = Harness(live=(case["tier"] == "T2" and live), poison=bool(case.get("poison")))
        with h:
            try:
                ok, detail, turns, metric = await fn(h)
            except Exception as e:  # a crashed scenario is a harness failure, never a pass
                ok, detail, turns, metric = None, f"scenario crashed: {type(e).__name__}: {e}", [], None
                traceback.print_exc(file=sys.stderr)
        runs.append({"ok": ok, "detail": detail, "metric": metric})
        per_run.append(turns)
        all_turns += turns
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
    if judging and live and case["tier"] == "T2" and case.get("judge"):
        await _judge_runs(case, runs, per_run, gates)
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
    tok, cost = _cost(all_turns) if (case["tier"] == "T2" and live) else ({}, 0.0)
    return {"id": case["id"], "tier": case["tier"], "label": case["label"], "title": case["title"],
            "passed": passed, "crashed": crashed, "summary": summary, "runs": runs, "checks": checks,
            "tokens": tok, "cost_usd": round(cost, 4)}


async def _judge_runs(case, runs, per_run, gates):
    """One judge call per run, in parallel since each takes seconds. Runs only after every scenario
    has finished, so no harness is patching the anthropic client. Each run keeps its transcript (for
    labeling) and the judge's verdict. With gates on, a run passes only if the code check and the
    judge both pass; the code's own verdict stays in code_ok."""
    todo = [i for i, turns in enumerate(per_run) if turns and runs[i]["ok"] is not None]
    verdicts = await asyncio.gather(*(asyncio.to_thread(judge.judge_run, case, per_run[i]) for i in todo))
    for i, v in zip(todo, verdicts):
        run = runs[i]
        run["transcript"] = v.pop("transcript", None)
        run["judge"] = v
        if gates and run["ok"] and v.get("meets_expectation") is not True:
            run["code_ok"], run["ok"] = True, False
            run["detail"] = (f"the judge could not grade it: {v['error']}" if "error" in v else
                             f"the judge failed it: {v.get('reason')}")


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


def judge_line(r, gates=False):
    """The line under a judged case, e.g. 'judge: meets 3/3 | voice 4.7 honesty 5.0 journey 4.3 (...)'."""
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
    means = " ".join(f"{k} {statistics.mean(j[k]['score'] for j in ok):.1f}" for k in judge.RUBRICS)
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
    print("  to label these runs: make evals-calibrate (they wait in out/latest_judged.json until the next judged run)")
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
        medians = []
        for k in judge.RUBRICS:
            s = [x["judge"][k]["score"] for _, _, x in graded]
            medians.append(f"{k} {statistics.median(s):g} ({sum(1 for v in s if v >= judge.PASS_AT)}/{len(s)} pass)")
        print(f"  rubric medians, a rubric passes at {judge.PASS_AT}: " + ", ".join(medians))
        split = [(r, n, x) for r, n, x in graded if x["judge"]["meets_expectation"] != _code_ok(x)]
        if split:
            print("  judge and code disagree, the runs to read first:")
            for r, n, x in split:
                code, jv = ("pass", "fail") if _code_ok(x) else ("fail", "pass")
                print(f"    {r['id']} run {n}: code {code}, judge {jv}. The judge: {x['judge']['reason']}")
                if code == "fail":
                    print(f"      the code: {x['detail']}")
    for r, n, x in judged:
        if "error" in x["judge"]:
            print(f"  judge error, {r['id']} run {n}: {x['judge']['error']}")
    cost = sum(x["judge"].get("cost_usd", 0) for _, _, x in judged)
    tin = sum(x["judge"].get("tokens", {}).get("in", 0) for _, _, x in judged)
    tout = sum(x["judge"].get("tokens", {}).get("out", 0) for _, _, x in judged)
    print(f"  judge cost estimate: ${cost:.2f} for {len(judged)} calls ({tin:,} tokens in, {tout:,} out, "
          f"thinking included) at Opus 5.5 list prices (not billing)")


def print_report(results, cases, live, baseline, baseline_at=None, gates=False):
    by_id = {c["id"]: c for c in cases}
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
    """The judge on one case: how many of the runs it graded it passed, each rubric's mean, and its reason
    on the first run where it and the code check disagree (the run to read first). None if nothing was judged."""
    judged = [x for _, x in _judged(r)]
    if not judged:
        return None
    graded = [x for x in judged if "error" not in x["judge"]]
    split = next((x["judge"]["reason"] for x in graded if x["judge"]["meets_expectation"] != _code_ok(x)), None)
    return {"meets": f"{sum(1 for x in graded if x['judge']['meets_expectation'])} of {len(graded)}",
            "means": {k: round(statistics.mean(x["judge"][k]["score"] for x in graded), 1) if graded else None
                      for k in judge.RUBRICS},
            "reason": _clip(split)}


def _clip(text, n=UPLOAD_TEXT_CHARS):
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= n else text[:n - 3].rstrip() + "..."


def upload_case(r, case):
    """One case as the Issues tab keeps it: the verdict, what happened, why and the fix. No transcripts.
    A latency case passes on its percentile, not run by run, so there a run counts as passed only when it
    also came in within the case's bar: "0 of 5", never "5 of 5" on a case that failed."""
    first_bad = next((x["detail"] for x in r["runs"] if not x["ok"]), None)  # what the report prints, too
    bar = case.get("p95_ms")
    oks = [x["ok"] if bar is None or not x["ok"] else (x.get("metric") is not None and x["metric"] <= bar)
           for x in r["runs"]]
    return {"id": r["id"], "title": r["title"], "tier": r["tier"], "area": case.get("area"), "label": r["label"],
            "verdict": verdict_kind(r), "passed": bool(r["passed"]), "n_runs": len(oks),
            "n_passed": sum(1 for ok in oks if ok), "expect": _clip(case.get("expect")),
            "what_happened": _clip(first_bad or r["summary"]), "why": _clip(case.get("why")),
            "fix": _clip(case.get("fix")), "runs": [{"ok": ok} for ok in oks], "judge": judge_summary(r)}


def upload_payload(results, cases, live, judging):
    """The run as POST /admin/eval-runs takes it (app/routes/admin_issues.py, EvalRunIn)."""
    by_id = {c["id"]: c for c in cases}
    return {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "live": bool(live),
            "build_sha": BUILD_SHA, "prompt_version": agent.PROMPT_VERSION, "evals_version": evals_version(),
            "judge_version": judge.VERSION if judging else None,
            "cases": [upload_case(r, by_id.get(r["id"], {})) for r in results]}


def _refused_field(r):
    """The first field the server refused, from FastAPI's 422 body, e.g. cases.3.title and why."""
    try:
        e = r.json()["detail"][0]
        return f", {'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}"[:200]
    except Exception:
        return ""


def upload(results, cases, live, judging):
    """Send the run to the admin Issues tab. One line either way, and it never raises: a failed upload
    can't change the exit code. The key goes in a header and is never printed."""
    key = os.getenv("ADMIN_API_KEY")
    if not key:
        print("Not uploaded: set ADMIN_API_KEY to send this run to the Issues tab.")
        return False
    base = os.getenv("GURU_API_URL", PROD_API).rstrip("/")
    try:
        payload = upload_payload(results, cases, live, judging)
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
    print(f"Uploaded to the Issues tab: run {run_id} on {base}.")
    return True


def main():
    ap = argparse.ArgumentParser(description="Guru agent evals")
    ap.add_argument("--live", action="store_true", help="also run the T2 cases against the live model")
    ap.add_argument("--case", help="comma-separated case ids to run")
    ap.add_argument("--runs", type=int, help="override the run count for T2 cases")
    ap.add_argument("--save-baseline", action="store_true", help="store this run as the baseline")
    ap.add_argument("--no-judge", action="store_true", help="skip the LLM judge on live runs")
    ap.add_argument("--no-upload", action="store_true", help="keep this run off the admin Issues tab")
    ap.add_argument("--verbose", action="store_true", help="show the agent's own error logs")
    args = ap.parse_args()
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
    t0 = time.perf_counter()
    results = asyncio.run(_run_all(cases, args.live, args.runs, judging, gates))
    baseline, baseline_at = None, None
    if os.path.exists(BASELINE) and not args.save_baseline:
        with open(BASELINE) as f:
            base = json.load(f)
        baseline, baseline_at = {r["id"]: r for r in base["results"]}, base.get("at")
    print_report(results, load_cases(), args.live, baseline, baseline_at, gates)
    n = len(results)
    print(f"Ran {n} case{'s' if n != 1 else ''} in {time.perf_counter() - t0:.1f}s.")

    os.makedirs(OUT, exist_ok=True)
    payload = {"at": datetime.now().isoformat(timespec="seconds"), "model": agent.AGENT_MODEL,
               "prompt_version": agent.PROMPT_VERSION, "evals_version": evals_version(), "live": args.live,
               "judge": ({"model": judge.MODEL, "version": judge.VERSION, "effort": judge.EFFORT, "gates": gates}
                         if judging else None),
               "results": results}
    with open(os.path.join(OUT, "latest.json"), "w") as f:
        json.dump(payload, f, indent=2, default=str)
    if any(x.get("judge") for r in results for x in r["runs"]):
        # The next T1 run replaces latest.json; the judged transcripts wait here to be labeled.
        shutil.copyfile(os.path.join(OUT, "latest.json"), calibrate.LATEST)
    if args.save_baseline:  # merge by case id, so a T1-only or --case run never erases the other rows
        old = json.load(open(BASELINE)) if os.path.exists(BASELINE) else {"results": []}
        fresh = {r["id"] for r in results}
        # Transcripts are for labeling, from out/latest_judged.json; the baseline keeps verdicts only.
        stamped = [dict(r, at=payload["at"], evals_version=payload["evals_version"],
                        runs=[{k: v for k, v in x.items() if k != "transcript"} for x in r["runs"]])
                   for r in results]
        base = dict(payload, results=[r for r in old["results"] if r["id"] not in fresh] + stamped)
        with open(BASELINE, "w") as f:
            json.dump(base, f, indent=2, default=str)
        print(f"Saved as the baseline: {os.path.relpath(BASELINE)}")
    if args.case and not args.no_upload:
        print("Not uploaded: a --case run covers only some cases, and the Issues tab's gate reads a whole run.")
    elif not args.live and not args.no_upload:
        # An offline run skips every T2 case. Uploaded, it would become the latest run and drop the live
        # reds (INJ-01, STEP-07) off the tab, so the gate would look clearer than it is.
        print("Not uploaded: an offline run skips the live cases, and the Issues tab's gate reads a whole live run.")
    elif not args.no_upload:
        upload(results, cases, args.live, judging)
    sys.exit(exit_code(results))


async def _run_all(cases, live, runs, judging=True, gates=False):
    return [await run_case(c, live, runs, judging, gates) for c in cases]


if __name__ == "__main__":
    main()
