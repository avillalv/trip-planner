from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_airport


def test_people_crud(client: TestClient, db_session: Session) -> None:
    add_airport(db_session, "LAX", "Los Angeles")

    created = client.post(
        "/api/v1/people", json={"name": " Alex ", "color": "#C24472", "home_airports": ["lax"]}
    )
    assert created.status_code == 201
    person = created.json()
    assert person["name"] == "Alex"
    assert person["home_airports"] == ["LAX"]

    updated = client.put(f"/api/v1/people/{person['id']}", json={"name": "Alex R.", "color": "#1f7f86"})
    assert updated.json()["name"] == "Alex R."
    assert updated.json()["home_airports"] == []

    assert [p["name"] for p in client.get("/api/v1/people").json()] == ["Alex R."]
    assert client.delete(f"/api/v1/people/{person['id']}").status_code == 204
    assert client.get("/api/v1/people").json() == []


def test_unknown_home_airport_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/people", json={"name": "Sam", "color": "#1f7f86", "home_airports": ["ZZZ"]}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown airport code(s): ZZZ"


def test_person_validation(client: TestClient) -> None:
    assert client.post("/api/v1/people", json={"name": "", "color": "#1f7f86"}).status_code == 422
    assert client.post("/api/v1/people", json={"name": "Sam", "color": "teal"}).status_code == 422
    assert client.put("/api/v1/people/999", json={"name": "Sam", "color": "#1f7f86"}).status_code == 404
