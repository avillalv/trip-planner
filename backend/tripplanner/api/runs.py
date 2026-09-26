from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from tripplanner.api.deps import DbSession
from tripplanner.models import Routine, Run, RunEvent
from tripplanner.schemas.automation import RoutineOut, RoutineUpdate, RunEventOut, RunOut
from tripplanner.services import serpapi_budget
from tripplanner.services.routines import InvalidSchedule, RoutineNotFound, get_routine, next_fire, parse_cron
from tripplanner.services.runs import RunNotFound, request_cancel

router = APIRouter(prefix="/api/v1", tags=["automation"])


@router.get("/runs", response_model=list[RunOut])
def list_runs(
    db: DbSession,
    trip_id: int | None = None,
    routine_id: int | None = None,
    limit: int = Query(30, ge=1, le=200),
) -> list[RunOut]:
    stmt = select(Run).order_by(Run.queued_at.desc()).limit(limit)
    if trip_id is not None:
        stmt = stmt.where(Run.trip_id == trip_id)
    if routine_id is not None:
        stmt = stmt.where(Run.routine_id == routine_id)
    return [RunOut.model_validate(r) for r in db.scalars(stmt)]


def _run(db: DbSession, run_id: UUID) -> Run:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    return run


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: UUID, db: DbSession) -> RunOut:
    return RunOut.model_validate(_run(db, run_id))


@router.get("/runs/{run_id}/events", response_model=list[RunEventOut])
def run_events(run_id: UUID, db: DbSession, after_seq: int = Query(0, ge=0)) -> list[RunEventOut]:
    """Log lines after `after_seq`, for polling while a run is in progress."""
    _run(db, run_id)
    stmt = (
        select(RunEvent)
        .where(RunEvent.run_id == run_id, RunEvent.seq > after_seq)
        .order_by(RunEvent.seq)
        .limit(500)
    )
    return [RunEventOut.model_validate(e) for e in db.scalars(stmt)]


@router.post("/runs/{run_id}/cancel", response_model=RunOut)
def cancel_run(run_id: UUID, db: DbSession) -> RunOut:
    try:
        return RunOut.model_validate(request_cancel(db, run_id))
    except RunNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.") from exc


def _routine_out(db: DbSession, routine: Routine) -> RoutineOut:
    last = db.scalar(select(Run).where(Run.routine_id == routine.id).order_by(Run.queued_at.desc()).limit(1))
    try:
        upcoming = next_fire(routine, datetime.now(UTC))
    except InvalidSchedule:
        upcoming = None
    return RoutineOut(
        id=routine.id,
        trip_id=routine.trip_id,
        name=routine.name,
        kind=routine.kind,
        enabled=routine.enabled,
        schedule_cron=routine.schedule_cron,
        timezone=routine.timezone,
        catch_up=routine.catch_up,
        config=routine.config,
        next_run_at=upcoming,
        last_run=RunOut.model_validate(last) if last else None,
    )


@router.get("/trips/{trip_id}/routines", response_model=list[RoutineOut])
def trip_routines(trip_id: int, db: DbSession) -> list[RoutineOut]:
    routines = db.scalars(select(Routine).where(Routine.trip_id == trip_id).order_by(Routine.id))
    return [_routine_out(db, r) for r in routines]


@router.patch("/routines/{routine_id}", response_model=RoutineOut)
def update_routine(routine_id: int, body: RoutineUpdate, db: DbSession) -> RoutineOut:
    try:
        routine = get_routine(db, routine_id)
    except RoutineNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Routine not found.") from exc
    if body.schedule_cron is not None:
        try:
            parse_cron(body.schedule_cron, routine.timezone)
        except InvalidSchedule as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
        routine.schedule_cron = body.schedule_cron
    for field in ("name", "enabled", "catch_up"):
        value = getattr(body, field)
        if value is not None:
            setattr(routine, field, value)
    db.commit()
    return _routine_out(db, routine)


@router.get("/usage/serpapi", response_model=serpapi_budget.SerpApiUsage)
def serpapi_usage(db: DbSession) -> serpapi_budget.SerpApiUsage:
    """Live Google Flights searches used and left under the monthly cap."""
    return serpapi_budget.usage(db)
