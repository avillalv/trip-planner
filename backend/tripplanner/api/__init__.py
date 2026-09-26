from fastapi import APIRouter

from tripplanner.api import agent, auth, flights, geo, people, runs, settings, system, trips

api_router = APIRouter()
for module in (system, auth, people, trips, flights, runs, geo, settings, agent):
    api_router.include_router(module.router)
