"""Storing price observations and reading them back as best options, history, and date grids."""

import hashlib
import statistics
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import Date, cast, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session

from tripplanner.models import FlightQuote, FlightRoute, RoutePriceInsight
from tripplanner.services import fx

DUPLICATE_WINDOW = timedelta(hours=12)
SUSPECT_LOW, SUSPECT_HIGH = Decimal("0.35"), Decimal(4)
MIN_SAMPLES_FOR_SUSPECT = 5


@dataclass
class NewQuote:
    source: str
    confidence: str
    origin: str
    destination: str
    depart_date: date
    return_date: date | None
    price_total: Decimal
    currency: str
    passengers: int
    observed_at: datetime
    airlines: list[str]
    stops_out: int | None = None
    stops_back: int | None = None
    duration_out_min: int | None = None
    duration_back_min: int | None = None
    depart_at_local: str | None = None
    flight_numbers: list[str] | None = None
    booking_url: str | None = None
    source_url: str | None = None
    raw: dict[str, Any] | None = None


def dedupe_key(route_id: int, q: NewQuote) -> str:
    """Same fare, same flights: different departure times at the same price stay separate."""
    parts = [
        route_id,
        q.source,
        q.origin,
        q.destination,
        q.depart_date,
        q.return_date,
        q.depart_at_local,
        ",".join(sorted(q.airlines)),
        q.price_total.normalize(),
        q.currency,
    ]
    return hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:40]


def _recent_median_per_person(db: Session, route_id: int, now: datetime) -> Decimal | None:
    rows = db.scalars(
        select(FlightQuote.price_home / FlightQuote.passengers).where(
            FlightQuote.route_id == route_id,
            FlightQuote.price_home.is_not(None),
            FlightQuote.suspect.is_(False),
            FlightQuote.observed_at >= now - timedelta(days=30),
        )
    ).all()
    return Decimal(statistics.median(rows)) if len(rows) >= MIN_SAMPLES_FOR_SUSPECT else None


def add_quote(
    db: Session, route: FlightRoute, q: NewQuote, home_currency: str, run_id: UUID | None = None
) -> FlightQuote | None:
    """Store an observation; returns None if the same fare was already recorded recently."""
    key = dedupe_key(route.id, q)
    seen = db.scalar(
        select(FlightQuote.id).where(
            FlightQuote.dedupe_key == key, FlightQuote.observed_at >= q.observed_at - DUPLICATE_WINDOW
        )
    )
    if seen is not None:
        return None

    price_home = fx.convert(db, q.price_total, q.currency, home_currency)
    suspect = False
    if price_home is not None:
        median = _recent_median_per_person(db, route.id, q.observed_at)
        per_person = price_home / q.passengers
        suspect = median is not None and not (median * SUSPECT_LOW <= per_person <= median * SUSPECT_HIGH)

    quote = FlightQuote(
        route_id=route.id,
        trip_id=route.trip_id,
        run_id=run_id,
        source=q.source,
        confidence=q.confidence,
        origin=q.origin,
        destination=q.destination,
        depart_date=q.depart_date,
        return_date=q.return_date,
        price_total=q.price_total,
        currency=q.currency,
        price_home=price_home,
        home_currency=home_currency,
        passengers=q.passengers,
        airlines=q.airlines,
        stops_out=q.stops_out,
        stops_back=q.stops_back,
        duration_out_min=q.duration_out_min,
        duration_back_min=q.duration_back_min,
        depart_at_local=q.depart_at_local,
        flight_numbers=q.flight_numbers,
        booking_url=q.booking_url,
        source_url=q.source_url,
        source_domain=urlsplit(q.source_url).hostname if q.source_url else None,
        observed_at=q.observed_at,
        suspect=suspect,
        dedupe_key=key,
        raw=q.raw,
    )
    db.add(quote)
    db.flush()
    return quote


def _price():
    return func.coalesce(FlightQuote.price_home, FlightQuote.price_total)


def best_options(
    db: Session,
    trip_id: int,
    route_id: int | None = None,
    max_age: timedelta = timedelta(days=7),
    limit: int = 60,
    now: datetime | None = None,
) -> list[FlightQuote]:
    """The latest price for each distinct itinerary, cheapest first."""
    now = now or datetime.now(UTC)
    latest = (
        select(FlightQuote.id)
        .ext(
            distinct_on(
                FlightQuote.route_id,
                FlightQuote.source,
                FlightQuote.origin,
                FlightQuote.destination,
                FlightQuote.depart_date,
                FlightQuote.return_date,
                FlightQuote.airlines,
                FlightQuote.stops_out,
                FlightQuote.depart_at_local,
            )
        )
        .where(
            FlightQuote.trip_id == trip_id,
            FlightQuote.observed_at >= now - max_age,
            FlightQuote.hidden.is_(False),
            FlightQuote.depart_date >= now.date(),
        )
        .order_by(
            FlightQuote.route_id,
            FlightQuote.source,
            FlightQuote.origin,
            FlightQuote.destination,
            FlightQuote.depart_date,
            FlightQuote.return_date,
            FlightQuote.airlines,
            FlightQuote.stops_out,
            FlightQuote.depart_at_local,
            FlightQuote.observed_at.desc(),
        )
    )
    if route_id is not None:
        latest = latest.where(FlightQuote.route_id == route_id)
    stmt = (
        select(FlightQuote)
        .where(FlightQuote.id.in_(latest))
        .order_by(FlightQuote.suspect, _price(), FlightQuote.observed_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt))


