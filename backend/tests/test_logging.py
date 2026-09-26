import logging

import pytest

from tripplanner.process import RedactSecrets


@pytest.mark.parametrize(
    "message",
    [
        "GET https://serpapi.com/search.json?engine=google_flights&api_key=abc123&x=1",
        "GET https://api.geoapify.com/v1/geocode/search?text=Bali&apiKey=abc123",
        "GET https://example.com/?token=abc123",
    ],
)
def test_keys_in_urls_are_masked(message: str) -> None:
    record = logging.LogRecord("httpx", logging.INFO, __file__, 1, "HTTP Request: %s", (message,), None)

    RedactSecrets().filter(record)

    assert "abc123" not in record.getMessage()
    assert "=***" in record.getMessage()


def test_ordinary_messages_are_untouched() -> None:
    record = logging.LogRecord("app", logging.INFO, __file__, 1, "Checked %d routes", (3,), None)

    RedactSecrets().filter(record)

    assert record.getMessage() == "Checked 3 routes"
