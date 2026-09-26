"""A trip's days and activities. Edits carry a version so two devices can't silently overwrite each other."""

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from tripplanner.models import Activity, ItineraryDay, Trip, TripDestination
from tripplanner.schemas.itinerary import (
    ActivityBrief,
    ActivityIn,
    ActivityUpdate,
    DayOut,
    DayUpdate,
    check_times,
)

# Guards against a typo'd year turning into thousands of days.
MAX_TRIP_DAYS = 366
REQUIRED_FIELDS = ("title", "category", "status", "notes")


class ActivityNotFound(LookupError):
    pass


class ActivityConflict(Exception):
    """The activity changed since the client loaded it."""


def trip_dates(trip: Trip) -> list[date]:
    if trip.start_date is None or trip.end_date is None:
        return []
    count = min((trip.end_date - trip.start_date).days + 1, MAX_TRIP_DAYS)
    return [trip.start_date + timedelta(days=i) for i in range(count)]


def day_order(activity: Activity) -> tuple[bool, Any, int]:
    """Timed activities by start time, then the ones for any time of day."""
    return (activity.start_time is None, activity.start_time, activity.id)


def _brief(activity: Activity | None) -> ActivityBrief | None:
    return ActivityBrief(title=activity.title, start_time=activity.start_time) if activity else None


def list_days(db: Session, trip: Trip) -> list[DayOut]:
    overrides = {
        row.day: row for row in db.scalars(select(ItineraryDay).where(ItineraryDay.trip_id == trip.id))
    }
    by_day: dict[date, list[Activity]] = defaultdict(list)
    for activity in db.scalars(
        select(Activity).where(Activity.trip_id == trip.id, Activity.day.is_not(None))
    ):
        by_day[activity.day].append(activity)  # type: ignore[index]

    in_trip = set(trip_dates(trip))
    destinations = {d.id: d for d in trip.destinations}
    fallback: TripDestination | None = trip.destinations[0] if trip.destinations else None
    days = []
    for day in sorted(in_trip | set(by_day)):
        row = overrides.get(day)
        destination = destinations.get(row.destination_id) if row and row.destination_id else fallback
        ordered = sorted(by_day.get(day, []), key=day_order)
        # The day's span: earliest and latest timed plans (any-time ones only when nothing is timed).
        timed = [a for a in ordered if a.start_time is not None] or ordered
        days.append(
            DayOut(
                day=day,
                title=row.title if row else "",
                notes=row.notes if row else "",
                destination_id=destination.id if destination else None,
                destination_name=destination.name if destination else None,
                timezone=destination.timezone if destination else None,
                in_trip=day in in_trip,
                activity_count=len(ordered),
                first=_brief(timed[0] if timed else None),
                last=_brief(timed[-1] if len(timed) > 1 else None),
            )
        )
    return days


def update_day(db: Session, trip: Trip, day: date, body: DayUpdate) -> DayOut:
    changes = body.model_dump(exclude_unset=True)
    destination_id = changes.get("destination_id")
    if destination_id is not None and destination_id not in {d.id for d in trip.destinations}:
        raise ValueError("That destination isn't part of this trip.")
    row = db.get(ItineraryDay, (trip.id, day))
    if row is None:
        row = ItineraryDay(trip_id=trip.id, day=day, title="", notes="")
        db.add(row)
    for field, value in changes.items():
        setattr(row, field, "" if value is None and field in ("title", "notes") else value)
    db.commit()
    return get_day(db, trip, day)


def get_day(db: Session, trip: Trip, day: date) -> DayOut:
    found = next((d for d in list_days(db, trip) if d.day == day), None)
    if found is not None:
        return found
    # Outside the trip's dates and empty: still answer, so an edit there isn't lost.
    row = db.get(ItineraryDay, (trip.id, day))
    return DayOut(
        day=day,
        title=row.title if row else "",
        notes=row.notes if row else "",
        destination_id=None,
        destination_name=None,
        timezone=None,
        in_trip=False,
        activity_count=0,
        first=None,
        last=None,
    )


def list_activities(
    db: Session, trip_id: int, day: date | None = None, ideas: bool = False
) -> list[Activity]:
    stmt = select(Activity).where(Activity.trip_id == trip_id)
    if ideas:
        stmt = stmt.where(Activity.day.is_(None))
    elif day is not None:
        stmt = stmt.where(Activity.day == day)
    stmt = stmt.order_by(
        Activity.day.nulls_first(), Activity.start_time.nulls_last(), Activity.created_at.desc(), Activity.id
    )
    return list(db.scalars(stmt))


def create_activity(db: Session, trip: Trip, body: ActivityIn) -> Activity:
    fields = body.model_dump(exclude={"place", "status"})
    activity = Activity(trip_id=trip.id, **fields, status=body.status or ("planned" if body.day else "idea"))
    if body.place is not None:
        activity.place_provider = body.place.provider
        activity.place_id = body.place.id
        activity.place_data = body.place.data or None
    db.add(activity)
    db.commit()
    return activity


def get_activity(db: Session, activity_id: int) -> Activity:
    activity = db.get(Activity, activity_id)
    if activity is None:
        raise ActivityNotFound(activity_id)
    return activity


def update_activity(db: Session, activity_id: int, body: ActivityUpdate) -> Activity:
    activity = get_activity(db, activity_id)
    if activity.version != body.version:
        raise ActivityConflict(activity_id)
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    for field in REQUIRED_FIELDS:
        if field in changes and changes[field] is None:
            raise ValueError(f"{field.capitalize()} can't be empty.")
    for field, value in changes.items():
        setattr(activity, field, value)

    if "day" in changes and "status" not in changes:
        # Moving to a day plans it; taking it off its day makes it an idea again.
        if activity.day is None and activity.status == "planned":
            activity.status = "idea"
        elif activity.day is not None and activity.status == "idea":
            activity.status = "planned"
    if activity.day is None:
        activity.start_time = activity.end_time = None
    if activity.start_time is None:
        activity.end_time = None
    check_times(activity.day, activity.start_time, activity.end_time)
    if (activity.lat is None) != (activity.lon is None):
        raise ValueError("Give both latitude and longitude, or neither.")

    try:
        db.commit()
    except StaleDataError as exc:
        db.rollback()
        raise ActivityConflict(activity_id) from exc
    return activity


def delete_activity(db: Session, activity_id: int, version: int) -> None:
    activity = get_activity(db, activity_id)
    if activity.version != version:
        raise ActivityConflict(activity_id)
    db.delete(activity)
    try:
        db.commit()
    except StaleDataError as exc:
        db.rollback()
        raise ActivityConflict(activity_id) from exc
