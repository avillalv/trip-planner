"""The presentation deck's data: the trip's plans gathered into one payload."""

from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tripplanner.models import Activity, FlightQuote, Trip, TripDestination
from tripplanner.schemas.flights import QuoteOut, RouteOut
from tripplanner.schemas.lodging import LodgingOut
from tripplanner.schemas.presentation import (
    DeckActivity,
    DeckDay,
    DeckDestination,
    DeckRoute,
    Presentation,
    TrendPoint,
)
from tripplanner.schemas.trips import DestinationOut
from tripplanner.services import fx, itinerary, lodging, quotes
from tripplanner.services import routes as route_service
from tripplanner.services import trips as trip_service

TREND_DAYS = 60
OPTIONS_PER_ROUTE = 3
LODGING_ORDER = {"booked": 0, "shortlisted": 1, "candidate": 2, "rejected": 3}


def build(db: Session, trip: Trip, now: datetime | None = None) -> Presentation:
    now = now or datetime.now(UTC)
    ideas = select(func.count()).where(Activity.trip_id == trip.id, Activity.day.is_(None))
    return Presentation(
        trip=trip_service.to_out(trip),
        destinations=[_destination(db, d, trip.home_currency) for d in trip.destinations],
        routes=_routes(db, trip, now),
        lodging=_lodging(db, trip),
        days=_days(db, trip),
        idea_count=db.scalar(ideas) or 0,
        generated_at=now,
    )


def _destination(db: Session, destination: TripDestination, home_currency: str) -> DeckDestination:
    currency = fx.local_currency(destination.country_code)
    rate = fx.rate(db, home_currency, currency) if currency and currency != home_currency else None
    return DeckDestination(
        **DestinationOut.model_validate(destination).model_dump(), currency=currency, rate=rate
    )


def _flight(q: FlightQuote) -> tuple[object, ...]:
    return (q.origin, q.destination, q.depart_date, q.return_date, tuple(q.airlines), q.stops_out)


def _routes(db: Session, trip: Trip, now: datetime) -> list[DeckRoute]:
    """Routes with current fares: the cheapest few, and how the lowest price has moved."""
    deck = []
    for route in route_service.list_routes(db, trip.id):
        chosen = route.chosen_quote
        chosen_now = (quotes.latest_same_flight(db, chosen) or chosen) if chosen else None
        fares = []
        # The chosen flight is shown on its own, so it isn't repeated among the options.
        seen: set[tuple[object, ...]] = {_flight(chosen_now)} if chosen_now else set()
        # Cheapest first, so each flight keeps its lowest price when several sources list it.
        for q in quotes.best_options(db, trip.id, route.id, limit=24, now=now):
            if q.suspect or _flight(q) in seen:
                continue
            seen.add(_flight(q))
            fares.append(q)
        if not fares and chosen_now is None:
            continue
        lows: dict[date, Decimal] = {}
        for day, _source, price in quotes.daily_lows(db, route.id, TREND_DAYS, now):
            lows[day] = min(price, lows.get(day, price))
        insight = quotes.latest_insight(db, route.id)
        # Google's typical range is only comparable in the trip's own currency.
        comparable = insight is not None and insight.currency == trip.home_currency
        deck.append(
            DeckRoute(
                route=RouteOut.model_validate(route),
                options=[QuoteOut.model_validate(q) for q in fares[:OPTIONS_PER_ROUTE]],
                trend=[TrendPoint(day=d, price=p) for d, p in sorted(lows.items())],
                typical_low=insight.typical_low if comparable and insight else None,
                typical_high=insight.typical_high if comparable and insight else None,
                price_level=insight.price_level if insight else None,
                chosen=QuoteOut.model_validate(chosen_now) if chosen_now else None,
            )
        )
    return deck


def _lodging(db: Session, trip: Trip) -> list[LodgingOut]:
    """The shortlist, best first; every option still in the running if nothing is shortlisted."""
    considered = [o for o in lodging.list_options(db, trip) if o.status != "rejected"]
    shortlist = [o for o in considered if o.status in ("booked", "shortlisted") or o.favorite]
    return sorted(
        shortlist or considered,
        key=lambda o: (
            LODGING_ORDER[o.status],
            not o.favorite,
            -len(o.hearts),
            o.price_home_total is None,
            o.price_home_total or 0,
        ),
    )


def _days(db: Session, trip: Trip) -> list[DeckDay]:
    """Days with something on them: plans, a title, or notes."""
    by_day: dict[date, list[Activity]] = defaultdict(list)
    for activity in itinerary.list_activities(db, trip.id):
        if activity.day is not None:
            by_day[activity.day].append(activity)
    deck = []
    for day in itinerary.list_days(db, trip):
        plans = sorted(by_day.get(day.day, []), key=itinerary.day_order)
        if not (plans or day.title or day.notes):
            continue
        deck.append(
            DeckDay(
                day=day.day,
                title=day.title,
                notes=day.notes,
                destination_name=day.destination_name,
                timezone=day.timezone,
                in_trip=day.in_trip,
                activities=[DeckActivity.model_validate(a) for a in plans],
            )
        )
    return deck
