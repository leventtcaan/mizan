"""
Asset price fetching service.

For live-value asset types (crypto, gold, foreign_currency, commodity):
  - current_value = quantity held (e.g. 0.5 BTC)
  - currency = the asset code (e.g. "BTC")
  - Display value = convert(quantity, asset_code, display_currency) — always live
  - Refresh: store last_price_usd + price_fetched_at in source_detail, update as_of_date

For market-value types (stock, fund):
  - current_value = total portfolio value in quote currency (e.g. USD)
  - quantity is not stored → we cannot recompute total value
  - Refresh: fetch per-share price, store in source_detail for display badge, update as_of_date

Returns per-asset status so the frontend can show "Otomatik · 5 dak önce" or "Manuel".
"""

import json
import logging
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.services.currency import (
    _fetch_commodity_rates,
    _fetch_crypto_rates,
    _fetch_fiat_rates,
)

logger = logging.getLogger(__name__)

# --- Cache TTLs ---
_CRYPTO_TTL = 900    # 15 minutes
_STOCK_TTL = 3600    # 1 hour
_SEARCH_TTL = 600    # 10 minutes

# Per-ticker stock price cache: {TICKER: (price_usd, fetched_at)}
_stock_cache: dict[str, tuple[float, float]] = {}

# Per-query symbol search cache: {query: (results, fetched_at)}
_search_cache: dict[str, tuple[list[dict], float]] = {}

# Asset types that can be auto-refreshed
LIVE_VALUE_TYPES = {"crypto", "gold", "foreign_currency", "commodity"}
MARKET_VALUE_TYPES = {"stock", "fund"}
AUTO_FETCHABLE_TYPES = LIVE_VALUE_TYPES | MARKET_VALUE_TYPES


# --- Individual fetchers ---

async def fetch_crypto_price(symbol: str) -> float | None:
    """USD price of 1 unit of crypto. Uses CoinGecko via shared currency service cache."""
    try:
        rates, _ = await _fetch_crypto_rates()
        return rates.get(symbol.upper())
    except Exception as exc:
        logger.warning("Crypto price fetch failed (%s): %s", symbol, exc)
        return None


async def fetch_gold_price() -> float | None:
    """USD price per troy oz (XAU)."""
    try:
        rates = await _fetch_commodity_rates()
        return rates.get("XAU")
    except Exception as exc:
        logger.warning("Gold price fetch failed: %s", exc)
        return None


async def fetch_commodity_price(code: str) -> float | None:
    """USD price for commodity code (XAU, XAG, BRENT, XPT, XPD)."""
    try:
        rates = await _fetch_commodity_rates()
        return rates.get(code.upper())
    except Exception as exc:
        logger.warning("Commodity price fetch failed (%s): %s", code, exc)
        return None


async def fetch_fiat_price(code: str) -> float | None:
    """USD value of 1 unit of fiat currency code."""
    try:
        rates = await _fetch_fiat_rates()
        return rates.get(code.upper())
    except Exception as exc:
        logger.warning("Fiat price fetch failed (%s): %s", code, exc)
        return None


async def _yahoo_fetch(sym: str) -> dict | None:
    """
    Raw Yahoo Finance chart fetch. Returns dict with price, currency, name or None.
    Caches result in _stock_cache keyed by exact Yahoo symbol.
    """
    sym = sym.upper()
    cached = _stock_cache.get(sym)
    if cached and (time.time() - cached[1]) < _STOCK_TTL:
        price, _, currency, name = cached
        return {"price": price, "currency": currency, "name": name}

    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
        async with httpx.AsyncClient(
            timeout=8.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Mizan/1.0)"},
            follow_redirects=True,
        ) as client:
            resp = await client.get(url, params={"interval": "1d", "range": "1d"})
            if resp.status_code == 200:
                data = resp.json()
                meta = (
                    data.get("chart", {})
                    .get("result", [{}])[0]
                    .get("meta", {})
                )
                price = meta.get("regularMarketPrice")
                if price is not None:
                    p = float(price)
                    currency = str(meta.get("currency", "USD"))
                    name = str(meta.get("longName") or meta.get("shortName") or sym)
                    _stock_cache[sym] = (p, time.time(), currency, name)
                    logger.info("Stock price fetched: %s = %.4f %s", sym, p, currency)
                    return {"price": p, "currency": currency, "name": name}
    except Exception as exc:
        logger.warning("Stock price fetch failed (%s): %s", sym, exc)

    if sym in _stock_cache:
        logger.info("Using stale cache for %s", sym)
        price, _, currency, name = _stock_cache[sym]
        return {"price": price, "currency": currency, "name": name}

    return None


