from sqlalchemy import select
from sqlalchemy.orm import Session

from tripplanner.models import Airport, Person
from tripplanner.schemas.people import PersonIn


class PersonNotFound(LookupError):
    pass


class UnknownAirport(ValueError):
    pass


def _check_airports(db: Session, codes: list[str]) -> list[str]:
    unique = list(dict.fromkeys(codes))
    known = set(db.scalars(select(Airport.iata).where(Airport.iata.in_(unique))))
    unknown = [code for code in unique if code not in known]
    if unknown:
        raise UnknownAirport(f"Unknown airport code(s): {', '.join(unknown)}")
    return unique


def list_people(db: Session) -> list[Person]:
    return list(db.scalars(select(Person).order_by(Person.id)))


def get_person(db: Session, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise PersonNotFound(person_id)
    return person


def create_person(db: Session, data: PersonIn) -> Person:
    person = Person(name=data.name, color=data.color, home_airports=_check_airports(db, data.home_airports))
    db.add(person)
    db.commit()
    return person


def update_person(db: Session, person_id: int, data: PersonIn) -> Person:
    person = get_person(db, person_id)
    person.name = data.name
    person.color = data.color
    person.home_airports = _check_airports(db, data.home_airports)
    db.commit()
    return person


def delete_person(db: Session, person_id: int) -> None:
    db.delete(get_person(db, person_id))
    db.commit()
