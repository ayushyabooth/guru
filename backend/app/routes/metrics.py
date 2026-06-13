"""
Metrics API routes for tracking user activity and rings progress.
"""
import uuid
from datetime import datetime, date, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.metric import TimeLog, DailyMetric


router = APIRouter(prefix="/api/v1", tags=["metrics"])

# A single logged reading/listening session can never legitimately exceed this.
# Clamp every logged duration to it so one runaway client (e.g. a tab left open,
# a tracker that doesn't pause) can't poison a day's rollup. (GUR-234)
MAX_SESSION_SECONDS = 4 * 60 * 60  # 4 hours


class LogTimeRequest(BaseModel):
    ring_type: str = Field(..., pattern="^(catchup|divein|recap)$")
    duration_seconds: int = Field(..., ge=0)
    context_id: str | None = None
    started_at: datetime
    ended_at: datetime
    # New fields for granular tracking
    industry: str | None = None
    specialization: str | None = None
    activity_type: str | None = None  # 'storyboard', 'card', 'qa', 'article', 'socratic'
    idle_seconds: int = 0


class TimeLogResponse(BaseModel):
    id: str
    ring_type: str
    duration_seconds: int
    context_id: str | None
    started_at: datetime
    ended_at: datetime
    created_at: datetime
    industry: str | None = None
    specialization: str | None = None
    activity_type: str | None = None
    idle_seconds: int = 0


class DailyMetricResponse(BaseModel):
    metric_date: date
    catchup_minutes: int
    catchup_goal_met: bool
    divein_minutes: int
    recap_completed: bool


class MetricsSummaryResponse(BaseModel):
    today: DailyMetricResponse
    week: List[DailyMetricResponse]
    total_catchup_minutes: int
    total_divein_minutes: int
    total_recap_sessions: int
    current_streak: int
    recap_journey_status: str | None = None
    # GUR-13: weekly activity stats for the Home dashboard
    articles_read: int = 0
    articles_saved: int = 0
    filters_explored: int = 0
    top_topics: list[dict] = Field(default_factory=list)
    # GUR-231: notes the user wrote this week (annotations with note text).
    # Defaults to 0 so older clients are unaffected.
    notes_this_week: int = 0
    # GUR-232: today-scoped activity stats so the Home Today|Week toggle can
    # show daily numbers (default day). Week-scoped fields above stay for the
    # Week view. All default 0/empty so older clients are unaffected.
    articles_read_today: int = 0
    notes_today: int = 0
    top_topics_today: list[dict] = Field(default_factory=list)
    # Recap ring follows the toggle window (founder): did the user reflect in
    # this window? recap_completed_today drives the Today ring; this_week the Week ring.
    recap_completed_today: bool = False
    recap_completed_this_week: bool = False


