"""
WHAT: Append-only audit trail for sensitive admin actions (user delete/restore, etc.).
WHY: A founder hard-deleting an account needs a durable record of who did what and to
     whom — the audit must SURVIVE the target (and even the acting admin) being removed.
     That's why target_user_id / admin_user_id are plain UUIDs (no cascading FK) and an
     email snapshot is stored alongside.
BREAKS IF REMOVED: User deletions leave no trace beyond ephemeral application logs.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base

# Recognised audit actions (kept open as plain strings; this set documents the current ones).
ADMIN_AUDIT_ACTIONS = {"user_soft_deleted", "user_hard_deleted", "user_restored"}


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    # Plain UUIDs (no FK) so the trail outlives the rows it references.
    admin_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    admin_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    action: Mapped[str] = mapped_column(String(50), nullable=False)

    target_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    target_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # optional JSON snapshot

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
