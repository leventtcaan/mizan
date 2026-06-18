"""
WHAT: GET /transactions — returns all persisted transactions for a given user.
WHY: Gives the frontend a way to display categorized transactions after upload completes.
BREAKS IF REMOVED: Frontend has no way to retrieve or display transaction data.
"""

import uuid
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransactionResponse(BaseModel):
    """
    WHAT: API representation of a single transaction row.
    WHY: Decouples the ORM model from the HTTP contract — column renames in the ORM
         don't silently change the API shape that frontend depends on.
    """

    id: uuid.UUID
    user_id: uuid.UUID
    amount: str  # WHY: Decimal serializes as string to avoid JSON float precision loss
    transaction_type: str
    description: str
    transaction_date: date
    category: str | None
    behavioral_tag: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> list[TransactionResponse]:
    """
    WHAT: Returns all transactions for the given user_id, newest-first.
    WHY: user_id as a query param is intentional for Phase 2 — auth middleware
         (Phase 3) will replace it with the JWT-extracted identity.
    BREAKS IF REMOVED: Frontend cannot display transaction history.
    """
    transactions = await get_transactions_for_user(user_id, session)

    if not transactions:
        # WHY: 200 with empty list, not 404 — the user exists but has no transactions yet.
        # 404 would force the frontend to special-case "no data" vs "wrong user".
        return []

    return [
        TransactionResponse(
            id=t.id,
            user_id=t.user_id,
            amount=str(t.amount),
            transaction_type=t.transaction_type,
            description=t.description,
            transaction_date=t.transaction_date,
            category=t.category,
            behavioral_tag=t.behavioral_tag,
            created_at=t.created_at,
        )
        for t in transactions
    ]
