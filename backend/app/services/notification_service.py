"""
Daily notification generation — single implementation, two callers.

WHY: The POST /notifications/generate-daily endpoint and the APScheduler job
must produce identical notifications. DRY: this service holds the logic; the
endpoint and the scheduler both call generate_for_user().
"""

import calendar
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_notification import AppNotification
from app.models.asset import Asset
from app.models.budget_goal import BudgetGoal
from app.models.liability import Liability
from app.models.receivable import Receivable
from app.models.transaction import Transaction
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

    # 1. Overdue receivables
    recv_result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status.in_(["pending", "overdue"]),
        )
    )
    for r in recv_result.scalars().all():
        if r.expected_date and r.expected_date < today:
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
            days_until = (next_due - today).days
            if 0 <= days_until <= 7:
                notifications.append({
                    "title": "Upcoming Payment" if lang == "en" else "Yaklaşan Ödeme",
                    "message": f"{l.name}: {float(l.monthly_payment):.2f} {l.currency} due in {days_until} days" if lang == "en"
                        else f"{l.name}: {float(l.monthly_payment):.2f} {l.currency} — {days_until} gün içinde",
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

    # 5. LLM-generated insight (best-effort, once per day)
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

        llm_tip = await provider.complete(
            system_prompt="You are a personal finance assistant giving a daily briefing.",
            user_message=prompt,
            temperature=0.5,
        )
        if llm_tip:
            notifications.append({
                "title": "Daily Insight" if lang == "en" else "Günlük Analiz",
                "message": llm_tip,
                "type": "info",
            })
    except Exception:
        pass

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
