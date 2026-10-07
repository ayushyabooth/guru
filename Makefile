# Guru - developer shortcuts. Run from the repo root.
# Uses backend/venv when it exists, otherwise python3 on PATH.
PY := $(shell [ -x backend/venv/bin/python ] && echo venv/bin/python || echo python3)
DAYS ?= 7
TRAFFIC ?= real

.PHONY: test-agent test traces traces-local trace

test-agent: ## Agent contract + admin access tests: scripted model, no network, no real database
	cd backend && $(PY) -m pytest -q --disable-warnings tests/test_agent_loop.py tests/test_admin_access.py tests/test_trace_insights.py

test: ## Full backend test suite (some tests use the configured database)
	cd backend && $(PY) -m pytest -q tests

traces: ## Production agent turns: takeaways, tiles, flagged turns (needs ADMIN_API_KEY in the shell)
	cd backend && $(PY) scripts/traces.py summary --prod --days $(DAYS) --traffic $(TRAFFIC)

traces-local: ## The same readout from the local database
	cd backend && $(PY) scripts/traces.py summary --days $(DAYS) --traffic $(TRAFFIC)

trace: ## One production turn in depth: make trace ID=<trace id>
	cd backend && $(PY) scripts/traces.py show $(ID) --prod
