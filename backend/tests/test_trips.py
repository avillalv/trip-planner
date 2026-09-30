from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_person, destination, trip_payload
from tripplanner.models import TripDestination


def test_create_trip_with_destinations_and_travelers(client: TestClient, db_session: Session) -> None:
    alex, sam = add_person(db_session, "Alex"), add_person(db_session, "Sam", "#1f7f86")
    payload = trip_payload(
        destinations=[destination("Tokyo", lat=35.68, lon=139.76), destination("Kyoto")],
        traveler_ids=[sam.id, alex.id],
    )

    response = client.post("/api/v1/trips", json=payload)

    assert response.status_code == 201
    trip = response.json()
    assert trip["name"] == "Japan in autumn"
    assert trip["home_currency"] == "USD"
    assert [d["name"] for d in trip["destinations"]] == ["Tokyo", "Kyoto"]
    assert [d["position"] for d in trip["destinations"]] == [0, 1]
    assert trip["destinations"][0]["country_code"] == "JP"
    assert trip["destinations"][0]["info_status"] == "pending"
    assert [t["name"] for t in trip["travelers"]] == ["Alex", "Sam"]
    assert trip["cover"] is None
    assert client.get(f"/api/v1/trips/{trip['id']}").json() == trip


def test_trips_can_be_undated(client: TestClient) -> None:
    response = client.post("/api/v1/trips", json=trip_payload(start_date=None, end_date=None))

    assert response.status_code == 201
    assert response.json()["start_date"] is None


def test_date_rules(client: TestClient) -> None:
    backwards = client.post(
        "/api/v1/trips", json=trip_payload(start_date="2026-11-15", end_date="2026-11-05")
    )
    half = client.post("/api/v1/trips", json=trip_payload(end_date=None))

    assert backwards.status_code == 422
    assert "end date must be on or after the start date" in backwards.text
    assert half.status_code == 422
    assert "Set both a start and an end date" in half.text


def test_trip_validation(client: TestClient) -> None:
    assert client.post("/api/v1/trips", json=trip_payload(name="  ")).status_code == 422
    assert client.post("/api/v1/trips", json=trip_payload(home_currency="dollars")).status_code == 422
    bad_tz = trip_payload(destinations=[destination(timezone="Mars/Olympus")])
    assert "Unknown time zone" in client.post("/api/v1/trips", json=bad_tz).text
    unknown_person = client.post("/api/v1/trips", json=trip_payload(traveler_ids=[4242]))
    assert unknown_person.status_code == 422
    assert unknown_person.json()["detail"] == "Unknown traveler id(s): 4242"


def test_update_keeps_fetched_info_for_unchanged_destinations(
    client: TestClient, db_session: Session
) -> None:
    trip = client.post(
        "/api/v1/trips", json=trip_payload(destinations=[destination("Tokyo"), destination("Kyoto")])
    ).json()
    tokyo_id, kyoto_id = (d["id"] for d in trip["destinations"])
    tokyo = db_session.get(TripDestination, tokyo_id)
    tokyo.info_status, tokyo.summary, tokyo.image_url = "ready", "Capital of Japan.", "https://img/tokyo.jpg"
    db_session.commit()

    # Reorder, drop Kyoto, add Osaka.
    body = trip_payload(
        name="Japan, revised",
        destinations=[destination("Osaka", lat=34.69, lon=135.5), {**destination("Tokyo"), "id": tokyo_id}],
    )
    updated = client.put(f"/api/v1/trips/{trip['id']}", json=body).json()

    assert updated["name"] == "Japan, revised"
    assert [d["name"] for d in updated["destinations"]] == ["Osaka", "Tokyo"]
    kept = updated["destinations"][1]
    assert kept["id"] == tokyo_id
    assert kept["info_status"] == "ready"
    assert kept["summary"] == "Capital of Japan."
    assert updated["cover"]["image_url"] == "https://img/tokyo.jpg"
    assert updated["cover"]["destination_name"] == "Tokyo"
    assert db_session.get(TripDestination, kyoto_id) is None


def test_moving_a_destination_refetches_its_info(client: TestClient, db_session: Session) -> None:
    trip = client.post("/api/v1/trips", json=trip_payload()).json()
    dest_id = trip["destinations"][0]["id"]
    row = db_session.get(TripDestination, dest_id)
    row.info_status, row.summary = "ready", "Old summary"
    db_session.commit()

    moved = {**destination("Kyoto", lat=10.0, lon=10.0), "id": dest_id}
    updated = client.put(f"/api/v1/trips/{trip['id']}", json=trip_payload(destinations=[moved])).json()

    assert updated["destinations"][0]["info_status"] == "pending"
    assert updated["destinations"][0]["summary"] is None


def test_foreign_destination_ids_are_rejected(client: TestClient) -> None:
    first = client.post("/api/v1/trips", json=trip_payload()).json()
    second = client.post("/api/v1/trips", json=trip_payload(name="Other")).json()
    stolen = {**destination(), "id": first["destinations"][0]["id"]}

    response = client.put(f"/api/v1/trips/{second['id']}", json=trip_payload(destinations=[stolen]))

    assert response.status_code == 422


