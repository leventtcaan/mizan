"""
WHAT: GET /insights/progress and GET /insights/comparison — monthly spending aggregation
      and LLM-powered category-level trend analysis, both with a 24-hour cache.
WHY: Core retention mechanic — users return next month to see if they improved.
     Cache prevents redundant DB aggregation and LLM calls on every page refresh.
     /insights/comparison is the most expensive: one LLM call per category change.
"""

import hashlib
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.progress_insight import ProgressInsight
from app.models.transaction import Transaction
from app.models.user import User
from app.services.llm_provider import get_provider
from app.services.transaction_service import dedup_transactions_orm, get_batch_summaries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["progress"])

_MONTHS_BACK = 3
_CACHE_TTL_HOURS = 24
_DATA_TYPE_PROGRESS = "progress"
_DATA_TYPE_COMPARISON = "comparison"


# ── Response models ────────────────────────────────────────────────────────────

class MonthlyTotal(BaseModel):
    month: str
    total_spent: str
    total_income: str
    by_category: dict[str, str]


class ProgressResponse(BaseModel):
    months: list[MonthlyTotal]
    batch_count: int
    total_transactions: int
    min_date: str | None
    max_date: str | None
    cached: bool = False


class CategoryTrend(BaseModel):
    category: str
    this_month: str
    last_month: str
    change_pct: float
    trend: str
    insight: str


class ComparisonResponse(BaseModel):
    this_month: str
    last_month: str
    categories: list[CategoryTrend]
    cached: bool = False


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _cache_key(user_id, batch_ids: list[str]) -> str:
    """SHA-256 of user_id + sorted batch_ids — changes when a new batch is uploaded."""
    content = f"{user_id}|{','.join(sorted(batch_ids))}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _cache_get(
    user_id,
    data_type: str,
    expected_key: str,
    session: AsyncSession,
):
    """
    Returns the cached JSON string if the row exists, is fresh, and the cache_key
    matches (i.e. same set of batches as now). Returns None on any miss.
    """
    result = await session.execute(
        select(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type == data_type,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    if row.cache_key != expected_key:
        logger.info("Progress cache key mismatch (%s) — batch set changed", data_type)
        return None
    age = datetime.now(timezone.utc) - row.generated_at.replace(tzinfo=timezone.utc)
    if age >= timedelta(hours=_CACHE_TTL_HOURS):
        logger.info("Progress cache expired (%s) — age=%s", data_type, age)
        return None
    logger.info("Progress cache hit (%s) — age=%s", data_type, age)
    return row.data


async def _cache_set(
    user_id,
    data_type: str,
    cache_key: str,
    data: str,
    session: AsyncSession,
) -> None:
    """
    Upserts the cache row using PostgreSQL INSERT ... ON CONFLICT DO UPDATE.
    Safe for concurrent requests: the last writer wins, both have identical data.
    """
    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            data_type=data_type,
            cache_key=cache_key,
            data=data,
            generated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            constraint="uq_progress_insights_user_type",
            set_={
                "cache_key": cache_key,
                "data": data,
                "generated_at": datetime.now(timezone.utc),
            },
        )
    )
    await session.execute(stmt)
    logger.info("Progress cache written (%s) — user_id=%s", data_type, user_id)


# ── Shared aggregation ─────────────────────────────────────────────────────────

def _month_key(d) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _recent_month_keys(n: int) -> list[str]:
    now = datetime.now(timezone.utc)
    keys = []
    for i in range(n - 1, -1, -1):
        month = now.month - i
        year = now.year
        while month <= 0:
            month += 12
            year -= 1
        keys.append(f"{year:04d}-{month:02d}")
    return keys


