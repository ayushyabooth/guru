"""
Ingestion pipeline health (GUR-283): the contracts that keep the feed alive, and the check that
watches production.

- A run's lifecycle: "running" while it works, then completed with its counts, or failed with its
  error. Pinned gap: a cancelled run is left "running" until the next boot.
- The boot guard: only a completed run inside its window counts, edges included.
- The per-run cap and the RSS age filter. Pinned gaps: the cap isn't enforced at ingest, and
  TIER2_AGE_FILTER_DAYS is never read.
- An ingested article carries what the feed shows: a summary, why it matters, a spotlight quote.
- GET /api/v1/admin/ingestion/health and make ingestion-health (scripts/ingestion_health.py).

A pinned gap is a test of the contract marked xfail(strict): it turns red the day the gap is
fixed, so the fix removes the marker and its row in docs/known-gaps.md in the same commit.

Hermetic: an in-memory SQLite per test that every session in the pipeline opens, the real FastAPI
app over httpx's ASGI transport with no startup events, and fakes for every feed, web search,
scrape and model call. A test that reaches for the network fails.

    cd backend && venv/bin/python -m pytest -q tests/test_ingestion_health.py
"""
import asyncio
import importlib.util
import json
import math
import os
import socket
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import httpx  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import database  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.database import get_db  # noqa: E402
from app.models.article import Article  # noqa: E402
from app.models.article_rich_content import ArticleRichContent  # noqa: E402
from app.models.ingestion_run import IngestionRun  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import ingestion_health  # noqa: E402
from app.services import ingestion_orchestrator as orch  # noqa: E402
from app.services import rich_summary_service, tier1_luminary_service, tier2_discovery_service  # noqa: E402
from app.services.auth_service import generate_jwt  # noqa: E402
from app.services.deduplication_service import DeduplicationService  # noqa: E402
from app.services.image_scraping_service import ImageScrapingService  # noqa: E402
from app.services.luminaries_config import LuminariesConfig  # noqa: E402
from app.tasks import ingestion_tasks  # noqa: E402

pytestmark = pytest.mark.anyio

T2, T3 = "tier2_luminary", "tier3_discovery"
RUN = {T2: "run_tier2", T3: "run_tier3"}
ADMIN, READER = "admin@guru.app", "reader@guru.app"
KEY = "k" * 40
HEALTH = "/api/v1/admin/ingestion/health"
SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")
NOW = datetime(2026, 10, 8, 5, 0, tzinfo=timezone.utc)  # Wed 10/7 10pm PDT


def ago(hours=0.0, **kw):
    """A time before NOW, naive UTC, the way the orchestrator writes it."""
    return (NOW - timedelta(hours=hours, **kw)).replace(tzinfo=None)


def iso_ago(hours):
    return (NOW - timedelta(hours=hours)).isoformat()


class _Clock(datetime):
    """datetime with the clock stopped at NOW, for code that reads the time itself."""
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)

    @classmethod
    def utcnow(cls):
        return NOW.replace(tzinfo=None)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """Feeds, web search, scrapes and the model are fakes here. The code under test swallows some network
    errors (a dead feed is logged and skipped), so every attempt is recorded, and fails the test at teardown."""
    attempts = []

    def refuse(*args, **kw):
        attempts.append(args)
        raise OSError("tests are offline")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    DeduplicationService.get_instance().clear_processing_urls()
    yield
    DeduplicationService.get_instance().clear_processing_urls()
    assert not attempts, f"a test reached for the network: {attempts}"


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    """The production defaults, whatever the local environment sets."""
    for name, value in (("TIER2_SCHEDULE_HOURS", 72), ("TIER3_SCHEDULE_HOURS", 168), ("TIER2_RUN_AT", ""),
                        ("MAX_ARTICLES_PER_INGESTION_RUN", 50), ("TIER3_RESULTS_PER_SPECIALIZATION", 8),
                        ("TIER3_DISCOVERY_ROUNDS", 2), ("TIER2_AGE_FILTER_DAYS", 30)):
        monkeypatch.setattr(settings, name, value)


