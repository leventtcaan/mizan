"""
WHAT: GET /transactions and DELETE /transactions/batch/{upload_id} endpoints.
WHY: Gives the frontend a way to display categorized transactions after upload completes,
     and allows clearing a specific upload batch without touching others.
BREAKS IF REMOVED: Frontend has no way to retrieve or manage transaction data.
"""

import logging
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.transaction_service import (
    delete_batch,
    get_batch_summaries,
    get_transactions_for_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransactionResponse(BaseModel):
    id: str
    user_id: str
    upload_batch_id: str | None
    amount: str
    transaction_type: str
    description: str
    transaction_date: date
    category: str | None
    behavioral_tag: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BatchSummaryResponse(BaseModel):
    batch_id: str
    uploaded_at: datetime
    transaction_count: int
    min_date: date
    max_date: date


class DeleteBatchResponse(BaseModel):
    upload_batch_id: str
    deleted_count: int
    message: str


@router.get("/batches", response_model=list[BatchSummaryResponse])
async def list_batches(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BatchSummaryResponse]:
    """
    WHAT: Returns one summary row per upload batch for the authenticated user, newest first.
    WHY: Frontend uses this to show which statement is currently displayed, let the user
         toggle between batches, and render an upload history list.
    """
    summaries = await get_batch_summaries(current_user.id, session)
    return [BatchSummaryResponse(**s) for s in summaries]


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    all: bool = False,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TransactionResponse]:
    """
    WHAT: Returns transactions for the authenticated user.
           Default: latest upload batch only.
           ?all=true: every batch ever uploaded.
    WHY: user_id comes from the JWT — the caller can only see their own transactions.
    BREAKS IF REMOVED: Frontend cannot display transaction history.
    """
    transactions = await get_transactions_for_user(current_user.id, session, all_batches=all)

    return [
        TransactionResponse(
            id=str(t.id),
            user_id=str(t.user_id),
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
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeleteBatchResponse:
    """
    WHAT: Deletes all transactions from a specific upload batch for the authenticated user.
    WHY: Ownership is enforced by the service layer using current_user.id — not a query param
         that an attacker could forge.
    BREAKS IF REMOVED: No way to undo a bad upload; stale data accumulates indefinitely.
    """
    deleted = await delete_batch(upload_batch_id, current_user.id, session)

    if deleted == 0:
        raise HTTPException(
            status_code=404,
            detail=f"No transactions found for batch {upload_batch_id}.",
        )

    return DeleteBatchResponse(
        upload_batch_id=upload_batch_id,
        deleted_count=deleted,
        message=f"Deleted {deleted} transactions from batch {upload_batch_id}.",
    )
