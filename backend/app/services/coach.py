"""
WHAT: Behavioral coaching engine — analyzes categorized transactions and returns
      an insight string explaining the user's spending psychology in Turkish.
WHY: This is Mizan's core differentiator. Every other finance app shows pie charts;
     Mizan explains WHY the user spends how they spend.
BREAKS IF REMOVED: GET /insights returns no coaching; app is just a transaction viewer.
"""

import logging
from collections import Counter
from decimal import Decimal

from app.models.transaction import Transaction
from app.services.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

_COACH_SYSTEM_PROMPT = """\
Sen Mizan adlı bir Türk kişisel finans koçusun.
Kullanıcının harcama verilerini analiz edip onlara Türkçe, samimi ve yapıcı bir geri bildirim veriyorsun.

Kurallar:
- Yargılayıcı değil, merak eden bir ton kullan
- Sadece veri gösterme — NEDEN böyle harcıyor olabileceğini yorumla
- 2-4 cümle, odaklı ve kişisel
- Rakamlar yerine kalıpları (pattern) vurgula
- Türkçe yaz
"""

_COACH_USER_TEMPLATE = """\
Kullanıcının son {count} işlemi:

Kategori dağılımı:
{distribution}

En yüksek harcama kategorisi: {top_category}
Toplam harcama: {total_spend} ₺
Toplam gelir: {total_income} ₺

Bu kullanıcının harcama davranışı hakkında kısa bir koçluk yorumu yaz.
"""


def _build_distribution(transactions: list[Transaction]) -> dict[str, Decimal]:
    """
    WHAT: Aggregates total spend per category from a list of transactions.
    WHY: LLM performs better with aggregated numbers than a raw transaction list —
         it focuses on patterns, not noise.
    """
    totals: dict[str, Decimal] = {}
    for t in transactions:
        if t.transaction_type == "debit":
            cat = t.category or "diger"
            totals[cat] = totals.get(cat, Decimal("0")) + t.amount
    return totals


async def generate_insight(
    transactions: list[Transaction],
    provider: LLMProvider,
) -> str:
    """
    WHAT: Builds a spending summary and calls the LLM to produce a coaching insight.
    WHY: Summarizing before calling the LLM reduces token count and focuses the model
         on behavioral patterns rather than individual transactions.
    BREAKS IF REMOVED: GET /insights has no text to return.
    """
    if not transactions:
        return "Henüz analiz edilecek işlem yok. Bir banka ekstresi yükleyin."

    debits = [t for t in transactions if t.transaction_type == "debit"]
    credits = [t for t in transactions if t.transaction_type == "credit"]

    total_spend = sum(t.amount for t in debits) if debits else Decimal("0")
    total_income = sum(t.amount for t in credits) if credits else Decimal("0")

    distribution = _build_distribution(transactions)
    top_category = max(distribution, key=lambda k: distribution[k]) if distribution else "diger"

    dist_lines = "\n".join(
        f"  {cat}: {amount:.2f} ₺"
        for cat, amount in sorted(distribution.items(), key=lambda x: x[1], reverse=True)
    )

    prompt = _COACH_USER_TEMPLATE.format(
        count=len(transactions),
        distribution=dist_lines or "  Veri yok",
        top_category=top_category,
        total_spend=f"{total_spend:.2f}",
        total_income=f"{total_income:.2f}",
    )

    try:
        # WHY: Temporarily override system prompt with coaching persona.
        # provider.complete() uses the categorization system prompt by default;
        # we pass the coach prompt via a direct client call to keep separation clean.
        insight = _call_with_coach_prompt(provider, prompt)
        logger.info("Coaching insight generated — %d chars", len(insight))
        return insight
    except Exception as exc:
        logger.error("Coaching LLM call failed: %s", exc)
        return "Analiz şu anda mevcut değil. Lütfen daha sonra tekrar deneyin."


def _call_with_coach_prompt(provider: LLMProvider, user_prompt: str) -> str:
    """
    WHAT: Calls the underlying OpenAI-compatible client with the coach system prompt.
    WHY: provider.complete() hardcodes the categorization system prompt (circular import
         from categorizer.py). Coach needs a different system prompt, so we call the
         client directly via the provider's internal client attribute.
    BREAKS IF REMOVED: Coaching insight uses the wrong system prompt (categorization).
    """
    response = provider.client.chat.completions.create(
        model=provider.model,
        messages=[
            {"role": "system", "content": _COACH_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.7,  # WHY: Higher temperature for coaching — more human, less robotic
    )
    return response.choices[0].message.content or ""
