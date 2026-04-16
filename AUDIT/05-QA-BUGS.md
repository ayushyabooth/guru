# Stage Spec: QA & Bugs

## Bugs Found During Audit

### Critical Bugs
1. **Production backend 503** — All API calls fail (P0-1)
2. **All articles untagged** — 125 articles with NULL industries/specializations (P0-2)
3. **React error #418** — Hydration mismatch on every page load in production (P1-2)

### Functional Bugs
4. **Stale form data** — Login/signup forms pre-filled with previous session data (P1-6)
5. **Onboarding Step 1 no progress** — Missing progress bar and step counter (P1-7)
6. **Button overlap** — Back/Continue buttons cover last card on specializations and capacity screens (P2-2)
7. **Goals screen cutoff** — Star icon and content partially visible below Get Started button (P3-7)

### Console Errors/Warnings
8. **React error #418** — SSR/CSR hydration mismatch
9. **shadow* deprecation** — Multiple warnings about deprecated shadow style props
10. **textShadow* deprecation** — Same for text shadow
11. **expo-av deprecation** — Will be removed in SDK 54
12. **6 package version mismatches** — expo, expo-constants, expo-router, react-native-svg, react-native-webview, jest

### Edge Cases Not Tested (Cannot test due to empty feeds)
- What happens when storyboard has only 1 article (no carousel)
- What happens when article has no hero image (gradient fallback)
- What happens when article is paywalled (expert notes fallback)
- What happens when Claude API is rate-limited during rich content generation
- What happens when user taps "Not Relevant" on all storyboards
- What happens when daily max is reached during catch-up
- What happens when recap is started but not completed

### Test Coverage Status
- **Backend unit tests:** <20% coverage
- **Frontend tests:** 0% coverage
- **E2E tests:** 0% coverage
- **Integration tests:** 0% coverage
- **Manual test plan:** None documented

## Recommended QA Process
1. Create manual test checklist for each user flow
2. Add jest tests for critical frontend components (auth, feed, reader)
3. Add pytest tests for backend services (ingestion, clustering, Q&A)
4. Set up Playwright or Detox for E2E smoke tests
5. Add console error monitoring (Sentry)
