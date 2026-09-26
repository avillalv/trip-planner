from typing import Annotated

from pydantic import BeforeValidator, StringConstraints

# Pydantic checks `pattern` and lengths against the raw input, so normalize first.


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _strip_upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


IataCode = Annotated[str, BeforeValidator(_strip_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
CurrencyCode = Annotated[str, BeforeValidator(_strip_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]
CountryCode = Annotated[str, BeforeValidator(_strip_upper), StringConstraints(pattern=r"^[A-Z]{2}$")]
HexColor = Annotated[str, BeforeValidator(_strip), StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]


def text(max_length: int, min_length: int = 0) -> type[str]:
    """A whitespace-stripped string with length limits."""
    return Annotated[  # type: ignore[return-value]
        str, BeforeValidator(_strip), StringConstraints(min_length=min_length, max_length=max_length)
    ]
