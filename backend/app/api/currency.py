"""
Currency list and rate endpoints — public (no auth required).
Backed by the currency service cache (1h TTL).
"""

import logging
import time
from datetime import date, timedelta

import httpx
from fastapi import APIRouter

from app.services.asset_prices import fetch_stock_quote, search_stock_symbols
from app.services.currency import (
    get_fiat_list,
    get_crypto_list,
    get_commodity_list,
    get_exchange_rate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/currency", tags=["currency"])

# TEFAS fund cache: {UPPERCASE_CODE: (nav, name, fetched_at)}
_tefas_cache: dict[str, tuple[float, str, float]] = {}
_TEFAS_TTL = 3600  # 1 hour


@router.get("/list")
async def currency_list() -> dict:
    """
    Returns all available currencies grouped by type.
    No auth required — used by add-asset/liability/receivable modals.
    """
    fiat_list = await get_fiat_list()
    crypto_list = await get_crypto_list()
    commodity_list = await get_commodity_list()

    return {
        "fiat": fiat_list,
        "crypto": crypto_list,
        "commodities": commodity_list,
    }


@router.get("/rates")
async def currency_rates(base: str = "TRY") -> dict:
    """
    Returns all available currencies converted FROM the base currency.
    Example: ?base=TRY → {"USD": 0.026, "EUR": 0.024, ...}
    """
    fiat_list = await get_fiat_list()
    crypto_list = await get_crypto_list()
    commodity_list = await get_commodity_list()

    all_codes = (
        [entry["code"] for entry in fiat_list]
        + [entry["code"] for entry in crypto_list]
        + [entry["code"] for entry in commodity_list]
    )

    base_upper = base.upper()
    rates: dict[str, float] = {}

    for code in all_codes:
        if code == base_upper:
            rates[code] = 1.0
            continue
        try:
            rate = await get_exchange_rate(base_upper, code)
            rates[code] = round(rate, 8)
        except Exception:
            pass

    return {"rates": rates}


@router.get("/fund")
async def tefas_fund(code: str) -> dict:
    """
    Fetch latest NAV (birim pay değeri) and fund name from TEFAS for a Turkish fund code.
    No auth required. Returns {"code", "nav", "name", "currency"} or nav=null on failure.
    """
    fc = code.strip().upper()
    if not fc:
        return {"code": "", "nav": None, "name": None, "currency": "TRY"}

    cached = _tefas_cache.get(fc)
    if cached and (time.time() - cached[2]) < _TEFAS_TTL:
        return {"code": fc, "nav": cached[0], "name": cached[1], "currency": "TRY"}

    try:
        today = date.today()
        start = (today - timedelta(days=7)).strftime("%d.%m.%Y")
        end = today.strftime("%d.%m.%Y")
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Mizan/1.0)", "Referer": "https://www.tefas.gov.tr/"},
            follow_redirects=True,
        ) as client:
            resp = await client.get(
                "https://www.tefas.gov.tr/api/DB/BindHistoryInfo",
                params={"fontip": "YAT", "bastarih": start, "bittarih": end, "fonkod": fc},
            )
            if resp.status_code == 200:
                data = resp.json()
                rows = data.get("data") or []
                if rows:
                    # Latest row first or last — take max date
                    latest = max(rows, key=lambda r: r.get("TARIH", ""))
                    nav = latest.get("BIRIM_PAY_DEGERI") or latest.get("birim_pay_degeri")
                    name = latest.get("FONUNVAN") or latest.get("fonunvan") or fc
                    if nav is not None:
                        nav_f = float(nav)
                        _tefas_cache[fc] = (nav_f, str(name), time.time())
                        return {"code": fc, "nav": nav_f, "name": str(name), "currency": "TRY"}
    except Exception as exc:
        logger.warning("TEFAS fetch failed (%s): %s", fc, exc)

    # Stale cache fallback
    if fc in _tefas_cache:
        cached = _tefas_cache[fc]
        return {"code": fc, "nav": cached[0], "name": cached[1], "currency": "TRY"}

    return {"code": fc, "nav": None, "name": None, "currency": "TRY"}


@router.get("/quote")
async def currency_quote(symbol: str, exchange: str = "AUTO") -> dict:
    """
    Live quote for a stock/fund ticker via Yahoo Finance.
    No auth required — used by add-asset modal.

    exchange values: AUTO | BIST | LSE | XETRA | TSX | ASX | (bare = as-is)

    Returns:
      {"symbol": str, "yahoo_symbol": str, "price": float|null,
       "currency": str|null, "name": str|null}
    Never raises — on failure all nullable fields are null.
    """
    sym = symbol.strip().upper()
    if not sym:
        return {"symbol": "", "yahoo_symbol": "", "price": None, "currency": None, "name": None}

    result = await fetch_stock_quote(sym, exchange=exchange)
    if result is None:
        return {"symbol": sym, "yahoo_symbol": sym, "price": None, "currency": None, "name": None}

    return {
        "symbol": sym,
        "yahoo_symbol": result["yahoo_symbol"],
        "price": result["price"],
        "currency": result["currency"],
        "name": result["name"],
    }


@router.get("/search")
async def currency_search(q: str, limit: int = 8) -> dict:
    """
    Search stocks/funds by NAME or partial ticker via Yahoo Finance — for users who
    don't know ticker codes ("Apple" → Apple Inc. (AAPL)).
    No auth required — used by the add-asset modal.

    Returns {"results": [{"symbol", "name", "exchange", "type"}]} — empty on failure.
    """
    results = await search_stock_symbols(q, limit=max(1, min(limit, 15)))
    return {"results": results}
