# Guru - developer shortcuts. Run from the repo root.
# Uses backend/venv when it exists, otherwise python3 on PATH.
PY := $(shell [ -x backend/venv/bin/python ] && echo venv/bin/python || echo python3)
DAYS ?= 7
TRAFFIC ?= real
# The admin key, for the commands that read production and for the eval upload: the shell's own if it has
# one, otherwise the Mac login Keychain's (item guru-admin-api-key), read as the command runs and never
# printed. So they work from any terminal and from a Claude Code session, whose shell skips ~/.zshrc.
# Without either, each command says the key is missing.
ADMIN_KEY_TARGETS = evals evals-upload traces trace reports report issues eval-runs ingestion-health
ifeq ($(origin ADMIN_API_KEY),undefined)
$(ADMIN_KEY_TARGETS): export ADMIN_API_KEY = $(shell security find-generic-password -a "$$USER" -s guru-admin-api-key -w 2>/dev/null)
endif
# Backend tests never touch a real database or spend money: DATABASE_URL points at a fresh SQLite file, deleted
# afterwards (some legacy test files create tables on whatever it names), and the Anthropic key is a dummy, so a
# missed mock fails instead of calling the API. Use as: cd backend && $(TEST_DB) <pytest ...>$(TEST_DB_DONE)
TEST_DB = db=$$(mktemp -d) && env -u ADMIN_API_KEY DATABASE_URL=sqlite:///$$db/test.db ANTHROPIC_API_KEY=test-key
TEST_DB_DONE = ; s=$$?; rm -rf "$$db"; exit $$s
INGESTION_TESTS = tests/test_ingestion_orchestrator.py tests/test_deduplication.py tests/test_content_quality.py tests/test_tier1_luminaries.py tests/test_tier2_discovery.py tests/test_ingestion_health.py
# The gate (make test-agent). Every other file in backend/tests is the legacy suite (make test-legacy).
GATE_TESTS = tests/test_agent_loop.py tests/test_admin_access.py tests/test_trace_insights.py tests/test_evals_judge.py tests/test_evals_calibrate.py tests/test_evals_planted.py tests/test_evals_score.py tests/test_bug_reports.py tests/test_issues.py tests/test_cleanup.py tests/test_watch_deploy.py $(INGESTION_TESTS)

.PHONY: test-agent test-ingestion test evals traces traces-local trace

test-agent: ## The gating backend suite: run it after every backend change. Agent contract, admin access, reports, issues, boot cleanup and ingestion (make test-ingestion): scripted model, fake feeds, throwaway database, no network
	cd backend && $(TEST_DB) $(PY) -m pytest -q --disable-warnings $(GATE_TESTS)$(TEST_DB_DONE)

test-ingestion: ## Ingestion contracts on their own (also in make test-agent): run lifecycle, boot guard, run cap and age filter, enrichment, discovery, quality, dedup and the health check. Fake feeds, searches and model, throwaway database, no network
	cd backend && $(TEST_DB) $(PY) -m pytest -q --disable-warnings $(INGESTION_TESTS)$(TEST_DB_DONE)

test: ## The whole backend suite, the gate and the legacy files, on a throwaway database. Quarantined tests are skipped: backend/tests/QUARANTINE.md lists each with its root cause, and make test-quarantine runs them
	cd backend && $(TEST_DB) $(PY) -m pytest -q -m "not quarantine" tests$(TEST_DB_DONE)

.PHONY: test-legacy test-quarantine ci
test-legacy: ## The backend suite outside the gate, quarantine skipped. CI runs it after make test-agent, so no test runs twice
	cd backend && $(TEST_DB) $(PY) -m pytest -q -m "not quarantine" tests $(addprefix --ignore=,$(GATE_TESTS))$(TEST_DB_DONE)

