"""Health probes shared by /api/health and /api/v1/system/status."""

import shutil
import subprocess
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from tripplanner.config import Settings
from tripplanner.models import WorkerHeartbeat
from tripplanner.schemas.system import ClaudeCliStatus, WorkerStatus

# The worker beats every 30 s; allow a few missed beats before calling it stale.
WORKER_STALE_AFTER = timedelta(seconds=90)
_CLAUDE_CACHE_SECONDS = 600
_claude_cache: tuple[float, ClaudeCliStatus] | None = None


def database_ok(db: Session) -> bool:
    try:
        db.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        db.rollback()
        return False


def worker_status(db: Session, now: datetime | None = None) -> WorkerStatus:
    try:
        beat = db.scalar(select(WorkerHeartbeat).where(WorkerHeartbeat.id == 1))
    except SQLAlchemyError:
        db.rollback()
        return WorkerStatus(status="unknown")
    if beat is None:
        return WorkerStatus(status="never_started")
    now = now or datetime.now(UTC)
    fresh = now - beat.last_seen <= WORKER_STALE_AFTER
    return WorkerStatus(status="ok" if fresh else "stale", last_seen=beat.last_seen)


def claude_cli_status(settings: Settings) -> ClaudeCliStatus:
    """Locate the Claude Code CLI and read its version (cached; `claude --version` is slow)."""
    global _claude_cache
    if _claude_cache and time.monotonic() - _claude_cache[0] < _CLAUDE_CACHE_SECONDS:
        return _claude_cache[1]

    path = shutil.which(settings.claude_path or "claude")
    status = ClaudeCliStatus(found=False)
    if path:
        version = None
        try:
            out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=15, check=False)
            version = out.stdout.strip().split(" ")[0] or None
        except (OSError, subprocess.TimeoutExpired):
            pass
        status = ClaudeCliStatus(found=True, path=path, version=version)

    _claude_cache = (time.monotonic(), status)
    return status
