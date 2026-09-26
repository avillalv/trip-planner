"""Database backups with pg_dump: one each night (caught up after a missed night), newest 14 kept.

Credentials reach pg_dump and pg_restore through libpq's environment variables, never the
command line. Restoring replaces everything in the target database, so the app should be stopped.
"""

import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from tripplanner.config import get_settings
from tripplanner.models import AppSetting
from tripplanner.paths import DATA_DIR
from tripplanner.services.claude_cli import NO_WINDOW

KEEP = 14
NIGHTLY_AT = time(3, 30)
PREFIX = "tripplanner-"
SUFFIX = ".dump"
TIMEOUT_SECONDS = 600
ERROR_KEY = "backup_error"

log = logging.getLogger(__name__)


class BackupError(RuntimeError):
    pass


@dataclass
class BackupInfo:
    path: Path
    created_at: datetime
    size: int


def backup_dir() -> Path:
    return get_settings().backup_dir or DATA_DIR / "backups"


def _version(folder: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", folder)) or (0,)


def find_tool(name: str) -> Path:
    """pg_dump or pg_restore: from PG_BIN_DIR, PATH, or the newest PostgreSQL install on this PC."""
    exe = f"{name}.exe" if os.name == "nt" else name
    if configured := get_settings().pg_bin_dir:
        candidate = Path(configured) / exe
        if candidate.is_file():
            return candidate
        raise BackupError(
            f"PG_BIN_DIR is set, but {candidate} doesn't exist. Point it at PostgreSQL's bin folder."
        )
    if found := shutil.which(name):
        return Path(found)
    root = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "PostgreSQL"
    installs = sorted(root.glob(f"*/bin/{exe}"), key=lambda p: _version(p.parent.parent.name), reverse=True)
    if installs:
        return installs[0]
    raise BackupError(
        f"Couldn't find {name}, which comes with PostgreSQL. "
        f"Set PG_BIN_DIR in .env to the folder that has {exe}."
    )


def _libpq_env(database_url: str) -> dict[str, str]:
    url = make_url(database_url)
    env = dict(os.environ)
    env.update(
        {
            "PGHOST": url.host or "localhost",
            "PGPORT": str(url.port or 5432),
            "PGUSER": url.username or "",
            "PGDATABASE": url.database or "",
        }
    )
    if url.password:
        env["PGPASSWORD"] = url.password
    return env


def list_backups(directory: Path | None = None) -> list[BackupInfo]:
    """Backups in the folder, newest first."""
    directory = directory or backup_dir()
    if not directory.is_dir():
        return []
    found = []
    for path in directory.glob(f"{PREFIX}*{SUFFIX}"):
        stat = path.stat()
        found.append(BackupInfo(path, datetime.fromtimestamp(stat.st_mtime, UTC), stat.st_size))
    return sorted(found, key=lambda b: b.created_at, reverse=True)


def prune(directory: Path, keep: int = KEEP) -> list[Path]:
    removed = [b.path for b in list_backups(directory)[keep:]]
    for path in removed:
        path.unlink(missing_ok=True)
    return removed


def run_backup(database_url: str | None = None, now: datetime | None = None) -> BackupInfo:
    """Dump the database to a new file in the backup folder, then drop the oldest beyond 14."""
    database_url = database_url or get_settings().database_url
    now = now or datetime.now(UTC)
    directory = backup_dir()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{PREFIX}{now.astimezone().strftime('%Y%m%d-%H%M%S')}{SUFFIX}"
    partial = target.with_name(target.name + ".partial")
    command = [str(find_tool("pg_dump")), "--format=custom", "--no-owner", f"--file={partial}"]
    try:
        subprocess.run(
            command,
            env=_libpq_env(database_url),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=True,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
    except subprocess.CalledProcessError as exc:
        partial.unlink(missing_ok=True)
        raise BackupError(f"pg_dump failed: {(exc.stderr or '').strip() or exc}") from exc
    except (OSError, subprocess.TimeoutExpired) as exc:
        partial.unlink(missing_ok=True)
        raise BackupError(f"pg_dump didn't finish: {exc}") from exc
    partial.replace(target)
    prune(directory)
    stat = target.stat()
    return BackupInfo(target, datetime.fromtimestamp(stat.st_mtime, UTC), stat.st_size)


def restore(path: Path, database_url: str) -> None:
    """Replace everything in the database with the backup's contents."""
    if not path.is_file():
        raise BackupError(f"There's no backup at {path}.")
    command = [
        str(find_tool("pg_restore")),
        "--clean",
        "--if-exists",
        "--no-owner",
        "--single-transaction",
        f"--dbname={make_url(database_url).database}",
        str(path),
    ]
    try:
        subprocess.run(
            command,
            env=_libpq_env(database_url),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=True,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
    except subprocess.CalledProcessError as exc:
        raise BackupError(f"pg_restore failed: {(exc.stderr or '').strip() or exc}") from exc
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackupError(f"pg_restore didn't finish: {exc}") from exc


def last_slot(now: datetime) -> datetime:
    """The most recent 3:30 at night, in this PC's time zone."""
    local = now.astimezone()
    slot = datetime.combine(local.date(), NIGHTLY_AT, tzinfo=local.tzinfo)
    return slot if slot <= local else slot - timedelta(days=1)


def is_due(now: datetime, backups: list[BackupInfo]) -> bool:
    """True when no backup was made since the last nightly slot (the PC may have been off)."""
    return not backups or backups[0].created_at < last_slot(now)


def record_error(db: Session, message: str | None) -> None:
    row = db.get(AppSetting, ERROR_KEY)
    if message is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AppSetting(key=ERROR_KEY, value=message))
    else:
        row.value = message
    db.commit()


def last_error(db: Session) -> str | None:
    row = db.get(AppSetting, ERROR_KEY)
    return row.value if row else None


def backup_if_due(now: datetime | None = None) -> bool | None:
    """The worker's nightly check: back up if a night was missed. None when nothing was due."""
    from sqlalchemy.exc import SQLAlchemyError

    from tripplanner.db import new_session

    now = now or datetime.now(UTC)
    if not is_due(now, list_backups()):
        return None
    try:
        info = run_backup(now=now)
    except BackupError as exc:
        log.warning("Backup failed: %s", exc)
        outcome, message = False, str(exc)
    else:
        log.info("Backed up the database to %s (%d KB).", info.path.name, max(1, info.size // 1024))
        outcome, message = True, None
    try:
        with new_session() as db:
            record_error(db, message)
    except SQLAlchemyError:
        log.warning("Couldn't record the backup result; the database is unavailable.")
    return outcome
