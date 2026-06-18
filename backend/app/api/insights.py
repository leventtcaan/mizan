"""
WHAT: GET /insights — returns behavioral coaching text for the authenticated user's transactions.
WHY: Keeps the LLM call server-side so API keys never reach the browser.
BREAKS IF REMOVED: Frontend coaching panel has no data source; Mizan's core feature is gone.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.coach import generate_insight
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["insights"])


class InsightResponse(BaseModel):
    user_id: str
    transaction_count: int
    insight: str


@router.get("", response_model=InsightResponse)
async def get_insights(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InsightResponse:
    """
    WHAT: Fetches user transactions, passes them to the coach, returns coaching text.
    WHY: user_id comes from the JWT — no query param that could be forged.
    BREAKS IF REMOVED: Frontend coaching panel returns no insight.
    """
    transactions = await get_transactions_for_user(current_user.id, session)

    logger.info("Generating insight — user_id=%s transactions=%d", current_user.id, len(transactions))

    provider = get_provider(task_type="coach")
    insight_text = await generate_insight(transactions, provider)

    return InsightResponse(
        user_id=str(current_user.id),
        transaction_count=len(transactions),
        insight=insight_text,
    )
