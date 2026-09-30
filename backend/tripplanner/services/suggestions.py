"""AI ideas: asking Claude for them, and turning the ones the travelers like into itinerary activities."""

from datetime import date, time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tripplanner.config import get_settings
from tripplanner.models import Activity, ActivitySuggestion, Run, Trip
from tripplanner.schemas.itinerary import ActivityIn
from tripplanner.schemas.suggestions import IdeasIn, end_of
from tripplanner.services.claude_cli import CLAUDE_MISSING, KEY_MISSING, find_claude
from tripplanner.services.itinerary import create_activity
from tripplanner.services.runs import ACTIVE_STATUSES, enqueue

MINUTES_PER_DAY = 24 * 60
# A booked plan with no end time (a flight leg, say) is assumed to take this long.
UNTIMED_BOOKED_MIN = 60
NOTES_LIMIT = 4000


class IdeasNotAllowed(ValueError):
    """The request can't be asked as it stands (no dates, or a day outside them)."""


class IdeasBusy(Exception):
    """Claude is already working on this trip's ideas."""


class IdeasUnavailable(Exception):
    """Claude Code or the agent key isn't set up, so a run couldn't do anything."""


class SuggestionNotFound(LookupError):
    pass


class AlreadyAdded(Exception):
    pass


def short_date(day: date) -> str:
    return f"{day:%b} {day.day}"


def is_busy(db: Session, trip_id: int, kind: str) -> bool:
    """Whether a run of this kind is already queued or running for the trip."""
    return (
        db.scalar(
            select(Run.id)
            .where(Run.trip_id == trip_id, Run.kind == kind, Run.status.in_(ACTIVE_STATUSES))
            .limit(1)
        )
        is not None
    )


def ensure_agent_ready() -> None:
    """Raises IdeasUnavailable unless a run could start and save its results."""
    settings = get_settings()
    if not (settings.agent_ingest_api_key and settings.agent_ingest_api_key.get_secret_value()):
        raise IdeasUnavailable(KEY_MISSING)
    if find_claude(settings) is None:
        raise IdeasUnavailable(CLAUDE_MISSING)


def ask_for_ideas(db: Session, trip: Trip, body: IdeasIn) -> Run:
    """Queue an itinerary run. Checks come cheapest first, so the traveler's fixable mistakes win."""
    if trip.start_date is None or trip.end_date is None:
        raise IdeasNotAllowed("Add the trip's dates first so ideas can be placed on days.")
    if body.day is not None and not trip.start_date <= body.day <= trip.end_date:
        raise IdeasNotAllowed(
            f"Pick a day between {short_date(trip.start_date)} and {short_date(trip.end_date)}, "
            "the trip's dates."
        )
    if is_busy(db, trip.id, "itinerary_agent"):
        raise IdeasBusy("Claude is still working on your last request. Wait for it or stop it first.")
    ensure_agent_ready()
    params = {"mode": body.mode, "message": body.message, "day": body.day.isoformat() if body.day else None}
    run, _ = enqueue(db, trip_id=trip.id, kind="itinerary_agent", trigger="manual", params=params)
    return run


def list_suggestions(
    db: Session, trip_id: int, statuses: list[str] | None = None
) -> list[ActivitySuggestion]:
    """A trip's suggestions, newest run first (a run's batches stay together), then by day and time."""
    stmt = (
        select(ActivitySuggestion)
        .outerjoin(Run, Run.id == ActivitySuggestion.run_id)
        .where(
            ActivitySuggestion.trip_id == trip_id, ActivitySuggestion.status.in_(statuses or ["new", "added"])
        )
        .order_by(
            func.coalesce(Run.queued_at, ActivitySuggestion.created_at).desc(),
            ActivitySuggestion.day.nulls_last(),
            ActivitySuggestion.start_time.nulls_last(),
            ActivitySuggestion.id,
        )
    )
    return list(db.scalars(stmt))


def get_suggestion(db: Session, suggestion_id: int) -> ActivitySuggestion:
    suggestion = db.get(ActivitySuggestion, suggestion_id)
    if suggestion is None:
        raise SuggestionNotFound(suggestion_id)
    return suggestion


