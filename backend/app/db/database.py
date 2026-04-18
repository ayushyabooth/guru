import logging
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import NullPool, QueuePool
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.db.base import Base

logger = logging.getLogger(__name__)

# Import all models to ensure they are registered with SQLAlchemy
from app.models import user, article, storyboard, interaction, recap, metric, cache, ingestion, qa_models, preferences, ingestion_run, article_rich_content
from app.models.article import ExpertLink

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

# SQLite needs special handling for multi-threaded access (ingestion runs in background threads)
# NullPool: each thread gets a fresh connection, no connection sharing — safest for SQLite
if _is_sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        echo=False,  # Disabled during profiling (was settings.DEBUG)
        poolclass=NullPool,
        connect_args={"check_same_thread": False, "timeout": 30},
    )
else:
    engine = create_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        poolclass=QueuePool,
        pool_pre_ping=True,
        pool_recycle=300,
    )

# Enable WAL mode for SQLite — allows concurrent reads while one thread writes
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")  # Wait up to 30s for locks
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create all database tables and run lightweight migrations."""
    # Enable uuid-ossp extension on PostgreSQL (required for UUID generation)
    if not _is_sqlite:
        with engine.connect() as conn:
            try:
                conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
                conn.commit()
                logger.info("PostgreSQL uuid-ossp extension enabled")
            except Exception as e:
                conn.rollback()
                logger.warning(f"Could not create uuid-ossp extension: {e}")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"CRITICAL: Failed to create database tables: {e}")
        # Try creating tables one by one to identify the problematic model
        for table in Base.metadata.sorted_tables:
            try:
                table.create(bind=engine, checkfirst=True)
            except Exception as table_err:
                logger.error(f"  Failed to create table '{table.name}': {table_err}")
    _run_column_migrations()
    _seed_expert_links()


def _seed_expert_links():
    """Seed ExpertLink table from the legacy file on first startup (if table is empty)."""
    try:
        db = SessionLocal()
        try:
            count = db.query(ExpertLink).count()
            if count > 0:
                logger.info(f"ExpertLink table already has {count} rows — skipping seed")
                return

            # Look for legacy expert-links.md in the backend directory
            import os
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            legacy_path = os.path.join(backend_dir, "expert-links.md")
            if not os.path.exists(legacy_path):
                logger.info("No expert-links.md found for seeding — ExpertLink table stays empty")
                return

            from app.services.csv_ingestion_service import parse_expert_links_csv
            articles = parse_expert_links_csv(legacy_path)
            if not articles:
                logger.warning("expert-links.md parsed 0 articles — nothing to seed")
                return

            inserted = 0
            for art in articles:
                url = art.get('url', '').strip()
                if not url:
                    continue
                existing = db.query(ExpertLink).filter(ExpertLink.url == url).first()
                if existing:
                    continue
                link = ExpertLink(
                    url=url,
                    title=art.get('title', ''),
                    domain=art.get('domain', ''),
                    article_type=art.get('type', ''),
                    importance=art.get('priority', 'Normal'),
                )
                db.add(link)
                inserted += 1

            db.commit()
            logger.info(f"Seeded {inserted} expert links from expert-links.md into DB")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"ExpertLink seeding failed (non-fatal): {e}")


def _run_column_migrations():
    """Add columns that create_all() can't add to existing tables."""
    migrations = [
        # Article columns (may be missing if table was created before model was updated)
        ("articles", "industries", "JSON"),
        ("articles", "specializations", "JSON"),
        ("articles", "ingestion_tier", "VARCHAR(30)"),
        ("articles", "quality_score", "FLOAT"),
        ("articles", "luminary_id", "VARCHAR(100)"),
        ("articles", "discovery_query", "VARCHAR(500)"),
        ("articles", "content_hash", "VARCHAR(64)"),
        ("articles", "article_image_url", "VARCHAR(2048)"),
        ("articles", "scrape_attempted", "BOOLEAN DEFAULT FALSE"),
        ("articles", "image_source", "VARCHAR(50)"),
        ("articles", "inline_images", "JSON"),
        ("articles", "word_count", "INTEGER"),
        # Storyboard columns
        ("storyboards", "base_cache_key", "VARCHAR(500)"),
        # Recap columns
        ("recap_journeys", "audio_status", "VARCHAR(30)"),
        ("recap_journeys", "audio_error", "TEXT"),
        # Ingestion run columns
        ("ingestion_runs", "step_timings", "JSON"),
        # QA columns
        ("qa_exchanges", "conversation_id", "VARCHAR(36)"),
        ("qa_exchanges", "exchange_type", "VARCHAR(20) DEFAULT 'direct'"),
    ]
    import re
    _SAFE_IDENTIFIER = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    with engine.connect() as conn:
        for table, column, col_type in migrations:
            # Validate identifiers to prevent SQL injection
            if not _SAFE_IDENTIFIER.match(table) or not _SAFE_IDENTIFIER.match(column):
                logger.error(f"Migration skipped: unsafe identifier {table}.{column}")
                continue
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                conn.commit()
                logger.info(f"Migration: added {table}.{column}")
            except Exception:
                conn.rollback()  # Column likely already exists
