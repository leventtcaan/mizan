"""
WHAT: SQLAlchemy ORM model for the `users` table — one row per app user.
WHY: Defines the schema contract between Python and PostgreSQL. Every table
     column is a typed Python attribute; the ORM enforces types at the
     application layer before data reaches the DB.
BREAKS IF REMOVED: Transaction model has no foreign key target; upload endpoint
                   can't associate uploaded files with an owner.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """
    WHAT: Shared declarative base that all ORM models inherit from.
    WHY: SQLAlchemy needs a single metadata registry to discover all models
         when Alembic generates migrations or when main.py creates tables.
    BREAKS IF REMOVED: Alembic autogenerate finds no models; create_all() does nothing.
    """
    pass


class User(Base):
    """
    WHAT: Maps the `users` table. One row = one person using the app.
    WHY: Minimal by design — Phase 1 needs only an identity anchor for
         Transaction rows. Auth fields (password_hash, etc.) come in Phase 3.
    BREAKS IF REMOVED: Transaction.user_id foreign key has no parent table;
                       the DB will reject the schema.
    """

    __tablename__ = "users"

    # WHY: UUID primary key instead of serial int — safe to expose in URLs
    # without leaking record count; collision-proof across distributed inserts.
    # ALTERNATIVE: SERIAL / BIGSERIAL. TRADEOFF: Sequential ints are guessable.
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )

    # WHY: email is the natural human identity — used for future login + notifications.
    # unique=True enforced at DB level, not just application level (race-condition safe).
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    # WHY: Nullable so existing rows (created before Phase 4) are valid without a hash.
    # Phase 4 register endpoint sets this; dev seed user has no password (can't log in).
    password_hash: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # WHY: Email ownership gate. New accounts start unverified — upload + AI features are
    # locked (get_verified_user → 403) until the user clicks the signed link we email them.
    # New ORM inserts default False; migration 0036 backfills existing rows to True so
    # accounts created before this feature aren't retroactively locked out.
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    # WHY: Subscription tier — "free" | "plus" | "pro". Drives the upload cap and whether
    # vision PDF extraction is allowed. effective_plan() in core/plans.py resolves the
    # *current* plan (a paid plan past plan_expires_at counts as free).
    plan: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="free",
        server_default=text("'free'"),
    )

    # WHY: When the current paid plan lapses. Null = never expires (or free). Set by a
    # future billing webhook; read by effective_plan() to downgrade lapsed subscriptions.
    plan_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # WHY: timezone=True stores UTC offset alongside the timestamp in PostgreSQL.
    # ALTERNATIVE: Store naive datetime. TRADEOFF: Naive datetimes silently break
    # when the server's timezone changes or data crosses regions.
    email_weekly_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    onboarding_completed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    # WHY: Gates the founder/admin panel (/admin). Defaults false so no one is an
    # admin by accident — promotion is an explicit DB update or an action by an
    # existing admin. server_default keeps existing rows valid on migration.
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    # WHY: Soft-delete flag. The admin panel deactivates an account by setting this
    # (preserving the row + an AdminAuditLog trail) rather than hard-deleting. A
    # soft-deleted user can't log in and is hidden from the admin directory/counts.
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    language: Mapped[str] = mapped_column(
        String(5),
        nullable=False,
        default="tr",
        server_default=text("'tr'"),
    )

    # User's preferred display currency — the single source of truth across the app.
    display_currency: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="TRY",
        server_default=text("'TRY'"),
    )

    # WHY: Last time the weekly "money brief" email was sent — enforces the ~weekly
    # cadence (skip if sent within the last 6 days) so a re-run of the job/endpoint
    # can't double-send. Nullable: a user who has never received one.
    last_email_brief_sent: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ── Registration profile (captured at signup / enriched in onboarding) ──
    # WHY full_name: personalization (greet by name) + a future requirement for
    # billing/invoicing. Nullable — name is optional at signup.
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # WHY country: ISO 3166-1 alpha-2 residence code. Drives default currency/formatting,
    # localization roadmap, and — critically — which privacy regime applies (GDPR/KVKK/…).
    # Cannot be reliably inferred from IP, so we ask once at signup.
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)

    # ── Consent (compliance-critical, must be auditable) ──
    # WHY: GDPR/KVKK require marketing consent to be explicit, unbundled and OFF by
    # default; ToS acceptance must be provable with a timestamp + the policy version.
    marketing_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false"),
    )
    tos_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tos_version: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # WHY: The user's primary intent ("understand_spending", "manage_cashflow", …).
    # Asked once in onboarding; powers dashboard emphasis, Mim's framing and BI cohorts.
    primary_goal: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # ── Account type + business profile ──
    # WHY account_type: durably drives dashboard emphasis (business → receivables/cash flow,
    # personal → spending/savings) instead of relying only on a localStorage hint.
    account_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="personal", server_default="personal",
    )
    # Business fields — populated when account_type == "business" (else NULL).
    company_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(60), nullable=True)
    team_size: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Optional contact + locale.
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # IANA timezone, auto-detected from the browser (e.g. "Europe/Istanbul").
    timezone: Mapped[str | None] = mapped_column(String(60), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
