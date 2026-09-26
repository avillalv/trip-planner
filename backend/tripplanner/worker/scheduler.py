"""Routine schedules (APScheduler) and the run dispatcher.

The database is the source of truth: schedules are rebuilt from the `routines` table, and
firing a schedule only queues a run. The dispatcher claims queued runs and executes them in
a thread pool, so "Run now" from the web app goes through exactly the same path.
"""

import logging
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import UUID

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select
from sqlalchemy.orm import Session

from tripplanner.db import new_session
from tripplanner.models import Routine, Run
from tripplanner.services.routines import InvalidSchedule, last_slot_before, parse_cron
from tripplanner.services.runs import claim_next, enqueue, recover_interrupted

log = logging.getLogger(__name__)

# Slots missed by up to this long (e.g. the PC was asleep) still run once on wake.
MISFIRE_GRACE_SECONDS = 6 * 3600
API_KINDS = ["flight_api"]


class RoutineScheduler:
    def __init__(
        self,
        session_factory: Callable[[], Session] = new_session,
        execute: Callable[[UUID], None] | None = None,
        max_api_jobs: int = 2,
    ) -> None:
        from tripplanner.worker.executor import execute_run

        self._session = session_factory
        self._execute = execute or execute_run
        self._scheduler = BackgroundScheduler(
            job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": MISFIRE_GRACE_SECONDS}
        )
        self._pool = ThreadPoolExecutor(max_workers=max_api_jobs, thread_name_prefix="run")
        self._max_api_jobs = max_api_jobs
        self._active: set[Future[None]] = set()
        self._signatures: dict[int, tuple[str, str]] = {}

    def start(self) -> None:
        with self._session() as db:
            interrupted = recover_interrupted(db)
        if interrupted:
            log.warning("Marked %d unfinished run(s) as interrupted.", interrupted)
        self._scheduler.start()
        self.sync_schedules()
        self.catch_up()

    def shutdown(self) -> None:
        self._scheduler.shutdown(wait=False)
        self._pool.shutdown(wait=True)

    # --- Schedules -------------------------------------------------------------------------

    def sync_schedules(self) -> None:
        """Add, update, or remove jobs so they match the enabled routines."""
        with self._session() as db:
            routines = list(db.scalars(select(Routine).where(Routine.enabled.is_(True))))
        wanted: dict[int, tuple[str, str]] = {}
        for routine in routines:
            signature = (routine.schedule_cron, routine.timezone)
            wanted[routine.id] = signature
            if self._signatures.get(routine.id) == signature:
                continue
            try:
                trigger = parse_cron(routine.schedule_cron, routine.timezone)
            except InvalidSchedule as exc:
                log.warning("Routine %s: %s", routine.id, exc)
                continue
            self._scheduler.add_job(
                self.fire, trigger, id=f"routine-{routine.id}", args=[routine.id], replace_existing=True
            )
            self._signatures[routine.id] = signature
        for routine_id in list(self._signatures):
            if routine_id not in wanted:
                job = self._scheduler.get_job(f"routine-{routine_id}")
                if job:
                    job.remove()
                del self._signatures[routine_id]

    def fire(self, routine_id: int, trigger: str = "schedule") -> None:
        with self._session() as db:
            routine = db.get(Routine, routine_id)
            if routine is None or not routine.enabled:
                return
            enqueue(db, trip_id=routine.trip_id, kind=routine.kind, trigger=trigger, routine=routine)
            routine.last_slot_at = datetime.now(UTC)
            db.commit()
        log.info("Queued %s run for routine %s", trigger, routine_id)

    def catch_up(self, now: datetime | None = None) -> int:
        """Queue one run for each routine whose latest slot passed while the app was off or asleep."""
        now = now or datetime.now(UTC)
        queued = 0
        with self._session() as db:
            routines = db.scalars(
                select(Routine).where(Routine.enabled.is_(True), Routine.catch_up.is_(True))
            )
            for routine in routines:
                try:
                    slot = last_slot_before(routine, now)
                except InvalidSchedule:
                    continue
                reference = routine.last_slot_at or routine.created_at
                if slot is None or reference >= slot:
                    continue
                recent = db.scalar(
                    select(Run.id).where(Run.routine_id == routine.id, Run.queued_at >= slot).limit(1)
                )
                if recent is None:
                    enqueue(
                        db, trip_id=routine.trip_id, kind=routine.kind, trigger="catch_up", routine=routine
                    )
                    queued += 1
                routine.last_slot_at = now
            db.commit()
        if queued:
            log.info("Queued %d catch-up run(s).", queued)
        return queued

    # --- Dispatch --------------------------------------------------------------------------

    def dispatch(self) -> int:
        """Start queued runs while there are free slots. Returns how many started."""
        self._active = {f for f in self._active if not f.done()}
        started = 0
        while len(self._active) < self._max_api_jobs:
            with self._session() as db:
                run = claim_next(db, API_KINDS)
                run_id = run.id if run else None
            if run_id is None:
                break
            self._active.add(self._pool.submit(self._execute, run_id))
            started += 1
        return started
