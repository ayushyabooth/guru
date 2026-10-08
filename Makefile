# Guru - developer shortcuts. Run from the repo root.
# Uses backend/venv when it exists, otherwise python3 on PATH.
PY := $(shell [ -x backend/venv/bin/python ] && echo venv/bin/python || echo python3)
DAYS ?= 7
TRAFFIC ?= real

.PHONY: test-agent test evals traces traces-local trace

test-agent: ## Agent contract, admin access, reports and boot-cleanup tests: scripted model, no network, no real database
	cd backend && $(PY) -m pytest -q --disable-warnings tests/test_agent_loop.py tests/test_admin_access.py tests/test_trace_insights.py tests/test_evals_judge.py tests/test_bug_reports.py tests/test_cleanup.py

test: ## Full backend test suite (some tests use the configured database)
	cd backend && $(PY) -m pytest -q tests

evals: ## Agent evals: T1 scripted (offline, free). LIVE=1 adds T2 on the live model, graded by the LLM judge too. CASE=ID,ID  RUNS=n  BASELINE=1  JUDGE=0
	cd backend && $(PY) -m evals.run $(if $(filter 1 true yes,$(LIVE)),--live) $(if $(CASE),--case $(CASE)) $(if $(RUNS),--runs $(RUNS)) $(if $(filter 1 true yes,$(BASELINE)),--save-baseline) $(if $(filter 0 false no,$(JUDGE)),--no-judge)

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