@pytest.fixture
def db(monkeypatch):
    """A throwaway in-memory SQLite that every session in the pipeline opens: the orchestrator's, the
    article task's, discovery's and the routes'. Returns the session factory."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    for module in (database, orch, ingestion_tasks):
        monkeypatch.setattr(module, "SessionLocal", Session)
    return Session


def _run(Session, tier, status, started, completed=None, found=0, ingested=0, rejected=0, error=None):
    with Session() as s:
        run = IngestionRun(tier=tier, status=status, started_at=started, completed_at=completed,
                           articles_found=found, articles_ingested=ingested, articles_rejected=rejected,
                           error_message=error)
        s.add(run)
        s.commit()
        return str(run.id)


def _articles(Session, *hours_ago):
    with Session() as s:
        s.add_all(Article(id=uuid.uuid4(), url=f"https://example.com/a/{uuid.uuid4()}", title="An article",
                          created_at=ago(h)) for h in hours_ago)
        s.commit()


def _world(Session, t2=20, t3=100, articles=(2, 50, 80)):
    """Each tier's last completion this many hours ago (None: never), and articles this many hours old.
    The defaults are healthy: the other tests bend one thing."""
    for tier, age in ((T2, t2), (T3, t3)):
        if age is not None:
            _run(Session, tier, "completed", ago(age + 1), ago(age), found=120, ingested=41, rejected=79)
    _articles(Session, *articles)


def _rows(Session):
    """Every ingestion run, oldest first, read fresh."""
    with Session() as s:
        return s.query(IngestionRun).order_by(IngestionRun.started_at).all()


def _report(Session, now=NOW):
    with Session() as s:
        return ingestion_health.report(s, now=now)


def _discover_with(monkeypatch, fn):
    """Both tiers' discovery run fn instead of reading feeds or searching the web."""
    monkeypatch.setattr(tier1_luminary_service.Tier1LuminaryService, "discover_articles", fn)
    monkeypatch.setattr(tier2_discovery_service.Tier2DiscoveryService, "discover_articles", fn)
    monkeypatch.setattr(tier2_discovery_service.anthropic, "Anthropic", lambda **kw: SimpleNamespace())


def _discovered(n, tier=T2):
    return [{"url": f"https://example.com/{tier}/{i}", "luminary_name": "Example Weekly",
             "specializations": ["AI Research & Breakthroughs"]} for i in range(n)]


# ── a run's lifecycle ────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier", [T2, T3])
async def test_a_run_is_running_while_it_works_then_completed_with_its_counts(db, monkeypatch, tier):
    """Started: one row, "running", with no completion time. Completed: found, ingested and rejected as
    counted, where one article's crash is a rejection, never the run's failure."""
    seen = []

    def discover(self):
        seen.extend((r.tier, r.status, r.completed_at) for r in _rows(db))  # read mid-run
        return _discovered(4, tier)

    def ingest(url, **kw):
        if url.endswith("/3"):
            raise RuntimeError("scrape blew up")
        return {"success": not url.endswith("/2")}

    _discover_with(monkeypatch, discover)
    monkeypatch.setattr(ingestion_tasks, "ingest_article", ingest)
    assert await getattr(orch.IngestionOrchestrator(), RUN[tier])() == 2

    assert seen == [(tier, "running", None)]
    [run] = _rows(db)
    assert (run.tier, run.status, run.error_message) == (tier, "completed", None)
    assert (run.articles_found, run.articles_ingested, run.articles_rejected) == (4, 2, 2)
    assert run.completed_at is not None


@pytest.mark.parametrize("tier", [T2, T3])
async def test_a_crash_inside_a_tier_is_recorded_as_failed_with_its_error(db, monkeypatch, tier):
    """The boot and the scheduler call the _safe wrappers: a crash returns 0 and leaves the run failed, with
    its error and a completion time, never "running"."""
    def discover(self):
        raise RuntimeError("feed list unreadable")

    _discover_with(monkeypatch, discover)
    orchestrator = orch.IngestionOrchestrator()
    safe = orchestrator._run_tier2_safe if tier == T2 else orchestrator._run_tier3_safe
    assert await safe() == 0

    [run] = _rows(db)
    assert (run.tier, run.status, run.error_message) == (tier, "failed", "feed list unreadable")
    assert run.completed_at is not None


