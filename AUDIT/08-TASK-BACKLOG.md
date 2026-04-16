# Guru MVP — Task Backlog
**Generated:** 2026-04-10 from Production Audit  
**Format:** Each task includes problem, scope, severity, owner, dependencies, acceptance criteria, validation method, status

---

## P0 — BLOCKERS (Must fix before any user can use the app)

### P0-1: Production Backend Down (Railway 503)
- **Problem:** Railway backend returns HTTP 503 "Application not found" on ALL paths. The entire production app is non-functional — login, feeds, everything fails.
- **Scope:** Infrastructure / DevOps
- **Severity:** P0 — Blocker
- **Owner:** Architect
- **Dependencies:** None
- **Acceptance Criteria:**
  - `curl https://guru-production-1b4f.up.railway.app/health` returns `{"status": "healthy"}`
  - Login succeeds from production frontend
  - All API endpoints respond (catchup-feed, divein-feed, me, metrics)
- **Validation:** `curl` health check + login from dist-guru8.vercel.app
- **Status:** NOT STARTED
- **Root Cause Candidates:** Railway service sleeping/crashed, missing env vars (JWT_SECRET_KEY, ANTHROPIC_API_KEY, DATABASE_URL), Docker build failure, Neon DB connection timeout

### P0-2: Article Tagging Pipeline Broken — Zero Articles Tagged
- **Problem:** All 125 articles in the database have empty `industries` and `specializations` columns. The entire catch-up feed, dive-in feed, and clustering pipeline depends on these tags. Every feed shows "No stories available."
- **Scope:** Backend ingestion pipeline
- **Severity:** P0 — Blocker
- **Owner:** Developer
- **Dependencies:** P0-1 (for production), none for local
- **Acceptance Criteria:**
  - All ingested articles have non-empty `industries` and `specializations` arrays
  - Catch-up feed returns storyboards when filter tab is tapped
  - Dive-in feed returns articles in essential/discovery pools
- **Validation:** `SELECT COUNT(*) FROM articles WHERE industries IS NULL OR industries = '[]'` returns 0
- **Status:** NOT STARTED

### P0-3: Content Ingestion Never Run in Production
- **Problem:** Ingestion status shows all 3 tiers as "never_run". No content is being ingested on any schedule. Expert links file is missing (Railway ephemeral filesystem wipes it on deploy).
- **Scope:** Backend operations
- **Severity:** P0 — Blocker
- **Owner:** Architect
- **Dependencies:** P0-1
- **Acceptance Criteria:**
  - Expert links uploaded after deploy
  - At least one tier has status "completed" with articles_ingested > 0
  - APScheduler is running and tiers execute on schedule (Tier 1: 2h, Tier 2: 6h, Tier 3: 12h)
- **Validation:** `GET /ingestion/status` shows completed runs with article counts
- **Status:** NOT STARTED

### P0-4: Dev Tools Exposed in Production Build
- **Problem:** "Perf" and "Debug" buttons are visible in the top-right corner of the production app. These expose internal performance metrics and debug controls to end users.
- **Scope:** Frontend build config
- **Severity:** P0 — Blocker
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:**
  - Perf and Debug buttons are not visible in production build (`APP_ENV=production`)
  - Buttons only appear when `__DEV__` or explicit debug flag is set
- **Validation:** Visual inspection of production build
- **Status:** NOT STARTED

### P0-5: Deep Dive Chrome Extension/Overlay Non-Functional in Production
- **Problem:** The Chrome extension that enables the Guru overlay on article pages (the "widget" for deep dive reading with annotations, Ask Guru, notes) is built but: (1) not distributed via Chrome Web Store, (2) extension ID is hardcoded empty string, (3) `externally_connectable` only matches localhost, (4) the web app fallback (reading state page) opens but cannot communicate with extension. This means the core "Deep Dive" reading experience with Guru's value-add overlays doesn't work for any production user.
- **Scope:** Extension distribution + frontend integration
- **Severity:** P0 — Blocker
- **Owner:** Developer + DevOps
- **Dependencies:** P0-1
- **Acceptance Criteria:**
  - Extension published to Chrome Web Store (or available via direct install link)
  - Extension ID configured in mobile app env
  - `externally_connectable` includes production Vercel domain
  - User can open article → see Guru FAB → access overlay panel with Summary/Insights/Notes/Ask Guru tabs
