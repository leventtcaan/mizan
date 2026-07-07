"""
WHAT: Builds the weekly "money brief" email payload — one financial truth + supporting
      bullets + one action — from the last 30 days of a user's activity.
WHY: The Post-Upload Brief (services/brief.py) is a one-shot moment; this is the
      recurring counterpart that reaches OUT to the user and gives them a reason to
      come back. It deliberately leads with what's NEW (spend swing, net-worth move,
      budget-goal breach, a receivable due soon). When nothing meaningful changed it
      returns None so we never train people to ignore a same-every-week email.
BREAKS IF REMOVED: The weekly email job/endpoint has no content to send.
"""

import asyncio
import logging
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.liability import Liability
from app.models.networth_snapshot import NetworthSnapshot
from app.models.receivable import Receivable
from app.models.transaction import Transaction
from app.models.user import User
# Reuse the Post-Upload Brief engine: recurring detection, LLM narration, category labels.
from app.services.brief import _build_recurring_signal, _generate_narrative, _label
from app.services.weekly_summary import _fetch_period, _goal_status

logger = logging.getLogger(__name__)

# A metric must move at least this much (percent) to count as "something happened".
_MEANINGFUL_PCT = 5.0
_BRIEF_DAYS = 30
_CADENCE_DAYS = 6  # don't re-send within this window


def _money(amount: float, ccy: str) -> str:
    return f"{amount:,.0f} {ccy}"


def _debit_total(txs: list[Transaction]) -> Decimal:
    return sum((t.amount for t in txs if t.transaction_type == "debit"), Decimal("0"))


def _credit_total(txs: list[Transaction]) -> Decimal:
    return sum((t.amount for t in txs if t.transaction_type == "credit"), Decimal("0"))


async def _fetch_snapshots(user_id: uuid.UUID, session: AsyncSession) -> list[NetworthSnapshot]:
    result = await session.execute(
        select(NetworthSnapshot)
        .where(NetworthSnapshot.user_id == user_id)
        .order_by(NetworthSnapshot.recorded_at.asc())
    )
    return list(result.scalars().all())


async def _upcoming_receivables(
    user_id: uuid.UUID, today: date, session: AsyncSession
) -> list[Receivable]:
    horizon = today + timedelta(days=7)
    result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status.in_(("pending", "overdue")),
            Receivable.expected_date.is_not(None),
            Receivable.expected_date <= horizon,
        )
    )
    return list(result.scalars().all())


async def _upcoming_liability_payments(
    user_id: uuid.UUID, today: date, session: AsyncSession
) -> list[tuple[Liability, int]]:
    """Liabilities with a monthly payment + due date whose NEXT payment falls within the
    next 7 days. Returns (liability, days_until) sorted soonest-first."""
    from app.services.notification_service import _next_payment_date

    result = await session.execute(
        select(Liability).where(Liability.user_id == user_id)
    )
    out: list[tuple[Liability, int]] = []
    for l in result.scalars().all():
        if not l.monthly_payment or l.monthly_payment <= 0 or not l.due_date:
            continue
        if l.remaining_amount is not None and l.remaining_amount <= 0:
            continue
        next_due = _next_payment_date(l.due_date, today)
        if getattr(l, "end_date", None) is not None and next_due > l.end_date:
            continue  # loan already paid off
        days_until = (next_due - today).days
        if 0 <= days_until <= 7:
            out.append((l, days_until))
    out.sort(key=lambda x: x[1])
    return out


def _subject(lang: str, spend_var: float, nw_pct: float | None, currency: str) -> str:
    if lang == "tr":
        if nw_pct is not None and abs(nw_pct) >= _MEANINGFUL_PCT:
            dir_ = "arttı" if nw_pct > 0 else "azaldı"
            return f"Clarifin · Net değerin %{abs(nw_pct):.0f} {dir_}"
        if abs(spend_var) >= _MEANINGFUL_PCT:
            dir_ = "arttı" if spend_var > 0 else "azaldı"
            return f"Clarifin · Harcaman %{abs(spend_var):.0f} {dir_}"
        return "Clarifin · Bu haftaki para brifing'in"
    if nw_pct is not None and abs(nw_pct) >= _MEANINGFUL_PCT:
        dir_ = "up" if nw_pct > 0 else "down"
        return f"Clarifin · Your net worth is {dir_} {abs(nw_pct):.0f}%"
    if abs(spend_var) >= _MEANINGFUL_PCT:
        dir_ = "up" if spend_var > 0 else "down"
        return f"Clarifin · Your spending is {dir_} {abs(spend_var):.0f}%"
    return "Clarifin · Your money brief this week"


