"""
Agent traces from the terminal - for Claude Code and for a person. Same engine as
the admin Agent view in the app (app/services/trace_insights.py).

    cd backend
    venv/bin/python scripts/traces.py summary [--days 7] [--traffic real|synthetic|all] [--prod] [--json]
    venv/bin/python scripts/traces.py list    [--days 7] [--traffic ...] [--flagged] [--limit 20] [--prod] [--json]
    venv/bin/python scripts/traces.py show <trace_id> [--prod] [--json]

--prod reads production through the admin API: set ADMIN_API_KEY in your shell
(and GURU_API_URL to point somewhere other than production). The key is sent as
a header and never printed. Without --prod it reads the local database.
"""
import argparse
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

PROD_API = "https://guru-production-1b4f.up.railway.app/api/v1"
TAG = {"bad": "BAD ", "warn": "WARN", "good": "GOOD", "info": "INFO", "ok": " OK "}


def _s(ms):
    return "-" if ms is None else (f"{ms / 1000:.1f}s" if ms >= 1000 else f"{ms}ms")


def _when(iso):
    if not iso:
        return "?"
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%m-%d %H:%M")
    except Exception:
        return iso[:16]


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
        sys.exit("Not found: is the admin Agent view deployed on this server?")
    r.raise_for_status()
    return r.json()


def _local(kind, **kw):
    from app.db.database import SessionLocal
    from app.routes import admin_agent as aa
    from app.services import trace_insights as ti
    db = SessionLocal()
    try:
        if kind == "summary":
            since, turns = aa._window(db, kw["days"], kw["traffic"])
            out = ti.summarize(turns, days=kw["days"], traffic=kw["traffic"], since=since)
            emails = aa._emails(db, [t for t, _ in out["flagged"]])
            out["flagged"] = [ti.turn_row(t, d, emails.get(t["user_id"])) for t, d in out["flagged"]]
            return out
        if kind == "list":
            _, turns = aa._window(db, kw["days"], kw["traffic"])
            rows = [(t, ti.diagnose(t)) for t in turns]
            if kw["flagged"]:
                rows = [(t, d) for t, d in rows if d["severity"] in ("bad", "warn")]
            emails = aa._emails(db, [t for t, _ in rows[:kw["limit"]]])
            return {"turns": [ti.turn_row(t, d, emails.get(t["user_id"])) for t, d in rows[:kw["limit"]]],
                    "total": len(rows)}
        if kind == "show":
            row = aa._load(db, kw["trace_id"])
            t = ti.parse(row)
            d = ti.diagnose(t)
            return {"turn": {**ti.turn_row(t, d, aa._emails(db, [t]).get(t["user_id"])), **t,
                             "created_at": t["created_at"].isoformat() if t["created_at"] else None},
                    "diagnosis": d, "timeline": ti.timeline(t), "session": None, "ai_hypothesis": t["ai_hypothesis"]}
    except Exception as e:
        if "agent_turn_traces" in str(e):
            sys.exit("No agent_turn_traces table on this database yet. Start the backend once, run a turn, retry.")
        raise
    finally:
        db.close()


# ── printing ─────────────────────────────────────────────────────────────────

def print_summary(s):
    w, t = s["window"], s["tiles"]
    print(f"Agent turns, last {w['days']} days ({w['traffic']}): {t['turns']} turns, "
          f"{t['users']} users, {t['sessions']} sessions\n")
    if not t["turns"]:
        print("No turns yet. Traces appear after the first agent turn.")
        return
    print("Takeaways")
    for k in s["takeaways"]:
        print(f"  [{TAG.get(k['severity'], k['severity'])}] {k['text']}")
    fb, tot, it = t["first_block_ms"], t["total_ms"], t["iterations"]
    print(f"\nFirst content  p50 {_s(fb['p50'])}  p95 {_s(fb['p95'])}  budget {_s(fb['budget'])}  ({fb['over']} over)")
    print(f"Total          p50 {_s(tot['p50'])}  p95 {_s(tot['p95'])}  budget {_s(tot['budget'])}  ({tot['over']} over)")
    print(f"Model calls    p50 {it['p50']}  max {it['max']}  budget {it['budget']}")
    print("Outcomes       " + ", ".join(f"{k} {v}" for k, v in t["outcomes"].items()))
    share = t["cache_share"]
    print(f"Cache share    {'-' if share is None else str(round(100 * share)) + '%'}   tokens per turn: "
          f"{t['tokens_per_turn']['input_total']} in, {t['tokens_per_turn']['output']} out")
    a = t["approvals"]
    print(f"Approvals      shown {a['shown']}, approved {a['approved']}, declined {a['declined']}, "
          f"typed past {a['ignored']}, stale {a.get('stale', 0)}")
    if s["tools"]:
        print("\nTools")
        for x in s["tools"]:
            print(f"  {x['name']:24s} {x['calls']:4d} calls  p50 {_s(x['p50_ms']):>6}  p95 {_s(x['p95_ms']):>6}  errors {x['errors']}")
    if s["builds"]:
        print("\nBuilds (newest first)")
        for b in s["builds"]:
            print(f"  {b['build_sha'] or '?':14s} prompt {b['prompt_version'] or '?':12s} {b['turns']:4d} turns  "
                  f"first p50 {_s(b['first_block_p50']):>6}  errors {round(100 * b['error_rate'])}%")
    if s["flagged"]:
        print("\nFlagged turns")
        print_rows(s["flagged"])


