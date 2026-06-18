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
