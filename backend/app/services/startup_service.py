"""
Startup service for pre-generating base storyboards and warming caches.

Base storyboard architecture:
- Base storyboards (summary, theme, narrative) are generated ONCE per unique filter context
- Personal prompts are generated per-user lazily on first request (single Haiku call each)
- This reduces LLM calls from N_users * N_filters * 4 to N_unique_filters * 3 + N_users * N_filters * 1
"""
import time
from datetime import datetime, timedelta
from typing import List, Dict, Set
from sqlalchemy.orm import Session
import logging

from app.db.database import SessionLocal
from app.models.user import User, UserProfile
from app.models.article import Article, ExpertNote
from app.models.article_rich_content import ArticleRichContent
from app.services.clustering_service import (
    get_or_build_storyboards_for_filter,
    resolve_base_cache_key,
    _get_or_build_base_storyboards,
)
from app.services.rich_summary_service import RichSummaryService
from app.services.industries_config import IndustriesConfig

logger = logging.getLogger(__name__)


def _warm_rich_content(db: Session, limit: int = 20):
    """Generate rich content for articles that don't have it yet."""
    try:
        existing_ids = db.query(ArticleRichContent.article_id).all()
        existing_ids = [r[0] for r in existing_ids]

        recency_cutoff = datetime.utcnow() - timedelta(hours=24)
        articles = db.query(Article).filter(
            Article.created_at >= recency_cutoff,
            ~Article.id.in_(existing_ids) if existing_ids else True,
        ).limit(limit).all()

        if not articles:
            logger.info("   All articles already have rich content")
            return

        logger.info(f"   Generating rich content for {len(articles)} articles...")

        rich_service = RichSummaryService(db)
        success_count = 0

        for article in articles:
            try:
                expert_note = db.query(ExpertNote).filter(
                    ExpertNote.article_id == article.id
                ).first()

                if not expert_note:
                    continue

                _default_ind, _default_ind_name = IndustriesConfig.get_instance().get_default_industry()
                industry = expert_note.expert_industry or _default_ind_name
                specializations = expert_note.expert_specializations or ['General']
                specialization = specializations[0] if specializations else 'General'

                rich_content = rich_service.generate_rich_content(
                    article=article,
                    industry=industry,
                    specialization=specialization,
                    related_article_titles=None
                )

                if rich_content:
                    success_count += 1

            except Exception as e:
                logger.debug(f"   Failed to generate rich content for {article.id}: {e}")
                continue

        logger.info(f"   Generated rich content for {success_count}/{len(articles)} articles")

    except Exception as e:
        logger.error(f"Error warming rich content: {e}")


def _build_filter_contexts_for_user(profile: UserProfile) -> List[str]:
    """Build list of filter contexts based on user profile."""
    import json
    filter_contexts = ['core']

    if profile.core_industry:
        filter_contexts.append(f"industry:{profile.core_industry}")

    if profile.specializations:
        try:
            specializations = json.loads(profile.specializations) if isinstance(profile.specializations, str) else profile.specializations
            for spec in specializations[:4]:
                filter_contexts.append(f"specialization:{spec}")
        except (ValueError, TypeError):
            logger.warning(f"Could not parse specializations: {profile.specializations}")

    if profile.additional_interest_industries:
        try:
            interests = json.loads(profile.additional_interest_industries) if isinstance(profile.additional_interest_industries, str) else profile.additional_interest_industries
            for interest in interests[:4]:
                filter_contexts.append(f"interest:{interest}")
        except (ValueError, TypeError):
            logger.warning(f"Could not parse interests: {profile.additional_interest_industries}")

    return filter_contexts


async def pre_generate_base_storyboards():
    """
    Pre-generate BASE storyboards for all unique filter contexts across all users.

    Instead of generating per-user (N_users * N_filters LLM calls), we:
    1. Collect unique resolved filter keys across all users
    2. Build base storyboards once per unique key (summary + theme + narrative)
    3. Personal prompts are generated lazily per-user on first /catchup-feed request

    For 177 users with ~5 filters each, this reduces from ~885 full builds to ~30 base builds.
    """
    logger.info("Starting base storyboard pre-generation...")
    start_time = time.time()

    db = SessionLocal()
    try:
        users = db.query(User).join(UserProfile).filter(User.is_active == True).all()

        if not users:
            logger.warning("No active users found for storyboard pre-generation")
            return

        logger.info(f"Found {len(users)} active users")

        # Phase 1: Collect unique base cache keys across all users
        # Map: base_cache_key -> (user, filter_context) for building
        unique_keys: Dict[str, tuple] = {}

        for user in users:
            profile = user.profile
            if not profile:
                continue

            filter_contexts = _build_filter_contexts_for_user(profile)
            for fc in filter_contexts:
                base_key = resolve_base_cache_key(user, fc, db)
                if base_key not in unique_keys:
                    unique_keys[base_key] = (user, fc)

        total_user_filters = sum(
            len(_build_filter_contexts_for_user(u.profile))
            for u in users if u.profile
        )
        logger.info(
            f"Resolved {total_user_filters} user-filter combos to {len(unique_keys)} unique base keys"
        )

        # Phase 2: Build base storyboards for each unique key
        total_storyboards = 0
        for base_key, (representative_user, filter_context) in unique_keys.items():
            try:
                storyboards = _get_or_build_base_storyboards(
                    representative_user, filter_context, db
                )
                total_storyboards += len(storyboards)
                logger.info(f"   {base_key}: {len(storyboards)} base storyboards")
            except Exception as e:
                logger.error(f"   Failed to build base storyboards for {base_key}: {e}")
                continue

        total_duration = time.time() - start_time
        logger.info(
            f"Base storyboard pre-generation complete! "
            f"{total_storyboards} storyboards for {len(unique_keys)} unique filters in {total_duration:.2f}s"
        )

    except Exception as e:
        logger.error(f"Error during base storyboard pre-generation: {e}")

    finally:
        db.close()


