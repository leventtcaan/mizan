"""
WHAT: Authenticated billing endpoints — GET /billing/subscription, POST /billing/cancel.
WHY:  Lets the user see their current plan + next renewal and cancel their Paddle
      subscription. Plan state itself is owned by the Paddle webhook (source of truth);
      these endpoints read the user's stored plan and ask Paddle to cancel. The downgrade
      to free is applied when Paddle later sends subscription.canceled.
BREAKS IF REMOVED: Settings can't show renewal info and the user can't self-cancel.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_verified_user
from app.core.plans import effective_plan, is_paid
from app.models.user import User
from app.services import paddle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


class SubscriptionResponse(BaseModel):
    plan: str                      # effective plan: free | plus | pro
    is_paid: bool
    plan_expires_at: str | None    # when the current paid period ends
    next_renewal: str | None       # same as expires while active; null once canceling/free
    status: str                    # active | canceling | free
    manageable: bool               # true only when there's a Paddle subscription to cancel


class CancelResponse(BaseModel):
    ok: bool
    status: str                    # canceling | free | unavailable
    message: str | None = None


def _iso(dt) -> str | None:
    return dt.isoformat() if dt is not None else None


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(
    current_user: User = Depends(get_verified_user),
) -> SubscriptionResponse:
    """Current subscription state, derived from the user's stored plan (kept in sync by
    the Paddle webhook). No external call — fast and works offline."""
    eff = effective_plan(current_user)
    paid = is_paid(current_user)
    manageable = paid and bool(current_user.paddle_subscription_id)
    return SubscriptionResponse(
        plan=eff,
        is_paid=paid,
        plan_expires_at=_iso(current_user.plan_expires_at),
        next_renewal=_iso(current_user.plan_expires_at) if paid else None,
        status="active" if paid else "free",
        manageable=manageable,
    )


@router.post("/cancel", response_model=CancelResponse)
async def cancel(
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> CancelResponse:
    """
    Cancel the user's Paddle subscription at period end (they keep access until then).
    The actual downgrade lands via the subscription.canceled webhook; we don't mutate the
    plan here so the webhook stays the single source of truth.
    """
    if not is_paid(current_user):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no_active_subscription")
    sub_id = current_user.paddle_subscription_id
    if not sub_id:
        # Paid but not via Paddle (e.g. an admin grant) — nothing to cancel through Paddle.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="not_managed_by_paddle")

    result = await paddle.cancel_subscription(sub_id)
    if result is None:
        return CancelResponse(ok=False, status="unavailable",
                              message="Could not reach the payment provider. Please try again.")
    # Access continues until the period end; the webhook flips the plan to free at that time.
    return CancelResponse(ok=True, status="canceling",
                          message="Your subscription will end at the end of the current period.")