- **Validation:** Install extension → navigate to article → Guru overlay activates
- **Status:** NOT STARTED

---

## P1 — CRITICAL (Major features broken or missing)

### P1-1: Only 3 of 10 Industries Configured
- **Problem:** Backend config loads 3 industries (Consumer, Technology, Finance) but BRD specifies 10 (+ Healthcare, Manufacturing, Energy, Real Estate, Education, Government, Non-Profit). Users in 7 industries cannot onboard.
- **Scope:** Backend config
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** `GET /config/industries` returns 10 industries with 5 specializations each (50 total)
- **Validation:** API response + onboarding screen shows all 10
- **Status:** NOT STARTED

### P1-2: React Hydration Error #418 in Production
- **Problem:** Every page load in production triggers React error #418 (SSR/CSR mismatch). This causes visual flicker and potential state corruption.
- **Scope:** Frontend build / SSR config
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** No React hydration errors in browser console on any page
- **Validation:** Console monitoring on production pages
- **Status:** NOT STARTED

### P1-3: Home Screen Rings Don't Match BRD Design
- **Problem:** BRD specifies Apple Health-style concentric progress rings. Implementation shows an interlocking Venn diagram of 3 overlapping circles. The Venn design doesn't clearly communicate individual progress per ring.
- **Scope:** Frontend component (GuruRings)
- **Severity:** P1 — Critical
- **Owner:** UX + Developer
- **Dependencies:** EDL definition
- **Acceptance Criteria:** Rings visually communicate 3 separate progress percentages clearly, match agreed design direction
- **Validation:** Visual review + user comprehension test
- **Status:** NOT STARTED

### P1-4: Weekly Stats / Streak / Top Topics Missing from Home
- **Problem:** BRD Epic G.2 specifies: weekly stats cards (articles read, saved, time, filters), reading streak visualization, top topics breakdown, commitment reminder card. None of these are implemented on the Home screen.
- **Scope:** Frontend Home screen
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** Metrics API (exists)
- **Acceptance Criteria:** Home screen shows weekly stats, streak count, and commitment reminder when available
- **Validation:** Visual inspection with active user data
- **Status:** NOT STARTED

### P1-5: Audio Recap (Stage 4) Not Implemented
- **Problem:** Recap Stage 4 "Listen" promises NotebookLM-style audio but backend AudioRecapService is incomplete. Frontend polls for audio status but it never becomes ready. TTS integration with ElevenLabs is not wired.
- **Scope:** Backend service + frontend player
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** ElevenLabs API key
- **Acceptance Criteria:** Full-tier users can generate and play audio recap after completing Stages 1-3
- **Validation:** Complete recap journey → audio generates → plays in browser
- **Status:** NOT STARTED

### P1-6: Stale Form Data Persists Across Sessions
- **Problem:** Login and signup forms retain previous user's email and password across browser sessions. This is a security and UX issue — a new user sees someone else's email pre-filled.
- **Scope:** Frontend auth forms
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** Auth forms always start empty, no autocomplete of previous session data
- **Validation:** Clear localStorage → navigate to login → fields empty
- **Status:** NOT STARTED

### P1-7: Onboarding Step 1 (Industry) Missing Progress Bar
- **Problem:** Steps 2-5 of onboarding show "Step N of 5" with progress bar. Step 1 (Industry Selection) has no progress indicator, no step count, and no back button. Feels disconnected from the rest of the flow.
- **Scope:** Frontend onboarding
- **Severity:** P1 — Critical
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** Industry screen shows "Step 1 of 5" with progress bar matching steps 2-5
- **Validation:** Visual inspection
- **Status:** NOT STARTED

