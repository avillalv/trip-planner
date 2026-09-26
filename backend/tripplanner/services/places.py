"""Places search with a response cache, so repeating a search costs no Geoapify credits."""

import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tripplanner.models import ApiCall, PlaceCacheEntry
from tripplanner.providers import geoapify_places as geo
from tripplanner.providers.wikipedia import WikipediaClient
from tripplanner.schemas.places import PlaceOut, PlaceSearchResult, WikiSummary

SEARCH_TTL = timedelta(days=7)
WIKI_TTL = timedelta(days=30)

log = logging.getLogger(__name__)


def cache_key(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


def cache_get(db: Session, key: str, now: datetime) -> Any | None:
    entry = db.get(PlaceCacheEntry, key)
    return entry.response if entry is not None and entry.expires_at > now else None


def cache_put(db: Session, key: str, provider: str, response: Any, now: datetime, ttl: timedelta) -> None:
    stmt = insert(PlaceCacheEntry).values(
        key=key, provider=provider, response=response, fetched_at=now, expires_at=now + ttl
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[PlaceCacheEntry.key],
            set_={"response": stmt.excluded.response, "fetched_at": now, "expires_at": now + ttl},
        )
    )
    # Expired entries are cleared as new ones arrive, so the table stays small.
    db.execute(delete(PlaceCacheEntry).where(PlaceCacheEntry.expires_at < now))


def _geoapify(
    db: Session,
    client: httpx.Client,
    api_key: str,
    request: tuple[str, dict[str, Any]],
    endpoint: str,
    now: datetime,
) -> tuple[dict[str, Any], bool]:
    url, params = request
    key = cache_key("geoapify", url, params)
    cached = cache_get(db, key, now)
    if cached is not None:
        return cached, True
    data = geo.fetch(client, url, params, api_key)
    cache_put(db, key, "geoapify", data, now, SEARCH_TTL)
    db.add(ApiCall(provider="geoapify", endpoint=endpoint, units=1, cached=False, status_code=200, ok=True))
    db.commit()
    return data, False


def search(
    db: Session,
    client: httpx.Client,
    api_key: str,
    *,
    lat: float,
    lon: float,
    radius_m: int,
    kind: str | None = None,
    text: str | None = None,
    offset: int = 0,
    now: datetime | None = None,
) -> PlaceSearchResult:
    """Search by category chip, or by free text when no chip is chosen."""
    now = now or datetime.now(UTC)
    # Rounding the center lets small map moves reuse a cached search.
    lat, lon = round(lat, 3), round(lon, 3)
    if kind is not None:
        data, cached = _geoapify(
            db, client, api_key, geo.kind_request(kind, lat, lon, radius_m, offset), "places", now
        )
        places = geo.parse_places(data)
    else:
        assert text
        data, cached = _geoapify(
            db, client, api_key, geo.text_request(text.strip(), lat, lon, radius_m), "geocode", now
        )
        places = geo.parse_geocode(data)
    places.sort(key=lambda p: p.distance_m if p.distance_m is not None else 10**9)
    return PlaceSearchResult(places=places, cached=cached)


def details(
    db: Session, client: httpx.Client, api_key: str, place_id: str, now: datetime | None = None
) -> PlaceOut | None:
    now = now or datetime.now(UTC)
    data, _ = _geoapify(db, client, api_key, geo.details_request(place_id), "place-details", now)
    return geo.parse_details(data)


def wiki_summary(
    db: Session,
    wiki: WikipediaClient,
    wikidata: str | None,
    wikipedia: str | None,
    now: datetime | None = None,
) -> WikiSummary | None:
    """The English Wikipedia lead for a place, found through its Wikidata item (cached, including misses)."""
    now = now or datetime.now(UTC)
    key = cache_key("wiki", wikidata, wikipedia)
    cached = cache_get(db, key, now)
    if cached is not None:
        return WikiSummary.model_validate(cached) if cached else None

    title = None
    try:
        if wikidata:
            title = wiki.english_title(wikidata)
        if title is None and wikipedia and wikipedia.startswith("en:"):
            title = wikipedia[3:]
        article = wiki.article(title) if title else None
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        log.warning("Wikipedia lookup failed for %s: %s", wikidata or wikipedia, exc)
        return None

    summary = (
        WikiSummary(
            title=article.title, extract=article.extract, url=article.page_url, image_url=article.image_url
        )
        if article and article.extract
        else None
    )
    cache_put(db, key, "wikipedia", summary.model_dump() if summary else {}, now, WIKI_TTL)
    db.commit()
    return summary
