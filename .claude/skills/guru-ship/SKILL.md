---
name: guru-ship
description: Use whenever Guru goes to production - any git push to main, a Railway redeploy or variable change, a rollback, or a Vercel deploy of the web app. Runs the pre-push checklist, the push on the owner's go, the deploy watch, the backend checks, the web preview and promote, and the close-out.
---

# Shipping Guru

Every push to `main` redeploys the backend on Railway, and every deploy is a restart with side effects. The web app deploys separately, from the CLI. Nothing here runs without the owner's go, and the settings file asks before `git push`, `vercel` and `railway`.

## 1. Before the push: the checklist, out loud
- `make test-agent` is green, and `make evals` exits 0 (every red as labeled).
- `git fetch`, confirm the push is a fast-forward of `origin/main`, and list what ships: `git log --oneline origin/main..HEAD`.
- What the restart will do, and how big. Read the last ingestion runs with the admin key (`GET /api/v1/ingestion/runs`):
  - The cleanup deletes articles older than 30 days, except any a user saved, highlighted, noted or asked about. Name the batch that sits on the 30-day line.
  - The ingestion boot guard runs a tier whose last completed run is outside its window (72 hours for expert RSS, 168 for discovery). Name the next time a restart would start a paid run.
  - Missing columns are added and new tables created. A schema change boots on a scratch Postgres 16 first.
- Variables staged with `--skip-deploys` go live with this deploy.
- The rollback: Railway, Deployments, the previous deployment, Redeploy (also a restart), or `git revert` and push.
- Ask the owner. Push only on a clear go.

## 2. Push, then watch
- `git push origin <branch>:main`
- `make watch-deploy`: polls `/health` every 10 seconds and prints each check. It finishes when `/health` names the pushed commit, and lists any check that wasn't 200 as downtime. For a build from before `/health` named its commit, watch a route only the new build has: `make watch-deploy PROBE=/api/v1/admin/reports EXPECT=401`.

## 3. Check the backend
- The startup lines, from `backend/`: `railway logs`. Look for `Stale content cleanup ... kept N`, `skipping initial run` for each tier, `Application startup complete`, and no errors.
- Any new route: anonymous gets 401, a wrong key 403.
- One real agent turn carries the new build: `make traces DAYS=1` (the builds list) or `make trace ID=<id>`.

## 4. The web
- A preview, from `mobile/`:
  `npx --yes vercel@latest deploy --yes --build-env EXPO_PUBLIC_API_URL=https://guru-production-1b4f.up.railway.app/api/v1`
  Use `vercel@latest`: a plain `npx vercel` can pick up a CLI that isn't signed in. `--build-env` pins the production API, so the build can't pick up a local address.
- Check the preview before promoting: its entry bundle calls the production API, never localhost, and carries the change (grep a string unique to it).
- Promote: `npx --yes vercel@latest promote <preview url> --yes`. Then poll `mobile-guru8.vercel.app` until its entry bundle carries the change.

## 5. Close out
- The owner checks the change on their own account: the smoke test.
- A shipped feature: `python3 .claude/hooks/feature_state.py done`, so the stage gate asks again for the next one.
- Linear: the issues to Done, with the build SHA and what was verified.

## Testing a web build locally, before a deploy
A local `expo export` inlines `EXPO_PUBLIC_` variables at build time, and Metro's shared cache can reuse an old value even with `--clear`. For a build pointed at a local backend:
`EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=http://localhost:8000/api/v1 TMPDIR=<a fresh folder>/ npx expo export --platform web --output-dir <dir>`
Then grep the bundle for the API host before using it.
