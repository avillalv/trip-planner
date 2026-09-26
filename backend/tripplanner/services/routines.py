"""Routines: per-trip schedules for background work."""

from datetime import datetime, timedelta
from typing import Any

from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from tzlocal import get_localzone_name

from tripplanner.models import FlightRoute, Routine, Run, Trip

DEFAULT_FLIGHT_SCHEDULE = "0 8,20 * * *"  # 8:00 and 20:00 every day


class RoutineNotFound(LookupError):
    pass


class InvalidSchedule(ValueError):
    pass


def local_timezone() -> str:
    return get_localzone_name() or "UTC"


def parse_cron(expression: str, timezone: str) -> CronTrigger:
    try:
        return CronTrigger.from_crontab(expression, timezone=timezone)
    except (ValueError, TypeError) as exc:
        raise InvalidSchedule(f"'{expression}' isn't a valid schedule: {exc}") from exc


def runs_per_day(routine: Routine, day_start: datetime) -> int:
    """How many times the schedule fires in the 24 hours after `day_start` (at least 1)."""
    trigger = parse_cron(routine.schedule_cron, routine.timezone)
    count, previous = 0, None
    fire = trigger.get_next_fire_time(None, day_start)
    end = day_start + timedelta(days=1)
    while fire is not None and fire < end and count < 1440:
        count += 1
        previous = fire
        fire = trigger.get_next_fire_time(previous, previous + timedelta(seconds=1))
    return max(1, count)


def last_slot_before(
    routine: Routine, now: datetime, lookback: timedelta = timedelta(days=3)
) -> datetime | None:
    """The most recent time the schedule should have fired, within the lookback window."""
    trigger = parse_cron(routine.schedule_cron, routine.timezone)
    last, fire = None, trigger.get_next_fire_time(None, now - lookback)
    steps = 0
    while fire is not None and fire <= now and steps < 5000:
        last = fire
        fire = trigger.get_next_fire_time(fire, fire + timedelta(seconds=1))
        steps += 1
    return last


def next_fire(routine: Routine, now: datetime) -> datetime | None:
    if not routine.enabled:
        return None
    return parse_cron(routine.schedule_cron, routine.timezone).get_next_fire_time(None, now)


def ensure_flight_routine(db: Session, trip: Trip) -> Routine:
    """Every trip with routes gets a price-check routine (twice a day by default)."""
    routine = db.scalar(select(Routine).where(Routine.trip_id == trip.id, Routine.kind == "flight_api"))
    if routine is None:
        routine = Routine(
            trip_id=trip.id,
            name="Flight prices",
            kind="flight_api",
            enabled=True,
            schedule_cron=DEFAULT_FLIGHT_SCHEDULE,
            timezone=local_timezone(),
            catch_up=True,
            config={},
        )
        db.add(routine)
        db.flush()
    return routine


def get_routine(db: Session, routine_id: int) -> Routine:
    routine = db.get(Routine, routine_id)
    if routine is None:
        raise RoutineNotFound(routine_id)
    return routine


# --- Agent routines (created and removed by the user) -----------------------------------------

DEFAULT_AGENT_SCHEDULES = {"flight_agent": "0 8,20 * * *", "research_agent": "0 9 * * 1"}


class RoutineError(ValueError):
    """A routine setting that can't be used; the message is shown to the user."""


def clean_config(db: Session, trip_id: int, kind: str, config: dict[str, Any]) -> dict[str, Any]:
    route_ids = config.get("route_ids") or []
    if route_ids:
        found = set(
            db.scalars(
                select(FlightRoute.id).where(FlightRoute.trip_id == trip_id, FlightRoute.id.in_(route_ids))
            )
        )
        if set(route_ids) - found:
            raise RoutineError("Some of the chosen routes aren't part of this trip.")
    if kind == "flight_agent":
        has_route = db.scalar(select(FlightRoute.id).where(FlightRoute.trip_id == trip_id).limit(1))
        if has_route is None:
            raise RoutineError("Add a flight route to this trip first. The agent searches the trip's routes.")
    return {k: v for k, v in config.items() if v not in (None, "", [])}


def create_routine(
    db: Session,
    *,
    trip: Trip,
    name: str,
    kind: str,
    schedule_cron: str,
    enabled: bool,
    catch_up: bool,
    config: dict[str, Any],
) -> Routine:
    timezone = local_timezone()
    parse_cron(schedule_cron, timezone)
    routine = Routine(
        trip_id=trip.id,
        name=name,
        kind=kind,
        enabled=enabled,
        schedule_cron=schedule_cron,
        timezone=timezone,
        catch_up=catch_up,
        config=clean_config(db, trip.id, kind, config),
    )
    db.add(routine)
    db.commit()
    return routine


def delete_routine(db: Session, routine: Routine) -> None:
    """Remove an agent routine. Its past runs stay in the history; queued ones are cancelled."""
    if routine.kind == "flight_api":
        raise RoutineError("Price checks are set up automatically for each trip. Turn this one off instead.")
    db.execute(
        update(Run)
        .where(Run.routine_id == routine.id, Run.status == "queued")
        .values(status="cancelled", finished_at=func.now(), summary="Cancelled: the routine was deleted.")
    )
    db.delete(routine)
    db.commit()
