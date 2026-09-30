"""What an itinerary run works from: each day's place, weather, and fixed plans, the travelers'
interests, and what was already suggested.

Traveler names, trip notes, and activity notes never go in: the agent only needs the party size.
"""

import logging
from collections import defaultdict
from datetime import date, time
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tripplanner import __version__
from tripplanner.models import Activity, ActivitySuggestion, ItineraryDay, Run, Trip, TripDestination
from tripplanner.schemas.weather import DayWeather
from tripplanner.services import weather
from tripplanner.services.itinerary import day_destination, day_order, trip_dates

MAX_SUGGESTIONS = 80
EARLIER_REQUESTS = 5
DEFAULT_PARTY = 2

log = logging.getLogger(__name__)


def _party_size(trip: Trip) -> int:
    if trip.travelers:
        return len(trip.travelers)
    return max((r.adults + r.children for r in trip.routes), default=0) or DEFAULT_PARTY


def _weather_by_day(db: Session, trip: Trip, today: date) -> dict[date, DayWeather]:
    """Weather is a nice-to-have: without it the plan just has no weather."""
    try:
        with httpx.Client(timeout=5, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
            return {w.day: w for w in weather.trip_weather(db, client, trip, today)}
    except Exception:
        log.warning("Couldn't get weather for the plan of trip %s", trip.id, exc_info=True)
        return {}


def _weather_out(w: DayWeather | None) -> dict[str, Any] | None:
    if w is None:
        return None
    out: dict[str, Any] = {"kind": w.kind, "high_f": w.high_f, "low_f": w.low_f}
    if w.kind == "forecast":
        out["rain_chance"] = w.rain_chance
    else:
        out["wet_days_pct"] = w.wet_days_pct
    return out


def _place(destination: TripDestination | None) -> str | None:
    if destination is None:
        return None
    return f"{destination.name}, {destination.country}" if destination.country else destination.name


def _clock(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


def build_plan(db: Session, run: Run, today: date) -> dict[str, Any] | None:
    """The plan for an itinerary run; other kinds have none."""
    if run.kind != "itinerary_agent":
        return None
    trip = db.get(Trip, run.trip_id)
    assert trip is not None
    params = run.params or {}

    overrides = {
        row.day: row for row in db.scalars(select(ItineraryDay).where(ItineraryDay.trip_id == trip.id))
    }
    plans: dict[date, list[Activity]] = defaultdict(list)
    ideas = []
    for activity in db.scalars(select(Activity).where(Activity.trip_id == trip.id)):
        if activity.day is None:
            ideas.append(activity)
        else:
            plans[activity.day].append(activity)
    forecasts = _weather_by_day(db, trip, today)

    days = [
        {
            "date": day.isoformat(),
            "weekday": f"{day:%A}",
            "destination": _place(day_destination(trip, overrides.get(day))),
            "weather": _weather_out(forecasts.get(day)),
            "plans": [
                {
                    "title": a.title,
                    "start": _clock(a.start_time),
                    "end": _clock(a.end_time),
                    "category": a.category,
                    "status": a.status,
                }
                for a in sorted(plans.get(day, []), key=day_order)
            ],
        }
        for day in trip_dates(trip)
    ]

    suggestions = db.scalars(
        select(ActivitySuggestion)
        .where(ActivitySuggestion.trip_id == trip.id)
        .order_by(ActivitySuggestion.created_at.desc(), ActivitySuggestion.id.desc())
        .limit(MAX_SUGGESTIONS)
    )
    earlier = db.scalars(
        select(Run.params)
        .where(Run.trip_id == trip.id, Run.kind == "itinerary_agent", Run.id != run.id)
        .order_by(Run.queued_at.desc())
        .limit(EARLIER_REQUESTS)
    )
    return {
        "mode": params.get("mode") or "brainstorm",
        "request": params.get("message") or None,
        "focus_day": params.get("day") or None,
        "interests": list(trip.interests),
        "party_size": _party_size(trip),
        "days": days,
        "ideas": [a.title for a in sorted(ideas, key=lambda a: a.id)],
        "already_suggested": [
            {"title": s.title, "day": s.day.isoformat() if s.day else None, "status": s.status}
            for s in suggestions
        ],
        "earlier_requests": [message for p in earlier if (message := (p or {}).get("message"))],
    }
