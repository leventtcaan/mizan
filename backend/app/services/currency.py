"""
Currency conversion service with three separate caches (fiat, crypto, commodities).
Each cache has a 1-hour TTL. Uses USD as pivot currency.
Falls back to last cached value on fetch failure; hardcoded rates only when cache is empty.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# --- Hardcoded fallback rates (USD-based: 1 unit = X USD) ---
# Used ONLY when API totally fails AND nothing is cached yet.
_FALLBACK_USD: dict[str, float] = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "TRY": 0.026,
    "JPY": 1.0 / 149.5,
    "CHF": 0.89,
    "XAU": 0.000316,   # troy oz gold
    "XAG": 0.031,      # troy oz silver
    "BTC": 0.0000105,
    "ETH": 0.00032,
}

# Fiat display names (subset — full list comes from API)
_FIAT_NAMES: dict[str, str] = {
    "USD": "US Dollar", "EUR": "Euro", "GBP": "British Pound",
    "TRY": "Türk Lirası", "JPY": "Japanese Yen", "CHF": "Swiss Franc",
    "CAD": "Canadian Dollar", "AUD": "Australian Dollar", "CNY": "Chinese Yuan",
    "RUB": "Russian Ruble", "SEK": "Swedish Krona", "NOK": "Norwegian Krone",
    "DKK": "Danish Krone", "PLN": "Polish Zloty", "CZK": "Czech Koruna",
    "HUF": "Hungarian Forint", "RON": "Romanian Leu", "BGN": "Bulgarian Lev",
    "HRK": "Croatian Kuna", "SGD": "Singapore Dollar", "HKD": "Hong Kong Dollar",
    "KRW": "South Korean Won", "INR": "Indian Rupee", "BRL": "Brazilian Real",
    "MXN": "Mexican Peso", "ZAR": "South African Rand", "AED": "UAE Dirham",
    "SAR": "Saudi Riyal", "QAR": "Qatari Riyal", "KWD": "Kuwaiti Dinar",
    "MAD": "Moroccan Dirham", "EGP": "Egyptian Pound",
}

_COMMODITY_NAMES: dict[str, str] = {
    "XAU": "Altın (troy oz)",
    "XAG": "Gümüş (troy oz)",
    "XPT": "Platin (troy oz)",
    "XPD": "Paladyum (troy oz)",
    "BRENT": "Brent Petrol (varil)",
}

# --- Cache stores ---
_CACHE_TTL = 3600  # 1 hour

_fiat_cache: dict[str, Any] = {
    "rates_usd": None,   # {code: usd_value} where 1 unit = X USD
    "fetched_at": 0.0,
}

_crypto_cache: dict[str, Any] = {
    "rates_usd": None,   # {SYMBOL: usd_price}
    "names": None,       # {SYMBOL: name}
    "fetched_at": 0.0,
}

_commodity_cache: dict[str, Any] = {
    "rates_usd": None,   # {CODE: usd_value}
    "fetched_at": 0.0,
}


def _is_fresh(cache: dict) -> bool:
    return cache["fetched_at"] > 0 and (time.time() - cache["fetched_at"]) < _CACHE_TTL


# --- Fiat rates (USD-base from open.er-api.com/v6/latest/USD) ---

async def _fetch_fiat_rates() -> dict[str, float]:
    """Returns {code: usd_rate} where 1 unit of code = X USD."""
    if _is_fresh(_fiat_cache) and _fiat_cache["rates_usd"]:
        return _fiat_cache["rates_usd"]  # type: ignore[return-value]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://open.er-api.com/v6/latest/USD")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("result") == "success":
                    # raw: {code: how many units per 1 USD}
                    # invert: 1 unit of code = 1/raw USD
                    raw: dict[str, float] = data["rates"]
                    rates: dict[str, float] = {"USD": 1.0}
                    for code, per_usd in raw.items():
                        if per_usd and per_usd != 0:
                            rates[code] = 1.0 / per_usd
                    _fiat_cache["rates_usd"] = rates
                    _fiat_cache["fetched_at"] = time.time()
                    logger.info("Fiat rates refreshed (%d currencies)", len(rates))
                    return rates
    except Exception as exc:
        logger.warning("Fiat rate fetch failed (%s)", exc)

    # Return last cached if available, else hardcoded subset
    if _fiat_cache["rates_usd"]:
        return _fiat_cache["rates_usd"]  # type: ignore[return-value]

    fallback = {k: v for k, v in _FALLBACK_USD.items() if k not in {"XAU", "XAG", "BTC", "ETH"}}
    return fallback


# --- Crypto rates (CoinGecko top 100) ---

async def _fetch_crypto_rates() -> tuple[dict[str, float], dict[str, str]]:
    """Returns ({SYMBOL: usd_price}, {SYMBOL: name})."""
    if _is_fresh(_crypto_cache) and _crypto_cache["rates_usd"]:
        return _crypto_cache["rates_usd"], _crypto_cache["names"]  # type: ignore[return-value]

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={
                    "vs_currency": "usd",
                    "order": "market_cap_desc",
                    "per_page": 100,
                    "page": 1,
                },
            )
            if resp.status_code == 200:
                coins = resp.json()
                rates: dict[str, float] = {}
                names: dict[str, str] = {}
                for coin in coins:
                    sym = (coin.get("symbol") or "").upper()
                    price = coin.get("current_price")
                    name = coin.get("name") or sym
                    if sym and price:
                        rates[sym] = float(price)
                        names[sym] = name
                _crypto_cache["rates_usd"] = rates
                _crypto_cache["names"] = names
                _crypto_cache["fetched_at"] = time.time()
                logger.info("Crypto rates refreshed (%d coins)", len(rates))
                return rates, names
    except Exception as exc:
        logger.warning("Crypto rate fetch failed (%s)", exc)

    # Return last cached — do NOT fall to hardcoded for crypto
    if _crypto_cache["rates_usd"]:
        return _crypto_cache["rates_usd"], _crypto_cache["names"]  # type: ignore[return-value]

    # Last resort minimal fallback
    fallback_rates = {"BTC": 1.0 / _FALLBACK_USD.get("BTC", 0.0000105), "ETH": 1.0 / _FALLBACK_USD.get("ETH", 0.00032)}
    fallback_names = {"BTC": "Bitcoin", "ETH": "Ethereum"}
    return fallback_rates, fallback_names


# --- Commodity rates (XAU/XAG from ER API + hardcoded rest) ---

async def _fetch_commodity_rates() -> dict[str, float]:
    """Returns {CODE: usd_value} where 1 unit = X USD."""
    if _is_fresh(_commodity_cache) and _commodity_cache["rates_usd"]:
        return _commodity_cache["rates_usd"]  # type: ignore[return-value]

    rates: dict[str, float] = {}

    # Try to get XAU, XAG from the fiat endpoint (open.er-api includes them)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://open.er-api.com/v6/latest/USD")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("result") == "success":
                    raw = data["rates"]
                    for code in ("XAU", "XAG"):
                        if code in raw and raw[code] != 0:
                            rates[code] = 1.0 / raw[code]
    except Exception as exc:
        logger.warning("Commodity rate fetch failed (%s)", exc)

    # Hardcoded fallbacks for metals not in fiat API
    if "XAU" not in rates:
        rates["XAU"] = 1.0 / _FALLBACK_USD.get("XAU", 0.000316)
    if "XAG" not in rates:
        rates["XAG"] = 1.0 / _FALLBACK_USD.get("XAG", 0.031)

    # XPT, XPD, BRENT — hardcoded (no free source)
    rates.setdefault("XPT", 980.0)   # platinum ~$980/oz
    rates.setdefault("XPD", 1050.0)  # palladium ~$1050/oz
    rates.setdefault("BRENT", 85.0)  # brent crude ~$85/barrel

    _commodity_cache["rates_usd"] = rates
    _commodity_cache["fetched_at"] = time.time()
    return rates


# --- Public list functions ---

async def get_fiat_list() -> list[dict]:
    """Returns [{"code": str, "name": str}, ...] sorted by code."""
    rates = await _fetch_fiat_rates()
    result = []
    seen = set()
    for code in sorted(rates.keys()):
        if code in seen:
            continue
        seen.add(code)
        name = _FIAT_NAMES.get(code, code)
        result.append({"code": code, "name": name})
    return result


async def get_crypto_list() -> list[dict]:
    """Returns [{"code": str, "name": str, "usd_price": float}, ...] by market cap order."""
    rates, names = await _fetch_crypto_rates()
    result = []
    for sym, price in rates.items():
        result.append({"code": sym, "name": names.get(sym, sym), "usd_price": price})
    return result


async def get_commodity_list() -> list[dict]:
    """Returns [{"code": str, "name": str}, ...]."""
    rates = await _fetch_commodity_rates()
    result = []
    for code in sorted(rates.keys()):
        name = _COMMODITY_NAMES.get(code, code)
        result.append({"code": code, "name": name})
    return result


# --- Unified exchange rate function ---

async def get_exchange_rate(from_currency: str, to_currency: str) -> float:
    """
    Returns how many `to_currency` units equal 1 `from_currency` unit.
    Works for fiat + crypto + commodities — uses USD as pivot.
    """
    fc = from_currency.upper()
    tc = to_currency.upper()

    if fc == tc:
        return 1.0

    # Build a combined USD rate map
    fiat = await _fetch_fiat_rates()
    crypto, _ = await _fetch_crypto_rates()
    commodity = await _fetch_commodity_rates()

    # USD-value of 1 unit of each currency
    combined: dict[str, float] = {**_FALLBACK_USD}
    # Fiat: rates are already (1 unit = X USD)
    combined.update(fiat)
    # Crypto: rates are already (1 unit = X USD)
    combined.update(crypto)
    # Commodity: rates are already (1 unit = X USD)
    combined.update(commodity)

    from_usd = combined.get(fc)
    to_usd = combined.get(tc)

    if from_usd is None:
        logger.warning("Unknown currency: %s, treating as 1 USD", fc)
        from_usd = 1.0
    if to_usd is None:
        logger.warning("Unknown currency: %s, treating as 1 USD", tc)
        to_usd = 1.0

    if to_usd == 0:
        return 1.0

    # from_usd / to_usd = how many to_currency per 1 from_currency
    return from_usd / to_usd


async def convert(amount: float, from_currency: str, to_currency: str) -> float:
    rate = await get_exchange_rate(from_currency, to_currency)
    return amount * rate