@pytest.mark.xfail(strict=True, raises=AssertionError, reason=(
    "Known gap (docs/known-gaps.md): run_tier2 and run_tier3 catch Exception, and asyncio.CancelledError is "
    "not one. A run cancelled mid-flight, as when the server shuts down for a deploy, skips _fail_run and stays "
    "'running' until the next boot's sweep in main.py marks it failed. The health check calls a run still "
    "running after 3 hours stuck."))
async def test_a_cancelled_run_is_never_left_running(db, monkeypatch):
    started, release = threading.Event(), threading.Event()

    def discover(self):
        started.set()
        release.wait(5)
        return []

    _discover_with(monkeypatch, discover)
    task = asyncio.create_task(orch.IngestionOrchestrator().run_tier2())
    try:
        for _ in range(1000):
            if started.is_set():
                break
            await asyncio.sleep(0.005)
        else:  # not an AssertionError, so a broken setup can't pass for the pinned gap
            raise RuntimeError("discovery never started")
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()

    [run] = _rows(db)
    assert run.status != "running", "a cancelled run should be recorded as failed, like a crash"


# ── the boot guard ───────────────────────────────────────────────────────────

GUARD = {
    "never ran": ([], True),
    "completed inside the window": ([("completed", ago(72), ago(71))], False),
    "completed exactly one window ago": ([("completed", ago(73), ago(72))], False),
    "completed a microsecond past the window": ([("completed", ago(73), ago(72, microseconds=1))], True),
    "failed inside the window": ([("failed", ago(2), ago(1))], True),
    "still running": ([("running", ago(1), None)], True),
    "completed with no completion time": ([("completed", ago(2), None)], True),
    "a failure after a completion inside the window": ([("completed", ago(30), ago(29)),
                                                         ("failed", ago(2), ago(1))], False),
}


@pytest.mark.parametrize("runs, restart_runs", GUARD.values(), ids=GUARD.keys())
def test_the_boot_guard_counts_only_a_completed_run_inside_its_window(db, monkeypatch, runs, restart_runs):
    """A boot runs a paid tier unless its last completion is inside the window. A failed, running or
    incomplete run is never a completion, and one completed exactly a window ago still counts. The health
    check reads the same rule, so the two can't disagree about what a restart will do."""
    monkeypatch.setattr(orch, "datetime", _Clock)
    for status, started, completed in runs:
        _run(db, T2, status, started, completed)
    assert orch.IngestionOrchestrator()._should_run_tier(T2, 72) is restart_runs
    assert _report(db)["tiers"][T2]["on_restart"]["runs_now"] is restart_runs


# ── the per-run cap and the age filter ───────────────────────────────────────

def _entry(name, days_old):
    published = datetime.now(timezone.utc) - timedelta(days=days_old)  # discovery measures from the real clock
    return {"link": f"https://example.com/{name}", "title": name, "published_parsed": published.utctimetuple()}


def _rss(monkeypatch, *entries):
    """Every luminary's feed answers with these entries."""
    feed = SimpleNamespace(bozo=False, entries=list(entries))
    monkeypatch.setattr(tier1_luminary_service, "_FEEDPARSER_AVAILABLE", True)
    monkeypatch.setattr(tier1_luminary_service, "feedparser", SimpleNamespace(parse=lambda url, **kw: feed))


def test_an_rss_entry_older_than_the_age_filter_never_becomes_a_candidate(monkeypatch):
    """Tier 2 keeps an entry published inside max_article_age_days (config/luminaries.json) and drops an
    older one, before anything is scraped or sent to the model."""
    days = LuminariesConfig.get_instance().get_max_article_age_days()
    _rss(monkeypatch, _entry("inside", days - 1), _entry("outside", days + 1))
    found = tier1_luminary_service.Tier1LuminaryService().discover_articles()
    assert [a["title"] for a in found] == ["inside"]


