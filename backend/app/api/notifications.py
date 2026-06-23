"""
App notification system.
GET /notifications — unread list (limit 30)
PATCH /notifications/{id}/read — mark one read
POST /notifications/mark-all-read — mark all read
POST /notifications/generate-daily — LLM analysis, one run per UTC day per user
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.database import get_session
from app.models.user import User
from app.models.app_notification import AppNotification
from app.services.notification_service import generate_for_user
from app.services.email_brief import generate_email_brief, due_for_brief

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    type: str
    is_read: bool
    created_at: datetime


def _resp(n: AppNotification) -> NotificationResponse:
    return NotificationResponse(
        id=str(n.id),
        title=n.title,
        message=n.message,
        type=n.type,
        is_read=n.is_read,
        created_at=n.created_at,
    )


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[NotificationResponse]:
    result = await session.execute(
        select(AppNotification)
        .where(AppNotification.user_id == current_user.id)
        .order_by(AppNotification.created_at.desc())
        .limit(30)
    )
    return [_resp(n) for n in result.scalars().all()]


@router.get("/unread-count")
async def unread_count(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(AppNotification).where(
            AppNotification.user_id == current_user.id,
            AppNotification.is_read == False,  # noqa: E712
        )
    )
    count = len(result.scalars().all())
    return {"count": count}


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationResponse:
    try:
        nid = uuid.UUID(notification_id)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    result = await session.execute(
        select(AppNotification).where(
            AppNotification.id == nid,
            AppNotification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_read = True
    await session.commit()
    await session.refresh(notif)
    return _resp(notif)


@router.post("/mark-all-read")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        update(AppNotification)
        .where(AppNotification.user_id == current_user.id, AppNotification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    await session.commit()
    return {"ok": True}


@router.post("/generate-daily")
async def generate_daily(
    lang: str = "en",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Generates daily financial notifications for the user.
    Skips if already run today (UTC). Max one run per UTC day.

    Shares one implementation with the APScheduler job (notification_service).
    """
    return await generate_for_user(current_user.id, lang, session)


@router.post("/send-email-brief")
async def send_email_briefs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Sends the weekly "money brief" email to every opted-in user who is due (cadence
    enforced by last_email_brief_sent + a meaningful-change gate in generate_email_brief).
    Manual trigger that shares its core with the Sunday scheduler job. Per-user failures
    are isolated. Returns {sent, skipped}.
    """
    from app.api.email import send_email_brief  # local import avoids module-load cycle

    result = await session.execute(select(User).where(User.email_weekly_enabled == True))  # noqa: E712
    users = list(result.scalars().all())

    sent = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    for user in users:
        if not due_for_brief(user, now):
            skipped += 1
            continue
        try:
            brief = await generate_email_brief(user.id, session)
            if brief is None:
                skipped += 1
                continue
            await send_email_brief(user.email, brief, brief["lang"])
            user.last_email_brief_sent = datetime.now(timezone.utc)
            session.add(user)
            await session.commit()
            sent += 1
        except Exception:
            logger.exception("Email brief failed — user=%s", user.id)
            await session.rollback()
            skipped += 1

    logger.info("Email briefs (manual trigger): sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}
