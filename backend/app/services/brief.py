"""
WHAT: Builds the "Post-Upload Brief" — a structured, narrative read of a single
      uploaded statement (one upload batch). Powers POST /upload/brief.
WHY: After an upload we used to dump the user into a transaction table. The brief
     replaces that with a 60–90s story: what came in/out, where it went, the
     strongest recurring pattern, and one concrete next move. It reuses the same
     aggregates the coach/recurring engine already compute — no new tables, no new
     data. The narrative paragraph is LLM-written when a key is available and falls
     back to a deterministic template otherwise.
BREAKS IF REMOVED: /upload/brief has nothing to assemble; the /brief screen 404s
     and the upload flow silently falls back to /transactions.
"""

import asyncio
import logging
import uuid
from collections import Counter
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.transaction import Transaction
from app.services.llm_provider import get_provider
from app.services.recurring import analyze_recurring

logger = logging.getLogger(__name__)

_LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}

# Slug → human label, per language. Mirrors frontend categories.ts; used only for the
# narrative + template (the API returns the raw slug as `name` so the frontend maps it).
_CATEGORY_LABELS = {
    "tr": {
        "market": "Market", "restoran": "Restoran", "ulasim": "Ulaşım",
        "eglence": "Eğlence", "saglik": "Sağlık", "fatura": "Fatura",
        "giyim": "Giyim", "nakit_atm": "Nakit/ATM", "transfer": "Transfer",
        "iade": "İade", "vergi": "Vergi", "teknoloji": "Teknoloji",
        "diger": "Diğer", "egitim": "Eğitim",
    },
    "en": {
        "market": "Groceries", "restoran": "Dining", "ulasim": "Transport",
        "eglence": "Entertainment", "saglik": "Health", "fatura": "Bills",
        "giyim": "Clothing", "nakit_atm": "Cash/ATM", "transfer": "Transfer",
        "iade": "Refund", "vergi": "Tax", "teknoloji": "Technology",
        "diger": "Other", "egitim": "Education",
    },
}


def _label(slug: str, lang: str) -> str:
    table = _CATEGORY_LABELS.get(lang, _CATEGORY_LABELS["en"])
    return table.get(slug, table.get("diger", slug))


def _fmt(amount: float, currency: str) -> str:
    """Plain money string for the template/LLM facts (no locale formatter on backend)."""
    return f"{amount:,.0f} {currency}"


async def _fetch_batch(
    job_id: str, user_id: uuid.UUID, session: AsyncSession
) -> list[Transaction]:
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .where(Transaction.upload_batch_id == job_id)
        .order_by(Transaction.transaction_date.asc())
    )
    return list(result.scalars().all())


def _recurring_monthly_equiv(sub: dict) -> Decimal:
    """Normalise a subscription's avg amount to a monthly figure."""
    try:
        avg = Decimal(str(sub.get("avg_amount", "0")))
    except Exception:  # noqa: BLE001
        return Decimal("0")
    return avg * 4 if sub.get("frequency") == "weekly" else avg


async def _build_recurring_signal(
    user_id: uuid.UUID, session: AsyncSession, currency: str, lang: str
) -> dict:
    """
    Strongest recurring pattern across all batches: total monthly commitment +
    a one-line highlight naming the single largest recurring item.
    """
    try:
        subscriptions, installments = await analyze_recurring(user_id, session)
    except Exception as exc:  # noqa: BLE001 — recurring is best-effort, never blocks the brief
        logger.warning("Brief: recurring analysis failed: %s", exc)
        return {"monthly_total": 0.0, "highlight": None}

    monthly = Decimal("0")
    for s in subscriptions:
        monthly += _recurring_monthly_equiv(s)
    for p in installments:
        monthly += Decimal(str(p.get("monthly_amount", 0)))

    # Highlight = largest single monthly commitment (subscription or installment).
    candidates: list[tuple[Decimal, str, str]] = []  # (monthly_amount, merchant, kind)
    for s in subscriptions:
        candidates.append((_recurring_monthly_equiv(s), s.get("merchant", "—"), "subscription"))
    for p in installments:
        candidates.append((Decimal(str(p.get("monthly_amount", 0))), p.get("merchant", "—"), "installment"))

    highlight = None
    if candidates:
        candidates.sort(key=lambda c: c[0], reverse=True)
        amt, merchant, kind = candidates[0]
        n = len(candidates)
        if lang == "tr":
            kind_word = "abonelik/taksit" if n > 1 else ("taksit" if kind == "installment" else "abonelik")
            highlight = (
                f"En büyük düzenli ödemen {merchant} ({_fmt(float(amt), currency)}/ay)."
                + (f" Toplam {n} düzenli {kind_word} ödemen var." if n > 1 else "")
            )
        else:
            kind_word = "recurring commitments" if n > 1 else ("installment" if kind == "installment" else "subscription")
            highlight = (
                f"Your largest recurring payment is {merchant} ({_fmt(float(amt), currency)}/mo)."
                + (f" You have {n} {kind_word} in total." if n > 1 else "")
            )

    return {"monthly_total": round(float(monthly), 2), "highlight": highlight}


