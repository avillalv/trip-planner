from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from tripplanner.schemas.common import CountryCode, CurrencyCode, text
from tripplanner.schemas.people import PersonOut

TripStatus = Literal["planning", "booked", "done", "archived"]
InfoStatus = Literal["pending", "ready", "not_found", "failed", "skipped"]


class DestinationIn(BaseModel):
    id: int | None = Field(None, description="Set for destinations that already belong to the trip.")
    name: text(120, min_length=1)
    region: text(120) | None = None
    country: text(120) | None = None
    country_code: CountryCode | None = None
    kind: text(20) | None = None
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    timezone: str | None = None
    bbox: list[float] | None = Field(None, min_length=4, max_length=4)
    geoapify_place_id: text(600) | None = None

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown time zone: {value}") from exc
        return value


class DestinationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
    name: str
    region: str | None
    country: str | None
    country_code: str | None
    kind: str | None
    lat: float
    lon: float
    timezone: str | None
    bbox: list[float] | None
    # Geoapify's id for the place: lets a search cover all of it (its boundary).
    geoapify_place_id: str | None = None
    summary: str | None
    wiki_url: str | None
    image_url: str | None
    image_file: str | None
    info_status: InfoStatus


class TripIn(BaseModel):
    name: text(120, min_length=1)
    start_date: date | None = None
    end_date: date | None = None
    status: TripStatus = "planning"
    home_currency: CurrencyCode
    notes: str = Field("", max_length=10_000)
    destinations: list[DestinationIn] = Field(default_factory=list, max_length=12)
    traveler_ids: list[int] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def check_dates(self) -> "TripIn":
        if (self.start_date is None) != (self.end_date is None):
            raise ValueError("Set both a start and an end date, or leave both empty.")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("The end date must be on or after the start date.")
        return self


class TripCover(BaseModel):
    image_url: str
    image_file: str | None
    wiki_url: str | None
    destination_name: str


class ChosenFlight(BaseModel):
    route_id: int
    origin: str
    destination: str
    depart_date: date
    return_date: date | None
    airlines: list[str]


class FlightDates(BaseModel):
    """The trip's dates when chosen flights set them: the first departure to the last return.

    `end` is None when no chosen flight sets it (a single one-way flight); then only `start` is fixed.
    """

    start: date
    end: date | None
    flights: list[ChosenFlight]


class TripOut(BaseModel):
    id: int
    name: str
    start_date: date | None
    end_date: date | None
    status: TripStatus
    home_currency: str
    notes: str
    destinations: list[DestinationOut]
    travelers: list[PersonOut]
    cover: TripCover | None
    flight_dates: FlightDates | None = None
    created_at: datetime
    updated_at: datetime
