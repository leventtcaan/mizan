import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.user import Base

NOTIFICATION_TYPES = {"info", "warning", "alert"}


class AppNotification(Base):
    __tablename__ = "app_notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20), default="info")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Proactive "Mim" actions: a notification can ask a question and act on the answer.
    # action_type drives the response handler; action_data is a JSON payload; action_state
    # tracks the question's lifecycle. "none" = a plain informational notification.
    action_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    action_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_state: Mapped[str] = mapped_column(String(20), default="none", nullable=False, server_default="none")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
