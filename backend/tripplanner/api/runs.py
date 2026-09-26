from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from tripplanner.api.deps import DbSession
from tripplanner.models import AgentNote, FlightQuote, IngestRejection, Routine, Run, RunEvent, Trip
from tripplanner.schemas.agent import NoteOut, RejectionOut
from tripplanner.schemas.automation import (
    RoutineConfig,
    RoutineCreate,
    RoutineOut,
    RoutineUpdate,
    RunDetailOut,
    RunEventOut,
    RunOut,
    RunOutputs,
    RunStatus,
)
from tripplanner.schemas.flights import QuoteOut
from tripplanner.services import serpapi_budget
from tripplanner.services.routines import (
    InvalidSchedule,
    RoutineError,
    RoutineNotFound,
    clean_config,
    create_routine,
    delete_routine,
    get_routine,
    next_fire,
    parse_cron,
)
from tripplanner.services.runs import RunNotFound, enqueue, request_cancel

router = APIRouter(prefix="/api/v1", tags=["automation"])


# --- Runs ---------------------------------------------------------------------------------------


@router.get("/runs", response_model=list[RunOut])
def list_runs(
    db: DbSession,
    trip_id: int | None = None,
    routine_id: int | None = None,
    run_status: Annotated[RunStatus | None, Query(alias="status")] = None,
    limit: int = Query(30, ge=1, le=200),
) -> list[RunOut]:
    stmt = select(Run).order_by(Run.queued_at.desc()).limit(limit)
    if trip_id is not None:
        stmt = stmt.where(Run.trip_id == trip_id)
    if routine_id is not None:
        stmt = stmt.where(Run.routine_id == routine_id)
    if run_status is not None:
        stmt = stmt.where(Run.status == run_status)
    return [RunOut.model_validate(r) for r in db.scalars(stmt)]


def _run(db: DbSession, run_id: UUID) -> Run:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.")
    return run


@router.get("/runs/{run_id}", response_model=RunDetailOut)
def get_run(run_id: UUID, db: DbSession) -> RunDetailOut:
    return RunDetailOut.model_validate(_run(db, run_id))


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


@router.get("/runs/{run_id}/outputs", response_model=RunOutputs)
def run_outputs(run_id: UUID, db: DbSession) -> RunOutputs:
    """What the run saved (prices and notes) and what was rejected, with the reasons."""
    _run(db, run_id)
    quotes = db.scalars(
        select(FlightQuote)
        .where(FlightQuote.run_id == run_id)
        .order_by(FlightQuote.price_home, FlightQuote.id)
    )
    notes = db.scalars(select(AgentNote).where(AgentNote.run_id == run_id).order_by(AgentNote.id))
    rejections = db.scalars(
        select(IngestRejection).where(IngestRejection.run_id == run_id).order_by(IngestRejection.id)
    )
    return RunOutputs(
        quotes=[QuoteOut.model_validate(q) for q in quotes],
        notes=[NoteOut.model_validate(n) for n in notes],
        rejections=[RejectionOut.model_validate(r) for r in rejections],
    )


@router.post("/runs/{run_id}/cancel", response_model=RunOut)
def cancel_run(run_id: UUID, db: DbSession) -> RunOut:
    try:
        return RunOut.model_validate(request_cancel(db, run_id))
    except RunNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found.") from exc


# --- Routines -----------------------------------------------------------------------------------


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
        config=RoutineConfig.model_validate(routine.config or {}),
        next_run_at=upcoming,
        last_run=RunOut.model_validate(last) if last else None,
    )


def _routine(db: DbSession, routine_id: int) -> Routine:
    try:
        return get_routine(db, routine_id)
    except RoutineNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Routine not found.") from exc


@router.get("/routines", response_model=list[RoutineOut])
def list_routines(db: DbSession, trip_id: int | None = None) -> list[RoutineOut]:
    stmt = select(Routine).order_by(Routine.trip_id, Routine.id)
    if trip_id is not None:
        stmt = stmt.where(Routine.trip_id == trip_id)
    return [_routine_out(db, r) for r in db.scalars(stmt)]


@router.get("/trips/{trip_id}/routines", response_model=list[RoutineOut])
def trip_routines(trip_id: int, db: DbSession) -> list[RoutineOut]:
    return list_routines(db, trip_id)


@router.post("/routines", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
def add_routine(body: RoutineCreate, db: DbSession) -> RoutineOut:
    trip = db.get(Trip, body.trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    try:
        routine = create_routine(
            db,
            trip=trip,
            name=body.name,
            kind=body.kind,
            schedule_cron=body.schedule_cron,
            enabled=body.enabled,
            catch_up=body.catch_up,
            config=body.config.model_dump(),
        )
    except (InvalidSchedule, RoutineError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return _routine_out(db, routine)


@router.get("/routines/{routine_id}", response_model=RoutineOut)
def get_routine_detail(routine_id: int, db: DbSession) -> RoutineOut:
    return _routine_out(db, _routine(db, routine_id))


@router.patch("/routines/{routine_id}", response_model=RoutineOut)
def update_routine(routine_id: int, body: RoutineUpdate, db: DbSession) -> RoutineOut:
    routine = _routine(db, routine_id)
    try:
        if body.schedule_cron is not None:
            parse_cron(body.schedule_cron, routine.timezone)
            routine.schedule_cron = body.schedule_cron
        if body.config is not None and routine.kind != "flight_api":
            routine.config = clean_config(db, routine.trip_id, routine.kind, body.config.model_dump())
    except (InvalidSchedule, RoutineError) as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    for field in ("name", "enabled", "catch_up"):
        value = getattr(body, field)
        if value is not None:
            setattr(routine, field, value)
    db.commit()
    return _routine_out(db, routine)


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_routine(routine_id: int, db: DbSession) -> None:
    try:
        delete_routine(db, _routine(db, routine_id))
    except RoutineError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/routines/{routine_id}/run", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def run_routine_now(routine_id: int, db: DbSession) -> RunOut:
    """Queue a run now. If one is already waiting to start, that run is returned instead."""
    routine = _routine(db, routine_id)
    run, _ = enqueue(db, trip_id=routine.trip_id, kind=routine.kind, trigger="manual", routine=routine)
    return RunOut.model_validate(run)


# --- Notes and usage ----------------------------------------------------------------------------


@router.get("/trips/{trip_id}/notes", response_model=list[NoteOut])
def trip_notes(trip_id: int, db: DbSession, limit: int = Query(50, ge=1, le=200)) -> list[NoteOut]:
    """Findings saved by research agents, newest first."""
    stmt = (
        select(AgentNote)
        .where(AgentNote.trip_id == trip_id)
        .order_by(AgentNote.created_at.desc(), AgentNote.id.desc())
        .limit(limit)
    )
    return [NoteOut.model_validate(n) for n in db.scalars(stmt)]


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: int, db: DbSession) -> None:
    note = db.get(AgentNote, note_id)
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found.")
    db.delete(note)
    db.commit()


@router.get("/usage/serpapi", response_model=serpapi_budget.SerpApiUsage)
def serpapi_usage(db: DbSession) -> serpapi_budget.SerpApiUsage:
    """Live Google Flights searches used and left under the monthly cap."""
    return serpapi_budget.usage(db)
