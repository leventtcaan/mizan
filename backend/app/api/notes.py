import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.transaction import Transaction
from app.models.transaction_note import TransactionNote
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transactions", tags=["notes"])


class NoteCreate(BaseModel):
    note_text: str

    @field_validator("note_text")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("note_text cannot be empty")
        return v


class NoteResponse(BaseModel):
    id: str
    transaction_id: str
    note_text: str
    created_at: datetime

    model_config = {"from_attributes": True}


async def _get_transaction_owned_by(
    transaction_id: str,
    user: User,
    session: AsyncSession,
) -> Transaction:
    try:
        tx_uuid = uuid.UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Transaction not found")

    result = await session.execute(
        select(Transaction).where(
            Transaction.id == tx_uuid,
            Transaction.user_id == user.id,
        )
    )
    tx = result.scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.post("/{transaction_id}/notes", response_model=NoteResponse, status_code=201)
async def add_note(
    transaction_id: str,
    body: NoteCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NoteResponse:
    tx = await _get_transaction_owned_by(transaction_id, current_user, session)

    note = TransactionNote(
        transaction_id=tx.id,
        user_id=current_user.id,
        note_text=body.note_text,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)

    logger.info("Note added to transaction %s by user %s", transaction_id, current_user.id)
    return NoteResponse(
        id=str(note.id),
        transaction_id=str(note.transaction_id),
        note_text=note.note_text,
        created_at=note.created_at,
    )


@router.get("/{transaction_id}/notes", response_model=list[NoteResponse])
async def list_notes(
    transaction_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[NoteResponse]:
    await _get_transaction_owned_by(transaction_id, current_user, session)

    result = await session.execute(
        select(TransactionNote)
        .where(TransactionNote.transaction_id == uuid.UUID(transaction_id))
        .order_by(TransactionNote.created_at)
    )
    notes = result.scalars().all()

    return [
        NoteResponse(
            id=str(n.id),
            transaction_id=str(n.transaction_id),
            note_text=n.note_text,
            created_at=n.created_at,
        )
        for n in notes
    ]
