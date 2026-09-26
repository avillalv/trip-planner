"""Access rules: this PC is trusted; other devices need the passcode; other sites can't write."""

import time

import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSCODE
from tripplanner.security import HostAllowList, _strip_port, issue_session_token, session_is_valid


def test_this_pc_needs_no_passcode(client: TestClient) -> None:
    assert client.get("/api/v1/trips").status_code == 200
    assert client.get("/api/auth/session").json() == {
        "authenticated": True,
        "local": True,
        "passcode_configured": True,
    }


def test_other_devices_must_log_in(remote_client: TestClient) -> None:
    response = remote_client.get("/api/v1/trips")

    assert response.status_code == 401
    assert response.json()["detail"] == "Enter the passcode to continue."
    assert remote_client.get("/api/auth/session").json()["authenticated"] is False


def test_health_and_the_web_app_stay_reachable_without_login(remote_client: TestClient) -> None:
    assert remote_client.get("/api/health").status_code == 200
    # The SPA shell itself holds no data; it shows the passcode screen.
    assert remote_client.get("/").status_code == 503  # frontend not built in tests


def test_correct_passcode_starts_a_session(remote_client: TestClient) -> None:
    login = remote_client.post("/api/auth/login", json={"passcode": TEST_PASSCODE})

    assert login.status_code == 204
    cookie = login.headers["set-cookie"]
    assert "tp_session=" in cookie
    assert "HttpOnly" in cookie
    assert "samesite=lax" in cookie.lower()
    assert remote_client.get("/api/v1/trips").status_code == 200


def test_wrong_passcodes_are_rate_limited(remote_client: TestClient) -> None:
    for _ in range(5):
        response = remote_client.post("/api/auth/login", json={"passcode": "nope"})
        assert response.status_code == 401
        assert response.json()["detail"] == "Wrong passcode. Try again."

    blocked = remote_client.post("/api/auth/login", json={"passcode": TEST_PASSCODE})

    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    assert "Too many wrong passcodes" in blocked.json()["detail"]


def test_login_is_refused_when_no_passcode_is_configured(remote_client: TestClient, use_settings) -> None:
    use_settings(app_passcode=None)

    response = remote_client.post("/api/auth/login", json={"passcode": "anything"})

    assert response.status_code == 403
    assert "APP_PASSCODE" in response.json()["detail"]


def test_logout_clears_the_cookie(remote_client: TestClient) -> None:
    remote_client.post("/api/auth/login", json={"passcode": TEST_PASSCODE})

    response = remote_client.post("/api/auth/logout")

    assert response.status_code == 204
    assert remote_client.get("/api/v1/trips").status_code == 401


def test_changing_the_passcode_or_waiting_30_days_ends_sessions(use_settings) -> None:
    settings = use_settings()
    token = issue_session_token(settings)
    assert session_is_valid(token, settings)
    assert not session_is_valid(token, settings, now=time.time() + 31 * 24 * 3600)
    assert not session_is_valid(token, use_settings(app_passcode="a-new-passcode"))
    assert not session_is_valid(token + "0", settings)


def test_writes_need_the_app_header(client: TestClient) -> None:
    response = client.post(
        "/api/v1/people", json={"name": "Sam", "color": "#1f7f86"}, headers={"X-Trip-Planner": ""}
    )

    assert response.status_code == 403


def test_writes_from_other_origins_are_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/people", json={"name": "Sam", "color": "#1f7f86"}, headers={"Origin": "https://evil.example"}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-site requests are not allowed."


def test_unknown_host_names_are_rejected(client: TestClient) -> None:
    # A DNS-rebinding page would arrive with its own domain in the Host header.
    response = client.get("/api/v1/trips", headers={"Host": "rebind.evil.example:8000"})

    assert response.status_code == 400


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("localhost:8000", "localhost"),
        ("192.168.1.5:8000", "192.168.1.5"),
        ("[::1]:8000", "::1"),
        ("MyPC", "mypc"),
    ],
)
def test_host_header_ports_are_ignored(header: str, expected: str) -> None:
    assert _strip_port(header) == expected


def test_lan_mode_allows_this_machines_addresses(use_settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tripplanner.security._machine_addresses", lambda: {"192.168.1.23", "mypc"})
    allow = HostAllowList()

    assert not allow.allows("192.168.1.23:8000", use_settings(host="127.0.0.1"))
    lan = use_settings(host="0.0.0.0")
    assert allow.allows("192.168.1.23:8000", lan)
    assert allow.allows("MYPC:8000", lan)
    assert not allow.allows("evil.example", lan)
