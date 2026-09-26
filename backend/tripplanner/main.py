"""FastAPI application factory."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.routing import APIRoute

from tripplanner import __version__
from tripplanner.api import api_router
from tripplanner.paths import FRONTEND_DIST
from tripplanner.security import access_guard
from tripplanner.spa import mount_frontend


def _operation_id(route: APIRoute) -> str:
    # Readable operation ids in the generated TypeScript client (e.g. "system_status").
    return route.name


def create_app(frontend_dist: Path = FRONTEND_DIST) -> FastAPI:
    app = FastAPI(
        title="Trip Planner API",
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        generate_unique_id_function=_operation_id,
    )
    app.middleware("http")(access_guard)
    app.include_router(api_router)
    # Registered last: the SPA catch-all must not shadow API routes.
    mount_frontend(app, frontend_dist)
    return app


app = create_app()
