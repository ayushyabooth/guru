#!/usr/bin/env python3
"""
PostToolUse hook: after an edit to the agent, its tracing or its access checks,
run the agent contract tests (make test-agent: offline, a few seconds). A failure
goes straight back to Claude (exit 2), so a broken contract is seen in the same
step that broke it, not at review time.
"""
import json
import os
import subprocess
import sys

WATCHED = ("backend/app/routes/agent.py", "backend/app/services/agent_trace.py",
           "backend/app/services/trace_insights.py", "backend/app/services/access.py",
           "backend/app/routes/admin_agent.py")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    path = (data.get("tool_input") or {}).get("file_path") or ""
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(root)).replace(os.sep, "/") if path else ""
    if rel not in WATCHED:
        return 0
    try:
        r = subprocess.run(["make", "-C", root, "test-agent"], capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"make test-agent could not run: {e}", file=sys.stderr)
        return 2
    if r.returncode != 0:
        tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-25:])
        print(f"make test-agent failed after editing {rel}:\n{tail}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
