"""
WHAT: ORM model for the `upload_insights` table — one cached insight per upload batch.
WHY: Prevents an LLM call on every /insights page load; cache is invalidated after 24 hours.
BREAKS IF REMOVED: No insight cache — every GET /insights triggers a full LLM call.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class UploadInsight(Base):
    __tablename__ = "upload_insights"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    # WHY: user_id scopes the cache so users never see each other's insights.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # WHY: upload_batch_id is the cache key — a new upload produces a new batch_id
    # which automatically misses the cache without any explicit invalidation logic.
    upload_batch_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True, unique=True
    )

    insight_text: Mapped[str] = mapped_column(Text, nullable=False)

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
