"""Behavioral evals for the Guru agent. Run with `make evals` (see README.md)."""
import os

# T1 needs no secrets. Without backend/.env (CI, a fresh clone), use the same
# hermetic defaults as tests/test_agent_loop.py so app.config can load.
if not os.path.exists(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
