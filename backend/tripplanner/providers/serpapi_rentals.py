"""Vacation rentals from Google Hotels via SerpApi (one search of the monthly allowance each).

Results come from Google's rental partners, with prices for the given dates and party. Airbnb
listings may not be among them; the bookmarklet covers those.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tripplanner.providers import ProviderError
from tripplanner.providers.link_preview import site_name
from tripplanner.schemas.lodging import RentalOffer

SEARCH_URL = "https://serpapi.com/search.json"


def request_params(
    place: str, check_in: date, check_out: date, adults: int, children: int, currency: str
) -> dict[str, Any]:
    return {
        "engine": "google_hotels",
        "vacation_rentals": "true",
        "q": place,
        "check_in_date": check_in.isoformat(),
        "check_out_date": check_out.isoformat(),
        "adults": adults,
        "children": children,
        "currency": currency.upper(),
        "hl": "en",
        "gl": "us",
    }


def fetch(client: httpx.Client, params: dict[str, Any], api_key: str) -> dict[str, Any]:
    try:
        response = client.get(SEARCH_URL, params={**params, "api_key": api_key})
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError("Couldn't reach SerpApi. Check your internet connection.") from exc
    if response.status_code != 200 or body.get("error"):
        message = str(body.get("error") or f"HTTP {response.status_code}")
        if "hasn't returned any results" in message:
            return {"properties": []}
        raise ProviderError(f"SerpApi: {message}")
    return body


def _decimal(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value)) if value is not None else None
    except InvalidOperation:
        return None


def _count(details: list[str], pattern: str) -> Decimal | None:
    for item in details:
        match = re.fullmatch(pattern, item.strip(), flags=re.IGNORECASE)
        if match:
            return _decimal(match.group(1))
    return None


def _photos(item: dict[str, Any]) -> list[str]:
    # Full-size partner photos first; Google's thumbnail when that's all there is.
    urls = (image.get("original_image") or image.get("thumbnail") for image in item.get("images") or [])
    return [url for url in urls if url][:10]


def to_offer(item: dict[str, Any], currency: str) -> RentalOffer | None:
    name = item.get("name")
    if not name:
        return None
    details = [str(d) for d in item.get("essential_info") or []]
    kind = next((d for d in details if not re.search(r"\d", d)), None) or item.get("type")
    gps = item.get("gps_coordinates") or {}
    link = item.get("link") or None
    sources = [p.get("source") for p in item.get("prices") or [] if p.get("source")]
    sleeps, bedrooms, beds = (
        _count(details, r"sleeps (\d+)"),
        _count(details, r"(\d+) bedrooms?"),
        _count(details, r"(\d+) beds?"),
    )
    return RentalOffer(
        title=name,
        link=link,
        site=sources[0] if sources else (site_name(link) if link else None),
        kind=kind,
        photos=_photos(item),
        price_total=_decimal((item.get("total_rate") or {}).get("extracted_lowest")),
        price_per_night=_decimal((item.get("rate_per_night") or {}).get("extracted_lowest")),
        currency=currency.upper(),
        rating=_decimal(item.get("overall_rating")),
        review_count=item.get("reviews"),
        lat=gps.get("latitude"),
        lon=gps.get("longitude"),
        sleeps=int(sleeps) if sleeps is not None else None,
        bedrooms=int(bedrooms) if bedrooms is not None else None,
        beds=int(beds) if beds is not None else None,
        baths=_count(details, r"(\d+(?:\.\d)?) bathrooms?"),
        details=details,
        property_token=item.get("property_token"),
    )


def parse(data: dict[str, Any], currency: str) -> list[RentalOffer]:
    offers = (to_offer(item, currency) for item in data.get("properties") or [])
    return [o for o in offers if o is not None]
