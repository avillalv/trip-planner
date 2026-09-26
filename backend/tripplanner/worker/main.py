"""Background worker process.

Phase 1: keeps a heartbeat row fresh so the UI can show that background work is running.
The scheduler and job dispatcher build on this loop in later phases.
"""

import logging
import os
import signal
import threading
from datetime import UTC, datetime

from sqlalchemy import Engine, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from tripplanner import __version__
from tripplanner.db import get_engine
from tripplanner.models import WorkerHeartbeat
from tripplanner.process import start_parent_watchdog

HEARTBEAT_SECONDS = 30

log = logging.getLogger(__name__)


def beat(started_at: datetime, engine: Engine | None = None) -> None:
    stmt = insert(WorkerHeartbeat).values(
        id=1, pid=os.getpid(), version=__version__, started_at=started_at, last_seen=func.now()
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[WorkerHeartbeat.id],
        set_={
            "pid": stmt.excluded.pid,
            "version": stmt.excluded.version,
            "started_at": stmt.excluded.started_at,
            "last_seen": func.now(),
        },
    )
    with (engine or get_engine()).begin() as conn:
        conn.execute(stmt)


def run_worker() -> None:
    start_parent_watchdog()
    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        log.info("Worker received signal %s; stopping.", signum)
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    started_at = datetime.now(UTC)
    log.info("Worker started (pid %s).", os.getpid())
    while not stop.is_set():
        try:
            beat(started_at)
        except SQLAlchemyError as exc:
            # The database may still be starting (e.g. right after Windows sign-in); keep trying.
            log.warning("Heartbeat failed, will retry: %s", exc.__class__.__name__)
        stop.wait(HEARTBEAT_SECONDS)
    log.info("Worker stopped.")
