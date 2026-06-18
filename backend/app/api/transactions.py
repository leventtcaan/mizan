"""
WHAT: GET /transactions and DELETE /transactions/batch/{upload_id} endpoints.
WHY: Gives the frontend a way to display categorized transactions after upload completes,
     and allows clearing a specific upload batch without touching others.
BREAKS IF REMOVED: Frontend has no way to retrieve or manage transaction data.
"""

import uuid
import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.services.transaction_service import (
    delete_batch,
    get_transactions_for_user,
)

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
    upload_batch_id: str | None
    amount: str  # WHY: Decimal serializes as string to avoid JSON float precision loss
    transaction_type: str
    description: str
    transaction_date: date
    category: str | None
    behavioral_tag: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DeleteBatchResponse(BaseModel):
    upload_batch_id: str
    deleted_count: int
    message: str


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user_id: uuid.UUID,
    all: bool = False,
    session: AsyncSession = Depends(get_session),
) -> list[TransactionResponse]:
    """
    WHAT: Returns transactions for the given user.
           Default: latest upload batch only.
           ?all=true: every batch ever uploaded.
    WHY: Showing all batches by default mixes stale test uploads with the current
         statement — confusing for the user and noisy for the LLM coach.
         ?all=true is available for debugging and future batch-management UI.
    BREAKS IF REMOVED: Frontend cannot display transaction history.
    """
    transactions = await get_transactions_for_user(user_id, session, all_batches=all)

    return [
        TransactionResponse(
            id=t.id,
            user_id=t.user_id,
            upload_batch_id=t.upload_batch_id,
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


@router.delete("/batch/{upload_batch_id}", response_model=DeleteBatchResponse)
async def delete_upload_batch(
    upload_batch_id: str,
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> DeleteBatchResponse:
    """
    WHAT: Deletes all transactions from a specific upload batch for the given user.
    WHY: user_id is required so the service layer enforces ownership — one user
         cannot delete another user's batch even if they know the UUID.
         Returns 404 if the batch does not exist or belongs to a different user.
    BREAKS IF REMOVED: No way to undo a bad upload; stale data accumulates indefinitely.
    """
    deleted = await delete_batch(upload_batch_id, user_id, session)

    if deleted == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No transactions found for batch {upload_batch_id} and user {user_id}.",
        )

    return DeleteBatchResponse(
        upload_batch_id=upload_batch_id,
        deleted_count=deleted,
        message=f"Deleted {deleted} transactions from batch {upload_batch_id}.",
    )