def print_rows(rows):
    for r in rows:
        print(f"  {_when(r['created_at'])}  [{TAG.get(r['severity'], r['severity'])}] {r['outcome']:9s} "
              f"first {_s(r['first_block_ms']):>6} total {_s(r['total_ms']):>6}  {r.get('user_email') or r['user_id']}")
        print(f"      {r['headline']}")
        print(f"      id {r['id']}")


def print_turn(d):
    t, diag = d["turn"], d["diagnosis"]
    sess = d.get("session") or {}
    where = f"  (turn {sess['turn_index']} of {sess['turns_in_session']})" if sess.get("turn_index") else ""
    print(f"Turn {t['id']}  {_when(t['created_at'])}  {t.get('user_email') or t['user_id']}{where}")
    print(f"[{TAG.get(diag['severity'], diag['severity'])}] {diag['headline']}")
    print(f"outcome {t['outcome']}, traffic {t['traffic']}, build {t.get('build_sha')}, "
          f"prompt {t.get('prompt_version')}, client {t.get('client')}, decision {t.get('decision')}")
    if t.get("input_preview"):
        print(f"input: {t['input_preview']}")
    if diag["findings"]:
        print("\nFindings")
        for f in diag["findings"]:
            print(f"  {f['severity']:8s} {f['title']}")
            print(f"           {f['detail']}")
            if f["evidence"]:
                print(f"           evidence: {json.dumps(f['evidence'], default=str)}")
    total = max([i["end_ms"] for i in d["timeline"]] + [t.get("total_ms") or 1, 1])
    print(f"\nTimeline (0 to {_s(total)})")
    for i in d["timeline"]:
        a, b = int(40 * i["start_ms"] / total), int(40 * i["end_ms"] / total)
        bar = " " * a + ("|" if b <= a else "#" * max(1, b - a))
        mark = "" if i["status"] in ("ok", None) else f" [{i['status']}]"
        print(f"  {_s(i['start_ms']):>6} {bar:<41} {i['kind']:8s} {i['label']}{mark}  {i['detail'] or ''}")
    if d.get("ai_hypothesis"):
        h = d["ai_hypothesis"]
        print(f"\nClaude's hypothesis ({h.get('confidence')}): {h.get('summary')}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["summary", "list", "show"])
    ap.add_argument("trace_id", nargs="?")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--traffic", choices=["real", "synthetic", "all"], default="real")
    ap.add_argument("--flagged", action="store_true")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--prod", action="store_true", help="read production through the admin API")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.command == "show" and not a.trace_id:
        ap.error("show needs a trace id")
    if a.prod:
        if a.command == "summary":
            data = _remote("/admin/agent/summary", {"days": a.days, "traffic": a.traffic})
        elif a.command == "list":
            data = _remote("/admin/agent/turns", {"days": a.days, "traffic": a.traffic,
                                                  "flagged_only": a.flagged, "limit": a.limit})
        else:
            data = _remote(f"/admin/agent/turns/{a.trace_id}")
    else:
        data = _local(a.command, days=a.days, traffic=a.traffic, flagged=a.flagged, limit=a.limit, trace_id=a.trace_id)
    if a.json:
        print(json.dumps(data, indent=2, default=str))
    elif a.command == "summary":
        print_summary(data)
    elif a.command == "list":
        print(f"{data['total']} turns")
        print_rows(data["turns"])
    else:
        print_turn(data)


if __name__ == "__main__":
    main()
