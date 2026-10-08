"""
Eval runs from the terminal - for Claude Code and for a person. Same data as the admin
Issues tab's Eval runs (app/routes/admin_issues.py, GUR-282): every uploaded run, newest
first, labeled as what it is (live or offline, whole or partial, and how it started), its
score against the previous comparable run, the gate for a whole live run, the counts and
the judge's read on each dimension; then when the next scheduled run is due. show prints
one run in full: its header, the runs where the judge and the code disagree, and its cases.

    cd backend
    venv/bin/python scripts/eval_runs.py list [--limit 20] [--prod] [--json]
    venv/bin/python scripts/eval_runs.py show <run id> [--prod] [--json]

--prod reads production through the admin API: set ADMIN_API_KEY in your shell
(and GURU_API_URL to point somewhere other than production). The key is sent as
a header and never printed. Without --prod it reads the local database.
"""
import argparse
import asyncio
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from traces import PROD_API, TAG, _when  # noqa: E402  (same folder: one look for every readout)

# A run's cases, in the order the detail groups them (admin_issues._group).
GROUPS = (("regressions", "Regressions and crashes"), ("red_as_labeled", "Red, as labeled (flaky ones too)"),
          ("ok", "OK (NOW GREEN too)"))
# A row's counts in words: the verdict, then how one case and several are said.
COUNTS = (("ok", "ok", "ok"), ("red_as_labeled", "red as labeled", "red as labeled"),
          ("regression", "regression", "regressions"), ("flaky", "flaky", "flaky"), ("crashed", "crashed", "crashed"))
# Which side failed a run the judge and the code disagree on.
SPLIT = {"judge": "the code passed it, the judge failed it", "code": "the code failed it, the judge passed it"}


# ── data sources ─────────────────────────────────────────────────────────────

def _remote(path, params=None):
    import httpx
    key = os.getenv("ADMIN_API_KEY")
    if not key:
        sys.exit("ADMIN_API_KEY is not set in this shell. Add it to your shell profile (never commit it).")
    base = os.getenv("GURU_API_URL", PROD_API).rstrip("/")
    r = httpx.get(f"{base}{path}", params=params, headers={"X-Admin-Key": key}, timeout=60)
    if r.status_code in (401, 403):
        sys.exit(f"Refused ({r.status_code}): the key does not match ADMIN_API_KEY on the server.")
    if r.status_code in (404, 405):
        sys.exit("Not found: no eval run with that id on this server." if path != "/admin/eval-runs"
                 else "Not found: Eval runs aren't deployed on this server yet.")
    r.raise_for_status()
    return r.json()


def _local(run_id=None, limit=20):
    """The admin routes themselves, on the local database, so both readouts match."""
    from fastapi import HTTPException
    from app.db.database import SessionLocal
    from app.routes import admin_issues as ai
    db = SessionLocal()
    try:
        if run_id:
            return asyncio.run(ai.eval_run_detail(run_id=run_id, db=db, _reader=None))
        return asyncio.run(ai.list_eval_runs(limit=limit, db=db, _reader=None))
    except HTTPException as e:  # an unknown run id
        sys.exit(f"{e.detail}.")
    except Exception as e:
        if "eval_runs" in str(e):
            sys.exit("This database has no eval_runs table, or not this version's columns. Start the backend once, "
                     "then retry.")
        raise
    finally:
        db.close()


# ── printing ─────────────────────────────────────────────────────────────────

def _whole(x):
    """A score in whole points, halves up, as the eval runner prints it and the app shows it."""
    return int(math.floor(x + 0.5))


def _plural(n, word):
    return f"{n} {word}{'s' if n != 1 else ''}"


def print_schedule(s):
    if not s:
        print("Next scheduled run: none set (EVAL_SCHEDULE on the server)")
        return
    print(f"Next scheduled run: {_when(s['next_run_at'])}, {s['text']}, on {s['runner']}")


def score_line(r):
    """The score against the previous comparable run, then each weighted area with its change."""
    if r.get("score") is None:
        return "score n/a (uploaded without one)"
    prev = r.get("compared_with")
    vs = (f", {r['score_delta']:+d} since {_when(prev['run_at'])}" if prev
          else ", no earlier comparable run")
    areas = [f"{a['label']} {'n/a' if a['score'] is None else _whole(a['score'])}"
             + (f" ({a['delta']:+d})" if a.get("delta") else "") for a in r.get("score_areas") or []]
    return f"score {_whole(r['score'])}/100{vs}" + (f"  {' · '.join(areas)}" if areas else "")


