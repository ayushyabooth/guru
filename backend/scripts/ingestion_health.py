"""
Ingestion health from the terminal - for Claude Code and for a person. Same data as
GET /api/v1/admin/ingestion/health (app/services/ingestion_health.py): the verdict and
its reasons first, then each tier against its window, the TIER2_RUN_AT one-off, and
content freshness. Exits 1 when the verdict is failing, so a checklist stops on it.

    cd backend
    venv/bin/python scripts/ingestion_health.py [--prod] [--json]

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

LEVEL_TAG = {"failing": TAG["bad"], "stale": TAG["warn"], "ok": TAG["ok"]}


# ── data sources ─────────────────────────────────────────────────────────────

def _remote(path):
    import httpx
    key = os.getenv("ADMIN_API_KEY")
    if not key:
        sys.exit("ADMIN_API_KEY is not set in this shell. Add it to your shell profile (never commit it).")
    base = os.getenv("GURU_API_URL", PROD_API).rstrip("/")
    r = httpx.get(f"{base}{path}", headers={"X-Admin-Key": key}, timeout=60)
    if r.status_code in (401, 403):
        sys.exit(f"Refused ({r.status_code}): the key does not match ADMIN_API_KEY on the server.")
    if r.status_code == 404:
        sys.exit("Not found: the ingestion health check isn't deployed on this server yet.")
    r.raise_for_status()
    return r.json()


def _local():
    """The admin route itself, on the local database, so both readouts match."""
    from app.db.database import SessionLocal
    from app.routes import ingestion
    db = SessionLocal()
    try:
        return asyncio.run(ingestion.get_ingestion_health(db=db, _reader=None))
    except Exception as e:
        missing = next((t for t in ("ingestion_runs", "articles")
                        if f"no such table: {t}" in str(e) or f'relation "{t}" does not exist' in str(e)), None)
        if missing:
            sys.exit(f"No {missing} table on this database yet. Start the backend once, then retry.")
        raise
    finally:
        db.close()


# ── printing ─────────────────────────────────────────────────────────────────

def print_health(h):
    print(f"Ingestion: {h['verdict'].upper()}  (checked {_when(h['checked_at'])})")
    for r in h["reasons"]:
        print(f"  [{LEVEL_TAG.get(r['level'], r['level'])}] {r['text']}")
    limits = h.get("thresholds") or {}
    for t in h["tiers"].values():
        print(f"\n{t['label']}, window {t['window_hours']}h")
        done = t["last_completed"]
        if done:
            print(f"  last completed  {_when(done['completed_at'])}, {t['age_hours']}h ago: found {done['found']}, "
                  f"ingested {done['ingested']}, rejected {done['rejected']}")
        else:
            print("  last completed  none on record")
        c = t["recent"]
        print(f"  recent runs     the newest {c['runs']}: {c['completed']} completed, {c['failed']} failed, "
              f"{c['running']} running, {c['stuck']} stuck (running over {limits.get('stuck_after_hours', '?')}h)")
        for r in t["failed_runs"]:
            print(f"    failed  {_when(r['completed_at'] or r['started_at'])}  {r['error'] or 'no error recorded'}")
        for r in t["stuck_runs"]:
            print(f"    stuck   started {_when(r['started_at'])}, running {r['running_hours']}h")
        o = t["on_restart"]
        if o["runs_now"]:
            print("  on a restart    a paid run starts now (the boot guard finds no completion inside the window)")
        else:
            print(f"  on a restart    nothing until {_when(o['runs_after'])}; a restart after that starts a paid run")
        one = h.get("tier2_run_at")
        if t["tier"] == "tier2_luminary" and one:
            when = ""
            if one.get("at"):
                soon = f", in {one['in_hours']}h" if one.get("in_hours") is not None else ""
                when = f" ({_when(one['at'])}{soon})"
            print(f"  TIER2_RUN_AT    {one['value']}: {one['state']}{when}, {one['note']}")
    f = h["freshness"]
    print(f"\nContent, last {f['window_hours']}h")
    if f["newest_article_at"]:
        print(f"  newest article  {_when(f['newest_article_at'])}, {f['newest_age_hours']}h ago")
    else:
        print("  newest article  none")
    print(f"  arrived         {f['articles_in_window']} article{'s' if f['articles_in_window'] != 1 else ''}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prod", action="store_true", help="read production through the admin API")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    data = _remote("/admin/ingestion/health") if a.prod else _local()
    if a.json:
        print(json.dumps(data, indent=2, default=str))
    else:
        print_health(data)
    return 1 if data["verdict"] == "failing" else 0


if __name__ == "__main__":
    sys.exit(main())