@router.post("/metrics/log-time", response_model=TimeLogResponse, status_code=status.HTTP_201_CREATED)
async def log_time(
    request: LogTimeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Log time spent on a ring activity (catchup, divein, recap).
    Updates daily metrics automatically.
    """
    # Get user's profile for default industry/specialization if not provided
    industry = request.industry
    specialization = request.specialization

    if not industry and current_user.profile:
        industry = current_user.profile.core_industry
    if not specialization and current_user.profile and current_user.profile.specializations:
        # Use first specialization as default
        specs = current_user.profile.specializations
        if isinstance(specs, list) and len(specs) > 0:
            specialization = specs[0]

    # Clamp client-reported durations (GUR-234): a single session can't exceed a
    # sane cap, and never goes negative. Defends the rollup from buggy trackers.
    dur = min(max(0, request.duration_seconds), MAX_SESSION_SECONDS)
    idle = min(max(0, request.idle_seconds or 0), MAX_SESSION_SECONDS)

    # Create time log with enhanced fields
    time_log = TimeLog(
        user_id=current_user.id,
        ring_type=request.ring_type,
        duration_seconds=dur,
        context_id=request.context_id,
        started_at=request.started_at,
        ended_at=request.ended_at,
        industry=industry,
        specialization=specialization,
        activity_type=request.activity_type,
        idle_seconds=idle,
    )
    db.add(time_log)
    
    # Update daily metrics
    metric_date = request.started_at.date()
    daily_metric = db.query(DailyMetric).filter(
        DailyMetric.user_id == current_user.id,
        DailyMetric.metric_date == metric_date
    ).first()
    
    if not daily_metric:
        daily_metric = DailyMetric(
            user_id=current_user.id,
            metric_date=metric_date
        )
        db.add(daily_metric)
    
    # Recompute daily totals from time_logs (avoids integer truncation of short sessions)
    from sqlalchemy import func
    day_totals = db.query(
        TimeLog.ring_type,
        func.sum(TimeLog.duration_seconds).label("total_secs"),
    ).filter(
        TimeLog.user_id == current_user.id,
        func.date(TimeLog.started_at) == metric_date,
    ).group_by(TimeLog.ring_type).all()

    # Include the current (not yet committed) log
    extra = {request.ring_type: dur}
    for row in day_totals:
        extra[row.ring_type] = (extra.get(row.ring_type, 0) + (row.total_secs or 0))

    daily_metric.catchup_minutes = extra.get("catchup", 0) // 60
    daily_metric.divein_minutes = extra.get("divein", 0) // 60
    if daily_metric.catchup_minutes >= 20:
        daily_metric.catchup_goal_met = True
    if request.ring_type == "recap":
        daily_metric.recap_completed = True
    
    db.commit()
    db.refresh(time_log)
    
    return TimeLogResponse(
        id=str(time_log.id),
        ring_type=time_log.ring_type,
        duration_seconds=time_log.duration_seconds,
        context_id=time_log.context_id,
        started_at=time_log.started_at,
        ended_at=time_log.ended_at,
        created_at=time_log.created_at,
        industry=time_log.industry,
        specialization=time_log.specialization,
        activity_type=time_log.activity_type,
        idle_seconds=time_log.idle_seconds or 0,
    )



@router.get("/me/notes")
async def get_my_recent_notes(
    days: int = 7,
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The user's recent notes across all articles (R23: the weekly recap is
    built from what the user THOUGHT — their notes — not just what they read)."""
    from app.models.interaction import UserAnnotation
    from app.models.article import Article
    since = date.today() - timedelta(days=max(1, min(days, 30)) - 1)
    rows = (
        db.query(UserAnnotation, Article.title)
        .join(Article, Article.id == UserAnnotation.article_id)
        .filter(
            UserAnnotation.user_id == current_user.id,
            func.date(UserAnnotation.created_at) >= since,
            UserAnnotation.note_text.isnot(None),
            UserAnnotation.note_text != "",
        )
        .order_by(UserAnnotation.created_at.desc())
        .limit(max(1, min(limit, 25)))
        .all()
    )
    return {
        "notes": [
            {
                "article_id": str(a.article_id),
                "article_title": title,
                "note": a.note_text,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a, title in rows
        ]
    }

@router.get("/me/metrics", response_model=MetricsSummaryResponse)
async def get_metrics_summary(
    filter: str | None = Query(
        None,
        description="Scope the dashboard to a Home content filter: None/'all' = aggregate, 'core', 'specialization:<name>', or 'interest:<name>'",
    ),
    tz: str | None = Query(
        None,
        description="Client IANA timezone (e.g. 'America/Los_Angeles'). 'Today'/'Week' are bucketed in this local day; defaults to UTC when absent/invalid. (GUR-234)",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get comprehensive metrics summary for the current user.
    Includes today's metrics, weekly history, and totals.

    When `filter` selects a specific Home content filter, the rings (today +
    week catch-up/dive-in minutes) and activity stats are scoped to TimeLogs
    tagged with that industry/specialization. Recap status, streak and all-time
    totals stay cross-filter (they are habit/weekly concepts, not per-filter).
    """
    # ── User-local "today"/"week" (GUR-234) ───────────────────────────────
    # The Home Today|Week toggle must reflect the USER's day, not the server's
    # UTC day. The client sends its IANA timezone; we bucket every TimeLog into
    # the user's local calendar day. Falls back to UTC when tz is absent/invalid.
    def _safe_tz(tz_in: str | None) -> str:
        if not tz_in:
            return "UTC"
        try:
            db.query(func.timezone(tz_in, func.now())).scalar()
            return tz_in
        except Exception:
            db.rollback()
            return "UTC"

    tzname = _safe_tz(tz)

    def LD(col):
        """Local calendar date of a tz-aware timestamp, in the user's zone."""
        return func.date(func.timezone(tzname, col))

    today = db.query(func.date(func.timezone(tzname, func.now()))).scalar()
    week_ago = today - timedelta(days=6)
    week_dates = [week_ago + timedelta(days=i) for i in range(7)]

    # Clamp every row's duration so one runaway log can't dominate a day total.
    _secs = func.sum(func.least(TimeLog.duration_seconds, MAX_SESSION_SECONDS))

    # ── Resolve the Home content filter to a TimeLog column + value ──────
    def _resolve_filter():
        if not filter or filter == "all":
            return None
        if filter == "core":
            core = getattr(getattr(current_user, "profile", None), "core_industry", None)
            return (TimeLog.industry, core) if core else None
        if filter.startswith("specialization:"):
            return (TimeLog.specialization, filter.split(":", 1)[1])
        if filter.startswith("interest:"):
            return (TimeLog.industry, filter.split(":", 1)[1])
        return None

    filter_match = _resolve_filter()

    # ── Per-local-day catch-up/dive-in minutes, straight from TimeLogs ─────
    # Single source of truth (the legacy DailyMetric rollup is UTC-keyed and no
    # longer trusted for the toggle). {local_date_str: {ring: minutes}}
    day_q = db.query(
        LD(TimeLog.started_at).label("d"),
        TimeLog.ring_type,
        _secs.label("secs"),
    ).filter(
        TimeLog.user_id == current_user.id,
        LD(TimeLog.started_at) >= week_ago,
        LD(TimeLog.started_at) <= today,
    )
    if filter_match is not None:
        day_q = day_q.filter(filter_match[0] == filter_match[1])
    day_minutes: dict = {}
    for r in day_q.group_by(LD(TimeLog.started_at), TimeLog.ring_type).all():
        day_minutes.setdefault(str(r.d), {})[r.ring_type] = int(r.secs or 0) // 60

    def _day_min(d, ring: str) -> int:
        return day_minutes.get(str(d), {}).get(ring, 0)

    # ── Recap completion by local day (drives the recap ring) ──────────────
    from app.models.recap import RecapJourney
    recap_dates = {
        str(d)
        for (d,) in db.query(LD(RecapJourney.completed_at))
        .filter(
            RecapJourney.user_id == current_user.id,
            RecapJourney.status == "completed",
            RecapJourney.completed_at.isnot(None),
            LD(RecapJourney.completed_at) >= week_ago,
            LD(RecapJourney.completed_at) <= today,
        )
        .distinct()
        .all()
    }
    recap_completed_today = str(today) in recap_dates
    recap_completed_this_week = len(recap_dates) > 0

    def _daily(d) -> DailyMetricResponse:
        cm = _day_min(d, "catchup")
        return DailyMetricResponse(
            metric_date=d,
            catchup_minutes=cm,
            catchup_goal_met=cm >= 20,
            divein_minutes=_day_min(d, "divein"),
            recap_completed=str(d) in recap_dates,
        )

    today_daily = _daily(today)
    week_daily = [_daily(d) for d in week_dates]

    # ── All-time totals (clamped, from TimeLogs) ───────────────────────────
    tot_map = {
        r.ring_type: int(r.secs or 0) // 60
        for r in db.query(TimeLog.ring_type, _secs.label("secs"))
        .filter(TimeLog.user_id == current_user.id)
        .group_by(TimeLog.ring_type)
        .all()
    }
    total_catchup_minutes = tot_map.get("catchup", 0)
    total_divein_minutes = tot_map.get("divein", 0)
    total_recap_sessions = (
        db.query(func.count(RecapJourney.id))
        .filter(
            RecapJourney.user_id == current_user.id,
            RecapJourney.status == "completed",
        )
        .scalar()
        or 0
    )

    # ── Current streak: consecutive local days (ending today) that hit the
    # catch-up goal, computed from TimeLogs over a bounded look-back. ──────
    streak_start = today - timedelta(days=60)
    catchup_by_date = {
        str(r.d): int(r.secs or 0) // 60
        for r in db.query(LD(TimeLog.started_at).label("d"), _secs.label("secs"))
        .filter(
            TimeLog.user_id == current_user.id,
            TimeLog.ring_type == "catchup",
            LD(TimeLog.started_at) >= streak_start,
        )
        .group_by(LD(TimeLog.started_at))
        .all()
    }
    current_streak = 0
    _cur = today
    while catchup_by_date.get(str(_cur), 0) >= 20:
        current_streak += 1
        _cur = _cur - timedelta(days=1)

    # Most-recent recap journey status for the ring's in-progress state.
    recap_journey = (
        db.query(RecapJourney)
        .filter(RecapJourney.user_id == current_user.id)
        .order_by(RecapJourney.created_at.desc())
        .first()
    )
    recap_journey_status = recap_journey.status if recap_journey else None
    
    # ── Activity stats (week + today), bucketed in the user's local day ────
    # TimeLog-derived stats key off started_at (matching the minutes above); note
    # counts key off the annotation's created_at. (GUR-234 removes the prior
    # started_at/created_at split that made "today" disagree across chips.)
    articles_read = articles_saved = filters_explored = 0
    notes_this_week = articles_read_today = notes_today = 0
    top_topics: list[dict] = []
    top_topics_today: list[dict] = []
    try:
        from app.models.interaction import UserSavedArticle, UserAnnotation

        def _reads(lo, hi):
            q = db.query(func.count(func.distinct(TimeLog.context_id))).filter(
                TimeLog.user_id == current_user.id,
                LD(TimeLog.started_at) >= lo,
                LD(TimeLog.started_at) <= hi,
                TimeLog.context_id.isnot(None),
                TimeLog.ring_type.in_(["catchup", "divein"]),
            )
            if filter_match is not None:
                q = q.filter(filter_match[0] == filter_match[1])
            return q.scalar() or 0

        articles_read = _reads(week_ago, today)
        articles_read_today = _reads(today, today)

        articles_saved = db.query(func.count(UserSavedArticle.id)).filter(
            UserSavedArticle.user_id == current_user.id,
        ).scalar() or 0

        filters_explored = db.query(func.count(func.distinct(TimeLog.industry))).filter(
            TimeLog.user_id == current_user.id,
            LD(TimeLog.started_at) >= week_ago,
            LD(TimeLog.started_at) <= today,
            TimeLog.industry.isnot(None),
        ).scalar() or 0

        def _topics(lo, hi):
            q = db.query(
                TimeLog.specialization, func.count(TimeLog.id).label("cnt")
            ).filter(
                TimeLog.user_id == current_user.id,
                LD(TimeLog.started_at) >= lo,
                LD(TimeLog.started_at) <= hi,
                TimeLog.specialization.isnot(None),
                # storyboard-view read-markers (0-duration) shouldn't skew topic
                # ranking — they count toward articles_read only. (GUR-234)
                TimeLog.activity_type.is_distinct_from("storyboard_view"),
            )
            if filter_match is not None:
                q = q.filter(filter_match[0] == filter_match[1])
            rows = q.group_by(TimeLog.specialization).order_by(
                func.count(TimeLog.id).desc()
            ).limit(3).all()
            return [{"name": r[0], "count": int(r[1])} for r in rows if r[0]]

        top_topics = _topics(week_ago, today)
        top_topics_today = _topics(today, today)

        def _notes(lo, hi):
            return db.query(func.count(UserAnnotation.id)).filter(
                UserAnnotation.user_id == current_user.id,
                LD(UserAnnotation.created_at) >= lo,
                LD(UserAnnotation.created_at) <= hi,
                UserAnnotation.note_text.isnot(None),
                UserAnnotation.note_text != "",
            ).scalar() or 0

        notes_this_week = _notes(week_ago, today)
        notes_today = _notes(today, today)
    except Exception:
        db.rollback()
        articles_read = articles_saved = filters_explored = 0
        notes_this_week = articles_read_today = notes_today = 0
        top_topics = []
        top_topics_today = []

    return MetricsSummaryResponse(
        today=today_daily,
        week=week_daily,
        total_catchup_minutes=int(total_catchup_minutes),
        total_divein_minutes=int(total_divein_minutes),
        total_recap_sessions=int(total_recap_sessions),
        current_streak=current_streak,
        recap_journey_status=recap_journey_status,
        articles_read=int(articles_read),
        articles_saved=int(articles_saved),
        filters_explored=int(filters_explored),
        top_topics=top_topics,
        notes_this_week=int(notes_this_week),
        articles_read_today=int(articles_read_today),
        notes_today=int(notes_today),
        top_topics_today=top_topics_today,
        recap_completed_today=recap_completed_today,
        recap_completed_this_week=recap_completed_this_week,
    )
