"""
Audio Recap Service — Phase 2: Stage 4 Audio Capstone

Generates NotebookLM-style two-host audio recaps for Full-tier users.
Pipeline: Script generation (Claude Sonnet) → TTS (ElevenLabs) → MP3 storage.
Runs asynchronously via fire-and-forget background tasks.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal
from app.models.recap import RecapJourney, KeyInsight
from app.utils.llm_utils import get_claude_client

logger = logging.getLogger(__name__)

# ── In-memory tracking for active generation tasks ───────────────────
# Used for idempotency checks and stale detection on server restart
_active_generations: Dict[str, asyncio.Task] = {}


# ── System prompt for two-host dialogue script ──────────────────────

AUDIO_SCRIPT_SYSTEM_PROMPT = """You are writing a script for a two-host audio recap of someone's weekly learning journey. This is a personal, insightful recap — like overhearing two brilliant friends discuss what someone learned.

HOSTS:
- NARRATOR: Warm, connective, sets up themes. Think: curious friend who connects dots. Uses natural language, asks follow-up questions.
- ANALYST: Sharp, pattern-finder. Thinks in frameworks. Pushes for "so what?" and "what does this really mean?" Occasionally plays devil's advocate.

STRUCTURE (15-25 segments, ~2000 words total):
1. OPENING (2-3 segments): Narrator opens with week overview, Analyst highlights the most surprising thing
2. DEEP DIVE (8-12 segments): Walk through 2-3 key themes, PRIORITIZING articles the user did Socratic Q&A on or spent the most time reading — these are what they cared about most
3. USER'S VOICE (3-4 segments): Reference the user's Socratic responses and commitment — "They said something interesting..."
4. CLOSING (2-3 segments): Narrator summarizes, Analyst gives one forward-looking provocation

PERSONALIZATION PRIORITY:
- Articles the user asked questions about (Q&A) are their strongest interests — lead with these
- Articles with the most time spent indicate deep engagement — weave these into themes
- The user's Socratic dialogue reveals their thinking process — reference their actual words and reasoning
- If they explored multiple filters (industries/specializations), note what drew them across domains

RULES:
- Reference SPECIFIC article titles from the data provided, never generic "various articles"
- Quote the user's own words from their reflections when possible (prefix with "they reflected that..." or "as they put it...")
- Natural conversation flow — agreements, building on each other's points, occasional surprised reactions
- No stage directions, just spoken text
- Each segment: 30-120 words (sweet spot ~60-80 words)
- Never mention "segment" or "script" — this should sound like a real conversation
- End with something thought-provoking that connects to the user's commitment for next week

Return ONLY a valid JSON array. Each element: {"speaker": "narrator" or "analyst", "text": "the spoken text"}
No markdown fences, no explanations — just the JSON array."""


# ── Fallback script when generation fails ────────────────────────────

def _fallback_script(snapshot_data: dict, commitment: str) -> List[Dict]:
    """Minimal 3-segment script when Claude generation fails."""
    articles = snapshot_data.get("articles_engaged", [])
    article_count = len(articles)
    top_article = articles[0]["title"] if articles else "your reading"

    return [
        {
            "speaker": "narrator",
            "text": f"Welcome to your weekly learning recap. This week, you engaged with {article_count} articles across several topics. Let's take a moment to reflect on what stood out."
        },
        {
            "speaker": "analyst",
            "text": f"The article that caught my eye was '{top_article}'. There were some interesting patterns in what you chose to explore this week — it says something about where your attention is drawn."
        },
        {
            "speaker": "narrator",
            "text": f"And looking ahead, you committed to: {commitment or 'continuing to explore'}. That's a great intention to carry into next week. Until next time!"
        },
    ]


class AudioRecapService:
    """Service for generating two-host audio recaps."""

    @staticmethod
    def generate_audio_script(journey: RecapJourney, db: Session) -> List[Dict]:
        """
        Generate a two-host dialogue script using Claude Sonnet.

        Gathers all context from the journey record and Key Insights,
        then generates a natural conversation between Narrator and Analyst.
        """
        # Gather context
        snapshot = journey.snapshot_data or {}
        questions = journey.guided_questions or []
        responses = journey.guided_responses or {}
        socratic = journey.socratic_exchanges or []
        commitment = journey.commitment_text or ""

        # Get key insights
        insights = db.query(KeyInsight).filter(
            KeyInsight.recap_journey_id == journey.id
        ).all()

        insight_texts = [
            {
                "text": i.insight_text,
                "source": i.source,
                "filters": i.filters_spanned or [],
            }
            for i in insights
        ]

        # Build context for Claude
        articles = snapshot.get("articles_engaged", [])
        # Separate deep-dive / Q&A articles from regular reads for emphasis
        deep_dive_articles = []
        other_articles = []
        for a in articles[:12]:  # Cap at 12 to stay within token limits
            eng_type = a.get('engagement_type', 'read')
            time_min = a.get('time_spent_minutes', 0)
            line = (
                f"- \"{a.get('title', 'Untitled')}\" ({a.get('source', 'Unknown')}) "
                f"[{a.get('filter_context', '')}] — {eng_type}, {time_min}m spent"
                + (f", key quote: \"{a.get('key_quote', '')}\"" if a.get('key_quote') else "")
            )
            if eng_type in ('qa_asked', 'saved') or time_min >= 5:
                deep_dive_articles.append(line)
            else:
                other_articles.append(line)
        article_summaries = deep_dive_articles + other_articles

        qa_highlights = snapshot.get("qa_highlights", [])
        qa_text = "\n".join(
            f"- Q: {qa.get('question', '')} (re: {qa.get('article_title', '')})"
            for qa in qa_highlights[:5]
        )

        topic_clusters = snapshot.get("topic_clusters", [])
        cluster_text = "\n".join(
            f"- {c.get('theme', '')}: {c.get('article_count', 0)} articles across {', '.join(c.get('filters', []))}"
            for c in topic_clusters
        )

        # User reflections from Stage 2
        reflection_text = ""
        for i, q in enumerate(questions):
            resp = responses.get(str(i), "")
            if resp:
                reflection_text += f"- Question ({q.get('type', 'reflection')}): \"{q.get('text', '')}\"\n  Answer: \"{resp}\"\n"

        # Socratic dialogue highlights
        socratic_text = ""
        if socratic:
            for exchange in socratic[-6:]:  # Last 6 messages (3 exchanges)
                role = exchange.get("role", "")
                content = exchange.get("content", "")[:200]
                socratic_text += f"  [{role}]: {content}\n"

        insight_text = "\n".join(
            f"- {'[User insight]' if i['source'] == 'user_reflection' else '[Extracted]'}: {i['text']}"
            for i in insight_texts
        )

        user_prompt = f"""Generate an audio recap script for this week's learning journey.