# Exchange suffix map: our exchange key → Yahoo suffix to append.
_EXCHANGE_SUFFIX: dict[str, str] = {
    "BIST": ".IS",
    "LSE": ".L",
    "XETRA": ".DE",
    "TSX": ".TO",
    "ASX": ".AX",
}


async def fetch_stock_quote(
    ticker: str,
    exchange: str = "AUTO",
) -> dict | None:
    """
    Fetch live stock/fund quote from Yahoo Finance.
    Returns {"price": float, "currency": str, "name": str, "yahoo_symbol": str} or None.

    exchange values:
      AUTO  — try ticker as-is; if no result and ticker has no dot, also try .IS suffix
      BIST  — prepend .IS suffix (Turkish stocks)
      any other key in _EXCHANGE_SUFFIX — prepend that suffix
      (anything else) — use ticker as-is
    """
    sym = ticker.strip().upper()
    if not sym:
        return None

    suffix = _EXCHANGE_SUFFIX.get(exchange.upper(), "")

    # Build candidate list
    if suffix:
        # Explicit exchange: try suffixed first, then bare
        candidates = [f"{sym}{suffix}", sym]
    elif exchange.upper() == "AUTO":
        # Auto: try bare first; if ticker has no dot (not already exchange-qualified), also try .IS
        candidates = [sym]
        if "." not in sym:
            candidates.append(f"{sym}.IS")
    else:
        candidates = [sym]

    for candidate in candidates:
        result = await _yahoo_fetch(candidate)
        if result is not None:
            return {**result, "yahoo_symbol": candidate}

    return None


async def search_stock_symbols(query: str, limit: int = 8) -> list[dict]:
    """
    Search Yahoo Finance by company/fund NAME (or partial ticker) so users who don't
    know ticker codes can find them ("Apple" → AAPL, "Türk Hava" → THYAO.IS).
    Returns [{"symbol", "name", "exchange", "type"}] — empty list on any failure.
    Cached per query for _SEARCH_TTL.
    """
    q = query.strip()
    if len(q) < 2:
        return []

    key = q.lower()
    cached = _search_cache.get(key)
    if cached and (time.time() - cached[1]) < _SEARCH_TTL:
        return cached[0][:limit]

    results: list[dict] = []
    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Mizan/1.0)"},
            follow_redirects=True,
        ) as client:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={"q": q, "quotesCount": max(limit, 8), "newsCount": 0, "listsCount": 0},
            )
            if resp.status_code == 200:
                for item in resp.json().get("quotes", []):
                    # Only price-able instrument types (matches what /quote can fetch).
                    if item.get("quoteType") not in ("EQUITY", "ETF", "MUTUALFUND", "INDEX"):
                        continue
                    sym = item.get("symbol")
                    if not sym:
                        continue
                    results.append({
                        "symbol": str(sym).upper(),
                        "name": str(item.get("longname") or item.get("shortname") or sym),
                        "exchange": str(item.get("exchDisp") or item.get("exchange") or ""),
                        "type": str(item.get("quoteType") or ""),
                    })
                _search_cache[key] = (results, time.time())
    except Exception as exc:
        logger.warning("Symbol search failed (%s): %s", q, exc)
        if key in _search_cache:
            return _search_cache[key][0][:limit]

    return results[:limit]


async def fetch_stock_price(ticker: str) -> float | None:
    """
    Backward-compatible wrapper used by fetch_all_for_user.
    Returns USD price per share, converting from native currency if needed.
    """
    result = await fetch_stock_quote(ticker, exchange="AUTO")
    if result is None:
        return None

    price = result["price"]
    currency = result.get("currency", "USD")

    if currency.upper() == "USD":
        return price

    # Convert native currency → USD via fiat rates
    try:
        from app.services.currency import get_exchange_rate
        rate = await get_exchange_rate(currency.upper(), "USD")
        return price * rate
    except Exception:
        return price  # return native price as fallback


async def _price_for_asset(asset: Asset) -> float | None:
    """
    Dispatch to the right fetcher based on asset_type, currency, and source_detail.
    Returns USD price of 1 unit of whatever this asset holds.
    """
    detail: dict = {}
    if asset.source_detail:
        try:
            detail = json.loads(asset.source_detail)
        except Exception:
            pass

    if asset.asset_type == "crypto":
        symbol = detail.get("symbol") or asset.currency
        return await fetch_crypto_price(str(symbol))

    if asset.asset_type == "gold":
        # Gold stored as XAU quantity; XAU price covers all gold units
        return await fetch_gold_price()

    if asset.asset_type == "foreign_currency":
        code = detail.get("code") or asset.currency
        return await fetch_fiat_price(str(code))

    if asset.asset_type == "commodity":
        code = detail.get("code") or asset.currency
        return await fetch_commodity_price(str(code))

    if asset.asset_type in ("stock", "fund"):
        ticker = detail.get("symbol") or detail.get("code")
        if not ticker:
            return None
        return await fetch_stock_price(str(ticker))

    return None


