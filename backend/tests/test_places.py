"""Places search: parsing real Geoapify responses, caching, and Wikipedia summaries."""

import json
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_trip
from tripplanner.models import TripDestination
from tripplanner.providers import geoapify_places as geo
from tripplanner.schemas.places import PlaceOut
from tripplanner.services import places as places_service

FIXTURES = Path(__file__).parent / "fixtures"
KYOTO = {"lat": 35.0116, "lon": 135.7681}


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# --- Parsing ----------------------------------------------------------------------------------


def test_category_results_come_with_details() -> None:
    places = geo.parse_places(fixture("geoapify_places_museums.json"))

    shimadzu = next(p for p in places if p.name == "Shimadzu Foundation Memorial Museum")
    assert shimadzu.local_name == "島津製作所創業記念資料館"
    assert shimadzu.category == "museum"
    assert shimadzu.address.startswith("Kiyamachi Street")
    assert (shimadzu.opening_hours, shimadzu.wikidata) == ("9:30-17:00", "Q11476799")
    assert shimadzu.website == "https://www.shimadzu.co.jp/visionary/memorial-hall/"
    assert shimadzu.distance_m == 242 and shimadzu.has_details


def test_places_without_an_english_name_keep_their_local_name() -> None:
    places = geo.parse_places(fixture("geoapify_places_museums.json"))

    kaleidoscope = next(p for p in places if p.name == "京都万華鏡ミュージアム")
    assert kaleidoscope.local_name is None


def test_text_results_are_basic_until_details_are_fetched() -> None:
    [kinkaku, *_] = geo.parse_geocode(fixture("geoapify_geocode_kinkaku.json"))

    assert (kinkaku.name, kinkaku.local_name) == ("Kinkaku-ji", "金閣寺")
    assert kinkaku.address == "Kita Ward, Kyoto, Kinkakuji-chō 603-8361, Japan"
    assert not kinkaku.has_details and kinkaku.website is None


def test_details_parse_like_category_results() -> None:
    place = geo.parse_details(fixture("geoapify_place_details.json"))

    assert place is not None
    assert place.name == "Honnoji Temple Treasure Hall" and place.local_name == "本能寺大寶殿宝物館"
    assert place.category == "museum" and place.has_details


@pytest.mark.parametrize(
    ("kinds", "category"),
    [
        (["catering", "catering.bar"], "nightlife"),
        (["catering.restaurant.ramen"], "food"),
        (["building.tourism", "entertainment.museum"], "museum"),
        (["leisure", "leisure.park"], "nature"),
        (["beach"], "nature"),
        (["tourism.sights.place_of_worship.temple"], "sights"),
        (["commercial.marketplace"], "shopping"),
        (["office"], "other"),
    ],
)
def test_places_sort_into_activity_categories(kinds: list[str], category: str) -> None:
    assert geo.activity_category(kinds) == category


# --- Search API ---------------------------------------------------------------------------------


