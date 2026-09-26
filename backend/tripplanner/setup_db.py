"""`trip-planner setup-db`: create the app's PostgreSQL role and databases, then migrate.

Uses the PostgreSQL superuser once. Its password is prompted for (or read from
POSTGRES_SUPERUSER_PASSWORD) and never written to disk.
"""

import logging
import os
from getpass import getpass

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from sqlalchemy.engine import make_url

from tripplanner.config import get_settings
from tripplanner.migrate import upgrade

log = logging.getLogger(__name__)


class SetupError(RuntimeError):
    pass


def _ensure_role(conn: psycopg.Connection, role: str, password: str) -> None:
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
    verb = "ALTER" if exists else "CREATE"
    conn.execute(
        sql.SQL(verb + " ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password))
    )
    log.info("%s role %s", "Updated" if exists else "Created", role)


def _ensure_database(conn: psycopg.Connection, name: str, owner: str) -> None:
    if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
        log.info("Database %s already exists", name)
        return
    conn.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(name), sql.Identifier(owner)))
    log.info("Created database %s", name)


def setup_database(seed: bool = True) -> None:
    settings = get_settings()
    app_url = make_url(settings.database_url)
    if not (app_url.username and app_url.password and app_url.database):
        raise SetupError("DATABASE_URL in .env must include a user, password, and database name.")
    test_url = make_url(settings.test_database_url) if settings.test_database_url else None

    superuser = settings.postgres_superuser
    password = os.environ.get("POSTGRES_SUPERUSER_PASSWORD") or getpass(
        f"Password for the PostgreSQL superuser '{superuser}' (set when you installed PostgreSQL): "
    )
    conninfo = make_conninfo(
        host=app_url.host or "localhost",
        port=app_url.port or 5432,
        user=superuser,
        password=password,
        dbname="postgres",
    )
    try:
        with psycopg.connect(conninfo, autocommit=True, connect_timeout=10) as conn:
            _ensure_role(conn, app_url.username, app_url.password)
            _ensure_database(conn, app_url.database, owner=app_url.username)
            if test_url and test_url.database:
                _ensure_database(conn, test_url.database, owner=app_url.username)
    except psycopg.OperationalError as exc:
        raise SetupError(
            f"Couldn't connect to PostgreSQL as '{superuser}'. Check that the PostgreSQL service is "
            f"running and the password is correct.\n{exc}"
        ) from exc

    log.info("Applying migrations...")
    upgrade(settings.database_url)

    if seed:
        from tripplanner.seed.airports import seed_airports

        seed_airports()
