from fastapi import APIRouter, HTTPException, Response, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.schemas.system import (
    AccessInfo,
    BackupStatus,
    HealthResponse,
    IntegrationStatus,
    SystemStatus,
    WorkerStatus,
)
from tripplanner.security import lan_addresses
from tripplanner.services import backups
from tripplanner.services.system_status import claude_cli_status, database_ok, worker_status

router = APIRouter()


def _backup_status(db: DbSession, db_ok: bool) -> BackupStatus:
    found = backups.list_backups()
    newest = found[0] if found else None
    return BackupStatus(
        directory=str(backups.backup_dir()),
        count=len(found),
        last_at=newest.created_at if newest else None,
        last_size=newest.size if newest else None,
        error=backups.last_error(db) if db_ok else None,
    )


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
def system_status(db: DbSession, recheck: bool = False) -> SystemStatus:
    """Setup checklist data: database, worker, Claude CLI, API keys, and network access.

    Claude's version and sign-in are cached for a few minutes; `recheck=true` asks again now.
    """
    settings = get_settings()
    db_ok = database_ok(db)
    open_to_network = settings.open_to_network
    return SystemStatus(
        version=__version__,
        database="ok" if db_ok else "unavailable",
        worker=worker_status(db) if db_ok else WorkerStatus(status="unknown"),
        claude=claude_cli_status(settings, fresh=recheck),
        integrations=IntegrationStatus(
            geoapify=settings.geoapify_api_key is not None,
            serpapi=settings.serpapi_api_key is not None,
            travelpayouts=settings.travelpayouts_token is not None,
            wikimedia=settings.wikimedia_contact is not None,
            agent_api=settings.agent_ingest_api_key is not None,
        ),
        access=AccessInfo(
            other_devices=open_to_network,
            passcode_configured=settings.app_passcode is not None,
            port=settings.port,
            urls=[f"http://{ip}:{settings.port}" for ip in lan_addresses()] if open_to_network else [],
            tailscale_urls=[
                f"https://{h}" for h in sorted(settings.extra_allowed_hosts) if h.endswith(".ts.net")
            ],
        ),
        backups=_backup_status(db, db_ok),
    )


@router.post("/api/v1/system/backup", response_model=BackupStatus, tags=["system"])
def back_up_now(db: DbSession) -> BackupStatus:
    """Back up the database now (the worker also does this every night)."""
    try:
        backups.run_backup()
    except backups.BackupError as exc:
        backups.record_error(db, str(exc))
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    backups.record_error(db, None)
    return _backup_status(db, db_ok=True)
