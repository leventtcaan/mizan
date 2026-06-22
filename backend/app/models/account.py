import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base

# Where money lives. Assets (and later transactions) can be scoped to one of these,
# so a user with several banks/wallets/brokers sees per-account structure.
ACCOUNT_TYPES = {"bank", "wallet", "broker", "cash", "credit_card", "other"}


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[str] = mapped_column(String(30), nullable=False, default="bank")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="TRY")
    institution: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
