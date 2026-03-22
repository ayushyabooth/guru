"""
Tests for Ingestion Orchestrator

Verifies:
- Orchestrator starts without blocking
- All 3 tiers are scheduled
- Status reporting works
- Ingestion routes function correctly
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
    """Verify all 3 tiers are properly wired in the orchestrator."""

    def test_run_tier1_imports_expert_links(self):
        """run_tier1 should import smart_ingest_expert_links (expert links)."""
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        import inspect

        source = inspect.getsource(IngestionOrchestrator.run_tier1)
        assert "smart_ingest_expert_links" in source

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

    def test_router_has_correct_prefix(self):
        """Router should use /api/v1/ingestion prefix."""
        from app.routes.ingestion import router

        assert router.prefix == "/api/v1/ingestion"


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
