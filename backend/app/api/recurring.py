"""
Unified recurring commitments API — one surface over subscriptions + installments.
GET /recurring → { subscriptions, installments, summary } with no double-counting.
Flagging reuses the existing POST /subscriptions/flag.
"""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.subscription_flag import SubscriptionFlag
from app.models.user import User
from app.services.recurring import analyze_recurring

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recurring", tags=["recurring"])


class SubscriptionItem(BaseModel):
    merchant_key: str
    merchant: str
    avg_amount: str
    frequency: str
    last_seen: str
    total_paid_all_time: str
    months_active: int
    category: str
    flag: str | None = None


class InstallmentItem(BaseModel):
    merchant_key: str
    merchant: str
    monthly_amount: float
    months_detected: int
    estimated_remaining: int
    total_plan_months: int
    total_paid: float
    estimated_total: float
    first_seen: str
    last_seen: str
    category: str
    source: str
    total_nominal: float
    opportunity_loss: float
    real_cost_with_opportunity: float


class RecurringSummary(BaseModel):
    monthly_total: str            # all active commitments, normalized to monthly
    subscription_monthly: str
    installment_monthly: str
    subscription_count: int
    installment_count: int
    potential_savings: str        # review-flagged subscriptions, monthly
    months_until_debt_free: int   # max remaining across installments
    total_opportunity_loss: float


class RecurringResponse(BaseModel):
    subscriptions: list[SubscriptionItem]
    installments: list[InstallmentItem]
    summary: RecurringSummary


def _monthly(avg: Decimal, frequency: str) -> Decimal:
    return avg * 4 if frequency == "weekly" else avg


@router.get("", response_model=RecurringResponse)
async def get_recurring(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecurringResponse:
    subs, installments = await analyze_recurring(current_user.id, session)

    flags_result = await session.execute(
        select(SubscriptionFlag.merchant_key, SubscriptionFlag.flag).where(
            SubscriptionFlag.user_id == current_user.id
        )
    )
    flag_map: dict[str, str] = {row.merchant_key: row.flag for row in flags_result}

    sub_items = [SubscriptionItem(**s, flag=flag_map.get(s["merchant_key"])) for s in subs]
    inst_items = [InstallmentItem(**p) for p in installments]

    # --- summary (cancelled subscriptions excluded) ---
    active_subs = [s for s in sub_items if s.flag != "cancelled"]
    subscription_monthly = sum(
        (_monthly(Decimal(s.avg_amount), s.frequency) for s in active_subs), Decimal("0")
    )
    installment_monthly = sum((Decimal(str(p.monthly_amount)) for p in inst_items), Decimal("0"))
    potential_savings = sum(
        (_monthly(Decimal(s.avg_amount), s.frequency) for s in active_subs if s.flag == "review"),
        Decimal("0"),
    )
    months_free = max((p.estimated_remaining for p in inst_items), default=0)
    total_opp_loss = sum(p.opportunity_loss for p in inst_items)

    summary = RecurringSummary(
        monthly_total=str((subscription_monthly + installment_monthly).quantize(Decimal("0.01"))),
        subscription_monthly=str(subscription_monthly.quantize(Decimal("0.01"))),
        installment_monthly=str(installment_monthly.quantize(Decimal("0.01"))),
        subscription_count=len(active_subs),
        installment_count=len(inst_items),
        potential_savings=str(potential_savings.quantize(Decimal("0.01"))),
        months_until_debt_free=months_free,
        total_opportunity_loss=round(total_opp_loss, 2),
    )

    return RecurringResponse(subscriptions=sub_items, installments=inst_items, summary=summary)
