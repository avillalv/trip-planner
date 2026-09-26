from pydantic import BaseModel, ConfigDict, Field

from tripplanner.schemas.common import HexColor, IataCode, text


class PersonIn(BaseModel):
    name: text(60, min_length=1)
    color: HexColor
    home_airports: list[IataCode] = Field(default_factory=list, max_length=6)


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    home_airports: list[str]
