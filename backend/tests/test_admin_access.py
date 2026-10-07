"""
Admin and access checks (backend/app/services/access.py).

Hiding a screen is never the security. These tests call the real FastAPI app and
prove that admin data and paid triggers are refused unless the caller is a
signed-in admin holding an ACCESS token, or (for read-only endpoints) holds
ADMIN_API_KEY. No network and no real database: an in-memory SQLite stands in,
and no startup events run, so nothing is ingested.
"""
import os
import uuid
from types import SimpleNamespace

import pytest

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import httpx  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.database import get_db  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import access  # noqa: E402
from app.services.auth_service import generate_jwt  # noqa: E402

pytestmark = pytest.mark.anyio

ADMIN_EMAIL = "admin@guru.app"
READER_EMAIL = "reader@guru.app"
KEY = "k" * 40


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def api(monkeypatch):
    from app.main import app
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    admin = User(id=uuid.uuid4(), email=ADMIN_EMAIL, password_hash="x", is_active=True)
    reader = User(id=uuid.uuid4(), email=READER_EMAIL, password_hash="x", is_active=True)
    db.add_all([admin, reader])
    db.commit()
    # Case and stray spaces in the Railway variable are tolerated.
    monkeypatch.setenv("ADMIN_EMAILS", f" {ADMIN_EMAIL.upper()} , someone@else.com")
    monkeypatch.setenv("ADMIN_API_KEY", KEY)

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db

    async def call(method, path, token=None, key=None):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if key is not None:
            headers["X-Admin-Key"] = key
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, path, headers=headers)

    yield SimpleNamespace(call=call, db=db, admin=admin, reader=reader,
                          admin_token=generate_jwt(admin.id, "access"),
                          admin_refresh=generate_jwt(admin.id, "refresh"),
                          reader_token=generate_jwt(reader.id, "access"))
    app.dependency_overrides.pop(get_db, None)
    db.close()


def test_allowlist_rules(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "Boss@Guru.app")
    monkeypatch.setenv("BETA_EMAILS", "tester@guru.app")
    monkeypatch.delenv("SYNTHETIC_EMAIL_DOMAINS", raising=False)
    u = lambda e: SimpleNamespace(email=e)  # noqa: E731
    assert access.is_admin(u("boss@guru.app")) and not access.is_admin(u("tester@guru.app"))
    assert access.is_beta(u("tester@guru.app")) and access.is_beta(u("boss@guru.app")), "admins are beta too"
    assert not access.is_beta(u("anyone@guru.app"))
    assert not access.is_admin(u(None)) and not access.is_admin(u(""))
    # Persona and test accounts are synthetic by email domain (example.com unless configured).
    assert access.is_synthetic(u("maya@example.com")) and not access.is_synthetic(u("maya@gmail.com"))
    monkeypatch.setenv("SYNTHETIC_EMAIL_DOMAINS", "personas.test")
    assert access.is_synthetic(u("lena@personas.test")) and not access.is_synthetic(u("maya@example.com"))


@pytest.mark.parametrize("path", ["/api/v1/admin/expiration-settings", "/api/v1/admin/perf-metrics",
                                  "/api/v1/admin/ingestion-stats"])
async def test_admin_endpoints_refuse_anonymous_and_non_admin_callers(api, path):
    assert (await api.call("GET", path)).status_code == 401
    assert (await api.call("GET", path, token=api.reader_token)).status_code == 403


async def test_an_admin_gets_in_with_an_access_token_but_never_with_a_refresh_token(api):
    ok = await api.call("GET", "/api/v1/admin/expiration-settings", token=api.admin_token)
    assert ok.status_code == 200, ok.text
    refused = await api.call("GET", "/api/v1/admin/expiration-settings", token=api.admin_refresh)
    assert refused.status_code == 401


async def test_an_inactive_admin_is_refused(api):
    api.admin.is_active = False
    api.db.commit()
    assert (await api.call("GET", "/api/v1/admin/expiration-settings", token=api.admin_token)).status_code == 401


async def test_paid_ingestion_trigger_is_admin_only(api):
    # Never called as admin here: that would start a real ingestion run.
    assert (await api.call("POST", "/api/v1/ingestion/trigger/tier1_expert")).status_code == 401
    assert (await api.call("POST", "/api/v1/ingestion/trigger/tier1_expert", token=api.reader_token)).status_code == 403


async def test_ingestion_history_is_no_longer_public(api):
    assert (await api.call("GET", "/api/v1/ingestion/runs")).status_code == 401
    assert (await api.call("GET", "/api/v1/ingestion/runs", token=api.reader_token)).status_code == 403
    assert (await api.call("GET", "/api/v1/ingestion/runs", key=KEY)).status_code == 200
    assert (await api.call("GET", "/api/v1/ingestion/runs", token=api.admin_token)).status_code == 200


async def test_the_admin_key_must_match_and_be_long_enough(api, monkeypatch):
    assert (await api.call("GET", "/api/v1/ingestion/runs", key="wrong" * 10)).status_code == 403
    monkeypatch.setenv("ADMIN_API_KEY", "short")
    assert (await api.call("GET", "/api/v1/ingestion/runs", key="short")).status_code == 403, \
        "a weak key must never be accepted, even when it matches"
    monkeypatch.delenv("ADMIN_API_KEY")
    assert (await api.call("GET", "/api/v1/ingestion/runs", key="")).status_code == 403


async def test_me_access_tells_the_app_what_to_show(api):
    r = await api.call("GET", "/api/v1/me/access", token=api.reader_token)
    assert r.status_code == 200 and r.json() == {"is_admin": False, "is_beta": False}
    r = await api.call("GET", "/api/v1/me/access", token=api.admin_token)
    assert r.json() == {"is_admin": True, "is_beta": True}
    assert (await api.call("GET", "/api/v1/me/access")).status_code == 401
