"""
WHAT: Founder/admin panel API — system observability + user management + job control.
WHY:  A founder needs to answer three questions without opening a DB console:
      (1) Is the product growing and healthy? (overview metrics + system health)
      (2) Who are my users and what are they doing? (user list + per-user detail)
      (3) Can I act when something's off? (promote/demote admins, reset onboarding,
          delete a bad account, kick off a background job on demand).
SECURITY: Every route depends on get_admin_user → 403 for any non-admin. There is
      no other gate; authorization lives in one place.
BREAKS IF REMOVED: No in-app way to monitor or manage the system.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_admin_user
from app.core.config import settings
from app.models.admin_audit_log import AdminAuditLog
from app.models.app_notification import AppNotification
from app.models.asset import Asset
from app.models.liability import Liability
from app.models.reconciliation_item import ReconciliationItem
from app.models.receivable import Receivable
from app.models.transaction import Transaction
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ── schemas ──────────────────────────────────────────────────────────────────

class OverviewResponse(BaseModel):
    users_total: int
    users_admins: int
    users_onboarded: int
    users_new_24h: int
    users_new_7d: int
    users_new_30d: int
    users_weekly_email_optin: int
    transactions_total: int
    transactions_new_7d: int
    upload_batches: int
    assets_total: int
    liabilities_total: int
    reconciliation_open: int
    notifications_total: int
    notifications_unread: int
    # The "founder": the longest-standing admin (earliest-created admin account),
    # falling back to the first registered user. Drives the founder badge — never
    # hardcoded. None only if there are somehow no users.
    founder_user_id: str | None
    generated_at: str


class AdminUserRow(BaseModel):
    id: str
    email: str
    is_admin: bool
    onboarding_completed: bool
    language: str
    display_currency: str
    created_at: str
    last_email_brief_sent: str | None
    transaction_count: int
    asset_count: int


class AdminUserListResponse(BaseModel):
    users: list[AdminUserRow]
    total: int
    limit: int
    offset: int


class AdminUserDetail(BaseModel):
    id: str
    email: str
    is_admin: bool
    onboarding_completed: bool
    language: str
    display_currency: str
    email_weekly_enabled: bool
    created_at: str
    last_email_brief_sent: str | None
    transaction_count: int
    upload_batches: int
    asset_count: int
    liability_count: int
    reconciliation_open: int


class AdminStatement(BaseModel):
    batch_id: str
    uploaded_at: str
    transaction_count: int
    min_date: str
    max_date: str


class AdminAsset(BaseModel):
    id: str
    name: str
    asset_type: str
    currency: str
    current_value: str
    as_of_date: str | None
    source: str


class AdminLiability(BaseModel):
    id: str
    name: str
    liability_type: str
    currency: str
    total_amount: str
    remaining_amount: str
    interest_rate: str | None
    due_date: str | None


class AdminReceivable(BaseModel):
    id: str
    from_person: str
    amount: str
    currency: str
    status: str
    expected_date: str | None


class AdminHealth(BaseModel):
    has_data: bool
    score: int | None
    band: str | None
    currency: str | None


class AdminUserProfile(BaseModel):
    """Everything about one user, in one payload — the full profile view."""
    # identity + status
    id: str
    email: str
    is_admin: bool
    is_founder: bool
    onboarding_completed: bool
    language: str
    display_currency: str
    email_weekly_enabled: bool
    created_at: str
    last_email_brief_sent: str | None
    last_activity: str | None
    # rolled-up counts
    transaction_count: int
    upload_batches: int
    asset_count: int
    liability_count: int
    receivable_count: int
    reconciliation_open: int
    # the financial life
    health: AdminHealth | None
    statements: list[AdminStatement]
    assets: list[AdminAsset]
    liabilities: list[AdminLiability]
    receivables: list[AdminReceivable]


class AdminTxn(BaseModel):
    id: str
    transaction_date: str
    description: str
    amount: str
    currency: str
    transaction_type: str
    category: str | None
    source: str | None
    upload_batch_id: str | None


class AdminTxnPage(BaseModel):
    transactions: list[AdminTxn]
    total: int
    limit: int
    offset: int


class UpdateUserRequest(BaseModel):
    is_admin: bool | None = None
    onboarding_completed: bool | None = None


class SystemResponse(BaseModel):
    environment: str
    config: dict
    scheduler: dict


class JobRunResponse(BaseModel):
    job: str
    status: str


# ── helpers ──────────────────────────────────────────────────────────────────

def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


async def _scalar(session: AsyncSession, stmt) -> int:
    return int((await session.execute(stmt)).scalar() or 0)


# ── overview ─────────────────────────────────────────────────────────────────

@router.get("/overview", response_model=OverviewResponse)
async def overview(
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> OverviewResponse:
    """One-glance state of the whole product."""
    now = datetime.now(timezone.utc)
    d1, d7, d30 = now - timedelta(days=1), now - timedelta(days=7), now - timedelta(days=30)

    # All user metrics ignore soft-deleted accounts (active = not is_deleted).
    active = User.is_deleted.is_(False)

    # Founder = the admin who has held admin longest. We don't track a promoted-at
    # timestamp, so the earliest-created admin is the faithful proxy; if there are no
    # admins yet, fall back to the very first registered user.
    founder_id = (await session.execute(
        select(User.id).where(User.is_admin.is_(True), active).order_by(User.created_at.asc()).limit(1)
    )).scalar_one_or_none()
    if founder_id is None:
        founder_id = (await session.execute(
            select(User.id).where(active).order_by(User.created_at.asc()).limit(1)
        )).scalar_one_or_none()

    return OverviewResponse(
        users_total=await _scalar(session, select(func.count(User.id)).where(active)),
        users_admins=await _scalar(session, select(func.count(User.id)).where(User.is_admin.is_(True), active)),
        users_onboarded=await _scalar(session, select(func.count(User.id)).where(User.onboarding_completed.is_(True), active)),
        users_new_24h=await _scalar(session, select(func.count(User.id)).where(User.created_at >= d1, active)),
        users_new_7d=await _scalar(session, select(func.count(User.id)).where(User.created_at >= d7, active)),
        users_new_30d=await _scalar(session, select(func.count(User.id)).where(User.created_at >= d30, active)),
        users_weekly_email_optin=await _scalar(session, select(func.count(User.id)).where(User.email_weekly_enabled.is_(True), active)),
        transactions_total=await _scalar(session, select(func.count(Transaction.id))),
        transactions_new_7d=await _scalar(session, select(func.count(Transaction.id)).where(Transaction.created_at >= d7)),
        upload_batches=await _scalar(
            session,
            select(func.count(func.distinct(Transaction.upload_batch_id))).where(Transaction.upload_batch_id.is_not(None)),
        ),
        assets_total=await _scalar(session, select(func.count(Asset.id))),
        liabilities_total=await _scalar(session, select(func.count(Liability.id))),
        reconciliation_open=await _scalar(
            session, select(func.count(ReconciliationItem.id)).where(ReconciliationItem.status == "open")
        ),
        notifications_total=await _scalar(session, select(func.count(AppNotification.id))),
        notifications_unread=await _scalar(
            session, select(func.count(AppNotification.id)).where(AppNotification.is_read.is_(False))
        ),
        founder_user_id=str(founder_id) if founder_id else None,
        generated_at=now.isoformat(),
    )


# ── users ────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
    search: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AdminUserListResponse:
    """Paginated user directory with per-user activity counts (newest first).
    Soft-deleted accounts are hidden — they live on only for the audit trail."""
    base = select(User).where(User.is_deleted.is_(False))
    count_stmt = select(func.count(User.id)).where(User.is_deleted.is_(False))
    term = search.strip().lower()
    if term:
        like = f"%{term}%"
        base = base.where(func.lower(User.email).like(like))
        count_stmt = count_stmt.where(func.lower(User.email).like(like))

    total = await _scalar(session, count_stmt)
    page = list((await session.execute(
        base.order_by(User.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all())

    ids = [u.id for u in page]
    tx_counts: dict[uuid.UUID, int] = {}
    asset_counts: dict[uuid.UUID, int] = {}
    if ids:
        # Grouped counts for just this page — avoids an N+1 per user.
        for uid, c in (await session.execute(
            select(Transaction.user_id, func.count(Transaction.id))
            .where(Transaction.user_id.in_(ids)).group_by(Transaction.user_id)
        )).all():
            tx_counts[uid] = int(c)
        for uid, c in (await session.execute(
            select(Asset.user_id, func.count(Asset.id))
            .where(Asset.user_id.in_(ids)).group_by(Asset.user_id)
        )).all():
            asset_counts[uid] = int(c)

    rows = [
        AdminUserRow(
            id=str(u.id),
            email=u.email,
            is_admin=u.is_admin,
            onboarding_completed=u.onboarding_completed,
            language=u.language,
            display_currency=u.display_currency,
            created_at=u.created_at.isoformat(),
            last_email_brief_sent=_iso(u.last_email_brief_sent),
            transaction_count=tx_counts.get(u.id, 0),
            asset_count=asset_counts.get(u.id, 0),
        )
        for u in page
    ]
    return AdminUserListResponse(users=rows, total=total, limit=limit, offset=offset)


async def _load_user(user_id: str, session: AsyncSession) -> User:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    user = await session.get(User, uid)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def user_detail(
    user_id: str,
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminUserDetail:
    """Everything about one user — the drill-down behind a row."""
    user = await _load_user(user_id, session)
    uid = user.id
    return AdminUserDetail(
        id=str(uid),
        email=user.email,
        is_admin=user.is_admin,
        onboarding_completed=user.onboarding_completed,
        language=user.language,
        display_currency=user.display_currency,
        email_weekly_enabled=user.email_weekly_enabled,
        created_at=user.created_at.isoformat(),
        last_email_brief_sent=_iso(user.last_email_brief_sent),
        transaction_count=await _scalar(session, select(func.count(Transaction.id)).where(Transaction.user_id == uid)),
        upload_batches=await _scalar(
            session,
            select(func.count(func.distinct(Transaction.upload_batch_id)))
            .where(Transaction.user_id == uid).where(Transaction.upload_batch_id.is_not(None)),
        ),
        asset_count=await _scalar(session, select(func.count(Asset.id)).where(Asset.user_id == uid)),
        liability_count=await _scalar(session, select(func.count(Liability.id)).where(Liability.user_id == uid)),
        reconciliation_open=await _scalar(
            session,
            select(func.count(ReconciliationItem.id))
            .where(ReconciliationItem.user_id == uid).where(ReconciliationItem.status == "open"),
        ),
    )


async def _is_founder(uid: uuid.UUID, session: AsyncSession) -> bool:
    """Same rule as the overview: longest-standing admin, else first-ever user."""
    founder = (await session.execute(
        select(User.id).where(User.is_admin.is_(True)).order_by(User.created_at.asc()).limit(1)
    )).scalar_one_or_none()
    if founder is None:
        founder = (await session.execute(
            select(User.id).order_by(User.created_at.asc()).limit(1)
        )).scalar_one_or_none()
    return founder == uid


@router.get("/users/{user_id}/profile", response_model=AdminUserProfile)
async def user_profile(
    user_id: str,
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminUserProfile:
    """The complete picture of one user's financial life in the app: profile,
    every uploaded statement, all assets/liabilities/receivables, their financial
    health score, and last activity. The transaction log is paginated separately
    (could be thousands of rows)."""
    from app.services.transaction_service import get_batch_summaries

    user = await _load_user(user_id, session)
    uid = user.id

    # statements (one row per upload batch, newest first)
    batches = await get_batch_summaries(uid, session)
    statements = [
        AdminStatement(
            batch_id=b["batch_id"],
            uploaded_at=b["uploaded_at"].isoformat() if b["uploaded_at"] else "",
            transaction_count=int(b["transaction_count"]),
            min_date=b["min_date"].isoformat() if b["min_date"] else "",
            max_date=b["max_date"].isoformat() if b["max_date"] else "",
        )
        for b in batches
    ]

    # assets
    asset_rows = list((await session.execute(
        select(Asset).where(Asset.user_id == uid).order_by(Asset.current_value.desc())
    )).scalars().all())
    assets = [
        AdminAsset(
            id=str(a.id), name=a.name, asset_type=a.asset_type, currency=a.currency,
            current_value=str(a.current_value),
            as_of_date=a.as_of_date.isoformat() if a.as_of_date else None,
            source=a.source,
        )
        for a in asset_rows
    ]

    # liabilities
    liab_rows = list((await session.execute(
        select(Liability).where(Liability.user_id == uid).order_by(Liability.remaining_amount.desc())
    )).scalars().all())
    liabilities = [
        AdminLiability(
            id=str(li.id), name=li.name, liability_type=li.liability_type, currency=li.currency,
            total_amount=str(li.total_amount), remaining_amount=str(li.remaining_amount),
            interest_rate=str(li.interest_rate) if li.interest_rate is not None else None,
            due_date=li.due_date.isoformat() if li.due_date else None,
        )
        for li in liab_rows
    ]

    # receivables
    recv_rows = list((await session.execute(
        select(Receivable).where(Receivable.user_id == uid).order_by(Receivable.created_at.desc())
    )).scalars().all())
    receivables = [
        AdminReceivable(
            id=str(r.id), from_person=r.from_person, amount=str(r.amount), currency=r.currency,
            status=r.status, expected_date=r.expected_date.isoformat() if r.expected_date else None,
        )
        for r in recv_rows
    ]

    # financial health — reuse the real scorecard engine; never let it break the page.
    health: AdminHealth | None = None
    try:
        from app.services.scorecard import build_scorecard
        sc = await build_scorecard(uid, user.display_currency, session)
        health = AdminHealth(
            has_data=bool(sc.get("has_data")),
            score=sc.get("score") if sc.get("has_data") else None,
            band=sc.get("band") if sc.get("has_data") else None,
            currency=sc.get("currency"),
        )
    except Exception:
        logger.exception("scorecard failed for user=%s in admin profile", uid)
        health = None

    # last activity = most recent of: latest tx, latest asset touch, account creation
    last_tx = (await session.execute(
        select(func.max(Transaction.created_at)).where(Transaction.user_id == uid)
    )).scalar()
    last_asset = (await session.execute(
        select(func.max(Asset.updated_at)).where(Asset.user_id == uid)
    )).scalar()
    candidates = [d for d in (last_tx, last_asset, user.created_at) if d is not None]
    last_activity = max(candidates).isoformat() if candidates else None

    return AdminUserProfile(
        id=str(uid),
        email=user.email,
        is_admin=user.is_admin,
        is_founder=await _is_founder(uid, session),
        onboarding_completed=user.onboarding_completed,
        language=user.language,
        display_currency=user.display_currency,
        email_weekly_enabled=user.email_weekly_enabled,
        created_at=user.created_at.isoformat(),
        last_email_brief_sent=_iso(user.last_email_brief_sent),
        last_activity=last_activity,
        transaction_count=await _scalar(session, select(func.count(Transaction.id)).where(Transaction.user_id == uid)),
        upload_batches=len(statements),
        asset_count=len(assets),
        liability_count=len(liabilities),
        receivable_count=len(receivables),
        reconciliation_open=await _scalar(
            session,
            select(func.count(ReconciliationItem.id))
            .where(ReconciliationItem.user_id == uid).where(ReconciliationItem.status == "open"),
        ),
        health=health,
        statements=statements,
        assets=assets,
        liabilities=liabilities,
        receivables=receivables,
    )


@router.get("/users/{user_id}/transactions", response_model=AdminTxnPage)
async def user_transactions(
    user_id: str,
    _: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AdminTxnPage:
    """Paginated transaction log for one user, newest first."""
    user = await _load_user(user_id, session)
    uid = user.id

    total = await _scalar(session, select(func.count(Transaction.id)).where(Transaction.user_id == uid))
    rows = list((await session.execute(
        select(Transaction)
        .where(Transaction.user_id == uid)
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
        .limit(limit).offset(offset)
    )).scalars().all())

    txns = [
        AdminTxn(
            id=str(t.id),
            transaction_date=t.transaction_date.isoformat() if t.transaction_date else "",
            description=t.description,
            amount=str(t.amount),
            currency=t.currency,
            transaction_type=t.transaction_type,
            category=t.category,
            source=t.source,
            upload_batch_id=t.upload_batch_id,
        )
        for t in rows
    ]
    return AdminTxnPage(transactions=txns, total=total, limit=limit, offset=offset)


@router.patch("/users/{user_id}", response_model=AdminUserDetail)
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminUserDetail:
    """Promote/demote an admin or reset onboarding. Self-demotion is blocked so a
    founder can't accidentally lock themselves out of the panel."""
    user = await _load_user(user_id, session)

    if body.is_admin is not None:
        if user.id == admin.id and body.is_admin is False:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't revoke your own admin access.")
        user.is_admin = body.is_admin
    if body.onboarding_completed is not None:
        user.onboarding_completed = body.onboarding_completed

    session.add(user)
    await session.commit()
    logger.info("Admin %s updated user %s (is_admin=%s, onboarding=%s)",
                admin.id, user.id, body.is_admin, body.onboarding_completed)
    return await user_detail(user_id, admin, session)


