from fastapi import APIRouter

from tripplanner.api import (
    agent,
    auth,
    flights,
    geo,
    itinerary,
    lodging,
    people,
    places,
    runs,
    settings,
    suggestions,
    system,
    trips,
    weather,
)

api_router = APIRouter()
for module in (
    system,
    auth,
    people,
    trips,
    flights,
    itinerary,
    places,
    lodging,
    runs,
    geo,
    settings,
    agent,
    suggestions,
    weather,
):
    api_router.include_router(module.router)