async def _aggregate_by_month(user_id, session: AsyncSession) -> tuple[dict[str, dict], list]:
    """
    Groups all deduplicated user transactions by YYYY-MM.
    Returns (months_dict, deduplicated_transactions).
    Dedup runs here so overlapping batch uploads don't double-count.
    """
    result = await session.execute(
        select(Transaction).where(Transaction.user_id == user_id)
    )
    raw = list(result.scalars().all())
    txns = dedup_transactions_orm(raw)

    months: dict[str, dict] = defaultdict(lambda: {
        "total_spent": Decimal("0"),
        "total_income": Decimal("0"),
        "by_category": defaultdict(lambda: Decimal("0")),
    })
    for t in txns:
        key = _month_key(t.transaction_date)
        if t.transaction_type == "debit":
            months[key]["total_spent"] += t.amount
            months[key]["by_category"][t.category or "diger"] += t.amount
        else:
            months[key]["total_income"] += t.amount

    return months, txns


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/progress", response_model=ProgressResponse)
async def get_progress(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProgressResponse:
    """
    WHAT: Per-month spending/income totals for the last 3 months.
    WHY: Feeds the LineChart. Cached 24 h — only recomputes on new upload, category
         correction, or TTL expiry. Cache key changes automatically on new upload.
    """
    batch_summaries = await get_batch_summaries(current_user.id, session)
    batch_ids = [b["batch_id"] for b in batch_summaries]
    key = _cache_key(current_user.id, batch_ids)

    cached_json = await _cache_get(current_user.id, _DATA_TYPE_PROGRESS, key, session)
    if cached_json:
        data = ProgressResponse.model_validate(json.loads(cached_json))
        data.cached = True
        return data

    # ── Compute ───────────────────────────────────────────────────────────────
    by_month, txns = await _aggregate_by_month(current_user.id, session)
    month_keys = _recent_month_keys(_MONTHS_BACK)

    months = []
    for mk in month_keys:
        data = by_month.get(mk, {
            "total_spent": Decimal("0"),
            "total_income": Decimal("0"),
            "by_category": {},
        })
        months.append(MonthlyTotal(
            month=mk,
            total_spent=str(data["total_spent"]),
            total_income=str(data["total_income"]),
            by_category={cat: str(amt) for cat, amt in data["by_category"].items()},
        ))

    dates = [t.transaction_date for t in txns]
    response = ProgressResponse(
        months=months,
        batch_count=len(batch_summaries),
        total_transactions=len(txns),
        min_date=str(min(dates)) if dates else None,
        max_date=str(max(dates)) if dates else None,
        cached=False,
    )

    await _cache_set(
        current_user.id, _DATA_TYPE_PROGRESS, key,
        response.model_dump_json(exclude={"cached"}),
        session,
    )
    await session.commit()
    return response


@router.get("/comparison", response_model=ComparisonResponse)
async def get_comparison(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ComparisonResponse:
    """
    WHAT: This-month vs last-month per category with LLM one-liners.
    WHY: Category-level deltas + Turkish coaching sentence are the core retention hook.
         Cached 24 h — LLM calls only run on first load after upload or correction.
    """
    batch_summaries = await get_batch_summaries(current_user.id, session)
    batch_ids = [b["batch_id"] for b in batch_summaries]
    key = _cache_key(current_user.id, batch_ids)

    cached_json = await _cache_get(current_user.id, _DATA_TYPE_COMPARISON, key, session)
    if cached_json:
        data = ComparisonResponse.model_validate(json.loads(cached_json))
        data.cached = True
        return data

    # ── Compute ───────────────────────────────────────────────────────────────
    by_month, _ = await _aggregate_by_month(current_user.id, session)
    month_keys = _recent_month_keys(2)
    last_key, this_key = month_keys[0], month_keys[1]

    last_cats: dict[str, Decimal] = dict(by_month.get(last_key, {}).get("by_category", {}))
    this_cats: dict[str, Decimal] = dict(by_month.get(this_key, {}).get("by_category", {}))

    all_cats = set(last_cats) | set(this_cats)
    if not all_cats:
        return ComparisonResponse(
            this_month=this_key,
            last_month=last_key,
            categories=[],
            cached=False,
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

    response = ComparisonResponse(
        this_month=this_key,
        last_month=last_key,
        categories=trends,
        cached=False,
    )

    await _cache_set(
        current_user.id, _DATA_TYPE_COMPARISON, key,
        response.model_dump_json(exclude={"cached"}),
        session,
    )
    await session.commit()
    return response


def _llm_insight(provider, cat: str, last: Decimal, this: Decimal, pct: float, trend: str) -> str:
    direction = "arttı" if trend == "up" else ("azaldı" if trend == "down" else "değişmedi")
    try:
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Mizan, a global personal finance coach. "
                        "Write one short, warm sentence in the user's language when clear; otherwise use simple English. "
                        "Be curious, not judgmental."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Kategori: {cat}\n"
                        f"Geçen ay: {last:.2f}\n"
                        f"Bu ay: {this:.2f}\n"
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
        return f"{cat.capitalize()} harcaman geçen aya göre %{abs(pct):.0f} {direction}."