# --- Main entry point ---

async def fetch_all_for_user(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> dict:
    """
    Fetch latest prices for all auto-fetchable assets belonging to user_id.
    Updates source_detail with last_price_usd + price_fetched_at.
    Updates as_of_date to today.
    Does NOT change current_value for live-value types (quantity stays intact).
    Commits if any asset was updated.
    Returns {updated, failed, details}.
    """
    result = await session.execute(
        select(Asset).where(
            Asset.user_id == user_id,
            Asset.asset_type.in_(AUTO_FETCHABLE_TYPES),
        )
    )
    assets = list(result.scalars().all())

    if not assets:
        return {"updated": 0, "failed": 0, "details": []}

    updated = 0
    failed = 0
    details = []
    now_utc = datetime.now(timezone.utc).isoformat()

    for asset in assets:
        value_before = float(asset.current_value)
        price_usd = await _price_for_asset(asset)

        if price_usd is None:
            failed += 1
            logger.warning(
                "PRICE FAIL — %s [%s/%s] no price fetched (symbol/code unresolved or upstream down)",
                asset.name, asset.asset_type, asset.currency,
            )
            details.append({
                "asset_id": str(asset.id),
                "name": asset.name,
                "asset_type": asset.asset_type,
                "status": "failed",
            })
            continue

        # Merge price metadata into existing source_detail
        try:
            sd: dict = json.loads(asset.source_detail) if asset.source_detail else {}
        except Exception:
            sd = {}

        sd["last_price_usd"] = price_usd
        sd["price_fetched_at"] = now_utc
        asset.source_detail = json.dumps(sd)
        asset.as_of_date = date.today()
        # updated_at triggers automatically via SQLAlchemy onupdate

        revalued = False
        # Stocks/funds store a VALUE (not a quantity), so recompute it live from
        # shares × price. If the share count is unknown (asset created via the
        # manual-value fallback or an older flow), back-fill it once from the
        # current value ÷ live price, then every future refresh moves the value.
        # Crypto/gold/FX/commodity keep their quantity in current_value (price
        # applies at display time, so their stored value intentionally stays put).
        if asset.asset_type in MARKET_VALUE_TYPES and price_usd > 0:
            from app.services.currency import convert
            try:
                shares = float(asset.quantity) if (asset.quantity and asset.quantity > 0) else None
                if shares is None and float(asset.current_value) > 0:
                    value_usd_now = await convert(float(asset.current_value), asset.currency, "USD")
                    shares = value_usd_now / price_usd
                    asset.quantity = Decimal(str(shares))
                    logger.info("Back-filled %s shares=%.6f for %s", asset.asset_type, shares, asset.name)
                if shares and shares > 0:
                    value_usd = shares * price_usd
                    value_ccy = await convert(value_usd, "USD", asset.currency)
                    asset.current_value = Decimal(str(round(value_ccy, 2)))
                    sd["last_shares"] = shares
                    asset.source_detail = json.dumps(sd)
                    revalued = True
            except Exception as exc:
                logger.warning("Stock revalue failed for %s: %s", asset.name, exc)

        if revalued:
            logger.info(
                "PRICED — %s [%s/%s] px=$%.4f  value %.2f → %.2f %s (shares×price)",
                asset.name, asset.asset_type, asset.currency, price_usd,
                value_before, float(asset.current_value), asset.currency,
            )
        else:
            # Live-value type: current_value is the quantity; display value is
            # quantity × live rate, computed on the client at render time.
            logger.info(
                "PRICED — %s [%s/%s] px=$%.4f  qty=%.6f (valued live at display time, stored value unchanged)",
                asset.name, asset.asset_type, asset.currency, price_usd, value_before,
            )

        updated += 1
        details.append({
            "asset_id": str(asset.id),
            "name": asset.name,
            "asset_type": asset.asset_type,
            "status": "updated",
            "price_usd": price_usd,
        })

    if updated > 0:
        await session.commit()
        logger.info(
            "Asset prices refreshed — user=%s updated=%d failed=%d",
            user_id, updated, failed,
        )

    return {"updated": updated, "failed": failed, "details": details}
