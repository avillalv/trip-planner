"""Per-day weather: Open-Meteo requests, forecast vs typical days, averaging, caching, and failures."""

from datetime import UTC, date, datetime, timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tests.factories import add_trip
from tripplanner.models import ApiCall, Trip, TripDestination
from tripplanner.providers import ProviderError
from tripplanner.providers import open_meteo as meteo
from tripplanner.services import weather

TODAY = date(2026, 9, 29)
NOW = datetime(2026, 9, 29, 12, tzinfo=UTC)


def days_between(start: str, end: str) -> list[date]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def answer(high, precip=0.0, chance=None):
    """A responder that fills the requested date range; the low is always 10 °F under the high."""

    def respond(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        days = days_between(p["start_date"], p["end_date"])
        daily = {
            "time": [d.isoformat() for d in days],
            "temperature_2m_max": [high(d) for d in days],
            "temperature_2m_min": [high(d) - 10 for d in days],
            "precipitation_sum": [precip(d) if callable(precip) else precip for d in days],
        }
        if "precipitation_probability_max" in p["daily"]:
            daily["precipitation_probability_max"] = [chance(d) if chance else 0 for d in days]
        return httpx.Response(200, json={"daily": daily})

    return respond


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    trip.destinations = [
        TripDestination(
            position=0, name="Tokyo", lat=35.68, lon=139.69, timezone="Asia/Tokyo", info_status="skipped"
        ),
        TripDestination(position=1, name="Kyoto", lat=35.01, lon=135.77, info_status="skipped"),
    ]
    db_session.flush()
    return trip


def dated(trip: Trip, db_session: Session, start: str, end: str) -> Trip:
    trip.start_date, trip.end_date = date.fromisoformat(start), date.fromisoformat(end)
    db_session.flush()
    return trip


def weather_for(db_session: Session, trip: Trip, today: date = TODAY):
    with httpx.Client() as client:
        return weather.trip_weather(db_session, client, trip, today, NOW)


def test_days_within_reach_get_the_forecast(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2026-10-01", "2026-10-03")
    route = no_real_network.get(meteo.FORECAST_URL).mock(
        side_effect=answer(lambda d: 80.4 + d.day, chance=lambda d: 10 * d.day)
    )

    days = weather_for(db_session, trip)

    assert route.call_count == 1
    sent = route.calls[0].request.url.params
    assert (sent["latitude"], sent["longitude"]) == ("35.68", "139.69")
    assert sent["temperature_unit"] == "fahrenheit" and sent["precipitation_unit"] == "inch"
    assert sent["timezone"] == "Asia/Tokyo"
    assert (sent["start_date"], sent["end_date"]) == ("2026-10-01", "2026-10-03")
    assert sent["daily"] == (
        "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max"
    )
    assert [(d.day.day, d.kind, d.high_f, d.low_f, d.rain_chance) for d in days] == [
        (1, "forecast", 81, 71, 10),
        (2, "forecast", 82, 72, 20),
        (3, "forecast", 83, 73, 30),
    ]
    assert days[0].destination_name == "Tokyo" and days[0].wet_days_pct is None


def test_typical_weather_averages_five_years_around_the_date(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2027-03-10", "2027-03-10")
    # 52, 54, 56, 58, 60 °F in 2021 to 2025; it rains on the even days of the month.
    route = no_real_network.get(meteo.ARCHIVE_URL).mock(
        side_effect=answer(lambda d: 50 + (d.year - 2020) * 2, precip=lambda d: 0.1 if d.day % 2 == 0 else 0)
    )

    [day] = weather_for(db_session, trip)

    windows = [(c.request.url.params["start_date"], c.request.url.params["end_date"]) for c in route.calls]
    assert windows == [(f"{y}-03-07", f"{y}-03-13") for y in range(2021, 2026)]
    sent = route.calls[0].request.url.params
    assert sent["daily"] == "temperature_2m_max,temperature_2m_min,precipitation_sum"
    assert sent["temperature_unit"] == "fahrenheit" and sent["precipitation_unit"] == "inch"
    assert sent["timezone"] == "Asia/Tokyo"
    assert (day.kind, day.high_f, day.low_f) == ("typical", 56, 46)
    # 7 dates around the 10th, 3 of them even: 3 of 7 days wet, 0.3 in over 7 days.
    assert day.wet_days_pct == 43 and day.precip_in == 0.04
    assert day.rain_chance is None
    assert day.whole_country is False


def test_weather_for_a_whole_country_says_so(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2027-03-10", "2027-03-10")
    trip.destinations[0].kind = "country"
    db_session.flush()
    no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=answer(lambda d: 60))

    [day] = weather_for(db_session, trip)

    assert day.whole_country is True


def test_a_leap_day_uses_february_28_in_other_years(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2028-02-29", "2028-02-29")
    route = no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=answer(lambda d: 40))

    [day] = weather_for(db_session, trip)

    windows = {
        c.request.url.params["start_date"][:4]: (
            c.request.url.params["start_date"],
            c.request.url.params["end_date"],
        )
        for c in route.calls
    }
    assert windows["2021"] == ("2021-02-25", "2021-03-03")
    assert windows["2024"] == ("2024-02-26", "2024-03-03")
    assert day.high_f == 40


def test_forecast_and_typical_days_split_at_fifteen_days_out(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2026-10-12", "2026-10-20")
    forecast = no_real_network.get(meteo.FORECAST_URL).mock(side_effect=answer(lambda d: 70))
    archive = no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=answer(lambda d: 60))

    days = weather_for(db_session, trip)

    # Today is Sep 29, so the forecast reaches Oct 14.
    assert [(d.day.day, d.kind) for d in days] == [(n, "forecast") for n in (12, 13, 14)] + [
        (n, "typical") for n in (15, 16, 17, 18, 19, 20)
    ]
    sent = forecast.calls[0].request.url.params
    assert (sent["start_date"], sent["end_date"]) == ("2026-10-12", "2026-10-14")
    assert archive.calls[0].request.url.params["start_date"] == "2021-10-12"
    assert archive.calls[0].request.url.params["end_date"] == "2021-10-23"


def test_days_before_today_are_typical(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2026-09-27", "2026-09-29")
    no_real_network.get(meteo.FORECAST_URL).mock(side_effect=answer(lambda d: 70))
    no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=answer(lambda d: 60))

    days = weather_for(db_session, trip)

    assert [(d.day.day, d.kind) for d in days] == [(27, "typical"), (28, "typical"), (29, "forecast")]


def test_responses_are_cached_and_metered(
    client: TestClient, db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    trip.start_date = date.today()
    trip.end_date = date.today() + timedelta(days=1)
    db_session.flush()
    route = no_real_network.get(meteo.FORECAST_URL).mock(side_effect=answer(lambda d: 70, chance=lambda d: 5))

    first = client.get(f"/api/v1/trips/{trip.id}/weather")
    again = client.get(f"/api/v1/trips/{trip.id}/weather")

    assert first.status_code == 200 and again.json() == first.json()
    assert [d["kind"] for d in first.json()] == ["forecast", "forecast"]
    assert route.call_count == 1
    calls = db_session.scalar(
        select(func.count()).select_from(ApiCall).where(ApiCall.provider == "open_meteo")
    )
    assert calls == 1


def test_history_is_cached_between_requests(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2027-03-10", "2027-03-11")
    route = no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=answer(lambda d: 60))

    weather_for(db_session, trip)
    weather_for(db_session, trip)

    assert route.call_count == 5


def test_a_destination_that_fails_leaves_its_days_out(
    client: TestClient, db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    trip.start_date = date.today()
    trip.end_date = date.today() + timedelta(days=2)
    db_session.flush()
    kyoto = trip.destinations[1]
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert client.put(
        f"/api/v1/trips/{trip.id}/days/{tomorrow}", json={"destination_id": kyoto.id}
    ).is_success
    ok = answer(lambda d: 70)
    no_real_network.get(meteo.FORECAST_URL).mock(
        side_effect=lambda request: (
            httpx.Response(500) if request.url.params["latitude"] == "35.01" else ok(request)
        )
    )

    response = client.get(f"/api/v1/trips/{trip.id}/weather")

    assert response.status_code == 200
    assert [(d["day"], d["destination_name"]) for d in response.json()] == [
        (date.today().isoformat(), "Tokyo"),
        ((date.today() + timedelta(days=2)).isoformat(), "Tokyo"),
    ]


def test_a_day_uses_its_own_destination(
    client: TestClient, db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    trip.start_date = date.today()
    trip.end_date = date.today() + timedelta(days=1)
    db_session.flush()
    day = (date.today() + timedelta(days=1)).isoformat()
    kyoto = trip.destinations[1]
    client.put(f"/api/v1/trips/{trip.id}/days/{day}", json={"destination_id": kyoto.id})
    route = no_real_network.get(meteo.FORECAST_URL).mock(side_effect=answer(lambda d: 70))

    body = client.get(f"/api/v1/trips/{trip.id}/weather").json()

    assert [d["destination_name"] for d in body] == ["Tokyo", "Kyoto"]
    assert route.calls[1].request.url.params["timezone"] == "auto"


def test_unreadable_answers_are_skipped(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    dated(trip, db_session, "2026-10-01", "2026-10-02")
    no_real_network.get(meteo.FORECAST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "daily": {
                    "time": ["2026-10-01", "2026-10-02"],
                    "temperature_2m_max": [None, 70],
                    "temperature_2m_min": [None, 60],
                    "precipitation_sum": [None, None],
                    "precipitation_probability_max": [None, None],
                }
            },
        )
    )

    days = weather_for(db_session, trip)

    assert [(d.day.day, d.high_f, d.precip_in, d.rain_chance) for d in days] == [(2, 70, 0.0, None)]


def test_trips_without_dates_or_destinations_have_no_weather(
    client: TestClient, db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    route = no_real_network.get(meteo.FORECAST_URL).mock(side_effect=answer(lambda d: 70))
    undated = client.get(f"/api/v1/trips/{trip.id}/weather")
    trip.start_date, trip.end_date, trip.destinations = date.today(), date.today(), []
    db_session.flush()
    nowhere = client.get(f"/api/v1/trips/{trip.id}/weather")

    assert undated.json() == [] and nowhere.json() == []
    assert not route.called


def test_weather_for_a_missing_trip_is_not_found(client: TestClient) -> None:
    assert client.get("/api/v1/trips/4242/weather").status_code == 404


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(429), "free limit"),
        (httpx.Response(400, json={"error": True}), "an error"),
        (httpx.Response(200, text="<html>"), "couldn't be read"),
        (httpx.Response(200, json=[1]), "couldn't be read"),
    ],
)
def test_provider_errors_are_readable(
    response: httpx.Response, message: str, no_real_network: respx.MockRouter
) -> None:
    no_real_network.get(meteo.FORECAST_URL).mock(return_value=response)
    with httpx.Client() as client, pytest.raises(ProviderError, match=message):
        meteo.fetch(client, meteo.FORECAST_URL, {})


def test_an_unreachable_provider_is_readable(no_real_network: respx.MockRouter) -> None:
    no_real_network.get(meteo.FORECAST_URL).mock(side_effect=httpx.ConnectError("down"))
    with httpx.Client() as client, pytest.raises(ProviderError, match="Check your internet connection"):
        meteo.fetch(client, meteo.FORECAST_URL, {})
