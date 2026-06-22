"""
WHAT: Conversational behavioral coaching — POST /chat, GET /chat/history, GET /chat/profile.
WHY: The static insight paragraph was a dead end; users need to ask follow-up questions,
     share context the bank statement doesn't have (rent, salary), and get coaching
     that remembers what they said last week. This makes Mizan worth returning to.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.core.rate_limiter import RateLimiter
from app.models.behavioral_profile import BehavioralProfile  # noqa: F401 — used via get_or_create
from app.models.conversation import ConversationMessage
from app.models.user import User
from app.services.behavioral_coach import (
    build_profile_context,
    build_spending_summary,
    build_system_prompt,
    detect_transaction_intent,
    extract_profile_facts,
    get_or_create_profile,
    merge_profile,
)
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_latest_batch_id, get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# WHY: Chat is inherently interactive — users send many short messages.
# 60/hr is generous but prevents runaway LLM costs if a browser tab loops.
_chat_limiter = RateLimiter()
_CHAT_LIMIT = 60
_CHAT_WINDOW = 3600


class ChatRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message cannot be empty")
        if len(v) > 2000:
            raise ValueError("message too long (max 2000 chars)")
        return v


class PendingTransaction(BaseModel):
    amount: str
    type: str
    description: str
    date: str
    category: str


class ChatResponse(BaseModel):
    response: str
    profile_updated: bool
    pending_transaction: PendingTransaction | None = None


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    created_at: str


class ProfileResponse(BaseModel):
    fixed_expenses: dict
    income_sources: dict
    spending_patterns: dict
    user_notes: str
    updated_at: str | None


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    user_id_str = str(current_user.id)

    if not _chat_limiter.is_allowed(user_id_str, _CHAT_LIMIT, _CHAT_WINDOW):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Saatte en fazla 60 mesaj gönderebilirsiniz.",
        )

    # ── 1. Load conversation history (last 10 turns = 20 messages) ────────────
    history_result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.user_id == current_user.id)
        .order_by(ConversationMessage.created_at.desc())
        .limit(20)
    )
    history = list(reversed(history_result.scalars().all()))

    # ── 2. Load behavioral profile ────────────────────────────────────────────
    profile = await get_or_create_profile(current_user.id, session)

    # ── 3. Load spending context (latest batch) ───────────────────────────────
    transactions = await get_transactions_for_user(current_user.id, session, all_batches=False)
    batch_id = await get_latest_batch_id(current_user.id, session)

    # ── 4. Build system prompt with all context ───────────────────────────────
    profile_ctx = build_profile_context(profile)
    spending_ctx = build_spending_summary(transactions)
    system_prompt = build_system_prompt(profile_ctx, spending_ctx, language=current_user.language)

    # ── 5. Assemble messages for LLM ─────────────────────────────────────────
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": body.message})

    # ── 6. Main LLM call ──────────────────────────────────────────────────────
    provider = get_provider("chat")
    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=messages,
            temperature=0.7,
        )
        assistant_reply = response.choices[0].message.content or ""
        if not assistant_reply.strip():
            assistant_reply = "Bir hata oluştu, tekrar deneyin."
    except Exception as exc:
        logger.error("Chat LLM call failed: %s", exc)
        assistant_reply = "Şu anda yanıt veremiyorum. Lütfen biraz sonra tekrar deneyin."

    # ── 7. Persist both messages ──────────────────────────────────────────────
    session.add(ConversationMessage(
        user_id=current_user.id,
        role="user",
        content=body.message,
        context_batch_id=batch_id,
    ))
    session.add(ConversationMessage(
        user_id=current_user.id,
        role="assistant",
        content=assistant_reply,
        context_batch_id=batch_id,
    ))
    await session.flush()

    # ── 8. Extract learnable facts → update profile ───────────────────────────
    facts = extract_profile_facts(body.message, provider)
    profile_updated = merge_profile(profile, facts)

    # ── 9. Detect transaction intent ─────────────────────────────────────────
    pending_tx = detect_transaction_intent(body.message, provider)

    await session.commit()

    pending = PendingTransaction(**pending_tx) if pending_tx else None
    logger.info(
        "Chat message processed — user=%s profile_updated=%s pending_tx=%s history_len=%d",
        current_user.id, profile_updated, bool(pending), len(history),
    )
    return ChatResponse(
        response=assistant_reply,
        profile_updated=profile_updated,
        pending_transaction=pending,
    )


@router.get("/history", response_model=list[MessageResponse])
async def get_history(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MessageResponse]:
    """Returns last 20 messages in chronological order (oldest first)."""
    result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.user_id == current_user.id)
        .order_by(ConversationMessage.created_at.asc())
        .limit(20)
    )
    messages = result.scalars().all()
    return [
        MessageResponse(
            id=str(m.id),
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat(),
        )
        for m in messages
    ]


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProfileResponse:
    profile = await get_or_create_profile(current_user.id, session)
    await session.commit()
    return ProfileResponse(
        fixed_expenses=json.loads(profile.fixed_expenses or "{}"),
        income_sources=json.loads(profile.income_sources or "{}"),
        spending_patterns=json.loads(profile.spending_patterns or "{}"),
        user_notes=profile.user_notes or "",
        updated_at=profile.updated_at.isoformat() if profile.updated_at else None,
    )
