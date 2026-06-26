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

# AI assistant messages allowed per rolling 24h, per tier.
#   Free = 3, Plus = 30, Pro = unlimited (None).
FREE_DAILY_ASSISTANT_CAP = 3
PLUS_DAILY_ASSISTANT_CAP = 30
# Back-compat alias (older imports referenced the single free cap).
PRO_DAILY_ASSISTANT_CAP: int | None = None


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
    """Any active paid plan (plus OR pro)."""
    return effective_plan(user) in PAID_PLANS


def is_pro(user: "User") -> bool:
    """The top tier only. Pro-exclusive surfaces (simulator, reports, net-worth
    guidance, proactive Mim) gate on this — NOT is_paid — so Plus and Pro are
    genuinely different products."""
    return effective_plan(user) == PRO


def vision_enabled(user: "User") -> bool:
    """Vision PDF extraction is a paid feature (free tier falls back to OCR)."""
    return is_paid(user)


def assistant_daily_cap(user: "User") -> int | None:
    """Max AI assistant messages per rolling 24h. None = unlimited.
    Free = 3, Plus = 30, Pro = unlimited."""
    if is_pro(user):
        return None
    if is_paid(user):
        return PLUS_DAILY_ASSISTANT_CAP
    return FREE_DAILY_ASSISTANT_CAP
