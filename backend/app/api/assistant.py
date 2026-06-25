"""
Global AI assistant API.
POST /assistant/chat — unified context chat; may return a structured proposal.
POST /assistant/action/confirm — execute a proposed action (by action_id).
POST /assistant/action/reject — log rejection.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_verified_user
from app.core.plans import assistant_daily_cap
from app.core.rate_limiter import assistant_limiter
from app.models.conversation import ConversationMessage
from app.models.user import User
from app.services.assistant import ActionError, confirm_action, reject_action, run_chat

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])

_PAGE_CONTEXTS = {"home", "networth", "transactions", "cashflow"}


class ChatMessageIn(BaseModel):
    role: str = "user"
    content: str = ""


class AssistantChatRequest(BaseModel):
    message: str
    page_context: str = "home"
    session_history: list[ChatMessageIn] = []
    # When present, scope the financial context to this upload batch (a specific
    # statement/brief) instead of the user's aggregate data.
    job_id: str | None = None

    @field_validator("message")
    @classmethod
    def non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("message cannot be empty")
        return v.strip()

    @field_validator("page_context")
    @classmethod
    def valid_context(cls, v: str) -> str:
        return v if v in _PAGE_CONTEXTS else "home"


class ActionProposal(BaseModel):
    action_id: str
    action_type: str
    description: str
    params: dict


class AssistantChatResponse(BaseModel):
    reply: str
    proposal: ActionProposal | None = None


class ConfirmRequest(BaseModel):
    action_id: str


class ConfirmResponse(BaseModel):
    ok: bool
    message: str | None = None
    action_type: str | None = None


@router.post("/chat", response_model=AssistantChatResponse)
async def assistant_chat(
    body: AssistantChatRequest,
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> AssistantChatResponse:
    # Free tier: 10 assistant messages per rolling 24h. Paid plans are unlimited
    # (cap is None → skip the check).
    #
    # The cap is enforced DURABLY by counting persisted messages from the DB — the
    # previous rate-limiter-only check was volatile (in-memory window reset on every
    # restart, and is per-process without Redis), so a free user was effectively never
    # capped in practice. The DB count survives restarts, workers, and a missing Redis.
    # The rate limiter is kept as a secondary short-window guard against bursts.
    cap = assistant_daily_cap(current_user)
    if cap is not None:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        used = await session.scalar(
            select(func.count(ConversationMessage.id)).where(
                ConversationMessage.user_id == current_user.id,
                ConversationMessage.role == "user",
                ConversationMessage.created_at >= since,
            )
        )
        if (used or 0) >= cap:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="assistant_daily_cap_reached",
            )
        # Secondary burst guard (best-effort; never the sole gate).
        if not assistant_limiter.is_allowed(str(current_user.id), max_calls=cap, window_seconds=86400):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="assistant_daily_cap_reached",
            )

    result = await run_chat(
        current_user,
        body.message,
        body.page_context,
        [m.model_dump() for m in body.session_history],
        session,
        job_id=body.job_id,
    )

    # Persist the exchange so the daily cap is countable and durable. Best-effort —
    # a logging failure must not fail the reply the user already received.
    try:
        now = datetime.now(timezone.utc)
        session.add(ConversationMessage(
            user_id=current_user.id, role="user", content=body.message[:2000], created_at=now,
        ))
        session.add(ConversationMessage(
            user_id=current_user.id, role="assistant", content=(result.get("reply") or "")[:4000], created_at=now,
        ))
        await session.commit()
    except Exception as exc:
        logger.warning("Failed to persist assistant exchange for cap counting: %s", exc)

    proposal = result.get("proposal")
    return AssistantChatResponse(
        reply=result["reply"],
        proposal=ActionProposal(**proposal) if proposal else None,
    )


@router.post("/action/confirm", response_model=ConfirmResponse)
async def assistant_confirm(
    body: ConfirmRequest,
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> ConfirmResponse:
    try:
        result = await confirm_action(current_user, body.action_id, session)
    except ActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ConfirmResponse(ok=result["ok"], message=result.get("message"), action_type=result.get("action_type"))


@router.post("/action/reject", response_model=ConfirmResponse)
async def assistant_reject(
    body: ConfirmRequest,
    current_user: User = Depends(get_verified_user),
    session: AsyncSession = Depends(get_session),
) -> ConfirmResponse:
    try:
        result = await reject_action(current_user, body.action_id, session)
    except ActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ConfirmResponse(ok=result["ok"])
