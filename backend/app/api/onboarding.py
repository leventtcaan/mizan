"""
WHAT: POST /onboarding/analyze — the final "first impression" step of onboarding.
      Given what the uploaded statement(s) revealed (parsed income + expenses), it returns
      a short, personal two-sentence read of the user's situation.
WHY: Onboarding no longer asks for manual income/spending or assets/liabilities — those
     created conflicts with statement data and confused users. The only thing this endpoint
     does now is form a friendly first impression from the parsed statement. When there is
     no statement, it returns no summary and the frontend shows a simple welcome instead.
BREAKS IF REMOVED: The onboarding "Mizan'ın ilk izlenimi" step has nothing to display.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.llm_provider import get_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

_LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}


class AnalyzeRequest(BaseModel):
    has_statement: bool = False
    parsed_income: float | None = None
    parsed_expenses: float | None = None
    currency: str = "TRY"
    lang: str = "tr"


class AnalyzeResponse(BaseModel):
    summary: str | None  # None → frontend shows a plain welcome and goes to Home


_SYSTEM_PROMPT = """\
You are Clarifin, a warm, sharp global personal finance assistant meeting a new user.
You are given what their uploaded bank statement showed. Form a genuine first impression.
Preferred language: {language_name}. You MUST respond in that language.

Rules:
- Exactly 2 sentences. No more.
- Be specific to their numbers — reference what stands out (e.g. high spend vs income,
  a healthy surplus, a tight month).
- Warm and encouraging, never judgmental, never alarmist.
- Do NOT give investment/securities advice. No disclaimers, no bullet points, no preamble.
"""


def _build_user_prompt(req: AnalyzeRequest) -> str:
    lines = [f"Currency: {req.currency}"]
    if req.parsed_income is not None:
        lines.append(f"Income seen in the statement this period: {req.parsed_income:.0f}")
    if req.parsed_expenses is not None:
        lines.append(f"Expenses seen in the statement this period: {req.parsed_expenses:.0f}")
    if req.parsed_income is not None and req.parsed_expenses is not None:
        lines.append(f"Net this period: {req.parsed_income - req.parsed_expenses:.0f}")
    return "Here is what the new user's statement showed:\n" + "\n".join(lines)


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
) -> AnalyzeResponse:
    """First impression from the parsed statement. Nothing is persisted; no conflict UI."""
    if not body.has_statement:
        return AnalyzeResponse(summary=None)
    summary = _generate_summary(body)
    logger.info(
        "Onboarding analyze — user_id=%s has_statement=True summary=%s",
        current_user.id, "yes" if summary else "no",
    )
    return AnalyzeResponse(summary=summary)
