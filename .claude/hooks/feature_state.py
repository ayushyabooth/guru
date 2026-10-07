#!/usr/bin/env python3
"""
Records where the active feature is in the pipeline (CLAUDE.md, "New features").

The stage gate (stage_gate.py) reads this state before any edit to app code. An
approval is recorded only through `approve`, and settings.json makes that command
ask the owner first, so the owner's click is what unlocks the next stage.

    python3 .claude/hooks/feature_state.py start "GUR-242 Report a bug"
    python3 .claude/hooks/feature_state.py approve requirement --note "what was approved"
    python3 .claude/hooks/feature_state.py approve design --frame <figma url> [--frame <url> ...]
    python3 .claude/hooks/feature_state.py approve design --none "why nothing visible changes"
    python3 .claude/hooks/feature_state.py link GUR-259 GUR-260
    python3 .claude/hooks/feature_state.py show
    python3 .claude/hooks/feature_state.py done
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE = os.path.join(ROOT, ".claude", "feature-state.json")


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save(state):
    with open(STATE, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main():
    ap = argparse.ArgumentParser(description="The active feature's pipeline state")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start"); s.add_argument("feature")
    a = sub.add_parser("approve"); a.add_argument("stage", choices=["requirement", "design"])
    a.add_argument("--note", default="")
    a.add_argument("--frame", action="append", default=[])
    a.add_argument("--none", dest="none_reason", default=None, help="design only: nothing visible changes, and why")
    lk = sub.add_parser("link"); lk.add_argument("issues", nargs="+")
    sub.add_parser("show"); sub.add_parser("done")
    args = ap.parse_args()

    state = load()
    if args.cmd == "start":
        state = {"feature": args.feature, "started": now(), "requirement": {}, "design": {}, "issues": []}
        save(state)
    elif args.cmd == "done":
        if os.path.exists(STATE):
            os.remove(STATE)
        print("No active feature.")
        return 0
    elif state is None:
        sys.exit("No active feature. Start one: feature_state.py start \"<Linear id and name>\"")
    elif args.cmd == "approve":
        if args.stage == "design" and not (args.frame or args.none_reason):
            sys.exit("A design approval needs the approved frame links (--frame) or --none with the reason.")
        if args.stage == "design" and not state["requirement"].get("approved"):
            sys.exit("The requirement comes first: approve it before the design.")
        state[args.stage] = {"approved": True, "at": now(), "note": args.note, "frames": args.frame,
                             "none": args.none_reason}
        save(state)
    elif args.cmd == "link":
        state["issues"] = sorted(set(state["issues"]) | set(args.issues))
        save(state)
    print(json.dumps(load(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
