"""
WHAT: FastAPI dependency that extracts and validates the current user from a JWT Bearer token.
WHY: Centralizes auth enforcement — every protected endpoint uses `Depends(get_current_user)`
     instead of duplicating JWT parsing logic.
BREAKS IF REMOVED: Auth-protected endpoints have no way to identify the caller.
"""

import uuid
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import decode_access_token
from app.models.user import User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """
    WHAT: Validates Bearer token and returns the User ORM row.
    WHY: Returning the full ORM object lets callers access user.id, user.email, etc.
         without a second DB query.
    BREAKS IF REMOVED: Protected endpoints can't identify the caller.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        user_id_str = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    # A soft-deleted account is rejected even with a still-valid token, so an admin's
    # deactivation revokes existing sessions too (not just future logins).
    if user is None or user.is_deleted:
        raise credentials_exception

    return user


async def get_verified_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    WHAT: Like get_current_user, but requires email_verified=True.
    WHY: Upload + AI features are locked until the user confirms their email. A valid
         token for an unverified account gets 403 (they're authenticated, not allowed) —
         distinct from 401 so the frontend can show "verify your email" instead of
         bouncing to login. Verification status is re-checked from the live row, so
         verifying takes effect on the very next request without a re-login.
    BREAKS IF REMOVED: Unverified accounts could upload/trigger AI before confirming ownership.
    """
    if not current_user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        )
    return current_user


async def get_paid_user(
    current_user: User = Depends(get_verified_user),
) -> User:
    """
    WHAT: Like get_verified_user, but additionally requires an active paid plan (plus/pro).
    WHY: Premium surfaces (reports, simulator, net-worth guidance) are paid features. A
         verified free user gets 403 `upgrade_required` — distinct from the verification
         403 — so the frontend can show an upgrade prompt instead of a verify prompt.
         Uses effective_plan via is_paid(), so a lapsed paid plan is treated as free.
    BREAKS IF REMOVED: Free accounts could use paid-only features.
    """
    from app.core.plans import is_paid

    if not is_paid(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="upgrade_required",
        )
    return current_user


async def get_pro_user(
    current_user: User = Depends(get_verified_user),
) -> User:
    """
    WHAT: Like get_verified_user, but requires the top (Pro) plan specifically.
    WHY: Pro-exclusive surfaces — simulator, financial reports, net-worth guidance,
         proactive Mim — gate here, NOT on is_paid(). A verified free OR Plus user
         gets 403 `upgrade_required` so the frontend shows the upgrade prompt. Uses
         effective_plan via is_pro(), so a lapsed Pro plan is treated as free.
    BREAKS IF REMOVED: Plus accounts could use Pro-only features (Plus == Pro again).
    """
    from app.core.plans import is_pro

    if not is_pro(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="upgrade_required",
        )
    return current_user


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    WHAT: Like get_current_user, but additionally requires is_admin=True.
    WHY: Single choke point for the founder admin panel. Every /admin/* endpoint
         depends on this, so authorization can't be forgotten per-route. A valid
         token for a non-admin user gets 403, not 401 — they're authenticated,
         just not allowed.
    BREAKS IF REMOVED: Admin endpoints would be reachable by any logged-in user.
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return current_user
