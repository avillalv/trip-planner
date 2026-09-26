from fastapi import APIRouter

from tripplanner.api import (
    agent,
    auth,
    flights,
    geo,
    itinerary,
    people,
    places,
    runs,
    settings,
    system,
    trips,
)

api_router = APIRouter()
for module in (system, auth, people, trips, flights, itinerary, places, runs, geo, settings, agent):
    api_router.include_router(module.router)