def judge_line(j):
    """The judge across the run: how many runs it graded, its agreement with the code, each dimension's mean
    (under the pass mark said so, n/a counts beside it) and which dimensions gate once it is calibrated."""
    head = f"judge: {_plural(j['judged_runs'], 'run')}"
    if j.get("agreement"):
        head += f", agrees with the code on {j['agreement']['agree']} of {j['agreement']['of']}"
    if j.get("errors"):
        head += f", {_plural(j['errors'], 'error')}"
    dims = []
    for k, mean in j["means"].items():
        na = (j.get("na") or {}).get(k)
        text = f"{k} {'n/a' if mean is None else format(mean, '.1f')}"
        if mean is not None and mean < j["pass_at"]:
            text += f" under {j['pass_at']}"
        if mean is not None and na:
            text += f" ({na} n/a)"
        dims.append(text)
    return f"{head} | {' · '.join(dims)}; gating {', '.join(j['gating'])}"


def print_run(r, gate_run_id=None):
    labels = " · ".join(("live" if r["live"] else "offline", r["scope"], r["trigger"]))
    mark = "  [gate]" if r["id"] == gate_run_id else ""
    print(f"  {_when(r['run_at'])}  {labels}  build {r['build_sha']}  prompt {r['prompt_version']}  "
          f"{_plural(r['n_cases'], 'case')}{mark}")
    print(f"      {score_line(r)}")
    if r.get("areas_down"):
        print(f"      [{TAG['warn']}] down 5 or more: "
              + ", ".join(f"{a['label']} {a['was']} to {a['now']} ({a['delta']:+d})" for a in r["areas_down"]))
    g = r.get("gate")
    if g:
        why = "; ".join(x["text"] if x["kind"] == "safety" else f"{x['kind']}: {x['text']}"
                        for x in g["reasons"] if not x["ok"])
        tag = TAG["bad"] if g["state"] == "blocked" else TAG["ok"]
        print(f"      [{tag}] gate: {g['state'].upper()}" + (f"  {why}" if why else ""))
    counts = r["counts"]
    print("      cases: " + ", ".join(f"{counts[k]} {one if counts[k] == 1 else many}" for k, one, many in COUNTS))
    if r.get("judge"):
        print(f"      {judge_line(r['judge'])}")


def print_list(data):
    n, total = len(data["runs"]), data["total"]
    print(f"Eval runs: the newest {n} of {total} kept, newest first. The ship gate reads the run marked [gate], "
          "the newest whole live one.")
    print_schedule(data.get("schedule"))
    for r in data["runs"]:
        print()
        print_run(r, data.get("gate_run_id"))
        print(f"      next: make eval-runs ID={r['id']}")


def print_detail(r):
    print(f"Eval run {r['id']}")
    print_run(r)
    split = (r.get("judge") or {}).get("disagreements") or []
    if split:
        print("      judge and code disagree, the runs to read first:")
        for d in split:
            where = f"{d['case_id']} run {d['run']}" if d.get("run") else d["case_id"]
            print(f"        {where}: " + (f"{SPLIT[d['failed']]}. " if d.get("failed") in SPLIT else "")
                  + f"The judge: {d['reason']}")
    for key, title in GROUPS:
        cases = r["cases"][key]
        if not cases:
            continue
        print(f"\n{title}")
        for c in cases:
            print(f"  {c['id']:<8} {c['verdict']:<15} {c['n_passed']} of {c['n_runs']}  {c.get('area') or '-'}  "
                  f"{c['title']}")
            if key != "ok":
                print(f"      what happened: {c['what_happened']}")
                for field in ("why", "fix"):
                    if c.get(field):
                        print(f"      {field}: {c[field]}")
            j = c.get("judge")
            if j:
                means = " · ".join(f"{k} {'n/a' if v is None else format(v, '.1f')}" for k, v in j["means"].items())
                print(f"      judge: meets {j['meets']} | {means}"
                      + ("; exact, so completeness gates it too" if c.get("exact") else ""))
            if key != "ok":
                print(f"      next: make evals CASE={c['id']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["list", "show"])
    ap.add_argument("run_id", nargs="?", help="show: the run's id, from the list")
    ap.add_argument("--limit", type=int, default=20, help="list: how many runs, newest first (up to 50)")
    ap.add_argument("--prod", action="store_true", help="read production through the admin API")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.command == "show" and not a.run_id:
        ap.error("show needs the run's id: make eval-runs ID=<id>")
    if not 1 <= a.limit <= 50:
        ap.error("--limit takes 1 to 50")
    if a.command == "show":
        data = _remote(f"/admin/eval-runs/{a.run_id}") if a.prod else _local(run_id=a.run_id)
    else:
        data = _remote("/admin/eval-runs", {"limit": a.limit}) if a.prod else _local(limit=a.limit)
    if a.json:
        print(json.dumps(data, indent=2, default=str))
    elif a.command == "show":
        print_detail(data)
    else:
        print_list(data)


if __name__ == "__main__":
    main()
