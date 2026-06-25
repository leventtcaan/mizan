"""
WHAT: Subscription-plan constants and the effective-plan resolver.
WHY:  One place decides what a user's plan actually is right now — accounting for
      an expired paid subscription (plan says "pro" but plan_expires_at is in the
      past → they're effectively "free"). Every gate (upload cap, vision) asks here
      instead of re-deriving the rule, so the rule can't drift between call sites.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # avoid an import cycle at runtime
    from app.models.user import User

FREE = "free"
PLUS = "plus"
PRO = "pro"
VALID_PLANS = {FREE, PLUS, PRO}

# Paid tiers — unlimited uploads + vision enabled.
PAID_PLANS = {PLUS, PRO}

# Free-tier statement uploads allowed per calendar month.
FREE_MONTHLY_UPLOAD_CAP = 1

# Free-tier AI assistant messages allowed per day (rolling 24h). Paid = unlimited.
FREE_DAILY_ASSISTANT_CAP = 10


def effective_plan(user: "User") -> str:
    """
    The plan to enforce right now. A paid plan whose `plan_expires_at` has passed
    is treated as free (the subscription lapsed); no expiry means it doesn't expire.
    """
    plan = user.plan or FREE
    if plan in PAID_PLANS and user.plan_expires_at is not None:
        expires = user.plan_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return FREE
    return plan if plan in VALID_PLANS else FREE


def is_paid(user: "User") -> bool:
    return effective_plan(user) in PAID_PLANS


def vision_enabled(user: "User") -> bool:
    """Vision PDF extraction is a paid feature (free tier falls back to OCR)."""
    return is_paid(user)


def assistant_daily_cap(user: "User") -> int | None:
    """Max AI assistant messages per rolling 24h. None = unlimited (paid plans)."""
    return None if is_paid(user) else FREE_DAILY_ASSISTANT_CAP
