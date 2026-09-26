from fastapi import APIRouter, Response, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.schemas.system import (
    AccessInfo,
    HealthResponse,
    IntegrationStatus,
    SystemStatus,
    WorkerStatus,
)
from tripplanner.security import lan_addresses
from tripplanner.services.system_status import claude_cli_status, database_ok, worker_status

router = APIRouter()


@router.get("/api/health", response_model=HealthResponse, tags=["system"])
def health(db: DbSession, response: Response) -> HealthResponse:
    """Liveness check for scripts: 200 when the database is reachable, 503 otherwise."""
    db_ok = database_ok(db)
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        version=__version__,
        database="ok" if db_ok else "unavailable",
        worker=worker_status(db) if db_ok else WorkerStatus(status="unknown"),
    )


@router.get("/api/v1/system/status", response_model=SystemStatus, tags=["system"])
def system_status(db: DbSession) -> SystemStatus:
    """Setup checklist data: database, worker, Claude CLI, API keys, and network access."""
    settings = get_settings()
    db_ok = database_ok(db)
    open_to_network = settings.open_to_network
    return SystemStatus(
        version=__version__,
        database="ok" if db_ok else "unavailable",
        worker=worker_status(db) if db_ok else WorkerStatus(status="unknown"),
        claude=claude_cli_status(settings),
        integrations=IntegrationStatus(
            geoapify=settings.geoapify_api_key is not None,
            serpapi=settings.serpapi_api_key is not None,
            travelpayouts=settings.travelpayouts_token is not None,
            wikimedia=settings.wikimedia_contact is not None,
        ),
        access=AccessInfo(
            other_devices=open_to_network,
            passcode_configured=settings.app_passcode is not None,
            urls=[f"http://{ip}:{settings.port}" for ip in lan_addresses()] if open_to_network else [],
        ),
    )
