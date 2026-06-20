import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class BehavioralProfile(Base):
    """
    WHAT: One row per user — accumulates financial facts the user shares in chat.
    WHY: Persistent memory that makes each coaching session aware of prior context.
         Stored as JSON text so schema changes don't require migrations as the
         profile structure evolves.
    """

    __tablename__ = "behavioral_profiles"

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_behavioral_profiles_user"),
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

    # WHY: JSON stored as Text — dialect-neutral, no JSONB migration if tests use SQLite.
    # Format: {"kira": 5000, "yurt_ödemesi": 12500}
    fixed_expenses: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Format: {"maaş": 45000, "freelance": 3000}
    income_sources: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Format: {"hafta_sonu_dışarı_çıkıyor": true, "market_haftalık": true}
    spending_patterns: Mapped[str | None] = mapped_column(Text, nullable=True)

    # WHY: Free-form text — anything the user mentions that doesn't fit a structured field.
    # Examples: "Yalnız yaşıyorum", "İstanbul Anadolu", "2 çocuğum var"
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Nullable — None until the first fact is extracted from a chat message.
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
