"""
WHAT: POST /auth/register and POST /auth/login — user identity endpoints.
WHY: Provides stateless JWT-based auth so the frontend can identify users without
     sessions or cookies; every subsequent request carries a signed token.
BREAKS IF REMOVED: No way to create accounts or obtain tokens; entire auth flow breaks.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import password_reset_limiter, resend_verification_limiter
from app.core.security import (
    create_access_token,
    create_email_verification_token,
    create_password_reset_token,
    decode_email_verification_token,
    decode_password_reset_token,
    hash_password,
    verify_password,
)
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Accepted onboarding-intent values (personal ∪ business). Validated server-side so
# the column stays clean for BI cohorting; "track_everything" is shared by both.
VALID_GOALS = {
    "understand_spending", "pay_off_debt", "grow_net_worth", "save_more",
    "manage_cashflow", "track_receivables", "reduce_costs", "grow_business",
    "track_everything",
}

VALID_ACCOUNT_TYPES = {"personal", "business"}
VALID_INDUSTRIES = {
    "retail", "food", "services", "tech", "manufacturing", "construction",
    "healthcare", "education", "ecommerce", "realestate", "creative", "finance", "other",
}
VALID_TEAM_SIZES = {"solo", "2-10", "11-50", "51-200", "200+"}

# User-initiated deletion keeps the account recoverable for this many days before the
# daily purge job erases it permanently (GDPR erasure with a grace period).
ACCOUNT_RECOVERY_DAYS = 30

# Referral rewards: the referrer earns a month of Pro per signup; the new user
# starts with a Pro trial week.
REFERRER_REWARD_DAYS = 30
REFEREE_TRIAL_DAYS = 7

# Unambiguous alphabet (no 0/O, 1/I/L) for short shareable codes.
_REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def _new_referral_code() -> str:
    import secrets
    return "".join(secrets.choice(_REF_ALPHABET) for _ in range(8))


async def ensure_referral_code(user: User, session: AsyncSession) -> str:
    """Return the user's referral code, generating one on first read (existing accounts
    predate the column). Retries on the (astronomically unlikely) collision."""
    if user.referral_code:
        return user.referral_code
    for _ in range(5):
        code = _new_referral_code()
        clash = await session.execute(select(User.id).where(User.referral_code == code))
        if clash.scalar_one_or_none() is None:
            user.referral_code = code
            session.add(user)
            await session.commit()
            return code
    raise HTTPException(status_code=500, detail="Could not generate referral code")


def _grant_pro(user: User, days: int) -> None:
    """Extend (or start) a Pro grant: expiry = max(now, current expiry) + days.
    A lifetime plan (paid, no expiry) is never downgraded by a referral grant."""
    now = datetime.now(timezone.utc)
    if user.plan in ("plus", "pro") and user.plan_expires_at is None:
        return  # open-ended paid plan — nothing to extend
    base = user.plan_expires_at if (user.plan == "pro" and user.plan_expires_at and user.plan_expires_at > now) else now
    user.plan = "pro"
    user.plan_expires_at = base + timedelta(days=days)


def _clean_account_type(value: str | None) -> str:
    v = (value or "").strip().lower()
    return v if v in VALID_ACCOUNT_TYPES else "personal"


def _clean_country(value: str | None) -> str | None:
    """Normalize an ISO 3166-1 alpha-2 code; None/invalid → None (don't reject signup)."""
    if not value:
        return None
    code = value.strip().upper()
    return code if len(code) == 2 and code.isalpha() else None


def _verify_url(user_id: str) -> str:
    """Frontend link that carries the signed 24h verification token."""
    token = create_email_verification_token(user_id)
    base = (settings.FRONTEND_URL or "").rstrip("/")
    return f"{base}/verify?token={token}"


async def _send_verification(user: User) -> None:
    """Best-effort: never let a mail failure (or missing RESEND key in dev) break the
    request that triggered it. The user can always resend from the verify screen."""
    try:
        from app.api.email import send_verification_email
        await send_verification_email(user.email, _verify_url(str(user.id)), user.language)
    except Exception as exc:
        logger.warning("Verification email not sent to %s: %s", user.email, exc)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    # Optional: seeded from the visitor's browser locale so new accounts don't all
    # default to Turkish/TRY. Validated below; unset/invalid → User model defaults.
    language: str | None = None
    display_currency: str | None = None
    # Registration profile + consent.
    full_name: str | None = None
    country: str | None = None
    marketing_consent: bool = False
    # ToS/Privacy acceptance is REQUIRED — register() rejects the request if not accepted.
    tos_accepted: bool = False
    tos_version: str | None = None
    # Account type + (when business) company profile; phone + browser timezone.
    account_type: str | None = None
    company_name: str | None = None
    industry: str | None = None
    team_size: str | None = None
    phone: str | None = None
    timezone: str | None = None
    # Referral code from a clarifin.xyz/join?ref=… link (optional).
    referral_code: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    onboarding_completed: bool = False
    language: str = "tr"
    display_currency: str = "TRY"
    is_admin: bool = False
    email_verified: bool = False
    plan: str = "free"
    full_name: str | None = None
    country: str | None = None
    primary_goal: str | None = None
    account_type: str = "personal"
    company_name: str | None = None
    industry: str | None = None
    team_size: str | None = None
    phone: str | None = None
    timezone: str | None = None


class UserResponse(BaseModel):
    user_id: str
    email: str
    onboarding_completed: bool
    language: str
    display_currency: str
    email_weekly_enabled: bool
    is_admin: bool
    email_verified: bool = False
    plan: str = "free"
    full_name: str | None = None
    country: str | None = None
    marketing_consent: bool = False
    primary_goal: str | None = None
    account_type: str = "personal"
    company_name: str | None = None
    industry: str | None = None
    team_size: str | None = None
    phone: str | None = None
    timezone: str | None = None


class PreferencesRequest(BaseModel):
    language: str | None = None
    email_weekly_enabled: bool | None = None
    display_currency: str | None = None
    full_name: str | None = None
    country: str | None = None
    marketing_consent: bool | None = None
    primary_goal: str | None = None
    account_type: str | None = None
    company_name: str | None = None
    industry: str | None = None
    team_size: str | None = None
    phone: str | None = None
    timezone: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class DeleteAccountRequest(BaseModel):
    password: str


class RestoreAccountRequest(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        user_id=str(user.id),
        email=user.email,
        onboarding_completed=user.onboarding_completed,
        language=user.language,
        display_currency=user.display_currency,
        email_weekly_enabled=user.email_weekly_enabled,
        is_admin=user.is_admin,
        email_verified=user.email_verified,
        plan=user.plan,
        full_name=user.full_name,
        country=user.country,
        marketing_consent=user.marketing_consent,
        primary_goal=user.primary_goal,
        account_type=user.account_type or "personal",
        company_name=user.company_name,
        industry=user.industry,
        team_size=user.team_size,
        phone=user.phone,
        timezone=user.timezone,
    )


def _token_response(user: User, token: str) -> TokenResponse:
    return TokenResponse(
        access_token=token,
        user_id=str(user.id),
        email=user.email,
        onboarding_completed=user.onboarding_completed,
        language=user.language,
        display_currency=user.display_currency,
        is_admin=user.is_admin,
        email_verified=user.email_verified,
        plan=user.plan,
        full_name=user.full_name,
        country=user.country,
        primary_goal=user.primary_goal,
        account_type=user.account_type or "personal",
        company_name=user.company_name,
        industry=user.industry,
        team_size=user.team_size,
        phone=user.phone,
        timezone=user.timezone,
    )


def _apply_business_profile(user: User, account_type: str) -> None:
    """When account_type isn't business, the company fields are meaningless — clear them
    so a personal account never carries stale company data."""
    if account_type != "business":
        user.company_name = None
        user.industry = None
        user.team_size = None


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
    # Normalize email — lowercase + strip — so "User@X.com" and "user@x.com" are one
    # account, and lookups (here + at login) compare consistently.
    email = body.email.strip().lower()
    existing = await session.execute(select(User).where(User.email == email))
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

    # Consent gate: ToS/Privacy acceptance is mandatory and must be auditable.
    if not body.tos_accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You must accept the Terms of Service and Privacy Policy.",
        )

    user = User(email=email, password_hash=hash_password(body.password))
    # Honor browser-detected preferences when valid; otherwise the User model
    # defaults (tr/TRY) apply.
    if body.language in ("tr", "en"):
        user.language = body.language
    if body.display_currency is not None:
        code = body.display_currency.strip().upper()
        if 1 <= len(code) <= 10 and code.isalnum():
            user.display_currency = code

    # Registration profile + provable consent.
    if body.full_name:
        user.full_name = body.full_name.strip()[:120] or None
    user.country = _clean_country(body.country)
    user.marketing_consent = bool(body.marketing_consent)
    user.tos_accepted_at = datetime.now(timezone.utc)
    user.tos_version = (body.tos_version or "1.0").strip()[:20]

    # Account type + business profile.
    user.account_type = _clean_account_type(body.account_type)
    if user.account_type == "business":
        if body.company_name:
            user.company_name = body.company_name.strip()[:160] or None
        if body.industry and body.industry in VALID_INDUSTRIES:
            user.industry = body.industry
        if body.team_size and body.team_size in VALID_TEAM_SIZES:
            user.team_size = body.team_size
    if body.phone:
        user.phone = body.phone.strip()[:40] or None
    if body.timezone:
        user.timezone = body.timezone.strip()[:60] or None

    # Every new account owns a shareable referral code from day one.
    for _ in range(5):
        code = _new_referral_code()
        clash = await session.execute(select(User.id).where(User.referral_code == code))
        if clash.scalar_one_or_none() is None:
            user.referral_code = code
            break

    # Referred signup: link to the referrer and grant both sides their reward.
    # (A code can't be the new user's own — the account doesn't exist yet.)
    if body.referral_code:
        ref_code = body.referral_code.strip().upper()[:12]
        referrer = (await session.execute(
            select(User).where(User.referral_code == ref_code, User.is_deleted.is_(False))
        )).scalar_one_or_none()
        if referrer is not None:
            user.referred_by = referrer.id
            _grant_pro(user, REFEREE_TRIAL_DAYS)       # new user: 7-day Pro trial
            _grant_pro(referrer, REFERRER_REWARD_DAYS)  # referrer: +1 month Pro
            session.add(referrer)
            logger.info("Referred signup — referrer=%s code=%s", referrer.id, ref_code)

    session.add(user)
    await session.commit()
    await session.refresh(user)

    logger.info("New user registered — id=%s email=%s", user.id, user.email)

    # Fire off the verification email (best-effort — registration succeeds regardless).
    await _send_verification(user)

    token = create_access_token(str(user.id))
    return _token_response(user, token)


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
    result = await session.execute(select(User).where(User.email == body.email.strip().lower()))
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

    if user.is_deleted:
        # User-initiated deletion within the 30-day window: the caller has just proven
        # the credentials, so it's safe to reveal recoverability (403 + machine code —
        # the frontend offers "restore my account"). Anything else (admin-deactivated,
        # or past the window awaiting purge) behaves like a non-existent account.
        if user.deleted_at is not None:
            days = (datetime.now(timezone.utc) - user.deleted_at).days
            if days <= ACCOUNT_RECOVERY_DAYS:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="account_deleted_recoverable",
                )
        raise invalid

    logger.info("User logged in — id=%s", user.id)

    token = create_access_token(str(user.id))
    return _token_response(user, token)


