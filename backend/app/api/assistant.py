"""
Global AI assistant API.
POST /assistant/chat — unified context chat; may return a structured proposal.
POST /assistant/action/confirm — execute a proposed action (by action_id).
POST /assistant/action/reject — log rejection.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_verified_user
from app.core.plans import assistant_daily_cap
from app.core.rate_limiter import assistant_limiter
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
    # (cap is None → skip the check). Redis-backed so it survives restarts and is
    # shared across instances. The window only advances on allowed messages.
    cap = assistant_daily_cap(current_user)
    if cap is not None and not assistant_limiter.is_allowed(
        str(current_user.id), max_calls=cap, window_seconds=86400
    ):
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
