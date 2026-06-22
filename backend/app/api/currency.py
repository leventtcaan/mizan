"""
Currency list and rate endpoints — public (no auth required).
Backed by the currency service cache (1h TTL).
"""

import logging

from fastapi import APIRouter

from app.services.asset_prices import fetch_stock_quote
from app.services.currency import (
    get_fiat_list,
    get_crypto_list,
    get_commodity_list,
    get_exchange_rate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/currency", tags=["currency"])


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
