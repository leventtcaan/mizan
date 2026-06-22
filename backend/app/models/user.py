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

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
