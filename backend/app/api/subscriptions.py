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
from app.services.subscription_detect import detect_subscriptions as _detect_subscriptions
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

_VALID_FLAGS = {"essential", "review", "cancelled"}


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
