"""
Beta bug reports from the terminal - for Claude Code and for a person. Same data as
the Reports tab in the admin view (app/routes/admin_reports.py).

    cd backend
    venv/bin/python scripts/reports.py list [--days 7] [--status saved|filed|failed] [--traffic real|synthetic|all] [--prod] [--json]
    venv/bin/python scripts/reports.py show <report_id> [--prod] [--json]

--prod reads production through the admin API: set ADMIN_API_KEY in your shell
(and GURU_API_URL to point somewhere other than production). The key is sent as
a header and never printed. Without --prod it reads the local database.

show prints the report's Session context (GUR-277) with the same lines as its
Linear issue, from the same code (app/services/session_context.py).
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from traces import PROD_API, TAG, _s, _when  # noqa: E402  (same folder: one look for both readouts)


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
        sys.exit("Not found: no such report, or Report a bug isn't deployed on this server yet.")
    r.raise_for_status()
    return r.json()


def _local(kind, **kw):
    """The admin routes themselves, on the local database, so both readouts match."""
    from fastapi import HTTPException
    from app.db.database import SessionLocal
    from app.routes import admin_reports as ar
    db = SessionLocal()
    try:
        if kind == "list":
            return asyncio.run(ar.list_reports(days=kw["days"], status=kw["status"], traffic=kw["traffic"],
                                               db=db, _reader=None))
        return asyncio.run(ar.report_detail(kw["report_id"], db=db, _reader=None))
    except HTTPException as e:
        sys.exit(str(e.detail))
    except Exception as e:
        if "bug_reports" in str(e):
            sys.exit("No bug_reports table on this database yet. Start the backend once, then retry.")
        raise
    finally:
        db.close()


# ── printing ─────────────────────────────────────────────────────────────────

def print_rows(rows):
    for r in rows:
        filed = r.get("linear_identifier") or "not filed"
        print(f"  {_when(r['created_at'])}  {r['status']:6s}  {r['category']:12s}  {filed:9s}  "
              f"{r.get('user_email') or '?'}  ({r['reference']})")
        print(f"      expected: {r['expected']}")
        if r.get("trace_headline"):
            print(f"      turn: {r['trace_headline']}  (trace {r['trace_id']})")
        elif r.get("trace_id"):
            print(f"      turn: trace {r['trace_id']} (not this user's, or gone)")
        if r.get("hypothesis_summary"):
            print(f"      Claude: {r['hypothesis_summary']}")
        print(f"      id {r['id']}")


def print_report(d):
    r, t, diag = d["report"], d.get("trace"), d.get("diagnosis")
    print(f"Report {r['reference']}  {_when(r['created_at'])}  {r.get('user_email') or r['user_id']}  ({r['traffic']})")
    attempts = f"{r['attempts']} attempt{'s' if r['attempts'] != 1 else ''}"
    print(f"status {r['status']} ({attempts})" + (f"  Linear {r['linear_identifier']} {r['linear_url']}"
                                                   if r.get("linear_identifier") else ""))
    if r.get("error"):
        print(f"error: {r['error']}")
    print(f"category {r['category']}, screen {r.get('screen')}, client {r.get('client')}, "
          f"build {r.get('build_sha')}, prompt {r.get('prompt_version')}")
    print(f"\nexpected: {r['expected']}")
    from app.services import session_context as sc  # the Linear issue's own lines, so the two can't drift
    print("\nSession context")
    for line in sc.section_lines(r):
        print(f"  {line}")
    h = r.get("hypothesis")
    if h and h.get("error"):
        print(f"\nClaude's triage failed: {h['error']}")
    elif h:
        print(f"\nClaude's hypothesis (confidence {h.get('confidence')}, severity {h.get('severity')}): {h.get('summary')}")
        if h.get("likely_cause"):
            print(f"  likely cause: {h['likely_cause']}")
        for e in h.get("evidence") or []:
            print(f"  evidence: {e}")
        if "context_used" in h:
            print(f"  used: {sc.used_line(h['context_used'], sc.labels(r))}")
        if h.get("suggested_eval"):
            print(f"  eval to add: {h['suggested_eval']}")
    if t:
        print(f"\nThe reported turn  [{TAG.get(diag['severity'], diag['severity'])}] {diag['headline']}")
        print(f"  outcome {t['outcome']}, first content {_s(t['first_block_ms'])}, total {_s(t['total_ms'])}")
        print(f"  in depth: make trace ID={t['id']}   (or scripts/traces.py show {t['id']} for the local database)")
    elif r.get("trace_id"):
        print(f"\nThe reported turn {r['trace_id']} isn't this user's, or is gone.")
    else:
        print("\nNo agent turn attached (reported from the Home screen).")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["list", "show"])
    ap.add_argument("report_id", nargs="?")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--status", choices=["saved", "filed", "failed"])
    ap.add_argument("--traffic", choices=["real", "synthetic", "all"], default="real")
    ap.add_argument("--prod", action="store_true", help="read production through the admin API")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.command == "show" and not a.report_id:
        ap.error("show needs a report id")
    if a.prod:
        data = (_remote("/admin/reports", {"days": a.days, "traffic": a.traffic, **({"status": a.status} if a.status else {})})
                if a.command == "list" else _remote(f"/admin/reports/{a.report_id}"))
    else:
        data = _local(a.command, days=a.days, status=a.status, traffic=a.traffic, report_id=a.report_id)
    if a.json:
        print(json.dumps(data, indent=2, default=str))
    elif a.command == "list":
        print(f"{data['total']} report{'s' if data['total'] != 1 else ''}, last {a.days} days ({a.traffic})"
              + (f", {a.status} only" if a.status else ""))
        print_rows(data["reports"])
    else:
        print_report(data)


if __name__ == "__main__":
    main()