def _in_itinerary(db: Session, suggestion: ActivitySuggestion) -> bool:
    """Added, and its activity is still there (deleting the activity lets it be added again)."""
    return (
        suggestion.status == "added"
        and suggestion.activity_id is not None
        and db.get(Activity, suggestion.activity_id) is not None
    )


def set_status(db: Session, suggestion_id: int, status: str) -> ActivitySuggestion:
    suggestion = get_suggestion(db, suggestion_id)
    if _in_itinerary(db, suggestion):
        raise AlreadyAdded("This is already in the itinerary. Delete it there to bring it back here.")
    suggestion.status = status
    suggestion.activity_id = None
    db.commit()
    return suggestion


def _notes(suggestion: ActivitySuggestion) -> str:
    lines = [f"Why: {suggestion.why}"] if suggestion.why else []
    if suggestion.timing_note:
        lines.append(f"Timing: {suggestion.timing_note}")
    if suggestion.sources:
        lines.append(f"Sources: {' '.join(suggestion.sources)}")
    parts = [suggestion.description, "\n".join(lines)]
    return "\n\n".join(p for p in parts if p)[:NOTES_LIMIT]


def add_to_itinerary(db: Session, suggestion_id: int, as_idea: bool = False) -> Activity:
    """Create the activity: planned at the suggested day and time, or an unscheduled idea."""
    suggestion = get_suggestion(db, suggestion_id)
    if _in_itinerary(db, suggestion):
        raise AlreadyAdded("This is already in the itinerary.")
    trip = db.get(Trip, suggestion.trip_id)
    assert trip is not None
    day = None if as_idea else suggestion.day
    start = suggestion.start_time if day else None
    activity = create_activity(
        db,
        trip,
        ActivityIn(
            title=suggestion.title,
            category=suggestion.category,
            day=day,
            start_time=start,
            end_time=end_of(start, suggestion.duration_min),
            location_name=suggestion.location_name,
            url=suggestion.url or (suggestion.sources[0] if suggestion.sources else None),
            notes=_notes(suggestion),
        ),
    )
    suggestion.status = "added"
    suggestion.activity_id = activity.id
    db.commit()
    return activity


# --- What may overlap ---------------------------------------------------------------------------


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def booked_by_day(db: Session, trip_id: int) -> dict[date, list[tuple[int, int, str]]]:
    """Each day's booked, timed plans as (start, end, label) in minutes. A plan that ends at or before it
    starts runs to midnight; one with no end time counts as an hour."""
    booked: dict[date, list[tuple[int, int, str]]] = {}
    rows = db.scalars(
        select(Activity).where(
            Activity.trip_id == trip_id, Activity.status == "booked", Activity.start_time.is_not(None)
        )
    )
    for a in rows:
        assert a.day is not None and a.start_time is not None
        start = _minutes(a.start_time)
        if a.end_time is None:
            end, span = min(start + UNTIMED_BOOKED_MIN, MINUTES_PER_DAY), f"{a.start_time:%H:%M}"
        else:
            end = _minutes(a.end_time) if a.end_time > a.start_time else MINUTES_PER_DAY
            span = f"{a.start_time:%H:%M}–{a.end_time:%H:%M}"
        booked.setdefault(a.day, []).append((start, end, f"{a.title} ({span})"))
    return booked


def clash(
    booked: dict[date, list[tuple[int, int, str]]], day: date, start: time, duration_min: int
) -> str | None:
    """The booked plan that a slot on `day` overlaps, or None. Touching ends don't overlap."""
    begin = _minutes(start)
    end = min(begin + duration_min, MINUTES_PER_DAY)
    for other_start, other_end, label in booked.get(day, []):
        if begin < other_end and other_start < end:
            return label
    return None


def existing_titles(db: Session, trip_id: int) -> set[str]:
    """Lowercased titles of everything the trip already has: suggestions of any status, and activities."""
    titles: list[Any] = [
        *db.scalars(select(ActivitySuggestion.title).where(ActivitySuggestion.trip_id == trip_id)),
        *db.scalars(select(Activity.title).where(Activity.trip_id == trip_id)),
    ]
    return {t.strip().casefold() for t in titles}
