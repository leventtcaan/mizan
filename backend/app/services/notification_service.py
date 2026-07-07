"""
Daily notification generation — single implementation, two callers.

WHY: The POST /notifications/generate-daily endpoint and the APScheduler job
must produce identical notifications. DRY: this service holds the logic; the
endpoint and the scheduler both call generate_for_user().
"""

import asyncio
import calendar
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.plans import is_paid, is_pro
from app.models.app_notification import AppNotification
from app.models.asset import Asset
from app.models.budget_goal import BudgetGoal
from app.models.liability import Liability
from app.models.receivable import Receivable
from app.models.transaction import Transaction
from app.models.user import User
from app.models.wealth_alert import WealthAlert

logger = logging.getLogger(__name__)


def _days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _next_payment_date(due_date: date, today: date) -> date:
    """Return the next occurrence of the monthly payment day."""
    day = due_date.day
    candidate = today.replace(day=min(day, _days_in_month(today.year, today.month)))
    if candidate < today:
        m = today.month + 1
        y = today.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        candidate = date(y, m, min(day, _days_in_month(y, m)))
    return candidate


def _last_payment_date(due_date: date, today: date) -> date:
    """The most recent occurrence of the monthly payment day on/before today."""
    day = due_date.day
    candidate = today.replace(day=min(day, _days_in_month(today.year, today.month)))
    if candidate > today:
        m = today.month - 1
        y = today.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        candidate = date(y, m, min(day, _days_in_month(y, m)))
    return candidate


async def _has_blocking_action(
    session: AsyncSession, user_id: uuid.UUID, action_type: str,
    match: dict, within_days: int, block_states: tuple[str, ...],
) -> bool:
    """True if a proactive notification of this action_type already exists for the user
    within `within_days`, matching `match` keys, and in one of `block_states` — used to
    avoid re-asking the same question. (A "dismissed" follow-up is NOT blocking, so a
    rescheduled question can fire again on the next daily run.)"""
    since = datetime.now(timezone.utc) - timedelta(days=within_days)
    rows = (await session.execute(
        select(AppNotification).where(
            AppNotification.user_id == user_id,
            AppNotification.action_type == action_type,
            AppNotification.created_at >= since,
        )
    )).scalars().all()
    for n in rows:
        if n.action_state not in block_states:
            continue
        try:
            d = json.loads(n.action_data or "{}")
        except Exception:
            d = {}
        if all(str(d.get(k)) == str(v) for k, v in match.items()):
            return True
    return False


_WORD_RE = re.compile(r"[^a-z0-9]+")


def _norm_desc(desc: str) -> str:
    return _WORD_RE.sub(" ", (desc or "").lower()).strip()[:24]


async def _detect_recurring_income_this_month(
    user_id: uuid.UUID, today: date, session: AsyncSession
) -> tuple[bool, float, str]:
    """Did a recurring income (salary-like) land THIS calendar month? Groups credit
    transactions over ~120 days by a normalized description; a group seen in ≥2 distinct
    months that also has an occurrence this month counts. Returns (found, amount, currency)."""
    since = today - timedelta(days=120)
    rows = (await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == "credit",
            Transaction.transaction_date >= since,
        )
    )).scalars().all()
    month_key = (today.year, today.month)
    groups: dict[str, dict] = {}
    for t in rows:
        key = _norm_desc(t.description)
        if not key:
            continue
        g = groups.setdefault(key, {"months": set(), "this_month": None})
        g["months"].add((t.transaction_date.year, t.transaction_date.month))
        if (t.transaction_date.year, t.transaction_date.month) == month_key:
            # Keep the largest current-month occurrence as the representative amount.
            if g["this_month"] is None or float(t.amount) > g["this_month"][0]:
                g["this_month"] = (float(t.amount), t.currency or "TRY")
    best: tuple[float, str] | None = None
    for g in groups.values():
        if len(g["months"]) >= 2 and g["this_month"] is not None:
            if best is None or g["this_month"][0] > best[0]:
                best = g["this_month"]
    if best is None:
        return False, 0.0, "TRY"
    return True, best[0], best[1]


async def _last_statement_upload(user_id: uuid.UUID, session: AsyncSession) -> datetime | None:
    """Most recent statement-upload time (transactions carrying an upload_batch_id)."""
    rows = (await session.execute(
        select(Transaction.created_at)
        .where(Transaction.user_id == user_id, Transaction.upload_batch_id.is_not(None))
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )).first()
    return rows[0] if rows else None


