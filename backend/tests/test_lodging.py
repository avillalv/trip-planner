"""The lodging shortlist: links, previews, rental search, hearts, and the shared search budget."""

import json
import socket
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_person, add_rates, add_trip
from tripplanner.models import ApiCall, Trip, TripDestination
from tripplanner.providers import link_preview, serpapi_rentals
from tripplanner.services import serpapi_budget

FIXTURES = Path(__file__).parent / "fixtures"
AIRBNB = (
    "https://www.airbnb.com/rooms/53122?check_in=2026-11-09&check_out=2026-11-12&adults=2&children=1&source=x"
)


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    trip.destinations = [
        TripDestination(
            position=0, name="Kyoto", country="Japan", lat=35.01, lon=135.77, info_status="skipped"
        )
    ]
    add_rates(db_session, USD="1.10", JPY="165")
    return trip


# --- Links -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (AIRBNB, (date(2026, 11, 9), date(2026, 11, 12), 3)),
        (
            "https://www.booking.com/hotel/jp/sielu.html?checkin=2026-11-09&checkout=2026-11-11&group_adults=2",
            (date(2026, 11, 9), date(2026, 11, 11), 2),
        ),
        (
            "https://www.vrbo.com/1234567?chkin=2026-11-09&chkout=2026-11-10&adults=4",
            (date(2026, 11, 9), date(2026, 11, 10), 4),
        ),
        (
            "https://www.agoda.com/x/hotel/kyoto.html?checkIn=2026-11-09&los=3&adults=2",
            (date(2026, 11, 9), date(2026, 11, 12), 2),
        ),
        (
            "https://www.airbnb.com/rooms/1?check_in=2026-11-12&check_out=2026-11-09",
            (date(2026, 11, 12), None, None),
        ),
        ("https://example.com/cabin", (None, None, None)),
    ],
)
def test_dates_and_guests_come_from_the_link(url: str, expected: tuple) -> None:
    assert link_preview.parse_listing_url(url) == expected


def test_listings_are_identified_without_their_query() -> None:
    assert link_preview.normalize_url(AIRBNB) == "airbnb.com/rooms/53122"
    assert link_preview.normalize_url("https://airbnb.com/rooms/53122/") == "airbnb.com/rooms/53122"
    assert link_preview.site_name(AIRBNB) == "Airbnb"
    assert link_preview.site_name("https://www.airbnb.co.uk/rooms/1") == "Airbnb"
    assert link_preview.site_name("https://stays.example.jp/x") == "stays.example.jp"


def test_preview_without_fetching_reads_only_the_link(client: TestClient) -> None:
    body = client.post("/api/v1/lodging/preview", json={"url": AIRBNB}).json()

    assert (body["site"], body["check_in"], body["guests"], body["fetched"]) == (
        "Airbnb",
        "2026-11-09",
        3,
        False,
    )


PAGE = """<html><head><title>Fallback</title>
<meta property="og:title" content="Machiya with garden - Kyoto">
<meta property="og:image" content="/photos/1.jpg">
<meta name="description" content="Entire home, sleeps 4"></head><body>...</body></html>"""


def public_dns(monkeypatch: pytest.MonkeyPatch, ip: str = "93.184.216.34") -> None:
    monkeypatch.setattr(
        link_preview.socket,
        "getaddrinfo",
        lambda *_a, **_k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))],
    )


def test_preview_fetch_reads_open_graph_tags(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, no_real_network: respx.MockRouter
) -> None:
    public_dns(monkeypatch)
    no_real_network.get("https://stays.example.jp/machiya").mock(return_value=httpx.Response(200, text=PAGE))

    body = client.post(
        "/api/v1/lodging/preview", json={"url": "https://stays.example.jp/machiya", "fetch": True}
    ).json()

    assert body["title"] == "Machiya with garden - Kyoto"
    assert body["photos"] == ["https://stays.example.jp/photos/1.jpg"]
    assert body["fetched"] is True


def test_preview_refuses_home_network_addresses(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    public_dns(monkeypatch, ip="192.168.1.1")

    body = client.post(
        "/api/v1/lodging/preview", json={"url": "http://router.example.com/", "fetch": True}
    ).json()

    assert body["fetched"] is False
    assert "home network" in body["fetch_problem"]


def test_blocked_previews_fall_back_to_manual_entry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, no_real_network: respx.MockRouter
) -> None:
    public_dns(monkeypatch)
    no_real_network.get(AIRBNB).mock(return_value=httpx.Response(403))

    body = client.post("/api/v1/lodging/preview", json={"url": AIRBNB, "fetch": True}).json()

    assert "Fill in the details yourself" in body["fetch_problem"]
    assert body["check_in"] == "2026-11-09"


# --- Shortlist ---------------------------------------------------------------------------------


