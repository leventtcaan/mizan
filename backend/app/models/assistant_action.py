import uuid
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.user import Base

# Structured actions the assistant can propose and execute.
ASSISTANT_ACTION_TYPES = {
    "mark_receivable_received",
    "create_asset",
    "dismiss_reconciliation_item",
    "categorize_transaction",
    "add_liability",
}
ASSISTANT_ACTION_STATUSES = {"proposed", "confirmed", "rejected"}


class AssistantAction(Base):
    """Audit log + execution record for assistant-proposed actions.

    The proposal is persisted server-side at chat time (status=proposed). /confirm
    executes ONLY from the stored row after re-checking ownership, so the browser
    can never replay arbitrary params into a mutation.
    """

    __tablename__ = "assistant_actions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action_type: Mapped[str] = mapped_column(String(50))
    params_json: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="proposed", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
