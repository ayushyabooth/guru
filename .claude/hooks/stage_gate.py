#!/usr/bin/env python3
"""
PreToolUse hook: the stage gate of the feature pipeline (CLAUDE.md, "New features").

Before Claude Code edits a file, this checks the active feature's state
(.claude/feature-state.json, written only by feature_state.py approve):
- app UI (mobile/app, mobile/components) needs an approved design;
- app code (backend/app) needs an approved requirement;
- the state file itself is never edited by hand.
When a stage isn't approved it doesn't block: it makes Claude Code ask the owner,
in every permission mode, with the reason. Everything else passes silently.
CLAUDE.md explains the pipeline; this makes the checkpoint hold even when the
advice is skipped or the repo's CLAUDE.md isn't loaded.
"""
import json
import os
import sys

UI = ("mobile/app/", "mobile/components/")
CODE = ("backend/app/",)
STATE_REL = ".claude/feature-state.json"


def ask(reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                             "permissionDecisionReason": reason}}))


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    path = (data.get("tool_input") or {}).get("file_path") or (data.get("tool_input") or {}).get("notebook_path")
    if not path:
        return 0
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(root)).replace(os.sep, "/")
    if rel.startswith(".."):
        return 0
    if rel == STATE_REL:
        ask("Approvals are recorded with feature_state.py approve, never by editing the state file.")
        return 0
    need = "design" if rel.startswith(UI) else "requirement" if rel.startswith(CODE) else None
    if need is None:
        return 0
    try:
        with open(os.path.join(root, STATE_REL)) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    if (state.get(need) or {}).get("approved"):
        return 0
    feature = state.get("feature") or "no active feature"
    if need == "design":
        ask(f"Design first: {rel} is app UI, and no approved design is recorded for {feature}. "
            "Run the guru-feature design stage (a Figma frame in the design language, approved by the owner), "
            "or approve this one edit if it is not a new feature or visible change.")
    else:
        ask(f"Requirement first: {rel} is app code, and no approved requirement is recorded for {feature}. "
            "Run the guru-feature product stage (state the requirement, get the owner's yes), "
            "or approve this one edit if it is a fix outside a feature.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
