import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tests.conftest import make_settings
from tests.factories import add_route, add_trip
from tripplanner.models import ApiCall, AppSetting, FlightQuote, RoutePriceInsight, Routine, RunEvent
from tripplanner.providers import frankfurter, serpapi, travelpayouts
from tripplanner.services.runs import RunLog, enqueue
from tripplanner.worker.jobs.flight_prices import Cancelled, JobContext, run_flight_prices

NOW = datetime(2026, 9, 26, 12, tzinfo=UTC)
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "serpapi_google_flights_roundtrip.json").read_text("utf-8")
)
OFFERS_IN_FIXTURE = len(FIXTURE["best_flights"]) + len(FIXTURE["other_flights"])

CACHED_ROW = {
    "origin": "LAX",
    "destination": "TYO",
    "origin_airport": "LAX",
    "destination_airport": "NRT",
    "departure_at": "2026-11-06T10:00:00-08:00",
    "return_at": "2026-11-13T12:00:00+09:00",
    "price": 700,
    "airline": "ZG",
    "flight_number": "23",
    "transfers": 0,
    "return_transfers": 0,
    "link": "/search/LAX0611TYO13111?search_date=24092026",
}
OUTSIDE_WINDOW = {
    **CACHED_ROW,
    "departure_at": "2026-11-20T10:00:00-08:00",
    "return_at": "2026-11-27T10:00:00+09:00",
}


@dataclass
class Apis:
    cached: respx.Route
    account: respx.Route
    search: respx.Route


@pytest.fixture
def apis(no_real_network: respx.MockRouter) -> Apis:
    no_real_network.get(frankfurter.RATES_URL).mock(
        return_value=httpx.Response(
            200, json=[{"date": "2026-09-26", "base": "EUR", "quote": "USD", "rate": 1.1}]
        )
    )
    return Apis(
        cached=no_real_network.get(f"{travelpayouts.BASE_URL}/prices_for_dates").mock(
            return_value=httpx.Response(
                200, json={"success": True, "currency": "usd", "data": [CACHED_ROW, OUTSIDE_WINDOW]}
            )
        ),
        account=no_real_network.get(serpapi.ACCOUNT_URL).mock(
            return_value=httpx.Response(200, json={"plan_searches_left": 200})
        ),
        search=no_real_network.get(serpapi.SEARCH_URL).mock(return_value=httpx.Response(200, json=FIXTURE)),
    )


def context(db: Session, **setting_overrides: object) -> JobContext:
    trip = add_trip(db)
    route = add_route(db, trip)
    routine = Routine(
        trip_id=trip.id,
        name="Flight prices",
        kind="flight_api",
        schedule_cron="0 8,20 * * *",
        timezone="UTC",
        config={},
    )
    db.add(routine)
    db.flush()
    run, _ = enqueue(
        db,
        trip_id=trip.id,
        kind="flight_api",
        trigger="manual",
        routine=routine,
        params={"route_ids": [route.id]},
    )
    settings = make_settings(
        **{"serpapi_api_key": "serp-key", "travelpayouts_token": "tp-token", **setting_overrides}
    )
    return JobContext(db, run, trip, RunLog(db, run), httpx.Client(), settings, NOW)


def count(db: Session, model, *where) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where))


def log_text(db: Session, ctx: JobContext) -> str:
    return "\n".join(db.scalars(select(RunEvent.summary).where(RunEvent.run_id == ctx.run.id)))


def test_full_run_stores_cached_and_live_prices(db_session: Session, apis: Apis) -> None:
    ctx = context(db_session)

    status, summary = run_flight_prices(ctx)

    live = 6 * OFFERS_IN_FIXTURE  # every date pair in the window, each with the fixture's itineraries
    assert status == "succeeded"
    assert count(db_session, FlightQuote, FlightQuote.source == "travelpayouts") == 1
    assert count(db_session, FlightQuote, FlightQuote.source == "serpapi") == live
    assert count(db_session, RoutePriceInsight) == 6
    assert count(db_session, ApiCall, ApiCall.endpoint == "google_flights") == 6
    assert ctx.run.accepted_count == live + 1
    assert summary == f"Checked 1 route: {live + 1} new prices, 6 live searches."
    cached = db_session.scalar(select(FlightQuote).where(FlightQuote.source == "travelpayouts"))
    assert cached.price_total == 1400  # $700 per adult, two adults
    assert cached.observed_at == datetime(2026, 9, 24, 12, tzinfo=UTC)
    assert cached.booking_url.startswith("https://www.aviasales.com/search/")
    assert "cheapest USD 1,400" in log_text(db_session, ctx)


def test_without_quota_only_cached_fares_are_used(db_session: Session, apis: Apis) -> None:
    db_session.add(AppSetting(key="serpapi_monthly_cap", value=0))
    ctx = context(db_session)

    status, _ = run_flight_prices(ctx)

    assert status == "succeeded"
    assert not apis.search.called
    assert count(db_session, FlightQuote, FlightQuote.source == "travelpayouts") == 1
    assert "share of the SerpApi quota is used up" in log_text(db_session, ctx)


def test_cancel_stops_before_the_next_step(db_session: Session, apis: Apis) -> None:
    ctx = context(db_session)
    ctx.run.cancel_requested = True
    db_session.flush()

    with pytest.raises(Cancelled):
        run_flight_prices(ctx)
    assert count(db_session, FlightQuote) == 0


def test_every_live_search_failing_fails_the_run(db_session: Session, apis: Apis) -> None:
    apis.search.mock(return_value=httpx.Response(401, json={"error": "Invalid API key."}))
    ctx = context(db_session, travelpayouts_token=None)

    status, summary = run_flight_prices(ctx)

    assert status == "failed"
    assert "check SERPAPI_API_KEY" in summary
    assert "Invalid API key" in log_text(db_session, ctx)