def _template_headline(lang: str, income: float, expenses: float, net: float, currency: str) -> str:
    if lang == "tr":
        lead = (
            f"Son 30 günde {_money(income, currency)} giriş, {_money(expenses, currency)} çıkış oldu — "
            + (f"{_money(abs(net), currency)} fazla verdin." if net >= 0 else f"{_money(abs(net), currency)} açık verdin.")
        )
        return lead + " İşte öne çıkanlar."
    lead = (
        f"Over the last 30 days {_money(income, currency)} came in and {_money(expenses, currency)} went out — "
        + (f"a {_money(abs(net), currency)} surplus." if net >= 0 else f"a {_money(abs(net), currency)} shortfall.")
    )
    return lead + " Here's what stood out."


async def generate_email_brief(user_id: uuid.UUID, session: AsyncSession) -> dict | None:
    """
    Build the weekly money-brief payload, or None when nothing meaningful changed.
    Returns {subject, headline, bullets[<=3], cta_label, cta_url, lang}.
    """
    from app.core.config import settings  # local import keeps the service import-light

    user = await session.get(User, user_id)
    if user is None:
        return None
    lang = (user.language or "tr").lower()

    today = date.today()
    cur_start = today - timedelta(days=_BRIEF_DAYS)
    prev_start = today - timedelta(days=_BRIEF_DAYS * 2)
    prev_end = cur_start - timedelta(days=1)

    cur = await _fetch_period(user_id, cur_start, today, session)
    prev = await _fetch_period(user_id, prev_start, prev_end, session)

    cur_debit = float(_debit_total(cur))
    prev_debit = float(_debit_total(prev))
    income = float(_credit_total(cur))
    net = round(income - cur_debit, 2)
    currency = Counter(t.currency or "TRY" for t in cur).most_common(1)[0][0] if cur else (user.display_currency or "TRY")

    if prev_debit > 0:
        spend_var = (cur_debit - prev_debit) / prev_debit * 100
    elif cur_debit > 0:
        spend_var = 100.0
    else:
        spend_var = 0.0

    # Net-worth move from snapshots: latest vs the earliest snapshot ≥25 days older.
    nw_pct: float | None = None
    snaps = await _fetch_snapshots(user_id, session)
    if len(snaps) >= 2:
        latest = snaps[-1]
        cutoff = latest.recorded_at - timedelta(days=25)
        ref = next((s for s in snaps if s.recorded_at <= cutoff), snaps[0])
        prev_nw = float(ref.net_worth_usd)
        cur_nw = float(latest.net_worth_usd)
        if abs(prev_nw) > 0:
            nw_pct = (cur_nw - prev_nw) / abs(prev_nw) * 100

    # Budget goals breaching this calendar month.
    month_start = date(today.year, today.month, 1)
    month_txs = [t for t in cur if t.transaction_date >= month_start]
    goals = await _goal_status(user_id, month_txs, session)
    flagged = [g for g in goals if g["status"] in ("warning", "exceeded")]

    # Recurring commitments (reuse the brief engine).
    recurring = await _build_recurring_signal(user_id, session, currency, lang)

    # Receivables coming due in the next 7 days.
    upcoming = await _upcoming_receivables(user_id, today, session)

    # Liability payments coming due in the next 7 days.
    upcoming_liab = await _upcoming_liability_payments(user_id, today, session)

    # --- meaningful-change gate: only these "NEW/timely" signals count ---
    spend_ok = abs(spend_var) >= _MEANINGFUL_PCT
    nw_ok = nw_pct is not None and abs(nw_pct) >= _MEANINGFUL_PCT
    goals_ok = len(flagged) > 0
    recv_ok = len(upcoming) > 0
    liab_ok = len(upcoming_liab) > 0
    logger.info(
        "Email brief gate — user=%s cur_txs=%d prev_txs=%d | spend_var=%.1f%% (pass=%s) "
        "nw_pct=%s (pass=%s) goals_breached=%d (pass=%s) receivables_due=%d (pass=%s)",
        user_id, len(cur), len(prev),
        spend_var, spend_ok,
        f"{nw_pct:.1f}%" if nw_pct is not None else "n/a (need ≥2 snapshots)", nw_ok,
        len(flagged), goals_ok,
        len(upcoming), recv_ok,
    )
    logger.info("Email brief gate — user=%s liability_payments_due=%d (pass=%s)", user_id, len(upcoming_liab), liab_ok)
    meaningful = spend_ok or nw_ok or goals_ok or recv_ok or liab_ok
    if not meaningful:
        logger.info(
            "Email brief SKIPPED (no meaningful change) — user=%s: spend<%.0f%% AND "
            "net_worth<%.0f%% AND no goals breached AND no receivables due in 7d",
            user_id, _MEANINGFUL_PCT, _MEANINGFUL_PCT,
        )
        return None

    # --- bullets, prioritized, then padded with baseline facts up to 3 ---
    bullets: list[str] = []

    if abs(spend_var) >= _MEANINGFUL_PCT:
        if lang == "tr":
            d = "arttı" if spend_var > 0 else "azaldı"
            bullets.append(f"Harcaman geçen 30 güne göre %{abs(spend_var):.0f} {d} ({_money(cur_debit, currency)}).")
        else:
            d = "up" if spend_var > 0 else "down"
            bullets.append(f"Your spending is {d} {abs(spend_var):.0f}% vs the prior 30 days ({_money(cur_debit, currency)}).")

    if nw_pct is not None and abs(nw_pct) >= _MEANINGFUL_PCT:
        if lang == "tr":
            d = "arttı" if nw_pct > 0 else "azaldı"
            bullets.append(f"Net değerin son ~30 günde %{abs(nw_pct):.0f} {d}.")
        else:
            d = "rose" if nw_pct > 0 else "fell"
            bullets.append(f"Your net worth {d} {abs(nw_pct):.0f}% over the last ~30 days.")

    if flagged:
        g = flagged[0]
        label = _label(g["category"], lang)
        if lang == "tr":
            word = "aşıldı" if g["status"] == "exceeded" else "sınıra yaklaştı"
            bullets.append(f"{label} bütçen {word} (%{g['pct_used']:.0f}).")
        else:
            word = "exceeded" if g["status"] == "exceeded" else "near its limit"
            bullets.append(f"Your {label} budget is {word} ({g['pct_used']:.0f}%).")

    if upcoming:
        nearest = min(upcoming, key=lambda r: r.expected_date or today)
        if lang == "tr":
            bullets.append(f"{len(upcoming)} alacak önümüzdeki 7 günde bekleniyor — en yakını: {nearest.from_person}.")
        else:
            bullets.append(f"{len(upcoming)} receivable(s) due in the next 7 days — soonest: {nearest.from_person}.")

    if upcoming_liab:
        liab, days = upcoming_liab[0]
        pay = _money(float(liab.monthly_payment or 0), liab.currency)
        if lang == "tr":
            when = "bugün" if days == 0 else "yarın" if days == 1 else f"{days} gün içinde"
            extra = f" (+{len(upcoming_liab) - 1} ödeme daha)" if len(upcoming_liab) > 1 else ""
            bullets.append(f"{liab.name} ödemesi {when}: {pay}{extra}.")
        else:
            when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
            extra = f" (+{len(upcoming_liab) - 1} more payment(s))" if len(upcoming_liab) > 1 else ""
            bullets.append(f"{liab.name} payment due {when}: {pay}{extra}.")

    if recurring.get("highlight"):
        bullets.append(recurring["highlight"])

    # Baseline fillers so the email always carries 3 concrete lines.
    if cur:
        cat_totals: dict[str, Decimal] = {}
        for t in cur:
            if t.transaction_type == "debit":
                cat_totals[t.category or "diger"] = cat_totals.get(t.category or "diger", Decimal("0")) + t.amount
        top_cat = max(cat_totals, key=lambda k: cat_totals[k]) if cat_totals else None
        fillers: list[str] = []
        if top_cat:
            if lang == "tr":
                fillers.append(f"En çok harcama {_label(top_cat, lang)} kategorisinde ({_money(float(cat_totals[top_cat]), currency)}).")
            else:
                fillers.append(f"Your biggest category was {_label(top_cat, lang)} ({_money(float(cat_totals[top_cat]), currency)}).")
        if lang == "tr":
            fillers.append(f"Bu dönem net sonucun {_money(net, currency)}.")
        else:
            fillers.append(f"Your net result this period is {_money(net, currency)}.")
        for f in fillers:
            if len(bullets) >= 3:
                break
            bullets.append(f)

    bullets = bullets[:3]

    # --- headline: reuse the brief's LLM narrator, fall back to a template one-liner ---
    if lang == "tr":
        facts = (
            f"Dönem: son 30 gün. Gelir: {_money(income, currency)}. Gider: {_money(cur_debit, currency)}. "
            f"Net: {_money(net, currency)}. Harcama değişimi: %{spend_var:.0f}."
            + (f" Net değer değişimi: %{nw_pct:.0f}." if nw_pct is not None else "")
        )
    else:
        facts = (
            f"Period: last 30 days. Income: {_money(income, currency)}. Expenses: {_money(cur_debit, currency)}. "
            f"Net: {_money(net, currency)}. Spending change: {spend_var:.0f}%."
            + (f" Net worth change: {nw_pct:.0f}%." if nw_pct is not None else "")
        )
    # _generate_narrative makes a BLOCKING synchronous LLM HTTP call. Run it off the
    # event loop: in this batch path we loop many users, and a blocking call on the
    # loop starves asyncpg's connection between awaits → the next DB op raises
    # MissingGreenlet ("greenlet_spawn has not been called"). to_thread keeps the loop free.
    narrative = await asyncio.to_thread(_generate_narrative, facts, lang)
    headline = narrative or _template_headline(lang, income, cur_debit, net, currency)

    cta_label = "Detayları gör →" if lang == "tr" else "See the details →"
    cta_url = f"{settings.FRONTEND_URL}/home"

    logger.info("Email brief generated — user=%s bullets=%d", user_id, len(bullets))
    return {
        "subject": _subject(lang, spend_var, nw_pct, currency),
        "headline": headline,
        "bullets": bullets,
        "cta_label": cta_label,
        "cta_url": cta_url,
        "lang": lang,
    }


