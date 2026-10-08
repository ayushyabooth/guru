"""Shared setup for every test in backend/tests.

1. Stand-in secrets and tables. With no backend/.env (CI, a fresh clone), JWT_SECRET_KEY and
   ANTHROPIC_API_KEY get the dummy values the gate files use, so app.config loads. The make
   targets point DATABASE_URL at a fresh SQLite file; while it is empty, the tables are
   created in it once, so a legacy file that writes through SessionLocal runs on its own too.
   A database that already has tables, or isn't SQLite, is never touched here.
2. The quarantine marker. A test that can't pass today carries
   @pytest.mark.quarantine(reason="..."). make test skips it, make test-quarantine runs
   only those, and tests/QUARANTINE.md lists each one with its root cause and its fix.
3. No network. A connection to anything but this machine, or a host name lookup, raises
   ConnectionRefusedError (a DNS error for lookups), so no test reaches the internet, in CI
   or locally. Each blocked attempt is listed at the end of the run with the test that was
   running (a background thread's attempt can land on a later test). This covers everything
   that goes through Python's socket module (requests, httpx, urllib, the Anthropic SDK);
   a C extension that opens its own sockets isn't covered.
4. No embedding model. The real one (all-MiniLM-L6-v2) is a ~90 MB download, so clustering
   gets a stand-in that refuses to embed and finds nothing to cluster, unless a test patches
   get_embedding_model with its own fake.
"""
import os
import socket

import pytest

_ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
if not os.path.exists(_ENV):
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")


# ── No network ───────────────────────────────────────────────────────────────
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "", None}
_blocked = []  # (test node id, what was blocked)


def _is_local(host):
    if isinstance(host, (bytes, bytearray)):
        host = host.decode(errors="replace")
    return host in _LOCAL_HOSTS or (isinstance(host, str) and (host.startswith("127.") or host.endswith(".localhost")))


def _block(what):
    _blocked.append((os.environ.get("PYTEST_CURRENT_TEST", "(collection)").rsplit(" ", 1)[0], what))


_connect, _connect_ex = socket.socket.connect, socket.socket.connect_ex
_getaddrinfo, _gethostbyname, _gethostbyname_ex = socket.getaddrinfo, socket.gethostbyname, socket.gethostbyname_ex


def _guard_connect(sock, address):
    if sock.family in (socket.AF_INET, socket.AF_INET6) and isinstance(address, tuple) and not _is_local(address[0]):
        _block(f"connect to {address[0]}:{address[1]}")
        raise ConnectionRefusedError(f"tests never use the network: blocked a connection to {address[0]}:{address[1]}")


def _guard_lookup(host):
    if not _is_local(host):
        _block(f"lookup of {host}")
        raise socket.gaierror(socket.EAI_NONAME, f"tests never use the network: blocked a lookup of {host}")


def _no_net_connect(self, address):
    _guard_connect(self, address)
    return _connect(self, address)


def _no_net_connect_ex(self, address):
    _guard_connect(self, address)
    return _connect_ex(self, address)


def _no_net_getaddrinfo(host, *args, **kwargs):
    _guard_lookup(host)
    return _getaddrinfo(host, *args, **kwargs)


def _no_net_gethostbyname(host):
    _guard_lookup(host)
    return _gethostbyname(host)


def _no_net_gethostbyname_ex(host):
    _guard_lookup(host)
    return _gethostbyname_ex(host)


socket.socket.connect = _no_net_connect
socket.socket.connect_ex = _no_net_connect_ex
socket.getaddrinfo = _no_net_getaddrinfo
socket.gethostbyname = _no_net_gethostbyname
socket.gethostbyname_ex = _no_net_gethostbyname_ex


# ── Tables ───────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True, scope="session")
def _tables_in_the_test_database():
    from sqlalchemy import inspect
    from app.config import settings
    from app.db.database import create_tables, engine
    if settings.DATABASE_URL.startswith("sqlite") and not inspect(engine).get_table_names():
        create_tables()
    yield


# ── No embedding model ───────────────────────────────────────────────────────
class _NoEmbeddingModel:
    def embed(self, texts):
        raise RuntimeError("no embedding model in tests: patch get_embedding_model with a fake")

    encode = embed


@pytest.fixture(autouse=True, scope="session")
def _no_embedding_model():
    # Session-wide: the catch-up feed also builds storyboards in background threads that can outlive a test.
    from app.services import clustering_service
    clustering_service._embedding_model = _NoEmbeddingModel()
    yield
    clustering_service._embedding_model = None


# ── Quarantine ───────────────────────────────────────────────────────────────
def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "quarantine(reason): a test that can't pass today. make test skips it, make test-quarantine runs it. "
        "Listed in tests/QUARANTINE.md",
    )


def pytest_collection_modifyitems(config, items):
    for item in items:
        for mark in item.iter_markers("quarantine"):
            if not mark.kwargs.get("reason"):
                raise pytest.UsageError(f"{item.nodeid}: a quarantine marker needs reason=\"...\" (see tests/QUARANTINE.md)")


def pytest_terminal_summary(terminalreporter):
    if not _blocked:
        return
    terminalreporter.section("network blocked")
    seen = {}
    for test, what in _blocked:
        seen[(test, what)] = seen.get((test, what), 0) + 1
    for (test, what), n in seen.items():
        terminalreporter.write_line(f"{test}: {what}" + (f" (x{n})" if n > 1 else ""))
