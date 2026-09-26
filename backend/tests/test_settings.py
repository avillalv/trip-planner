from fastapi.testclient import TestClient


def test_home_currency_defaults_to_env_and_can_change(client: TestClient) -> None:
    assert client.get("/api/v1/settings").json() == {"home_currency": "USD"}

    assert client.put("/api/v1/settings", json={"home_currency": "eur"}).json() == {"home_currency": "EUR"}
    assert client.get("/api/v1/settings").json() == {"home_currency": "EUR"}


def test_home_currency_must_be_a_code(client: TestClient) -> None:
    assert client.put("/api/v1/settings", json={"home_currency": "euros"}).status_code == 422
