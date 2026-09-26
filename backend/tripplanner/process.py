"""Process helpers shared by the web server, worker, and supervisor."""

import logging
import os
import threading
import time

import psutil

PARENT_PID_ENV = "TRIP_PLANNER_PARENT_PID"

log = logging.getLogger(__name__)


def start_parent_watchdog(poll_seconds: float = 3.0) -> None:
    """Exit this process if the supervisor that started it disappears.

    Windows doesn't kill child processes when a parent is terminated (e.g. when the
    autostart task is ended), so children watch the supervisor PID themselves.
    """
    raw = os.environ.get(PARENT_PID_ENV)
    if not raw:
        return
    parent_pid = int(raw)

    def watch() -> None:
        while True:
            time.sleep(poll_seconds)
            if not psutil.pid_exists(parent_pid):
                log.warning("Supervisor (pid %s) is gone; exiting.", parent_pid)
                os._exit(0)

    threading.Thread(target=watch, name="parent-watchdog", daemon=True).start()


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
