"""
Ingestion Orchestrator - Master controller for 3-tier content ingestion.

Manages scheduling and execution of all three content tiers:
- Tier 1: Expert links file (every 2 hours) - runs first, fastest
- Tier 2: Luminary RSS feeds (every 6 hours)
- Tier 3: Web discovery via Claude Web Search (every 12 hours) - runs last

Runs as a background task, non-blocking to API startup.
Uses APScheduler (AsyncIOScheduler) for scheduling.
"""
import asyncio
import logging
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal
from app.models.ingestion_run import IngestionRun
from app.services.deduplication_service import DeduplicationService

logger = logging.getLogger(__name__)


class IngestionOrchestrator:
    """Master orchestrator for 3-tier content ingestion."""

    _instance = None

    def __init__(self):
        self._scheduler = None
        self._running = False
        self._dedup = DeduplicationService.get_instance()

    @classmethod
    def get_instance(cls) -> "IngestionOrchestrator":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def start(self):
        """
        Start the ingestion orchestrator.
        Called as fire-and-forget from main.py startup.
        """
        if self._running:
            logger.warning("Orchestrator already running, skipping start")
            return

        self._running = True
        logger.info("Starting Ingestion Orchestrator...")

        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler

            self._scheduler = AsyncIOScheduler()

            # Schedule tiers (each tier runs ingestion + warming afterward)
            self._scheduler.add_job(
                self._scheduled_tier1,
                "interval",
                hours=settings.TIER1_SCHEDULE_HOURS,
                id="tier1_expert",
                name="Tier 1: Expert Links",
            )
            self._scheduler.add_job(
                self._scheduled_tier2,
                "interval",
                hours=settings.TIER2_SCHEDULE_HOURS,
                id="tier2_luminary",
                name="Tier 2: Luminary RSS",
            )
            self._scheduler.add_job(
                self._scheduled_tier3,
                "interval",
                hours=settings.TIER3_SCHEDULE_HOURS,
                id="tier3_discovery",
                name="Tier 3: Web Discovery",
            )

            self._scheduler.start()
            logger.info("APScheduler started with tier schedules")

            # Run initial ingestion immediately (with timing)
            overall_start = time.time()

            # Phase A: Tier 1 (expert links, local file, fast)
            t1_start = time.time()
            t1_ingested = await self._run_tier1_safe()
            t1_end = time.time()
            logger.info(f"⏱️ TIMING: Tier 1 ingestion took {(t1_end - t1_start)*1000:.0f}ms ({t1_ingested} new articles)")

            warm1_start = time.time()
            await self._warm_content_safe(new_articles_ingested=t1_ingested)
            warm1_end = time.time()
            logger.info(f"⏱️ TIMING: Content warming (post-T1) took {(warm1_end - warm1_start)*1000:.0f}ms")

            # Phase B: Tier 2 (luminary RSS) - generates rich content per-article inline
            t2_start = time.time()
            t2_ingested = await self._run_tier2_safe()
            t2_end = time.time()
            logger.info(f"⏱️ TIMING: Tier 2 ingestion took {(t2_end - t2_start)*1000:.0f}ms ({t2_ingested} new articles)")

            warm2_start = time.time()
            await self._warm_content_safe(new_articles_ingested=t2_ingested)
            warm2_end = time.time()
            logger.info(f"⏱️ TIMING: Content warming (post-T2) took {(warm2_end - warm2_start)*1000:.0f}ms")

            # Phase C: Tier 3 (web search, slow) - runs last, doesn't block content
            t3_start = time.time()
            t3_ingested = await self._run_tier3_safe()
            t3_end = time.time()
            logger.info(f"⏱️ TIMING: Tier 3 ingestion took {(t3_end - t3_start)*1000:.0f}ms ({t3_ingested} new articles)")

            warm3_start = time.time()
            await self._warm_content_safe(new_articles_ingested=t3_ingested)
            warm3_end = time.time()
            logger.info(f"⏱️ TIMING: Content warming (post-T3) took {(warm3_end - warm3_start)*1000:.0f}ms")

            overall_end = time.time()
            logger.info(f"⏱️ TIMING: Total initial ingestion took {(overall_end - overall_start)*1000:.0f}ms ({(overall_end - overall_start):.1f}s)")
            logger.info("Initial ingestion runs complete")

        except Exception as e:
            logger.error(f"Failed to start orchestrator: {e}")
            self._running = False

    async def stop(self):
        """Stop the orchestrator and scheduler."""
        if self._scheduler:
            self._scheduler.shutdown()
        self._running = False
        self._dedup.clear_processing_urls()
        logger.info("Ingestion Orchestrator stopped")

    # ── Scheduled wrappers (tier + warming) ────────────────────────

    async def _scheduled_tier1(self):
        """Scheduled Tier 1: run ingestion then warm storyboards."""
        ingested = await self._run_tier1_safe()
        await self._warm_content_safe(new_articles_ingested=ingested)

    async def _scheduled_tier2(self):
        """Scheduled Tier 2: run ingestion then warm storyboards."""
        ingested = await self._run_tier2_safe()
        await self._warm_content_safe(new_articles_ingested=ingested)

    async def _scheduled_tier3(self):
        """Scheduled Tier 3: run ingestion then warm storyboards."""
        ingested = await self._run_tier3_safe()
        await self._warm_content_safe(new_articles_ingested=ingested)

    # ── Tier execution wrappers (safe, with error handling) ──────────

    async def _run_tier1_safe(self) -> int:
        """Run Tier 1 (expert links) with error handling. Returns articles ingested."""
        try:
            return await self.run_tier1()
        except Exception as e:
            logger.error(f"Tier 1 run failed: {e}")
            return 0

    async def _run_tier2_safe(self) -> int:
        """Run Tier 2 (luminary RSS) with error handling. Returns articles ingested."""
        try:
            return await self.run_tier2()
        except Exception as e:
            logger.error(f"Tier 2 run failed: {e}")
            return 0

    async def _run_tier3_safe(self) -> int:
        """Run Tier 3 (web discovery) with error handling. Returns articles ingested."""
        try:
            return await self.run_tier3()
        except Exception as e:
            logger.error(f"Tier 3 run failed: {e}")
            return 0

    async def _warm_content_safe(self, new_articles_ingested: int = 0):
        """Safety-net: backfill any articles missing rich content, then pre-generate storyboards.

        All tiers now generate rich content inline during ingestion.
        This method catches edge cases where inline generation failed.

        If new_articles_ingested > 0, clears all base storyboard caches first
        so storyboards are rebuilt with the new articles included.
        """
        try:
            logger.info(f"Content warming: backfilling rich content + storyboards (new_articles={new_articles_ingested})...")

            def _warm_sync():
                from app.db.database import SessionLocal
                from app.services.startup_service import _warm_rich_content
                db = SessionLocal()
                try:
                    _warm_rich_content(db, limit=200)
                finally:
                    db.close()

            await asyncio.to_thread(_warm_sync)

            # If new articles were ingested, invalidate all base storyboard caches
            # so they get rebuilt with the new articles
            if new_articles_ingested > 0:
                logger.info(f"Invalidating base storyboard caches ({new_articles_ingested} new articles)...")
                from app.services.clustering_service import clear_storyboard_cache
                await asyncio.to_thread(clear_storyboard_cache)

            from app.services.startup_service import pre_generate_base_storyboards
            await pre_generate_base_storyboards()

            logger.info("Content warming complete")
        except Exception as e:
            logger.error(f"Content warming failed: {e}")

    # ── Tier 1: Expert Links (existing pipeline, wrapped) ────────────

    async def run_tier1(self) -> int:
        """
        Run Tier 1: Expert links file ingestion.
        Wraps the existing smart_ingest_expert_links() pipeline.
        Runs in a thread to avoid blocking the event loop.
        Returns number of articles ingested.
        """
        run = self._create_run("tier1_expert")
        try:
            logger.info("Tier 1: Starting expert links ingestion...")

            from app.services.markdown_ingestion_service import get_expert_links_filepath
            from app.tasks.ingestion_tasks import smart_ingest_expert_links

            try:
                expert_links_path = get_expert_links_filepath("auto")
            except FileNotFoundError:
                logger.info("Tier 1: No expert links file found, skipping")
                self._complete_run(run, articles_found=0, articles_ingested=0)
                return 0

            # smart_ingest_expert_links is async but internally synchronous,
            # so we run it in a thread to avoid blocking the event loop.
            def _run_sync():
                import asyncio
                loop = asyncio.new_event_loop()
                try:
                    return loop.run_until_complete(smart_ingest_expert_links(expert_links_path))
                finally:
                    loop.close()

            result = await asyncio.to_thread(_run_sync)
            logger.info(f"Tier 1 complete: {result.get('message', 'done')}")

            # Update run tracking with quality pipeline stats
            created = result.get("total_created", 0)
            skipped = result.get("total_skipped", 0)
            found = created + skipped
            self._complete_run(
                run,
                articles_found=found,
                articles_ingested=created,
            )
            return created

        except Exception as e:
            logger.error(f"Tier 1 failed: {e}")
            self._fail_run(run, str(e))
            return 0

    # ── Tier 2: Luminaries RSS Feeds ─────────────────────────────────

    async def run_tier2(self) -> int:
        """
        Run Tier 2: Luminary RSS feed ingestion.
        Discovers articles from RSS feeds, then passes each through shared pipeline.
        Returns number of articles ingested.
        """
        run = self._create_run("tier2_luminary")
        try:
            logger.info("Tier 2: Starting luminary RSS ingestion...")

            from app.services.tier1_luminary_service import Tier1LuminaryService
            from app.tasks.ingestion_tasks import ingest_article

            service = Tier1LuminaryService()
            discovery_start = time.time()
            discovered = await asyncio.to_thread(service.discover_articles)
            discovery_ms = (time.time() - discovery_start) * 1000
            logger.info(f"⏱️ TIMING: Tier 2 discovery took {discovery_ms:.0f}ms, found {len(discovered)} articles")

            articles_found = len(discovered)
            articles_ingested = 0
            articles_rejected = 0

            ingest_start = time.time()
            for article_data in discovered:
                try:
                    result = await asyncio.to_thread(
                        ingest_article,
                        url=article_data["url"],
                        notes=f"Via {article_data.get('luminary_name', 'RSS')}",
                        priority="Normal",
                        article_data=article_data,
                        ingestion_tier="tier2_luminary",
                    )
                    if result.get("success"):
                        articles_ingested += 1
                    else:
                        articles_rejected += 1
                except Exception as e:
                    logger.error(f"Tier 2 ingest failed for {article_data['url']}: {e}")
                    articles_rejected += 1
            ingest_ms = (time.time() - ingest_start) * 1000
            logger.info(f"⏱️ TIMING: Tier 2 article ingestion took {ingest_ms:.0f}ms ({articles_ingested} ingested, {articles_rejected} rejected)")

            logger.info(
                f"Tier 2 complete: {articles_ingested} ingested, "
                f"{articles_rejected} rejected out of {articles_found} discovered"
            )
            self._complete_run(
                run,
                articles_found=articles_found,
                articles_ingested=articles_ingested,
                articles_rejected=articles_rejected,
            )
            return articles_ingested

        except Exception as e:
            logger.error(f"Tier 2 failed: {e}")
            self._fail_run(run, str(e))
            return 0

    # ── Tier 3: Web Discovery ────────────────────────────────────────

    async def run_tier3(self) -> int:
        """
        Run Tier 3: Web discovery via Claude Web Search.
        Discovers articles using Claude's web search tool, then passes each through shared pipeline.
        Returns number of articles ingested.
        """
        run = self._create_run("tier3_discovery")
        try:
            logger.info("Tier 3: Starting web discovery...")

            from app.services.tier2_discovery_service import Tier2DiscoveryService
            from app.tasks.ingestion_tasks import ingest_article

            service = Tier2DiscoveryService()
            discovery_start = time.time()
            discovered = await asyncio.to_thread(service.discover_articles)
            discovery_ms = (time.time() - discovery_start) * 1000
            logger.info(f"⏱️ TIMING: Tier 3 discovery took {discovery_ms:.0f}ms, found {len(discovered)} articles")

            articles_found = len(discovered)
            articles_ingested = 0
            articles_rejected = 0

            ingest_start = time.time()
            for article_data in discovered:
                try:
                    result = await asyncio.to_thread(
                        ingest_article,
                        url=article_data["url"],
                        notes=f"Discovered via web search for {article_data.get('specializations', [''])[0]}",
                        priority="Normal",
                        article_data=article_data,
                        ingestion_tier="tier3_discovery",
                    )
                    if result.get("success"):
                        articles_ingested += 1
                    else:
                        articles_rejected += 1
                except Exception as e:
                    logger.error(f"Tier 3 ingest failed for {article_data['url']}: {e}")
                    articles_rejected += 1
            ingest_ms = (time.time() - ingest_start) * 1000
            logger.info(f"⏱️ TIMING: Tier 3 article ingestion took {ingest_ms:.0f}ms ({articles_ingested} ingested, {articles_rejected} rejected)")

            logger.info(
                f"Tier 3 complete: {articles_ingested} ingested, "
                f"{articles_rejected} rejected out of {articles_found} discovered"
            )
            self._complete_run(
                run,
                articles_found=articles_found,
                articles_ingested=articles_ingested,
                articles_rejected=articles_rejected,
            )
            return articles_ingested

        except Exception as e:
            logger.error(f"Tier 3 failed: {e}")
            self._fail_run(run, str(e))
            return 0

    # ── Run tracking helpers ─────────────────────────────────────────

    def _create_run(self, tier: str) -> Optional[IngestionRun]:
        """Create an IngestionRun record."""
        try:
            db = SessionLocal()
            run = IngestionRun(tier=tier, status="running")
            db.add(run)
            db.commit()
            db.refresh(run)
            db.close()
            return run
        except Exception as e:
            logger.error(f"Failed to create ingestion run: {e}")
            return None

    def _complete_run(
        self,
        run: Optional[IngestionRun],
        articles_found: int = 0,
        articles_ingested: int = 0,
        articles_rejected: int = 0,
        rejection_log: list = None,
    ):
        """Mark an IngestionRun as completed."""
        if not run:
            return
        try:
            db = SessionLocal()
            db_run = db.query(IngestionRun).filter(IngestionRun.id == run.id).first()
            if db_run:
                db_run.status = "completed"
                db_run.completed_at = datetime.utcnow()
                db_run.articles_found = articles_found
                db_run.articles_ingested = articles_ingested
                db_run.articles_rejected = articles_rejected
                if rejection_log:
                    db_run.rejection_log = rejection_log
                db.commit()
            db.close()
        except Exception as e:
            logger.error(f"Failed to complete ingestion run: {e}")

    def _fail_run(self, run: Optional[IngestionRun], error_message: str):
        """Mark an IngestionRun as failed."""
        if not run:
            return
        try:
            db = SessionLocal()
            db_run = db.query(IngestionRun).filter(IngestionRun.id == run.id).first()
            if db_run:
                db_run.status = "failed"
                db_run.completed_at = datetime.utcnow()
                db_run.error_message = error_message
                db.commit()
            db.close()
        except Exception as e:
            logger.error(f"Failed to mark ingestion run as failed: {e}")

    # ── Status ───────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Get current orchestrator status."""
        try:
            db = SessionLocal()
            # Get latest run for each tier
            status = {"running": self._running, "tiers": {}}
            for tier in ["tier1_expert", "tier2_luminary", "tier3_discovery"]:
                latest = (
                    db.query(IngestionRun)
                    .filter(IngestionRun.tier == tier)
                    .order_by(IngestionRun.started_at.desc())
                    .first()
                )
                if latest:
                    status["tiers"][tier] = {
                        "status": latest.status,
                        "last_run": latest.started_at.isoformat() if latest.started_at else None,
                        "articles_ingested": latest.articles_ingested,
                        "articles_rejected": latest.articles_rejected,
                    }
                else:
                    status["tiers"][tier] = {"status": "never_run"}
            db.close()
            return status
        except Exception as e:
            logger.error(f"Failed to get orchestrator status: {e}")
            return {"running": self._running, "error": str(e)}
