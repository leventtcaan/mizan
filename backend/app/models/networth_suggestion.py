import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class NetworthSuggestion(Base):
    __tablename__ = "networth_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # "account_detected" | "balance_change"
    suggestion_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # FK to assets.id, nullable, SET NULL on delete
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The amount to add/subtract
    suggested_change: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="TRY")

    # Turkish human-readable explanation
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # Which upload batch triggered this
    source_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Optional structured payload (JSON) for richer suggestions — e.g. the statement→
    # net-worth bridge stores {institution, statement_kind, proposed_name, matched_asset_name}
    # so accept can create a well-named asset/liability deterministically.
    source_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    # "pending" | "accepted" | "dismissed"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
