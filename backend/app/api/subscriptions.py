"""
Subscription flagging — the detection/listing endpoints moved to /recurring.
Only the flag upsert remains here (still used by the Recurring page).
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.subscription_flag import SubscriptionFlag
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

_VALID_FLAGS = {"essential", "review", "cancelled"}


class FlagRequest(BaseModel):
    merchant_key: str
    flag: str  # "essential" | "review" | "cancelled"


@router.post("/flag", status_code=200)
async def flag_subscription(
    body: FlagRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.flag not in _VALID_FLAGS:
        raise HTTPException(status_code=422, detail=f"flag must be one of: {_VALID_FLAGS}")

    stmt = (
        pg_insert(SubscriptionFlag)
        .values(
            id=uuid.uuid4(),
            user_id=current_user.id,
            merchant_key=body.merchant_key,
            flag=body.flag,
        )
        .on_conflict_do_update(
            constraint="uq_subscription_flags_user_merchant",
            set_={"flag": body.flag},
        )
    )
    await session.execute(stmt)
    await session.commit()

    logger.info(
        "Subscription flagged — user=%s merchant=%s flag=%s",
        current_user.id, body.merchant_key, body.flag,
    )
    return {"merchant_key": body.merchant_key, "flag": body.flag}
