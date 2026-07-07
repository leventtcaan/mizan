"""
WHAT: POST /feedback (any signed-in user) + GET /feedback (admin, category filter).
WHY: A one-tap channel for bugs/suggestions from inside the app. Every submission
     is stored durably and forwarded to the founder's inbox via Resend.
BREAKS IF REMOVED: The floating feedback button has no backend; admin loses the inbox.
"""

import asyncio
import html
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_admin_user, get_current_user
from app.core.rate_limiter import feedback_limiter
from app.models.feedback import FEEDBACK_CATEGORIES, Feedback
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackRequest(BaseModel):
    category: str
    message: str
    email: str | None = None

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str) -> str:
        if v not in FEEDBACK_CATEGORIES:
            raise ValueError(f"category must be one of: {sorted(FEEDBACK_CATEGORIES)}")
        return v

    @field_validator("message")
    @classmethod
    def valid_message(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message cannot be empty")
        if len(v) > 2000:
            raise ValueError("message must be at most 2000 characters")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if "@" not in v or len(v) > 255:
            raise ValueError("invalid email")
        return v


class FeedbackResponse(BaseModel):
    id: str
    user_id: str | None
    user_email: str | None = None  # account email (admin list only)
    category: str
    message: str
    email: str | None
    created_at: datetime


def _resp(f: Feedback, user_email: str | None = None) -> FeedbackResponse:
    return FeedbackResponse(
        id=str(f.id),
        user_id=str(f.user_id) if f.user_id else None,
        user_email=user_email,
        category=f.category,
        message=f.message,
        email=f.email,
        created_at=f.created_at,
    )


def _send_notification_sync(f: Feedback, account_email: str | None) -> None:
    """Forward the feedback to the founder's inbox. Raises on Resend errors —
    the caller treats this as best-effort."""
    import resend

    resend.api_key = settings.RESEND_API_KEY
    from app.api.email import clarifin_from

    who = account_email or f.email or "anonymous"
    safe_msg = html.escape(f.message).replace("\n", "<br>")
    reply_to = f.email or account_email
    resend.Emails.send({
        "from": clarifin_from(),
        "to": [settings.FEEDBACK_NOTIFY_EMAIL],
        "subject": f"Clarifin feedback [{f.category}] — {who}",
        "html": (
            f"<p><b>Category:</b> {f.category}<br>"
            f"<b>From:</b> {html.escape(who)}"
            + (f"<br><b>Reply-to:</b> {html.escape(reply_to)}" if reply_to else "")
            + f"<br><b>At:</b> {f.created_at.isoformat()}</p>"
            f"<hr><p>{safe_msg}</p>"
        ),
    })


@router.post("", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def submit_feedback(
    body: FeedbackRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackResponse:
    if not feedback_limiter.is_allowed(str(current_user.id), max_calls=5, window_seconds=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too much feedback in a short time — please try again later.",
        )

    fb = Feedback(
        id=uuid.uuid4(),
        user_id=current_user.id,
        category=body.category,
        message=body.message,
        email=body.email,
        created_at=datetime.now(timezone.utc),
    )
    session.add(fb)
    await session.commit()
    await session.refresh(fb)
    logger.info("Feedback received — user=%s category=%s", current_user.id, fb.category)

    # Best-effort founder notification — never fail the submission over email.
    if len(settings.RESEND_API_KEY) > 0:
        try:
            await asyncio.to_thread(_send_notification_sync, fb, current_user.email)
        except Exception as exc:
            logger.warning("Feedback notification email failed: %s", exc)

    return _resp(fb)


@router.get("", response_model=list[FeedbackResponse])
async def list_feedback(
    category: str | None = None,
    limit: int = 100,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> list[FeedbackResponse]:
    stmt = select(Feedback).order_by(Feedback.created_at.desc()).limit(max(1, min(limit, 500)))
    if category in FEEDBACK_CATEGORIES:
        stmt = stmt.where(Feedback.category == category)
    rows = (await session.execute(stmt)).scalars().all()

    # Resolve account emails in one query (feedback survives user deletion → may be None).
    user_ids = {f.user_id for f in rows if f.user_id}
    emails: dict = {}
    if user_ids:
        res = await session.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
        emails = {row[0]: row[1] for row in res.all()}
    return [_resp(f, emails.get(f.user_id)) for f in rows]