def _audit(admin: User, action: str, target: User, session: AsyncSession, **detail) -> None:
    """Append an immutable admin-action record. Email snapshots + plain UUIDs mean the
    trail survives even a subsequent hard-delete of the target (or the admin)."""
    session.add(AdminAuditLog(
        id=uuid.uuid4(),
        admin_user_id=admin.id,
        admin_email=admin.email,
        action=action,
        target_user_id=target.id,
        target_email=target.email,
        detail=json.dumps(detail) if detail else None,
        created_at=datetime.now(timezone.utc),
    ))


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    admin: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
    hard: bool = Query(default=False),
) -> None:
    """Deactivate a user. By default this is a SOFT delete (sets is_deleted, keeping the
    row) — the account can no longer log in and disappears from the admin directory, but
    the data survives and the action is logged. `?hard=true` permanently removes the user
    (and, via FK ON DELETE CASCADE, all their data). EITHER way, an AdminAuditLog row is
    written FIRST, so there is always a durable trail of who deleted whom. Deleting
    yourself is blocked."""
    user = await _load_user(user_id, session)
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't delete your own account here.")

    if hard:
        # Snapshot into the audit log BEFORE the row (and its cascade) disappears.
        _audit(admin, "user_hard_deleted", user, session,
               created_at=user.created_at.isoformat(), is_admin=user.is_admin)
        await session.delete(user)
        await session.commit()
        logger.info("Admin %s HARD-deleted user %s (%s)", admin.id, user.id, user.email)
        return

    if user.is_deleted:
        # Idempotent — already soft-deleted; nothing to do.
        return
    user.is_deleted = True
    _audit(admin, "user_soft_deleted", user, session)
    session.add(user)
    await session.commit()
    logger.info("Admin %s soft-deleted user %s (%s)", admin.id, user.id, user.email)


