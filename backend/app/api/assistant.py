"""
Global AI assistant API.
POST /assistant/chat — unified context chat; may return a structured proposal.
POST /assistant/action/confirm — execute a proposed action (by action_id).
POST /assistant/action/reject — log rejection.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
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
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AssistantChatResponse:
    result = await run_chat(
        current_user,
        body.message,
        body.page_context,
        [m.model_dump() for m in body.session_history],
        session,
    )
    proposal = result.get("proposal")
    return AssistantChatResponse(
        reply=result["reply"],
        proposal=ActionProposal(**proposal) if proposal else None,
    )


@router.post("/action/confirm", response_model=ConfirmResponse)
async def assistant_confirm(
    body: ConfirmRequest,
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConfirmResponse:
    try:
        result = await reject_action(current_user, body.action_id, session)
    except ActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ConfirmResponse(ok=result["ok"])
