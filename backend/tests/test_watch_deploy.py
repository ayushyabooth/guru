"""
make watch-deploy (scripts/watch_deploy.py) and the build field on /health it reads.

    cd backend && venv/bin/python -m pytest -q tests/test_watch_deploy.py
"""
import importlib.util
import os
import time

import pytest

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import httpx  # noqa: E402

pytestmark = pytest.mark.anyio
SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def watch(monkeypatch):
    monkeypatch.syspath_prepend(SCRIPTS)
    spec = importlib.util.spec_from_file_location("watch_deploy", os.path.join(SCRIPTS, "watch_deploy.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


async def test_health_names_the_build_that_is_serving():
    from app.main import app
    from app.services.agent_trace import BUILD_SHA
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/health")
    assert r.status_code == 200 and r.json()["build"] == BUILD_SHA


def test_the_pushed_commit_is_live_only_when_health_names_it(watch):
    sha = "60d858412abc0000000000000000000000000000"
    assert watch.is_live({"health": 200, "build": "60d858412abc"}, sha)
    assert watch.is_live({"health": 200, "build": "60D858412ABC"}, sha), "case doesn't matter"
    assert not watch.is_live({"health": 200, "build": "eb5a595aa111"}, sha), "the old build is still serving"
    assert not watch.is_live({"health": 200, "build": None}, sha), "an old build that doesn't report its commit"
    assert not watch.is_live({"health": 503, "build": ""}, sha)


def test_a_probe_route_marks_a_build_whose_health_has_no_build_field(watch):
    assert not watch.is_live({"health": 200, "probe": 404}, expect=401)
    assert watch.is_live({"health": 200, "probe": 401}, expect=401)


def test_the_summary_counts_downtime_or_says_there_was_none(watch):
    t0 = time.time() - 37
    clean = [{"at": "18:16:10", "health": 200}, {"at": "18:16:40", "health": 200}]
    assert watch.summary(clean, time.time(), t0) == "Live after 37s. /health answered 200 on all 2 checks: no downtime."
    rough = clean + [{"at": "18:16:50", "health": 502}, {"at": "18:17:00", "health": 0}]
    s = watch.summary(rough, None, t0)
    assert s.startswith("Not live after") and "failed on 2 of 4 checks: 18:16:50 (502), 18:17:00 (no answer)" in s
