from fastapi import APIRouter

from tripplanner.api import auth, geo, people, settings, system, trips

api_router = APIRouter()
for module in (system, auth, people, trips, geo, settings):
    api_router.include_router(module.router)
