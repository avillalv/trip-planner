"""Places search: parsing real Geoapify responses, caching, and Wikipedia summaries."""

import json
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tripplanner.providers import geoapify_places as geo

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
