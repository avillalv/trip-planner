"""Run queue: enqueue, claim, log, and finish runs. The DB is the queue, so any process can add work."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from tripplanner.models import Routine, Run, RunEvent
from tripplanner.models.automation import FINISHED_STATUSES

ACTIVE_STATUSES = ("queued", "running")


class RunNotFound(LookupError):
    pass


def enqueue(
    db: Session,
    *,
    trip_id: int,
    kind: str,
    trigger: str,
    routine: Routine | None = None,
    params: dict[str, Any] | None = None,
) -> tuple[Run, bool]:
    """Queue a run. If the routine already has one queued, return that instead (created=False)."""
    if routine is not None:
        existing = db.scalar(
            select(Run)
            .where(Run.routine_id == routine.id, Run.status == "queued")
            .order_by(Run.queued_at)
            .limit(1)
        )
        if existing is not None and (existing.params or {}) == (params or {}):
            return existing, False
    run = Run(
        trip_id=trip_id,
        routine_id=routine.id if routine else None,
        kind=kind,
        trigger=trigger,
        status="queued",
        params=params or {},
    )
    db.add(run)
    db.commit()
    return run, True


def claim_next(db: Session, kinds: list[str]) -> Run | None:
    """Atomically take the oldest queued run of the given kinds (safe with several workers)."""
    run = db.scalar(
        select(Run)
        .where(Run.status == "queued", Run.kind.in_(kinds))
        .order_by(Run.queued_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if run is None:
        db.rollback()
        return None
    run.status = "running"
    run.started_at = datetime.now(UTC)
    db.commit()
    return run


def recover_interrupted(db: Session) -> int:
    """Runs left 'running' by a worker that stopped are marked interrupted."""
    result = db.execute(
        update(Run)
        .where(Run.status == "running")
        .values(
            status="interrupted", finished_at=func.now(), error="The worker stopped before this run finished."
        )
    )
    db.commit()
    return result.rowcount or 0


def finish(db: Session, run: Run, status: str, summary: str | None = None, error: str | None = None) -> None:
    assert status in FINISHED_STATUSES
    run.status = status
    run.finished_at = datetime.now(UTC)
    if summary is not None:
        run.summary = summary
    if error is not None:
        run.error = error
    db.commit()


def request_cancel(db: Session, run_id: UUID) -> Run:
    run = db.get(Run, run_id)
    if run is None:
        raise RunNotFound(run_id)
    if run.status == "queued":
        finish(db, run, "cancelled", summary="Cancelled before it started.")
    elif run.status == "running":
        run.cancel_requested = True
        db.commit()
    return run


def cancel_requested(db: Session, run_id: UUID) -> bool:
    return bool(db.scalar(select(Run.cancel_requested).where(Run.id == run_id)))


class RunLog:
    """Appends numbered events to a run's log."""

    def __init__(self, db: Session, run: Run) -> None:
        self.db = db
        self.run = run
        self.seq = (
            db.scalar(select(func.coalesce(func.max(RunEvent.seq), 0)).where(RunEvent.run_id == run.id)) or 0
        )

    def add(
        self, type_: str, summary: str, payload: dict[str, Any] | None = None, tool_name: str | None = None
    ) -> None:
        self.seq += 1
        self.db.add(
            RunEvent(
                run_id=self.run.id,
                seq=self.seq,
                type=type_,
                summary=summary[:2000],
                payload=payload,
                tool_name=tool_name,
            )
        )
        self.db.commit()

    def info(self, summary: str, **payload: Any) -> None:
        self.add("info", summary, payload or None)

    def warning(self, summary: str, **payload: Any) -> None:
        self.add("warning", summary, payload or None)

    def error(self, summary: str, **payload: Any) -> None:
        self.add("error", summary, payload or None)