test-quarantine: ## Only the quarantined tests (backend/tests/QUARANTINE.md). They fail until fixed; a fixed one loses its marker and its row in the same commit
	cd backend && $(TEST_DB) $(PY) -m pytest -q -m quarantine tests$(TEST_DB_DONE)

ci: ## What CI runs on every push and pull request, in the same order: the gate, the offline evals, the legacy suite, the app's tests, no new type errors. Stops at the first failure
	$(MAKE) test-agent
	$(MAKE) evals UPLOAD=0
	$(MAKE) test-legacy
	$(MAKE) test-app
	$(MAKE) typecheck-app

.PHONY: test-app typecheck-app
test-app: ## The app's tests: every jest suite in mobile/. fetch is mocked, so no network and no secrets
	cd mobile && npx jest --ci

typecheck-app: ## The app's type check, as a ratchet: fails when any file has more type errors than mobile/tsc-baseline.json, passes and prints the drop when they go down. The baseline only goes down: cd mobile && npm run typecheck:ratchet -- --update locks a drop in
	cd mobile && npm run --silent typecheck:ratchet

evals: ## Agent evals: T1 scripted (offline, free). LIVE=1 adds T2 on the live model, graded by the LLM judge too. Every run goes to the admin Issues tab's Eval runs (needs ADMIN_API_KEY), labeled live or offline, whole or partial (CASE=), and how it started; the ship gate reads only the newest whole live run. CASE=ID,ID  RUNS=n  JOBS=n (live default 4)  BASELINE=1  JUDGE=0  UPLOAD=0  TRIGGER=scheduled|manual|demo
	cd backend && $(PY) -m evals.run $(if $(filter 1 true yes,$(LIVE)),--live) $(if $(CASE),--case $(CASE)) $(if $(RUNS),--runs $(RUNS)) $(if $(filter 1 true yes,$(BASELINE)),--save-baseline) $(if $(filter 0 false no,$(JUDGE)),--no-judge) $(if $(filter 0 false no,$(UPLOAD)),--no-upload) $(if $(JOBS),--jobs $(JOBS)) $(if $(TRIGGER),--trigger $(TRIGGER))

.PHONY: evals-upload
evals-upload: ## Send the run saved in backend/evals/out/latest.json to the admin Issues tab again, running nothing (needs ADMIN_API_KEY): any run, labeled as it was saved
	cd backend && $(PY) -m evals.run --upload-latest

.PHONY: evals-calibrate evals-planted
evals-calibrate: ## Label judged live runs for the LLM judge: the overall verdict, then each dimension. DISAGREE=1 only the runs where the adopted second-model label and the judge disagree, mixed with an audit of runs where they agree (AUDIT=<n> audits in all, 5 by default). QUICK=1 five hard calls, one key each. FOLLOW=1 labels while a live run is going (QUIET=<seconds>). ONLY=<id prefixes> labels just those runs. REPORT=1 agreement, recall and the gate. REJUDGE=1 re-judges every labeled transcript with the current judge (live, cents a transcript)
	cd backend && $(PY) -m evals.calibrate $(if $(filter 1 true yes,$(REPORT)),--report,$(if $(filter 1 true yes,$(REJUDGE)),--rejudge,--label $(if $(filter 1 true yes,$(DISAGREE)),--disagreements $(if $(AUDIT),--audit $(AUDIT))) $(if $(filter 1 true yes,$(QUICK)),--quick) $(if $(filter 1 true yes,$(FOLLOW)),--follow) $(if $(ONLY),--only $(ONLY)) $(if $(QUIET),--quiet $(QUIET))))

evals-planted: ## Planted mistakes: one invented quote or wrong number in copies of passing judged transcripts, re-judged to see if the judge catches it (live, a few cents a transcript). N=<at most> DRY=1 shows the plants without calling the judge
	cd backend && $(PY) -m evals.planted $(if $(N),--limit $(N)) $(if $(filter 1 true yes,$(DRY)),--dry-run)