def save(client: TestClient, trip: Trip, **fields) -> dict:
    payload = {
        "title": "Machiya in Gion",
        "url": AIRBNB,
        "check_in": "2026-11-09",
        "check_out": "2026-11-12",
        "guests": 2,
        "price_total": "90000",
        "currency": "JPY",
        "added_via": "paste",
        **fields,
    }
    response = client.post(f"/api/v1/trips/{trip.id}/lodging", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_saving_derives_nightly_and_home_prices(client: TestClient, trip: Trip) -> None:
    option = save(client, trip)

    assert (option["site"], option["nights"]) == ("Airbnb", 3)
    assert option["price_per_night"] == "30000.00"
    assert (option["price_home_total"], option["home_currency"]) == ("600.00", "USD")


def test_a_listing_is_saved_once_per_trip(client: TestClient, trip: Trip) -> None:
    save(client, trip)

    again = client.post(
        f"/api/v1/trips/{trip.id}/lodging",
        json={"title": "Same place", "url": "https://airbnb.com/rooms/53122", "added_via": "paste"},
    )

    assert again.status_code == 409


def test_prices_need_a_currency(client: TestClient, trip: Trip) -> None:
    response = client.post(f"/api/v1/trips/{trip.id}/lodging", json={"title": "Hut", "price_total": "100"})

    assert response.status_code == 422


def test_editing_the_nightly_price_updates_the_total(client: TestClient, trip: Trip) -> None:
    option = save(client, trip)

    updated = client.patch(
        f"/api/v1/lodging/{option['id']}",
        json={"price_per_night": "25000", "status": "shortlisted", "favorite": True},
    ).json()

    assert (updated["price_total"], updated["price_home_total"]) == ("75000.00", "500.00")
    assert (updated["status"], updated["favorite"]) == ("shortlisted", True)


def test_each_traveler_can_heart_an_option(client: TestClient, db_session: Session, trip: Trip) -> None:
    alex, sam = add_person(db_session, "Alex"), add_person(db_session, "Sam")
    option = save(client, trip)
    url = f"/api/v1/lodging/{option['id']}/hearts"

    client.put(f"{url}/{alex.id}", json={"hearted": True})
    both = client.put(f"{url}/{sam.id}", json={"hearted": True}).json()
    one = client.put(f"{url}/{alex.id}", json={"hearted": False}).json()

    assert sorted(both["hearts"]) == sorted([alex.id, sam.id])
    assert one["hearts"] == [sam.id]


def test_delete(client: TestClient, trip: Trip) -> None:
    option = save(client, trip)

    assert client.delete(f"/api/v1/lodging/{option['id']}").status_code == 204
    assert client.get(f"/api/v1/trips/{trip.id}/lodging").json() == []


# --- Rental search ------------------------------------------------------------------------------


def rentals_fixture() -> dict:
    return json.loads((FIXTURES / "serpapi_vacation_rentals.json").read_text(encoding="utf-8"))


def test_rental_results_are_parsed() -> None:
    [first, second, third, *_] = serpapi_rentals.parse(rentals_fixture(), "USD")

    assert (first.title, first.price_total, first.price_per_night) == ("Stay Inn KOTO", 275, 92)
    assert (first.rating, first.review_count, first.site) == (Decimal("4.4"), 245, "Voyabay")
    assert first.photos[0].startswith("https://") and first.lat is not None
    assert (second.kind, second.sleeps, second.bedrooms, second.beds) == ("Entire cottage", 6, 3, 5)
    assert third.baths == 1


SEARCH = {"check_in": "2026-11-09", "check_out": "2026-11-12", "adults": 2}


def test_rental_search_is_cached_and_counted(
    client: TestClient, db_session: Session, use_settings, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    use_settings(serpapi_api_key="test-serp-key")
    route = no_real_network.get(serpapi_rentals.SEARCH_URL).mock(
        return_value=httpx.Response(200, json=rentals_fixture())
    )

    first = client.post(f"/api/v1/trips/{trip.id}/lodging/search-rentals", json=SEARCH).json()
    again = client.post(f"/api/v1/trips/{trip.id}/lodging/search-rentals", json=SEARCH).json()

    assert route.call_count == 1
    assert (first["cached"], again["cached"]) == (False, True)
    sent = route.calls[0].request.url.params
    assert (sent["q"], sent["vacation_rentals"], sent["currency"]) == ("Kyoto, Japan", "true", "USD")
    assert serpapi_budget.usage(db_session).used_this_month == 1
    calls = db_session.scalars(select(ApiCall.endpoint).where(ApiCall.provider == "serpapi")).all()
    assert calls == ["google_hotels"]


def test_rental_search_stops_when_the_month_is_used_up(
    client: TestClient, db_session: Session, use_settings, trip: Trip, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(serpapi_api_key="test-serp-key")
    monkeypatch.setattr(serpapi_budget, "monthly_cap", lambda _db: 0)

    response = client.post(f"/api/v1/trips/{trip.id}/lodging/search-rentals", json=SEARCH)

    assert response.status_code == 429
    assert "used up" in response.json()["detail"]


def test_rental_search_needs_a_key(client: TestClient, trip: Trip) -> None:
    response = client.post(f"/api/v1/trips/{trip.id}/lodging/search-rentals", json=SEARCH)

    assert response.status_code == 503
