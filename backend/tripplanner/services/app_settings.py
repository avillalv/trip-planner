"""Preferences stored in the database, with .env values as defaults."""

from sqlalchemy.orm import Session

from tripplanner.config import get_settings
from tripplanner.models import AppSetting

HOME_CURRENCY = "home_currency"


def get_home_currency(db: Session) -> str:
    row = db.get(AppSetting, HOME_CURRENCY)
    return row.value if row else get_settings().home_currency.upper()


def set_home_currency(db: Session, code: str) -> str:
    row = db.get(AppSetting, HOME_CURRENCY)
    if row is None:
        db.add(AppSetting(key=HOME_CURRENCY, value=code))
    else:
        row.value = code
    db.commit()
    return code