### P1-8: Daily vs Weekly Goal Confusion
- **Problem:** BRD specifies Dive-in as a weekly goal. Onboarding sets it as "Daily Dive-in" (30 min/day) and multiplies by 7 (210m weekly). This creates confusion — users set a daily number thinking it's daily, but it's actually their weekly budget divided by 7.
- **Scope:** Frontend onboarding + metrics display
- **Severity:** P1 — Critical
- **Owner:** PM + Developer
- **Dependencies:** None
- **Acceptance Criteria:** Dive-in goal clearly labeled as weekly (not daily) throughout the app
- **Validation:** Onboarding text, home screen, and metrics all say "weekly"
- **Status:** NOT STARTED

---

## P2 — MAJOR (UX issues, design gaps, spec mismatches)

### P2-1: Industry Cards Too Large / Poor Visual Hierarchy
- **Problem:** Industry selection cards are massive (each takes ~1/3 of viewport height) with tiny centered icons. Most of the card is empty space. With only 3 industries this works, but with 10 it won't scroll well.
- **Scope:** Frontend onboarding
- **Severity:** P2
- **Owner:** UX
- **Dependencies:** P1-1 (more industries)
- **Acceptance Criteria:** Cards are appropriately sized for 10 industries, visible without scrolling on desktop
- **Validation:** Visual review with 10 industries
- **Status:** NOT STARTED

### P2-2: Button Overlay on Last Card (Specializations + Capacity Screens)
- **Problem:** Back/Continue buttons float at bottom of viewport and overlap the last card in the list. On Specializations, the "Specialty Retail" card is partially hidden by buttons. On Capacity, the explanation text is covered.
- **Scope:** Frontend layout
- **Severity:** P2
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** Buttons don't overlap content; sufficient padding below last card
- **Validation:** Scroll to bottom → all content visible above buttons
- **Status:** NOT STARTED

### P2-3: Specialization Count Mismatch (BRD: max 2, UI: 1-4)
- **Problem:** BRD says "Pick 1–2 specializations." UI says "Select 1-4 areas" with "0/4 selected" counter.
- **Scope:** Frontend + Backend validation
- **Severity:** P2
- **Owner:** PM (decide) + Developer (implement)
- **Dependencies:** None
- **Acceptance Criteria:** BRD and UI agree on max specializations; backend validates accordingly
- **Validation:** Try selecting >N specializations → blocked
- **Status:** NOT STARTED

### P2-4: No Unified EDL (Experience Design Language)
- **Problem:** No formal design system document exists. Colors, spacing, typography, component patterns are defined ad-hoc in code. Category colors exist but aren't consistently applied. Glass card style varies across screens.
- **Scope:** Design system
- **Severity:** P2
- **Owner:** UX Lead
- **Dependencies:** Theme Factory MCP (not available — manual creation needed)
- **Acceptance Criteria:** EDL document defines: color palette, typography scale, spacing system, component library, category color mapping, glass card variants
- **Validation:** Document exists and is referenced by all new component work
- **Status:** NOT STARTED

### P2-5: Empty States Are Bland and Non-Actionable
- **Problem:** Empty states across Catch-up ("No stories available"), Dive-in ("No articles in this context"), and Home ("0m" everything) are text-only with no illustrations, no helpful CTAs, and no guidance for new users.
- **Scope:** Frontend all tabs
- **Severity:** P2
- **Owner:** UX + Developer
- **Dependencies:** None
- **Acceptance Criteria:** Each empty state has: illustration/icon, helpful message, primary CTA (e.g., "Trigger ingestion" for admin, "Check back soon" for users)
- **Validation:** Visual review of all empty states
- **Status:** NOT STARTED

