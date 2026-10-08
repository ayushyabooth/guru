"""
After a push: watch production until the pushed build is serving, and flag any downtime.

    cd backend
    venv/bin/python scripts/watch_deploy.py [--sha <commit>] [--every 10] [--timeout 600]
    venv/bin/python scripts/watch_deploy.py --probe /api/v1/admin/reports --expect 401

It polls /health every 10 seconds and prints each check. It is done when /health
reports the expected build: the commit you pushed, by default origin/main's head.
Every check where /health isn't 200 is a moment of downtime; each is printed, and
the summary counts them. A build older than the `build` field on /health can't be
named, so --probe watches a route that only the new code has until it answers
--expect (the 10/7 deploy: the reports route went from 404 to 401).

Exit codes: 0 live with no downtime, 2 live but /health failed at least once,
1 not live before the timeout.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from traces import PROD_API  # noqa: E402  (same folder)

BASE = os.getenv("GURU_API_URL", PROD_API).rstrip("/").removesuffix("/api/v1")


def _get(url, timeout=8):
    """(status, parsed JSON or None). A network failure is status 0."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read()
            try:
                return r.status, json.loads(body)
            except ValueError:
                return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


def is_live(check, sha=None, expect=None):
    """One check: is the new build serving? By the build on /health, or by the probe's status."""
    if expect is not None:
        return check.get("probe") == expect
    build = (check.get("build") or "").lower()
    return bool(sha and build and (sha.lower().startswith(build) or build.startswith(sha.lower())))


def summary(checks, live_at, started):
    down = [c for c in checks if c["health"] != 200]
    if live_at is None:
        line = f"Not live after {round(time.time() - started)}s."
    else:
        line = f"Live after {round(live_at - started)}s."
    if down:
        return line + f" /health failed on {len(down)} of {len(checks)} checks: " + \
            ", ".join(f"{c['at']} ({c['health'] or 'no answer'})" for c in down)
    return line + f" /health answered 200 on all {len(checks)} checks: no downtime."


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sha", help="the commit to wait for (default: origin/main's head)")
    ap.add_argument("--probe", help="a route only the new build has, for builds whose /health has no build field")
    ap.add_argument("--expect", type=int, help="the probe's status once the new build serves (e.g. 401)")
    ap.add_argument("--every", type=int, default=10)
    ap.add_argument("--timeout", type=int, default=600)
    a = ap.parse_args()
    if bool(a.probe) != (a.expect is not None):
        ap.error("--probe and --expect go together")
    sha = a.sha
    if not sha and not a.probe:
        root = os.path.join(os.path.dirname(__file__), "..", "..")
        sha = subprocess.run(["git", "-C", root, "rev-parse", "origin/main"], capture_output=True, text=True).stdout.strip()
    target = f"the probe {a.probe} answering {a.expect}" if a.probe else f"build {sha[:12]}"
    print(f"Watching {BASE} every {a.every}s for {target}.")
    started, checks, live_at = time.time(), [], None
    while time.time() - started < a.timeout:
        health, body = _get(f"{BASE}/health")
        check = {"at": datetime.now().strftime("%H:%M:%S"), "health": health,
                 "build": (body or {}).get("build") if isinstance(body, dict) else None}
        if a.probe:
            check["probe"] = _get(f"{BASE}{a.probe}")[0]
        checks.append(check)
        extra = f" probe={check['probe']}" if a.probe else f" build={check['build'] or '-'}"
        print(f"{check['at']} health={health or 'no answer'}{extra}")
        if is_live(check, sha, a.expect):
            live_at = time.time()
            break
        time.sleep(a.every)
    print(summary(checks, live_at, started))
    if live_at is None:
        return 1
    return 2 if any(c["health"] != 200 for c in checks) else 0


if __name__ == "__main__":
    sys.exit(main())