@pytest.mark.xfail(strict=True, raises=AssertionError, reason=(
    "Known gap (docs/known-gaps.md): TIER2_AGE_FILTER_DAYS is never read. The RSS age filter reads "
    "max_article_age_days in config/luminaries.json (30 days, the setting's default too), so changing the "
    "setting on Railway changes nothing."))
def test_the_tier2_age_filter_setting_sets_the_rss_cutoff(monkeypatch):
    monkeypatch.setattr(settings, "TIER2_AGE_FILTER_DAYS", 7)
    _rss(monkeypatch, _entry("inside", 6), _entry("outside", 8))
    found = tier1_luminary_service.Tier1LuminaryService().discover_articles()
    assert [a["title"] for a in found] == ["inside"]


def test_tier3_discovery_stops_searching_at_one_and_a_half_times_the_run_cap(db, monkeypatch):
    """GUR-238's early exit: once discovery holds 1.5 x MAX_ARTICLES_PER_INGESTION_RUN candidates it stops
    paying for searches, part way through its slice of specializations."""
    searches = []

    def create(**kw):
        n = len(searches)
        searches.append(kw)
        results = [SimpleNamespace(type="web_search_result", url=f"https://example.com/s{n}/{i}", title=f"r{i}",
                                   page_age=None) for i in range(settings.TIER3_RESULTS_PER_SPECIALIZATION)]
        return SimpleNamespace(content=[SimpleNamespace(type="web_search_tool_result", content=results)], usage=None)

    monkeypatch.setattr(tier2_discovery_service.anthropic, "Anthropic",
                        lambda **kw: SimpleNamespace(messages=SimpleNamespace(create=create)))
    found = tier2_discovery_service.Tier2DiscoveryService().discover_articles()

    cap, per = math.ceil(settings.MAX_ARTICLES_PER_INGESTION_RUN * 1.5), settings.TIER3_RESULTS_PER_SPECIALIZATION
    assert len(searches) == math.ceil(cap / per)  # 10 searches, of the 31 in a cold start's slice
    assert cap <= len(found) < cap + per


@pytest.mark.xfail(strict=True, raises=AssertionError, reason=(
    "Known gap (docs/known-gaps.md): run_tier2 and run_tier3 hand every discovered article to ingest_article. "
    "MAX_ARTICLES_PER_INGESTION_RUN is read only by tier 3 discovery, as its 1.5x early exit, so a tier 3 run "
    "processes up to 82 articles and a tier 2 run (164 feeds, up to 5 entries each) has no cap at all."))
@pytest.mark.parametrize("tier", [T2, T3])
async def test_a_run_processes_at_most_the_per_run_cap(db, monkeypatch, tier):
    cap = settings.MAX_ARTICLES_PER_INGESTION_RUN
    processed = []
    _discover_with(monkeypatch, lambda self: _discovered(cap + 10, tier))
    monkeypatch.setattr(ingestion_tasks, "ingest_article", lambda url, **kw: processed.append(url) or {"success": True})
    await getattr(orch.IngestionOrchestrator(), RUN[tier])()
    assert len(processed) <= cap


# ── an ingested article carries what the feed shows ──────────────────────────

TITLE = "Inference capacity is the new bottleneck"
PARAGRAPH = ("Inference capacity grew faster than anyone planned this year, and the buyers who signed early "
             "contracts now hold the cheapest compute in the market. ") * 3
TEXT = "\n\n".join([PARAGRAPH.strip()] * 10)  # 720 words in 10 paragraphs: clears the quality gate
REPLY = {
    "whats_in": "A chip maker doubled its inference capacity in one quarter and sold all of it in advance.",
    "why_matters": "Inference cost sets the price of every AI feature you ship, and it just moved.",
    "between_lines": "Capacity is going to whoever holds the power contracts.",
    "spotlight_quotes": ["We sold out of capacity before the fab was finished."],
    "socratic_prompts": ["What changes in your roadmap if inference cost halves?", "Who pays for idle capacity?"],
    "core_argument": "Inference capacity, not model quality, now limits AI products.",
    "strongest_evidence": ["Capacity doubled in one quarter."],
    "counterpoints": ["Demand may be a one-off.", "Power limits the build-out."],
}
ARTICLE = {"url": "https://example.com/inference-capacity", "title": TITLE, "luminary_name": "Example Weekly",
           "industry": "AI", "specializations": ["AI Research & Breakthroughs"], "ingestion_tier": T2}


