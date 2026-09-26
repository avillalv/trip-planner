from fastapi import APIRouter

from tripplanner.api.deps import DbSession
from tripplanner.schemas.settings import AppSettingsIn, AppSettingsOut
from tripplanner.services.app_settings import get_home_currency, set_home_currency

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("", response_model=AppSettingsOut)
def read_settings(db: DbSession) -> AppSettingsOut:
    return AppSettingsOut(home_currency=get_home_currency(db))


@router.put("", response_model=AppSettingsOut)
def update_settings(body: AppSettingsIn, db: DbSession) -> AppSettingsOut:
    return AppSettingsOut(home_currency=set_home_currency(db, body.home_currency))
