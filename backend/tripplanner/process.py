"""Process helpers shared by the web server, worker, and supervisor."""

import logging
import os
import re
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


_SECRET_PARAM = re.compile(r"(?i)\b(api_?key|apikey|token|access_token|key)=([^&\s\"']+)")


class RedactSecrets(logging.Filter):
    """Mask API keys that appear in URLs (SerpApi and Geoapify take them as query parameters)."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = _SECRET_PARAM.sub(lambda m: f"{m.group(1)}=***", message)
        if redacted != message:
            record.msg, record.args = redacted, None
        return True


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # httpx logs every request URL at INFO, keys included; keep it to warnings.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    for handler in logging.getLogger().handlers:
        handler.addFilter(RedactSecrets())
