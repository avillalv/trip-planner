"""Programmatic Alembic entry points used by the CLI and tests."""

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, pool

from tripplanner.config import get_settings
from tripplanner.paths import ALEMBIC_INI, MIGRATIONS_DIR


def alembic_config(database_url: str | None = None) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    if database_url:
        cfg.attributes["database_url"] = database_url
    return cfg


def upgrade(database_url: str | None = None, revision: str = "head") -> None:
    command.upgrade(alembic_config(database_url), revision)


def pending_migrations(database_url: str | None = None) -> list[str]:
    """Migrations the database hasn't had yet, oldest first (empty when it's up to date)."""
    script = ScriptDirectory.from_config(alembic_config(database_url))
    engine = create_engine(database_url or get_settings().database_url, poolclass=pool.NullPool)
    try:
        with engine.connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()
    waiting = [rev.revision for rev in script.iterate_revisions("heads", current or "base")]
    return waiting[::-1]
