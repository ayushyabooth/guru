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

    # Create time log with enhanced fields
    time_log = TimeLog(
        user_id=current_user.id,
        ring_type=request.ring_type,
        duration_seconds=request.duration_seconds,
        context_id=request.context_id,
        started_at=request.started_at,
        ended_at=request.ended_at,
        industry=industry,
        specialization=specialization,
        activity_type=request.activity_type,
        idle_seconds=request.idle_seconds,
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
    extra = {request.ring_type: request.duration_seconds}
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
    today = date.today()
    week_ago = today - timedelta(days=6)

    # ── Resolve the Home content filter to a TimeLog column + value ──────
    # Returns (column, value) or None for the aggregate ("all") view.
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

    # Per-day catch-up/dive-in minutes for the active filter, computed straight
    # from TimeLogs (the DailyMetric rollup is aggregate-only). {date: {ring: min}}
    filtered_day_minutes: dict = {}
    if filter_match is not None:
        col, val = filter_match
        rows = db.query(
            func.date(TimeLog.started_at).label("d"),
            TimeLog.ring_type,
            func.sum(TimeLog.duration_seconds).label("secs"),
        ).filter(
            TimeLog.user_id == current_user.id,
            func.date(TimeLog.started_at) >= week_ago,
            func.date(TimeLog.started_at) <= today,
            col == val,
        ).group_by(func.date(TimeLog.started_at), TimeLog.ring_type).all()
        for r in rows:
            day = filtered_day_minutes.setdefault(str(r.d), {})
            day[r.ring_type] = (r.secs or 0) // 60

    def _scoped(metric_date, ring: str, fallback: int) -> int:
        """Filtered minutes for a day/ring, or the aggregate fallback."""
        if filter_match is None:
            return fallback
        return filtered_day_minutes.get(str(metric_date), {}).get(ring, 0)
    
    # Get or create today's metric
    today_metric = db.query(DailyMetric).filter(
        DailyMetric.user_id == current_user.id,
        DailyMetric.metric_date == today
    ).first()
    
    if not today_metric:
        today_metric = DailyMetric(
            user_id=current_user.id,
            metric_date=today,
            catchup_minutes=0,
            catchup_goal_met=False,
            divein_minutes=0,
            recap_completed=False,
        )
        db.add(today_metric)
        db.commit()
        db.refresh(today_metric)
    
    # Get week's metrics
    week_metrics = db.query(DailyMetric).filter(
        DailyMetric.user_id == current_user.id,
        DailyMetric.metric_date >= week_ago,
        DailyMetric.metric_date <= today
    ).order_by(DailyMetric.metric_date).all()
    
    # Calculate totals (all time)
    totals = db.query(
        func.sum(DailyMetric.catchup_minutes).label("total_catchup"),
        func.sum(DailyMetric.divein_minutes).label("total_divein"),
        func.sum(func.cast(DailyMetric.recap_completed, Integer)).label("total_recaps")
    ).filter(
        DailyMetric.user_id == current_user.id
    ).first()
    
    # Calculate current streak (consecutive days with catchup goal met)
    current_streak = 0
    check_date = today
    while True:
        metric = db.query(DailyMetric).filter(
            DailyMetric.user_id == current_user.id,
            DailyMetric.metric_date == check_date
        ).first()
        
        if metric and metric.catchup_goal_met:
            current_streak += 1
            check_date -= timedelta(days=1)
        else:
            break
        
        # Safety limit
        if current_streak > 365:
            break
    
    # Get current week's recap journey status
    from app.models.recap import RecapJourney
    from sqlalchemy import and_
    week_start = today - timedelta(days=today.weekday())  # Monday
    recap_journey = db.query(RecapJourney).filter(
        and_(
            RecapJourney.user_id == current_user.id,
            RecapJourney.week_start == week_start,
        )
    ).order_by(RecapJourney.created_at.desc()).first()
    recap_journey_status = recap_journey.status if recap_journey else None

    # GUR-13: weekly activity stats for Home dashboard (best-effort; 0 on error)
    articles_read = 0
    articles_saved = 0
    filters_explored = 0
    top_topics: list[dict] = []
    notes_this_week = 0
    try:
        from app.models.interaction import UserSavedArticle, UserAnnotation
        read_q = db.query(func.count(func.distinct(TimeLog.context_id))).filter(
            TimeLog.user_id == current_user.id,
            func.date(TimeLog.created_at) >= week_ago,
            TimeLog.context_id.isnot(None),
            TimeLog.ring_type.in_(["catchup", "divein"]),
        )
        if filter_match is not None:
            read_q = read_q.filter(filter_match[0] == filter_match[1])
        articles_read = read_q.scalar() or 0

        articles_saved = db.query(func.count(UserSavedArticle.id)).filter(
            UserSavedArticle.user_id == current_user.id,
        ).scalar() or 0

        filters_explored = db.query(func.count(func.distinct(TimeLog.industry))).filter(
            TimeLog.user_id == current_user.id,
            func.date(TimeLog.created_at) >= week_ago,
            TimeLog.industry.isnot(None),
        ).scalar() or 0

        topic_q = db.query(
            TimeLog.specialization, func.count(TimeLog.id).label("cnt")
        ).filter(
            TimeLog.user_id == current_user.id,
            func.date(TimeLog.created_at) >= week_ago,
            TimeLog.specialization.isnot(None),
        )
        if filter_match is not None:
            topic_q = topic_q.filter(filter_match[0] == filter_match[1])
        topic_rows = topic_q.group_by(TimeLog.specialization).order_by(func.count(TimeLog.id).desc()).limit(3).all()
        top_topics = [{"name": r[0], "count": int(r[1])} for r in topic_rows if r[0]]

        # GUR-231: notes written this week (same window as the stats above).
        # UserAnnotation rows with non-empty note_text (highlights-only excluded).
        notes_this_week = db.query(func.count(UserAnnotation.id)).filter(
            UserAnnotation.user_id == current_user.id,
            func.date(UserAnnotation.created_at) >= week_ago,
            UserAnnotation.note_text.isnot(None),
            UserAnnotation.note_text != "",
        ).scalar() or 0
    except Exception:
        # Never let stats computation break the metrics endpoint
        pass

    return MetricsSummaryResponse(
        today=DailyMetricResponse(
            metric_date=today_metric.metric_date,
            catchup_minutes=_scoped(today_metric.metric_date, "catchup", today_metric.catchup_minutes or 0),
            catchup_goal_met=(_scoped(today_metric.metric_date, "catchup", 0) >= 20) if filter_match is not None else (today_metric.catchup_goal_met or False),
            divein_minutes=_scoped(today_metric.metric_date, "divein", today_metric.divein_minutes or 0),
            recap_completed=today_metric.recap_completed or False,
        ),
        week=[
            DailyMetricResponse(
                metric_date=m.metric_date,
                catchup_minutes=_scoped(m.metric_date, "catchup", m.catchup_minutes or 0),
                catchup_goal_met=(_scoped(m.metric_date, "catchup", 0) >= 20) if filter_match is not None else (m.catchup_goal_met or False),
                divein_minutes=_scoped(m.metric_date, "divein", m.divein_minutes or 0),
                recap_completed=m.recap_completed or False,
            )
            for m in week_metrics
        ],
        total_catchup_minutes=int(totals.total_catchup or 0),
        total_divein_minutes=int(totals.total_divein or 0),
        total_recap_sessions=int(totals.total_recaps or 0),
        current_streak=current_streak,
        recap_journey_status=recap_journey_status,
        articles_read=int(articles_read),
        articles_saved=int(articles_saved),
        filters_explored=int(filters_explored),
        top_topics=top_topics,
        notes_this_week=int(notes_this_week),
    )
