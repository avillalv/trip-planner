"""Test fixtures.

Tests run against TEST_DATABASE_URL (created by `npm run setup`). The schema is rebuilt
from migrations once per session; each test runs inside a transaction that is rolled back.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from tripplanner.config import get_settings
from tripplanner.db import get_db
from tripplanner.main import create_app
from tripplanner.migrate import upgrade


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Engine]:
    url = get_settings().test_database_url
    if not url:
        pytest.fail("TEST_DATABASE_URL is not set. Run `npm run setup` first.", pytrace=False)
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


@pytest.fixture
def client(db_session: Session, frontend_dist: Path) -> Iterator[TestClient]:
    app = create_app(frontend_dist=frontend_dist)
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
