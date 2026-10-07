"""
Readout for agent turn traces (agent_turn_traces) - the sensor layer's dashboard.

    cd backend && venv/bin/python scripts/trace_report.py [--days 7] [--json]

Prints, for the window: turns by outcome; p50/p95 time to first block and
total time; model calls per turn; tokens per turn and cache-hit share; tool
latency by tool with error rate; block types streamed; and any turn that broke
a budget. Budgets are the targets the latency evals hold the agent to.
"""
import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.database import SessionLocal  # noqa: E402
from app.models.agent_turn_trace import AgentTurnTrace  # noqa: E402

# Budgets (ms). First block: the R23 fix targets the user seeing content in
# 2-4s; total: a full composed answer. Tune as real traces accumulate.
BUDGET_FIRST_BLOCK_MS = 4000
BUDGET_TOTAL_MS = 20000
BUDGET_ITERATIONS = 5


def pct(values, p):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1)))))
    return vals[k]


def summarize(rows):
    out = {"turns": len(rows), "by_outcome": dict(Counter(r.outcome for r in rows))}
    out["first_block_ms"] = {"p50": pct([r.first_block_ms for r in rows], 50), "p95": pct([r.first_block_ms for r in rows], 95)}
    out["total_ms"] = {"p50": pct([r.total_ms for r in rows], 50), "p95": pct([r.total_ms for r in rows], 95)}
    out["iterations"] = {"p50": pct([r.iterations for r in rows], 50), "max": max((r.iterations or 0 for r in rows), default=0)}
    tin = sum(r.tokens_in or 0 for r in rows)
    out["tokens_per_turn"] = {
        "in": round(tin / len(rows)) if rows else 0,
        "out": round(sum(r.tokens_out or 0 for r in rows) / len(rows)) if rows else 0,
        "cache_read_share": round(sum(r.cache_read_tokens or 0 for r in rows) / tin, 2) if tin else None,
    }
    tools = defaultdict(list)
    tool_err = Counter()
    blocks = Counter()
    for r in rows:
        for c in json.loads(r.tool_calls or "[]"):
            tools[c["name"]].append(c.get("ms"))
            tool_err[c["name"]] += 1 if c.get("error") else 0
        for b in json.loads(r.blocks or "[]"):
            blocks[f"{b['type']}:{b['variant']}" if b.get("variant") else b["type"]] += 1
    out["tools"] = {n: {"calls": len(v), "p50_ms": pct(v, 50), "p95_ms": pct(v, 95), "errors": tool_err[n]}
                    for n, v in sorted(tools.items(), key=lambda kv: -len(kv[1]))}
    out["blocks"] = dict(blocks.most_common())
    out["over_budget"] = [
        {"created_at": str(r.created_at), "input": r.input_preview, "outcome": r.outcome,
         "first_block_ms": r.first_block_ms, "total_ms": r.total_ms, "iterations": r.iterations}
        for r in rows
        if (r.first_block_ms or 0) > BUDGET_FIRST_BLOCK_MS or (r.total_ms or 0) > BUDGET_TOTAL_MS
        or (r.iterations or 0) > BUDGET_ITERATIONS or r.outcome in ("error", "max_iters")
    ]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    db = SessionLocal()
    try:
        rows = db.query(AgentTurnTrace).filter(AgentTurnTrace.created_at >= since).all()
    except Exception as e:  # table not created yet on this database
        if "agent_turn_traces" in str(e):
            print("No agent_turn_traces table on this database yet. Start the backend once "
                  "(startup creates it), run a few agent turns, then rerun.")
            return
        raise
    finally:
        db.close()
    s = summarize(rows)
    if args.json:
        print(json.dumps(s, indent=2, default=str))
        return
    print(f"Agent turns, last {args.days} days: {s['turns']}  {s['by_outcome']}")
    if not rows:
        return
    print(f"First block ms   p50 {s['first_block_ms']['p50']}  p95 {s['first_block_ms']['p95']}   (budget {BUDGET_FIRST_BLOCK_MS})")
    print(f"Total ms         p50 {s['total_ms']['p50']}  p95 {s['total_ms']['p95']}   (budget {BUDGET_TOTAL_MS})")
    print(f"Model calls      p50 {s['iterations']['p50']}  max {s['iterations']['max']}   (budget {BUDGET_ITERATIONS})")
    t = s["tokens_per_turn"]
    print(f"Tokens per turn  in {t['in']}  out {t['out']}  cache-read share {t['cache_read_share']}")
    print("Tools:")
    for n, v in s["tools"].items():
        print(f"  {n:22s} calls {v['calls']:4d}  p50 {v['p50_ms']}ms  p95 {v['p95_ms']}ms  errors {v['errors']}")
    print("Blocks streamed:", ", ".join(f"{k} {v}" for k, v in s["blocks"].items()))
    print(f"Turns over budget or failed: {len(s['over_budget'])}")
    for o in s["over_budget"][:10]:
        print(f"  {o['created_at'][:19]}  {o['outcome']:9s} first {o['first_block_ms']}  total {o['total_ms']}  iters {o['iterations']}  '{(o['input'] or '')[:50]}'")


if __name__ == "__main__":
    main()
