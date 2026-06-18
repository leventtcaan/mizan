"""
WHAT: POST /auth/register and POST /auth/login — user identity endpoints.
WHY: Provides stateless JWT-based auth so the frontend can identify users without
     sessions or cookies; every subsequent request carries a signed token.
BREAKS IF REMOVED: No way to create accounts or obtain tokens; entire auth flow breaks.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    WHAT: Creates a new user account, returns a JWT immediately.
    WHY: Logging in right after registering is the expected UX — avoids an extra round-trip.
    BREAKS IF REMOVED: New users can't create accounts.
    """
    existing = await session.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    if len(body.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )

    user = User(email=body.email, password_hash=hash_password(body.password))
    session.add(user)
    await session.commit()
    await session.refresh(user)

    logger.info("New user registered — id=%s email=%s", user.id, user.email)

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user_id=str(user.id), email=user.email)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    WHAT: Verifies email + password, returns a JWT on success.
    WHY: 401 is returned for both "no such user" and "wrong password" — same error
         prevents email enumeration (attacker can't tell which case applies).
    BREAKS IF REMOVED: Existing users can't obtain tokens to access protected endpoints.
    """
    result = await session.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if user is None or user.password_hash is None:
        raise invalid

    if not verify_password(body.password, user.password_hash):
        raise invalid

    logger.info("User logged in — id=%s", user.id)

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user_id=str(user.id), email=user.email)