### P2-6: Catch-up vs Dive-in Empty State Inconsistency
- **Problem:** Catch-up empty state has a "Refresh" button. Dive-in empty state does not. Different copy style too.
- **Scope:** Frontend
- **Severity:** P2
- **Owner:** Developer
- **Dependencies:** P2-5
- **Acceptance Criteria:** Both feeds have consistent empty state pattern
- **Validation:** Visual comparison
- **Status:** NOT STARTED

### P2-7: Tab Bar Ring Icons Too Small / Low Contrast
- **Problem:** Bottom tab bar has tiny ring indicators next to tab labels. At the current size they're barely visible and don't clearly communicate progress.
- **Scope:** Frontend navigation
- **Severity:** P2
- **Owner:** UX
- **Dependencies:** None
- **Acceptance Criteria:** Tab icons are clearly visible and communicate progress state
- **Validation:** Visual review at 1x and 2x
- **Status:** NOT STARTED

### P2-8: No Error Recovery UI
- **Problem:** When API calls fail (e.g., production backend down), the app shows generic "Network error" on login but no retry mechanism, no offline indicator, no "try again" flow on other screens.
- **Scope:** Frontend error handling
- **Severity:** P2
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** All API failures show contextual error with retry button; network connectivity indicator
- **Validation:** Kill backend → verify each screen shows appropriate error + retry
- **Status:** NOT STARTED

### P2-9: 200 Test Users Pollute Local Database
- **Problem:** Local test.db has 200 auto-generated test accounts from various test runs. This makes debugging harder and wastes DB queries.
- **Scope:** Dev tooling
- **Severity:** P2
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** Clean DB script exists; test users cleaned from dev DB
- **Validation:** `SELECT COUNT(*) FROM users` returns reasonable number
- **Status:** NOT STARTED

### P2-10: Expo / React Native Package Version Mismatches
- **Problem:** 6 packages have version mismatches with Expo SDK 54 (expo, expo-constants, expo-router, react-native-svg, react-native-webview, jest). Warning shown on every startup.
- **Scope:** Frontend dependencies
- **Severity:** P2
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** All packages match Expo SDK 54 expected versions
- **Validation:** `npx expo start` shows no version warnings
- **Status:** NOT STARTED

---

## P3 — MINOR (Polish, papercuts, inconsistencies)

### P3-1: Deprecated shadow* Style Props
- **Problem:** Console warnings: `"shadow*" style props are deprecated. Use "boxShadow".` and `"textShadow*" style props are deprecated.`
- **Scope:** Frontend components
- **Severity:** P3
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** No shadow deprecation warnings in console
- **Validation:** Console check on startup
- **Status:** NOT STARTED

### P3-2: expo-av Deprecation Warning
- **Problem:** `[expo-av]: Expo AV has been deprecated and will be removed in SDK 54. Use expo-audio and expo-video.`
- **Scope:** Frontend audio player (Recap)
- **Severity:** P3
- **Owner:** Developer
- **Dependencies:** P1-5 (audio implementation)
- **Acceptance Criteria:** Migrate from expo-av to expo-audio
- **Validation:** No deprecation warning
- **Status:** NOT STARTED

### P3-3: "Logout" Button Styling / Placement
- **Problem:** Red "Logout" button in top-right of Home screen is visually prominent and misplaced. Should be in Settings or a menu, not on the primary dashboard.
- **Scope:** Frontend Home
- **Severity:** P3
- **Owner:** UX
- **Dependencies:** Settings screen
- **Acceptance Criteria:** Logout moved to settings/profile menu
- **Validation:** Not visible on home screen
- **Status:** NOT STARTED

### P3-4: "Last updated" Timestamp Format
- **Problem:** Home screen shows "Last updated: 9:32:33 PM" — includes seconds, which is unnecessary precision for users.
- **Scope:** Frontend Home
- **Severity:** P3
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** Show "Last updated: 9:32 PM" (no seconds)
- **Validation:** Visual check
- **Status:** NOT STARTED

