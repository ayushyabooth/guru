"""
Recap API routes — New 4-stage Journey + Legacy Q&A synthesis

New Journey endpoints (Stage 1-4):
  POST /recap/start                → Create journey record (snapshot deferred to Stage 1 fetch)
  GET  /recap/{id}/snapshot        → Compute (or return cached) Stage 1 snapshot data
  GET  /recap/{id}/questions       → Get Stage 2 questions
  POST /recap/{id}/answer          → Submit Stage 2 answer
  POST /recap/{id}/socratic        → Stage 3 Socratic exchange
  GET  /recap/{id}/insights        → Get all Key Insights
  POST /recap/{id}/commitment      → Store One Commitment
  GET  /recap/{id}/summary         → Get journey summary
  POST /recap/{id}/audio/generate  → Trigger audio recap generation
  GET  /recap/{id}/audio/status    → Poll audio generation status
  GET  /recap/{id}/audio/stream    → Stream generated audio MP3
  GET  /recap/sessions             → List all recap journeys (archive)
  GET  /me/commitment              → Current week's commitment for Home display

Legacy endpoints (kept for backward compatibility):
  POST /recap/start-session  → Legacy session start
  POST /recap/{id}/answer    → Legacy answer (handled via journey if possible)
  GET  /recap/{id}/synthesis → Legacy synthesis
  POST /recap/{id}/publish   → Legacy publish
  GET  /recap/shared/{key}   → Legacy shared recap view
  GET  /recap/user/sessions  → Legacy user sessions
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import Optional, List
from pathlib import Path
import uuid
import secrets
import logging
from datetime import datetime

from app.db.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.models.recap import RecapSession, RecapSessionPublish, RecapJourney, KeyInsight
from app.services.recap_service import RecapService, RecapJourneyService
from app.services.audio_recap_service import AudioRecapService
from app.config import settings
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["recap"])


# ══════════════════════════════════════════════════════════════════════
# New 4-Stage Recap Journey Endpoints
# ══════════════════════════════════════════════════════════════════════


class StartJourneyRequest(BaseModel):
    force_new: bool = False


class SocraticRequest(BaseModel):
    message: str


class CommitmentRequest(BaseModel):
    text: str


class AnswerRequest(BaseModel):
    question_index: int
    response: str  # Free text or chip selection


# ── POST /recap/start — Start a new Recap Journey ─────────────────

@router.post("/recap/start")
async def start_recap_journey(
    request: Optional[StartJourneyRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create (or resume) a Recap Journey for the current week.

    Only creates the session record — the weekly snapshot is computed lazily
    on the first Stage 1 fetch (GET /recap/{id}/snapshot) so that mid-week
    activity between journey creation and Recap open is captured.

    Pass force_new=true to start a fresh recap when one is already completed.
    """
    force_new = request.force_new if request else False
    try:
        result = RecapJourneyService.start_journey(current_user.id, db, force_new=force_new)

        if "error" in result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result["error"],
            )

        logger.info(f"Recap journey started/resumed for user {current_user.id}: {result.get('journey_id')}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting recap journey: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start recap journey",
        )


# ── GET /recap/{id}/snapshot — Stage 1 snapshot data ──────────────

