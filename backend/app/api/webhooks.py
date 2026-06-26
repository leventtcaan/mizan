"""
WHAT: Paddle billing webhook — POST /webhooks/paddle.
WHY:  Paddle (our Merchant of Record) is the source of truth for subscription state. It
      calls this endpoint when a subscription activates / updates / cancels; we verify the
      signature and apply the resulting plan to the user. This is the ONLY place a paid plan
      is granted by billing (admin grants are separate), so it must trust events only after
      verifying the Paddle-Signature HMAC.
BREAKS IF REMOVED: Checkout completes but the user is never upgraded server-side.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.models.user import User
from app.services import paddle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _resolve_user(data: dict, session: AsyncSession) -> User | None:
    """Find the user this subscription belongs to. Order of trust:
    1. custom_data.user_id (we set it at checkout) — the reliable correlation.
    2. an already-stored paddle_subscription_id.
    3. the paddle_customer_id."""
    custom = data.get("custom_data") or {}
    user_id = custom.get("user_id") if isinstance(custom, dict) else None
    if user_id:
        import uuid
        try:
            u = await session.get(User, uuid.UUID(str(user_id)))
            if u is not None:
                return u
        except (ValueError, TypeError):
            pass

    sub_id = data.get("id")
    if sub_id:
        u = (await session.execute(
            select(User).where(User.paddle_subscription_id == sub_id)
        )).scalar_one_or_none()
        if u is not None:
            return u

    customer_id = data.get("customer_id")
    if customer_id:
        u = (await session.execute(
            select(User).where(User.paddle_customer_id == customer_id)
        )).scalar_one_or_none()
        if u is not None:
            return u
    return None


@router.post("/paddle", status_code=status.HTTP_200_OK)
async def paddle_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Verify + apply a Paddle subscription event. Always returns 200 for an accepted
    (signature-verified) event — even if unhandled — so Paddle doesn't retry forever;
    returns 401 ONLY when the signature can't be verified.
    """
    raw = await request.body()
    sig = request.headers.get("Paddle-Signature")

    if not paddle.verify_signature(raw, sig, settings.PADDLE_WEBHOOK_SECRET):
        logger.warning("Paddle webhook: signature verification FAILED")
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_signature")

    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "ignored": "unparseable_body"}

    event_type = payload.get("event_type") or ""
    data = payload.get("data") or {}
    if not event_type.startswith("subscription."):
        return {"ok": True, "ignored": event_type}

    user = await _resolve_user(data, session)
    if user is None:
        logger.warning("Paddle webhook %s: no matching user (sub=%s)", event_type, data.get("id"))
        return {"ok": True, "ignored": "no_user"}

    # Always keep the identifiers fresh so cancel/correlation works later.
    if data.get("id"):
        user.paddle_subscription_id = data["id"]
    if data.get("customer_id"):
        user.paddle_customer_id = data["customer_id"]

    if event_type == "subscription.canceled":
        # Subscription has fully ended → drop to free immediately.
        user.plan = "free"
        user.plan_expires_at = None
        logger.info("Paddle: %s → free (canceled)", user.email)

    elif event_type in ("subscription.activated", "subscription.created", "subscription.updated"):
        plan = paddle.plan_from_subscription(data)
        sub_status = (data.get("status") or "").lower()
        if sub_status == "canceled":
            user.plan = "free"
            user.plan_expires_at = None
        elif plan in ("plus", "pro"):
            user.plan = plan
            user.plan_expires_at = paddle.subscription_period_end(data) or user.plan_expires_at
        logger.info("Paddle: %s %s → plan=%s status=%s expires=%s",
                    user.email, event_type, user.plan, sub_status, user.plan_expires_at)
    else:
        return {"ok": True, "ignored": event_type}

    await session.commit()
    return {"ok": True}
