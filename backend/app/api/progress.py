"""
WHAT: GET /insights/progress and GET /insights/comparison — monthly spending aggregation
      and LLM-powered category-level trend analysis.
WHY: Core retention mechanic — users return next month to see if they improved.
     Without comparison there's no reason to reopen the app after the first upload.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.transaction import Transaction
from app.models.user import User
from app.services.llm_provider import get_provider
from app.services.transaction_service import dedup_transactions_orm, get_batch_summaries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["progress"])

_MONTHS_BACK = 3


# ── Response models ────────────────────────────────────────────────────────────

class MonthlyTotal(BaseModel):
    month: str          # "2026-06"
    total_spent: str    # Decimal as string
    total_income: str
    by_category: dict[str, str]  # category → total Decimal string


class ProgressResponse(BaseModel):
    months: list[MonthlyTotal]
    batch_count: int
    total_transactions: int
    min_date: str | None   # "YYYY-MM-DD"
    max_date: str | None


class CategoryTrend(BaseModel):
    category: str
    this_month: str
    last_month: str
    change_pct: float
    trend: str          # "up" | "down" | "same"
    insight: str        # LLM one-liner in Turkish


class ComparisonResponse(BaseModel):
    this_month: str     # "2026-06"
    last_month: str     # "2026-05"
    categories: list[CategoryTrend]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _month_key(d) -> str:
    """date → 'YYYY-MM' string used as bucket key and display label."""
    return f"{d.year:04d}-{d.month:02d}"


def _recent_month_keys(n: int) -> list[str]:
    """Return the last n month keys ending with the current month, oldest first."""
    now = datetime.now(timezone.utc)
    keys = []
    for i in range(n - 1, -1, -1):
        # subtract i months
        month = now.month - i
        year = now.year
        while month <= 0:
            month += 12
            year -= 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


async def _aggregate_by_month(
    user_id,
    session: AsyncSession,
) -> tuple[dict[str, dict], list]:
    """
    WHAT: Groups all user transactions by YYYY-MM and aggregates spend/income/category totals.
    WHY: Done in Python (not SQL) so we keep SQLAlchemy async and avoid dialect-specific
         date_trunc calls that would break on SQLite in tests.
         Dedup runs before aggregation so overlapping uploads (same period uploaded twice)
         don't double-count into the monthly totals.
    Returns: (months_dict, deduplicated_transactions)
    """
    result = await session.execute(
        select(Transaction).where(Transaction.user_id == user_id)
    )
    raw_transactions = list(result.scalars().all())
    transactions = dedup_transactions_orm(raw_transactions)

    months: dict[str, dict] = defaultdict(lambda: {
        "total_spent": Decimal("0"),
        "total_income": Decimal("0"),
        "by_category": defaultdict(lambda: Decimal("0")),
    })

    for t in transactions:
        key = _month_key(t.transaction_date)
        if t.transaction_type == "debit":
            months[key]["total_spent"] += t.amount
            cat = t.category or "diger"
            months[key]["by_category"][cat] += t.amount
        else:
            months[key]["total_income"] += t.amount

    return months, transactions


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/progress", response_model=ProgressResponse)
async def get_progress(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProgressResponse:
    """
    WHAT: Returns per-month spending/income totals for the last 3 months plus context stats.
    WHY: Feeds the LineChart on the progress page. Context stats (batch_count,
         total_transactions, date_range) let the frontend show a transparency header
         so users know how many statements are included.
    """
    by_month, transactions = await _aggregate_by_month(current_user.id, session)
    keys = _recent_month_keys(_MONTHS_BACK)

    months = []
    for key in keys:
        data = by_month.get(key, {"total_spent": Decimal("0"), "total_income": Decimal("0"), "by_category": {}})
        months.append(MonthlyTotal(
            month=key,
            total_spent=str(data["total_spent"]),
            total_income=str(data["total_income"]),
            by_category={cat: str(amt) for cat, amt in data["by_category"].items()},
        ))

    batch_summaries = await get_batch_summaries(current_user.id, session)
    dates = [t.transaction_date for t in transactions]

    return ProgressResponse(
        months=months,
        batch_count=len(batch_summaries),
        total_transactions=len(transactions),
        min_date=str(min(dates)) if dates else None,
        max_date=str(max(dates)) if dates else None,
    )


@router.get("/comparison", response_model=ComparisonResponse)
async def get_comparison(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ComparisonResponse:
    """
    WHAT: Compares this month vs last month per category with LLM one-liners.
    WHY: Category-level deltas with a human-readable insight are the core retention hook —
         "Market harcaman %15 azaldı" is more motivating than a raw number.
    """
    by_month, _ = await _aggregate_by_month(current_user.id, session)
    keys = _recent_month_keys(2)  # [last_month, this_month]
    last_key, this_key = keys[0], keys[1]

    last_data = by_month.get(last_key, {"by_category": {}})
    this_data = by_month.get(this_key, {"by_category": {}})

    last_cats: dict[str, Decimal] = dict(last_data["by_category"])
    this_cats: dict[str, Decimal] = dict(this_data["by_category"])

    all_cats = set(last_cats) | set(this_cats)
    if not all_cats:
        return ComparisonResponse(
            this_month=this_key,
            last_month=last_key,
            categories=[],
        )

    provider = get_provider(task_type="coach")

    trends: list[CategoryTrend] = []
    for cat in sorted(all_cats):
        last_amt = last_cats.get(cat, Decimal("0"))
        this_amt = this_cats.get(cat, Decimal("0"))

        if last_amt == 0:
            change_pct = 100.0 if this_amt > 0 else 0.0
            trend = "up" if this_amt > 0 else "same"
        elif this_amt == 0:
            change_pct = -100.0
            trend = "down"
        else:
            change_pct = float((this_amt - last_amt) / last_amt * 100)
            trend = "up" if change_pct > 1 else ("down" if change_pct < -1 else "same")

        insight = _llm_insight(provider, cat, last_amt, this_amt, change_pct, trend)

        trends.append(CategoryTrend(
            category=cat,
            this_month=str(this_amt),
            last_month=str(last_amt),
            change_pct=round(change_pct, 1),
            trend=trend,
            insight=insight,
        ))

    return ComparisonResponse(
        this_month=this_key,
        last_month=last_key,
        categories=trends,
    )


def _llm_insight(provider, cat: str, last: Decimal, this: Decimal, pct: float, trend: str) -> str:
    """One-sentence Turkish coaching line for a single category delta."""
    direction = "arttı" if trend == "up" else ("azaldı" if trend == "down" else "değişmedi")
    try:
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Sen Mizan adlı Türk kişisel finans koçusun. "
                        "Kullanıcıya kısa, samimi, Türkçe tek cümlelik yorum yap. "
                        "Yargılamadan, merak eden bir tonla."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Kategori: {cat}\n"
                        f"Geçen ay: {last:.2f} ₺\n"
                        f"Bu ay: {this:.2f} ₺\n"
                        f"Değişim: %{abs(pct):.1f} {direction}\n"
                        "Tek cümlelik yorum:"
                    ),
                },
            ],
            temperature=0.7,
            max_tokens=80,
        )
        return resp.choices[0].message.content.strip() or f"{cat} harcaman {direction}."
    except Exception as exc:
        logger.warning("LLM insight failed for category %s: %s", cat, exc)
        pct_str = f"%{abs(pct):.0f}"
        return f"{cat.capitalize()} harcaman geçen aya göre {pct_str} {direction}."
