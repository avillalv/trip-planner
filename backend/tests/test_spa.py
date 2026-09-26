"""The web server serves the built React app and falls back to index.html for client routes."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tripplanner.main import create_app


@pytest.fixture
def built_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('app')", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside dist", encoding="utf-8")
    return dist


def test_unbuilt_frontend_explains_how_to_build(tmp_path: Path) -> None:
    client = TestClient(
        create_app(frontend_dist=tmp_path / "missing"),
        base_url="http://localhost",
        client=("127.0.0.1", 50000),
    )

    response = client.get("/")

    assert response.status_code == 503
    assert "npm run build" in response.text


def test_client_side_routes_fall_back_to_index(built_dist: Path) -> None:
    client = TestClient(
        create_app(frontend_dist=built_dist), base_url="http://localhost", client=("127.0.0.1", 50000)
    )

    assert client.get("/").text == "<html>app</html>"
    assert client.get("/trips/abc/itinerary").text == "<html>app</html>"
    assert client.get("/assets/app.js").text == "console.log('app')"


def test_unknown_api_paths_are_404_not_the_app(built_dist: Path) -> None:
    client = TestClient(
        create_app(frontend_dist=built_dist), base_url="http://localhost", client=("127.0.0.1", 50000)
    )

    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


def test_paths_outside_dist_are_never_served(built_dist: Path) -> None:
    client = TestClient(
        create_app(frontend_dist=built_dist), base_url="http://localhost", client=("127.0.0.1", 50000)
    )

    response = client.get("/..%2Fsecret.txt")

    assert "outside dist" not in response.text
