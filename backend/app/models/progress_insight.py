"""
WHAT: ORM model for the `progress_insights` table — caches /insights/progress and
      /insights/comparison results per user.
WHY: Both endpoints do a full table scan + Python aggregation; /insights/comparison
     also makes one LLM call per category. Without a cache, every page refresh is
     expensive. Cache key is a hash of (user_id + sorted batch_ids) — a new upload
     automatically produces a different key, triggering a miss without explicit bust.
     Category corrections bust the cache explicitly via bust_progress_cache().
BREAKS IF REMOVED: Every /progress page load triggers DB aggregation + LLM calls.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class ProgressInsight(Base):
    __tablename__ = "progress_insights"

    __table_args__ = (
        # WHY: One cache row per (user, data_type) so progress and comparison are
        # stored independently. Each endpoint upserts only its own row without
        # touching the other's column — no race condition between concurrent loads.
        UniqueConstraint("user_id", "data_type", name="uq_progress_insights_user_type"),
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

    # WHY: "progress" | "comparison" — discriminator so each endpoint owns its row.
    data_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # WHY: SHA-256 of (user_id + sorted batch_ids). Changes when user uploads a new
    # statement, causing automatic cache miss without needing an explicit bust.
    cache_key: Mapped[str] = mapped_column(String(64), nullable=False)

    # WHY: JSON-serialised Pydantic model (model_dump_json()). Text avoids dialect-
    # specific JSON column differences between PostgreSQL and SQLite in tests.
    data: Mapped[str] = mapped_column(Text, nullable=False)

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
