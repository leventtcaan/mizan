"""
Unified recurring commitments API — one surface over subscriptions + installments.
GET /recurring → { subscriptions, installments, summary } with no double-counting.
Flagging reuses the existing POST /subscriptions/flag.
"""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.subscription_flag import SubscriptionFlag
from app.models.user import User
from app.services.currency import convert
from app.services.recurring import analyze_recurring

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recurring", tags=["recurring"])


class SubscriptionItem(BaseModel):
    merchant_key: str
    merchant: str
    avg_amount: str
    currency: str
    frequency: str
    last_seen: str
    total_paid_all_time: str
    months_active: int
    category: str
    flag: str | None = None


class InstallmentItem(BaseModel):
    merchant_key: str
    merchant: str
    currency: str
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
    # "confirmed" (recurs across multiple months) vs "possible" (single-occurrence marker,
    # likely a misread like a date "11/12") — possible items need user confirmation and are
    # excluded from the committed monthly load.
    confidence: str = "confirmed"
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
    display_currency: str = Query(default="TRY"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecurringResponse:
    subs, installments = await analyze_recurring(current_user.id, session)
    cur = display_currency.upper()

    # Cache conversion factors so we don't re-resolve the same pair repeatedly.
    _factors: dict[str, float] = {}

    async def factor(from_cur: str) -> float:
        fc = (from_cur or "TRY").upper()
        if fc == cur:
            return 1.0
        if fc not in _factors:
            try:
                _factors[fc] = float(await convert(1.0, fc, cur))
            except Exception:
                _factors[fc] = 1.0
        return _factors[fc]

    flags_result = await session.execute(
        select(SubscriptionFlag.merchant_key, SubscriptionFlag.flag).where(
            SubscriptionFlag.user_id == current_user.id
        )
    )
    flag_map: dict[str, str] = {row.merchant_key: row.flag for row in flags_result}

    sub_items = []
    for s in subs:
        f = await factor(s.get("currency", "TRY"))
        sub_items.append(SubscriptionItem(
            merchant_key=s["merchant_key"],
            merchant=s["merchant"],
            avg_amount=str(round(float(s["avg_amount"]) * f, 2)),
            currency=cur,
            frequency=s["frequency"],
            last_seen=s["last_seen"],
            total_paid_all_time=str(round(float(s["total_paid_all_time"]) * f, 2)),
            months_active=s["months_active"],
            category=s["category"],
            flag=flag_map.get(s["merchant_key"]),
        ))

    inst_items = []
    for p in installments:
        f = await factor(p.get("currency", "TRY"))
        inst_items.append(InstallmentItem(
            merchant_key=p["merchant_key"],
            merchant=p["merchant"],
            currency=cur,
            monthly_amount=round(p["monthly_amount"] * f, 2),
            months_detected=p["months_detected"],
            estimated_remaining=p["estimated_remaining"],
            total_plan_months=p["total_plan_months"],
            total_paid=round(p["total_paid"] * f, 2),
            estimated_total=round(p["estimated_total"] * f, 2),
            first_seen=p["first_seen"],
            last_seen=p["last_seen"],
            category=p["category"],
            source=p["source"],
            confidence=p.get("confidence", "confirmed"),
            total_nominal=round(p["total_nominal"] * f, 2),
            opportunity_loss=round(p["opportunity_loss"] * f, 2),
            real_cost_with_opportunity=round(p["real_cost_with_opportunity"] * f, 2),
        ))

    # --- summary (cancelled subscriptions excluded) ---
    active_subs = [s for s in sub_items if s.flag != "cancelled"]
    # Only CONFIRMED installments count toward the committed "fixed load" — a single
    # "possible" occurrence is not money the user is committed to yet (and would otherwise
    # contradict the Brief/Simulator/Cashflow, which ignore unconfirmed items).
    confirmed_inst = [p for p in inst_items if p.confidence == "confirmed"]
    subscription_monthly = sum(
        (_monthly(Decimal(s.avg_amount), s.frequency) for s in active_subs), Decimal("0")
    )
    installment_monthly = sum((Decimal(str(p.monthly_amount)) for p in confirmed_inst), Decimal("0"))
    potential_savings = sum(
        (_monthly(Decimal(s.avg_amount), s.frequency) for s in active_subs if s.flag == "review"),
        Decimal("0"),
    )
    months_free = max((p.estimated_remaining for p in confirmed_inst), default=0)
    total_opp_loss = sum(p.opportunity_loss for p in confirmed_inst)

    summary = RecurringSummary(
        monthly_total=str((subscription_monthly + installment_monthly).quantize(Decimal("0.01"))),
        subscription_monthly=str(subscription_monthly.quantize(Decimal("0.01"))),
        installment_monthly=str(installment_monthly.quantize(Decimal("0.01"))),
        subscription_count=len(active_subs),
        installment_count=len(confirmed_inst),
        potential_savings=str(potential_savings.quantize(Decimal("0.01"))),
        months_until_debt_free=months_free,
        total_opportunity_loss=round(total_opp_loss, 2),
    )

    return RecurringResponse(subscriptions=sub_items, installments=inst_items, summary=summary)
