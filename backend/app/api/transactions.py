"""
WHAT: GET /transactions and DELETE /transactions/batch/{upload_id} endpoints.
WHY: Gives the frontend a way to display categorized transactions after upload completes,
     and allows clearing a specific upload batch without touching others.
BREAKS IF REMOVED: Frontend has no way to retrieve or manage transaction data.
"""

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.transaction import Transaction
from app.models.user import User
from app.services.categorizer import categorize_batch
from app.services.llm_provider import get_provider
from app.services.transaction_service import (
    bust_insight_cache,
    bust_progress_cache,
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
    currency: str
    transaction_type: str
    description: str
    transaction_date: date
    category: str | None
    behavioral_tag: str | None
    source: str
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


VALID_CATEGORIES = {
    "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
    "giyim", "nakit_atm", "transfer", "iade", "vergi", "teknoloji", "diger",
}

# Provenance values a manual entry is allowed to declare. Statement-parsed rows are
# only ever created by the upload pipeline, never through this endpoint.
VALID_SOURCES = {"manual", "user_estimate", "user_confirmed", "user_supplementary"}


class ManualTransactionRequest(BaseModel):
    amount: str
    transaction_type: str
    description: str
    transaction_date: date
    category: str | None = None
    currency: str = "TRY"
    source: str = "manual"

    @field_validator("source")
    @classmethod
    def valid_source(cls, v: str) -> str:
        if v not in VALID_SOURCES:
            raise ValueError(f"Invalid source. Must be one of: {sorted(VALID_SOURCES)}")
        return v

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v: str) -> str:
        code = v.strip().upper()
        if not (1 <= len(code) <= 10) or not code.isalnum():
            raise ValueError("currency must be a 1-10 char code")
        return code

    @field_validator("transaction_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ("debit", "credit"):
            raise ValueError("transaction_type must be 'debit' or 'credit'")
        return v

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category. Must be one of: {sorted(VALID_CATEGORIES)}")
        return v

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, v: str) -> str:
        try:
            val = Decimal(v.replace(",", "."))
        except Exception:
            raise ValueError("Amount must be a valid number")
        if val <= 0:
            raise ValueError("Amount must be positive")
        return v


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
            currency=t.currency,
            transaction_type=t.transaction_type,
            description=t.description,
            transaction_date=t.transaction_date,
            category=t.category,
            behavioral_tag=t.behavioral_tag,
            source=t.source,
            created_at=t.created_at,
        )
        for t in transactions
    ]


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    body: ManualTransactionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionResponse:
    """
    WHAT: Manually inserts a single transaction for the authenticated user.
    WHY: Users need to record cash payments and transactions not in their bank statement.
         If no category is supplied, runs the LLM categorizer on the single description.
         upload_batch_id is None — manual entries are not tied to any upload batch.
    """
    amount = Decimal(body.amount.replace(",", "."))
    tx = Transaction(
        user_id=current_user.id,
        amount=amount,
        currency=body.currency,
        transaction_type=body.transaction_type,
        description=body.description,
        transaction_date=body.transaction_date,
        upload_batch_id=None,
        source=body.source,
    )

    if body.category:
        tx.category = body.category
    else:
        session.add(tx)
        await session.flush()
        provider = get_provider()
        try:
            await categorize_batch([tx], provider)
        except Exception:
            logger.warning("LLM categorization failed for manual transaction — leaving category=None")

    session.add(tx)
    await bust_insight_cache(current_user.id, session)
    await bust_progress_cache(current_user.id, session)
    await session.commit()

    logger.info(
        "Manual transaction inserted — user_id=%s amount=%s description=%.30s",
        current_user.id, tx.amount, tx.description,
    )

    return TransactionResponse(
        id=str(tx.id),
        user_id=str(tx.user_id),
        upload_batch_id=tx.upload_batch_id,
        amount=str(tx.amount),
        currency=tx.currency,
        transaction_type=tx.transaction_type,
        description=tx.description,
        transaction_date=tx.transaction_date,
        category=tx.category,
        behavioral_tag=tx.behavioral_tag,
        source=tx.source,
        created_at=tx.created_at,
    )


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
