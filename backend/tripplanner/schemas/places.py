from typing import Literal

from pydantic import BaseModel

from tripplanner.schemas.itinerary import ActivityCategory

SearchKind = Literal[
    "restaurants", "cafes", "museums", "landmarks", "viewpoints", "parks", "beaches", "nightlife", "shopping"
]


class PlaceOut(BaseModel):
    """A place from a search, with whatever details the provider already returned."""

    provider: Literal["geoapify"]
    id: str
    name: str
    # The name in the local language, when it differs (handy to show a taxi driver).
    local_name: str | None = None
    category: ActivityCategory
    kinds: list[str]
    address: str | None = None
    lat: float
    lon: float
    distance_m: int | None = None
    website: str | None = None
    opening_hours: str | None = None
    phone: str | None = None
    wikidata: str | None = None
    wikipedia: str | None = None
    # False when only the basics came back (text search); details need their own lookup.
    has_details: bool = False


class PlaceSearchResult(BaseModel):
    places: list[PlaceOut]
    # Whether this answer came from the cache (no credits spent).
    cached: bool
    attribution: str = "Powered by Geoapify · © OpenStreetMap contributors"


class WikiSummary(BaseModel):
    title: str
    extract: str
    url: str | None
    image_url: str | None


class PlaceDetails(PlaceOut):
    wiki: WikiSummary | None = None
