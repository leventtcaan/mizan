import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import correction_limiter
from app.models.transaction import Transaction
from app.models.user import User
from app.models.user_correction import UserCorrection
from app.services.transaction_service import bust_insight_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transactions", tags=["corrections"])

VALID_CATEGORIES = {
    "market",
    "restoran",
    "ulasim",
    "eglence",
    "saglik",
    "fatura",
    "giyim",
    "nakit_atm",
    "transfer",
    "iade",
    "vergi",
    "teknoloji",
    "diger",
}


class CategoryPatch(BaseModel):
    category: str

    @field_validator("category")
    @classmethod
    def must_be_valid(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category. Must be one of: {sorted(VALID_CATEGORIES)}")
        return v


class TransactionCategoryResponse(BaseModel):
    id: str
    category: str
    old_category: str | None

    model_config = {"from_attributes": True}


_CORRECTION_LIMIT = 20
_CORRECTION_WINDOW = 3600  # 1 hour


@router.patch("/{transaction_id}/category", response_model=TransactionCategoryResponse)
async def correct_category(
    transaction_id: str,
    body: CategoryPatch,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionCategoryResponse:
    user_id_str = str(current_user.id)
    if not correction_limiter.is_allowed(user_id_str, _CORRECTION_LIMIT, _CORRECTION_WINDOW):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Saatlik düzeltme limitine ulaştınız.",
        )

    try:
        tx_uuid = uuid.UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transaction not found")

    result = await session.execute(
        select(Transaction).where(
            Transaction.id == tx_uuid,
            Transaction.user_id == current_user.id,
        )
    )
    tx = result.scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    old_category = tx.category
    if old_category == body.category:
        return TransactionCategoryResponse(
            id=str(tx.id),
            category=tx.category,
            old_category=old_category,
        )

    tx.category = body.category

    correction = UserCorrection(
        transaction_id=tx.id,
        user_id=current_user.id,
        old_category=old_category,
        new_category=body.category,
    )
    session.add(correction)
    await bust_insight_cache(current_user.id, session)
    await session.commit()

    logger.info(
        "Category corrected: tx=%s %s → %s by user=%s",
        transaction_id,
        old_category,
        body.category,
        current_user.id,
    )
    return TransactionCategoryResponse(
        id=str(tx.id),
        category=tx.category,
        old_category=old_category,
    )
