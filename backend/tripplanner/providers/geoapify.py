"""Geoapify geocoding: destination search for trips.

Autocomplete is good at partial words ("Kyo" → Kyoto) but ranks some full names poorly
("Bali" misses Indonesia); full-text search is the opposite. We query both in parallel and
merge, which costs two of the 3,000 free daily credits per lookup.
"""

import asyncio
import time
from typing import Any

import httpx

from tripplanner.providers import ProviderError
from tripplanner.schemas.geo import DestinationSuggestion

BASE_URL = "https://api.geoapify.com/v1/geocode"
# Result types that are never trip destinations.
EXCLUDED_KINDS = {"street", "postcode", "building", "unknown"}
# Named points (islands, parks, landmarks) must be reasonably well known to be suggested.
MIN_AMENITY_IMPORTANCE = 0.3
CACHE_SECONDS = 3600

_cache: dict[str, tuple[float, list[DestinationSuggestion]]] = {}


def _importance(result: dict[str, Any]) -> float:
    value = (result.get("rank") or {}).get("importance")
    return 0.5 if value is None else float(value)


def to_suggestion(result: dict[str, Any]) -> DestinationSuggestion | None:
    kind = result.get("result_type") or "unknown"
    if kind in EXCLUDED_KINDS:
        return None
    if kind == "amenity" and _importance(result) < MIN_AMENITY_IMPORTANCE:
        return None
    name = result.get("name") or result.get("city") or result.get("state") or result.get("country")
    if not name or result.get("lat") is None or result.get("lon") is None:
        return None

    country = result.get("country")
    state = result.get("state")
    bbox = result.get("bbox")
    return DestinationSuggestion(
        label=result.get("formatted") or name,
        name=name,
        region=state if state and state != name else None,
        country=country,
        country_code=(result.get("country_code") or "").upper() or None,
        kind=kind,
        lat=float(result["lat"]),
        lon=float(result["lon"]),
        timezone=(result.get("timezone") or {}).get("name"),
        bbox=[bbox["lon1"], bbox["lat1"], bbox["lon2"], bbox["lat2"]] if bbox else None,
        geoapify_place_id=result.get("place_id"),
    )


def merge_results(query: str, results: list[dict[str, Any]], limit: int = 8) -> list[DestinationSuggestion]:
    """Dedupe results from both endpoints and rank exact name matches, then well-known places, first."""
    seen: set[tuple[str, str | None, float, float]] = set()
    ranked: list[tuple[bool, float, DestinationSuggestion]] = []
    wanted = query.strip().lower()
    for result in results:
        suggestion = to_suggestion(result)
        if suggestion is None:
            continue
        key = (
            suggestion.name.lower(),
            suggestion.country_code,
            round(suggestion.lat, 1),
            round(suggestion.lon, 1),
        )
        if key in seen:
            continue
        seen.add(key)
        ranked.append((suggestion.name.lower() == wanted, _importance(result), suggestion))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [suggestion for _, _, suggestion in ranked[:limit]]


async def search_destinations(
    query: str, api_key: str, client: httpx.AsyncClient
) -> list[DestinationSuggestion]:
    cache_key = query.strip().lower()
    cached = _cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]

    params = {"text": query, "format": "json", "limit": 6, "lang": "en", "apiKey": api_key}
    responses = await asyncio.gather(
        client.get(f"{BASE_URL}/search", params=params),
        client.get(f"{BASE_URL}/autocomplete", params=params),
        return_exceptions=True,
    )
    results: list[dict[str, Any]] = []
    failures = 0
    for response in responses:
        if isinstance(response, BaseException) or response.status_code != 200:
            failures += 1
            continue
        results.extend(response.json().get("results", []))
    if failures == len(responses):
        raise ProviderError("Geoapify didn't respond. Check your GEOAPIFY_API_KEY and internet connection.")

    suggestions = merge_results(query, results)
    if len(_cache) > 500:
        _cache.clear()
    _cache[cache_key] = (time.monotonic(), suggestions)
    return suggestions
