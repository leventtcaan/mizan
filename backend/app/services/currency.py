"""
Currency conversion service.
Uses exchangerate-api.com free tier (no API key). Falls back to hardcoded rates.
Caches for 1 hour in-memory.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Fallback rates (TRY per 1 unit of foreign currency) — updated 2026-06
_FALLBACK_RATES: dict[str, float] = {
    "TRY": 1.0,
    "USD": 38.5,
    "EUR": 41.5,
    "GBP": 48.5,
    "CHF": 43.0,
    "JPY": 0.255,
    "XAU": 117000.0,   # gold per troy oz
    "BTC": 3500000.0,
    "ETH": 180000.0,
}

_CACHE: dict[str, Any] = {
    "rates": None,
    "fetched_at": 0.0,
    "ttl": 3600,
}


async def _fetch_rates() -> dict[str, float]:
    """Fetch live TRY-based rates. Returns hardcoded fallback on any failure."""
    now = time.time()
    if _CACHE["rates"] and (now - _CACHE["fetched_at"]) < _CACHE["ttl"]:
        return _CACHE["rates"]  # type: ignore[return-value]

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://open.er-api.com/v6/latest/TRY")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("result") == "success":
                    raw: dict[str, float] = data["rates"]
                    # raw rates are "X units of foreign currency per 1 TRY"
                    # invert to get "TRY per 1 unit of foreign currency"
                    rates: dict[str, float] = {"TRY": 1.0}
                    for code, rate in raw.items():
                        if rate and rate != 0:
                            rates[code] = 1.0 / rate
                    _CACHE["rates"] = rates
                    _CACHE["fetched_at"] = now
                    logger.info("Exchange rates refreshed from open.er-api.com (%d currencies)", len(rates))
                    return rates
    except Exception as exc:
        logger.warning("Exchange rate fetch failed (%s), using fallback rates", exc)

    # Return fallback — do NOT cache it so next request retries the API
    return _FALLBACK_RATES.copy()


async def get_exchange_rate(from_currency: str, to_currency: str) -> float:
    """Returns how many `to_currency` units equal 1 `from_currency` unit."""
    if from_currency == to_currency:
        return 1.0

    rates = await _fetch_rates()

    from_try = rates.get(from_currency.upper(), _FALLBACK_RATES.get(from_currency.upper(), 1.0))
    to_try = rates.get(to_currency.upper(), _FALLBACK_RATES.get(to_currency.upper(), 1.0))

    if to_try == 0:
        return 1.0

    return from_try / to_try


async def convert(amount: float, from_currency: str, to_currency: str) -> float:
    rate = await get_exchange_rate(from_currency, to_currency)
    return amount * rate