async def _proactive_triggers(
    user_id: uuid.UUID, today: date, lang: str,
    liabilities, overdue_receivables, session: AsyncSession,
) -> list[dict]:
    """Smart, actionable "Mim" questions — PRO tier only. Each is deduped so the user
    isn't re-asked the same thing. Returns notification dicts (with action_* fields)."""
    tr = lang != "en"
    out: list[dict] = []

    # ── 1. Liability payment follow-up: the payment day just passed (0–2 days ago) ──
    for l in liabilities:
        if not l.monthly_payment or l.monthly_payment <= 0 or not l.due_date:
            continue
        if l.remaining_amount is not None and l.remaining_amount <= 0:
            continue
        last_pay = _last_payment_date(l.due_date, today)
        if getattr(l, "end_date", None) is not None and last_pay > l.end_date:
            continue  # loan already finished
        days_since = (today - last_pay).days
        if not (0 <= days_since <= 2):
            continue
        period = last_pay.isoformat()
        amt = float(l.monthly_payment)
        # Skip if we already asked AND it's pending or resolved for this exact payment.
        # A "dismissed" (user said "not yet") does NOT block → we re-ask next day.
        if await _has_blocking_action(
            session, user_id, "liability_payment_followup",
            {"liability_id": str(l.id), "period": period}, 40, ("pending", "resolved"),
        ):
            continue
        out.append({
            "title": "Did you make your payment?" if not tr else "Ödemeni yaptın mı?",
            "message": (f"Your {l.name} payment of {amt:.2f} {l.currency} was due. Did you pay it?"
                        if not tr else
                        f"{l.name} için {amt:.2f} {l.currency} ödemen gelmişti. Ödedin mi?"),
            "type": "alert",
            "action_type": "liability_payment_followup",
            "action_data": {"liability_id": str(l.id), "amount": amt, "currency": l.currency, "period": period},
            "action_state": "pending",
        })

    # ── 2. Recurring income landed this month → nudge toward savings ──
    found, inc_amt, inc_ccy = await _detect_recurring_income_this_month(user_id, today, session)
    if found:
        period = f"{today.year:04d}-{today.month:02d}"
        if not await _has_blocking_action(
            session, user_id, "set_savings", {"period": period}, 31,
            ("pending", "resolved", "dismissed"),
        ):
            out.append({
                "title": "Set aside some savings?" if not tr else "Biraz kenara koyalım mı?",
                "message": (f"Income landed this month ({inc_amt:.0f} {inc_ccy}). Want to set aside some savings?"
                            if not tr else
                            f"Bu ay gelir geldi ({inc_amt:.0f} {inc_ccy}). Biraz tasarruf ayıralım mı?"),
                "type": "info",
                "action_type": "set_savings",
                "action_data": {"period": period, "amount": inc_amt, "currency": inc_ccy},
                "action_state": "pending",
            })

    # ── 3. Overdue receivable → offer to chase it ──
    for r in overdue_receivables:
        if await _has_blocking_action(
            session, user_id, "remind_receivable", {"receivable_id": str(r.id)}, 7,
            ("pending", "resolved", "dismissed"),
        ):
            continue
        out.append({
            "title": "Chase this payment?" if not tr else "Bu ödemeyi hatırlatalım mı?",
            "message": (f"You haven't received {float(r.amount):.2f} {r.currency} from {r.from_person}. Should I remind you?"
                        if not tr else
                        f"{r.from_person} kişisinden {float(r.amount):.2f} {r.currency} alacağın var. Hatırlatayım mı?"),
            "type": "warning",
            "action_type": "remind_receivable",
            "action_data": {"receivable_id": str(r.id), "name": r.from_person},
            "action_state": "pending",
        })

    # ── 4. No statement uploaded in 30+ days → data may be stale ──
    last_upload = await _last_statement_upload(user_id, session)
    if last_upload is not None:
        if last_upload.tzinfo is None:
            last_upload = last_upload.replace(tzinfo=timezone.utc)
        days_stale = (datetime.now(timezone.utc) - last_upload).days
        if days_stale >= 30 and not await _has_blocking_action(
            session, user_id, "upload_statement", {}, 14,
            ("pending", "resolved", "dismissed"),
        ):
            out.append({
                "title": "Is your data current?" if not tr else "Verilerin güncel mi?",
                "message": (f"It's been {days_stale} days since your last statement. Want to upload a fresh one?"
                            if not tr else
                            f"Son ekstrenden bu yana {days_stale} gün geçti. Yeni bir ekstre yükleyelim mi?"),
                "type": "info",
                "action_type": "upload_statement",
                "action_data": {"days_stale": days_stale},
                "action_state": "pending",
            })

    return out


