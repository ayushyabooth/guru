"""
The Issues tab from the terminal - for Claude Code and for a person. Same data as the
admin Issues tab (app/routes/admin_issues.py): the ship gate from the latest eval run,
then every open issue, whatever found it (evals, beta reports, production), newest first.

    cd backend
    venv/bin/python scripts/issues.py list [--days 7] [--source all|eval|report|production] [--prod] [--json]

--prod reads production through the admin API: set ADMIN_API_KEY in your shell
(and GURU_API_URL to point somewhere other than production). The key is sent as
a header and never printed. Without --prod it reads the local database.
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from traces import PROD_API, TAG, _when  # noqa: E402  (same folder: one look for every readout)

SOURCES = ("all", "eval", "report", "production")
# Where each kind of issue goes next, by its ref.
NEXT = {"eval": "make evals CASE={case_id}", "report": "make report ID={report_id}",
        "production": "make trace ID={trace_id}"}


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
    if r.status_code == 404:
        sys.exit("Not found: the Issues tab isn't deployed on this server yet.")
    r.raise_for_status()
    return r.json()


def _local(days, source):
    """The admin route itself, on the local database, so both readouts match."""
    from app.db.database import SessionLocal
    from app.routes import admin_issues as ai
    db = SessionLocal()
    try:
        return asyncio.run(ai.list_issues(days=days, source=source, db=db, _reader=None))
    except Exception as e:
        missing = next((t for t in ("eval_runs", "bug_reports", "agent_turn_traces") if t in str(e)), None)
        if missing:
            sys.exit(f"No {missing} table on this database yet. Start the backend once, then retry.")
        raise
    finally:
        db.close()


# ── printing ─────────────────────────────────────────────────────────────────

def print_gate(g):
    run = g.get("run")
    where = (f"latest eval run {_when(run['run_at'])}, {'live' if run['live'] else 'offline'}, "
             f"build {run['build_sha']}, prompt {run['prompt_version']}") if run else "no eval run uploaded yet"
    print(f"Ship gate: {g['state'].upper()}  ({where})")
    for r in g["reasons"]:
        if r["ok"]:
            tag = TAG["ok"]
        elif r["kind"] == "reports":
            tag = TAG["warn"]  # open reports never block on their own
        else:
            tag = TAG["info"] if g["state"] == "unknown" else TAG["bad"]
        print(f"  [{tag}] {r['kind']}: {r['text']}")


def print_rows(rows):
    for r in rows:
        print(f"  {_when(r['at'])}  {r['source']:10s}  {r['status']['text']:18s}  {r['title']}")
        if r.get("body"):
            print(f"      {r['body']}")
        extra = [x for x in ((r.get("chip") or {}).get("text"), r.get("footer"), r.get("linear_url")) if x]
        if extra:
            print("      " + "  ·  ".join(extra))
        print(f"      next: {NEXT[r['source']].format(**r['ref'])}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["list"])
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--source", choices=SOURCES, default="all")
    ap.add_argument("--prod", action="store_true", help="read production through the admin API")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    data = _remote("/admin/issues", {"days": a.days, "source": a.source}) if a.prod else _local(a.days, a.source)
    if a.json:
        print(json.dumps(data, indent=2, default=str))
        return
    print_gate(data["gate"])
    c = data["counts"]
    print(f"\n{c['all']} open issue{'s' if c['all'] != 1 else ''}, last {a.days} days "
          f"(eval {c['eval']}, report {c['report']}, production {c['production']})"
          + (f", showing {a.source} only" if a.source != "all" else ""))
    print_rows(data["issues"])


if __name__ == "__main__":
    main()