DEEP ENGAGEMENT ARTICLES ({len(deep_dive_articles)} — Q&A'd, saved, or 5+ min reading — PRIORITIZE these):
{chr(10).join(deep_dive_articles) if deep_dive_articles else "None — focus on reading patterns instead."}

OTHER ARTICLES READ ({len(other_articles)}):
{chr(10).join(other_articles) if other_articles else "None."}

TOPIC CLUSTERS:
{cluster_text or "None identified."}

Q&A HIGHLIGHTS:
{qa_text or "None."}

USER'S GUIDED REFLECTIONS:
{reflection_text or "No reflections recorded."}

SOCRATIC DIALOGUE HIGHLIGHTS:
{socratic_text or "No Socratic dialogue."}

KEY INSIGHTS CAPTURED:
{insight_text or "No insights captured."}

USER'S COMMITMENT FOR NEXT WEEK:
{commitment or "No commitment recorded."}

READING PATTERN:
- Peak day: {snapshot.get('reading_pattern', {}).get('peak_day', 'Unknown')}
- Total articles: {snapshot.get('reading_pattern', {}).get('total_articles', 0)}
- Deepest dive: {snapshot.get('reading_pattern', {}).get('deepest_dive', {}).get('article_title', 'N/A')} ({snapshot.get('reading_pattern', {}).get('deepest_dive', {}).get('time_spent_minutes', 0)} min)

Generate a 15-25 segment two-host dialogue script as a JSON array."""

        try:
            claude = get_claude_client()
            response = claude.client.messages.create(
                model=settings.CLAUDE_SONNET_MODEL,
                max_tokens=4000,
                temperature=0.7,
                system=AUDIO_SCRIPT_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )

            raw_text = response.content[0].text.strip()

            # Parse JSON — handle potential markdown fences
            if raw_text.startswith("```"):
                # Extract from markdown code block
                lines = raw_text.split("\n")
                json_lines = []
                in_block = False
                for line in lines:
                    if line.startswith("```") and not in_block:
                        in_block = True
                        continue
                    elif line.startswith("```") and in_block:
                        break
                    elif in_block:
                        json_lines.append(line)
                raw_text = "\n".join(json_lines)

            script = json.loads(raw_text)

            # Validate structure
            if not isinstance(script, list) or len(script) < 3:
                logger.warning("Script too short, using fallback")
                return _fallback_script(snapshot, commitment)

            # Validate each segment has speaker and text
            validated = []
            for seg in script:
                if isinstance(seg, dict) and "speaker" in seg and "text" in seg:
                    speaker = seg["speaker"].lower()
                    if speaker in ("narrator", "analyst"):
                        validated.append({"speaker": speaker, "text": seg["text"]})

            if len(validated) < 3:
                logger.warning("Not enough valid segments, using fallback")
                return _fallback_script(snapshot, commitment)

            logger.info(f"Generated audio script: {len(validated)} segments")
            return validated

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse script JSON: {e}")
            return _fallback_script(snapshot, commitment)
        except Exception as e:
            logger.error(f"Script generation failed: {e}")
            return _fallback_script(snapshot, commitment)

    @staticmethod
    def generate_tts_audio(journey_id: str, script: List[Dict]) -> Tuple[Path, int]:
        """
        Convert script segments to speech via ElevenLabs and save as MP3.

        Returns (filepath, estimated_duration_seconds).
        """
        from elevenlabs import ElevenLabs

        if not settings.ELEVENLABS_API_KEY:
            raise ValueError("ELEVENLABS_API_KEY not configured")

        client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)

        voice_map = {
            "narrator": settings.ELEVENLABS_NARRATOR_VOICE_ID,
            "analyst": settings.ELEVENLABS_ANALYST_VOICE_ID,
        }

        # Generate audio for each segment and concatenate
        all_audio_bytes = bytearray()
        total_chars = 0

        for i, segment in enumerate(script):
            speaker = segment.get("speaker", "narrator")
            text = segment.get("text", "")
            if not text.strip():
                continue

            voice_id = voice_map.get(speaker, voice_map["narrator"])
            total_chars += len(text)

            try:
                audio_gen = client.text_to_speech.convert(
                    voice_id=voice_id,
                    text=text,
                    model_id=settings.ELEVENLABS_MODEL_ID,
                    output_format="mp3_44100_128",
                )
                # audio_gen is a generator of bytes chunks
                segment_bytes = b"".join(audio_gen)
                all_audio_bytes.extend(segment_bytes)

                logger.debug(f"TTS segment {i+1}/{len(script)}: {len(segment_bytes)} bytes ({speaker})")

            except Exception as e:
                logger.error(f"TTS failed for segment {i+1}: {e}")
                raise

        if not all_audio_bytes:
            raise ValueError("No audio generated — all segments failed")

        # Save to filesystem
        audio_dir = Path(settings.AUDIO_STORAGE_DIR)
        audio_dir.mkdir(parents=True, exist_ok=True)

        short_id = uuid.uuid4().hex[:8]
        filename = f"recap_{journey_id}_{short_id}.mp3"
        filepath = audio_dir / filename
        filepath.write_bytes(bytes(all_audio_bytes))

        # Estimate duration: ~15 characters per second of speech
        estimated_duration = max(30, total_chars // 15)

        logger.info(
            f"Audio saved: {filepath} ({len(all_audio_bytes)} bytes, ~{estimated_duration}s)"
        )
        return filepath, estimated_duration

    @staticmethod
    def warm_up_script(journey_id: str, db: Session) -> Dict:
        """
        Pre-generate the audio script (no TTS) during earlier stages.

        Called when entering 'commitment' status for Full tier users.
        The script is generated with available data (snapshot + questions +
        Socratic), and stored on the journey. When trigger_audio_generation
        is later called, it can skip script generation and go straight to TTS.
        """
        try:
            journey_uuid = uuid.UUID(journey_id)
        except ValueError:
            return {"error": "Invalid journey ID"}

        journey = db.query(RecapJourney).filter(
            RecapJourney.id == journey_uuid
        ).first()

        if not journey or journey.tier != "full":
            return {"error": "Not eligible for audio warm-up"}

        # Skip if script already exists
        if journey.audio_script:
            return {"status": "script_already_cached"}

        # Generate script synchronously (fast — just an LLM call)
        try:
            script = AudioRecapService.generate_audio_script(journey, db)
            journey.audio_script = json.dumps(script)
            db.commit()
            logger.info(f"Warm-up script cached for journey {journey_id} ({len(script)} segments)")
            return {"status": "script_cached", "segments": len(script)}
        except Exception as e:
            logger.warning(f"Warm-up script failed for {journey_id}: {e}")
            return {"error": str(e)}

    @staticmethod
    def trigger_audio_generation(journey_id: str, db: Session) -> Dict:
        """
        Trigger async audio generation. Returns immediately.

        Validates the journey is eligible (Full tier, stage_4 or completed).
        Idempotent: returns early if generation is already in progress.
        """
        try:
            journey_uuid = uuid.UUID(journey_id)
        except ValueError:
            return {"error": "Invalid journey ID"}

        journey = db.query(RecapJourney).filter(
            RecapJourney.id == journey_uuid
        ).first()

        if not journey:
            return {"error": "Journey not found"}

        if journey.status not in ("stage_4", "completed"):
            return {"error": f"Cannot generate audio in status '{journey.status}'"}

        # Idempotency: already generating?
        if journey.audio_status in ("generating_script", "generating_audio"):
            if journey_id in _active_generations:
                return {"status": "already_generating"}
            # Stale state (no active task) — reset and re-generate
            logger.warning(f"Stale audio status for {journey_id}, resetting")

        # Already ready? Return existing URL unless force re-generate
        if journey.audio_status == "ready" and journey.audio_url:
            return {
                "status": "already_ready",
                "audio_url": journey.audio_url,
            }

        # Start generation
        journey.audio_status = "generating_script"
        journey.audio_error = None
        db.commit()

        # Launch background task
        task = asyncio.create_task(
            _generate_audio_background(journey_id)
        )
        _active_generations[journey_id] = task

        return {"status": "started"}

    @staticmethod
    def get_audio_status(journey_id: str, db: Session) -> Dict:
        """
        Get current audio generation status for polling.

        Includes stale detection: if status says generating but no active task
        exists (server restarted), marks as failed.
        """
        try:
            journey_uuid = uuid.UUID(journey_id)
        except ValueError:
            return {"status": None, "progress_pct": 0, "error": "Invalid ID"}

        journey = db.query(RecapJourney).filter(
            RecapJourney.id == journey_uuid
        ).first()

        if not journey:
            return {"status": None, "progress_pct": 0, "error": "Not found"}

        status = journey.audio_status

        # Stale detection
        if status in ("generating_script", "generating_audio"):
            if journey_id not in _active_generations:
                journey.audio_status = "failed"
                journey.audio_error = "Generation interrupted (server restart)"
                db.commit()
                status = "failed"

        # Progress mapping
        progress_map = {
            None: 0,
            "generating_script": 20,
            "generating_audio": 60,
            "ready": 100,
            "text_only": 100,
            "failed": 0,
        }
        progress = progress_map.get(status, 0)

        result: Dict = {
            "status": status,
            "progress_pct": progress,
        }

        if status == "ready":
            result["audio_url"] = f"/api/v1/recap/{journey_id}/audio/stream"
            result["audio_duration_seconds"] = journey.audio_duration_seconds

        if status == "text_only":
            # Return the script for text display
            try:
                script = json.loads(journey.audio_script) if isinstance(journey.audio_script, str) else journey.audio_script
                result["script"] = script or []
            except Exception:
                result["script"] = []

        if status == "failed":
            result["error"] = journey.audio_error or "Unknown error"

        return result


async def _generate_audio_background(journey_id: str):
    """
    Fire-and-forget background task for audio generation.

    Creates its own DB session since it runs outside the request lifecycle.
    """
    db = SessionLocal()
    try:
        journey_uuid = uuid.UUID(journey_id)
        journey = db.query(RecapJourney).filter(
            RecapJourney.id == journey_uuid
        ).first()

        if not journey:
            logger.error(f"Journey {journey_id} not found in background task")
            return

        # Phase 1: Script generation via Claude (use warm-up cache if available)
        if journey.audio_script:
            # Script was pre-generated during warm-up
            script = journey.audio_script if isinstance(journey.audio_script, list) else json.loads(journey.audio_script)
            logger.info(f"Using warm-up cached script for {journey_id}: {len(script)} segments")
            journey.audio_status = "generating_audio"
            db.commit()
        else:
            logger.info(f"Audio generation started for {journey_id}: generating script")
            journey.audio_status = "generating_script"
            db.commit()

            script = await asyncio.to_thread(
                AudioRecapService.generate_audio_script, journey, db
            )

            journey.audio_script = json.dumps(script)
            journey.audio_status = "generating_audio"
            db.commit()
            logger.info(f"Script generated for {journey_id}: {len(script)} segments")

        # Phase 2: TTS via ElevenLabs (or text-only fallback)
        if settings.ELEVENLABS_API_KEY:
            filepath, duration = await asyncio.to_thread(
                AudioRecapService.generate_tts_audio, journey_id, script
            )

            # Phase 3: Store results
            journey.audio_url = f"/static/audio/{filepath.name}"
            journey.audio_duration_seconds = duration
            journey.audio_status = "ready"
            db.commit()
            logger.info(f"Audio generation complete for {journey_id}: {filepath.name}")
        else:
            # Text-only fallback: script is generated, no audio file
            logger.info(f"ElevenLabs not configured — using text-only recap for {journey_id}")
            journey.audio_status = "text_only"
            journey.audio_duration_seconds = 0
            db.commit()

    except Exception as e:
        logger.error(f"Audio generation failed for {journey_id}: {e}")
        try:
            journey = db.query(RecapJourney).filter(
                RecapJourney.id == uuid.UUID(journey_id)
            ).first()
            if journey:
                journey.audio_status = "failed"
                journey.audio_error = str(e)[:500]
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()
        _active_generations.pop(journey_id, None)
