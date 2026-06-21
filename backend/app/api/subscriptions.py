import logging
import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.subscription_flag import SubscriptionFlag
from app.models.user import User
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

# Same thresholds as patterns.py for consistency
_MIN_AMOUNT = Decimal("10")
_AMOUNT_VARIANCE = Decimal("0.10")   # ±10% (looser than patterns.py ±5%)
_MIN_MONTHS = 2

_VALID_FLAGS = {"essential", "review", "cancelled"}


def _normalize_key(description: str) -> str:
    return description.strip().lower()[:30]


def _clean_merchant_name(description: str) -> str:
    """Best-effort display name from raw transaction description."""
    name = description.strip()
    # Strip common card/banking prefixes seen in statement descriptions.
    for prefix in ("POS ALIŞVERİŞİ ", "SANAL POS ", "YURT DIŞI SANAL POS ", "İNTERNET ", "MOBİL "):
        if name.upper().startswith(prefix):
            name = name[len(prefix):]
            break
    return name[:45]


def _detect_subscriptions(transactions) -> list[dict]:
    """
    Groups debit transactions by normalized description.
    If the same merchant appears in ≥2 distinct calendar months with
    monthly totals within ±10% of the median → subscription candidate.
    Returns list sorted by avg_amount descending.
    """
    # Use all history, not just 90-day window, to catch annual subscriptions
    debits = [t for t in transactions if t.transaction_type == "debit"]

    by_key: dict[str, list] = defaultdict(list)
    for t in debits:
        by_key[_normalize_key(t.description)].append(t)

    results = []
    for key, group in by_key.items():
        by_month: dict[str, list[Decimal]] = defaultdict(list)
        for t in group:
            by_month[t.transaction_date.strftime("%Y-%m")].append(t.amount)

        if len(by_month) < _MIN_MONTHS:
            continue

        monthly_totals = [sum(amounts) for amounts in by_month.values()]
        monthly_totals_sorted = sorted(monthly_totals)
        median = monthly_totals_sorted[len(monthly_totals_sorted) // 2]

        if median < _MIN_AMOUNT:
            continue

        consistent = all(
            abs(total - median) / median <= _AMOUNT_VARIANCE
            for total in monthly_totals
            if median > 0
        )
        if not consistent:
            continue

        all_dates = sorted(t.transaction_date for t in group)
        last_seen = all_dates[-1]
        oldest = all_dates[0]
        total_paid = sum(t.amount for t in group)
        months_active = len(by_month)

        # Infer frequency: if avg gap between occurrences is <15 days → weekly
        if len(all_dates) >= 2:
            gaps = [
                (all_dates[i + 1] - all_dates[i]).days
                for i in range(len(all_dates) - 1)
            ]
            avg_gap = sum(gaps) / len(gaps)
            frequency = "weekly" if avg_gap < 15 else "monthly"
        else:
            frequency = "monthly"

        # Use category from the most recent transaction
        latest_tx = max(group, key=lambda t: t.transaction_date)
        category = latest_tx.category or "diger"

        results.append({
            "merchant_key": key,
            "merchant": _clean_merchant_name(group[0].description),
            "avg_amount": str(median),
            "frequency": frequency,
            "last_seen": last_seen.isoformat(),
            "total_paid_all_time": str(total_paid),
            "months_active": months_active,
            "category": category,
        })

    results.sort(key=lambda x: Decimal(x["avg_amount"]), reverse=True)
    return results


# --- Response models ---

class SubscriptionItem(BaseModel):
    merchant_key: str
    merchant: str
    avg_amount: str
    frequency: str
    last_seen: str
    total_paid_all_time: str
    months_active: int
    category: str
    flag: str | None = None   # "essential" | "review" | "cancelled" | None


class SubscriptionsResponse(BaseModel):
    subscriptions: list[SubscriptionItem]


class SummaryResponse(BaseModel):
    total_monthly_cost: str
    count: int
    flagged_for_review: list[str]
    potential_savings: str


class FlagRequest(BaseModel):
    merchant_key: str
    flag: str   # "essential" | "review" | "cancelled"


# --- Endpoints ---

@router.get("", response_model=SubscriptionsResponse)
async def get_subscriptions(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubscriptionsResponse:
    transactions = await get_transactions_for_user(
        current_user.id, session, all_batches=True
    )
    detected = _detect_subscriptions(transactions)

    # Load user flags
    flags_result = await session.execute(
        select(SubscriptionFlag.merchant_key, SubscriptionFlag.flag).where(
            SubscriptionFlag.user_id == current_user.id
        )
    )
    flag_map: dict[str, str] = {row.merchant_key: row.flag for row in flags_result}

    items = [
        SubscriptionItem(**sub, flag=flag_map.get(sub["merchant_key"]))
        for sub in detected
    ]

    logger.info(
        "Subscriptions fetched — user=%s count=%d", current_user.id, len(items)
    )
    return SubscriptionsResponse(subscriptions=items)


@router.post("/flag", status_code=200)
async def flag_subscription(
    body: FlagRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.flag not in _VALID_FLAGS:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=f"flag must be one of: {_VALID_FLAGS}")

    stmt = (
        pg_insert(SubscriptionFlag)
        .values(
            id=uuid.uuid4(),
            user_id=current_user.id,
            merchant_key=body.merchant_key,
            flag=body.flag,
        )
        .on_conflict_do_update(
            constraint="uq_subscription_flags_user_merchant",
            set_={"flag": body.flag},
        )
    )
    await session.execute(stmt)
    await session.commit()

    logger.info(
        "Subscription flagged — user=%s merchant=%s flag=%s",
        current_user.id, body.merchant_key, body.flag,
    )
    return {"merchant_key": body.merchant_key, "flag": body.flag}


@router.get("/summary", response_model=SummaryResponse)
async def get_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SummaryResponse:
    transactions = await get_transactions_for_user(
        current_user.id, session, all_batches=True
    )
    detected = _detect_subscriptions(transactions)

    flags_result = await session.execute(
        select(SubscriptionFlag.merchant_key, SubscriptionFlag.flag).where(
            SubscriptionFlag.user_id == current_user.id
        )
    )
    flag_map: dict[str, str] = {row.merchant_key: row.flag for row in flags_result}

    active = [s for s in detected if flag_map.get(s["merchant_key"]) != "cancelled"]

    total_monthly = sum(
        Decimal(s["avg_amount"]) for s in active
        if s["frequency"] == "monthly"
    ) + sum(
        Decimal(s["avg_amount"]) * 4 for s in active
        if s["frequency"] == "weekly"
    )

    review_keys = [
        s["merchant"] for s in active
        if flag_map.get(s["merchant_key"]) == "review"
    ]
    potential_savings = sum(
        Decimal(s["avg_amount"]) for s in active
        if flag_map.get(s["merchant_key"]) == "review" and s["frequency"] == "monthly"
    ) + sum(
        Decimal(s["avg_amount"]) * 4 for s in active
        if flag_map.get(s["merchant_key"]) == "review" and s["frequency"] == "weekly"
    )

    return SummaryResponse(
        total_monthly_cost=str(total_monthly),
        count=len(active),
        flagged_for_review=review_keys,
        potential_savings=str(potential_savings),
    )
