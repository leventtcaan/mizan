import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base

ASSET_TYPES = {
    "cash", "bank_account", "stock", "fund", "crypto",
    "real_estate", "vehicle", "bes", "gold", "foreign_currency",
    "bond", "commodity", "art_collectible",
    "jewelry", "life_insurance", "pension", "business_ownership",
    "other_asset",
}

SOURCE_TYPES = {"manual", "statement_upload", "receivable_collection", "auto_detected"}


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(50), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="TRY")
    # Numeric(28,8): high precision so fractional crypto/gold quantities (e.g. 0.00012345 BTC)
    # survive. For unit-priced types current_value holds the QUANTITY; otherwise the VALUE.
    current_value: Mapped[Decimal] = mapped_column(Numeric(28, 8), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Valuation model (P1): for repriceable holdings (stocks/funds), quantity + unit_code let
    # the price service recompute value live. unit_code = ticker/symbol (e.g. "AAPL").
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(28, 8), nullable=True)
    unit_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Optional link to an Account (P2). Nullable — most assets aren't account-scoped.
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )

    source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual")
    # JSON string (subtype metadata, price cache, lineage). Text not String(500):
    # accumulated price metadata + subtype fields can exceed 500 chars and would
    # otherwise silently truncate, corrupting the stored JSON.
    source_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
