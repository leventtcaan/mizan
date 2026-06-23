"""
WHAT: POST /onboarding/analyze — the trust-earning final step of onboarding.
      Takes everything collected (parsed statement totals, manual income/spending,
      headline asset, headline liability) and returns (1) conflicts the user should
      resolve before anything is double-counted and (2) a short, personal "first
      impression" the AI forms from the picture.
WHY: This is read-only analysis run BEFORE any estimate rows are written, so the
     frontend can ask "is this the same money?" and only persist clean data. The
     two-sentence summary is the moment that makes a new user trust the app.
BREAKS IF REMOVED: Onboarding can't surface conflicts or a first impression; the
     spending/income step falls back to blind double-counting.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.conflict_detection import Conflict, detect_conflicts
from app.services.llm_provider import get_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

_LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}


class AssetHint(BaseModel):
    asset_type: str | None = None
    value: float | None = None


class LiabilityHint(BaseModel):
    liability_type: str | None = None
    remaining: float | None = None
    monthly_payment: float | None = None


class AnalyzeRequest(BaseModel):
    has_statement: bool = False
    parsed_income: float | None = None
    parsed_expenses: float | None = None
    manual_income: float | None = None
    manual_spending: float | None = None
    asset: AssetHint | None = None
    liability: LiabilityHint | None = None
    currency: str = "TRY"
    lang: str = "tr"


class AnalyzeResponse(BaseModel):
    conflicts: list[Conflict]
    summary: str | None


_SYSTEM_PROMPT = """\
You are Mizan, a warm, sharp global personal finance assistant meeting a new user.
You are given the snapshot they shared during onboarding. Form a genuine first impression.
Preferred language: {language_name}. You MUST respond in that language.

Rules:
- Exactly 2 sentences. No more.
- Be specific to their numbers — reference what stands out (e.g. high spend vs income,
  a large debt, a healthy cushion, a single dominant asset).
- Warm and encouraging, never judgmental, never alarmist.
- If figures are marked as estimates, treat them as rough — do not state them as fact.
- Do NOT give investment/securities advice. No disclaimers, no bullet points, no preamble.
"""


def _build_user_prompt(req: AnalyzeRequest) -> str:
    lines: list[str] = [f"Currency: {req.currency}"]
    if req.has_statement:
        if req.parsed_income is not None:
            lines.append(f"Statement income this month (real): {req.parsed_income:.0f}")
        if req.parsed_expenses is not None:
            lines.append(f"Statement expenses this month (real): {req.parsed_expenses:.0f}")
    if req.manual_income:
        tag = "supplementary, not in statement" if req.has_statement else "rough estimate"
        lines.append(f"User-reported income ({tag}): {req.manual_income:.0f}")
    if req.manual_spending:
        tag = "supplementary, not in statement" if req.has_statement else "rough estimate"
        lines.append(f"User-reported spending ({tag}): {req.manual_spending:.0f}")
    if req.asset and req.asset.value:
        lines.append(f"Largest asset ({req.asset.asset_type or 'unspecified'}): {req.asset.value:.0f}")
    if req.liability and req.liability.remaining:
        extra = ""
        if req.liability.monthly_payment:
            extra = f", monthly payment {req.liability.monthly_payment:.0f}"
        lines.append(
            f"Active debt ({req.liability.liability_type or 'unspecified'}): "
            f"remaining {req.liability.remaining:.0f}{extra}"
        )
    if len(lines) == 1:  # only the currency line
        lines.append("The user shared very little — give a welcoming, momentum-building note.")
    return "Here is what the new user shared:\n" + "\n".join(lines)


def _generate_summary(req: AnalyzeRequest) -> str | None:
    if not (len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0):
        return None
    try:
        provider = get_provider()
        system_prompt = _SYSTEM_PROMPT.format(
            language_name=_LANGUAGE_NAMES.get(req.lang, "English")
        )
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": _build_user_prompt(req)},
            ],
            temperature=0.7,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or None
    except Exception as exc:  # noqa: BLE001 — first impression is best-effort, never blocks onboarding
        logger.warning("Onboarding first-impression LLM failed: %s", exc)
        return None


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_onboarding(
    body: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AnalyzeResponse:
    """Detect double-count conflicts and form an AI first impression. No data is persisted."""
    conflicts = detect_conflicts(
        parsed_income=body.parsed_income,
        parsed_expenses=body.parsed_expenses,
        manual_income=body.manual_income,
        manual_spending=body.manual_spending,
    )
    summary = _generate_summary(body)
    logger.info(
        "Onboarding analyze — user_id=%s has_statement=%s conflicts=%d summary=%s",
        current_user.id, body.has_statement, len(conflicts), "yes" if summary else "no",
    )
    return AnalyzeResponse(conflicts=conflicts, summary=summary)