def _choose_action(net: float, monthly_total: float, lang: str) -> dict:
    """One concrete next move, deterministic. Returns {key, label, href}."""
    if net < 0 and monthly_total > 0:
        key, href = "review_recurring", "/recurring"
    elif net < 0:
        key, href = "set_goal", "/progress"
    elif monthly_total > 0:
        key, href = "review_recurring", "/recurring"
    else:
        key, href = "add_asset", "/networth?add=asset"

    labels = {
        "tr": {
            "review_recurring": "Düzenli ödemelerini gözden geçir",
            "set_goal": "Bir harcama hedefi belirle",
            "add_asset": "Net değerini takip etmeye başla",
        },
        "en": {
            "review_recurring": "Review your recurring payments",
            "set_goal": "Set a spending goal",
            "add_asset": "Start tracking your net worth",
        },
    }
    label = labels.get(lang, labels["en"])[key]
    return {"key": key, "label": label, "href": href}


_NARRATIVE_SYSTEM = """\
You are Mizan, a warm, sharp global personal finance assistant.
You just read one of the user's bank statements. Write a SINGLE short paragraph
(3–4 sentences) telling them what is actually happening in their money this period.
Preferred language: {language_name}. You MUST respond in that language.

Rules:
- Reference the real numbers you are given — be specific, not generic.
- Lead with the flow (in vs out), then where money went, then the pattern that matters.
- Warm and observational, never judgmental, never alarmist. No investment/securities advice.
- One paragraph only. No bullet points, no headings, no preamble, no disclaimers.
"""


def _narrative_facts(
    period: dict, flow: dict, top_categories: list[dict],
    largest: dict | None, recurring: dict, lang: str,
) -> str:
    ccy = flow["currency"]
    lines = [
        f"Period: {period['start']} to {period['end']} ({period['transaction_count']} transactions).",
        f"Income: {_fmt(flow['income'], ccy)}. Expenses: {_fmt(flow['expenses'], ccy)}. "
        f"Net: {_fmt(flow['net'], ccy)}.",
    ]
    if top_categories:
        cats = ", ".join(
            f"{_label(c['name'], lang)} {_fmt(c['amount'], ccy)} ({c['share']:.0f}%)"
            for c in top_categories
        )
        lines.append(f"Top spending: {cats}.")
    if largest:
        lines.append(f"Largest single transaction: {largest['description']} {_fmt(largest['amount'], ccy)}.")
    if recurring.get("monthly_total"):
        lines.append(f"Recurring monthly commitments: {_fmt(recurring['monthly_total'], ccy)}.")
    if recurring.get("highlight"):
        lines.append(f"Recurring note: {recurring['highlight']}")
    return "\n".join(lines)


