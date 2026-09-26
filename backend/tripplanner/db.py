"""Database engine and session management.

The engine is created lazily so importing modules (e.g. to dump the OpenAPI schema)
never needs a reachable database.
"""

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from tripplanner.config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    return _engine


def new_session() -> Session:
    return Session(get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with new_session() as session:
        yield session
