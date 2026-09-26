from tripplanner.seed.airports import parse_airports

HEADER = (
    "id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,"
    "municipality,scheduled_service,icao_code,iata_code,gps_code,local_code,home_link,wikipedia_link,keywords\n"
)


def _row(kind: str, name: str, iata: str, scheduled: str = "yes", icao: str = "KLAX") -> str:
    return f"1,X,{kind},{name},33.94,-118.40,125,NA,US,US-CA,Los Angeles,{scheduled},{icao},{iata},,,,,\n"


def test_keeps_scheduled_airports_with_iata_codes() -> None:
    rows = parse_airports(HEADER + _row("large_airport", "Los Angeles International", "LAX"))

    assert rows == [
        {
            "iata": "LAX",
            "icao": "KLAX",
            "name": "Los Angeles International",
            "city": "Los Angeles",
            "country_code": "US",
            "region_code": "US-CA",
            "lat": 33.94,
            "lon": -118.40,
            "kind": "large_airport",
        }
    ]


def test_skips_heliports_unscheduled_and_codeless_rows() -> None:
    csv_text = (
        HEADER
        + _row("heliport", "Downtown Heliport", "JID")
        + _row("medium_airport", "Private Field", "PVF", scheduled="no")
        + _row("small_airport", "No Code Strip", "")
        + _row("closed", "Old Airport", "OLD")
    )

    assert parse_airports(csv_text) == []


def test_duplicate_codes_keep_the_largest_airport() -> None:
    csv_text = HEADER + _row("small_airport", "Tiny Strip", "ABC") + _row("large_airport", "Big Intl", "ABC")

    rows = parse_airports(csv_text)

    assert [(r["iata"], r["name"]) for r in rows] == [("ABC", "Big Intl")]
