"""
App notification system.
GET /notifications — unread list (limit 30)
PATCH /notifications/{id}/read — mark one read
POST /notifications/mark-all-read — mark all read
POST /notifications/generate-daily — LLM analysis, one run per UTC day per user
"""

import json
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_verified_user
from app.core.database import get_session
from app.models.user import User
from app.models.app_notification import AppNotification
from app.services.notification_service import generate_for_user, resolve_notification_action
from app.services.email_brief import run_email_briefs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    type: str
    is_read: bool
    created_at: datetime
    action_type: str | None = None
    action_state: str = "none"
    action_data: dict | None = None
    # What actually happened when a Yes/No was answered ("Logged a 5,000 TRY payment…") —
    # only populated on the /action response so the UI can show the real outcome.
    result_message: str | None = None


class ActionRequest(BaseModel):
    answer: str  # "yes" | "no"


def _resp(n: AppNotification) -> NotificationResponse:
    data = None
    if getattr(n, "action_data", None):
        try:
            data = json.loads(n.action_data)
        except Exception:
            data = None
    return NotificationResponse(
        id=str(n.id),
        title=n.title,
        message=n.message,
        type=n.type,
        is_read=n.is_read,
        created_at=n.created_at,
        action_type=getattr(n, "action_type", None),
        action_state=getattr(n, "action_state", None) or "none",
        action_data=data,
    )


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    current_user: User = Depends(get_verified_user),
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
    current_user: User = Depends(get_verified_user),
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
    current_user: User = Depends(get_verified_user),
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


@router.post("/{notification_id}/action", response_model=NotificationResponse)
async def respond_to_action(
    notification_id: str,
    body: ActionRequest,
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationResponse:
    """Answer a proactive notification ('yes'/'no'). Dispatches to the action handler —
    e.g. a 'yes' on a payment follow-up logs the transaction and reduces the balance."""
    try:
        nid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    result = await session.execute(
        select(AppNotification).where(
            AppNotification.id == nid,
            AppNotification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not notif.action_type:
        raise HTTPException(status_code=400, detail="Notification is not actionable")

    lang = current_user.language or "tr"
    outcome = await resolve_notification_action(notif, body.answer, lang, session)
    resp = _resp(notif)
    resp.result_message = outcome.get("message")
    return resp


@router.post("/mark-all-read")
async def mark_all_read(
    current_user: User = Depends(get_verified_user),
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
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Generates daily financial notifications for the user.
    Skips if already run today (UTC). Max one run per UTC day.

    Notification language ALWAYS follows the account's language setting. (This used
    to take a client-supplied ?lang defaulting to "en" — and since generation dedupes
    once per UTC day, the page-load English run won the day for Turkish users.)

    Shares one implementation with the APScheduler job (notification_service).
    """
    lang = current_user.language or "en"
    return await generate_for_user(current_user.id, lang, session)


@router.post("/send-email-brief")
async def send_email_briefs(
    current_user: User = Depends(get_verified_user),
) -> dict:
    """
    Sends the weekly "money brief" email to every opted-in, due user. Manual trigger that
    shares its core (run_email_briefs) with the Sunday scheduler job — each user processed
    in its own AsyncSession. Returns {sent, skipped}.
    """
    return await run_email_briefs()
