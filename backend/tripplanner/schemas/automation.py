from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from tripplanner.schemas.common import text

RunStatus = Literal[
    "queued", "running", "succeeded", "partial", "failed", "timed_out", "cancelled", "interrupted"
]
RoutineKind = Literal["flight_api", "flight_agent", "research_agent"]


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    routine_id: int | None
    trip_id: int
    kind: RoutineKind
    trigger: Literal["schedule", "manual", "catch_up"]
    status: RunStatus
    params: dict[str, Any]
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    summary: str | None
    error: str | None
    accepted_count: int
    rejected_count: int
    input_tokens: int | None
    output_tokens: int | None
    cost_usd_est: Decimal | None
    cancel_requested: bool


class RunEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    ts: datetime
    type: str
    tool_name: str | None
    summary: str
    payload: dict[str, Any] | None


class RoutineOut(BaseModel):
    id: int
    trip_id: int
    name: str
    kind: RoutineKind
    enabled: bool
    schedule_cron: str
    timezone: str
    catch_up: bool
    config: dict[str, Any]
    next_run_at: datetime | None
    last_run: RunOut | None


class RoutineUpdate(BaseModel):
    name: text(80, min_length=1) | None = None
    enabled: bool | None = None
    schedule_cron: text(100, min_length=9) | None = None
    catch_up: bool | None = None


class RefreshRequest(BaseModel):
    route_ids: list[int] = Field(default_factory=list, max_length=20)