def _model(monkeypatch, reply):
    """The enrichment's model call, scripted: answers with reply as JSON, records each request."""
    calls = []

    def create(**kw):
        calls.append(kw)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(reply))],
                               usage=SimpleNamespace(input_tokens=900, output_tokens=300))

    client = SimpleNamespace(client=SimpleNamespace(messages=SimpleNamespace(create=create)))
    monkeypatch.setattr(rich_summary_service, "get_claude_client", lambda: client)
    return calls


def _scrape(monkeypatch):
    """The page fetch and the image scrape, which would reach the article's site."""
    monkeypatch.setattr(ingestion_tasks, "ingest_url", lambda url: {
        "title": TITLE, "source": "Example Weekly", "publish_date": None, "raw_text": TEXT,
        "is_paywalled": False, "word_count": len(TEXT.split()), "inline_images": [], "error": None})
    monkeypatch.setattr(ImageScrapingService, "scrape_image_url", lambda self, url: None)


def _ingest():
    return ingestion_tasks.ingest_article(url=ARTICLE["url"], notes="Via Example Weekly", article_data=ARTICLE,
                                         ingestion_tier=T2)


def test_an_ingested_article_carries_what_the_feed_shows(db, monkeypatch):
    """The real ingest_article and enrichment, the model scripted. The article lands with its tags, and its
    rich content holds what the feed cards show (storyboards.py, divein.py, the agent's catch-up): the
    summary (whats_in_article), why it matters (why_it_matters) and a spotlight quote, as the model wrote them.
    One Haiku call, its prompt built from the article and its specialization."""
    calls = _model(monkeypatch, REPLY)
    _scrape(monkeypatch)
    out = _ingest()
    assert out["success"], out

    with db() as s:
        article = s.query(Article).one()
        rich = s.query(ArticleRichContent).filter_by(article_id=article.id).one()
        assert (article.title, article.ingestion_tier) == (TITLE, T2)
        assert (article.industries, article.specializations) == (["AI"], ["AI Research & Breakthroughs"])
        assert rich.summary_whats_in == REPLY["whats_in"]
        assert rich.summary_why_matters == REPLY["why_matters"]
        assert rich.spotlight_quotes == REPLY["spotlight_quotes"]
    [call] = calls
    assert call["model"] == settings.CLAUDE_HAIKU_MODEL
    prompt = call["messages"][0]["content"]
    assert TITLE in prompt and "AI Research & Breakthroughs" in prompt and PARAGRAPH.strip()[:120] in prompt


def test_an_article_whose_enrichment_failed_gets_it_from_the_warm_pass(db, monkeypatch):
    """ingest_article counts an article as ingested even when the model's answer can't be used, so a run's
    "ingested" can include an article with no summary yet. The warm pass after every tier run
    (_warm_content_safe) fills it in."""
    from app.services.startup_service import _warm_rich_content

    _model(monkeypatch, {k: v for k, v in REPLY.items() if k != "why_matters"})
    _scrape(monkeypatch)
    assert _ingest()["success"]
    with db() as s:
        assert s.query(Article).count() == 1 and s.query(ArticleRichContent).count() == 0

    _model(monkeypatch, REPLY)
    with db() as s:
        _warm_rich_content(s, limit=20)
    with db() as s:
        rich = s.query(ArticleRichContent).one()
        assert (rich.summary_why_matters, rich.spotlight_quotes) == (REPLY["why_matters"], REPLY["spotlight_quotes"])


# ── the health check: verdicts ───────────────────────────────────────────────

