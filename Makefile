# Guru - developer shortcuts. Run from the repo root.
# Uses backend/venv when it exists, otherwise python3 on PATH.
PY := $(shell [ -x backend/venv/bin/python ] && echo venv/bin/python || echo python3)

.PHONY: test-agent test trace-report

test-agent: ## Agent loop contract tests: scripted model, no network, no database
	cd backend && $(PY) -m pytest -q --disable-warnings tests/test_agent_loop.py

test: ## Full backend test suite (some tests use the configured database)
	cd backend && $(PY) -m pytest -q tests

trace-report: ## Latency, cost, tool and block readout from agent turn traces (last 7 days)
	cd backend && $(PY) scripts/trace_report.py --days 7
