"""`trip-planner serve`: run the web server and worker together, restarting either if it crashes.

Separate processes keep long-running agent jobs alive when the web server restarts.
"""

import logging
import os
import subprocess
import sys
import time

from tripplanner.process import PARENT_PID_ENV

log = logging.getLogger(__name__)

CHILDREN = ("web", "worker")
MAX_BACKOFF_SECONDS = 30
HEALTHY_AFTER_SECONDS = 60


def _spawn(name: str, env: dict[str, str]) -> subprocess.Popen[bytes]:
    log.info("Starting %s", name)
    return subprocess.Popen([sys.executable, "-m", "tripplanner.cli", name], env=env)


def prepare_database(attempts: int = 12, wait_seconds: float = 5) -> None:
    """Apply database changes from an update before starting, backing up first so they can be undone.

    At sign-in PostgreSQL may still be starting, so the check waits for it for about a minute.
    """
    from sqlalchemy.exc import OperationalError

    from tripplanner.migrate import pending_migrations, upgrade
    from tripplanner.services.backups import BackupError, run_backup

    for attempt in range(attempts):
        try:
            waiting = pending_migrations()
            break
        except OperationalError:
            if attempt == attempts - 1:
                log.warning("Couldn't reach the database to check for updates; starting anyway.")
                return
            time.sleep(wait_seconds)
    if not waiting:
        return
    log.info("This version changes the database (%d update(s)); backing it up first.", len(waiting))
    try:
        info = run_backup()
        log.info("Backed up the database to %s.", info.path)
    except BackupError as exc:
        log.warning("Couldn't back up before updating the database: %s", exc)
    try:
        upgrade()
    except Exception:
        log.exception(
            "Couldn't update the database. Nothing was started; see the error above. "
            "To go back, restore the backup with `npm run restore`."
        )
        raise SystemExit(1) from None
    log.info("Database updated.")


def serve() -> None:
    prepare_database()
    env = {**os.environ, PARENT_PID_ENV: str(os.getpid())}
    procs = {name: _spawn(name, env) for name in CHILDREN}
    started = dict.fromkeys(CHILDREN, time.monotonic())
    failures = dict.fromkeys(CHILDREN, 0)
    restart_at: dict[str, float] = {}

    try:
        while True:
            time.sleep(1)
            now = time.monotonic()
            for name in CHILDREN:
                if name in restart_at:
                    if now >= restart_at[name]:
                        del restart_at[name]
                        procs[name] = _spawn(name, env)
                        started[name] = now
                    continue
                code = procs[name].poll()
                if code is None:
                    continue
                # A child that ran for a while before exiting gets a fresh backoff.
                failures[name] = 0 if now - started[name] > HEALTHY_AFTER_SECONDS else failures[name] + 1
                delay = min(MAX_BACKOFF_SECONDS, 2 ** failures[name])
                log.warning("%s exited with code %s; restarting in %ss", name, code, delay)
                restart_at[name] = now + delay
    except KeyboardInterrupt:
        log.info("Shutting down...")
    finally:
        _stop_all(procs)


def _stop_all(procs: dict[str, subprocess.Popen[bytes]]) -> None:
    # On Ctrl+C every process in the console gets the signal; give children time to exit cleanly.
    deadline = time.monotonic() + 10
    for proc in procs.values():
        try:
            proc.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            proc.terminate()
    for proc in procs.values():
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
