# Stage Spec: Backend & Architecture

## Production API Status: DOWN (503)
- Railway returns HTTP 503 "Application not found" on ALL endpoints
- Health endpoint, API routes, docs — all 503
- Frontend correctly shows "Network error" but with generic message

### Likely Root Causes (ranked by probability)
1. Railway service sleeping due to inactivity (Hobby plan sleeps after idle period)
2. Missing or expired env vars (JWT_SECRET_KEY, ANTHROPIC_API_KEY required by Pydantic Field(...))
3. Database connection failure during startup (Neon free tier connection limits)
4. Docker build failure (fastembed model download, psycopg2 dependencies)

### Required Env Vars (from config.py)
- `JWT_SECRET_KEY` — Required, no default
- `ANTHROPIC_API_KEY` — Required, no default
- `DATABASE_URL` — Defaults to SQLite (unusable in production)
- `APP_ENV` — Should be "production"

## Ingestion Pipeline Status: NEVER RUN
```json
{
  "tier1_expert": {"status": "never_run"},
  "tier2_luminary": {"status": "never_run"},
  "tier3_discovery": {"status": "never_run"}
}
```

### Critical Issue: Article Tagging
- 125 articles exist in DB
- **0 articles have industry or specialization tags**
- Root cause: articles were likely ingested without the markdown section parser providing tags
- Impact: catch-up feed filter returns 0 articles for any filter → "No stories available" on every tab

### Data Integrity Issues
- 200 test user accounts polluting DB
- Stale content cleanup removed 494 articles on last startup (30-day window)
- Rich content count (611) exceeds article count (125) — orphaned records from deleted articles
- Storyboard cache has 15 entries but for unknown filter contexts (may be stale)

## Architecture Assessment

### What's Sound
- FastAPI + SQLAlchemy is well-structured with clear separation (routes/services/models)
- 3-tier ingestion architecture (expert links, luminaries, web discovery) is well-designed
- Quality pipeline with multi-stage assessment is robust
- Caching with sentinel UUID for shared base storyboards is smart
- APScheduler for non-blocking async is appropriate for MVP

### What Needs Work
- No deployment resilience — single Railway instance, no health checks, no auto-restart
- Expert links file lost on every deploy (ephemeral filesystem)
- No monitoring — no way to know the API is down except by trying it
- No rate limiting on API endpoints
- Database column migrations (`_run_column_migrations`) is fragile — should use Alembic properly

## API Response Times (Local)
- Health: <10ms
- Catchup feed (empty): 22ms
- Divein feed (empty): 22ms
- Metrics: <50ms
- Config industries: <10ms
- These are excellent for local but don't reflect production with Neon latency