def test_list_order_puts_dated_trips_first_and_archived_last(client: TestClient) -> None:
    client.post("/api/v1/trips", json=trip_payload(name="Archived", status="archived"))
    client.post("/api/v1/trips", json=trip_payload(name="Someday", start_date=None, end_date=None))
    client.post(
        "/api/v1/trips", json=trip_payload(name="Later", start_date="2027-03-01", end_date="2027-03-09")
    )
    client.post("/api/v1/trips", json=trip_payload(name="Sooner"))

    names = [t["name"] for t in client.get("/api/v1/trips").json()]

    assert names == ["Sooner", "Later", "Someday", "Archived"]


def test_delete_trip(client: TestClient) -> None:
    trip = client.post("/api/v1/trips", json=trip_payload()).json()

    assert client.delete(f"/api/v1/trips/{trip['id']}").status_code == 204
    assert client.get(f"/api/v1/trips/{trip['id']}").status_code == 404
    assert client.delete(f"/api/v1/trips/{trip['id']}").status_code == 404


def test_deleting_a_person_removes_them_from_trips(client: TestClient, db_session: Session) -> None:
    alex = add_person(db_session, "Alex")
    trip = client.post("/api/v1/trips", json=trip_payload(traveler_ids=[alex.id])).json()

    client.delete(f"/api/v1/people/{alex.id}")

    assert client.get(f"/api/v1/trips/{trip['id']}").json()["travelers"] == []


def test_editing_a_trip_keeps_each_destinations_place_id(client: TestClient) -> None:
    created = client.post(
        "/api/v1/trips", json=trip_payload(destinations=[destination(geoapify_place_id="51kyoto")])
    ).json()
    kept = created["destinations"][0]
    assert kept["geoapify_place_id"] == "51kyoto"

    # An edit that leaves the id out (as older versions of the app did) doesn't erase it...
    same_place = {**destination(), "id": kept["id"]}
    renamed = client.put(
        f"/api/v1/trips/{created['id']}", json=trip_payload(name="Kyoto", destinations=[same_place])
    )
    assert renamed.json()["destinations"][0]["geoapify_place_id"] == "51kyoto"

    # ...but moving the destination to another place does, since the id was for the old one.
    elsewhere = {**destination("Osaka", lat=34.69, lon=135.5), "id": kept["id"]}
    moved = client.put(f"/api/v1/trips/{created['id']}", json=trip_payload(destinations=[elsewhere]))
    assert moved.json()["destinations"][0]["geoapify_place_id"] is None


def test_interests_are_tidied_and_saved(client: TestClient, db_session: Session) -> None:
    trip = client.post("/api/v1/trips", json=trip_payload()).json()
    assert trip["interests"] == []

    response = client.put(
        f"/api/v1/trips/{trip['id']}/interests",
        json={"interests": ["  Beaches ", "ATV   tours", "beaches", "", "   ", "Local  markets", "BEACHES"]},
    )

    assert response.status_code == 200
    assert response.json()["interests"] == ["Beaches", "ATV tours", "Local markets"]
    assert client.get(f"/api/v1/trips/{trip['id']}").json()["interests"] == [
        "Beaches",
        "ATV tours",
        "Local markets",
    ]
    assert (
        client.put(f"/api/v1/trips/{trip['id']}/interests", json={"interests": []}).json()["interests"] == []
    )


def test_interest_limits_explain_themselves(client: TestClient) -> None:
    trip = client.post("/api/v1/trips", json=trip_payload()).json()
    url = f"/api/v1/trips/{trip['id']}/interests"

    too_many = client.put(url, json={"interests": [f"Thing {n}" for n in range(26)]})
    too_long = client.put(url, json={"interests": ["x" * 61]})
    at_limits = client.put(url, json={"interests": ["x" * 60] + [f"Thing {n}" for n in range(24)]})
    duplicates_dont_count = client.put(url, json={"interests": ["Surf", "surf"] * 20})

    assert too_many.status_code == 422 and "25 interests or fewer" in too_many.text
    assert too_long.status_code == 422 and "60 characters or fewer" in too_long.text
    assert at_limits.status_code == 200 and len(at_limits.json()["interests"]) == 25
    assert duplicates_dont_count.json()["interests"] == ["Surf"]
    assert client.put("/api/v1/trips/4242/interests", json={"interests": []}).status_code == 404


def test_saving_the_trip_form_keeps_interests(client: TestClient) -> None:
    trip = client.post("/api/v1/trips", json=trip_payload()).json()
    client.put(f"/api/v1/trips/{trip['id']}/interests", json={"interests": ["Volcanoes", "Streetwear"]})

    saved = client.put(f"/api/v1/trips/{trip['id']}", json=trip_payload(name="Japan, later", notes="Edited"))

    assert saved.status_code == 200
    assert saved.json()["name"] == "Japan, later"
    assert saved.json()["interests"] == ["Volcanoes", "Streetwear"]
    assert client.get("/api/v1/trips").json()[0]["interests"] == ["Volcanoes", "Streetwear"]
