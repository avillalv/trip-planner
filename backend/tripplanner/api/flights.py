from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from tripplanner.api.deps import DbSession
from tripplanner.models import FlightQuote, Trip
from tripplanner.schemas.automation import RefreshRequest, RunOut
from tripplanner.schemas.flights import (
    BookedFlightIn,
    DateGridCell,
    FlightChoiceIn,
    GoogleHistoryPoint,
    HistoryPoint,
    QuoteOut,
    QuoteUpdate,
    RouteHistory,
    RouteIn,
    RouteOut,
    RouteSummary,
)
from tripplanner.schemas.trips import TripOut
from tripplanner.services import booked_flight, flight_choice, quotes
from tripplanner.services import routes as route_service
from tripplanner.services import trips as trip_service
from tripplanner.services.routines import ensure_flight_routine
from tripplanner.services.runs import enqueue

router = APIRouter(prefix="/api/v1", tags=["flights"])


def _trip(db: DbSession, trip_id: int) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    return trip


def _route(db: DbSession, route_id: int):
    try:
        return route_service.get_route(db, route_id)
    except route_service.RouteNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Route not found.") from exc


def _queue_refresh(db: DbSession, trip: Trip, route_ids: list[int]) -> RunOut:
    routine = ensure_flight_routine(db, trip)
    run, _created = enqueue(
        db,
        trip_id=trip.id,
        kind="flight_api",
        trigger="manual",
        routine=routine,
        params={"route_ids": route_ids},
    )
    return RunOut.model_validate(run)


@router.get("/trips/{trip_id}/routes", response_model=list[RouteOut])
def list_routes(trip_id: int, db: DbSession) -> list[RouteOut]:
    _trip(db, trip_id)
    return [RouteOut.model_validate(r) for r in route_service.list_routes(db, trip_id)]


@router.post("/trips/{trip_id}/routes", response_model=RouteOut, status_code=status.HTTP_201_CREATED)
def create_route(trip_id: int, body: RouteIn, db: DbSession) -> RouteOut:
    trip = _trip(db, trip_id)
    try:
        route = route_service.create_route(db, trip, body)
    except route_service.UnknownAirport as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    if route.active:
        _queue_refresh(db, trip, [route.id])  # check prices right away
    return RouteOut.model_validate(route)


@router.put("/routes/{route_id}", response_model=RouteOut)
def update_route(route_id: int, body: RouteIn, db: DbSession) -> RouteOut:
    _route(db, route_id)
    try:
        return RouteOut.model_validate(route_service.update_route(db, route_id, body))
    except route_service.UnknownAirport as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(route_id: int, db: DbSession) -> None:
    _route(db, route_id)
    route_service.delete_route(db, route_id)


