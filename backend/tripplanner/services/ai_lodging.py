"""AI lodging picks: the one paid search the app runs for Claude, and the offers a run then ranks.

The app searches Google Hotels itself; the agent only researches and ranks what came back. It reads the
same offers again from the search's cache (never a second search), so a pick is always one the app found.
"""

from typing import Any

import httpx
from sqlalchemy.orm import Session

from tripplanner.models import LodgingOption, Run, Trip
from tripplanner.schemas.lodging import AskLodgingIn, RentalOffer, RentalSearchIn
from tripplanner.services import lodging, suggestions
from tripplanner.services.runs import enqueue

KIND = "lodging_agent"


def run_request(run: Run) -> tuple[RentalSearchIn, bool] | None:
    """The search a lodging run was asked to rank, and whether it was for vacation rentals (else hotels)."""
    params = run.params or {}
    try:
        search = RentalSearchIn(
            place=params.get("place"),
            check_in=params["check_in"],
            check_out=params["check_out"],
            adults=params.get("guests") or 2,
        )
    except (KeyError, ValueError):
        return None
    return search, params.get("kind") != "hotels"


def run_offers(db: Session, run: Run) -> list[RentalOffer]:
    """The offers the app found for a lodging run, from cache only. Empty once the cache has expired."""
    request = run_request(run)
    trip = db.get(Trip, run.trip_id)
    if request is None or trip is None:
        return []
    try:
        return lodging.cached_offers(db, trip, *request) or []
    except ValueError:  # no place given and the trip has no destination
        return []


def pick_of(option: LodgingOption) -> dict[str, Any]:
    """The offer number and rank an agent run saved this option under (empty for anything else)."""
    pick = (option.raw or {}).get("pick")
    return pick if isinstance(pick, dict) else {}


def ask_for_picks(
    db: Session, client: httpx.Client, api_key: str | None, trip: Trip, body: AskLodgingIn
) -> Run:
    """Search once, then queue a lodging run to rank the results. Checks come cheapest first, and
    the paid search only happens once nothing else can stop the run."""
    if trip.start_date is None or trip.end_date is None:
        raise suggestions.IdeasNotAllowed("Add the trip's dates first so places to stay can match them.")
    if not (trip.start_date <= body.check_in and body.check_out <= trip.end_date):
        raise suggestions.IdeasNotAllowed(
            f"Pick dates between {suggestions.short_date(trip.start_date)} and "
            f"{suggestions.short_date(trip.end_date)}, the trip's dates."
        )
    if suggestions.is_busy(db, trip.id, KIND):
        raise suggestions.IdeasBusy("Claude is still picking places to stay. Wait for it or stop it first.")
    suggestions.ensure_agent_ready()
    if not api_key:
        raise suggestions.IdeasUnavailable(
            "Add SERPAPI_API_KEY to .env so the app can search for places to stay."
        )
    place = body.place or lodging.trip_place(trip)
    search = RentalSearchIn(place=place, check_in=body.check_in, check_out=body.check_out, adults=body.guests)
    found = lodging.search_rentals(db, client, api_key, trip, search, vacation_rentals=body.kind == "rentals")
    if not found.offers:
        raise suggestions.IdeasNotAllowed(
            f"Nothing came back for {place} on those dates. Try a nearby town or other dates."
        )
    params = {
        "place": place,
        "check_in": body.check_in.isoformat(),
        "check_out": body.check_out.isoformat(),
        "guests": body.guests,
        "kind": body.kind,
        "message": body.message,
    }
    run, _ = enqueue(db, trip_id=trip.id, kind=KIND, trigger="manual", routine=None, params=params)
    return run
