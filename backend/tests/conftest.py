"""Test fixtures.

Tests use explicit settings (never the API keys in .env) and run against TEST_DATABASE_URL,
which `npm run setup` creates. The schema is rebuilt from migrations once per session; each
test runs inside a transaction that is rolled back. Real network calls are blocked.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from tripplanner.config import Settings, _load_settings, override_settings
from tripplanner.db import get_db
from tripplanner.main import create_app
from tripplanner.migrate import upgrade
from tripplanner.security import login_limiter

TEST_PASSCODE = "letmein"
APP_HEADERS = {"X-Trip-Planner": "1"}


def make_settings(**overrides: object) -> Settings:
    test_url = _load_settings().test_database_url
    if not test_url:
        pytest.fail("TEST_DATABASE_URL is not set. Run `npm run setup` first.", pytrace=False)
    values: dict[str, object] = {
        "database_url": test_url,
        "test_database_url": test_url,
        "host": "127.0.0.1",
        "session_secret": "test-session-secret",
        "app_passcode": TEST_PASSCODE,
        "agent_ingest_api_key": "test-agent-key",
        "home_currency": "USD",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture(scope="session", autouse=True)
def test_settings() -> Iterator[Settings]:
    settings = make_settings()
    override_settings(settings)
    yield settings
    override_settings(None)


@pytest.fixture
def use_settings() -> Iterator[object]:
    """Temporarily replace settings for one test: `use_settings(app_passcode=None)`."""

    def apply(**overrides: object) -> Settings:
        settings = make_settings(**overrides)
        override_settings(settings)
        return settings

    yield apply
    override_settings(make_settings())


@pytest.fixture(autouse=True)
def no_real_network() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture(autouse=True)
def reset_login_limiter() -> None:
    login_limiter._failures.clear()


@pytest.fixture(scope="session")
def db_engine(test_settings: Settings) -> Iterator[Engine]:
    url = test_settings.database_url
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    except OperationalError as exc:
        pytest.fail(f"Can't reach the test database ({exc.orig}). Run `npm run setup` first.", pytrace=False)
    upgrade(url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine: Engine) -> Iterator[Session]:
    with db_engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()


@pytest.fixture
def frontend_dist(tmp_path: Path) -> Path:
    return tmp_path / "dist"


def _client(db_session: Session, frontend_dist: Path, ip: str) -> TestClient:
    def request_session() -> Iterator[Session]:
        # Production uses a fresh session per request; expiring the shared one mimics that.
        db_session.expire_all()
        yield db_session

    app = create_app(frontend_dist=frontend_dist)
    app.dependency_overrides[get_db] = request_session
    return TestClient(app, base_url="http://localhost", client=(ip, 50000), headers=APP_HEADERS)


@pytest.fixture
def client(db_session: Session, frontend_dist: Path) -> Iterator[TestClient]:
    """A browser on this PC (trusted without a passcode)."""
    with _client(db_session, frontend_dist, "127.0.0.1") as test_client:
        yield test_client


@pytest.fixture
def remote_client(db_session: Session, frontend_dist: Path) -> Iterator[TestClient]:
    """A phone or laptop elsewhere on the home network."""
    with _client(db_session, frontend_dist, "192.168.1.50") as test_client:
        yield test_client
