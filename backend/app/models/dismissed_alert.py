import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class DismissedAlert(Base):
    """
    WHAT: Records which pattern alerts a user has explicitly dismissed.
    WHY: Pattern detection is purely algorithmic — it re-runs on every request.
         Without persistence, dismissed alerts would reappear on every page load.
         dismiss_key is a stable string derived from the alert content
         (e.g. "recurring:netflix" or "post_salary_spike") so it survives
         across app restarts and re-detections.
    """

    __tablename__ = "dismissed_alerts"

    __table_args__ = (
        UniqueConstraint("user_id", "dismiss_key", name="uq_dismissed_alerts_user_key"),
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

    dismiss_key: Mapped[str] = mapped_column(String(100), nullable=False)

    dismissed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
