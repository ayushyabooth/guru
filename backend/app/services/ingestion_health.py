"""
Is ingestion keeping the feed alive? One read of the database, for GET /api/v1/admin/ingestion/health
(app/routes/ingestion.py) and make ingestion-health (scripts/ingestion_health.py), GUR-283.

For each tier it reports the last completed run (when, found, ingested, rejected) and its age against
the tier's window, the failed and stuck runs among its newest RECENT_RUNS, and when the boot guard
(IngestionOrchestrator._should_run_tier) would start a paid run on a restart. Then the one-off tier 2
run TIER2_RUN_AT asks for, if set, and content freshness: the newest article's age and how many
articles arrived in the last FRESH_HOURS.

The verdict is the worst of its reasons:
- failing: a tier's last run failed, or one of its recent runs is stuck (still "running" after
  STUCK_AFTER_HOURS, when a run takes one to two hours);
- stale: a tier is past its window, so the next restart starts a paid run, or no new article
  arrived in FRESH_HOURS;
- healthy: neither.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.article import Article
from app.models.ingestion_run import IngestionRun

RECENT_RUNS = 10       # failed and stuck runs are counted among each tier's newest 10
STUCK_AFTER_HOURS = 3  # a run takes one to two hours; one still "running" after 3 is stuck
FRESH_HOURS = 72       # no new article in this long and the feed is going stale
LEVELS = ("ok", "stale", "failing")  # a reason's level, mildest first: the verdict is the worst one
TIERS = {"tier2_luminary": "Tier 2 (luminary RSS)", "tier3_discovery": "Tier 3 (web discovery)"}


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    """A stored time as aware UTC. SQLite hands back naive UTC, Postgres an aware time."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return _utc(dt).isoformat() if dt else None


def _hours(delta: timedelta) -> float:
    return round(delta.total_seconds() / 3600, 1)


def _first_line(text: Optional[str]) -> str:
    return (text or "").strip().splitlines()[0] if (text or "").strip() else "no error recorded"


def window_hours(tier: str) -> int:
    """The tier's schedule window, read when asked, as the boot guard reads it."""
    return settings.TIER2_SCHEDULE_HOURS if tier == "tier2_luminary" else settings.TIER3_SCHEDULE_HOURS


def _tier(db: Session, tier: str, now: datetime):
    """One tier's runs against its window. Returns its section of the report and its reasons."""
    label, window = TIERS[tier], window_hours(tier)
    # The boot guard's own rule: only a completed run with a completion time counts.
    done = (db.query(IngestionRun)
            .filter(IngestionRun.tier == tier, IngestionRun.status == "completed",
                    IngestionRun.completed_at.isnot(None))
            .order_by(IngestionRun.completed_at.desc())
            .first())
    recent = (db.query(IngestionRun).filter(IngestionRun.tier == tier)
              .order_by(IngestionRun.started_at.desc()).limit(RECENT_RUNS).all())
    stuck = [r for r in recent if r.status == "running" and r.started_at is not None
             and now - _utc(r.started_at) > timedelta(hours=STUCK_AFTER_HOURS)]
    failed = [r for r in recent if r.status == "failed"]
    last = recent[0] if recent else None

    age = now - _utc(done.completed_at) if done else None
    within = age is not None and age <= timedelta(hours=window)
    reasons = []
    if last is not None and last.status == "failed":
        when = _utc(last.completed_at or last.started_at)
        ago = f" {_hours(now - when)}h ago" if when else ""
        reasons.append(("failing", f"{label}: the last run failed{ago}: {_first_line(last.error_message)}"))
    for r in stuck:
        reasons.append(("failing", f"{label}: a run started {_hours(now - _utc(r.started_at))}h ago is still "
                                   f"running, over the {STUCK_AFTER_HOURS}h limit: stuck"))
    if done is None:
        reasons.append(("stale", f"{label}: no completed run on record, so a restart starts a paid run now"))
    elif not within:
        reasons.append(("stale", f"{label}: last completed {_hours(age)}h ago, past its {window}h window, "
                                 f"so a restart starts a paid run now"))
    else:
        reasons.append(("ok", f"{label}: completed {_hours(age)}h ago, inside its {window}h window"))

    section = {
        "tier": tier,
        "label": label,
        "window_hours": window,
        "last_completed": {
            "id": str(done.id), "started_at": _iso(done.started_at), "completed_at": _iso(done.completed_at),
            "found": done.articles_found or 0, "ingested": done.articles_ingested or 0,
            "rejected": done.articles_rejected or 0,
        } if done else None,
        "age_hours": _hours(age) if done else None,
        "within_window": within,
        "last_run": {
            "id": str(last.id), "status": last.status, "started_at": _iso(last.started_at),
            "completed_at": _iso(last.completed_at), "error": last.error_message,
        } if last else None,
        "recent": {
            "runs": len(recent), "completed": sum(r.status == "completed" for r in recent),
            "failed": len(failed), "running": sum(r.status == "running" for r in recent), "stuck": len(stuck),
        },
        "failed_runs": [{"id": str(r.id), "started_at": _iso(r.started_at), "completed_at": _iso(r.completed_at),
                         "error": r.error_message} for r in failed],
        "stuck_runs": [{"id": str(r.id), "started_at": _iso(r.started_at),
                        "running_hours": _hours(now - _utc(r.started_at))} for r in stuck],
        # A restart runs the tier unless its last completion is inside the window, edge included.
        "on_restart": {
            "runs_now": not within,
            "runs_after": _iso(_utc(done.completed_at) + timedelta(hours=window)) if done else None,
        },
    }
    return section, reasons