def _template_narrative(
    flow: dict, top_categories: list[dict], lang: str
) -> str:
    """Deterministic fallback paragraph when no LLM key is available."""
    ccy = flow["currency"]
    top = top_categories[0] if top_categories else None
    if lang == "tr":
        s = (
            f"Bu dönemde {_fmt(flow['income'], ccy)} giriş, {_fmt(flow['expenses'], ccy)} çıkış oldu — "
            + (
                f"yani {_fmt(abs(flow['net']), ccy)} fazla verdin."
                if flow["net"] >= 0
                else f"yani {_fmt(abs(flow['net']), ccy)} açık verdin."
            )
        )
        if top:
            s += f" En çok harcama {_label(top['name'], lang)} kategorisinde ({_fmt(top['amount'], ccy)})."
        s += " Aşağıda neyin öne çıktığını ve atabileceğin tek adımı bulacaksın."
        return s
    s = (
        f"This period {_fmt(flow['income'], ccy)} came in and {_fmt(flow['expenses'], ccy)} went out — "
        + (
            f"a surplus of {_fmt(abs(flow['net']), ccy)}."
            if flow["net"] >= 0
            else f"a shortfall of {_fmt(abs(flow['net']), ccy)}."
        )
    )
    if top:
        s += f" Your biggest spending was {_label(top['name'], lang)} ({_fmt(top['amount'], ccy)})."
    s += " Below is what stood out and the one move worth making next."
    return s


def _generate_narrative(facts: str, lang: str) -> str | None:
    if not (len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0):
        return None
    try:
        provider = get_provider()
        system = _NARRATIVE_SYSTEM.format(language_name=_LANGUAGE_NAMES.get(lang, "English"))
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": f"Here is what the statement showed:\n{facts}"},
            ],
            temperature=0.7,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or None
    except Exception as exc:  # noqa: BLE001 — narrative is best-effort, template covers it
        logger.warning("Brief narrative LLM failed: %s", exc)
        return None


async def build_brief(
    job_id: str, user_id: uuid.UUID, session: AsyncSession, lang: str = "tr"
) -> dict | None:
    """
    Assemble the structured brief for one upload batch. Returns None when the batch
    has no transactions (caller → 404 → frontend falls back to /transactions).
    """
    txs = await _fetch_batch(job_id, user_id, session)
    if not txs:
        return None

    debits = [t for t in txs if t.transaction_type == "debit"]
    credits = [t for t in txs if t.transaction_type == "credit"]

    # Dominant currency of the batch (statements are effectively single-currency; no
    # cross-currency conversion in the brief — totals stay in the recorded currency).
    currency = Counter(t.currency or "TRY" for t in txs).most_common(1)[0][0]

    income = float(sum((t.amount for t in credits), Decimal("0")))
    expenses = float(sum((t.amount for t in debits), Decimal("0")))
    net = round(income - expenses, 2)

    dates = [t.transaction_date for t in txs]
    period = {
        "start": min(dates).isoformat(),
        "end": max(dates).isoformat(),
        "transaction_count": len(txs),
    }
    flow = {
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "net": net,
        "currency": currency,
    }

    # Top 3 spending categories by total debit.
    cat_totals: dict[str, Decimal] = {}
    for t in debits:
        cat = t.category or "diger"
        cat_totals[cat] = cat_totals.get(cat, Decimal("0")) + t.amount
    total_debit = sum(cat_totals.values()) or Decimal("1")
    top_categories = [
        {
            "name": slug,
            "amount": round(float(amt), 2),
            "share": round(float(amt / total_debit * 100), 1),
        }
        for slug, amt in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)[:3]
    ]

    largest_transaction = None
    if debits:
        big = max(debits, key=lambda t: t.amount)
        largest_transaction = {
            "description": (big.description or "—").strip()[:80],
            "amount": round(float(big.amount), 2),
            "type": big.transaction_type,
        }

    recurring_signal = await _build_recurring_signal(user_id, session, currency, lang)
    suggested_action = _choose_action(net, recurring_signal["monthly_total"], lang)

    facts = _narrative_facts(period, flow, top_categories, largest_transaction, recurring_signal, lang)
    # Run the blocking synchronous LLM call off the event loop so it can't starve
    # asyncpg between awaits (→ MissingGreenlet). Template fallback when it returns None.
    narrative = await asyncio.to_thread(_generate_narrative, facts, lang) or _template_narrative(flow, top_categories, lang)

    logger.info(
        "Brief built — user=%s job_id=%s txs=%d net=%.0f %s",
        user_id, job_id, len(txs), net, currency,
    )

    return {
        "job_id": job_id,
        "period": period,
        "flow": flow,
        "top_categories": top_categories,
        "largest_transaction": largest_transaction,
        "recurring_signal": recurring_signal,
        "suggested_action": suggested_action,
        "narrative": narrative,
    }
