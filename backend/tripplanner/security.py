"""Access control for a single-household app on a home network.

- Requests from this PC (loopback) are trusted, unless a proxy on this PC relayed them from another
  device (`tailscale serve` adds X-Forwarded-For).
- Other devices need a session cookie, obtained by entering APP_PASSCODE.
- The Host header must name this machine, which blocks DNS-rebinding attacks.
- State-changing API calls need the X-Trip-Planner header and a same-origin Origin, so other
  websites open in the same browser can't make changes (the browser won't send a custom header
  cross-origin without a CORS preflight, which this app never grants).
"""

import hashlib
import hmac
import ipaddress
import secrets
import socket
import time
from collections import deque
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

import psutil
from fastapi import Request, Response
from fastapi.responses import JSONResponse

from tripplanner.config import Settings, get_settings

SESSION_COOKIE = "tp_session"
SESSION_MAX_AGE = 30 * 24 * 3600
APP_HEADER = "x-trip-planner"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Paths under /api that manage their own access rules.
PUBLIC_API_PREFIXES = ("/api/auth/", "/api/health", "/api/agent/")

_ephemeral_secret = secrets.token_urlsafe(32)


def is_loopback(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def is_relayed(request: Request) -> bool:
    """True when a proxy on this PC (like `tailscale serve`) passed the request on from another device."""
    return "x-forwarded-for" in request.headers or "forwarded" in request.headers


def is_local_request(request: Request) -> bool:
    return request.client is not None and is_loopback(request.client.host) and not is_relayed(request)


def client_address(request: Request) -> str:
    """The device making the request: the address a proxy on this PC reports, else the socket peer."""
    peer = request.client.host if request.client else "unknown"
    if is_loopback(peer) and is_relayed(request):
        return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or peer
    return peer


def is_https(request: Request) -> bool:
    """HTTPS end to end, including through a proxy on this PC (`tailscale serve` terminates TLS)."""
    if request.url.scheme == "https":
        return True
    peer = request.client.host if request.client else None
    return is_loopback(peer) and request.headers.get("x-forwarded-proto") == "https"


# --- Sessions ----------------------------------------------------------------------------


def _session_secret(settings: Settings) -> bytes:
    # Without SESSION_SECRET, sessions last until the server restarts.
    raw = settings.session_secret.get_secret_value() if settings.session_secret else _ephemeral_secret
    return raw.encode()


def _passcode_fingerprint(passcode: str) -> str:
    # Changing APP_PASSCODE signs everyone out.
    return hashlib.sha256(passcode.encode()).hexdigest()[:16]


def issue_session_token(settings: Settings, now: float | None = None) -> str:
    passcode = settings.app_passcode.get_secret_value() if settings.app_passcode else ""
    payload = f"v1.{int(now or time.time())}.{_passcode_fingerprint(passcode)}"
    signature = hmac.new(_session_secret(settings), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def session_is_valid(token: str | None, settings: Settings, now: float | None = None) -> bool:
    if not token or settings.app_passcode is None:
        return False
    parts = token.split(".")
    if len(parts) != 4:
        return False
    version, issued, fingerprint, signature = parts
    expected = hmac.new(
        _session_secret(settings), f"{version}.{issued}.{fingerprint}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature, expected) or version != "v1" or not issued.isdigit():
        return False
    if fingerprint != _passcode_fingerprint(settings.app_passcode.get_secret_value()):
        return False
    return (now or time.time()) - int(issued) < SESSION_MAX_AGE


def request_is_authenticated(request: Request, settings: Settings) -> bool:
    return is_local_request(request) or session_is_valid(request.cookies.get(SESSION_COOKIE), settings)


# --- Login rate limiting -----------------------------------------------------------------


class LoginLimiter:
    """At most `max_failures` wrong passcodes per client within `window` seconds."""

    def __init__(self, max_failures: int = 5, window: float = 300) -> None:
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        attempts = self._failures.setdefault(key, deque())
        while attempts and now - attempts[0] >= self.window:
            attempts.popleft()
        return attempts

    def retry_after(self, key: str, now: float | None = None) -> int | None:
        now = time.monotonic() if now is None else now
        attempts = self._recent(key, now)
        if len(attempts) < self.max_failures:
            return None
        return max(1, int(self.window - (now - attempts[0])) + 1)

    def record_failure(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self._recent(key, now).append(now)

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


login_limiter = LoginLimiter()


# --- Host header allow-list ----------------------------------------------------------------


def _machine_addresses() -> set[str]:
    names = {socket.gethostname().lower()}
    names.add(f"{socket.gethostname().lower()}.local")
    for addresses in psutil.net_if_addrs().values():
        for address in addresses:
            if address.family in (socket.AF_INET, socket.AF_INET6):
                names.add(address.address.split("%")[0].lower())
    return names


def lan_addresses() -> list[str]:
    """This PC's private IPv4 addresses, for showing "open this on your phone" URLs."""
    stats = psutil.net_if_stats()
    found = []
    for name, addresses in psutil.net_if_addrs().items():
        if name in stats and not stats[name].isup:
            continue
        for address in addresses:
            if address.family != socket.AF_INET:
                continue
            ip = ipaddress.ip_address(address.address)
            if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                found.append(str(ip))
    return sorted(set(found))


class HostAllowList:
    def __init__(self) -> None:
        self._machine: set[str] = set()
        self._refreshed_at = 0.0

    def allows(self, host_header: str | None, settings: Settings) -> bool:
        host = _strip_port(host_header or "")
        if not host:
            return False
        if host in {"localhost", "127.0.0.1", "::1"} or host in settings.extra_allowed_hosts:
            return True
        if not settings.open_to_network:
            return False
        if host not in self._machine and time.monotonic() - self._refreshed_at > 30:
            # Network addresses can change (DHCP); re-read them at most every 30 s.
            self._machine = _machine_addresses()
            self._refreshed_at = time.monotonic()
        return host in self._machine


def _strip_port(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("["):  # [::1]:8000
        return host[1 : host.find("]")] if "]" in host else host
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


host_allow_list = HostAllowList()


# --- Middleware ------------------------------------------------------------------------------


def _deny(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


async def access_guard(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    settings = get_settings()
    if not host_allow_list.allows(request.headers.get("host"), settings):
        return _deny(400, "This address isn't allowed. Open Trip Planner using this computer's name or IP.")

    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/agent/"):
        if request.method not in SAFE_METHODS:
            if request.headers.get(APP_HEADER) != "1":
                return _deny(403, "Requests that change data must come from the Trip Planner app.")
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).netloc.lower() != (request.headers.get("host") or "").lower():
                return _deny(403, "Cross-site requests are not allowed.")
        if not path.startswith(PUBLIC_API_PREFIXES) and not request_is_authenticated(request, settings):
            return _deny(401, "Enter the passcode to continue.")

    return await call_next(request)
