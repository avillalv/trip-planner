"""Programmatic Alembic entry points used by the CLI and tests."""

from alembic import command
from alembic.config import Config

from tripplanner.paths import ALEMBIC_INI, MIGRATIONS_DIR


def alembic_config(database_url: str | None = None) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    if database_url:
        cfg.attributes["database_url"] = database_url
    return cfg


def upgrade(database_url: str | None = None, revision: str = "head") -> None:
    command.upgrade(alembic_config(database_url), revision)