async def generate_for_user(user_id: uuid.UUID, lang: str, session: AsyncSession) -> dict:
    """
    Generate daily financial notifications for one user.
    Skips if already run today (UTC). Max one run per UTC day per user.
    Commits the session. Returns {"created": int, "skipped": bool, ...}.
    """
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    existing = await session.execute(
        select(AppNotification).where(
            AppNotification.user_id == user_id,
            AppNotification.created_at >= today_start,
        ).limit(1)
    )
    if existing.scalar_one_or_none():
        return {"created": 0, "skipped": True, "reason": "already_generated_today"}

    notifications: list[dict] = []
    today = date.today()

    user = await session.get(User, user_id)
    paid = is_paid(user) if user is not None else False   # plus OR pro (daily LLM insight)
    pro = is_pro(user) if user is not None else False     # pro only (proactive Mim)

    # 1. Overdue receivables. Free + Plus get a plain warning; Pro users instead get the
    #    actionable "should I remind them?" question in the proactive section below.
    recv_result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status.in_(["pending", "overdue"]),
        )
    )
    receivables = list(recv_result.scalars().all())
    overdue_receivables = [r for r in receivables if r.expected_date and r.expected_date < today]
    if not pro:
        for r in overdue_receivables:
            days_late = (today - r.expected_date).days
            notifications.append({
                "title": "Overdue Receivable" if lang == "en" else "Vadesi Geçmiş Alacak",
                "message": f"{r.from_person}: {float(r.amount):.2f} {r.currency} — {days_late} days overdue" if lang == "en"
                    else f"{r.from_person}: {float(r.amount):.2f} {r.currency} — {days_late} gün gecikmiş",
                "type": "warning",
            })

    # 2. Upcoming liability payments (within 7 days)
    liab_result = await session.execute(
        select(Liability).where(Liability.user_id == user_id)
    )
    liabilities = liab_result.scalars().all()
    for l in liabilities:
        if l.monthly_payment and l.due_date:
            next_due = _next_payment_date(l.due_date, today)
            # Don't warn for a loan that's already past its final payment month.
            if getattr(l, "end_date", None) is not None and next_due > l.end_date:
                continue
            days_until = (next_due - today).days
            # Per-liability reminder lead time (column default 7). The user picks how many
            # days before each payment they want to be warned.
            lead = l.reminder_days if getattr(l, "reminder_days", None) is not None else 7
            if 0 <= days_until <= lead:
                if days_until == 0:
                    when = "due today" if lang == "en" else "bugün ödenecek"
                elif days_until == 1:
                    when = "due tomorrow" if lang == "en" else "yarın ödenecek"
                else:
                    when = (f"due in {days_until} days" if lang == "en"
                            else f"{days_until} gün içinde ödenecek")
                notifications.append({
                    "title": "Upcoming Payment" if lang == "en" else "Yaklaşan Ödeme",
                    "message": f"{l.name}: {float(l.monthly_payment):.2f} {l.currency} — {when}",
                    "type": "alert" if days_until <= 2 else "info",
                })

    # 3. Budget goals at risk (>=90% used this month)
    month_start = today.replace(day=1)
    tx_result = await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == "debit",
            Transaction.transaction_date >= month_start,
        )
    )
    monthly_spend: dict[str, float] = {}
    for tx in tx_result.scalars().all():
        cat = tx.category or "other"
        monthly_spend[cat] = monthly_spend.get(cat, 0) + float(tx.amount)

    goals_result = await session.execute(
        select(BudgetGoal).where(BudgetGoal.user_id == user_id)
    )
    for g in goals_result.scalars().all():
        spent = monthly_spend.get(g.category, 0)
        limit = float(g.monthly_limit)
        if limit > 0 and spent >= limit * 0.9:
            pct = int(spent / limit * 100)
            notifications.append({
                "title": f"Budget Alert: {g.category}" if lang == "en" else f"Bütçe Uyarısı: {g.category}",
                "message": f"{pct}% of monthly limit used ({spent:.0f} / {limit:.0f})" if lang == "en"
                    else f"Aylık limitin %{pct}'i harcandı ({spent:.0f} / {limit:.0f})",
                "type": "alert" if spent >= limit else "warning",
            })

    # 4. Triggered wealth alerts (today)
    alerts_result = await session.execute(
        select(WealthAlert).where(
            WealthAlert.user_id == user_id,
            WealthAlert.is_active == True,  # noqa: E712
            WealthAlert.triggered_at >= today_start,
        )
    )
    for wa in alerts_result.scalars().all():
        notifications.append({
            "title": "Wealth Alert Triggered" if lang == "en" else "Varlık Alarmı Tetiklendi",
            "message": wa.message_template,
            "type": "alert",
        })

    # 5. LLM-generated insight (best-effort, once per day) — PAID TIER ONLY.
    #    Free users never trigger the LLM call; the daily insight is a plus/pro feature.
    if paid:
        try:
            from app.services.llm_provider import get_provider
            provider = get_provider()
            assets_r = await session.execute(select(Asset).where(Asset.user_id == user_id))
            asset_count = len(assets_r.scalars().all())

            lang_line = f"Respond in {lang}." if lang else "Respond in English."
            prompt = f"""Give ONE short financial health observation (max 2 sentences) based on this summary:
- {len(notifications)} alerts generated today
- {asset_count} assets tracked
- {len(liabilities)} liabilities tracked
{lang_line} Be specific and actionable, not generic."""

            # Direct client call (provider.complete() would inject the categorizer prompt);
            # run off the event loop since the HTTP call is blocking.
            def _gen() -> str:
                resp = provider.client.chat.completions.create(
                    model=provider.model,
                    messages=[
                        {"role": "system", "content": "You are a personal finance assistant giving a daily briefing."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.5,
                )
                return resp.choices[0].message.content or ""
            llm_tip = await asyncio.to_thread(_gen)
            if llm_tip:
                notifications.append({
                    "title": "Daily Insight" if lang == "en" else "Günlük Analiz",
                    "message": llm_tip,
                    "type": "info",
                })
        except Exception:
            pass

    # 6. Proactive "Mim" triggers (PRO tier only) — smart, actionable questions.
    if pro:
        try:
            notifications.extend(
                await _proactive_triggers(user_id, today, lang, liabilities, overdue_receivables, session)
            )
        except Exception:
            logger.exception("Proactive triggers failed — user=%s", user_id)

    # Write all notifications
    now = datetime.now(timezone.utc)
    for n in notifications:
        session.add(AppNotification(
            id=uuid.uuid4(),
            user_id=user_id,
            title=n["title"],
            message=n["message"],
            type=n["type"],
            is_read=False,
            action_type=n.get("action_type"),
            action_data=json.dumps(n["action_data"]) if n.get("action_data") else None,
            action_state=n.get("action_state", "none"),
            created_at=now,
        ))

    # Prune notifications older than 30 days
    cutoff = now - timedelta(days=30)
    await session.execute(
        delete(AppNotification).where(
            AppNotification.user_id == user_id,
            AppNotification.created_at < cutoff,
        )
    )

    await session.commit()
    logger.info("Daily notifications generated — user=%s count=%d", user_id, len(notifications))
    return {"created": len(notifications), "skipped": False}


async def resolve_notification_action(
    notif: AppNotification, answer: str, lang: str, session: AsyncSession,
) -> dict:
    """
    Act on a proactive notification's answer ("yes" / "no"). The headline behavior is the
    liability payment follow-up: "yes" records the payment as a transaction AND reduces the
    liability balance; "no" reschedules (the daily job re-asks while still in the window).
    Other action types are navigational prompts and simply resolve. Commits. Returns a
    small status dict. Owner check is the caller's responsibility.
    """
    tr = lang != "en"
    yes = answer.lower() in ("yes", "y", "true", "1")
    try:
        data = json.loads(notif.action_data or "{}")
    except Exception:
        data = {}

    result_message: str | None = None

    if notif.action_type == "liability_payment_followup":
        if not yes:
            # Not paid yet — reschedule. "dismissed" doesn't block re-asking next run.
            notif.action_state = "dismissed"
            notif.is_read = True
            result_message = "We'll remind you again." if not tr else "Tekrar hatırlatırız."
        else:
            liab = None
            lid = data.get("liability_id")
            if lid:
                try:
                    liab = await session.get(Liability, uuid.UUID(str(lid)))
                except Exception:
                    liab = None
            if liab is not None and liab.user_id == notif.user_id:
                amt = Decimal(str(data.get("amount") or liab.monthly_payment or 0))
                ccy = data.get("currency") or liab.currency
                today = date.today()
                # Record the payment as a transaction…
                session.add(Transaction(
                    id=uuid.uuid4(),
                    user_id=notif.user_id,
                    amount=amt,
                    transaction_type="debit",
                    description=f"{liab.name} — payment",
                    transaction_date=today,
                    currency=ccy,
                    category="fatura",
                    source="user_confirmed",
                    created_at=datetime.now(timezone.utc),
                ))
                # …and reduce the outstanding balance (never below zero).
                if liab.remaining_amount is not None:
                    liab.remaining_amount = max(Decimal("0"), liab.remaining_amount - amt)
                # Best-effort cache bust so net-worth views refresh.
                try:
                    from app.api.networth import bust_networth_insight_cache
                    await bust_networth_insight_cache(notif.user_id, session)
                except Exception:
                    pass
                result_message = (f"Logged a {float(amt):.0f} {ccy} payment and updated the balance."
                                  if not tr else
                                  f"{float(amt):.0f} {ccy} ödeme kaydedildi, bakiye güncellendi.")
            notif.action_state = "resolved"
            notif.is_read = True
    else:
        # set_savings / remind_receivable / upload_statement — navigational prompts.
        notif.action_state = "resolved" if yes else "dismissed"
        notif.is_read = True

    await session.commit()
    await session.refresh(notif)
    return {"ok": True, "action_state": notif.action_state, "message": result_message}
