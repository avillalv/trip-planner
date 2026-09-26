from pydantic import BaseModel, ConfigDict


class DestinationSuggestion(BaseModel):
    """A place a trip can go, as found by Geoapify."""

    label: str
    name: str
    region: str | None
    country: str | None
    country_code: str | None
    kind: str
    lat: float
    lon: float
    timezone: str | None
    bbox: list[float] | None
    geoapify_place_id: str | None


class AirportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    iata: str
    name: str
    city: str | None
    country_code: str
    kind: str
