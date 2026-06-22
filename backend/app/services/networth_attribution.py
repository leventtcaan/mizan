"""
Net-worth change attribution — explains *why* net worth moved.

Diffs the two most recent snapshots that carry a per-entity breakdown. Because
each contribution is (asset gain) or (liability reduction), the signed
contributions sum exactly to the net-worth delta — the story always reconciles
to the number. Amounts are returned converted to the requested display currency.
"""

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.networth_snapshot import NetworthSnapshot
from app.services.currency import convert

logger = logging.getLogger(__name__)

_MIN_USD = 0.5      # ignore sub-dollar noise
_MAX_DRIVERS = 5


def _load_breakdown(snap: NetworthSnapshot) -> dict | None:
    if not snap.breakdown_json:
        return None
    try:
        data = json.loads(snap.breakdown_json)
        if isinstance(data, dict) and "assets" in data and "liabilities" in data:
            return data
    except json.JSONDecodeError:
        pass
    return None


def _diff(latest: dict, prev: dict) -> list[dict]:
    drivers: list[dict] = []

    latest_assets, prev_assets = latest["assets"], prev["assets"]
    for aid in set(latest_assets) | set(prev_assets):
        cur = latest_assets.get(aid)
        old = prev_assets.get(aid)
        cur_usd = float(cur["usd"]) if cur else 0.0
        old_usd = float(old["usd"]) if old else 0.0
        contrib = cur_usd - old_usd  # asset increase → net worth increase
        if abs(contrib) < _MIN_USD:
            continue
        name = (cur or old)["name"]
        if old is None:
            kind = "asset_added"
        elif cur is None:
            kind = "asset_removed"
        else:
            kind = "asset_gain" if contrib >= 0 else "asset_loss"
        drivers.append({"label": name, "kind": kind, "usd": contrib})

    latest_liab, prev_liab = latest["liabilities"], prev["liabilities"]
    for lid in set(latest_liab) | set(prev_liab):
        cur = latest_liab.get(lid)
        old = prev_liab.get(lid)
        cur_usd = float(cur["usd"]) if cur else 0.0
        old_usd = float(old["usd"]) if old else 0.0
        contrib = old_usd - cur_usd  # liability decrease → net worth increase
        if abs(contrib) < _MIN_USD:
            continue
        name = (cur or old)["name"]
        if old is None:
            kind = "liability_added"
        elif cur is None:
            kind = "liability_removed"
        else:
            kind = "liability_paid" if contrib >= 0 else "liability_increased"
        drivers.append({"label": name, "kind": kind, "usd": contrib})

    drivers.sort(key=lambda d: abs(d["usd"]), reverse=True)
    return drivers


async def build_attribution(
    user_id: uuid.UUID,
    session: AsyncSession,
    display_currency: str = "TRY",
) -> dict | None:
    """
    Returns {period_days, delta, currency, drivers:[{label,kind,amount,direction}]}
    or None when there aren't two breakdown-bearing snapshots yet.
    """
    result = await session.execute(
        select(NetworthSnapshot)
        .where(
            NetworthSnapshot.user_id == user_id,
            NetworthSnapshot.breakdown_json.is_not(None),
        )
        .order_by(NetworthSnapshot.recorded_at.desc())
        .limit(2)
    )
    snaps = result.scalars().all()
    if len(snaps) < 2:
        return None

    latest, prev = snaps[0], snaps[1]
    latest_bd, prev_bd = _load_breakdown(latest), _load_breakdown(prev)
    if latest_bd is None or prev_bd is None:
        return None

    delta_usd = float(latest.net_worth_usd) - float(prev.net_worth_usd)
    drivers_usd = _diff(latest_bd, prev_bd)
    if not drivers_usd and abs(delta_usd) < _MIN_USD:
        return None

    # Convert USD figures to the display currency in one shot via a unit rate.
    try:
        unit = float(await convert(1.0, "USD", display_currency))
    except Exception:
        unit = 1.0

    drivers = []
    for d in drivers_usd[:_MAX_DRIVERS]:
        amount = d["usd"] * unit
        drivers.append({
            "label": d["label"],
            "kind": d["kind"],
            "amount": abs(amount),
            "direction": "up" if d["usd"] >= 0 else "down",
        })

    period_days = max(1, (latest.recorded_at - prev.recorded_at).days)

    return {
        "period_days": period_days,
        "delta": delta_usd * unit,
        "currency": display_currency,
        "drivers": drivers,
    }
