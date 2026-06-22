"""Accounts API — where money lives (banks/wallets/brokers). Assets link to one."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.account import ACCOUNT_TYPES, Account
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountRequest(BaseModel):
    name: str
    account_type: str = "bank"
    currency: str = "TRY"
    institution: str | None = None

    @field_validator("account_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ACCOUNT_TYPES:
            raise ValueError(f"account_type must be one of: {sorted(ACCOUNT_TYPES)}")
        return v

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v: str) -> str:
        code = v.strip().upper()
        if not (1 <= len(code) <= 10) or not code.isalnum():
            raise ValueError("currency must be a 1-10 char code")
        return code


class AccountResponse(BaseModel):
    id: str
    name: str
    account_type: str
    currency: str
    institution: str | None


def _resp(a: Account) -> AccountResponse:
    return AccountResponse(
        id=str(a.id), name=a.name, account_type=a.account_type,
        currency=a.currency, institution=a.institution,
    )


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AccountResponse]:
    result = await session.execute(
        select(Account).where(Account.user_id == current_user.id).order_by(Account.created_at.asc())
    )
    return [_resp(a) for a in result.scalars().all()]


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AccountResponse:
    acc = Account(
        id=uuid.uuid4(), user_id=current_user.id, name=body.name.strip()[:120],
        account_type=body.account_type, currency=body.currency, institution=(body.institution or None),
    )
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return _resp(acc)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        aid = uuid.UUID(account_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid account ID")
    result = await session.execute(
        select(Account).where(Account.id == aid, Account.user_id == current_user.id)
    )
    acc = result.scalar_one_or_none()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    await session.delete(acc)  # assets.account_id → SET NULL via FK
    await session.commit()
