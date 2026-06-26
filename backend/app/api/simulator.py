"""
WHAT: Financial simulator endpoints — "what happens if I do X?" across the user's
      complete picture. GET /simulator/levers (personalized options), POST /simulator/run
      (structured levers), POST /simulator/ask (natural language → levers → run).
WHY: Additive surface — no changes to existing pages/tables. The engine (services/
      simulator.py) is deterministic; the LLM only parses NL and narrates.
BREAKS IF REMOVED: The /simulator page has no backend.
"""

import logging

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_pro_user
from app.models.user import User
from app.services.simulator import (
    ACTION_TYPES,
    DEFAULT_HORIZON,
    MAX_HORIZON,
    ask_simulation,
    get_levers,
    run_simulation,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/simulator", tags=["simulator"])


class SimAction(BaseModel):
    type: str
    amount: float
    label: str | None = None
    debt_id: str | None = None


class RunRequest(BaseModel):
    actions: list[SimAction] = Field(default_factory=list)
    horizon_months: int = DEFAULT_HORIZON


class AskRequest(BaseModel):
    question: str
    horizon_months: int = DEFAULT_HORIZON


def _clean_actions(actions: list[SimAction]) -> list[dict]:
    out: list[dict] = []
    for a in actions:
        if a.type not in ACTION_TYPES:
            continue
        d = {"type": a.type, "amount": a.amount}
        if a.label:
            d["label"] = a.label
        if a.debt_id:
            d["debt_id"] = a.debt_id
        out.append(d)
    return out


@router.get("/levers")
async def levers(
    display_currency: str = Query(default="TRY"),
    current_user: User = Depends(get_pro_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Personalized lever options (their subscriptions, debts, cash, surplus)."""
    return await get_levers(current_user.id, session, display_currency)


@router.post("/run")
async def run(
    body: RunRequest,
    display_currency: str = Query(default="TRY"),
    lang: str = Query(default="tr"),
    current_user: User = Depends(get_pro_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Project baseline vs scenario for the given structured levers."""
    horizon = max(1, min(MAX_HORIZON, body.horizon_months or DEFAULT_HORIZON))
    return await run_simulation(
        current_user.id, session, display_currency, _clean_actions(body.actions), horizon, lang,
    )


@router.post("/ask")
async def ask(
    body: AskRequest,
    display_currency: str = Query(default="TRY"),
    lang: str = Query(default="tr"),
    current_user: User = Depends(get_pro_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Natural-language question → parsed levers → projection. parsed=False if unmapped."""
    horizon = max(1, min(MAX_HORIZON, body.horizon_months or DEFAULT_HORIZON))
    return await ask_simulation(
        current_user.id, session, display_currency, body.question.strip(), horizon, lang,
    )
