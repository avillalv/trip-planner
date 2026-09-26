import httpx
import respx

from tripplanner.models import TripDestination
from tripplanner.providers.wikipedia import API_URL, WikiArticle, WikipediaClient
from tripplanner.services.enrichment import enrich_destination, search_text


def _destination(name: str = "Kyoto", country: str | None = "Japan", kind: str = "city") -> TripDestination:
    return TripDestination(
        name=name, country=country, kind=kind, lat=0, lon=0, position=0, info_status="pending"
    )


def test_search_text_adds_the_country_except_for_countries() -> None:
    assert search_text(_destination()) == "Kyoto Japan"
    assert search_text(_destination("Japan", "Japan", "country")) == "Japan"
    assert search_text(_destination("Somewhere", None)) == "Somewhere"


class FakeWiki:
    def __init__(self, result: WikiArticle | None = None, error: Exception | None = None) -> None:
        self.result, self.error, self.searches = result, error, []

    def find_article(self, search: str) -> WikiArticle | None:
        self.searches.append(search)
        if self.error:
            raise self.error
        return self.result


ARTICLE = WikiArticle(
    title="Kyoto",
    extract="Kyoto is a city in Japan.",
    page_url="https://en.wikipedia.org/wiki/Kyoto",
    image_url="https://upload.wikimedia.org/kyoto.jpg",
    image_file="Kyoto.jpg",
)


def test_found_article_fills_summary_and_photo() -> None:
    dest = _destination()
    wiki = FakeWiki(ARTICLE)

    enrich_destination(None, dest, wiki)  # type: ignore[arg-type]

    assert wiki.searches == ["Kyoto Japan"]
    assert dest.info_status == "ready"
    assert dest.summary == "Kyoto is a city in Japan."
    assert dest.image_url == "https://upload.wikimedia.org/kyoto.jpg"
    assert dest.info_updated_at is not None


def test_missing_article_network_errors_and_missing_contact_have_distinct_statuses() -> None:
    not_found, failed, skipped = _destination(), _destination(), _destination()

    enrich_destination(None, not_found, FakeWiki(None))  # type: ignore[arg-type]
    enrich_destination(None, failed, FakeWiki(error=httpx.ConnectError("offline")))  # type: ignore[arg-type]
    enrich_destination(None, skipped, None)  # type: ignore[arg-type]

    assert (not_found.info_status, failed.info_status, skipped.info_status) == (
        "not_found",
        "failed",
        "skipped",
    )


def _search_route(router: respx.MockRouter, titles: list[str]) -> respx.Route:
    hits = {"query": {"search": [{"title": t} for t in titles]}}
    return router.get(API_URL, params={"list": "search"}).mock(return_value=httpx.Response(200, json=hits))


def test_client_reads_extract_image_and_url(no_real_network: respx.MockRouter) -> None:
    search = _search_route(no_real_network, ["Kyoto"])
    page = {
        "query": {
            "pages": [
                {
                    "title": "Kyoto",
                    "extract": " Kyoto is a city. ",
                    "fullurl": "https://en.wikipedia.org/wiki/Kyoto",
                    "thumbnail": {
                        "source": "https://upload.wikimedia.org/k.jpg",
                        "width": 1280,
                        "height": 853,
                    },
                    "pageimage": "K.jpg",
                }
            ]
        }
    }
    no_real_network.get(API_URL, params={"prop": "extracts|pageimages|info|pageprops"}).mock(
        return_value=httpx.Response(200, json=page)
    )

    article = WikipediaClient("me@example.com").find_article("Kyoto Japan")

    assert article == WikiArticle(
        "Kyoto",
        "Kyoto is a city.",
        "https://en.wikipedia.org/wiki/Kyoto",
        "https://upload.wikimedia.org/k.jpg",
        "K.jpg",
    )
    user_agent = search.calls.last.request.headers["user-agent"]
    assert user_agent.startswith("TripPlanner/") and "me@example.com" in user_agent


def test_client_skips_disambiguation_pages(no_real_network: respx.MockRouter) -> None:
    _search_route(no_real_network, ["Springfield"])
    page = {"query": {"pages": [{"title": "Springfield", "pageprops": {"disambiguation": ""}}]}}
    no_real_network.get(API_URL, params={"prop": "extracts|pageimages|info|pageprops"}).mock(
        return_value=httpx.Response(200, json=page)
    )

    assert WikipediaClient("me@example.com").find_article("Springfield") is None


def test_client_returns_none_without_search_hits(no_real_network: respx.MockRouter) -> None:
    _search_route(no_real_network, [])

    assert WikipediaClient("me@example.com").find_article("Nowhereville") is None