def due_for_brief(user: User, now: datetime | None = None) -> bool:
    """Shared cadence rule used by the scheduler job and the manual trigger endpoint."""
    if not user.email_weekly_enabled:
        return False
    now = now or datetime.now(timezone.utc)
    last = user.last_email_brief_sent
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last < timedelta(days=_CADENCE_DAYS):
            return False
    return True


async def run_email_briefs() -> dict:
    """
    WHAT: Send the weekly money brief to every due, opted-in user. The single canonical
          batch implementation behind both the scheduler job and the manual endpoint.
    WHY: Each user is processed in its OWN AsyncSession (fresh connection lifecycle),
         mirroring the reconciliation/notification jobs. The earlier version reused one
         request-scoped session across the whole loop with in-loop commits, which broke
         the async connection lifecycle and surfaced as MissingGreenlet at pool.connect().
         Per-user isolation also means one user's failure can't poison the others.
    """
    # Lazy imports: keep this service free of api/core import cycles at module load.
    from app.core.database import AsyncSessionLocal
    from app.api.email import send_email_brief

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User.id).where(User.email_weekly_enabled == True)  # noqa: E712
        )
        user_ids = [row[0] for row in result.all()]

    logger.info("Email briefs: scanning %d opted-in user(s)", len(user_ids))
    sent = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    for uid in user_ids:
        try:
            async with AsyncSessionLocal() as session:
                user = await session.get(User, uid)
                if user is None:
                    logger.info("Email brief skipped — user=%s no longer exists", uid)
                    skipped += 1
                    continue
                # Weekly brief is a PAID feature (sold under Plus) — and deleted
                # accounts must never receive mail.
                from app.core.plans import is_paid
                if user.is_deleted or not is_paid(user):
                    skipped += 1
                    continue
                due = due_for_brief(user, now)
                logger.info(
                    "Email brief — user=%s email=%s due_for_brief=%s (last_sent=%s)",
                    uid, user.email, due, user.last_email_brief_sent,
                )
                if not due:
                    logger.info("Email brief SKIPPED — user=%s: not due (cadence/disabled)", user.email)
                    skipped += 1
                    continue
                brief = await generate_email_brief(uid, session)
                logger.info(
                    "Email brief — user=%s brief=%s",
                    user.email, "dict" if brief is not None else "None (gate failed)",
                )
                if brief is None:
                    skipped += 1
                    continue
                await send_email_brief(user.email, brief, brief["lang"])
                user.last_email_brief_sent = datetime.now(timezone.utc)
                session.add(user)
                await session.commit()
                logger.info("Email brief SENT — user=%s", user.email)
                sent += 1
        except Exception:
            logger.exception("Email brief FAILED — user=%s", uid)
            skipped += 1

    logger.info("Email briefs: sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}
