import logging
import uuid
from collections import Counter
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction
from app.models.transaction_note import TransactionNote
from app.models.user_correction import UserCorrection
from app.services.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

_COACH_SYSTEM_PROMPT_TEMPLATE = """\
You are Clarifin, a global personal finance coach.
Analyze the user's transaction data and give warm, practical, non-judgmental feedback.
Preferred language: {language_name}. You MUST respond in that language.

Rules:
- Be curious, not judgmental
- Do not only report data — explain likely behavior patterns
- 2-4 sentences, focused and personal
- Emphasize patterns, not raw numbers
"""

_LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}

_COACH_USER_TEMPLATE = """\
Kullanıcının son {count} işlemi:

Kategori dağılımı:
{distribution}

En yüksek harcama kategorisi: {top_category}
Toplam harcama: {total_spend}
Toplam gelir: {total_income}
{estimate_section}{corrections_section}{notes_section}
Bu kullanıcının harcama davranışı hakkında kısa bir koçluk yorumu yaz.
"""


def _build_distribution(transactions: list[Transaction]) -> dict[str, Decimal]:
    totals: dict[str, Decimal] = {}
    for t in transactions:
        if t.transaction_type == "debit":
            cat = t.category or "diger"
            totals[cat] = totals.get(cat, Decimal("0")) + t.amount
    return totals


async def _fetch_corrections_context(user_id: uuid.UUID, session: AsyncSession) -> str:
    """Returns top-5 most-corrected categories as a context string for the prompt."""
    result = await session.execute(
        select(UserCorrection)
        .where(UserCorrection.user_id == user_id)
        .order_by(UserCorrection.created_at.desc())
        .limit(20)
    )
    corrections = result.scalars().all()
    if not corrections:
        return ""

    pairs = Counter(
        (c.old_category or "bilinmiyor", c.new_category) for c in corrections
    )
    top = pairs.most_common(5)
    lines = "\n".join(
        f"  '{old}' → '{new}' ({cnt} kez)" for (old, new), cnt in top
    )
    return f"\nKullanıcının düzelttiği kategoriler (AI hataları):\n{lines}\n"


async def _fetch_notes_context(
    transactions: list[Transaction],
    user_id: uuid.UUID,
    session: AsyncSession,
) -> str:
    """Returns user notes on the visible transactions, max 10 most recent."""
    tx_ids = [t.id for t in transactions]
    if not tx_ids:
        return ""

    result = await session.execute(
        select(TransactionNote)
        .where(
            TransactionNote.transaction_id.in_(tx_ids),
            TransactionNote.user_id == user_id,
        )
        .order_by(TransactionNote.created_at.desc())
        .limit(10)
    )
    notes = result.scalars().all()
    if not notes:
        return ""

    tx_map = {t.id: t.description for t in transactions}
    lines = "\n".join(
        f"  [{tx_map.get(n.transaction_id, '?')[:40]}]: {n.note_text}"
        for n in notes
    )
    return f"\nKullanıcının işlem notları:\n{lines}\n"


async def generate_insight(
    transactions: list[Transaction],
    provider: LLMProvider,
    user_id: uuid.UUID | None = None,
    session: AsyncSession | None = None,
    language: str = "tr",
) -> str:
    if not transactions:
        return "No transactions to analyze yet. Upload a bank statement." if language == "en" else "Henüz analiz edilecek işlem yok. Bir banka ekstresi yükleyin."

    debits = [t for t in transactions if t.transaction_type == "debit"]
    credits = [t for t in transactions if t.transaction_type == "credit"]

    total_spend = sum(t.amount for t in debits) if debits else Decimal("0")
    total_income = sum(t.amount for t in credits) if credits else Decimal("0")

    distribution = _build_distribution(transactions)
    top_category = max(distribution, key=lambda k: distribution[k]) if distribution else "diger"

    dist_lines = "\n".join(
        f"  {cat}: {amount:.2f}"
        for cat, amount in sorted(distribution.items(), key=lambda x: x[1], reverse=True)
    )

    # Flag rough estimates so the coach treats them as approximate, not hard facts.
    estimate_count = sum(
        1 for t in transactions if t.source in ("user_estimate",)
    )
    estimate_section = (
        f"\nNOT: {estimate_count} kayıt kullanıcının kabaca girdiği tahmin "
        "(gerçek işlem değil) — bunları kesin rakam gibi sunma.\n"
        if estimate_count else ""
    )

    corrections_section = ""
    notes_section = ""
    if user_id is not None and session is not None:
        corrections_section = await _fetch_corrections_context(user_id, session)
        notes_section = await _fetch_notes_context(transactions, user_id, session)

    prompt = _COACH_USER_TEMPLATE.format(
        count=len(transactions),
        distribution=dist_lines or "  Veri yok",
        top_category=top_category,
        total_spend=f"{total_spend:.2f}",
        total_income=f"{total_income:.2f}",
        estimate_section=estimate_section,
        corrections_section=corrections_section,
        notes_section=notes_section,
    )

    system_prompt = _COACH_SYSTEM_PROMPT_TEMPLATE.format(
        language_name=_LANGUAGE_NAMES.get(language, "English")
    )

    try:
        insight = _call_with_coach_prompt(provider, system_prompt, prompt)
        logger.info("Coaching insight generated — %d chars", len(insight))
        return insight
    except Exception as exc:
        logger.error("Coaching LLM call failed: %s", exc)
        return "Analysis unavailable. Please try again later." if language == "en" else "Analiz şu anda mevcut değil. Lütfen daha sonra tekrar deneyin."


def _call_with_coach_prompt(provider: LLMProvider, system_prompt: str, user_prompt: str) -> str:
    response = provider.client.chat.completions.create(
        model=provider.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.7,
    )
    return response.choices[0].message.content or ""
