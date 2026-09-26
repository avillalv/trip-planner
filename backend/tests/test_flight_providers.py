import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
import respx

from tripplanner.providers import ProviderError, frankfurter, serpapi, travelpayouts

FIXTURES = Path(__file__).parent / "fixtures"


def serpapi_fixture() -> dict:
    return json.loads((FIXTURES / "serpapi_google_flights_roundtrip.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize(("max_stops", "expected"), [(None, 0), (0, 1), (1, 2), (2, 3)])
def test_stop_limits_map_to_serpapi_values(max_stops: int | None, expected: int) -> None:
    assert serpapi.stops_param(max_stops) == expected


def test_search_parses_offers_insights_and_link(no_real_network: respx.MockRouter) -> None:
    route = no_real_network.get(serpapi.SEARCH_URL).mock(
        return_value=httpx.Response(200, json=serpapi_fixture())
    )

    with httpx.Client() as client:
        result = serpapi.search_flights(
            client,
            "key",
            origins=["LAX", "SFO"],
            destinations=["NRT", "HND"],
            depart_date=date(2026, 11, 5),
            return_date=date(2026, 11, 15),
            adults=2,
            children=0,
            cabin="economy",
            max_stops=None,
            currency="USD",
        )

    sent = route.calls.last.request.url.params
    assert sent["departure_id"] == "LAX,SFO"
    assert sent["type"] == "1"
    assert sent["sort_by"] == "2"
    assert [o.price_total for o in result.offers] == sorted(o.price_total for o in result.offers)
    cheapest = result.offers[0]
    assert cheapest.price_total == Decimal(1859)
    assert cheapest.origin == "LAX" and cheapest.destination in {"NRT", "HND"}
    assert cheapest.airlines == ["Philippine Airlines"]
    assert cheapest.stops_out == 1
    assert cheapest.flight_numbers == ["PR 113", "PR 430"]
    assert result.insights is not None
    assert (result.insights.price_level, result.insights.typical_low) == ("high", Decimal(1050))
    assert result.google_flights_url == "https://www.google.com/travel/flights?tfs=fixture"


def test_no_results_is_an_empty_search_not_an_error(no_real_network: respx.MockRouter) -> None:
    body = {"error": "Google Flights hasn't returned any results for this query."}
    no_real_network.get(serpapi.SEARCH_URL).mock(return_value=httpx.Response(200, json=body))

    with httpx.Client() as client:
        result = serpapi.search_flights(
            client,
            "key",
            origins=["LAX"],
            destinations=["NRT"],
            depart_date=date(2026, 11, 5),
            return_date=None,
            adults=1,
            children=0,
            cabin="economy",
            max_stops=0,
            currency="USD",
        )

    assert result.offers == []
    assert "Flights%20from%20LAX%20to%20NRT%20on%202026-11-05" in result.google_flights_url


def test_invalid_key_raises(no_real_network: respx.MockRouter) -> None:
    no_real_network.get(serpapi.SEARCH_URL).mock(
        return_value=httpx.Response(401, json={"error": "Invalid API key."})
    )

    with httpx.Client() as client, pytest.raises(ProviderError, match="Invalid API key"):
        serpapi.search_flights(
            client,
            "bad",
            origins=["LAX"],
            destinations=["NRT"],
            depart_date=date(2026, 11, 5),
            return_date=None,
            adults=1,
            children=0,
            cabin="economy",
            max_stops=None,
            currency="USD",
        )


TP_ROW = {
    "origin": "LAX",
    "destination": "TYO",
    "origin_airport": "LAX",
    "destination_airport": "NRT",
    "departure_at": "2026-11-10T11:30:00-08:00",
    "return_at": "2026-11-17T10:55:00+09:00",
    "price": 760,
    "airline": "MU",
    "flight_number": "586",
    "transfers": 1,
    "return_transfers": 1,
    "duration_to": 1020,
    "duration_back": 945,
    "link": "/search/LAX1011TYO17111?t=abc&search_date=21092026&expected_price=760",
}


def test_cached_fare_uses_real_airports_local_dates_and_found_date() -> None:
    fare = travelpayouts.to_fare(TP_ROW, "usd")

    assert fare is not None
    assert (fare.origin, fare.destination) == ("LAX", "NRT")
    assert (fare.depart_date, fare.return_date) == (date(2026, 11, 10), date(2026, 11, 17))
    assert fare.depart_at_local == "2026-11-10 11:30"
    assert fare.price_per_adult == Decimal(760)
    assert fare.flight_number == "MU 586"
    assert fare.found_at == datetime(2026, 9, 21, 12, tzinfo=UTC)
    assert fare.link.startswith("https://www.aviasales.com/search/LAX1011TYO17111")


def test_prices_for_dates_requests_a_month_and_reports_failures(no_real_network: respx.MockRouter) -> None:
    route = no_real_network.get(f"{travelpayouts.BASE_URL}/prices_for_dates").mock(
        side_effect=[
            httpx.Response(200, json={"success": True, "currency": "usd", "data": [TP_ROW]}),
            httpx.Response(200, json={"success": False, "error": "Unauthorized"}),
        ]
    )

    with httpx.Client() as client:
        fares = travelpayouts.prices_for_dates(
            client,
            "token",
            origin="LAX",
            destination="NRT",
            departure_month="2026-11",
            return_month="2026-11",
            currency="USD",
        )
        with pytest.raises(ProviderError, match="Unauthorized"):
            travelpayouts.prices_for_dates(
                client,
                "token",
                origin="LAX",
                destination="NRT",
                departure_month="2026-11",
                return_month=None,
                currency="USD",
            )

    assert len(fares) == 1
    first = route.calls[0].request
    assert first.headers["x-access-token"] == "token"
    assert first.url.params["one_way"] == "false"
    assert route.calls[1].request.url.params["one_way"] == "true"


def test_exchange_rates_include_eur(no_real_network: respx.MockRouter) -> None:
    rows = [
        {"date": "2026-09-26", "base": "EUR", "quote": "USD", "rate": 1.08},
        {"date": "2026-09-25", "base": "EUR", "quote": "JPY", "rate": 171.2},
    ]
    no_real_network.get(frankfurter.RATES_URL).mock(return_value=httpx.Response(200, json=rows))

    with httpx.Client() as client:
        rates = frankfurter.latest_rates_per_eur(client)

    assert rates["USD"] == (Decimal("1.08"), date(2026, 9, 26))
    assert rates["EUR"] == (Decimal(1), date(2026, 9, 26))
