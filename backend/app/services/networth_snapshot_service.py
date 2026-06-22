"""
Net-worth snapshot builder — one implementation for the API endpoint and the
scheduled price-refresh job.

Each snapshot stores not just the USD totals but a per-asset / per-liability USD
breakdown, so two consecutive snapshots can be diffed to attribute exactly why
net worth moved (see networth_attribution.py).
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.liability import Liability
from app.models.networth_snapshot import NetworthSnapshot
from app.services.currency import convert

logger = logging.getLogger(__name__)


async def upsert_snapshot(user_id: uuid.UUID, session: AsyncSession) -> NetworthSnapshot:
    """
    Compute the user's current net worth in USD (with per-entity breakdown) and
    upsert today's snapshot (one row per UTC day). Commits. Returns the snapshot.
    """
    assets_result = await session.execute(select(Asset).where(Asset.user_id == user_id))
    assets = assets_result.scalars().all()
    liabilities_result = await session.execute(select(Liability).where(Liability.user_id == user_id))
    liabilities = liabilities_result.scalars().all()

    assets_usd = Decimal("0")
    asset_breakdown: dict[str, dict] = {}
    for a in assets:
        try:
            usd = Decimal(str(await convert(float(a.current_value), a.currency, "USD")))
        except Exception:
            continue
        assets_usd += usd
        asset_breakdown[str(a.id)] = {"name": a.name, "type": a.asset_type, "usd": float(usd)}

    liabilities_usd = Decimal("0")
    liability_breakdown: dict[str, dict] = {}
    for l in liabilities:
        try:
            usd = Decimal(str(await convert(float(l.remaining_amount), l.currency, "USD")))
        except Exception:
            continue
        liabilities_usd += usd
        liability_breakdown[str(l.id)] = {"name": l.name, "usd": float(usd)}

    net_worth_usd = assets_usd - liabilities_usd
    breakdown_json = json.dumps({"assets": asset_breakdown, "liabilities": liability_breakdown})

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)

    existing = await session.execute(
        select(NetworthSnapshot).where(
            NetworthSnapshot.user_id == user_id,
            NetworthSnapshot.recorded_at >= today_start,
            NetworthSnapshot.recorded_at < tomorrow_start,
        )
    )
    snap = existing.scalar_one_or_none()

    if snap:
        snap.net_worth_usd = net_worth_usd
        snap.assets_usd = assets_usd
        snap.liabilities_usd = liabilities_usd
        snap.recorded_at = now
        snap.breakdown_json = breakdown_json
    else:
        snap = NetworthSnapshot(
            id=uuid.uuid4(),
            user_id=user_id,
            net_worth_usd=net_worth_usd,
            assets_usd=assets_usd,
            liabilities_usd=liabilities_usd,
            recorded_at=now,
            breakdown_json=breakdown_json,
        )
        session.add(snap)

    await session.commit()
    await session.refresh(snap)
    return snap