@router.get("/recap/{journey_id}/snapshot")
async def get_recap_snapshot(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get Stage 1 snapshot data (Glass Memory Wall content).

    Computes the snapshot fresh from the current week's activity on first
    call (so mid-week reading/Q&A since /recap/start is captured) and caches
    it on the journey record. Subsequent calls return the cached snapshot.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # Compute snapshot on first fetch (mid-week activity captured here).
    snapshot = RecapJourneyService.ensure_snapshot(journey, db)

    # Advance status from 'not_started' → 'stage_1' on first snapshot fetch.
    if journey.status == 'not_started':
        journey.status = 'stage_1'
        journey.stage_progress = 1
        db.commit()
        db.refresh(journey)

    return {
        "journey_id": str(journey.id),
        "tier": journey.tier,
        "status": journey.status,
        "stage_progress": journey.stage_progress,
        "snapshot": snapshot,
        "week_start": journey.week_start.isoformat(),
        "week_end": journey.week_end.isoformat(),
    }


# ── GET /recap/{id}/questions — Stage 2 questions ─────────────────

@router.get("/recap/{journey_id}/questions")
async def get_recap_questions(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get Stage 2 guided questions (generated on first call).

    Returns typed questions with response format info.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # Ensure the Stage 1 snapshot is computed before generating questions
    # (in case the caller jumped straight to /questions without fetching /snapshot).
    snapshot = RecapJourneyService.ensure_snapshot(journey, db)

    # Generate questions if not already generated
    if not journey.guided_questions:
        questions = RecapJourneyService.generate_guided_questions(
            current_user.id,
            snapshot,
            db,
        )
        journey.guided_questions = questions
        if journey.status in ('not_started', 'stage_1'):
            journey.status = 'stage_2'
            journey.stage_progress = 2
        db.commit()
    else:
        questions = journey.guided_questions

    return {
        "journey_id": str(journey.id),
        "questions": questions,
        "responses": journey.guided_responses or {},
        "tier": journey.tier,
    }


# ── POST /recap/{id}/answer — Submit Stage 2 answer ──────────────

@router.post("/recap/{journey_id}/answer")
async def submit_recap_answer(
    journey_id: str,
    request: AnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit an answer to a Stage 2 guided question."""
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # Validate question index
    questions = journey.guided_questions or []
    if request.question_index < 0 or request.question_index >= len(questions):
        raise HTTPException(status_code=400, detail="Invalid question index")

    # Store response (copy dict to ensure SQLAlchemy detects mutation)
    responses = dict(journey.guided_responses or {})
    responses[str(request.question_index)] = request.response
    journey.guided_responses = responses
    flag_modified(journey, 'guided_responses')

    # Check if all questions answered
    all_answered = len(responses) >= len(questions)

    db.commit()

    # Generate follow-up connecting to another anchor interaction
    followup = RecapJourneyService.generate_question_followup(
        journey_id, request.question_index, request.response, db
    )

    return {
        "stored": True,
        "question_index": request.question_index,
        "all_answered": all_answered,
        "total_questions": len(questions),
        "answered_count": len(responses),
        "followup": followup,
    }


# ── POST /recap/{id}/socratic — Stage 3 Socratic exchange ────────

@router.post("/recap/{journey_id}/socratic")
async def recap_socratic_exchange(
    journey_id: str,
    request: SocraticRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send a message in the Stage 3 Socratic deep dive.

    Returns the Guru response, any extracted insight, and whether
    the dialogue has concluded (after 3-5 exchanges).
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    # Verify ownership
    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    result = RecapJourneyService.socratic_exchange(journey_uuid, request.message, db)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


# ── GET /recap/{id}/insights — Get all Key Insights ──────────────

@router.get("/recap/{journey_id}/insights")
async def get_recap_insights(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get all Key Insights for a Recap Journey.

    Returns both user-generated (from Socratic) and system-extracted insights.
    If no user insights exist, generates system-extracted ones.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # Get existing insights
    insights = db.query(KeyInsight).filter(
        KeyInsight.recap_journey_id == journey_uuid,
    ).all()

    # If no insights yet, generate system-extracted ones
    if not insights and journey.snapshot_data:
        system_insights = RecapJourneyService.extract_system_insights(
            current_user.id,
            journey.snapshot_data,
            journey.week_start,
            db,
        )

        for si in system_insights:
            insight = KeyInsight(
                user_id=current_user.id,
                recap_journey_id=journey_uuid,
                insight_text=si["insight_text"],
                source="system_extracted",
                source_article_ids=si.get("source_article_ids", []),
                filters_spanned=si.get("filters_spanned", []),
                week_start=journey.week_start,
            )
            db.add(insight)

        db.commit()

        # Re-fetch
        insights = db.query(KeyInsight).filter(
            KeyInsight.recap_journey_id == journey_uuid,
        ).all()

    return {
        "journey_id": str(journey.id),
        "insights": [
            {
                "id": str(i.id),
                "insight_text": i.insight_text,
                "source": i.source,
                "source_article_ids": i.source_article_ids or [],
                "filters_spanned": i.filters_spanned or [],
                "created_at": i.created_at.isoformat() if i.created_at else None,
            }
            for i in insights
        ],
        "total": len(insights),
        "user_generated": sum(1 for i in insights if i.source == "user_reflection"),
        "system_extracted": sum(1 for i in insights if i.source == "system_extracted"),
    }


# ── POST /recap/{id}/commitment — Store One Commitment ───────────

@router.post("/recap/{journey_id}/commitment")
async def store_commitment(
    journey_id: str,
    request: CommitmentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Store the user's 'One Commitment' for the week."""
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    # Verify ownership
    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    result = RecapJourneyService.store_commitment(journey_uuid, request.text, db)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


# ── GET /recap/{id}/summary — Get journey summary ────────────────

@router.get("/recap/{journey_id}/summary")
async def get_recap_summary(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get the full summary of a completed (or in-progress) recap journey.

    Includes snapshot, questions + answers, insights, commitment, and synthesis.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # Get insights
    insights = db.query(KeyInsight).filter(
        KeyInsight.recap_journey_id == journey_uuid,
    ).all()

    return {
        "journey_id": str(journey.id),
        "week_start": journey.week_start.isoformat(),
        "week_end": journey.week_end.isoformat(),
        "tier": journey.tier,
        "status": journey.status,
        "stage_progress": journey.stage_progress,
        "snapshot": journey.snapshot_data,
        "questions": journey.guided_questions,
        "responses": journey.guided_responses,
        "socratic_exchanges": journey.socratic_exchanges,
        "socratic_exchange_count": journey.socratic_exchange_count,
        "commitment": journey.commitment_text,
        "insights": [
            {
                "id": str(i.id),
                "insight_text": i.insight_text,
                "source": i.source,
                "source_article_ids": i.source_article_ids or [],
                "filters_spanned": i.filters_spanned or [],
            }
            for i in insights
        ],
        "synthesis": journey.synthesis_text,
        "activity": {
            "articles_read": journey.articles_read_count,
            "articles_saved": journey.articles_saved_count,
            "qa_count": journey.qa_count,
            "filters_explored": journey.filters_explored_count,
            "total_time_minutes": journey.total_time_minutes,
        },
        "audio_script": journey.audio_script,
        "audio_url": journey.audio_url,
        "audio_status": journey.audio_status,
        "audio_duration_seconds": journey.audio_duration_seconds,
        "created_at": journey.created_at.isoformat() if journey.created_at else None,
        "completed_at": journey.completed_at.isoformat() if journey.completed_at else None,
    }


# ── GET /recap/sessions — List all recap journeys (archive) ──────

@router.get("/recap/sessions")
async def list_recap_journeys(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all recap journeys for the current user (for archive/journal view)."""
    try:
        query = db.query(RecapJourney).filter(
            RecapJourney.user_id == current_user.id,
        ).order_by(RecapJourney.week_start.desc())

        total = query.count()
        journeys = query.offset(offset).limit(limit).all()

        return {
            "journeys": [
                {
                    "id": str(j.id),
                    "week_start": j.week_start.isoformat(),
                    "week_end": j.week_end.isoformat(),
                    "tier": j.tier,
                    "status": j.status,
                    "stage_progress": j.stage_progress,
                    "articles_read_count": j.articles_read_count,
                    "commitment": j.commitment_text,
                    "insight_count": db.query(KeyInsight).filter(
                        KeyInsight.recap_journey_id == j.id
                    ).count(),
                    "has_audio": bool(j.audio_url),
                    "created_at": j.created_at.isoformat() if j.created_at else None,
                    "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                }
                for j in journeys
            ],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    except Exception as e:
        logger.error(f"Error listing recap journeys: {e}")
        raise HTTPException(status_code=500, detail="Failed to list recap journeys")


# ── GET /me/commitment — Current week's commitment for Home ──────

@router.get("/me/commitment")
async def get_my_commitment(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the most recent commitment for display on Home screen."""
    commitment = RecapJourneyService.get_current_commitment(current_user.id, db)
    if not commitment:
        return {"commitment": None}
    return {"commitment": commitment}


# ── POST /recap/{id}/advance — Advance to next stage ─────────────

@router.post("/recap/{journey_id}/advance")
async def advance_recap_stage(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Advance the journey to the next stage."""
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    result = RecapJourneyService.advance_stage(journey_uuid, db)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


# ══════════════════════════════════════════════════════════════════════
# Stage 4: Audio Recap Endpoints
# ══════════════════════════════════════════════════════════════════════


# ── POST /recap/{id}/audio/generate — Trigger audio generation ────

@router.post("/recap/{journey_id}/audio/generate")
async def generate_audio_recap(
    journey_id: str,
    force: bool = Query(False, description="Force re-generation even if audio exists"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Trigger async audio recap generation.

    Returns immediately. Frontend polls /audio/status for progress.
    Idempotent: returns early if already generating or ready (unless force=True).
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    # Verify ownership
    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    # ElevenLabs not required — will fall through to text-only recap
    if not settings.ELEVENLABS_API_KEY:
        logger.info(f"ElevenLabs not configured — audio will be text-only for journey {journey_id}")

    # If force re-generate, reset status
    if force and journey.audio_status == "ready":
        journey.audio_status = None
        journey.audio_error = None
        journey.audio_url = None
        db.commit()

    result = AudioRecapService.trigger_audio_generation(journey_id, db)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    logger.info(f"Audio generation triggered for journey {journey_id}: {result.get('status')}")
    return result


# ── GET /recap/{id}/audio/status — Poll generation status ─────────

@router.get("/recap/{journey_id}/audio/status")
async def get_audio_status(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get current audio generation status for polling.

    Returns status, progress percentage, and audio URL when ready.
    Includes stale detection for server restart scenarios.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    # Verify ownership
    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    return AudioRecapService.get_audio_status(journey_id, db)


# ── GET /recap/{id}/audio/stream — Stream MP3 file ────────────────

@router.get("/recap/{journey_id}/audio/stream")
async def stream_audio_recap(
    journey_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Stream the generated audio recap MP3 file.

    Returns the MP3 file for playback. Requires audio_status == 'ready'.
    """
    try:
        journey_uuid = uuid.UUID(journey_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid journey ID")

    # Verify ownership
    journey = db.query(RecapJourney).filter(
        RecapJourney.id == journey_uuid,
        RecapJourney.user_id == current_user.id,
    ).first()

    if not journey:
        raise HTTPException(status_code=404, detail="Recap journey not found")

    if journey.audio_status != "ready" or not journey.audio_url:
        raise HTTPException(
            status_code=404,
            detail="Audio not available. Generate it first via POST /audio/generate",
        )

    # Resolve filepath — audio_url is stored as "/static/audio/filename.mp3"
    filename = Path(journey.audio_url).name
    filepath = Path(settings.AUDIO_STORAGE_DIR) / filename

    if not filepath.exists():
        logger.error(f"Audio file missing: {filepath}")
        journey.audio_status = "failed"
        journey.audio_error = "Audio file not found on disk"
        db.commit()
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(
        path=str(filepath),
        media_type="audio/mpeg",
        filename=filename,
    )


# ══════════════════════════════════════════════════════════════════════
# Legacy Recap Endpoints (backward compatibility)
# ══════════════════════════════════════════════════════════════════════


class StartRecapRequest(BaseModel):
    week_start: str


class LegacyAnswerRequest(BaseModel):
    question_order: int
    response_text: str


@router.post("/recap/start-session")
async def start_recap_session(
    request: StartRecapRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy: Start a recap session with 4 Q&A-based questions."""
    try:
        try:
            week_start = datetime.fromisoformat(request.week_start.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid week_start format")

        result = RecapService.generate_recap_session(
            user_id=str(current_user.id),
            week_start=week_start,
            db=db,
        )

        if "error" in result:
            status_code = 409 if "already exists" in result["error"] else 400
            raise HTTPException(status_code=status_code, detail=result["error"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting legacy recap session: {e}")
        raise HTTPException(status_code=500, detail="Failed to start recap session")


@router.post("/recap/{recap_id}/legacy-answer")
async def answer_recap_question_legacy(
    recap_id: str,
    request: LegacyAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy: Store response to a legacy recap question."""
    try:
        uuid.UUID(recap_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid recap ID")

    if request.question_order not in [1, 2, 3, 4]:
        raise HTTPException(status_code=400, detail="Question order must be 1-4")

    result = RecapService.store_user_response(
        recap_session_id=recap_id,
        question_order=request.question_order,
        response_text=request.response_text.strip(),
        db=db,
    )

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return {"stored": True, "question_order": request.question_order}


@router.get("/recap/{recap_id}/synthesis")
async def get_synthesis(
    recap_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy: Get or generate recap synthesis using Claude Opus."""
    try:
        recap_uuid = uuid.UUID(recap_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid recap ID")

    session = db.query(RecapSession).filter(
        RecapSession.id == recap_uuid,
        RecapSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Recap session not found")

    if session.synthesis_text:
        return {
            "synthesis_text": session.synthesis_text,
            "key_insights": session.synthesis_insights or [],
            "generated_at": session.created_at.isoformat(),
        }

    result = RecapService.generate_synthesis(recap_id, db)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


@router.get("/recap/shared/{share_key}")
async def view_shared_recap(
    share_key: str,
    db: Session = Depends(get_db),
):
    """Legacy: View shared recap (public, no auth)."""
    publish = db.query(RecapSessionPublish).filter(
        RecapSessionPublish.share_key == share_key,
    ).first()

    if not publish:
        raise HTTPException(status_code=404, detail="Shared recap not found")

    session = db.query(RecapSession).filter(
        RecapSession.id == publish.recap_session_id,
    ).first()

    if not session or not session.synthesis_text:
        raise HTTPException(status_code=404, detail="Recap content not available")

    publish.view_count += 1
    db.commit()

    return {
        "synthesis": session.synthesis_text,
        "insights": session.synthesis_insights or [],
        "published_at": session.published_at.isoformat() if session.published_at else session.created_at.isoformat(),
        "views": publish.view_count,
    }


@router.get("/recap/user/sessions")
async def get_user_recap_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy: Get all legacy recap sessions for the user."""
    sessions = db.query(RecapSession).filter(
        RecapSession.user_id == current_user.id,
    ).order_by(RecapSession.week_start.desc()).all()

    return {
        "sessions": [
            {
                "id": str(s.id),
                "week_start": s.week_start.isoformat(),
                "week_end": s.week_end.isoformat(),
                "status": s.status,
                "has_synthesis": bool(s.synthesis_text),
                "is_published": bool(s.published_at),
                "created_at": s.created_at.isoformat(),
            }
            for s in sessions
        ],
        "total": len(sessions),
    }
