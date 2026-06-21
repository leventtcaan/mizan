import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.progress_insight import ProgressInsight
from app.models.user import User
from app.services.installment import analyze_user_installments
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_batch_summaries, get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/installments", tags=["installments"])

_CACHE_TTL_HOURS = 24
_DATA_TYPE = "installments"


# --- Response models ---

class InstallmentPlan(BaseModel):
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


class InstallmentResponse(BaseModel):
    plans: list[InstallmentPlan]
    insight: str | None = None
    cached: bool = False


class InstallmentSummary(BaseModel):
    total_monthly_burden: float
    active_plan_count: int
    months_until_debt_free: int
    total_remaining_nominal: float
    total_opportunity_loss: float
    income_pct: float | None = None   # None when no income detected


# --- Cache helpers (same pattern as inflation.py) ---

def _cache_key(user_id: uuid.UUID, batch_ids: list[str]) -> str:
    content = f"{user_id}|{','.join(sorted(batch_ids))}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _cache_get(user_id: uuid.UUID, expected_key: str, session: AsyncSession) -> str | None:
    result = await session.execute(
        select(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type == _DATA_TYPE,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    if row.cache_key != expected_key:
        return None
    age = datetime.now(timezone.utc) - row.generated_at.replace(tzinfo=timezone.utc)
    if age >= timedelta(hours=_CACHE_TTL_HOURS):
        return None
    logger.info("Installment cache hit — age=%s", age)
    return row.data


async def _cache_set(user_id: uuid.UUID, key: str, data: str, session: AsyncSession) -> None:
    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            data_type=_DATA_TYPE,
            cache_key=key,
            data=data,
            generated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            constraint="uq_progress_insights_user_type",
            set_={
                "cache_key": key,
                "data": data,
                "generated_at": datetime.now(timezone.utc),
            },
        )
    )
    await session.execute(stmt)


def _generate_insight(plans: list[dict]) -> str | None:
    """Single LLM call for a one-liner about installment burden. Silent on failure."""
    if not plans:
        return None
    try:
        provider = get_provider()
        total_monthly = sum(p["monthly_amount"] for p in plans)
        total_remaining = sum(p["total_nominal"] for p in plans)
        plan_count = len(plans)
        merchants = ", ".join(p["merchant"][:20] for p in plans[:3])

        prompt = (
            f"Kullanıcının {plan_count} adet taksit planı var. "
            f"Toplam aylık taksit yükü: {total_monthly:.0f}. "
            f"Kalan toplam taksit tutarı: {total_remaining:.0f}. "
            f"Başlıca taksitler: {merchants}. "
            "Write one behavioral coaching sentence about this installment load. "
            "Use the user's language when clear; otherwise use simple English. "
            "Rakamları tekrarlama — sadece ne yapmalı veya nasıl düşünmeli."
        )
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": "You are a concise, practical global personal finance coach."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.6,
            max_tokens=120,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.warning("Installment insight LLM failed: %s", exc)
        return None


# --- Endpoints ---

@router.get("", response_model=InstallmentResponse)
async def get_installments(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InstallmentResponse:
    batches = await get_batch_summaries(current_user.id, session)
    batch_ids = [b["batch_id"] for b in batches]
    key = _cache_key(current_user.id, batch_ids)

    cached_json = await _cache_get(current_user.id, key, session)
    if cached_json:
        payload = json.loads(cached_json)
        return InstallmentResponse(
            plans=[InstallmentPlan(**p) for p in payload["plans"]],
            insight=payload.get("insight"),
            cached=True,
        )

    plans = await analyze_user_installments(current_user.id, session)
    insight = _generate_insight(plans)

    payload = {"plans": plans, "insight": insight}
    await _cache_set(current_user.id, key, json.dumps(payload), session)
    await session.commit()

    return InstallmentResponse(
        plans=[InstallmentPlan(**p) for p in plans],
        insight=insight,
        cached=False,
    )


@router.get("/summary", response_model=InstallmentSummary)
async def get_installment_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InstallmentSummary:
    plans = await analyze_user_installments(current_user.id, session)

    if not plans:
        return InstallmentSummary(
            total_monthly_burden=0.0,
            active_plan_count=0,
            months_until_debt_free=0,
            total_remaining_nominal=0.0,
            total_opportunity_loss=0.0,
        )

    total_monthly = sum(p["monthly_amount"] for p in plans)
    total_remaining_nominal = sum(p["total_nominal"] for p in plans)
    total_opportunity_loss = sum(p["opportunity_loss"] for p in plans)

    # Months until debt free = max remaining across all plans
    months_until_free = max((p["estimated_remaining"] for p in plans), default=0)

    # Estimate income from credits in last 3 months
    transactions = await get_transactions_for_user(current_user.id, session, all_batches=True)
    from datetime import date, timedelta
    cutoff = date.today() - timedelta(days=90)
    recent_credits = [
        t for t in transactions
        if t.transaction_type == "credit" and t.transaction_date >= cutoff
    ]
    income_pct: float | None = None
    if recent_credits:
        monthly_income = sum(t.amount for t in recent_credits) / 3
        if monthly_income > 0:
            income_pct = round(float(total_monthly / monthly_income * 100), 1)

    return InstallmentSummary(
        total_monthly_burden=round(total_monthly, 2),
        active_plan_count=len(plans),
        months_until_debt_free=months_until_free,
        total_remaining_nominal=round(total_remaining_nominal, 2),
        total_opportunity_loss=round(total_opportunity_loss, 2),
        income_pct=income_pct,
    )