def test_healthy_when_both_tiers_are_inside_their_windows_and_articles_keep_arriving(db):
    _world(db)
    h = _report(db)
    assert h["verdict"] == "healthy"
    assert h["reasons"] == [
        {"level": "ok", "text": "Tier 2 (luminary RSS): completed 20.0h ago, inside its 72h window"},
        {"level": "ok", "text": "Tier 3 (web discovery): completed 100.0h ago, inside its 168h window"},
        {"level": "ok", "text": "2 articles arrived in the last 72h, the newest 2.0h ago"},
    ]
    t2 = h["tiers"][T2]
    assert t2["last_completed"]["completed_at"] == iso_ago(20)
    assert [t2["last_completed"][k] for k in ("found", "ingested", "rejected")] == [120, 41, 79]
    assert t2["recent"] == {"runs": 1, "completed": 1, "failed": 0, "running": 0, "stuck": 0}
    assert h["tier2_run_at"] is None and h["checked_at"] == NOW.isoformat()


STALE = {
    "a tier past its window": (
        dict(t3=169), "Tier 3 (web discovery): last completed 169.0h ago, past its 168h window, "
                      "so a restart starts a paid run now"),
    "a tier that never completed": (
        dict(t2=None), "Tier 2 (luminary RSS): no completed run on record, so a restart starts a paid run now"),
    "no new article in 72 hours": (dict(articles=(73, 100)), "No new article in 72h: the newest arrived 73.0h ago"),
    "no articles at all": (dict(articles=()), "No articles in the database at all"),
}


@pytest.mark.parametrize("world, reason", STALE.values(), ids=STALE.keys())
def test_stale_when_a_tier_is_past_its_window_or_no_new_article_arrived(db, world, reason):
    _world(db, **world)
    h = _report(db)
    assert h["verdict"] == "stale"
    assert h["reasons"][0] == {"level": "stale", "text": reason}
    assert [r["level"] for r in h["reasons"]] == ["stale", "ok", "ok"]


def test_failing_when_the_last_run_failed(db):
    """Even inside the window. The boot guard still counts the completion before it, so a restart starts
    nothing, but the failure is the news, first line of its error first."""
    _world(db)
    _run(db, T2, "failed", ago(2), ago(1.5), error="interrupted: backend restarted mid-run (deploy)\nmore detail")
    h = _report(db)
    assert h["verdict"] == "failing"
    assert h["reasons"][0] == {"level": "failing", "text": "Tier 2 (luminary RSS): the last run failed 1.5h ago: "
                                                           "interrupted: backend restarted mid-run (deploy)"}
    t2 = h["tiers"][T2]
    assert (t2["last_run"]["status"], t2["recent"]["failed"], t2["within_window"]) == ("failed", 1, True)
    assert t2["failed_runs"][0]["error"].startswith("interrupted") and t2["on_restart"]["runs_now"] is False


def test_an_older_failure_is_history_not_failing(db):
    _world(db)
    _run(db, T2, "failed", ago(30), ago(29), error="feed list unreadable")  # before the completion 20h ago
    h = _report(db)
    assert h["verdict"] == "healthy" and h["tiers"][T2]["recent"]["failed"] == 1


def test_failing_when_a_run_is_stuck(db):
    _world(db)
    _run(db, T3, "running", ago(4))
    h = _report(db)
    assert h["verdict"] == "failing"
    assert h["reasons"][0] == {"level": "failing", "text": "Tier 3 (web discovery): a run started 4.0h ago is still "
                                                           "running, over the 3h limit: stuck"}
    [stuck] = h["tiers"][T3]["stuck_runs"]
    assert (stuck["started_at"], stuck["running_hours"]) == (iso_ago(4), 4.0)


def test_failing_outranks_stale_and_the_worst_reasons_come_first(db):
    _world(db, t3=200)
    _run(db, T2, "failed", ago(1), ago(0.5), error="feed list unreadable")
    h = _report(db)
    assert h["verdict"] == "failing"
    assert [r["level"] for r in h["reasons"]] == ["failing", "stale", "ok", "ok"]


# ── the health check: window math, stuck runs, freshness, TIER2_RUN_AT ──────

