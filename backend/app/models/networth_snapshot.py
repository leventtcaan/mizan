import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class NetworthSnapshot(Base):
    __tablename__ = "networth_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    net_worth_usd: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    assets_usd: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    liabilities_usd: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    # Per-asset / per-liability USD values at snapshot time, for change attribution.
    # JSON: {"assets": {id: {"name","type","usd"}}, "liabilities": {id: {"name","usd"}}}
    breakdown_json: Mapped[str | None] = mapped_column(Text, nullable=True)
