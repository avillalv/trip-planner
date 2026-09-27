"""The `flight_api` run: scan cached fares, then spend the live-search budget where it matters."""

import logging
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
from sqlalchemy.orm import Session

from tripplanner.config import Settings
from tripplanner.models import ApiCall, FlightRoute, RoutePriceInsight, Routine, Run, Trip
from tripplanner.providers import ProviderError, serpapi, travelpayouts
from tripplanner.services import fx, serpapi_budget
from tripplanner.services.quotes import NewQuote, add_quote, best_live_pair, last_live_checks
from tripplanner.services.routes import list_routes
from tripplanner.services.routines import runs_per_day
from tripplanner.services.runs import RunLog, cancel_requested
from tripplanner.services.search_planner import DatePair, PlannerInput, date_pairs, pick_live_searches

MAX_LIVE_PER_ROUTE = 10
MAX_LIVE_PER_RUN = 20
OFFERS_PER_SEARCH = 5

log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


def route_label(route: FlightRoute) -> str:
    return f"{', '.join(route.origin_codes)} → {', '.join(route.destination_codes)}"


def pair_label(pair: DatePair) -> str:
    depart, ret = pair
    text = depart.strftime("%b %d").replace(" 0", " ")
    return f"{text} – {ret.strftime('%b %d').replace(' 0', ' ')}" if ret else text


def money(amount: Decimal, currency: str) -> str:
    return f"{currency} {amount:,.0f}"


@dataclass
class JobContext:
    db: Session
    run: Run
    trip: Trip
    log: RunLog
    http: httpx.Client
    settings: Settings
    now: datetime

    def check_cancel(self) -> None:
        if cancel_requested(self.db, self.run.id):
            raise Cancelled

    def record_call(self, provider: str, endpoint: str, ok: bool, status_code: int | None = None) -> None:
        self.db.add(
            ApiCall(provider=provider, endpoint=endpoint, run_id=self.run.id, ok=ok, status_code=status_code)
        )
        self.db.commit()


def _split_budget(total: int, routes: list[FlightRoute]) -> dict[int, int]:
    live_routes = [r for r in routes if "serpapi" in r.sources]
    shares = dict.fromkeys((r.id for r in routes), 0)
    for i in range(total):
        if not live_routes:
            break
        route = live_routes[i % len(live_routes)]
        if shares[route.id] < MAX_LIVE_PER_ROUTE:
            shares[route.id] += 1
    return shares


def _within_stops(route: FlightRoute, fare: travelpayouts.CachedFare) -> bool:
    if route.max_stops is None:
        return True
    return (fare.stops_out or 0) <= route.max_stops and (fare.stops_back or 0) <= route.max_stops


