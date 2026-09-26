from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from tripplanner.schemas.common import CurrencyCode, text

LodgingStatus = Literal["candidate", "shortlisted", "booked", "rejected"]
LodgingSource = Literal["bookmarklet", "paste", "serpapi", "agent", "manual"]


def _http(value: str | None) -> str | None:
    if value and not value.lower().startswith(("http://", "https://")):
        raise ValueError("Links must start with http:// or https://")
    return value


def _photos(values: list[str]) -> list[str]:
    return [v for v in (s.strip() for s in values) if v.lower().startswith(("http://", "https://"))][:12]


class LodgingFields(BaseModel):
    title: text(300, min_length=1)
    url: text(2000) | None = None
    check_in: date | None = None
    check_out: date | None = None
    guests: int | None = Field(None, ge=1, le=30)
    price_total: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    price_per_night: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    currency: CurrencyCode | None = None
    photos: list[text(2000)] = Field(default_factory=list, max_length=30)
    location_name: text(300) | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    bedrooms: int | None = Field(None, ge=0, le=50)
    beds: int | None = Field(None, ge=0, le=100)
    baths: Decimal | None = Field(None, ge=0, le=50, max_digits=4, decimal_places=1)
    rating: Decimal | None = Field(None, ge=0, le=5, max_digits=3, decimal_places=2)
    review_count: int | None = Field(None, ge=0)
    notes: text(4000) = ""
    pros: text(2000) = ""
    cons: text(2000) = ""
    status: LodgingStatus = "candidate"
    favorite: bool = False

    _url = field_validator("url")(_http)
    _photo_links = field_validator("photos")(_photos)


class LodgingIn(LodgingFields):
    added_via: Literal["bookmarklet", "paste", "serpapi", "manual"] = "manual"
    raw: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "LodgingIn":
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValueError("Check-out must be after check-in.")
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Give both latitude and longitude, or neither.")
        if (self.price_total or self.price_per_night) and not self.currency:
            raise ValueError("Say which currency the price is in.")
        return self


class LodgingUpdate(BaseModel):
    """Only the fields sent change; send null to clear one."""

    title: text(300, min_length=1) | None = None
    url: text(2000) | None = None
    check_in: date | None = None
    check_out: date | None = None
    guests: int | None = Field(None, ge=1, le=30)
    price_total: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    price_per_night: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    currency: CurrencyCode | None = None
    photos: list[text(2000)] | None = Field(None, max_length=30)
    location_name: text(300) | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    bedrooms: int | None = Field(None, ge=0, le=50)
    beds: int | None = Field(None, ge=0, le=100)
    baths: Decimal | None = Field(None, ge=0, le=50, max_digits=4, decimal_places=1)
    rating: Decimal | None = Field(None, ge=0, le=5, max_digits=3, decimal_places=2)
    review_count: int | None = Field(None, ge=0)
    notes: text(4000) | None = None
    pros: text(2000) | None = None
    cons: text(2000) | None = None
    status: LodgingStatus | None = None
    favorite: bool | None = None

    _url = field_validator("url")(_http)

    @field_validator("photos")
    @classmethod
    def _photo_links(cls, values: list[str] | None) -> list[str] | None:
        return None if values is None else _photos(values)


class LodgingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    title: str
    url: str | None
    site: str | None
    check_in: date | None
    check_out: date | None
    nights: int | None
    guests: int | None
    price_total: Decimal | None
    price_per_night: Decimal | None
    currency: str | None
    price_home_total: Decimal | None
    home_currency: str
    photos: list[str]
    location_name: str | None
    lat: float | None
    lon: float | None
    bedrooms: int | None
    beds: int | None
    baths: Decimal | None
    rating: Decimal | None
    review_count: int | None
    notes: str
    pros: str
    cons: str
    status: LodgingStatus
    favorite: bool
    added_via: LodgingSource
    # People who hearted this option.
    hearts: list[int]
    created_at: datetime
    updated_at: datetime


class HeartIn(BaseModel):
    hearted: bool


class LinkPreviewIn(BaseModel):
    url: text(2000, min_length=8)
    # Fetch the page's title and photo too (only when the person asks; many sites block it).
    fetch: bool = False

    _url = field_validator("url")(_http)


class LinkPreview(BaseModel):
    url: str
    site: str | None
    check_in: date | None
    check_out: date | None
    guests: int | None
    title: str | None = None
    description: str | None = None
    photos: list[str] = Field(default_factory=list)
    fetched: bool = False
    fetch_problem: str | None = None


class RentalSearchIn(BaseModel):
    check_in: date
    check_out: date
    adults: int = Field(2, ge=1, le=16)
    children: int = Field(0, ge=0, le=10)
    # Where to look; defaults to the trip's first destination.
    place: text(120) | None = None

    @model_validator(mode="after")
    def _dates(self) -> "RentalSearchIn":
        if self.check_out <= self.check_in:
            raise ValueError("Check-out must be after check-in.")
        return self


class RentalOffer(BaseModel):
    title: str
    link: str | None
    site: str | None
    kind: str | None
    photos: list[str]
    price_total: Decimal | None
    price_per_night: Decimal | None
    currency: str
    rating: Decimal | None
    review_count: int | None
    lat: float | None
    lon: float | None
    sleeps: int | None
    bedrooms: int | None
    beds: int | None
    baths: Decimal | None
    details: list[str]
    property_token: str | None


class RentalSearchResult(BaseModel):
    offers: list[RentalOffer]
    cached: bool
    google_hotels_url: str | None
