# Guru - developer shortcuts. Run from the repo root.
# Uses backend/venv when it exists, otherwise python3 on PATH.
PY := $(shell [ -x backend/venv/bin/python ] && echo venv/bin/python || echo python3)
DAYS ?= 7
TRAFFIC ?= real

.PHONY: test-agent test evals traces traces-local trace

test-agent: ## Agent contract, admin access, reports, issues and boot-cleanup tests: scripted model, no network, no real database
	cd backend && $(PY) -m pytest -q --disable-warnings tests/test_agent_loop.py tests/test_admin_access.py tests/test_trace_insights.py tests/test_evals_judge.py tests/test_bug_reports.py tests/test_issues.py tests/test_cleanup.py tests/test_watch_deploy.py

test: ## Full backend test suite (some tests use the configured database)
	cd backend && $(PY) -m pytest -q tests

evals: ## Agent evals: T1 scripted (offline, free). LIVE=1 adds T2 on the live model, graded by the LLM judge too, and sends the whole run to the admin Issues tab (needs ADMIN_API_KEY). CASE=ID,ID  RUNS=n  BASELINE=1  JUDGE=0  UPLOAD=0
	cd backend && $(PY) -m evals.run $(if $(filter 1 true yes,$(LIVE)),--live) $(if $(CASE),--case $(CASE)) $(if $(RUNS),--runs $(RUNS)) $(if $(filter 1 true yes,$(BASELINE)),--save-baseline) $(if $(filter 0 false no,$(JUDGE)),--no-judge) $(if $(filter 0 false no,$(UPLOAD)),--no-upload)

.PHONY: evals-calibrate
evals-calibrate: ## Label the judged live runs for the LLM judge: p, f or s. REPORT=1 shows agreement and the gate
	cd backend && $(PY) -m evals.calibrate $(if $(filter 1 true yes,$(REPORT)),--report,--label)

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

.PHONY: watch-deploy
watch-deploy: ## After a push: poll /health every 10s until the pushed commit serves; lists any downtime. SHA=<commit>, or PROBE=<route> EXPECT=<status> for an older build
	cd backend && $(PY) scripts/watch_deploy.py $(if $(SHA),--sha $(SHA)) $(if $(PROBE),--probe $(PROBE) --expect $(EXPECT))