# ── system health + jobs ──────────────────────────────────────────────────────

@router.get("/system", response_model=SystemResponse)
async def system(
    _: User = Depends(get_admin_user),
) -> SystemResponse:
    """Config + scheduler health. Key *presence* only — never the secret value."""
    from app.core.scheduler import scheduler_status

    return SystemResponse(
        environment=settings.ENVIRONMENT,
        config={
            "deepseek_api_key": bool(settings.DEEPSEEK_API_KEY),
            "openai_api_key": bool(settings.OPENAI_API_KEY),
            "resend_api_key": bool(settings.RESEND_API_KEY),
            "llm_configured": bool(settings.DEEPSEEK_API_KEY or settings.OPENAI_API_KEY),
            "frontend_url": settings.FRONTEND_URL,
        },
        scheduler=scheduler_status(),
    )


# Map a public job key → the scheduler coroutine that runs it for all users.
_JOBS = {
    "reconciliation": "run_reconciliation_for_all_users",
    "daily_notifications": "run_daily_notifications_for_all_users",
    "price_refresh": "run_price_refresh_for_all_users",
    "email_briefs": "run_email_briefs_for_all_users",
}


@router.post("/jobs/{job}", response_model=JobRunResponse)
async def run_job(
    job: str,
    background: BackgroundTasks,
    admin: User = Depends(get_admin_user),
) -> JobRunResponse:
    """Kick off a scheduled background job on demand. Runs after the response is
    sent (BackgroundTasks) so the panel never blocks on a long network job; poll
    /admin/system to see last_run update."""
    func_name = _JOBS.get(job)
    if func_name is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown job: {job}")
    from app.core import scheduler as sched
    background.add_task(getattr(sched, func_name))
    logger.info("Admin %s triggered job %s", admin.id, job)
    return JobRunResponse(job=job, status="started")
