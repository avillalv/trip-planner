from pydantic import BaseModel, Field


class SessionInfo(BaseModel):
    authenticated: bool
    # True when the browser is on the computer running Trip Planner (no passcode needed).
    local: bool
    passcode_configured: bool


class LoginIn(BaseModel):
    passcode: str = Field(min_length=1, max_length=200)
