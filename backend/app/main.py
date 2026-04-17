from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
import time
from app.config import settings
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Configure logging so app-level loggers output to console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
from app.routes import auth, articles, storyboards, users, admin, divein, qa, recap, metrics, config, article_reader, socratic_chat, custom_qa, reader, ingestion, interactions
from app.routes import settings as settings_routes
from app.db.database import create_tables

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Guru API",
    description="Expert-curated reading app backend",
    version="1.0.0",
    debug=settings.DEBUG
)

# Rate limiting
from app.routes.auth import limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["X-Response-Time-Ms"],
)

# HTTPS redirect — disabled; Railway/Vercel handle TLS at the proxy level.
# Adding HTTPSRedirectMiddleware causes redirect loops behind reverse proxies.

# API timing middleware - logs response time and records to PerfStore
@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    from app.services.perf_store import PerfStore
    start = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start) * 1000
    response.headers["X-Response-Time-Ms"] = str(round(duration_ms, 1))
    # Record to in-memory perf store (skip static/health endpoints)
    path = request.url.path
    if path.startswith("/api/"):
        PerfStore.get_instance().record_api_call(
            method=request.method, path=path,
            status_code=response.status_code, duration_ms=duration_ms,
        )
    if duration_ms > 100:
        logger.info(f"⏱️ API: {request.method} {path} - {duration_ms:.1f}ms")
    if duration_ms > 500:
        logger.warning(f"🐌 SLOW API: {request.method} {path} - {duration_ms:.1f}ms")
    return response

# Include routers
app.include_router(auth.router)
app.include_router(articles.router)
app.include_router(storyboards.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(divein.router)
app.include_router(qa.router)
app.include_router(recap.router)
app.include_router(settings_routes.router)
app.include_router(metrics.router)
app.include_router(article_reader.router)
app.include_router(socratic_chat.router)
app.include_router(custom_qa.router)
app.include_router(reader.router)
app.include_router(ingestion.router)
app.include_router(interactions.router)

# Import and include cache status router
from app.routes import cache_status
app.include_router(cache_status.router)

# Import and include config router
app.include_router(config.router)


# Production: mask internal error details from clients
if settings.APP_ENV == "production":
    @app.exception_handler(500)
    async def internal_error_handler(request: Request, exc: Exception):
        logger.error(f"Internal error on {request.method} {request.url.path}: {exc}", exc_info=True)
        return JSONResponse(status_code=500, content={"detail": "An internal error occurred. Please try again."})


def _cleanup_stale_content(max_age_days: int = 30):
    """Delete articles, storyboards, caches, and ingestion runs older than max_age_days.

    Cascade rules on the DB handle child records (ExpertNote, ArticleRichContent,
    StoryboardArticle, UserSavedArticle, QAExchange, ArticleAnnotation, UserNotRelevant).

    Deletion order:
      1. StoryboardCache (no FKs)
      2. IngestionRun (no FKs)
      3. Storyboards referencing stale articles as headline (to avoid FK violation)
      4. Storyboards older than max_age_days
      5. Articles older than max_age_days
    """
    from datetime import datetime, timedelta
    from app.db.database import SessionLocal
    from app.models.article import Article
    from app.models.storyboard import Storyboard
    from app.models.cache import StoryboardCache
    from app.models.ingestion_run import IngestionRun

    cutoff = datetime.utcnow() - timedelta(days=max_age_days)
    db = SessionLocal()
    try:
        # 1. Stale cache entries
        cache_deleted = db.query(StoryboardCache).filter(
            StoryboardCache.created_at < cutoff
        ).delete(synchronize_session=False)

        # 2. Stale ingestion runs
        runs_deleted = db.query(IngestionRun).filter(
            IngestionRun.started_at < cutoff
        ).delete(synchronize_session=False)

        # 3. Stale article IDs (needed for storyboard FK cleanup)
        stale_article_ids = [
            row[0] for row in db.query(Article.id).filter(Article.created_at < cutoff).all()
        ]

        # 4. Storyboards whose headline article is stale (prevents FK violation)
        sb_headline_deleted = 0
        if stale_article_ids:
            sb_headline_deleted = db.query(Storyboard).filter(
                Storyboard.headline_article_id.in_(stale_article_ids)
            ).delete(synchronize_session=False)

        # 5. Storyboards older than cutoff
        sb_deleted = db.query(Storyboard).filter(
            Storyboard.created_at < cutoff
        ).delete(synchronize_session=False)

        # 6. Articles older than cutoff (cascades handle children)
        articles_deleted = db.query(Article).filter(
            Article.created_at < cutoff
        ).delete(synchronize_session=False)

        # 7. Expired revoked tokens (safe to delete once the JWT itself has expired)
        from app.models.user import RevokedToken
        jtis_deleted = db.query(RevokedToken).filter(
            RevokedToken.expires_at < datetime.utcnow()
        ).delete(synchronize_session=False)

        db.commit()

        total_sb = sb_headline_deleted + sb_deleted
        logger.info(
            f"Stale content cleanup (>{max_age_days} days): "
            f"{articles_deleted} articles, {total_sb} storyboards, "
            f"{cache_deleted} cache entries, {runs_deleted} ingestion runs, "
            f"{jtis_deleted} expired revoked tokens removed"
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Stale content cleanup failed: {e}")
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    """Fast, non-blocking startup: config + tables + cleanup + fire-and-forget orchestrator"""
    logger.info("Starting Guru API...")

    # Load industries configuration (fast)
    try:
        from app.services.industries_config import IndustriesConfig
        IndustriesConfig.get_instance()
        logger.info("Industries configuration loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load industries configuration: {e}")
        raise

    # Ensure tables exist before serving requests (fast)
    try:
        create_tables()
    except Exception as e:
        logger.error(f"Failed to create tables on startup: {e}")

    # Clean up stale content (>30 days old)
    try:
        _cleanup_stale_content(max_age_days=30)
    except Exception as e:
        logger.error(f"Stale content cleanup error: {e}")

    # Start ingestion orchestrator (non-blocking, fire-and-forget)
    try:
        import asyncio
        from app.services.ingestion_orchestrator import IngestionOrchestrator
        orchestrator = IngestionOrchestrator.get_instance()
        asyncio.create_task(orchestrator.start())
        logger.info("Ingestion orchestrator started (background)")
    except Exception as e:
        logger.error(f"Failed to start ingestion orchestrator: {e}")

    logger.info("API ready")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "message": "Guru API is running"}


@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Welcome to Guru API", "version": "1.0.0"}
