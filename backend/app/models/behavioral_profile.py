import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
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

    fixed_expenses: Mapped[str | None] = mapped_column(Text, nullable=True)
    income_sources: Mapped[str | None] = mapped_column(Text, nullable=True)
    spending_patterns: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # WHY: Personality analysis is one expensive LLM call. Cache it here keyed by
    # the latest upload batch so it only regenerates when new data arrives.
    personality_cache: Mapped[str | None] = mapped_column(Text, nullable=True)
    personality_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
