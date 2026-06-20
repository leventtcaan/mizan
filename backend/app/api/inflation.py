"""
WHAT: GET /inflation/analysis — returns inflation-adjusted category spend changes.
WHY: Pure math endpoint, no LLM. Fast even without cache, but we cache anyway
     so repeated page loads don't re-scan the full transaction table every time.
     Reuses ProgressInsight table with data_type="inflation" — same TTL and bust
     logic as progress/comparison (bust_progress_cache already covers this key).
"""

import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.progress_insight import ProgressInsight
from app.models.user import User
from app.services.inflation import analyze_user_inflation
from app.services.transaction_service import get_batch_summaries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inflation", tags=["inflation"])

_CACHE_TTL_HOURS = 24
_DATA_TYPE = "inflation"


class CategoryInflation(BaseModel):
    category: str
    old_avg: float
    new_avg: float
    old_month: str
    new_month: str
    nominal_pct: float
    inflation_pct: float
    real_pct: float
    verdict: str
    months_compared: int


class InflationResponse(BaseModel):
    analyses: list[CategoryInflation]
    cached: bool = False


def _cache_key(user_id: uuid.UUID, batch_ids: list[str]) -> str:
    content = f"{user_id}|{','.join(sorted(batch_ids))}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _cache_get(
    user_id: uuid.UUID,
    expected_key: str,
    session: AsyncSession,
) -> str | None:
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
        logger.info("Inflation cache key mismatch — batch set changed")
        return None
    age = datetime.now(timezone.utc) - row.generated_at.replace(tzinfo=timezone.utc)
    if age >= timedelta(hours=_CACHE_TTL_HOURS):
        logger.info("Inflation cache expired — age=%s", age)
        return None
    logger.info("Inflation cache hit — age=%s", age)
    return row.data


async def _cache_set(
    user_id: uuid.UUID,
    cache_key: str,
    data: str,
    session: AsyncSession,
) -> None:
    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            data_type=_DATA_TYPE,
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
    logger.info("Inflation cache written — user_id=%s", user_id)


@router.get("/analysis", response_model=InflationResponse)
async def inflation_analysis(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InflationResponse:
    """
    WHAT: Returns inflation-adjusted spend change per category.
    WHY: Instant differentiator — no Turkish PFM shows whether your spending increase
         is real (you spend more in real terms) or just inflation catch-up.
    CACHE: 24h, same key as progress cache. Busted by new upload or category correction.
    """
    batches = await get_batch_summaries(current_user.id, session)
    batch_ids = [b["batch_id"] for b in batches]
    key = _cache_key(current_user.id, batch_ids)

    cached_json = await _cache_get(current_user.id, key, session)
    if cached_json:
        analyses = json.loads(cached_json)
        return InflationResponse(
            analyses=[CategoryInflation(**a) for a in analyses],
            cached=True,
        )

    raw = await analyze_user_inflation(current_user.id, session)
    await _cache_set(current_user.id, key, json.dumps(raw), session)
    await session.commit()

    return InflationResponse(
        analyses=[CategoryInflation(**a) for a in raw],
        cached=False,
    )
