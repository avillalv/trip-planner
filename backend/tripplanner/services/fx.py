"""Currency conversion with cached reference rates (refreshed at most every 12 hours)."""

import logging
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tripplanner.models import FxRate
from tripplanner.providers import ProviderError
from tripplanner.providers.frankfurter import latest_rates_per_eur

REFRESH_AFTER = timedelta(hours=12)
CENT = Decimal("0.01")

log = logging.getLogger(__name__)


def refresh_rates(db: Session, client: httpx.Client, now: datetime | None = None) -> bool:
    """Fetch new rates if the cached ones are old. Returns False if rates are unavailable."""
    now = now or datetime.now(UTC)
    newest = db.scalar(select(func.max(FxRate.fetched_at)))
    if newest is not None and now - newest < REFRESH_AFTER:
        return True
    try:
        rates = latest_rates_per_eur(client)
    except ProviderError as exc:
        log.warning("%s", exc)
        return newest is not None
    rows = [{"currency": c, "per_eur": r, "rate_date": d, "fetched_at": now} for c, (r, d) in rates.items()]
    stmt = insert(FxRate).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[FxRate.currency],
        set_={"per_eur": stmt.excluded.per_eur, "rate_date": stmt.excluded.rate_date, "fetched_at": now},
    )
    db.execute(stmt)
    db.commit()
    return True


def rate(db: Session, from_currency: str, to_currency: str) -> Decimal | None:
    """Units of `to_currency` per unit of `from_currency` (unrounded); None without both rates."""
    if from_currency == to_currency:
        return Decimal(1)
    rates = dict(
        db.execute(
            select(FxRate.currency, FxRate.per_eur).where(FxRate.currency.in_([from_currency, to_currency]))
        ).all()
    )
    if from_currency not in rates or to_currency not in rates or rates[from_currency] == 0:
        return None
    return rates[to_currency] / rates[from_currency]


def convert(db: Session, amount: Decimal, from_currency: str, to_currency: str) -> Decimal | None:
    """Convert through EUR cross rates; None when either currency has no rate."""
    factor = rate(db, from_currency, to_currency)
    return None if factor is None else (amount * factor).quantize(CENT, ROUND_HALF_UP)


# The currency people pay in, by ISO country code (ISO 4217, as of 2026: Bulgaria uses the euro,
# Curaçao and Sint Maarten the Caribbean guilder).
_LOCAL_CURRENCY_TABLE = """
AD EUR AE AED AF AFN AG XCD AI XCD AL ALL AM AMD AO AOA AR ARS AS USD AT EUR AU AUD AW AWG AX EUR
AZ AZN BA BAM BB BBD BD BDT BE EUR BF XOF BG EUR BH BHD BI BIF BJ XOF BL EUR BM BMD BN BND BO BOB
BQ USD BR BRL BS BSD BT BTN BV NOK BW BWP BY BYN BZ BZD CA CAD CC AUD CD CDF CF XAF CG XAF CH CHF
CI XOF CK NZD CL CLP CM XAF CN CNY CO COP CR CRC CU CUP CV CVE CW XCG CX AUD CY EUR CZ CZK DE EUR
DJ DJF DK DKK DM XCD DO DOP DZ DZD EC USD EE EUR EG EGP EH MAD ER ERN ES EUR ET ETB FI EUR FJ FJD
FK FKP FM USD FO DKK FR EUR GA XAF GB GBP GD XCD GE GEL GF EUR GG GBP GH GHS GI GIP GL DKK GM GMD
GN GNF GP EUR GQ XAF GR EUR GS GBP GT GTQ GU USD GW XOF GY GYD HK HKD HM AUD HN HNL HR EUR HT HTG
HU HUF ID IDR IE EUR IL ILS IM GBP IN INR IO USD IQ IQD IR IRR IS ISK IT EUR JE GBP JM JMD JO JOD
JP JPY KE KES KG KGS KH KHR KI AUD KM KMF KN XCD KP KPW KR KRW KW KWD KY KYD KZ KZT LA LAK LB LBP
LC XCD LI CHF LK LKR LR LRD LS LSL LT EUR LU EUR LV EUR LY LYD MA MAD MC EUR MD MDL ME EUR MF EUR
MG MGA MH USD MK MKD ML XOF MM MMK MN MNT MO MOP MP USD MQ EUR MR MRU MS XCD MT EUR MU MUR MV MVR
MW MWK MX MXN MY MYR MZ MZN NA NAD NC XPF NE XOF NF AUD NG NGN NI NIO NL EUR NO NOK NP NPR NR AUD
NU NZD NZ NZD OM OMR PA USD PE PEN PF XPF PG PGK PH PHP PK PKR PL PLN PM EUR PN NZD PR USD PS ILS
PT EUR PW USD PY PYG QA QAR RE EUR RO RON RS RSD RU RUB RW RWF SA SAR SB SBD SC SCR SD SDG SE SEK
SG SGD SH SHP SI EUR SJ NOK SK EUR SL SLE SM EUR SN XOF SO SOS SR SRD SS SSP ST STN SV USD SX XCG
SY SYP SZ SZL TC USD TD XAF TF EUR TG XOF TH THB TJ TJS TK NZD TL USD TM TMT TN TND TO TOP TR TRY
TT TTD TV AUD TW TWD TZ TZS UA UAH UG UGX UM USD US USD UY UYU UZ UZS VA EUR VC XCD VE VES VG USD
VI USD VN VND VU VUV WF XPF WS WST XK EUR YE YER YT EUR ZA ZAR ZM ZMW ZW ZWG
"""
_codes = _LOCAL_CURRENCY_TABLE.split()
LOCAL_CURRENCY = dict(zip(_codes[::2], _codes[1::2], strict=True))


def local_currency(country_code: str | None) -> str | None:
    return LOCAL_CURRENCY.get(country_code.upper()) if country_code else None
