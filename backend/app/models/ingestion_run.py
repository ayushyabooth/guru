from sqlalchemy import Column, String, DateTime, Integer, Text, Index, JSON
from sqlalchemy.sql import func
import uuid
from app.db.base import Base
from app.db.types import UUID


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id = Column(UUID(), primary_key=True, default=uuid.uuid4)
    tier = Column(String(30), nullable=False, index=True)  # 'tier1_expert', 'tier2_luminary', 'tier3_discovery'
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    articles_found = Column(Integer, default=0)
    articles_ingested = Column(Integer, default=0)
    articles_rejected = Column(Integer, default=0)
    rejection_log = Column(JSON, nullable=True)  # [{url, reason, score}, ...]
    status = Column(String(20), default='running')  # 'running', 'completed', 'failed'
    error_message = Column(Text, nullable=True)
    step_timings = Column(JSON, nullable=True)  # {"discovery_ms": 1200, "scraping_ms": 5400, ...}

    __table_args__ = (
        Index('idx_ingestion_run_tier_started', 'tier', 'started_at'),
    )
