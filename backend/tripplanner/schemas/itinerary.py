from datetime import date, datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from tripplanner.schemas.common import text

ActivityStatus = Literal["idea", "planned", "booked"]
ActivityCategory = Literal["sights", "museum", "food", "nature", "nightlife", "shopping", "travel", "other"]


def _check_link(value: str | None) -> str | None:
    if value and not value.lower().startswith(("http://", "https://")):
        raise ValueError("Links must start with http:// or https://")
    return value


class PlaceRef(BaseModel):
    """The place an activity was added from, as returned by the places search."""

    provider: Literal["geoapify"]
    id: text(500, min_length=1)
    data: dict[str, Any] = Field(default_factory=dict)


class ActivityFields(BaseModel):
    title: text(200, min_length=1)
    day: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    category: ActivityCategory = "other"
    status: ActivityStatus | None = None
    location_name: text(200) | None = None
    address: text(500) | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    url: text(2000) | None = None
    notes: text(4000) = ""

    _link = field_validator("url")(_check_link)


def check_times(day: date | None, start: time | None, end: time | None) -> None:
    if start is not None and day is None:
        raise ValueError("Pick a day before setting a time.")
    if end is not None and start is None:
        raise ValueError("Set a start time before an end time.")
    if start is not None and end == start:
        raise ValueError("The end time must be different from the start time.")


class ActivityIn(ActivityFields):
    place: PlaceRef | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "ActivityIn":
        check_times(self.day, self.start_time, self.end_time)
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Give both latitude and longitude, or neither.")
        return self


class ActivityUpdate(BaseModel):
    """Only the fields sent are changed; send null to clear one (e.g. `day: null` makes it an idea)."""

    version: int = Field(
        ge=1, description="The version you edited; a newer one on the server means a conflict."
    )
    title: text(200, min_length=1) | None = None
    day: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    category: ActivityCategory | None = None
    status: ActivityStatus | None = None
    location_name: text(200) | None = None
    address: text(500) | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    url: text(2000) | None = None
    notes: text(4000) | None = None

    _link = field_validator("url")(_check_link)


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    day: date | None
    start_time: time | None
    end_time: time | None
    title: str
    category: ActivityCategory
    status: ActivityStatus
    location_name: str | None
    address: str | None
    lat: float | None
    lon: float | None
    url: str | None
    notes: str
    place_provider: str | None
    place_id: str | None
    place_data: dict[str, Any] | None
    version: int
    created_at: datetime
    updated_at: datetime


class ActivityBrief(BaseModel):
    title: str
    start_time: time | None


class DayOut(BaseModel):
    day: date
    title: str
    notes: str
    destination_id: int | None
    destination_name: str | None
    timezone: str | None
    # False for a day outside the trip's dates that still has activities on it.
    in_trip: bool
    activity_count: int
    first: ActivityBrief | None
    last: ActivityBrief | None


class DayUpdate(BaseModel):
    title: text(120) | None = None
    notes: text(4000) | None = None
    destination_id: int | None = None
