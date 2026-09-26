"""Fill in destination summaries and cover photos from Wikipedia (runs after the response)."""

import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy.orm import Session

from tripplanner.config import get_settings
from tripplanner.db import new_session
from tripplanner.models import TripDestination
from tripplanner.providers.wikipedia import WikiArticle, WikipediaClient

log = logging.getLogger(__name__)


def search_text(destination: TripDestination) -> str:
    """Adding the country ("Kyoto Japan") finds the city rather than a namesake elsewhere."""
    if destination.kind == "country" or not destination.country or destination.country == destination.name:
        return destination.name
    return f"{destination.name} {destination.country}"


def apply_article(destination: TripDestination, article: WikiArticle | None) -> None:
    if article is None:
        destination.info_status = "not_found"
    else:
        destination.summary = article.extract or None
        destination.wiki_url = article.page_url
        destination.image_url = article.image_url
        destination.image_file = article.image_file
        destination.info_status = "ready"
    destination.info_updated_at = datetime.now(UTC)


def enrich_destination(db: Session, destination: TripDestination, wiki: WikipediaClient | None) -> None:
    if wiki is None:
        destination.info_status = "skipped"
        destination.info_updated_at = datetime.now(UTC)
        return
    try:
        apply_article(destination, wiki.find_article(search_text(destination)))
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("Wikipedia lookup failed for %s: %s", destination.name, exc)
        destination.info_status = "failed"
        destination.info_updated_at = datetime.now(UTC)


def enrich_destinations(destination_ids: list[int]) -> None:
    """Background task entry point: uses its own session and Wikipedia client."""
    if not destination_ids:
        return
    contact = get_settings().wikimedia_contact
    wiki = WikipediaClient(contact) if contact else None
    try:
        with new_session() as db:
            for destination_id in destination_ids:
                destination = db.get(TripDestination, destination_id)
                if destination is not None:
                    enrich_destination(db, destination, wiki)
                    db.commit()
    finally:
        if wiki is not None:
            wiki.close()
