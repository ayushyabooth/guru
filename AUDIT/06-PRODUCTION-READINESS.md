# Stage Spec: Production Readiness & Release Blockers

## Release Blockers (Must fix before any public user access)

1. **Backend is DOWN** — Railway 503 on all endpoints
2. **No content in feeds** — Article tagging broken, all feeds empty
3. **Dev tools exposed** — Perf/Debug buttons visible to all users
4. **No content ingestion running** — All 3 tiers show "never_run"
5. **Deep Dive overlay non-functional** — Chrome extension not distributed

## Security Gaps
- No rate limiting on any endpoint
- No input sanitization beyond Pydantic validation
- CORS origins hardcoded (no env-driven config)
- Invite code ("GURU2026") is trivially guessable
- No password complexity requirements
- No CSRF protection
- No audit logging

## Operational Gaps
- No monitoring or alerting (Sentry, Datadog, etc.)
- No health check pinging (UptimeRobot, etc.)
- No auto-restart on crash
- Expert links file lost on every Railway deploy
- No database backup strategy
- No log aggregation
- No CI/CD pipeline — manual copy to guru-clean repo

## Infrastructure
- **Cost:** ~$10-20/mo (Railway $5, Neon free, Vercel free, Anthropic $5-15)
- **Scale:** Single instance, no horizontal scaling
- **Database:** Neon free tier (0.5GB, connection limits)
- **CDN:** None for static assets
- **SSL:** Managed by Railway/Vercel (working)
