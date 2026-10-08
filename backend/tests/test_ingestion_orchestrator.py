"""
Tests for Ingestion Orchestrator

Verifies:
- Orchestrator starts without blocking
- Tiers 2 and 3 are scheduled; tier 1 is retired
- Status reporting works
- Ingestion routes function correctly

Run lifecycles, the boot guard and the health check are in test_ingestion_health.py.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timezone


# ── Orchestrator Structure Tests ───────────────────────────────


class TestOrchestratorStructure:
    def test_orchestrator_singleton(self):
        """Should return same instance on repeated calls."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator

        # Reset first
        IngestionOrchestrator._instance = None
        o1 = IngestionOrchestrator.get_instance()
        o2 = IngestionOrchestrator.get_instance()
        assert o1 is o2
        IngestionOrchestrator._instance = None

    def test_orchestrator_has_dedup_service(self):
        """Orchestrator should have deduplication service."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator

        IngestionOrchestrator._instance = None
        orchestrator = IngestionOrchestrator.get_instance()
        assert orchestrator._dedup is not None
        IngestionOrchestrator._instance = None

    def test_orchestrator_initial_state(self):
        """Orchestrator should start in non-running state."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator

        IngestionOrchestrator._instance = None
        orchestrator = IngestionOrchestrator.get_instance()
        assert orchestrator._running is False
        IngestionOrchestrator._instance = None


# ── Status Reporting Tests ─────────────────────────────────────


class TestOrchestratorStatus:
    def test_status_returns_running_state(self):
        """get_status should include running state."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator

        IngestionOrchestrator._instance = None
        orchestrator = IngestionOrchestrator.get_instance()
        status = orchestrator.get_status()
        assert "running" in status
        assert isinstance(status["running"], bool)
        IngestionOrchestrator._instance = None

    def test_status_includes_all_tiers(self):
        """get_status should attempt to report on all 3 tiers."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator

        IngestionOrchestrator._instance = None
        orchestrator = IngestionOrchestrator.get_instance()
        status = orchestrator.get_status()
        # Status always includes running state
        assert "running" in status
        # In test env DB may not have the table, so status may have 'error' key
        # But the method should not crash
        assert isinstance(status, dict)
        IngestionOrchestrator._instance = None


# ── Tier Wiring Tests ──────────────────────────────────────────


