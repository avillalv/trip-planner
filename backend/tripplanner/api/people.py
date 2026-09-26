from fastapi import APIRouter, HTTPException, status

from tripplanner.api.deps import DbSession
from tripplanner.schemas.people import PersonIn, PersonOut
from tripplanner.services import people as service

router = APIRouter(prefix="/api/v1/people", tags=["people"])


@router.get("", response_model=list[PersonOut])
def list_people(db: DbSession) -> list[PersonOut]:
    return [PersonOut.model_validate(p) for p in service.list_people(db)]


@router.post("", response_model=PersonOut, status_code=status.HTTP_201_CREATED)
def create_person(body: PersonIn, db: DbSession) -> PersonOut:
    try:
        return PersonOut.model_validate(service.create_person(db, body))
    except service.UnknownAirport as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.put("/{person_id}", response_model=PersonOut)
def update_person(person_id: int, body: PersonIn, db: DbSession) -> PersonOut:
    try:
        return PersonOut.model_validate(service.update_person(db, person_id, body))
    except service.PersonNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Traveler not found.") from exc
    except service.UnknownAirport as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(person_id: int, db: DbSession) -> None:
    try:
        service.delete_person(db, person_id)
    except service.PersonNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Traveler not found.") from exc
