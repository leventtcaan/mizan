"""
WHAT: JWT creation/verification and bcrypt password hashing utilities.
WHY: Single module for all auth crypto — callers (auth.py, dependencies.py) never
     touch jose or passlib directly; swapping algorithms requires changes here only.
BREAKS IF REMOVED: Auth endpoints and get_current_user dependency lose their crypto primitives.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain[:72].encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain[:72].encode(), hashed.encode())


def create_access_token(subject: str) -> str:
    """
    WHAT: Creates a signed JWT with the user's UUID as the 'sub' claim.
    WHY: 'sub' (subject) is the standard JWT claim for user identity.
         Expiry is set to JWT_EXPIRE_MINUTES from config.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """
    WHAT: Decodes and validates a JWT; returns the 'sub' claim (user UUID string).
    WHY: Raises JWTError on invalid/expired tokens — callers catch this and raise 401.
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("Missing sub claim")
    return sub


# ── Email verification tokens ────────────────────────────────────────────────
# A separate signed token (24h expiry) carrying a distinct `typ` claim so it can
# NEVER be used as an access token (and vice-versa): decode rejects the wrong type.

_EMAIL_VERIFY_TYP = "email_verify"
EMAIL_VERIFY_EXPIRE_HOURS = 24


def create_email_verification_token(user_id: str) -> str:
    """Signed token proving the holder controls the account's email. Expires in 24h."""
    expire = datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS)
    payload: dict[str, Any] = {"sub": user_id, "typ": _EMAIL_VERIFY_TYP, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_email_verification_token(token: str) -> str:
    """
    Returns the user UUID string if the token is a valid, unexpired verification
    token. Raises JWTError on a bad signature, expiry, or wrong token type.
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("typ") != _EMAIL_VERIFY_TYP:
        raise JWTError("Not an email-verification token")
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("Missing sub claim")
    return sub


# ── Password-reset tokens ────────────────────────────────────────────────────
# Same pattern as email verification but a shorter window (1h) and its own `typ`,
# plus a `pwv` claim bound to the CURRENT password hash: once the password changes,
# every previously issued reset link stops working automatically.

_PASSWORD_RESET_TYP = "password_reset"
PASSWORD_RESET_EXPIRE_HOURS = 1


def _password_fingerprint(password_hash: str | None) -> str:
    return (password_hash or "")[-12:]


def create_password_reset_token(user_id: str, password_hash: str | None) -> str:
    """Signed token allowing a one-time password reset. Expires in 1h; invalidated
    by any password change (the `pwv` claim stops matching)."""
    expire = datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_EXPIRE_HOURS)
    payload: dict[str, Any] = {
        "sub": user_id,
        "typ": _PASSWORD_RESET_TYP,
        "pwv": _password_fingerprint(password_hash),
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_password_reset_token(token: str, current_password_hash: str | None) -> str:
    """
    Returns the user UUID string if the token is a valid, unexpired reset token
    that was issued for the account's CURRENT password. Raises JWTError otherwise.
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("typ") != _PASSWORD_RESET_TYP:
        raise JWTError("Not a password-reset token")
    if payload.get("pwv") != _password_fingerprint(current_password_hash):
        raise JWTError("Reset token no longer valid")
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("Missing sub claim")
    return sub
