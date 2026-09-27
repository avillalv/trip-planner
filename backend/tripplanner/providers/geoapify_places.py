"""Geoapify places: things to do near a destination, from OpenStreetMap data.

Category searches ("museums") use the Places API, which returns hours, website, and Wikipedia
links with each result (1 credit per 20 places). Free-text searches ("ramen", "Kinkaku-ji") use
the Geocoding API, which matches English names well but returns only the basics; details for
those come from Place Details on request (1 credit each). Geoapify allows storing results.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import ValidationError

from tripplanner.providers import ProviderError
from tripplanner.schemas.places import PlaceOut

PLACES_URL = "https://api.geoapify.com/v2/places"
GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search"
DETAILS_URL = "https://api.geoapify.com/v2/place-details"
PAGE_SIZE = 20

log = logging.getLogger(__name__)

# The search chips, as Geoapify categories.
SEARCH_KINDS: dict[str, str] = {
    "restaurants": "catering.restaurant,catering.fast_food",
    "cafes": "catering.cafe",
    "museums": "entertainment.museum,entertainment.culture",
    "landmarks": "tourism.sights,tourism.attraction",
    "viewpoints": "tourism.attraction.viewpoint",
    "parks": "leisure.park,national_park",
    "beaches": "beach",
    "nightlife": "catering.bar,catering.pub,adult.nightclub",
    "shopping": "commercial.shopping_mall,commercial.marketplace,commercial.department_store",
}

# Geoapify categories → the activity category (color and icon in the day view). First match wins.
CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("museum", ("entertainment.museum", "entertainment.culture")),
    ("nightlife", ("catering.bar", "catering.pub", "catering.biergarten", "adult.nightclub")),
    ("food", ("catering",)),
    ("nature", ("leisure.park", "national_park", "beach", "natural")),
    ("shopping", ("commercial",)),
    ("travel", ("public_transport", "airport", "railway")),
    ("sights", ("tourism", "religion", "heritage", "entertainment", "leisure")),
]


def activity_category(kinds: list[str]) -> str:
    for category, prefixes in CATEGORY_RULES:
        if any(kind == p or kind.startswith(p + ".") for kind in kinds for p in prefixes):
            return category
    return "other"


@dataclass(frozen=True)
class Area:
    """A whole destination to search, like all of Costa Rica rather than a circle around its middle."""

    place_id: str | None = None
    # [west, south, east, north], used when there's no place id.
    bbox: tuple[float, ...] | None = None
    # Set for a country: text searches filter by it.
    country_code: str | None = None


# Without a boundary or box, "the whole area" falls back to this circle.
WIDE_RADIUS_M = 80_000


def _where(lat: float, lon: float, radius_m: int, area: Area | None, text: bool) -> dict[str, str]:
    """Where to look: a circle, or a whole area. Results nearest the center come first either way."""
    bias = f"proximity:{lon},{lat}"
    if area is not None:
        if text and area.country_code:
            return {"filter": f"countrycode:{area.country_code.lower()}", "bias": bias}
        # Place boundaries work for category search; text search takes the bounding box.
        if area.place_id and not text:
            return {"filter": f"place:{area.place_id}", "bias": bias}
        if area.bbox:
            west, south, east, north = area.bbox
            return {"filter": f"rect:{west},{south},{east},{north}", "bias": bias}
        radius_m = max(radius_m, WIDE_RADIUS_M)
    return {"filter": f"circle:{lon},{lat},{radius_m}", "bias": bias}


def kind_request(
    kind: str, lat: float, lon: float, radius_m: int, offset: int = 0, area: Area | None = None
) -> tuple[str, dict[str, Any]]:
    params = {
        "categories": SEARCH_KINDS[kind],
        **_where(lat, lon, radius_m, area, text=False),
        "limit": PAGE_SIZE,
        "offset": offset,
        "lang": "en",
    }
    return PLACES_URL, params


def text_request(
    text: str, lat: float, lon: float, radius_m: int, area: Area | None = None
) -> tuple[str, dict[str, Any]]:
    where = _where(lat, lon, radius_m, area, text=True)
    params = {"text": text, "type": "amenity", **where, "limit": PAGE_SIZE}
    return GEOCODE_URL, {**params, "lang": "en", "format": "json"}


# Destination kinds the geocoder can be asked for directly.
GEOCODE_TYPES = {"country", "state", "city", "county", "postcode", "locality"}


def place_request(
    name: str, kind: str | None, country_code: str | None, lat: float, lon: float
) -> tuple[str, dict[str, Any]]:
    """Find a destination's own Geoapify id (for one saved before ids were kept)."""
    params: dict[str, Any] = {"text": name, "bias": f"proximity:{lon},{lat}", "limit": 1, "format": "json"}
    if kind in GEOCODE_TYPES:
        params["type"] = kind
    if country_code:
        params["filter"] = f"countrycode:{country_code.lower()}"
    return GEOCODE_URL, params


