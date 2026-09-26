from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class WorkerStatus(BaseModel):
    status: Literal["ok", "stale", "never_started", "unknown"]
    last_seen: datetime | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    database: Literal["ok", "unavailable"]
    worker: WorkerStatus


class ClaudeCliStatus(BaseModel):
    found: bool
    path: str | None = None
    version: str | None = None


class IntegrationStatus(BaseModel):
    """Which API keys are configured. Values are never exposed, only presence."""

    geoapify: bool
    serpapi: bool
    travelpayouts: bool


class SystemStatus(BaseModel):
    version: str
    database: Literal["ok", "unavailable"]
    worker: WorkerStatus
    claude: ClaudeCliStatus
    integrations: IntegrationStatus
    home_currency: str