def _freshness(db: Session, now: datetime):
    """The newest article's age and how many arrived in the last FRESH_HOURS."""
    newest = _utc(db.query(func.max(Article.created_at)).scalar())
    since = now - timedelta(hours=FRESH_HOURS)
    arrived = db.query(func.count(Article.id)).filter(Article.created_at >= since).scalar() or 0
    age = _hours(now - newest) if newest else None
    if newest is None:
        reason = ("stale", "No articles in the database at all")
    elif not arrived:
        reason = ("stale", f"No new article in {FRESH_HOURS}h: the newest arrived {age}h ago")
    else:
        reason = ("ok", f"{arrived} article{'s' if arrived != 1 else ''} arrived in the last {FRESH_HOURS}h, "
                        f"the newest {age}h ago")
    return {"newest_article_at": _iso(newest), "newest_age_hours": age, "articles_in_window": arrived,
            "window_hours": FRESH_HOURS}, [reason]


def one_off(raw: str, now: datetime) -> Optional[dict]:
    """TIER2_RUN_AT as a boot reads it (ingestion_orchestrator.one_off_tier2_at, GUR-281): a future time with
    a zone is scheduled; a past, zoneless or unreadable one schedules nothing. Read here without the boot's
    log lines. A future time was also future when this server booted, so this server has it scheduled."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return {"value": raw, "state": "invalid", "at": None, "note": "not an ISO time, so a boot schedules nothing"}
    if at.tzinfo is None:
        return {"value": raw, "state": "invalid", "at": None, "note": "no time zone, so a boot schedules nothing"}
    at = at.astimezone(timezone.utc)
    if at <= now:
        return {"value": raw, "state": "passed", "at": at.isoformat(),
                "note": "the time has passed, so a restart schedules nothing; unset it"}
    return {"value": raw, "state": "scheduled", "at": at.isoformat(), "in_hours": _hours(at - now),
            "note": "one tier 2 run then; a restart before it keeps it, a restart during the run kills it"}


def report(db: Session, now: Optional[datetime] = None) -> dict:
    """The health report: the verdict and its reasons (worst first), each tier, the one-off, freshness."""
    now = now or datetime.now(timezone.utc)
    tiers, reasons = {}, []
    for tier in TIERS:
        tiers[tier], found = _tier(db, tier, now)
        reasons += found
    fresh, found = _freshness(db, now)
    reasons += found
    worst = max((level for level, _ in reasons), key=LEVELS.index, default="ok")
    ordered = sorted(reasons, key=lambda r: -LEVELS.index(r[0]))  # stable: tier order within a level
    return {
        "verdict": "healthy" if worst == "ok" else worst,
        "reasons": [{"level": level, "text": text} for level, text in ordered],
        "checked_at": now.isoformat(),
        "thresholds": {"recent_runs": RECENT_RUNS, "stuck_after_hours": STUCK_AFTER_HOURS, "fresh_hours": FRESH_HOURS},
        "tiers": tiers,
        "tier2_run_at": one_off(settings.TIER2_RUN_AT, now),
        "freshness": fresh,
    }
