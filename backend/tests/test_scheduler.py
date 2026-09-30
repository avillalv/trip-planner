from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_trip
from tripplanner.models import Routine, Run
from tripplanner.services.routines import last_slot_before, runs_per_day
from tripplanner.services.runs import claim_next, enqueue, recover_interrupted
from tripplanner.worker.scheduler import LANES, RoutineScheduler


def add_routine(db: Session, **overrides: object) -> Routine:
    trip = add_trip(db)
    values = {
        "trip_id": trip.id,
        "name": "Flight prices",
        "kind": "flight_api",
        "enabled": True,
        "schedule_cron": "0 8,20 * * *",
        "timezone": "UTC",
        "catch_up": True,
        "config": {},
    }
    values.update(overrides)
    routine = Routine(**values)
    db.add(routine)
    db.flush()
    return routine


@pytest.fixture
def executed() -> list[UUID]:
    return []


@pytest.fixture
def scheduler(db_session: Session, executed: list[UUID]):
    s = RoutineScheduler(
        session_factory=lambda: nullcontext(db_session),
        execute=executed.append,
        max_api_jobs=1,
        max_agent_jobs=1,
    )
    yield s
    s.close()


def test_schedule_math() -> None:
    routine = Routine(schedule_cron="0 8,20 * * *", timezone="UTC")
    now = datetime(2026, 9, 26, 15, tzinfo=UTC)

    assert runs_per_day(routine, datetime(2026, 9, 26, tzinfo=UTC)) == 2
    assert last_slot_before(routine, now) == datetime(2026, 9, 26, 8, tzinfo=UTC)


def test_missed_slot_queues_exactly_one_catch_up(db_session: Session, scheduler: RoutineScheduler) -> None:
    now = datetime(2026, 9, 26, 15, tzinfo=UTC)
    routine = add_routine(
        db_session, created_at=now - timedelta(days=2), last_slot_at=now - timedelta(days=1)
    )

    assert scheduler.catch_up(now) == 1
    assert scheduler.catch_up(now + timedelta(minutes=5)) == 0
    [run] = db_session.scalars(select(Run).where(Run.routine_id == routine.id)).all()
    assert (run.trigger, run.status) == ("catch_up", "queued")


def test_new_routines_do_not_catch_up_on_slots_before_they_existed(
    db_session: Session, scheduler: RoutineScheduler
) -> None:
    now = datetime(2026, 9, 26, 15, tzinfo=UTC)
    add_routine(db_session, created_at=now - timedelta(hours=1))

    assert scheduler.catch_up(now) == 0


def test_firing_queues_once_while_a_run_waits(db_session: Session, scheduler: RoutineScheduler) -> None:
    routine = add_routine(db_session)

    scheduler.fire(routine.id)
    scheduler.fire(routine.id)

    runs = db_session.scalars(select(Run).where(Run.routine_id == routine.id)).all()
    assert [r.trigger for r in runs] == ["schedule"]
    assert routine.last_slot_at is not None


def test_dispatch_claims_queued_runs(
    db_session: Session, scheduler: RoutineScheduler, executed: list[UUID]
) -> None:
    routine = add_routine(db_session)
    run, _ = enqueue(
        db_session, trip_id=routine.trip_id, kind="flight_api", trigger="manual", routine=routine
    )

    assert scheduler.dispatch() == 1
    scheduler.close()

    assert executed == [run.id]
    assert run.status == "running" and run.started_at is not None
    assert claim_next(db_session, ["flight_api"]) is None


def test_schedules_follow_the_routines_table(db_session: Session, scheduler: RoutineScheduler) -> None:
    on = add_routine(db_session)
    add_routine(db_session, enabled=False)
    scheduler._scheduler.start(paused=True)
    try:
        scheduler.sync_schedules()
        assert [j.id for j in scheduler._scheduler.get_jobs()] == [f"routine-{on.id}"]

        on.enabled = False
        db_session.flush()
        scheduler.sync_schedules()
        assert scheduler._scheduler.get_jobs() == []
    finally:
        scheduler._scheduler.shutdown(wait=False)


def test_runs_left_running_become_interrupted(db_session: Session) -> None:
    routine = add_routine(db_session)
    run, _ = enqueue(
        db_session, trip_id=routine.trip_id, kind="flight_api", trigger="manual", routine=routine
    )
    claim_next(db_session, ["flight_api"])

    assert recover_interrupted(db_session) == 1
    db_session.refresh(run)
    assert run.status == "interrupted"


def test_agent_runs_have_their_own_lane(
    db_session: Session, scheduler: RoutineScheduler, executed: list[UUID]
) -> None:
    api = add_routine(db_session)
    agent = add_routine(db_session, kind="flight_agent", name="Fare scout")
    first, _ = enqueue(db_session, trip_id=api.trip_id, kind="flight_api", trigger="manual", routine=api)
    second, _ = enqueue(
        db_session, trip_id=api.trip_id, kind="flight_api", trigger="manual", routine=api, params={"n": 2}
    )
    agent_run, _ = enqueue(
        db_session, trip_id=agent.trip_id, kind="flight_agent", trigger="manual", routine=agent
    )

    # One API slot and one agent slot: the agent run starts even though an API run is waiting.
    assert scheduler.dispatch() == 2
    scheduler.close()

    assert set(executed) == {first.id, agent_run.id}
    assert second.status == "queued"


def test_runs_a_traveler_asked_for_never_wait_behind_scheduled_agents(
    db_session: Session, scheduler: RoutineScheduler, executed: list[UUID]
) -> None:
    scout = add_routine(db_session, kind="flight_agent", name="Fare scout")
    busy, _ = enqueue(
        db_session, trip_id=scout.trip_id, kind="flight_agent", trigger="schedule", routine=scout
    )
    waiting, _ = enqueue(
        db_session,
        trip_id=scout.trip_id,
        kind="flight_agent",
        trigger="schedule",
        routine=scout,
        params={"n": 2},
    )
    ideas, _ = enqueue(db_session, trip_id=scout.trip_id, kind="itinerary_agent", trigger="manual")
    lodging, _ = enqueue(db_session, trip_id=scout.trip_id, kind="lodging_agent", trigger="manual")

    # One slot per lane: the first scheduled agent run and the first asked-for run start; the rest wait.
    assert scheduler.dispatch() == 2
    scheduler.close()

    assert set(executed) == {busy.id, ideas.id}
    assert (waiting.status, lodging.status) == ("queued", "queued")
    assert LANES["assist"] == ["itinerary_agent", "lodging_agent"]


def test_the_assist_lane_can_be_widened(db_session: Session, executed: list[UUID]) -> None:
    trip = add_trip(db_session)
    first, _ = enqueue(db_session, trip_id=trip.id, kind="itinerary_agent", trigger="manual")
    second, _ = enqueue(db_session, trip_id=trip.id, kind="lodging_agent", trigger="manual")
    wide = RoutineScheduler(
        session_factory=lambda: nullcontext(db_session), execute=executed.append, max_assist_jobs=2
    )

    assert wide.dispatch() == 2
    wide.close()
    assert set(executed) == {first.id, second.id}
