"""The flight picked for a trip. Its departure and return become the trip's dates, and stay that way:
the dates change only by choosing another flight (or clearing the choice).

With several routes (say, each traveler flying from home), the trip runs from the first chosen
departure to the last return. A one-way flight that leaves after the first departure is the way
home; a single one-way flight sets only the start.
"""

from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from tripplanner.models import FlightQuote, FlightRoute, Trip
from tripplanner.schemas.trips import ChosenFlight, FlightDates

DATES_FROM_FLIGHT = (
    "The trip's dates come from the flight you chose. To change them, choose another flight on the "
    "Flights page, or clear your choice there."
)


class ChoiceError(ValueError):
    """The fare can't be the trip's flight (it's another route's, or it has already left)."""


class DatesFromFlight(ValueError):
    """A trip edit would move its dates away from the chosen flight's."""


def flight_dates(routes: Iterable[FlightRoute]) -> FlightDates | None:
    chosen = sorted(
        (r.chosen_quote for r in routes if r.chosen_quote is not None), key=lambda q: q.depart_date
    )
    if not chosen:
        return None
    start = chosen[0].depart_date
    ends = [q.return_date for q in chosen if q.return_date is not None]
    ends += [q.depart_date for q in chosen if q.return_date is None and q.depart_date > start]
    return FlightDates(
        start=start,
        end=max(ends) if ends else None,
        flights=[
            ChosenFlight(
                route_id=q.route_id,
                origin=q.origin,
                destination=q.destination,
                depart_date=q.depart_date,
                return_date=q.return_date,
                airlines=q.airlines,
            )
            for q in chosen
        ],
    )


def apply_dates(trip: Trip, dates: FlightDates) -> None:
    trip.start_date = dates.start
    if dates.end is not None:
        trip.end_date = dates.end
    elif trip.end_date is None or trip.end_date < dates.start:
        trip.end_date = dates.start


def check_dates(trip: Trip, start: date | None, end: date | None) -> None:
    """Refuse dates that differ from the chosen flights' (the end is free when no flight sets it)."""
    dates = flight_dates(trip.routes)
    if dates is None:
        return
    if start != dates.start or (dates.end is not None and end != dates.end):
        raise DatesFromFlight(DATES_FROM_FLIGHT)


def _trip(db: Session, trip_id: int) -> Trip:
    trip = db.scalar(
        select(Trip)
        .where(Trip.id == trip_id)
        .options(selectinload(Trip.routes).selectinload(FlightRoute.chosen_quote))
    )
    assert trip is not None
    return trip


def choose(db: Session, route: FlightRoute, quote_id: int, today: date) -> Trip:
    """Make a fare the trip's flight for this route, and move the trip's dates to match."""
    quote = db.get(FlightQuote, quote_id)
    if quote is None or quote.route_id != route.id:
        raise ChoiceError("That price isn't one of this route's. Refresh the page and try again.")
    if quote.depart_date < today:
        raise ChoiceError("That flight has already left. Choose one that departs today or later.")
    route.chosen_quote_id = quote.id
    return _sync(db, route.trip_id)


def clear(db: Session, route: FlightRoute) -> Trip:
    """Stop using this route's flight for the dates; they stay as they are, and become editable."""
    route.chosen_quote_id = None
    return _sync(db, route.trip_id)


def _sync(db: Session, trip_id: int) -> Trip:
    db.flush()
    db.expire_all()
    trip = _trip(db, trip_id)
    dates = flight_dates(trip.routes)
    if dates is not None:
        apply_dates(trip, dates)
    db.commit()
    return trip
