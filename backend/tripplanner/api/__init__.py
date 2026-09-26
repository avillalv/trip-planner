from fastapi import APIRouter

from tripplanner.api import system

api_router = APIRouter()
api_router.include_router(system.router)
