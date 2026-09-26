import asyncio

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_airport
from tripplanner.providers import ProviderError, geoapify
from tripplanner.providers.geoapify import BASE_URL, merge_results, search_destinations


def _result(name: str, kind: str = "city", importance: float | None = 0.5, **extra: object) -> dict:
    return {
        "name": name,
        "result_type": kind,
        "country": "Indonesia",
        "country_code": "id",
        "state": extra.pop("state", None),
        "lat": extra.pop("lat", -8.4),
        "lon": extra.pop("lon", 115.2),
        "formatted": f"{name}, Indonesia",
        "timezone": {"name": "Asia/Makassar"},
        "rank": {"importance": importance},
        "bbox": {"lon1": 114.4, "lat1": -8.9, "lon2": 115.7, "lat2": -8.0},
        "place_id": f"pid-{name}",
        **extra,
    }


def test_exact_names_rank_first_and_noise_is_dropped() -> None:
    results = [
        _result("Balikpapan", importance=0.9, lat=-1.2, lon=116.8),
        _result("Bali", kind="state", importance=0.6),
        _result("Bali", kind="state", importance=0.6),  # duplicate from the other endpoint
        _result("KYOT-TV", kind="amenity", importance=0.0),
        _result("Jalan Bali", kind="street"),
    ]

    suggestions = merge_results("bali", results)

    assert [s.name for s in suggestions] == ["Bali", "Balikpapan"]
    bali = suggestions[0]
    assert bali.country_code == "ID"
    assert bali.timezone == "Asia/Makassar"
    assert bali.bbox == [114.4, -8.9, 115.7, -8.0]
    assert bali.region is None


def test_state_is_kept_as_region_for_cities() -> None:
    [kyoto] = merge_results("kyoto", [_result("Kyoto", state="Kyoto Prefecture")])

    assert kyoto.region == "Kyoto Prefecture"


def test_search_queries_both_endpoints(no_real_network: respx.MockRouter) -> None:
    geoapify._cache.clear()
    no_real_network.get(f"{BASE_URL}/search").mock(
        return_value=httpx.Response(200, json={"results": [_result("Bali", kind="state")]})
    )
    no_real_network.get(f"{BASE_URL}/autocomplete").mock(return_value=httpx.Response(500))

    async def run() -> list:
        async with httpx.AsyncClient() as client:
            return await search_destinations("Bali", "key", client)

    assert [s.name for s in asyncio.run(run())] == ["Bali"]


def test_search_fails_only_when_both_endpoints_fail(no_real_network: respx.MockRouter) -> None:
    geoapify._cache.clear()
    no_real_network.get(f"{BASE_URL}/search").mock(return_value=httpx.Response(401))
    no_real_network.get(f"{BASE_URL}/autocomplete").mock(return_value=httpx.Response(401))

    async def run() -> list:
        async with httpx.AsyncClient() as client:
            return await search_destinations("Nowhere", "bad-key", client)

    with pytest.raises(ProviderError):
        asyncio.run(run())


def test_destination_search_explains_missing_key(client: TestClient) -> None:
    response = client.get("/api/v1/geo/destinations", params={"q": "Kyoto"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Add GEOAPIFY_API_KEY to .env to search for destinations."


def test_airport_search_ranks_exact_code_then_size(client: TestClient, db_session: Session) -> None:
    add_airport(
        db_session, "SJC", "San Jose", "Norman Y. Mineta San Jose International", kind="medium_airport"
    )
    add_airport(db_session, "SFO", "San Francisco", "San Francisco International")
    add_airport(db_session, "SAN", "San Diego", "San Diego International")

    def search(q: str) -> list[str]:
        return [a["iata"] for a in client.get("/api/v1/airports", params={"q": q}).json()]

    # "san" is SAN's exact code; then larger airports before smaller ones.
    assert search("san") == ["SAN", "SFO", "SJC"]
    assert search("sfo") == ["SFO"]
    assert search("mineta") == ["SJC"]


def test_nearby_airports_prefer_big_ones(client: TestClient, db_session: Session) -> None:
    from tripplanner.models import Airport

    db_session.add_all(
        [
            Airport(
                iata="HND",
                name="Haneda",
                city="Tokyo",
                country_code="JP",
                lat=35.55,
                lon=139.78,
                kind="large_airport",
            ),
            Airport(
                iata="NRT",
                name="Narita",
                city="Narita",
                country_code="JP",
                lat=35.77,
                lon=140.39,
                kind="large_airport",
            ),
            Airport(
                iata="CHB",
                name="Chofu",
                city="Tokyo",
                country_code="JP",
                lat=35.67,
                lon=139.53,
                kind="medium_airport",
            ),
            Airport(
                iata="KIX",
                name="Kansai",
                city="Osaka",
                country_code="JP",
                lat=34.43,
                lon=135.24,
                kind="large_airport",
            ),
        ]
    )
    db_session.flush()

    nearby = client.get("/api/v1/airports/nearby", params={"lat": 35.68, "lon": 139.76}).json()

    assert [a["iata"] for a in nearby] == ["HND", "NRT", "CHB"]
    assert nearby[0]["distance_km"] < 20
