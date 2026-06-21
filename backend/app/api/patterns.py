import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.dismissed_alert import DismissedAlert
from app.models.user import User
from app.services.patterns import Alert, detect_patterns
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patterns", tags=["patterns"])

_ARCHIVE_AFTER_DAYS = 30


class AlertResponse(BaseModel):
    type: str
    message: str
    amount: str
    actionable: bool
    dismiss_key: str


class DismissRequest(BaseModel):
    dismiss_key: str


@router.get("/alerts", response_model=list[AlertResponse])
async def get_alerts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AlertResponse]:
    """
    WHAT: Detects spending pattern alerts for the user, filtering out any they have
          already dismissed. Pure algorithmic detection — no LLM, fast on every load.
    WHY: Recurring payments and spend spikes are invisible to users who don't look
          closely at transaction lists. Surfacing them proactively drives action.
    """
    # Fetch all transactions (all batches) for pattern detection across time
    transactions = await get_transactions_for_user(
        current_user.id, session, all_batches=True
    )

    all_alerts: list[Alert] = detect_patterns(transactions)

    if not all_alerts:
        return []

    cleanup = await session.execute(
        delete(DismissedAlert).where(
            DismissedAlert.user_id == current_user.id,
            DismissedAlert.dismissed_at
            < datetime.now(timezone.utc) - timedelta(days=_ARCHIVE_AFTER_DAYS),
        )
    )
    if cleanup.rowcount:
        logger.info("Archived dismissed alerts — user=%s count=%s", current_user.id, cleanup.rowcount)
        await session.commit()

    # Load user's dismissed keys
    dismissed_result = await session.execute(
        select(DismissedAlert.dismiss_key).where(
            DismissedAlert.user_id == current_user.id
        )
    )
    dismissed_keys: set[str] = set(dismissed_result.scalars().all())

    active = [a for a in all_alerts if a.dismiss_key not in dismissed_keys]

    return [
        AlertResponse(
            type=a.type,
            message=a.message,
            amount=str(a.amount),
            actionable=a.actionable,
            dismiss_key=a.dismiss_key,
        )
        for a in active
    ]


@router.post("/alerts/dismiss", status_code=204)
async def dismiss_alert(
    body: DismissRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """
    WHAT: Persistently dismisses a pattern alert by its stable dismiss_key.
    WHY: Idempotent — uses INSERT … ON CONFLICT DO NOTHING so calling dismiss
         twice on the same key is safe (browser retry, double-click, etc.).
    """
    stmt = (
        pg_insert(DismissedAlert)
        .values(
            id=uuid.uuid4(),
            user_id=current_user.id,
            dismiss_key=body.dismiss_key,
        )
        .on_conflict_do_nothing(constraint="uq_dismissed_alerts_user_key")
    )
    await session.execute(stmt)
    await session.commit()
    logger.info(
        "Alert dismissed — user=%s key=%s", current_user.id, body.dismiss_key
    )
