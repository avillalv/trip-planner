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
    # From `claude auth status`; None when the CLI couldn't say.
    signed_in: bool | None = None
    auth_method: str | None = None


class IntegrationStatus(BaseModel):
    """Which API keys are configured. Values are never exposed, only presence."""

    geoapify: bool
    serpapi: bool
    travelpayouts: bool
    wikimedia: bool
    agent_api: bool


class AccessInfo(BaseModel):
    """Whether other devices can open the app, and at which addresses."""

    other_devices: bool
    passcode_configured: bool
    port: int
    urls: list[str]
    # Links that work from anywhere through `tailscale serve` (see `npm run share`).
    tailscale_urls: list[str]


class BackupStatus(BaseModel):
    """Nightly database backups: where they go, the newest one, and the last problem, if any."""

    directory: str
    count: int
    last_at: datetime | None
    last_size: int | None
    error: str | None


class SystemStatus(BaseModel):
    version: str
    database: Literal["ok", "unavailable"]
    worker: WorkerStatus
    claude: ClaudeCliStatus
    integrations: IntegrationStatus
    access: AccessInfo
    backups: BackupStatus