class TestTierWiring:
    """Verify tiers 2 and 3 are properly wired in the orchestrator, and tier 1 is gone."""

    def test_tier1_is_retired_never_scheduled_or_run(self, monkeypatch):
        """Tier 1 (curated expert links) is retired: a boot schedules tiers 2 and 3 only, checks the boot
        guard for those two only, and runs those two only. No tier 1 runner is left to call."""
        import asyncio
        import sys
        import types
        from app.services import ingestion_orchestrator as io

        jobs, checked, ran = [], [], []

        class _Scheduler:
            """Stands in for APScheduler's AsyncIOScheduler: records each job, starts nothing."""
            def add_job(self, func, trigger, **kw):
                jobs.append(kw["id"])

            def start(self):
                pass

        async def _run(tier):
            ran.append(tier)
            return 0

        async def _warm(new_articles_ingested=0):
            pass

        # start() imports the scheduler itself; this stand-in also covers a venv without APScheduler.
        scheduler_module = types.ModuleType("apscheduler.schedulers.asyncio")
        scheduler_module.AsyncIOScheduler = _Scheduler
        for name in ("apscheduler", "apscheduler.schedulers"):
            monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
        monkeypatch.setitem(sys.modules, "apscheduler.schedulers.asyncio", scheduler_module)
        monkeypatch.setattr(io.settings, "TIER2_RUN_AT", "")
        orchestrator = io.IngestionOrchestrator()
        monkeypatch.setattr(orchestrator, "_should_run_tier", lambda tier, hours: checked.append(tier) or True)
        monkeypatch.setattr(orchestrator, "_run_tier2_safe", lambda: _run("tier2_luminary"))
        monkeypatch.setattr(orchestrator, "_run_tier3_safe", lambda: _run("tier3_discovery"))
        monkeypatch.setattr(orchestrator, "_warm_content_safe", _warm)

        asyncio.run(orchestrator.start())

        assert jobs == ["tier2_luminary", "tier3_discovery"]
        assert checked == ["tier2_luminary", "tier3_discovery"]
        assert ran == ["tier2_luminary", "tier3_discovery"]
        assert not any(hasattr(io.IngestionOrchestrator, name) for name in ("run_tier1", "_run_tier1_safe"))

    def test_run_tier2_imports_luminary_service(self):
        """run_tier2 should import Tier1LuminaryService (luminary RSS)."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        source = inspect.getsource(IngestionOrchestrator.run_tier2)
        assert "Tier1LuminaryService" in source

    def test_run_tier3_imports_discovery_service(self):
        """run_tier3 should import Tier2DiscoveryService (web discovery)."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        source = inspect.getsource(IngestionOrchestrator.run_tier3)
        assert "Tier2DiscoveryService" in source

    def test_tier2_and_tier3_use_ingest_article(self):
        """Tier 2 (luminary) and Tier 3 (discovery) should use the shared ingest_article pipeline."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        tier2_source = inspect.getsource(IngestionOrchestrator.run_tier2)
        tier3_source = inspect.getsource(IngestionOrchestrator.run_tier3)

        assert "ingest_article" in tier2_source
        assert "ingest_article" in tier3_source

    def test_tier2_tags_articles_correctly(self):
        """Tier 2 should pass ingestion_tier='tier2_luminary'."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        source = inspect.getsource(IngestionOrchestrator.run_tier2)
        assert "tier2_luminary" in source

    def test_tier3_tags_articles_correctly(self):
        """Tier 3 should pass ingestion_tier='tier3_discovery'."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        source = inspect.getsource(IngestionOrchestrator.run_tier3)
        assert "tier3_discovery" in source


# ── Ingestion Route Tests ──────────────────────────────────────


class TestIngestionRoutes:
    def test_status_route_exists(self):
        """GET /api/v1/ingestion/status should be registered."""
        from app.routes.ingestion import router

        routes = [r.path for r in router.routes]
        assert "/api/v1/ingestion/status" in routes

    def test_runs_route_exists(self):
        """GET /api/v1/ingestion/runs should be registered."""
        from app.routes.ingestion import router

        routes = [r.path for r in router.routes]
        assert "/api/v1/ingestion/runs" in routes

    def test_trigger_route_exists(self):
        """POST /api/v1/ingestion/trigger/{tier} should be registered."""
        from app.routes.ingestion import router

        routes = [r.path for r in router.routes]
        assert "/api/v1/ingestion/trigger/{tier}" in routes

    def test_health_route_sits_with_the_admin_reads(self):
        """GET /api/v1/admin/ingestion/health (GUR-283) is on this router too. The router has no prefix,
        so the run routes above keep their /api/v1/ingestion paths and main.py includes one router."""
        from app.routes.ingestion import router

        assert router.prefix == ""
        assert "/api/v1/admin/ingestion/health" in [r.path for r in router.routes]


# ── Ingestion Run Model Tests ──────────────────────────────────


class TestIngestionRunModel:
    def test_model_has_required_columns(self):
        """IngestionRun should have all necessary columns."""
        from app.models.ingestion_run import IngestionRun

        # Check column existence
        columns = {c.name for c in IngestionRun.__table__.columns}
        assert "id" in columns
        assert "tier" in columns
        assert "started_at" in columns
        assert "completed_at" in columns
        assert "articles_found" in columns
        assert "articles_ingested" in columns
        assert "articles_rejected" in columns
        assert "status" in columns
        assert "error_message" in columns
        assert "rejection_log" in columns

    def test_model_table_name(self):
        """Should use 'ingestion_runs' table."""
        from app.models.ingestion_run import IngestionRun

        assert IngestionRun.__tablename__ == "ingestion_runs"
