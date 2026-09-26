"""Live Google Flights results via SerpApi (250 free searches a month).

One search covers one date pair but can include several airports on each side. For round
trips, each result is an outbound itinerary priced as the full round trip; return-leg details
would cost another search, so they aren't fetched.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any
from urllib.parse import quote

import httpx

from tripplanner.providers import ProviderError

SEARCH_URL = "https://serpapi.com/search.json"
ACCOUNT_URL = "https://serpapi.com/account.json"
TRAVEL_CLASS = {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}


def stops_param(max_stops: int | None) -> int:
    """Our max stops -> SerpApi `stops`: 0 any, 1 nonstop, 2 up to one stop, 3 up to two."""
    return 0 if max_stops is None else min(max_stops, 2) + 1


@dataclass(frozen=True)
class FlightOffer:
    origin: str
    destination: str
    price_total: Decimal
    airlines: list[str]
    stops_out: int
    duration_out_min: int | None
    depart_at_local: str | None
    flight_numbers: list[str]
    raw: dict[str, Any] = field(repr=False, compare=False)


@dataclass(frozen=True)
class PriceInsights:
    lowest_price: Decimal | None
    price_level: str | None
    typical_low: Decimal | None
    typical_high: Decimal | None
    history: list[list[float]]


@dataclass(frozen=True)
class FlightSearch:
    offers: list[FlightOffer]
    insights: PriceInsights | None
    google_flights_url: str


def google_flights_url(origins: list[str], destinations: list[str], depart: date, ret: date | None) -> str:
    """A Google Flights search link for the same airports and dates (for booking by hand)."""
    text = f"Flights from {','.join(origins)} to {','.join(destinations)} on {depart.isoformat()}"
    if ret:
        text += f" through {ret.isoformat()}"
    return f"https://www.google.com/travel/flights?q={quote(text)}"


def _decimal(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value)) if value is not None else None
    except ArithmeticError:
        return None


def to_offer(item: dict[str, Any]) -> FlightOffer | None:
    legs = item.get("flights") or []
    price = _decimal(item.get("price"))
    if not legs or price is None or price <= 0:
        return None
    airlines = list(dict.fromkeys(leg["airline"] for leg in legs if leg.get("airline")))
    return FlightOffer(
        origin=(legs[0].get("departure_airport") or {}).get("id", "").upper(),
        destination=(legs[-1].get("arrival_airport") or {}).get("id", "").upper(),
        price_total=price,
        airlines=airlines,
        stops_out=len(item.get("layovers") or []),
        duration_out_min=item.get("total_duration"),
        depart_at_local=(legs[0].get("departure_airport") or {}).get("time"),
        flight_numbers=[leg["flight_number"] for leg in legs if leg.get("flight_number")],
        raw=item,
    )


def to_insights(data: dict[str, Any] | None) -> PriceInsights | None:
    if not data:
        return None
    typical = data.get("typical_price_range") or [None, None]
    history = [
        [float(ts), float(price)] for ts, price in data.get("price_history") or [] if price is not None
    ]
    return PriceInsights(
        lowest_price=_decimal(data.get("lowest_price")),
        price_level=data.get("price_level"),
        typical_low=_decimal(typical[0]) if len(typical) > 0 else None,
        typical_high=_decimal(typical[1]) if len(typical) > 1 else None,
        history=history,
    )


def search_flights(
    client: httpx.Client,
    api_key: str,
    *,
    origins: list[str],
    destinations: list[str],
    depart_date: date,
    return_date: date | None,
    adults: int,
    children: int,
    cabin: str,
    max_stops: int | None,
    currency: str,
) -> FlightSearch:
    params: dict[str, Any] = {
        "engine": "google_flights",
        "api_key": api_key,
        "departure_id": ",".join(origins),
        "arrival_id": ",".join(destinations),
        "outbound_date": depart_date.isoformat(),
        "type": 1 if return_date else 2,
        "travel_class": TRAVEL_CLASS.get(cabin, 1),
        "stops": stops_param(max_stops),
        "adults": adults,
        "children": children,
        "currency": currency.upper(),
        "sort_by": 2,  # price
        "hl": "en",
        "gl": "us",
    }
    if return_date:
        params["return_date"] = return_date.isoformat()
    try:
        response = client.get(SEARCH_URL, params=params)
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError(f"SerpApi request failed: {exc}") from exc
    if response.status_code != 200 or body.get("error"):
        message = body.get("error") or f"HTTP {response.status_code}"
        # "no results" isn't a failure: the dates simply have no flights.
        if "hasn't returned any results" in str(message):
            return FlightSearch([], None, google_flights_url(origins, destinations, depart_date, return_date))
        raise ProviderError(f"SerpApi: {message}")

    items = (body.get("best_flights") or []) + (body.get("other_flights") or [])
    offers = [o for o in (to_offer(i) for i in items) if o is not None]
    offers.sort(key=lambda o: o.price_total)
    link = (body.get("search_metadata") or {}).get("google_flights_url")
    return FlightSearch(
        offers=offers,
        insights=to_insights(body.get("price_insights")),
        google_flights_url=link or google_flights_url(origins, destinations, depart_date, return_date),
    )


def account(client: httpx.Client, api_key: str) -> dict[str, Any]:
    """Plan usage from SerpApi's Account API (free; doesn't count as a search)."""
    try:
        response = client.get(ACCOUNT_URL, params={"api_key": api_key})
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError(f"SerpApi account lookup failed: {exc}") from exc
