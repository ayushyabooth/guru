"""
Metrics API routes for tracking user activity and rings progress.
"""
import uuid
from datetime import datetime, date, timedelta
from typing import List
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    user_timezone: str = "UTC"


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
    divein_goal_met: bool
    recap_completed: bool


class MetricsSummaryResponse(BaseModel):
    today: DailyMetricResponse
    week: List[DailyMetricResponse]
    total_catchup_minutes: int
    total_divein_minutes: int
    total_recap_sessions: int
    current_streak: int
    longest_streak: int
    weekly_total_minutes: int
    today_total_minutes: int
    recap_journey_status: str | None = None


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

    # Resolve goal thresholds from user profile
    catchup_goal_minutes = 20
    divein_daily_goal_minutes = 20
    if current_user.profile:
        if current_user.profile.catchup_daily_goal_minutes:
            catchup_goal_minutes = current_user.profile.catchup_daily_goal_minutes
        if current_user.profile.divein_weekly_goal_minutes:
            divein_daily_goal_minutes = max(1, current_user.profile.divein_weekly_goal_minutes // 7)

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

    # Compute "today" in the user's timezone
    try:
        tz = ZoneInfo(request.user_timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    metric_date = datetime.now(tz).date()

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

    if daily_metric.catchup_minutes >= catchup_goal_minutes:
        daily_metric.catchup_goal_met = True
    if daily_metric.divein_minutes >= divein_daily_goal_minutes:
        daily_metric.divein_goal_met = True
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


@router.get("/me/metrics", response_model=MetricsSummaryResponse)
async def get_metrics_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    user_timezone: str = Query(default="UTC"),
):
    """
    Get comprehensive metrics summary for the current user.
    Includes today's metrics, weekly history, totals, and streak data.
    """
    try:
        tz = ZoneInfo(user_timezone)
    except Exception:
        tz = ZoneInfo("UTC")

    today = datetime.now(tz).date()
    week_ago = today - timedelta(days=6)

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
            divein_goal_met=False,
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

    # Weekly totals (last 7 days)
    weekly_totals = db.query(
        func.sum(DailyMetric.catchup_minutes + DailyMetric.divein_minutes).label("weekly_total")
    ).filter(
        DailyMetric.user_id == current_user.id,
        DailyMetric.metric_date >= week_ago,
        DailyMetric.metric_date <= today,
    ).first()
    weekly_total_minutes = int(weekly_totals.weekly_total or 0) if weekly_totals else 0

    today_total_minutes = (today_metric.catchup_minutes or 0) + (today_metric.divein_minutes or 0)

    # Helper: a day "counts" if any goal was met or recap completed
    def day_counts(m: DailyMetric) -> bool:
        return bool(m.catchup_goal_met or m.divein_goal_met or m.recap_completed)

    # Calculate current streak
    # Grace period: if today hasn't met a goal yet, don't break the streak — skip today and check yesterday
    current_streak = 0
    check_date = today
    # Skip today for streak purposes (grace period — day may not be done)
    if not day_counts(today_metric):
        check_date = today - timedelta(days=1)
    else:
        current_streak = 1
        check_date = today - timedelta(days=1)

    while True:
        metric = db.query(DailyMetric).filter(
            DailyMetric.user_id == current_user.id,
            DailyMetric.metric_date == check_date
        ).first()

        if metric and day_counts(metric):
            current_streak += 1
            check_date -= timedelta(days=1)
        else:
            break

        if current_streak > 365:
            break

    # Calculate longest streak (all-time)
    all_metrics = db.query(DailyMetric).filter(
        DailyMetric.user_id == current_user.id,
    ).order_by(DailyMetric.metric_date).all()

    longest_streak = 0
    run = 0
    prev_date = None
    for m in all_metrics:
        if not day_counts(m):
            run = 0
            prev_date = None
            continue
        if prev_date is None or (m.metric_date - prev_date).days == 1:
            run += 1
        else:
            run = 1
        longest_streak = max(longest_streak, run)
        prev_date = m.metric_date

    longest_streak = max(longest_streak, current_streak)

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

    def _daily_response(m: DailyMetric) -> DailyMetricResponse:
        return DailyMetricResponse(
            metric_date=m.metric_date,
            catchup_minutes=m.catchup_minutes or 0,
            catchup_goal_met=m.catchup_goal_met or False,
            divein_minutes=m.divein_minutes or 0,
            divein_goal_met=m.divein_goal_met or False,
            recap_completed=m.recap_completed or False,
        )

    return MetricsSummaryResponse(
        today=_daily_response(today_metric),
        week=[_daily_response(m) for m in week_metrics],
        total_catchup_minutes=int(totals.total_catchup or 0),
        total_divein_minutes=int(totals.total_divein or 0),
        total_recap_sessions=int(totals.total_recaps or 0),
        current_streak=current_streak,
        longest_streak=longest_streak,
        weekly_total_minutes=weekly_total_minutes,
        today_total_minutes=today_total_minutes,
        recap_journey_status=recap_journey_status,
    )
