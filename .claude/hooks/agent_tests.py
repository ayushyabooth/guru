#!/usr/bin/env python3
"""
PostToolUse hook: after an edit to the agent, its tracing, its access checks or the
ingestion pipeline (GUR-283), run the gating suite (make test-agent: offline, about
20 seconds, ingestion included). A failure
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
# The ingestion pipeline gates too (GUR-283): any edit under these folders runs the suite.
WATCHED_PREFIXES = ("backend/app/services/ingestion", "backend/app/services/tier", "backend/app/services/deduplication",
                    "backend/app/routes/ingestion.py", "backend/app/services/content_quality")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    path = (data.get("tool_input") or {}).get("file_path") or ""
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(root)).replace(os.sep, "/") if path else ""
    if rel not in WATCHED and not rel.startswith(WATCHED_PREFIXES):
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
