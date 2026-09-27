import hmac

from fastapi import APIRouter, HTTPException, Request, Response, status

from tripplanner.config import get_settings
from tripplanner.schemas.auth import LoginIn, SessionInfo
from tripplanner.security import (
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    client_address,
    is_https,
    is_local_request,
    issue_session_token,
    login_limiter,
    request_is_authenticated,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/session", response_model=SessionInfo)
def session(request: Request) -> SessionInfo:
    settings = get_settings()
    return SessionInfo(
        authenticated=request_is_authenticated(request, settings),
        local=is_local_request(request),
        passcode_configured=settings.app_passcode is not None,
    )


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(body: LoginIn, request: Request, response: Response) -> None:
    settings = get_settings()
    if is_local_request(request):
        return
    if settings.app_passcode is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Access from other devices is turned off. Set APP_PASSCODE in .env on the computer "
            "running Trip Planner, then restart it.",
        )

    client_key = client_address(request)
    wait = login_limiter.retry_after(client_key)
    if wait is not None:
        minutes = max(1, round(wait / 60))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many wrong passcodes. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(wait)},
        )
    if not hmac.compare_digest(body.passcode.encode(), settings.app_passcode.get_secret_value().encode()):
        login_limiter.record_failure(client_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong passcode. Try again.")

    login_limiter.reset(client_key)
    response.set_cookie(
        SESSION_COOKIE,
        issue_session_token(settings),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=is_https(request),
        path="/",
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