def daily_lows(
    db: Session, route_id: int, days: int = 90, now: datetime | None = None
) -> list[tuple[date, str, Decimal]]:
    """Cheapest observed price per day and source (for the trend chart)."""
    now = now or datetime.now(UTC)
    day = cast(func.timezone("UTC", FlightQuote.observed_at), Date)
    stmt = (
        select(day, FlightQuote.source, func.min(_price()))
        .where(
            FlightQuote.route_id == route_id,
            FlightQuote.observed_at >= now - timedelta(days=days),
            FlightQuote.hidden.is_(False),
            FlightQuote.suspect.is_(False),
        )
        .group_by(day, FlightQuote.source)
        .order_by(day)
    )
    return [(d, s, p) for d, s, p in db.execute(stmt).all()]


def latest_insight(db: Session, route_id: int) -> RoutePriceInsight | None:
    """The newest Google insight that has a typical range or history to show."""
    return db.scalar(
        select(RoutePriceInsight)
        .where(RoutePriceInsight.route_id == route_id)
        .order_by(RoutePriceInsight.observed_at.desc())
        .limit(1)
    )


def date_grid(
    db: Session, route_id: int, max_age: timedelta = timedelta(days=7), now: datetime | None = None
) -> list[tuple[int, date, date | None, Decimal, str, datetime]]:
    """Cheapest recent price for each (departure, return) pair, with the fare it came from."""
    now = now or datetime.now(UTC)
    ranked = (
        select(
            FlightQuote.id,
            FlightQuote.depart_date,
            FlightQuote.return_date,
            _price().label("price"),
            FlightQuote.source,
            FlightQuote.observed_at,
            func.row_number()
            .over(
                partition_by=(FlightQuote.depart_date, FlightQuote.return_date),
                order_by=(_price(), FlightQuote.observed_at.desc()),
            )
            .label("rank"),
        )
        .where(
            FlightQuote.route_id == route_id,
            FlightQuote.observed_at >= now - max_age,
            FlightQuote.hidden.is_(False),
            FlightQuote.suspect.is_(False),
        )
        .subquery()
    )
    stmt = (
        select(
            ranked.c.id,
            ranked.c.depart_date,
            ranked.c.return_date,
            ranked.c.price,
            ranked.c.source,
            ranked.c.observed_at,
        )
        .where(ranked.c.rank == 1)
        .order_by(ranked.c.depart_date, ranked.c.return_date)
    )
    return list(db.execute(stmt).all())


def latest_same_flight(db: Session, quote: FlightQuote) -> FlightQuote | None:
    """The newest price for the same flight: same source, airports, dates, airlines, and stops."""
    return db.scalar(
        select(FlightQuote)
        .where(
            FlightQuote.route_id == quote.route_id,
            FlightQuote.source == quote.source,
            FlightQuote.origin == quote.origin,
            FlightQuote.destination == quote.destination,
            FlightQuote.depart_date == quote.depart_date,
            FlightQuote.return_date.is_not_distinct_from(quote.return_date),
            FlightQuote.airlines == quote.airlines,
            FlightQuote.stops_out.is_not_distinct_from(quote.stops_out),
            FlightQuote.hidden.is_(False),
        )
        .order_by(FlightQuote.observed_at.desc(), FlightQuote.id.desc())
        .limit(1)
    )


def last_live_checks(db: Session, route_id: int) -> dict[tuple[date, date | None], datetime]:
    stmt = (
        select(FlightQuote.depart_date, FlightQuote.return_date, func.max(FlightQuote.observed_at))
        .where(FlightQuote.route_id == route_id, FlightQuote.confidence == "live")
        .group_by(FlightQuote.depart_date, FlightQuote.return_date)
    )
    checks = {(d, r): t for d, r, t in db.execute(stmt).all()}
    insight_stmt = (
        select(
            RoutePriceInsight.depart_date,
            RoutePriceInsight.return_date,
            func.max(RoutePriceInsight.observed_at),
        )
        .where(RoutePriceInsight.route_id == route_id)
        .group_by(RoutePriceInsight.depart_date, RoutePriceInsight.return_date)
    )
    # A search that found no flights still counts as checked (it leaves an insight row).
    for d, r, t in db.execute(insight_stmt).all():
        checks[(d, r)] = max(t, checks.get((d, r), t))
    return checks


def best_live_pair(db: Session, route_id: int, now: datetime) -> tuple[date, date | None] | None:
    row = db.execute(
        select(FlightQuote.depart_date, FlightQuote.return_date)
        .where(
            FlightQuote.route_id == route_id,
            FlightQuote.confidence == "live",
            FlightQuote.suspect.is_(False),
            FlightQuote.hidden.is_(False),
            FlightQuote.observed_at >= now - timedelta(days=3),
            FlightQuote.depart_date >= now.date(),
        )
        .order_by(_price())
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None