def details_request(place_id: str) -> tuple[str, dict[str, Any]]:
    return DETAILS_URL, {"id": place_id, "features": "details", "lang": "en"}


def fetch(client: httpx.Client, url: str, params: dict[str, Any], api_key: str) -> dict[str, Any]:
    try:
        response = client.get(url, params={**params, "apiKey": api_key})
    except httpx.HTTPError as exc:
        raise ProviderError("Couldn't reach Geoapify. Check your internet connection.") from exc
    if response.status_code in (401, 403):
        raise ProviderError("Geoapify refused the API key. Check GEOAPIFY_API_KEY in .env.")
    if response.status_code == 429:
        raise ProviderError("Today's free Geoapify credits are used up. Searches work again tomorrow.")
    if response.status_code != 200:
        raise ProviderError(f"Geoapify returned an error ({response.status_code}). Try again in a moment.")
    try:
        return response.json()
    except ValueError as exc:
        raise ProviderError("Geoapify sent a response that couldn't be read.") from exc


def _address(props: dict[str, Any], name: str) -> str | None:
    # With a name, address_line1 repeats it and line 2 is the street address.
    if props.get("address_line1") == name and props.get("address_line2"):
        return props["address_line2"]
    return props.get("formatted") or props.get("address_line2")


def _text(*values: Any) -> str | None:
    """The first value given, as text. OpenStreetMap tags pass through as-is, so a phone number
    can arrive as a number."""
    for value in values:
        if value is not None and value != "":
            return str(value)
    return None


def _distance(props: dict[str, Any]) -> int | None:
    value = props.get("distance")
    return round(value) if isinstance(value, int | float) else None


def from_feature(props: dict[str, Any]) -> PlaceOut | None:
    """A Places API or Place Details feature: comes with hours, website, and wiki links when known."""
    local = props.get("name")
    name = (props.get("name_international") or {}).get("en") or local or props.get("address_line1")
    if not name or props.get("lat") is None or props.get("lon") is None or not props.get("place_id"):
        return None
    raw = (props.get("datasource") or {}).get("raw") or {}
    wiki = props.get("wiki_and_media") or {}
    contact = props.get("contact") or {}
    kinds = list(props.get("categories") or [])
    return PlaceOut(
        provider="geoapify",
        id=props["place_id"],
        name=name,
        local_name=local if local and local != name else None,
        category=activity_category(kinds),
        kinds=kinds,
        address=_address(props, name),
        lat=float(props["lat"]),
        lon=float(props["lon"]),
        distance_m=_distance(props),
        website=_text(props.get("website"), raw.get("website")),
        opening_hours=_text(props.get("opening_hours"), raw.get("opening_hours")),
        phone=_text(contact.get("phone"), raw.get("phone")),
        wikidata=_text(wiki.get("wikidata"), raw.get("wikidata")),
        wikipedia=_text(wiki.get("wikipedia"), raw.get("wikipedia")),
        has_details=True,
    )


def from_geocode(result: dict[str, Any]) -> PlaceOut | None:
    """A Geocoding result: name, address, and location only."""
    name = result.get("name") or result.get("address_line1")
    if not name or result.get("lat") is None or result.get("lon") is None or not result.get("place_id"):
        return None
    local = (result.get("other_names") or {}).get("name")
    kinds = [result["category"]] if result.get("category") else []
    return PlaceOut(
        provider="geoapify",
        id=result["place_id"],
        name=name,
        local_name=local if local and local != name else None,
        category=activity_category(kinds),
        kinds=kinds,
        address=_address(result, name),
        lat=float(result["lat"]),
        lon=float(result["lon"]),
        distance_m=_distance(result),
        has_details=False,
    )


def _each(items: list[dict[str, Any]], parse: Callable[[dict[str, Any]], PlaceOut | None]) -> list[PlaceOut]:
    """Parse each result, skipping any that can't be read, so one odd place doesn't sink a search."""
    places = []
    for item in items:
        try:
            place = parse(item)
        except (ValidationError, TypeError, ValueError) as exc:
            log.warning("Skipped a Geoapify place that couldn't be read: %s", exc)
            continue
        if place is not None:
            places.append(place)
    return places


def parse_places(data: dict[str, Any]) -> list[PlaceOut]:
    return _each([f.get("properties") or {} for f in data.get("features") or []], from_feature)


def parse_geocode(data: dict[str, Any]) -> list[PlaceOut]:
    return _each(list(data.get("results") or []), from_geocode)


def parse_details(data: dict[str, Any]) -> PlaceOut | None:
    features = data.get("features") or []
    return from_feature(features[0].get("properties") or {}) if features else None