def scan_cached_fares(ctx: JobContext, route: FlightRoute, pairs: list[DatePair]) -> dict[DatePair, Decimal]:
    """Store matching Aviasales cached fares; returns the cheapest per date pair (home currency)."""
    token = ctx.settings.travelpayouts_token
    if token is None or "travelpayouts" not in route.sources:
        return {}
    if route.cabin != "economy":
        ctx.log.info(f"{route_label(route)}: skipping cached fares (they're economy only).")
        return {}

    wanted = set(pairs)
    months = sorted({(d.strftime("%Y-%m"), r.strftime("%Y-%m") if r else None) for d, r in pairs})
    passengers = route.adults + route.children
    cheapest: dict[DatePair, Decimal] = {}
    stored = 0
    for origin in route.origin_codes:
        for destination in route.destination_codes:
            for depart_month, return_month in months:
                ctx.check_cancel()
                try:
                    fares = travelpayouts.prices_for_dates(
                        ctx.http,
                        token.get_secret_value(),
                        origin=origin,
                        destination=destination,
                        departure_month=depart_month,
                        return_month=return_month,
                        currency=ctx.trip.home_currency,
                        direct_only=route.max_stops == 0,
                    )
                    ctx.record_call("travelpayouts", "prices_for_dates", ok=True)
                except ProviderError as exc:
                    ctx.record_call("travelpayouts", "prices_for_dates", ok=False)
                    ctx.log.warning(f"{origin} → {destination} ({depart_month}): {exc}")
                    continue
                for fare in fares:
                    pair = (fare.depart_date, fare.return_date)
                    if pair not in wanted or not _within_stops(route, fare):
                        continue
                    quote = add_quote(
                        ctx.db,
                        route,
                        NewQuote(
                            source="travelpayouts",
                            confidence="cached",
                            origin=fare.origin or origin,
                            destination=fare.destination or destination,
                            depart_date=fare.depart_date,
                            return_date=fare.return_date,
                            # Cached fares are per adult; scale to the party (children may cost less).
                            price_total=fare.price_per_adult * passengers,
                            currency=fare.currency,
                            passengers=passengers,
                            observed_at=fare.found_at or ctx.now,
                            airlines=[fare.airline] if fare.airline else [],
                            stops_out=fare.stops_out,
                            stops_back=fare.stops_back,
                            duration_out_min=fare.duration_out_min,
                            duration_back_min=fare.duration_back_min,
                            depart_at_local=fare.depart_at_local,
                            flight_numbers=[fare.flight_number] if fare.flight_number else None,
                            booking_url=fare.link,
                            source_url=fare.link,
                            raw={"price_per_adult": str(fare.price_per_adult), **fare.raw},
                        ),
                        ctx.trip.home_currency,
                        run_id=ctx.run.id,
                    )
                    if quote is not None:
                        stored += 1
                        price = quote.price_home or quote.price_total
                        cheapest[pair] = min(price, cheapest.get(pair, price))
    ctx.db.commit()
    ctx.run.accepted_count += stored
    if cheapest:
        low = money(min(cheapest.values()), ctx.trip.home_currency)
        ctx.log.info(f"{route_label(route)}: {stored} new cached fares from Aviasales; cheapest {low}.")
    else:
        ctx.log.info(f"{route_label(route)}: no cached fares for these dates yet.")
    return cheapest


def live_search(ctx: JobContext, route: FlightRoute, pair: DatePair) -> bool:
    """One Google Flights search for a date pair. Returns False if the search failed."""
    key = ctx.settings.serpapi_api_key
    assert key is not None
    depart, ret = pair
    try:
        result = serpapi.search_flights(
            ctx.http,
            key.get_secret_value(),
            origins=route.origin_codes,
            destinations=route.destination_codes,
            depart_date=depart,
            return_date=ret,
            adults=route.adults,
            children=route.children,
            cabin=route.cabin,
            max_stops=route.max_stops,
            currency=ctx.trip.home_currency,
        )
    except ProviderError as exc:
        ctx.record_call("serpapi", "google_flights", ok=False)
        ctx.log.error(f"{route_label(route)} · {pair_label(pair)}: {exc}")
        return False
    ctx.record_call("serpapi", "google_flights", ok=True)

    passengers = route.adults + route.children
    stored = 0
    for offer in result.offers[:OFFERS_PER_SEARCH]:
        quote = add_quote(
            ctx.db,
            route,
            NewQuote(
                source="serpapi",
                confidence="live",
                origin=offer.origin,
                destination=offer.destination,
                depart_date=depart,
                return_date=ret,
                price_total=offer.price_total,
                currency=ctx.trip.home_currency,
                passengers=passengers,
                observed_at=ctx.now,
                airlines=offer.airlines,
                stops_out=offer.stops_out,
                duration_out_min=offer.duration_out_min,
                depart_at_local=offer.depart_at_local,
                flight_numbers=offer.flight_numbers,
                booking_url=result.google_flights_url,
                source_url=result.google_flights_url,
                raw=offer.raw,
            ),
            ctx.trip.home_currency,
            run_id=ctx.run.id,
        )
        stored += quote is not None
    insights = result.insights
    # Always record the check (even with no flights) so the planner knows this pair was searched.
    ctx.db.add(
        RoutePriceInsight(
            route_id=route.id,
            run_id=ctx.run.id,
            depart_date=depart,
            return_date=ret,
            observed_at=ctx.now,
            currency=ctx.trip.home_currency,
            lowest_price=insights.lowest_price if insights else None,
            price_level=insights.price_level if insights else None,
            typical_low=insights.typical_low if insights else None,
            typical_high=insights.typical_high if insights else None,
            history=insights.history if insights else [],
        )
    )
    ctx.db.commit()
    ctx.run.accepted_count += stored

    if result.offers:
        best = result.offers[0]
        stops = (
            "nonstop" if best.stops_out == 0 else f"{best.stops_out} stop{'s' if best.stops_out > 1 else ''}"
        )
        level = f" · Google rates this {insights.price_level}" if insights and insights.price_level else ""
        price = money(best.price_total, ctx.trip.home_currency)
        airlines = ", ".join(best.airlines) or "unknown airline"
        ctx.log.info(f"{route_label(route)} · {pair_label(pair)}: from {price} ({airlines}, {stops}){level}.")
    else:
        ctx.log.info(f"{route_label(route)} · {pair_label(pair)}: no flights found.")
    return True


