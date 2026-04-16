# Guru MVP — Master Production Audit
**Date:** 2026-04-10  
**Auditor:** Production Lead  
**Environment:** Production (dist-guru8.vercel.app + Railway API) + Local Dev (localhost:8081/8000)  
**Test Account:** audit@guru.com (freshly created during audit)

---

## Executive Summary

**Overall Production Readiness: NOT READY — Critical Blockers Present**

The Guru MVP has strong architectural foundations and a clear product vision, but production is currently **non-functional** due to a downed backend, empty content pipelines, and several critical integration gaps. The app's core innovation (filter-driven semantic clustering) cannot be experienced by any user because (1) the production API is down, (2) article tags are missing, and (3) content ingestion has never been run in the local environment.

### Severity Distribution

| Severity | Count | Description |
|----------|-------|-------------|
| **P0 — Blocker** | 5 | App non-functional, cannot complete core journey |
| **P1 — Critical** | 8 | Major features broken or missing |
| **P2 — Major** | 10 | UX issues, design gaps, spec mismatches |
| **P3 — Minor** | 7 | Polish, papercuts, inconsistencies |

### What Shines
1. **Onboarding flow** — Clean, sequential, well-paced with progress indicators (steps 2-5)
2. **Recap entry screen** — Ghost rings, activity gating, journey stages preview — matches BRD vision
3. **Design language** — Dark glass aesthetic is distinctive and consistent where applied
4. **Backend architecture** — FastAPI + SQLAlchemy + Claude integration is solid when running
5. **Goal-setting UX** — Slider + pill presets with capacity-driven defaults

### Where It Falls Short
1. **Production is completely down** — Railway backend returns 503 on all endpoints
2. **Content pipeline never produces visible results** — 125 articles exist but 0 have industry/specialization tags, so feeds are always empty
3. **Chrome extension/overlay for Deep Dive is non-functional in production** — not distributed, no extension ID
4. **Only 3 of 10 industries implemented** — BRD promises 10
5. **Home screen rings visualization** doesn't match BRD (Venn diagram vs. Apple Health concentric rings)
6. **Dev tools exposed** — "Perf" and "Debug" buttons visible in production

### Where It's Broken
1. Backend API is down (Railway 503)
2. Article tagging pipeline produces empty tags → empty feeds everywhere
3. React hydration error #418 on every page load in production
4. Stale form data persists across sessions (login/signup pre-filled)
5. Deep Dive overlay/extension not functional in any environment except local dev

---

## Cross-Cutting Findings

### Production Environment
- **Frontend (Vercel):** HTTP 200, loads correctly, static Expo web export
- **Backend (Railway):** HTTP 503 "Application not found" on ALL paths — service crashed/sleeping
- **Database (Neon):** Unknown state — cannot verify without Railway access
- **React Error #418:** Hydration mismatch on every page load (SSR/CSR conflict)

### Data Integrity
- 125 articles in local DB, 611 rich content entries, 15 storyboard cache entries
- **0 articles have industry/specialization tags** — entire clustering pipeline produces empty results
- 200 test user accounts (DB pollution from automated tests)
- Stale content cleanup on startup deleted 494 articles, 356 storyboards

### Design Language Consistency
- Dark glass aesthetic applied inconsistently:
  - Auth screens: consistent dark glass cards
  - Onboarding: mixed (industry cards use different pattern than specialization cards)
  - Home: rings visualization doesn't match any standard pattern
  - Feed screens: minimal styling (mostly text on dark background)
- No unified EDL (Experience Design Language) document exists
- Category colors defined in code but not applied consistently
- Font: Orbitron for logo/headers, system font for body — no formal type scale

---

## Stage Spec References

| Spec | File | Key Findings |
|------|------|-------------|
| CX & Product | [01-CX-PRODUCT.md](01-CX-PRODUCT.md) | User journeys broken, 5 P0 blockers |
| Design & UX | [02-DESIGN-UX.md](02-DESIGN-UX.md) | No EDL, inconsistent patterns, 10 issues |
| Backend & Architecture | [03-BACKEND-ARCHITECTURE.md](03-BACKEND-ARCHITECTURE.md) | API down, empty tags, ingestion not running |
| Performance & Latency | [04-PERFORMANCE-LATENCY.md](04-PERFORMANCE-LATENCY.md) | Hydration error, cold start, no asset optimization |
| QA & Bugs | [05-QA-BUGS.md](05-QA-BUGS.md) | 30 items across all severities |
| Production Readiness | [06-PRODUCTION-READINESS.md](06-PRODUCTION-READINESS.md) | 5 release blockers, security gaps |
| Execution Plan | [07-EXECUTION-PLAN.md](07-EXECUTION-PLAN.md) | Phased rollout, 4 waves |
| Task Backlog | [08-TASK-BACKLOG.md](08-TASK-BACKLOG.md) | Full task list with metadata |

---

## Screenshots Captured

| Screen | File | Key Observation |
|--------|------|----------------|
| Production signup | ss_9336c8kaf | Pre-filled stale data |
| Production login error | ss_0653wfn7b | "Network error" — backend down |
| Local login | ss_19651ybwl | Works, stale data pre-filled |
| Login error | ss_19651ybwl | "Incorrect email or password" |
| Signup form | ss_67962tco4 | Clean empty form |
| Industry selection | ss_4545psihi | Only 3 industries |
| Industry selected | ss_6109z1isf | Cyan highlight on Consumer |
| Specializations | ss_9345fjv5x | 7 specs, button overlap |
| Interests | ss_7135bt4su | Optional step, skip button |
| Capacity | ss_6674h5obl | 3 tiers, button overlap |
| Goals | ss_4455uwi6u | Slider + pills, daily/weekly confusion |
| Home screen | ss_6093nrxyp | Venn rings, debug buttons, filter pills |
| Home scrolled | (inline) | Weekly progress bars, 0 activity |
| Catch-up empty | ss_47900zxzy | "No stories available" |
| Dive-in empty | ss_9997b1ygb | "No articles in this context" |
| Recap entry | ss_4924hv3vw | Ghost rings, journey stages |
| Recap scrolled | (inline) | 4 stages listed, audio stage shown |