traces: ## Production agent turns: takeaways, tiles, flagged turns (needs ADMIN_API_KEY in the shell)
	cd backend && $(PY) scripts/traces.py summary --prod --days $(DAYS) --traffic $(TRAFFIC)

traces-local: ## The same readout from the local database
	cd backend && $(PY) scripts/traces.py summary --days $(DAYS) --traffic $(TRAFFIC)

trace: ## One production turn in depth: make trace ID=<trace id>
	cd backend && $(PY) scripts/traces.py show $(ID) --prod

.PHONY: reports reports-local report
reports: ## Beta bug reports in production, newest first, each with its turn and Claude's hypothesis (needs ADMIN_API_KEY in the shell)
	cd backend && $(PY) scripts/reports.py list --prod --days $(DAYS) --traffic $(TRAFFIC)

reports-local: ## The same list from the local database
	cd backend && $(PY) scripts/reports.py list --days $(DAYS) --traffic $(TRAFFIC)

report: ## One production report in full: make report ID=<report id>
	cd backend && $(PY) scripts/reports.py show $(ID) --prod

.PHONY: issues issues-local
issues: ## The Issues tab in production: the ship gate, then every open issue, newest first (needs ADMIN_API_KEY in the shell). SOURCE=eval|report|production
	cd backend && $(PY) scripts/issues.py list --prod --days $(DAYS) $(if $(SOURCE),--source $(SOURCE))

issues-local: ## The same list from the local database
	cd backend && $(PY) scripts/issues.py list --days $(DAYS) $(if $(SOURCE),--source $(SOURCE))

.PHONY: eval-runs eval-runs-local
eval-runs: ## Every eval run in production, newest first: live or offline, whole or partial, how it started, the score against the previous comparable run, the gate for a whole live run, the judge per dimension, then the next scheduled run (needs ADMIN_API_KEY in the shell). LIMIT=n  ID=<run id> for one run in full
	cd backend && $(PY) scripts/eval_runs.py $(if $(ID),show $(ID),list $(if $(LIMIT),--limit $(LIMIT))) --prod

eval-runs-local: ## The same from the local database
	cd backend && $(PY) scripts/eval_runs.py $(if $(ID),show $(ID),list $(if $(LIMIT),--limit $(LIMIT)))

.PHONY: watch-deploy
watch-deploy: ## After a push: poll /health every 10s until the pushed commit serves; lists any downtime. SHA=<commit>, or PROBE=<route> EXPECT=<status> for an older build
	cd backend && $(PY) scripts/watch_deploy.py $(if $(SHA),--sha $(SHA)) $(if $(PROBE),--probe $(PROBE) --expect $(EXPECT))

.PHONY: ingestion-health ingestion-health-local
ingestion-health: ## Is ingestion keeping the feed alive in production: the verdict (healthy, stale or failing) and its reasons, each tier's last run against its window, what a restart would run, TIER2_RUN_AT, content freshness. Exits 1 on failing (needs ADMIN_API_KEY in the shell)
	cd backend && $(PY) scripts/ingestion_health.py --prod

ingestion-health-local: ## The same from the local database
	cd backend && $(PY) scripts/ingestion_health.py

.PHONY: seed-local-stories
seed-local-stories: ## Demo AI stories in a LOCAL database, so Catch-up and Dive-in have a feed for persona QA and screenshots: 12 articles from the last 3 days with their rich content, the storyboards and base caches that serve them, and two saves for qa-beta@example.com. No network, no model. DB=<postgres URL on localhost or 127.0.0.1> is required (.env is never read). Idempotent: re-run to refresh the dates and the 48h cache. REMOVE=1 deletes every seeded row
	@test -n "$(DB)" || { echo "DB is required: make seed-local-stories DB=postgresql://guru@localhost:54329/guru_ui [REMOVE=1]"; exit 2; }
	cd backend && $(PY) scripts/seed_local_stories.py --db '$(DB)' $(if $(filter 1 true yes,$(REMOVE)),--remove)