def _chosen_pair(route: FlightRoute, today: date) -> DatePair | None:
    chosen = route.chosen_quote
    if chosen is None or chosen.depart_date < today:
        return None
    return (chosen.depart_date, chosen.return_date)


def run_flight_prices(ctx: JobContext) -> tuple[str, str]:
    """Returns (status, summary)."""
    requested = set(ctx.run.params.get("route_ids") or [])
    routes = [
        r for r in list_routes(ctx.db, ctx.trip.id) if r.active and (not requested or r.id in requested)
    ]
    if not routes:
        return "succeeded", "No active routes to check."

    if not fx.refresh_rates(ctx.db, ctx.http, ctx.now):
        ctx.log.warning("Exchange rates are unavailable; prices in other currencies won't be converted.")

    budget = 0
    key = ctx.settings.serpapi_api_key
    if key is None:
        ctx.log.info("SERPAPI_API_KEY isn't set, so live Google Flights searches are skipped.")
    elif any("serpapi" in r.sources for r in routes):
        serpapi_budget.sync_account(ctx.db, ctx.http, key.get_secret_value(), ctx.now)
        routine = ctx.db.get(Routine, ctx.run.routine_id) if ctx.run.routine_id else None
        day_start = datetime(ctx.now.year, ctx.now.month, ctx.now.day, tzinfo=UTC)
        per_day = runs_per_day(routine, day_start) if routine else 2
        budget = min(MAX_LIVE_PER_RUN, serpapi_budget.run_allowance(ctx.db, per_day, ctx.now))
        if budget == 0:
            ctx.log.info("Today's share of the SerpApi quota is used up; using cached fares only.")
        else:
            ctx.log.info(
                f"Up to {budget} live Google Flights searches this run (from the monthly SerpApi quota)."
            )
    shares = _split_budget(budget, routes)

    stats: Counter[str] = Counter()
    today = ctx.now.date()
    for route in routes:
        ctx.check_cancel()
        pairs = date_pairs(route, today)
        if not pairs:
            ctx.log.warning(
                f"{route_label(route)}: the departure window has passed. Edit the route to move it."
            )
            continue
        cached = scan_cached_fares(ctx, route, pairs)
        if shares[route.id] == 0:
            continue
        plan = PlannerInput(
            pairs=pairs,
            cached_prices=cached,
            last_live_check=last_live_checks(ctx.db, route.id),
            best_live_pair=best_live_pair(ctx.db, route.id, ctx.now),
            chosen_pair=_chosen_pair(route, today),
        )
        for pair in pick_live_searches(plan, shares[route.id], ctx.now):
            ctx.check_cancel()
            stats["searches"] += 1
            if not live_search(ctx, route, pair):
                stats["errors"] += 1

    ctx.db.commit()
    stored = ctx.run.accepted_count
    summary = f"Checked {len(routes)} route{'s' if len(routes) != 1 else ''}: {stored} new prices"
    if stats["searches"]:
        summary += f", {stats['searches']} live search{'es' if stats['searches'] != 1 else ''}"
    summary += "."
    if stats["errors"] == 0:
        return "succeeded", summary
    if stats["errors"] < stats["searches"] or stored:
        return "partial", summary + f" {stats['errors']} search{'es' if stats['errors'] != 1 else ''} failed."
    return "failed", summary + " Every live search failed; check SERPAPI_API_KEY."
