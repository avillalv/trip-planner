"""Seed the airports table from OurAirports (public domain, refreshed nightly upstream)."""

import csv
import io
import logging
import re

import httpx
from sqlalchemy.dialects.postgresql import insert

from tripplanner.db import get_engine
from tripplanner.models import Airport
from tripplanner.paths import CACHE_DIR

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
CACHE_FILE = CACHE_DIR / "ourairports-airports.csv"
KIND_RANK = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
IATA_RE = re.compile(r"^[A-Z]{3}$")

log = logging.getLogger(__name__)


def parse_airports(csv_text: str) -> list[dict[str, object]]:
    """Keep airports with an IATA code and scheduled service; one row per code (largest wins)."""
    best: dict[str, dict[str, object]] = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        iata = (row.get("iata_code") or "").strip().upper()
        kind = row.get("type", "")
        if not IATA_RE.match(iata) or kind not in KIND_RANK or row.get("scheduled_service") != "yes":
            continue
        try:
            lat, lon = float(row["latitude_deg"]), float(row["longitude_deg"])
        except (KeyError, ValueError):
            continue
        icao = (row.get("icao_code") or row.get("gps_code") or "").strip().upper()
        record = {
            "iata": iata,
            "icao": icao if len(icao) == 4 else None,
            "name": row["name"].strip()[:200],
            "city": (row.get("municipality") or "").strip()[:120] or None,
            "country_code": row["iso_country"].strip().upper()[:2],
            "region_code": (row.get("iso_region") or "").strip()[:10] or None,
            "lat": lat,
            "lon": lon,
            "kind": kind,
        }
        current = best.get(iata)
        if current is None or KIND_RANK[kind] > KIND_RANK[str(current["kind"])]:
            best[iata] = record
    return list(best.values())


def _load_csv(refresh: bool) -> str:
    if refresh or not CACHE_FILE.exists():
        log.info("Downloading airport data from OurAirports...")
        response = httpx.get(OURAIRPORTS_URL, timeout=60, follow_redirects=True)
        response.raise_for_status()
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(response.text, encoding="utf-8")
    return CACHE_FILE.read_text(encoding="utf-8")


def seed_airports(refresh: bool = False) -> int:
    rows = parse_airports(_load_csv(refresh))
    stmt = insert(Airport)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Airport.iata],
        set_={
            col: stmt.excluded[col]
            for col in ("icao", "name", "city", "country_code", "region_code", "lat", "lon", "kind")
        },
    )
    with get_engine().begin() as conn:
        for start in range(0, len(rows), 1000):
            conn.execute(stmt, rows[start : start + 1000])
    log.info("Seeded %d airports", len(rows))
    return len(rows)
