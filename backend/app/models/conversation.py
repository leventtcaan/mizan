import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.user import Base


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # WHY: "user" | "assistant" — mirrors OpenAI chat message roles so the stored
    # history can be replayed directly into the LLM messages array without mapping.
    role: Mapped[str] = mapped_column(String(10), nullable=False)

    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    # WHY: Ties the message to a specific statement upload so future retrieval
    # can scope context to the relevant batch. Nullable — messages sent before
    # any upload have no batch context.
    context_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