@router.post("/trips/{trip_id}/flights/refresh", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def refresh_prices(trip_id: int, body: RefreshRequest, db: DbSession) -> RunOut:
    """Check prices now (all routes, or the ones listed)."""
    return _queue_refresh(db, _trip(db, trip_id), body.route_ids)


@router.get("/trips/{trip_id}/flights/best", response_model=list[QuoteOut])
def best_options(
    trip_id: int,
    db: DbSession,
    route_id: int | None = None,
    max_age_days: int = Query(7, ge=1, le=60),
    limit: int = Query(60, ge=1, le=300),
) -> list[QuoteOut]:
    """Latest price per itinerary, cheapest first."""
    _trip(db, trip_id)
    rows = quotes.best_options(db, trip_id, route_id, timedelta(days=max_age_days), limit)
    return [QuoteOut.model_validate(q) for q in rows]


@router.get("/trips/{trip_id}/flights/summary", response_model=list[RouteSummary])
def route_summaries(trip_id: int, db: DbSession) -> list[RouteSummary]:
    _trip(db, trip_id)
    summaries = []
    for route in route_service.list_routes(db, trip_id):
        cheapest = quotes.best_options(db, trip_id, route.id, limit=1)
        last_checked, count = db.execute(
            select(func.max(FlightQuote.created_at), func.count()).where(FlightQuote.route_id == route.id)
        ).one()
        chosen = route.chosen_quote
        latest = quotes.latest_same_flight(db, chosen) if chosen else None
        summaries.append(
            RouteSummary(
                route_id=route.id,
                cheapest=QuoteOut.model_validate(cheapest[0]) if cheapest else None,
                last_checked_at=last_checked,
                quote_count=count,
                chosen=QuoteOut.model_validate(chosen) if chosen else None,
                chosen_latest=QuoteOut.model_validate(latest) if latest else None,
            )
        )
    return summaries


@router.get("/routes/{route_id}/history", response_model=RouteHistory)
def route_history(route_id: int, db: DbSession, days: int = Query(90, ge=7, le=365)) -> RouteHistory:
    route = _route(db, route_id)
    trip = _trip(db, route.trip_id)
    insight = quotes.latest_insight(db, route_id)
    google = []
    if insight is not None and insight.currency == trip.home_currency:
        google = [
            GoogleHistoryPoint(at=datetime.fromtimestamp(ts, UTC), price=price)
            for ts, price in insight.history
        ]
    return RouteHistory(
        currency=trip.home_currency,
        points=[HistoryPoint(day=d, source=s, price=p) for d, s, p in quotes.daily_lows(db, route_id, days)],
        google=google,
        typical_low=insight.typical_low if insight else None,
        typical_high=insight.typical_high if insight else None,
        price_level=insight.price_level if insight else None,
    )


@router.get("/routes/{route_id}/date-grid", response_model=list[DateGridCell])
def date_grid(route_id: int, db: DbSession, max_age_days: int = Query(7, ge=1, le=60)) -> list[DateGridCell]:
    _route(db, route_id)
    rows = quotes.date_grid(db, route_id, timedelta(days=max_age_days))
    return [
        DateGridCell(quote_id=q, depart_date=d, return_date=r, price=p, source=s, observed_at=o)
        for q, d, r, p, s, o in rows
    ]


@router.put("/routes/{route_id}/choice", response_model=TripOut)
def choose_flight(route_id: int, body: FlightChoiceIn, db: DbSession) -> TripOut:
    """Make a fare the trip's flight: the trip's dates move to its departure and return."""
    route = _route(db, route_id)
    try:
        trip = flight_choice.choose(db, route, body.quote_id, today=datetime.now(UTC).date())
    except flight_choice.ChoiceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return trip_service.to_out(trip_service.get_trip(db, trip.id))


@router.post("/routes/{route_id}/booked-flight", response_model=TripOut)
def record_booked_flight(route_id: int, body: BookedFlightIn, db: DbSession) -> TripOut:
    """Record the flight you booked, leg by leg: it becomes the trip's flight and joins the itinerary."""
    route = _route(db, route_id)
    try:
        trip = booked_flight.record(db, route, body, today=datetime.now(UTC).date())
    except (route_service.UnknownAirport, flight_choice.ChoiceError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return trip_service.to_out(trip_service.get_trip(db, trip.id))


@router.delete("/routes/{route_id}/choice", response_model=TripOut)
def clear_flight(route_id: int, db: DbSession) -> TripOut:
    """Stop using this route's flight for the trip's dates (they stay as they are, now editable)."""
    trip = flight_choice.clear(db, _route(db, route_id))
    return trip_service.to_out(trip_service.get_trip(db, trip.id))


@router.patch("/flight-quotes/{quote_id}", response_model=QuoteOut)
def update_quote(quote_id: int, body: QuoteUpdate, db: DbSession) -> QuoteOut:
    """Hide a fare, or confirm one flagged as suspect."""
    quote = db.get(FlightQuote, quote_id)
    if quote is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Price not found.")
    if body.hidden is not None:
        quote.hidden = body.hidden
    if body.suspect is not None:
        quote.suspect = body.suspect
    db.commit()
    return QuoteOut.model_validate(quote)
