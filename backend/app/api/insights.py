"""
WHAT: GET /insights — returns behavioral coaching text for a user's transaction history.
WHY: Keeps the LLM call server-side so API keys never reach the browser.
BREAKS IF REMOVED: Frontend coaching panel has no data source; Mizan's core feature is gone.
"""

import uuid
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.coach import generate_insight
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["insights"])


class InsightResponse(BaseModel):
    """
    WHAT: Response body for GET /insights.
    WHY: transaction_count is included so the frontend can show context
         ("analysis based on N transactions") without a second API call.
    """

    user_id: str
    transaction_count: int
    insight: str


@router.get("", response_model=InsightResponse)
async def get_insights(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> InsightResponse:
    """
    WHAT: Fetches user transactions, passes them to the coach, returns coaching text.
    WHY: user_id as query param mirrors GET /transactions — consistent API shape
         until JWT auth replaces it in Phase 4.
    BREAKS IF REMOVED: Frontend coaching panel returns no insight.
    """
    transactions = await get_transactions_for_user(user_id, session)

    logger.info("Generating insight — user_id=%s transactions=%d", user_id, len(transactions))

    provider = get_provider(task_type="coach")
    insight_text = await generate_insight(transactions, provider)

    return InsightResponse(
        user_id=str(user_id),
        transaction_count=len(transactions),
        insight=insight_text,
    )