@pytest.mark.parametrize("age, within", [(72, True), (72.0003, False)], ids=["on the edge", "a second past"])
def test_a_tiers_age_is_measured_against_its_window_edge_included(db, age, within):
    _world(db, t2=age)
    t2 = _report(db)["tiers"][T2]
    assert (t2["window_hours"], t2["within_window"], t2["on_restart"]["runs_now"]) == (72, within, not within)
    assert t2["on_restart"]["runs_after"] == (NOW - timedelta(hours=age) + timedelta(hours=72)).isoformat()


def test_each_tier_is_measured_against_its_own_setting(db, monkeypatch):
    """TIER2_SCHEDULE_HOURS and TIER3_SCHEDULE_HOURS, read when asked, as the boot guard reads them."""
    _world(db, t2=30, t3=100)
    assert [_report(db)["tiers"][t]["within_window"] for t in (T2, T3)] == [True, True]
    monkeypatch.setattr(settings, "TIER2_SCHEDULE_HOURS", 24)
    monkeypatch.setattr(settings, "TIER3_SCHEDULE_HOURS", 96)
    tiers = _report(db)["tiers"]
    assert [(tiers[t]["window_hours"], tiers[t]["within_window"]) for t in (T2, T3)] == [(24, False), (96, False)]
    assert tiers[T2]["on_restart"] == {"runs_now": True, "runs_after": iso_ago(6)}


@pytest.mark.parametrize("hours, stuck", [(2.9, False), (3, False), (3.01, True)])
def test_a_run_is_stuck_once_it_has_run_over_three_hours(db, hours, stuck):
    _world(db)
    _run(db, T2, "running", ago(hours))
    h = _report(db)
    assert (h["tiers"][T2]["recent"]["running"], h["tiers"][T2]["recent"]["stuck"]) == (1, int(stuck))
    assert (h["verdict"] == "failing") is stuck


def test_failed_and_stuck_runs_are_counted_among_the_newest_ten(db):
    _world(db)
    _run(db, T2, "running", ago(48))  # stuck, but now the 12th newest
    for i in range(10):
        _run(db, T2, "completed", ago(10 + i), ago(9.5 + i))
    h = _report(db)
    assert h["tiers"][T2]["recent"] == {"runs": 10, "completed": 10, "failed": 0, "running": 0, "stuck": 0}
    assert h["verdict"] == "healthy"


def test_freshness_counts_the_articles_that_arrived_in_the_last_72_hours(db):
    _world(db, articles=(0.5, 71.9, 72, 72.01, 300))
    assert _report(db)["freshness"] == {"newest_article_at": iso_ago(0.5), "newest_age_hours": 0.5,
                                        "articles_in_window": 3, "window_hours": 72}


ONE_OFF = {
    "unset": ("", None),
    "scheduled": ("2026-10-08T01:00:00-07:00", "scheduled"),
    "a Z time": ("2026-10-08T08:00:00Z", "scheduled"),
    "passed": ("2026-10-07T21:00:00-07:00", "passed"),
    "no zone": ("2026-10-08T01:00:00", "invalid"),
    "unreadable": ("tomorrow 1am", "invalid"),
}


@pytest.mark.parametrize("raw, state", ONE_OFF.values(), ids=ONE_OFF.keys())
def test_tier2_run_at_is_shown_when_set_as_the_boot_reads_it(db, monkeypatch, raw, state):
    """GUR-281's one-off tier 2 run. "scheduled" exactly when a boot would schedule it."""
    monkeypatch.setattr(settings, "TIER2_RUN_AT", raw)
    one = _report(db)["tier2_run_at"]
    assert (one and one["state"]) == state
    assert (state == "scheduled") is (orch.one_off_tier2_at(raw, now=NOW) is not None)
    if state == "scheduled":
        assert (one["value"], one["at"], one["in_hours"]) == (raw, "2026-10-08T08:00:00+00:00", 3.0)
    elif state == "invalid":
        assert one["at"] is None and "a boot schedules nothing" in one["note"]


