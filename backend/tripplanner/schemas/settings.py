from pydantic import BaseModel

from tripplanner.schemas.common import CurrencyCode


class AppSettingsOut(BaseModel):
    home_currency: str


class AppSettingsIn(BaseModel):
    home_currency: CurrencyCode
