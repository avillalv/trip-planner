from datetime import date, datetime, time, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field

from tripplanner.schemas.common import text
from tripplanner.schemas.itinerary import ActivityCategory

SuggestionMode = Literal["brainstorm", "surprise"]
SuggestionStatus = Literal["new", "added", "dismissed"]


def end_of(start: time | None, minutes: int | None) -> time | None:
    """When something starting at `start` and lasting `minutes` ends (past midnight, it wraps around)."""
    if start is None or not minutes:
        return None
    return (datetime.combine(date.min, start) + timedelta(minutes=minutes)).time()


class IdeasIn(BaseModel):
    mode: SuggestionMode = "brainstorm"
    message: text(1000) | None = None
    day: date | None = None


class SuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    run_id: UUID | None
    mode: SuggestionMode
    title: str
    category: ActivityCategory
    description: str
    why: str
    timing_note: str
    day: date | None
    start_time: time | None
    duration_min: int | None
    location_name: str | None
    url: str | None
    sources: list[str]
    status: SuggestionStatus
    activity_id: int | None
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def end_time(self) -> time | None:
        return end_of(self.start_time, self.duration_min)


class SuggestionUpdate(BaseModel):
    status: Literal["new", "dismissed"]


class AddSuggestionIn(BaseModel):
    as_idea: bool = False