### P3-5: Missing Favicon / App Icon
- **Problem:** Production app uses default favicon. No branded app icon.
- **Scope:** Frontend assets
- **Severity:** P3
- **Owner:** UX
- **Dependencies:** None
- **Acceptance Criteria:** Guru branded favicon and app icon
- **Validation:** Browser tab shows Guru icon
- **Status:** NOT STARTED

### P3-6: Visual Config Endpoint (503 in Production)
- **Problem:** Frontend calls `/config/visual-config` on page load. This endpoint returns 503 when backend is down, but even when up, purpose is unclear.
- **Scope:** Backend + Frontend
- **Severity:** P3
- **Owner:** Developer
- **Dependencies:** P0-1
- **Acceptance Criteria:** Endpoint either returns useful config or is removed; failure doesn't break page
- **Validation:** No 503 errors on page load
- **Status:** NOT STARTED

### P3-7: Onboarding Goals Screen — Partial Content Below Fold
- **Problem:** A star icon and some content appear cut off below the "Get Started" button on the goals screen.
- **Scope:** Frontend layout
- **Severity:** P3
- **Owner:** Developer
- **Dependencies:** None
- **Acceptance Criteria:** All content on goals screen visible or properly hidden
- **Validation:** Visual check
- **Status:** NOT STARTED

---

## Summary Table

| ID | Title | Severity | Owner | Status |
|----|-------|----------|-------|--------|
| P0-1 | Production Backend Down | P0 | Architect | NOT STARTED |
| P0-2 | Article Tagging Broken | P0 | Developer | NOT STARTED |
| P0-3 | Ingestion Never Run | P0 | Architect | NOT STARTED |
| P0-4 | Dev Tools in Production | P0 | Developer | NOT STARTED |
| P0-5 | Extension Not Functional | P0 | Dev + DevOps | NOT STARTED |
| P1-1 | Only 3/10 Industries | P1 | Developer | NOT STARTED |
| P1-2 | React Hydration Error | P1 | Developer | NOT STARTED |
| P1-3 | Rings Don't Match BRD | P1 | UX + Dev | NOT STARTED |
| P1-4 | Missing Home Stats | P1 | Developer | NOT STARTED |
| P1-5 | Audio Recap Not Built | P1 | Developer | NOT STARTED |
| P1-6 | Stale Form Data | P1 | Developer | NOT STARTED |
| P1-7 | Step 1 Missing Progress | P1 | Developer | NOT STARTED |
| P1-8 | Daily/Weekly Confusion | P1 | PM + Dev | NOT STARTED |
| P2-1 | Industry Cards Too Large | P2 | UX | NOT STARTED |
| P2-2 | Button Overlap on Cards | P2 | Developer | NOT STARTED |
| P2-3 | Spec Count Mismatch | P2 | PM + Dev | NOT STARTED |
| P2-4 | No Unified EDL | P2 | UX Lead | NOT STARTED |
| P2-5 | Bland Empty States | P2 | UX + Dev | NOT STARTED |
| P2-6 | Inconsistent Empty States | P2 | Developer | NOT STARTED |
| P2-7 | Tab Ring Icons Small | P2 | UX | NOT STARTED |
| P2-8 | No Error Recovery UI | P2 | Developer | NOT STARTED |
| P2-9 | Test User Pollution | P2 | Developer | NOT STARTED |
| P2-10 | Package Version Mismatch | P2 | Developer | NOT STARTED |
| P3-1 | shadow* Deprecation | P3 | Developer | NOT STARTED |
| P3-2 | expo-av Deprecation | P3 | Developer | NOT STARTED |
| P3-3 | Logout Button Placement | P3 | UX | NOT STARTED |
| P3-4 | Timestamp Seconds | P3 | Developer | NOT STARTED |
| P3-5 | Missing Favicon | P3 | UX | NOT STARTED |
| P3-6 | Visual Config 503 | P3 | Developer | NOT STARTED |
| P3-7 | Goals Screen Cutoff | P3 | Developer | NOT STARTED |
