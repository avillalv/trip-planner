"""A flight the travelers already booked: the route's one manual fare, with its legs in the itinerary."""

from datetime import UTC, date, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tripplanner.models import Activity, Airport, FlightQuote, FlightRoute, Trip
from tripplanner.schemas.flights import BookedFlightIn, FlightSegment
from tripplanner.services import flight_choice
from tripplanner.services.flight_choice import ChoiceError
from tripplanner.services.quotes import NewQuote, add_quote
from tripplanner.services.routes import check_airports

MINUTES = "%Y-%m-%dT%H:%M"


def _clock(when: datetime) -> str:
    return when.strftime("%I:%M %p").lstrip("0")


def _arrival_note(airline: str, leg: FlightSegment) -> str:
    arrives = _clock(leg.arrive_at)
    if leg.arrive_at.date() != leg.depart_at.date():
        arrives = f"{leg.arrive_at:%b} {leg.arrive_at.day}, {arrives}"
    return f"{airline}. Arrives {arrives} local time at {leg.destination}."


def record(db: Session, route: FlightRoute, body: BookedFlightIn, today: date) -> Trip:
    """Make this the route's booked flight, replacing any earlier one, and the trip's flight.

    The trip's dates follow it (out to the first return flight) and lock, price checks for the route
    stop, and each leg becomes a booked travel activity. The fare is hidden so it never shows up as an
    option to compare. Raises UnknownAirport for a code we don't know, and ChoiceError if the first
    flight has already left. Nothing is saved unless everything is.
    """
    out = [s for s in body.segments if s.direction == "out"]
    back = [s for s in body.segments if s.direction == "back"]
    legs = out + back
    codes = sorted({code for s in legs for code in (s.origin, s.destination)})
    check_airports(db, codes)
    names = dict(db.execute(select(Airport.iata, Airport.name).where(Airport.iata.in_(codes))).all())
    trip = db.get(Trip, route.trip_id)
    assert trip is not None

    try:
        db.execute(
            delete(FlightQuote).where(FlightQuote.route_id == route.id, FlightQuote.source == "manual")
        )
        quote = add_quote(
            db,
            route,
            NewQuote(
                source="manual",
                confidence="indicative",
                origin=out[0].origin,
                destination=out[-1].destination,
                depart_date=out[0].depart_at.date(),
                return_date=back[0].depart_at.date() if back else None,
                price_total=body.price_per_person * body.passengers,
                currency=body.currency,
                passengers=body.passengers,
                observed_at=datetime.now(UTC),
                airlines=[body.airline],
                stops_out=len(out) - 1,
                stops_back=len(back) - 1 if back else None,
                depart_at_local=out[0].depart_at.strftime("%Y-%m-%d %H:%M"),
                flight_numbers=[s.flight_number for s in legs],
                raw={"booked": True},
            ),
            trip.home_currency,
        )
        if quote is None:
            raise ChoiceError("This flight was already recorded a moment ago. Refresh the page.")
        quote.hidden = True
        quote.suspect = False
        quote.segments = [
            {
                "direction": s.direction,
                "flight_number": s.flight_number,
                "origin": s.origin,
                "destination": s.destination,
                "depart_at": s.depart_at.strftime(MINUTES),
                "arrive_at": s.arrive_at.strftime(MINUTES),
            }
            for s in legs
        ]
        for s in legs:
            db.add(
                Activity(
                    trip_id=route.trip_id,
                    day=s.depart_at.date(),
                    start_time=s.depart_at.time(),
                    end_time=None if s.arrive_at.time() == s.depart_at.time() else s.arrive_at.time(),
                    title=f"{s.flight_number} · {s.origin} → {s.destination}",
                    category="travel",
                    status="booked",
                    location_name=names[s.origin],
                    notes=_arrival_note(body.airline, s),
                    flight_quote_id=quote.id,
                )
            )
        route.active = False
        # Commits everything staged above, or raises before anything is saved.
        return flight_choice.choose(db, route, quote.id, today)
    except Exception:
        db.rollback()
        raise