@router.post("/verify-email", response_model=UserResponse)
async def verify_email(
    body: VerifyEmailRequest,
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    """
    WHAT: Consumes a signed verification token and marks the account verified.
    WHY: No auth header required — the signed token IS the proof. Invalid/expired
         tokens get 400 so the frontend can offer "resend". Idempotent: re-verifying
         an already-verified account just returns success.
    """
    try:
        user_id_str = decode_email_verification_token(body.token)
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification link is invalid or has expired.",
        )

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification link is invalid or has expired.",
        )

    if not user.email_verified:
        user.email_verified = True
        session.add(user)
        await session.commit()
        logger.info("Email verified — user=%s", user.id)

    return _user_response(user)


@router.post("/resend-verification", status_code=200)
async def resend_verification(
    body: ResendVerificationRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    WHAT: Re-sends the verification email for an unverified account.
    WHY: Offered on login when the account isn't verified yet. Returns the SAME
         generic response whether or not the email exists / is already verified, so
         it can't be used to enumerate accounts.
    """
    email = body.email.strip().lower()
    # Throttle per email (max 3/hour) BEFORE doing any work — keeps the response
    # generic (no account enumeration) while stopping inbox spam. 429 if exceeded.
    if not resend_verification_limiter.is_allowed(email, max_calls=3, window_seconds=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification emails requested. Please try again later.",
        )
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None and not user.is_deleted and not user.email_verified:
        await _send_verification(user)
    return {"message": "If that account exists and is unverified, a new link is on its way."}


@router.post("/forgot-password", status_code=200)
async def forgot_password(
    body: ForgotPasswordRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    WHAT: Emails a signed 1-hour reset link for the account.
    WHY: Same anti-enumeration contract as resend-verification — the response is
         identical whether or not the account exists. Throttled per email.
    """
    email = body.email.strip().lower()
    if not password_reset_limiter.is_allowed(email, max_calls=3, window_seconds=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many reset emails requested. Please try again later.",
        )
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None and not user.is_deleted:
        token = create_password_reset_token(str(user.id), user.password_hash)
        base = (settings.FRONTEND_URL or "").rstrip("/")
        reset_url = f"{base}/reset-password?token={token}"
        try:
            from app.api.email import send_password_reset_email
            await send_password_reset_email(user.email, reset_url, user.language)
        except Exception as exc:
            # Best-effort — never leak whether the account exists via an error.
            logger.warning("Password-reset email not sent to %s: %s", user.email, exc)
    return {"message": "If that account exists, a reset link is on its way."}


@router.post("/reset-password", status_code=200)
async def reset_password(
    body: ResetPasswordRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    WHAT: Consumes a reset token and sets the new password.
    WHY: The token is bound to the current password hash (pwv claim), so each link
         works at most once and dies the moment the password changes. Proving control
         of the inbox also implies the email is verified.
    """
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    # Decode WITHOUT the hash binding first to find the user, then validate fully.
    try:
        from jose import jwt as _jwt
        payload = _jwt.get_unverified_claims(body.token)
        user_id = uuid.UUID(str(payload.get("sub")))
    except Exception:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or user.is_deleted:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")

    try:
        decode_password_reset_token(body.token, user.password_hash)
    except JWTError:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")

    user.password_hash = hash_password(body.new_password)
    # Clicking the emailed link proves inbox control — count it as verification too.
    user.email_verified = True
    session.add(user)
    await session.commit()
    logger.info("Password reset — user=%s", user.id)
    return {"message": "Password updated. You can now log in."}


@router.post("/delete-account", status_code=200)
async def delete_account(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    WHAT: User-initiated account deletion (GDPR). Soft-deletes with a 30-day recovery
          window; the daily purge job erases everything permanently afterwards.
    WHY: Password re-entry blocks a stolen-session deletion; soft-first gives a
         change-of-heart path while still honoring erasure (nothing is accessible
         meanwhile — login is blocked and every authed endpoint rejects the account).
    """
    if not current_user.password_hash or not verify_password(body.password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect.")

    current_user.is_deleted = True
    current_user.deleted_at = datetime.now(timezone.utc)
    session.add(current_user)

    # Best-effort: stop billing immediately so a deleted account is never charged.
    if getattr(current_user, "paddle_subscription_id", None):
        try:
            from app.services.paddle import cancel_subscription
            await cancel_subscription(current_user.paddle_subscription_id)
        except Exception as exc:
            logger.warning("Paddle cancel on delete failed — user=%s: %s", current_user.id, exc)

    await session.commit()
    logger.info("Account deletion requested — user=%s (purge after %dd)", current_user.id, ACCOUNT_RECOVERY_DAYS)
    return {"message": "Account scheduled for deletion.", "recovery_days": ACCOUNT_RECOVERY_DAYS}


@router.post("/restore-account", response_model=TokenResponse)
async def restore_account(
    body: RestoreAccountRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    WHAT: Reverses a user-initiated deletion within the recovery window and logs in.
    WHY: Credentials are the proof of ownership; outside the window (or for
         admin-deactivated accounts) this behaves like a failed login.
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    email = body.email.strip().lower()
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or user.password_hash is None or not verify_password(body.password, user.password_hash):
        raise invalid
    if not user.is_deleted or user.deleted_at is None:
        raise invalid
    if (datetime.now(timezone.utc) - user.deleted_at).days > ACCOUNT_RECOVERY_DAYS:
        raise invalid

    user.is_deleted = False
    user.deleted_at = None
    session.add(user)
    await session.commit()
    logger.info("Account restored — user=%s", user.id)
    token = create_access_token(str(user.id))
    return _token_response(user, token)


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    return _user_response(current_user)


class ReferralInfoResponse(BaseModel):
    code: str
    link: str
    referred_count: int


@router.get("/referral", response_model=ReferralInfoResponse)
async def referral_info(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReferralInfoResponse:
    """The user's shareable referral code + how many signups it brought in.
    Generates the code on first read for accounts that predate the column."""
    from sqlalchemy import func

    code = await ensure_referral_code(current_user, session)
    count = (await session.execute(
        select(func.count(User.id)).where(User.referred_by == current_user.id)
    )).scalar() or 0
    base = (settings.FRONTEND_URL or "https://clarifin.xyz").rstrip("/")
    return ReferralInfoResponse(code=code, link=f"{base}/join?ref={code}", referred_count=int(count))


@router.post("/preferences", response_model=UserResponse)
async def update_preferences(
    body: PreferencesRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    if body.language is not None:
        if body.language not in ("tr", "en"):
            from fastapi import HTTPException
            raise HTTPException(status_code=422, detail="language must be 'tr' or 'en'")
        current_user.language = body.language
    if body.email_weekly_enabled is not None:
        current_user.email_weekly_enabled = body.email_weekly_enabled
    if body.display_currency is not None:
        code = body.display_currency.strip().upper()
        if not (1 <= len(code) <= 10) or not code.isalnum():
            raise HTTPException(status_code=422, detail="display_currency must be a 1-10 char code")
        current_user.display_currency = code
    if body.full_name is not None:
        current_user.full_name = body.full_name.strip()[:120] or None
    if body.country is not None:
        current_user.country = _clean_country(body.country)
    if body.marketing_consent is not None:
        current_user.marketing_consent = bool(body.marketing_consent)
    if body.primary_goal is not None:
        goal = body.primary_goal.strip()
        if goal and goal not in VALID_GOALS:
            raise HTTPException(status_code=422, detail="invalid primary_goal")
        current_user.primary_goal = goal or None
    if body.account_type is not None:
        current_user.account_type = _clean_account_type(body.account_type)
        # Switching to personal clears company data.
        _apply_business_profile(current_user, current_user.account_type)
    if body.company_name is not None:
        current_user.company_name = body.company_name.strip()[:160] or None
    if body.industry is not None:
        ind = body.industry.strip()
        if ind and ind not in VALID_INDUSTRIES:
            raise HTTPException(status_code=422, detail="invalid industry")
        current_user.industry = ind or None
    if body.team_size is not None:
        ts = body.team_size.strip()
        if ts and ts not in VALID_TEAM_SIZES:
            raise HTTPException(status_code=422, detail="invalid team_size")
        current_user.team_size = ts or None
    if body.phone is not None:
        current_user.phone = body.phone.strip()[:40] or None
    if body.timezone is not None:
        current_user.timezone = body.timezone.strip()[:60] or None
    session.add(current_user)
    await session.commit()
    logger.info(
        "Preferences updated — user=%s language=%s currency=%s",
        current_user.id, current_user.language, current_user.display_currency,
    )
    return _user_response(current_user)


@router.post("/change-password", status_code=200)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Change the signed-in user's password: verify the current one, then set the new one."""
    if current_user.password_hash is None or not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=422, detail="Current password is incorrect.")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="New password must be different.")
    current_user.password_hash = hash_password(body.new_password)
    session.add(current_user)
    await session.commit()
    logger.info("Password changed — user=%s", current_user.id)
    return {"ok": True}


@router.post("/complete-onboarding", status_code=200)
async def complete_onboarding(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    current_user.onboarding_completed = True
    session.add(current_user)
    await session.commit()
    logger.info("Onboarding completed — user=%s", current_user.id)
    return {"onboarding_completed": True}
