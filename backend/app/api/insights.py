"""
WHAT: GET /insights — returns behavioral coaching text for the authenticated user's transactions.
WHY: Keeps the LLM call server-side so API keys never reach the browser.
     Caches the result per upload batch (24h TTL) — page reloads don't trigger LLM.
BREAKS IF REMOVED: Frontend coaching panel has no data source; Mizan's core feature is gone.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import insight_limiter
from app.models.upload_insight import UploadInsight
from app.models.user import User
from app.services.coach import generate_insight
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_latest_batch_id, get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["insights"])

_CACHE_TTL_HOURS = 24
_RATE_LIMIT_CALLS = 10
_RATE_LIMIT_WINDOW_SECONDS = 3600  # 1 hour


class InsightResponse(BaseModel):
    user_id: str
    transaction_count: int
    insight: str
    cached: bool


@router.get("", response_model=InsightResponse)
async def get_insights(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InsightResponse:
    """
    WHAT: Returns coaching insight — from cache if fresh, from LLM if stale or missing.
    WHY: Cache key is upload_batch_id — a new upload automatically bypasses the cache
         without any explicit invalidation. 24h TTL covers the common pattern of a user
         checking insights multiple times in a day after a single upload.
    BREAKS IF REMOVED: Every page load triggers an LLM call; cost scales with page views.
    """
    user_id_str = str(current_user.id)

    if not insight_limiter.is_allowed(user_id_str, _RATE_LIMIT_CALLS, _RATE_LIMIT_WINDOW_SECONDS):
        remaining = insight_limiter.remaining(user_id_str, _RATE_LIMIT_CALLS, _RATE_LIMIT_WINDOW_SECONDS)
        logger.warning("Insight rate limit hit — user_id=%s", user_id_str)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Saatte en fazla {_RATE_LIMIT_CALLS} analiz isteği yapılabilir. Kalan: {remaining}",
        )

    transactions = await get_transactions_for_user(current_user.id, session)
    batch_id = await get_latest_batch_id(current_user.id, session)

    # ── Cache lookup ──────────────────────────────────────────────────────────
    if batch_id:
        cached_row = await session.execute(
            select(UploadInsight).where(UploadInsight.upload_batch_id == batch_id)
        )
        cached = cached_row.scalar_one_or_none()

        if cached is not None:
            age = datetime.now(timezone.utc) - cached.generated_at.replace(tzinfo=timezone.utc)
            if age < timedelta(hours=_CACHE_TTL_HOURS):
                logger.info(
                    "Insight cache hit — user_id=%s batch_id=%s age=%s",
                    user_id_str, batch_id, age,
                )
                return InsightResponse(
                    user_id=user_id_str,
                    transaction_count=len(transactions),
                    insight=cached.insight_text,
                    cached=True,
                )
            logger.info("Insight cache expired — age=%s, regenerating", age)

    # ── LLM call ──────────────────────────────────────────────────────────────
    logger.info("Generating insight — user_id=%s transactions=%d", user_id_str, len(transactions))
    provider = get_provider(task_type="coach")
    insight_text = await generate_insight(transactions, provider, user_id=current_user.id, session=session)

    # ── Cache write ───────────────────────────────────────────────────────────
    if batch_id:
        # Upsert: delete stale entry (if any) then insert fresh one
        stale = await session.execute(
            select(UploadInsight).where(UploadInsight.upload_batch_id == batch_id)
        )
        stale_row = stale.scalar_one_or_none()
        if stale_row is not None:
            await session.delete(stale_row)

        session.add(UploadInsight(
            user_id=current_user.id,
            upload_batch_id=batch_id,
            insight_text=insight_text,
            generated_at=datetime.now(timezone.utc),
        ))
        await session.commit()
        logger.info("Insight cached — user_id=%s batch_id=%s", user_id_str, batch_id)

    return InsightResponse(
        user_id=user_id_str,
        transaction_count=len(transactions),
        insight=insight_text,
        cached=False,
    )