async def warm_startup_caches():
    """Warm all startup caches including base storyboards."""
    logger.info("Starting cache warming process...")

    try:
        await pre_generate_base_storyboards()
        logger.info("Cache warming complete - backend ready for fast responses")

    except Exception as e:
        logger.error(f"Error during cache warming: {e}")
        logger.info("Cache warming failed but backend will continue starting")


def run_cache_warming_sync():
    """Synchronous wrapper for cache warming (for use in startup events)."""
    try:
        logger.info("Starting cache warming process...")

        db = SessionLocal()
        try:
            # Step 1: Generate rich content for articles without it
            logger.info("Generating rich content for articles...")
            _warm_rich_content(db)

            # Step 2: Collect unique filter keys and build base storyboards
            users = db.query(User).join(UserProfile).filter(User.is_active == True).all()

            if not users:
                logger.warning("No active users found for storyboard pre-generation")
                return

            logger.info(f"Found {len(users)} active users")

            # Collect unique base cache keys
            unique_keys: Dict[str, tuple] = {}
            for user in users:
                profile = user.profile
                if not profile:
                    continue
                filter_contexts = _build_filter_contexts_for_user(profile)
                for fc in filter_contexts:
                    base_key = resolve_base_cache_key(user, fc, db)
                    if base_key not in unique_keys:
                        unique_keys[base_key] = (user, fc)

            total_user_filters = sum(
                len(_build_filter_contexts_for_user(u.profile))
                for u in users if u.profile
            )
            logger.info(
                f"Resolved {total_user_filters} user-filter combos to {len(unique_keys)} unique base keys"
            )

            # Build base storyboards for each unique key
            total_storyboards = 0
            start_time = time.time()

            for base_key, (representative_user, filter_context) in unique_keys.items():
                try:
                    storyboards = _get_or_build_base_storyboards(
                        representative_user, filter_context, db
                    )
                    total_storyboards += len(storyboards)
                    logger.info(f"   {base_key}: {len(storyboards)} base storyboards")
                except Exception as e:
                    logger.error(f"   Failed to build base storyboards for {base_key}: {e}")
                    continue

            total_duration = time.time() - start_time
            logger.info(
                f"Base storyboard pre-generation complete! "
                f"{total_storyboards} storyboards for {len(unique_keys)} unique filters in {total_duration:.2f}s"
            )

        finally:
            db.close()

    except Exception as e:
        logger.error(f"Error running cache warming: {e}")


# Deduplication lock: prevents multiple warming threads for the same user
import threading as _threading
_warming_in_progress: set = set()
_warming_lock = _threading.Lock()


def warm_user_filters_sync(user_id: str, current_filter: str = None):
    """
    Synchronous background task to pre-warm storyboards for a user's filters.
    Designed to run in a daemon thread (NOT on the async event loop).

    With base storyboard architecture, base storyboards are shared across users.
    This ensures base storyboards + personal prompts are pre-generated for other
    filters the user might switch to.
    """
    # Deduplicate: skip if warming is already in progress for this user
    with _warming_lock:
        if user_id in _warming_in_progress:
            logger.debug(f"Warming already in progress for user {user_id}, skipping")
            return
        _warming_in_progress.add(user_id)

    try:
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user or not user.profile:
                return

            filter_contexts = _build_filter_contexts_for_user(user.profile)

            # Remove current filter (already personalized)
            if current_filter in filter_contexts:
                filter_contexts.remove(current_filter)

            if not filter_contexts:
                return

            logger.info(f"Background warming {len(filter_contexts)} filters for user {user.email}")

            for filter_context in filter_contexts:
                try:
                    # This will use cached base storyboards + generate personal prompts
                    storyboards = get_or_build_storyboards_for_filter(user, filter_context, db)
                    logger.debug(f"   {filter_context}: {len(storyboards)} storyboards personalized")
                except Exception as e:
                    logger.error(f"   Failed to personalize {filter_context}: {e}")
                    continue

            logger.info(f"Background warming complete for user {user.email}")

        finally:
            db.close()

    except Exception as e:
        logger.error(f"Error in background filter warming: {e}")
    finally:
        with _warming_lock:
            _warming_in_progress.discard(user_id)
