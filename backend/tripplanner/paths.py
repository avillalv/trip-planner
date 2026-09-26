"""Filesystem locations, resolved from the package so the CWD never matters."""

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = PACKAGE_DIR.parent
REPO_ROOT = BACKEND_DIR.parent

ENV_FILE = REPO_ROOT / ".env"
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
MIGRATIONS_DIR = PACKAGE_DIR / "migrations"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

DATA_DIR = REPO_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
LOG_DIR = DATA_DIR / "logs"