def test_category_search_is_cached(
    client: TestClient, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    route = no_real_network.get(geo.PLACES_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_places_museums.json"))
    )

    first = client.get("/api/v1/places/search", params={**KYOTO, "kind": "museums"}).json()
    again = client.get("/api/v1/places/search", params={**KYOTO, "kind": "museums"}).json()

    assert route.call_count == 1
    assert (first["cached"], again["cached"]) == (False, True)
    assert [p["distance_m"] for p in first["places"]] == sorted(p["distance_m"] for p in first["places"])
    sent = route.calls[0].request.url.params
    assert sent["categories"] == "entertainment.museum,entertainment.culture"
    assert sent["filter"] == "circle:135.768,35.012,5000"


def test_text_search_uses_the_geocoder(
    client: TestClient, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    route = no_real_network.get(geo.GEOCODE_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_geocode_kinkaku.json"))
    )

    body = client.get("/api/v1/places/search", params={**KYOTO, "q": "kinkaku", "radius_m": 15000}).json()

    assert body["places"][0]["name"] == "Kinkaku-ji"
    assert route.calls[0].request.url.params["type"] == "amenity"


def test_search_needs_a_query_or_category(client: TestClient) -> None:
    assert client.get("/api/v1/places/search", params=KYOTO).status_code == 422


def test_search_without_a_key_explains_what_to_add(client: TestClient, use_settings) -> None:
    use_settings(geoapify_api_key=None)

    response = client.get("/api/v1/places/search", params={**KYOTO, "q": "ramen"})

    assert response.status_code == 503
    assert "GEOAPIFY_API_KEY" in response.json()["detail"]


def test_used_up_credits_are_explained(
    client: TestClient, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    no_real_network.get(geo.GEOCODE_URL).mock(return_value=httpx.Response(429))

    response = client.get("/api/v1/places/search", params={**KYOTO, "q": "ramen"})

    assert response.status_code == 502
    assert "credits are used up" in response.json()["detail"]


def test_place_details_by_id(client: TestClient, use_settings, no_real_network: respx.MockRouter) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    no_real_network.get(geo.DETAILS_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_place_details.json"))
    )

    response = client.get("/api/v1/places/geoapify/51608033e78ff860405964c28b2551814140")

    assert response.json()["name"] == "Honnoji Temple Treasure Hall"


# --- Wikipedia --------------------------------------------------------------------------------

WIKIDATA = {"entities": {"Q11476799": {"sitelinks": {"enwiki": {"title": "Shimadzu Memorial Hall"}}}}}
ARTICLE = {
    "query": {
        "pages": [
            {
                "title": "Shimadzu Memorial Hall",
                "extract": "A museum on the history of Shimadzu Corporation.",
                "fullurl": "https://en.wikipedia.org/wiki/Shimadzu_Memorial_Hall",
                "thumbnail": {"source": "https://upload.wikimedia.org/x.jpg"},
            }
        ]
    }
}


def test_wiki_summary_comes_from_the_wikidata_link(
    client: TestClient, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(wikimedia_contact="tester@example.com")
    wikidata = no_real_network.get("https://www.wikidata.org/w/api.php").mock(
        return_value=httpx.Response(200, json=WIKIDATA)
    )
    no_real_network.get("https://en.wikipedia.org/w/api.php").mock(
        return_value=httpx.Response(200, json=ARTICLE)
    )

    first = client.get("/api/v1/places/wiki", params={"wikidata": "Q11476799"}).json()
    again = client.get("/api/v1/places/wiki", params={"wikidata": "Q11476799"}).json()

    assert first["extract"].startswith("A museum") and first == again
    assert wikidata.call_count == 1
    assert "tester@example.com" in wikidata.calls[0].request.headers["user-agent"]


def test_wiki_summary_needs_a_contact(client: TestClient, use_settings) -> None:
    use_settings(wikimedia_contact=None)

    assert client.get("/api/v1/places/wiki", params={"wikidata": "Q1"}).json() is None


# --- Searching a whole destination ---------------------------------------------------------------

COSTA_RICA = {"lat": 10.2736, "lon": -84.0739}


def destination(db_session: Session, **fields) -> TripDestination:
    trip = add_trip(db_session, name="Costa Rica")
    values = {
        "position": 0,
        "name": "Costa Rica",
        "country": "Costa Rica",
        "country_code": "CR",
        "kind": "country",
        "lat": 10.2736,
        "lon": -84.0739,
        "bbox": [-87.102, 5.499, -82.43, 11.22],
        "geoapify_place_id": "51cr-place-id",
        "info_status": "skipped",
        **fields,
    }
    trip.destinations = [TripDestination(**values)]
    db_session.flush()
    return trip.destinations[0]


def test_a_country_is_searched_within_its_borders(
    client: TestClient, db_session: Session, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    country = destination(db_session)
    places = no_real_network.get(geo.PLACES_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_places_museums.json"))
    )
    names = no_real_network.get(geo.GEOCODE_URL).mock(return_value=httpx.Response(200, json={"results": []}))

    client.get("/api/v1/places/search", params={**COSTA_RICA, "kind": "beaches", "within": country.id})
    client.get("/api/v1/places/search", params={**COSTA_RICA, "q": "Tamarindo", "within": country.id})

    beaches = places.calls[0].request.url.params
    assert (beaches["categories"], beaches["filter"]) == ("beach", "place:51cr-place-id")
    assert beaches["bias"] == "proximity:-84.074,10.274"
    assert names.calls[0].request.url.params["filter"] == "countrycode:cr"


def test_a_place_without_a_boundary_uses_its_box(
    client: TestClient, db_session: Session, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    city = destination(
        db_session, name="Tamarindo", kind="city", geoapify_place_id=None, bbox=[-85.86, 10.28, -85.82, 10.32]
    )
    route = no_real_network.get(geo.PLACES_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_places_museums.json"))
    )
    no_real_network.get(geo.GEOCODE_URL).mock(return_value=httpx.Response(200, json={"results": []}))

    client.get("/api/v1/places/search", params={**COSTA_RICA, "kind": "nightlife", "within": city.id})

    assert route.calls[0].request.url.params["filter"] == "rect:-85.86,10.28,-85.82,10.32"


def test_a_missing_place_id_is_looked_up_once_and_kept(
    client: TestClient, db_session: Session, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    country = destination(db_session, geoapify_place_id=None)
    lookup = no_real_network.get(geo.GEOCODE_URL).mock(
        return_value=httpx.Response(200, json={"results": [{"place_id": "51found-cr"}]})
    )
    places = no_real_network.get(geo.PLACES_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_places_museums.json"))
    )

    for kind in ("beaches", "nightlife"):
        client.get("/api/v1/places/search", params={**COSTA_RICA, "kind": kind, "within": country.id})

    assert lookup.call_count == 1
    asked = lookup.calls[0].request.url.params
    assert (asked["text"], asked["type"], asked["filter"]) == ("Costa Rica", "country", "countrycode:cr")
    assert [c.request.url.params["filter"] for c in places.calls] == ["place:51found-cr", "place:51found-cr"]
    assert country.geoapify_place_id == "51found-cr"


def test_a_missing_destination_is_not_found(client: TestClient, use_settings) -> None:
    use_settings(geoapify_api_key="test-geo-key")

    response = client.get("/api/v1/places/search", params={**COSTA_RICA, "kind": "beaches", "within": 987654})

    assert response.status_code == 404


def test_circles_reach_100_miles(client: TestClient, use_settings, no_real_network: respx.MockRouter) -> None:
    use_settings(geoapify_api_key="test-geo-key")
    route = no_real_network.get(geo.PLACES_URL).mock(
        return_value=httpx.Response(200, json=fixture("geoapify_places_museums.json"))
    )

    response = client.get(
        "/api/v1/places/search", params={**COSTA_RICA, "kind": "beaches", "radius_m": 160_934}
    )

    assert response.status_code == 200
    assert route.calls[0].request.url.params["filter"] == "circle:-84.074,10.274,160934"


def test_odd_osm_values_dont_sink_a_search() -> None:
    feature = fixture("geoapify_places_museums.json")["features"][0]
    phone_as_number = {**feature["properties"], "contact": {"phone": 50660072170}}
    broken = {"properties": {**feature["properties"], "place_id": "x", "lat": "not a number"}}

    places = geo.parse_places({"features": [{"properties": phone_as_number}, broken]})

    assert [p.phone for p in places] == ["50660072170"]


def test_a_place_mapped_twice_shows_once() -> None:
    def place(name: str, category: str, lat: float, lon: float) -> PlaceOut:
        return PlaceOut(
            provider="geoapify", id=f"{name}{lat}", name=name, category=category, kinds=[], lat=lat, lon=lon
        )

    shown = places_service.distinct(
        [
            place("Playa Caldera", "nature", 9.9193, -84.7129),
            place("Playa Caldera", "nature", 9.9324, -84.7214),  # another stretch of the same beach
            place("Playa Caldera", "nature", 9.4, -84.2),  # a different one, far away
            place("Starbucks", "food", 9.93, -84.08),
            place("Starbucks", "food", 9.94, -84.08),  # a second café, a kilometer away
        ]
    )

    assert [(p.name, p.lat) for p in shown] == [
        ("Playa Caldera", 9.9193),
        ("Playa Caldera", 9.4),
        ("Starbucks", 9.93),
        ("Starbucks", 9.94),
    ]
