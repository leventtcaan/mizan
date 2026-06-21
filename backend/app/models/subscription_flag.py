import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class SubscriptionFlag(Base):
    __tablename__ = "subscription_flags"

    __table_args__ = (
        UniqueConstraint("user_id", "merchant_key", name="uq_subscription_flags_user_merchant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Stable key: normalized description[:30].lower() — same as patterns._normalize_key()
    merchant_key: Mapped[str] = mapped_column(String(100), nullable=False)

    # "essential" | "review" | "cancelled"
    flag: Mapped[str] = mapped_column(String(20), nullable=False)

    flagged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
