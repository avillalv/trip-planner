"""Reading a pasted listing link: the site, dates, and guests from the URL itself, and on request
the page's title and photo (like a chat app's link preview).

The page fetch happens only when someone asks for it, one request, with an honest User-Agent. It
refuses addresses on the local network, since phones on the home Wi-Fi can trigger it too.
"""

import ipaddress
import socket
from datetime import date, timedelta
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx

from tripplanner import __version__

MAX_BYTES = 1_500_000
MAX_REDIRECTS = 3

SITES = {
    "airbnb": "Airbnb",
    "vrbo": "Vrbo",
    "booking": "Booking.com",
    "agoda": "Agoda",
    "expedia": "Expedia",
    "hotels": "Hotels.com",
    "google": "Google",
    "tripadvisor": "Tripadvisor",
}

# Query parameter names the big sites use for dates and party size.
CHECK_IN = ("check_in", "checkin", "checkIn", "chkin", "startDate", "start_date", "arrival", "dateFrom")
CHECK_OUT = ("check_out", "checkout", "checkOut", "chkout", "endDate", "end_date", "departure", "dateTo")
ADULTS = ("adults", "group_adults", "numberOfAdults", "adult", "guests")
CHILDREN = ("children", "group_children", "numberOfChildren")


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def site_name(url: str) -> str | None:
    host = _host(url)
    if not host:
        return None
    labels = host.split(".")
    for label in labels[:-1]:
        if label in SITES:
            return SITES[label]
    return host


def normalize_url(url: str) -> str:
    """The listing's identity: host without www and path, no query or fragment (dates live there)."""
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/") or "/"
    return f"{_host(url)}{path}"


def _first(query: dict[str, list[str]], names: tuple[str, ...]) -> str | None:
    for name in names:
        if query.get(name):
            return query[name][0]
    return None


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value[:10]) if value else None
    except ValueError:
        return None


def _int(value: str | None) -> int | None:
    try:
        number = int(value) if value else None
    except ValueError:
        return None
    return number if number is not None and 0 <= number <= 30 else None


def parse_listing_url(url: str) -> tuple[date | None, date | None, int | None]:
    """Check-in, check-out, and number of guests, when the link carries them."""
    query = parse_qs(urlsplit(url).query)
    check_in = _date(_first(query, CHECK_IN))
    check_out = _date(_first(query, CHECK_OUT))
    nights = _int(_first(query, ("los", "nights")))
    if check_in and not check_out and nights:
        check_out = check_in + timedelta(days=nights)
    if check_in and check_out and check_out <= check_in:
        check_out = None
    adults = _int(_first(query, ADULTS))
    children = _int(_first(query, CHILDREN)) or 0
    guests = adults + children if adults else None
    return check_in, check_out, guests


class PreviewBlocked(Exception):
    """The page couldn't be read; the message says why, in plain words."""


def _check_public(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise PreviewBlocked("Only web links (http or https) can be previewed.")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise PreviewBlocked("That site's address couldn't be found.") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise PreviewBlocked("Links to this computer or your home network can't be previewed.")


class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key and values.get("content") and key not in self.meta:
                self.meta[key] = values["content"] or ""
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def fetch_preview(client: httpx.Client, url: str) -> tuple[str | None, str | None, list[str]]:
    """Title, description, and photo from the page's Open Graph tags (what chat apps show)."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        _check_public(current)
        try:
            with client.stream(
                "GET",
                current,
                headers={"User-Agent": f"TripPlanner/{__version__} (link preview)", "Accept": "text/html"},
                follow_redirects=False,
            ) as response:
                if response.is_redirect and response.headers.get("location"):
                    current = urljoin(current, response.headers["location"])
                    continue
                if response.status_code in (401, 403, 429) or response.status_code >= 500:
                    raise PreviewBlocked("The site didn't allow a preview. Fill in the details yourself.")
                if response.status_code != 200:
                    raise PreviewBlocked(f"The site answered with an error ({response.status_code}).")
                body = b""
                for chunk in response.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES or b"</head>" in body:
                        break
        except httpx.HTTPError as exc:
            raise PreviewBlocked("The site couldn't be reached.") from exc
        parser = _MetaParser()
        parser.feed(body.decode(response.encoding or "utf-8", errors="replace"))
        meta = parser.meta
        title = meta.get("og:title") or meta.get("twitter:title") or parser.title.strip() or None
        description = meta.get("og:description") or meta.get("description")
        image = meta.get("og:image") or meta.get("twitter:image")
        photos = [urljoin(current, image)] if image else []
        return title, description, photos
    raise PreviewBlocked("The link redirected too many times.")
