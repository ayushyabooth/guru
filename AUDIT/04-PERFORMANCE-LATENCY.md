# Stage Spec: Performance & Latency

## Production Performance
- **Frontend load:** 0.53s (Vercel static, good)
- **Backend:** DOWN — cannot measure production API latency
- **JS bundle:** Single entry bundle (entry-cf40b28632e46dac54226034cf2e58ca.js) — no code splitting
- **Fonts:** 2 font files loaded (Orbitron 400 + 700) — 200 OK from Vercel

## Local API Response Times
- Health: <10ms
- Catchup feed (empty): 22ms
- Divein feed (empty): 22ms
- These are SQLite local — Neon PostgreSQL will add 50-200ms network latency in production

## Known Performance Issues
1. **React hydration error #418** — causes visual flicker on every page load
2. **No code splitting** — entire app loaded as single JS bundle
3. **Cold start** — cache warming takes 30-60s on startup (all users x all filters)
4. **Embedding computation** — CPU-bound, 5-15s for first cluster request
5. **No CDN for article images** — images served directly from source URLs
6. **Expo web build** — single bundle, no tree-shaking optimization evident
7. **Metro bundler** — 8.5s for initial web bundle (dev mode)

## Loading States Audit
- **Catch-up feed:** Jumps directly to empty state — no skeleton/shimmer
- **Dive-in feed:** Same — no loading indicator
- **Home screen:** Rings render immediately (good)
- **Onboarding:** Instant transitions between steps (good)
- **Auth:** Shows "Network error" after timeout (no spinner during attempt)

## Recommendations
1. Add skeleton loading states for catch-up and dive-in feeds
2. Implement code splitting for routes (Expo Router supports lazy)
3. Add loading spinner to auth forms during API call
4. Consider edge caching for storyboard API responses
5. Pre-compute embeddings during ingestion (not on first request)
