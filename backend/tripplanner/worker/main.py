"""Background worker process: heartbeat, routine schedules, the run dispatcher, and nightly backups."""

import logging
import os
import signal
import threading
import time
from datetime import UTC, datetime

from sqlalchemy import Engine, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from tripplanner import __version__
from tripplanner.db import get_engine
from tripplanner.models import WorkerHeartbeat
from tripplanner.process import start_parent_watchdog

HEARTBEAT_SECONDS = 30
SYNC_SECONDS = 15
CATCH_UP_SECONDS = 300
TICK_SECONDS = 2
BACKUP_CHECK_SECONDS = 300
# After a failed backup (say, pg_dump missing), try again later rather than every check.
BACKUP_RETRY_SECONDS = 6 * 3600

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
    from tripplanner.services.backups import backup_if_due
    from tripplanner.worker.scheduler import RoutineScheduler

    start_parent_watchdog()
    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        log.info("Worker received signal %s; stopping.", signum)
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    started_at = datetime.now(UTC)
    log.info("Worker started (pid %s).", os.getpid())
    scheduler: RoutineScheduler | None = None
    never = float("-inf")
    last = {
        "beat": never,
        "sync": never,
        "catch_up": time.monotonic(),
        "backup": never,
        "backup_failed": never,
    }

    while not stop.is_set():
        now = time.monotonic()
        try:
            if now - last["beat"] >= HEARTBEAT_SECONDS:
                beat(started_at)
                last["beat"] = now
            if scheduler is None:
                # Started only once the database is reachable (it may still be booting at sign-in).
                scheduler = RoutineScheduler()
                scheduler.start()
                last["sync"] = now
            if now - last["sync"] >= SYNC_SECONDS:
                scheduler.sync_schedules()
                last["sync"] = now
            if now - last["catch_up"] >= CATCH_UP_SECONDS:
                scheduler.catch_up()
                last["catch_up"] = now
            if (
                now - last["backup"] >= BACKUP_CHECK_SECONDS
                and now - last["backup_failed"] >= BACKUP_RETRY_SECONDS
            ):
                last["backup"] = now
                if backup_if_due() is False:
                    last["backup_failed"] = now
            scheduler.dispatch()
        except SQLAlchemyError as exc:
            log.warning("Database unavailable, will retry: %s", exc.__class__.__name__)
            stop.wait(10)
            continue
        stop.wait(TICK_SECONDS)

    if scheduler is not None:
        scheduler.shutdown()
    log.info("Worker stopped.")
