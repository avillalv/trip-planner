"""Routines: per-trip schedules for background work."""

from datetime import datetime, timedelta

from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session
from tzlocal import get_localzone_name

from tripplanner.models import Routine, Trip

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