# ── the route and make ingestion-health ──────────────────────────────────────

@pytest.fixture
def api(db, monkeypatch):
    from app.main import app
    admin = User(id=uuid.uuid4(), email=ADMIN, password_hash="x", is_active=True)
    reader = User(id=uuid.uuid4(), email=READER, password_hash="x", is_active=True)
    tokens = {"admin": generate_jwt(admin.id, "access"), "reader": generate_jwt(reader.id, "access")}
    with db() as s:
        s.add_all([admin, reader])
        s.commit()
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    monkeypatch.setenv("ADMIN_API_KEY", KEY)
    monkeypatch.setattr(ingestion_health, "datetime", _Clock)  # the route reads the clock itself

    def _get_db():
        s = db()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db

    async def get(path, token=None, key=None):
        headers = {"Authorization": f"Bearer {tokens[token]}"} if token else {}
        if key is not None:
            headers["X-Admin-Key"] = key
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            return await c.get(path, headers=headers)

    yield get
    app.dependency_overrides.pop(get_db, None)


async def test_the_health_check_needs_an_admin_or_the_key(api):
    assert (await api(HEALTH)).status_code == 401
    assert (await api(HEALTH, token="reader")).status_code == 403
    assert (await api(HEALTH, key="wrong" * 10)).status_code == 403
    assert (await api(HEALTH, token="admin")).status_code == 200
    assert (await api(HEALTH, key=KEY)).status_code == 200


async def test_the_route_serves_the_report(api, db):
    _world(db, t3=169)
    r = await api(HEALTH, key=KEY)
    assert r.status_code == 200
    assert r.json() == _report(db)
    assert set(r.json()) == {"verdict", "reasons", "checked_at", "thresholds", "tiers", "tier2_run_at", "freshness"}
    assert r.json()["verdict"] == "stale"


def _script(monkeypatch):
    monkeypatch.syspath_prepend(SCRIPTS)
    spec = importlib.util.spec_from_file_location("ingestion_health_cli", os.path.join(SCRIPTS, "ingestion_health.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_make_ingestion_health_prints_the_verdict_first_and_exits_1_only_on_failing(db, monkeypatch, capsys):
    """scripts/ingestion_health.py reads through the route itself, so the terminal and the API can't drift."""
    cli = _script(monkeypatch)
    monkeypatch.setattr(ingestion_health, "datetime", _Clock)
    monkeypatch.setattr(sys, "argv", ["ingestion_health.py"])
    monkeypatch.setattr(settings, "TIER2_RUN_AT", "2026-10-08T01:00:00-07:00")
    _world(db, t3=169)

    assert cli.main() == 0, "stale is worth reading, not stopping on"
    out = capsys.readouterr().out
    assert out.startswith("Ingestion: STALE  (checked ")
    for line in ("\n  [WARN] Tier 3 (web discovery): last completed 169.0h ago, past its 168h window, so a restart "
                 "starts a paid run now\n",
                 "\n  [ OK ] Tier 2 (luminary RSS): completed 20.0h ago, inside its 72h window\n",
                 "\nTier 2 (luminary RSS), window 72h\n", ", 20.0h ago: found 120, ingested 41, rejected 79\n",
                 "\n  recent runs     the newest 1: 1 completed, 0 failed, 0 running, 0 stuck (running over 3h)\n",
                 "\n  TIER2_RUN_AT    2026-10-08T01:00:00-07:00: scheduled (",
                 "\nTier 3 (web discovery), window 168h\n",
                 "\n  on a restart    a paid run starts now (the boot guard finds no completion inside the window)\n",
                 "\n  arrived         2 articles\n"):
        assert line in out, line

    _run(db, T2, "failed", ago(1), ago(0.5), error="feed list unreadable")
    assert cli.main() == 1
    out = capsys.readouterr().out
    assert out.startswith("Ingestion: FAILING")
    assert "\n  [BAD ] Tier 2 (luminary RSS): the last run failed 0.5h ago: feed list unreadable\n" in out
    assert "\n    failed  " in out and "  feed list unreadable\n" in out
