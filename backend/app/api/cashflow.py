import calendar
import logging
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.asset import Asset
from app.models.liability import Liability
from app.models.receivable import Receivable
from app.models.user import User
from app.services.currency import convert
from app.services.recurring import analyze_recurring
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cashflow", tags=["cashflow"])

_LIQUID_ASSET_TYPES = {"cash", "bank_account"}
_URGENT_DAYS = 3
_MIN_AMOUNT = Decimal("10")
_VARIANCE = Decimal("0.10")
_MIN_MONTHS = 2


class CashFlowItem(BaseModel):
    date: str
    type: str  # "liability_payment" | "income" | "subscription" | "recurring_income"
    amount: str
    currency: str
    description: str
    source: str  # "liability" | "receivable" | "subscription" | "recurring_income"
    urgent: bool
    overdue: bool = False  # only true for receivables past their expected_date


class CashFlowSummary(BaseModel):
    total_expected_income: str
    total_expected_payments: str
    projected_net: str
    liquid_assets: str
    display_currency: str
    liquid_to_payments_ratio: float | None
    warning: str | None
    days: int
    # Month-anchored figures (current calendar month), all in display_currency.
    month_income_actual: str        # credited transactions so far this month
    month_expenses_actual: str      # debited transactions so far this month
    expected_income_rest: str       # expected income from today → month end
    expected_payments_rest: str     # expected payments from today → month end
    projected_month_end: str        # liquid + (expected_income_rest - expected_payments_rest)


def _next_monthly(base_day: int, today: date) -> date:
    last_day_this = calendar.monthrange(today.year, today.month)[1]
    actual_day = min(base_day, last_day_this)
    candidate = date(today.year, today.month, actual_day)
    if candidate < today:
        ny, nm = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        last_day_next = calendar.monthrange(ny, nm)[1]
        candidate = date(ny, nm, min(base_day, last_day_next))
    return candidate


async def _liability_items(
    user_id, session: AsyncSession, today: date, end: date
) -> list[CashFlowItem]:
    result = await session.execute(select(Liability).where(Liability.user_id == user_id))
    items = []
    for li in result.scalars().all():
        # No payment info → not a cash-flow event at all.
        if not li.monthly_payment or li.monthly_payment <= 0:
            continue
        if li.remaining_amount <= 0:
            continue
        # Recurring monthly payment → always project the NEXT occurrence (never overdue).
        has_due = li.due_date is not None
        base_day = li.due_date.day if has_due else today.day
        pay_date = _next_monthly(base_day, today)
        if pay_date <= end:
            items.append(CashFlowItem(
                date=pay_date.isoformat(),
                type="liability_payment",
                amount=str(li.monthly_payment),
                currency=li.currency,
                description=li.name,
                source="liability",
                # Only flag urgent when we actually know the due day and it's near.
                urgent=has_due and (pay_date - today).days <= _URGENT_DAYS,
                overdue=False,
            ))
    return items


async def _receivable_items(
    user_id, session: AsyncSession, today: date, end: date
) -> list[CashFlowItem]:
    result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status.in_(["pending", "overdue"]),
        )
    )
    items = []
    for r in result.scalars().all():
        if not r.expected_date:
            continue
        overdue = r.expected_date < today
        display_date = today if overdue else r.expected_date
        if display_date > end:
            continue
        items.append(CashFlowItem(
            date=display_date.isoformat(),
            type="income",
            amount=str(r.amount),
            currency=r.currency,
            description=f"Receivable: {r.from_person}",
            source="receivable",
            urgent=overdue or (display_date - today).days <= _URGENT_DAYS,
            overdue=overdue,
        ))
    return items


async def _recurring_commitment_items(
    user_id, session: AsyncSession, today: date, end: date
) -> list[CashFlowItem]:
    """
    Upcoming recurring DEBIT commitments (subscriptions + installments) from the single
    shared recurring engine — so the calendar agrees with the Brief, the Recurring page
    and the Simulator instead of running its own detector. Only CONFIRMED items are
    scheduled (a "possible" single-occurrence installment is not money you owe yet).
    """
    items: list[CashFlowItem] = []
    try:
        subs, installments = await analyze_recurring(user_id, session)
    except Exception:  # noqa: BLE001 — never block the calendar on recurring analysis
        return items

    def _add(amount: Decimal, currency: str, description: str, last_seen: str) -> None:
        if amount < _MIN_AMOUNT:
            return
        try:
            base_day = date.fromisoformat(last_seen).day
        except (TypeError, ValueError):
            base_day = today.day
        pay_date = _next_monthly(base_day, today)
        if pay_date <= end:
            items.append(CashFlowItem(
                date=pay_date.isoformat(),
                type="subscription",
                amount=str(amount.quantize(Decimal("0.01"))),
                currency=currency or "TRY",
                description=description[:45],
                source="subscription",
                urgent=(pay_date - today).days <= _URGENT_DAYS,
            ))

    for s in subs:
        if s.get("confidence", "confirmed") != "confirmed":
            continue
        try:
            amt = Decimal(str(s["avg_amount"]))
        except (KeyError, ValueError, TypeError):
            continue
        _add(amt, s.get("currency") or "TRY", s.get("merchant", "—"), s.get("last_seen", ""))

    for p in installments:
        if p.get("confidence", "confirmed") != "confirmed":
            continue
        if p.get("estimated_remaining", 0) <= 0:
            continue
        try:
            amt = Decimal(str(p["monthly_amount"]))
        except (KeyError, ValueError, TypeError):
            continue
        _add(amt, p.get("currency") or "TRY", p.get("merchant", "—"), p.get("last_seen", ""))

    return items


def _recurring_income_items(transactions, today: date, end: date) -> list[CashFlowItem]:
    """Detect consistent recurring INCOME (credit) patterns and project next occurrence.

    Recurring DEBIT commitments now come from the shared engine
    (`_recurring_commitment_items`); income isn't a "commitment" and isn't produced by
    that engine, so it stays a local pattern scan here.
    """
    items: list[CashFlowItem] = []

    def _process(tx_list, item_type: str, source: str) -> None:
        by_key: dict[str, list] = defaultdict(list)
        for t in tx_list:
            by_key[t.description.strip().lower()[:30]].append(t)

        for _key, group in by_key.items():
            by_month: dict[str, list] = defaultdict(list)
            for t in group:
                by_month[t.transaction_date.strftime("%Y-%m")].append(t.amount)

            if len(by_month) < _MIN_MONTHS:
                continue

            monthly_totals = [sum(amounts) for amounts in by_month.values()]
            median = sorted(monthly_totals)[len(monthly_totals) // 2]
            if median < _MIN_AMOUNT:
                continue
            if not all(
                abs(total - median) / median <= _VARIANCE
                for total in monthly_totals
                if median > 0
            ):
                continue

            sorted_txns = sorted(group, key=lambda t: t.transaction_date)
            last_date = sorted_txns[-1].transaction_date

            if len(sorted_txns) >= 2:
                gaps = [
                    (sorted_txns[i].transaction_date - sorted_txns[i - 1].transaction_date).days
                    for i in range(1, len(sorted_txns))
                ]
                avg_gap = sum(gaps) / len(gaps)
            else:
                avg_gap = 30

            freq_days = 7 if avg_gap < 15 else 30
            predicted = last_date + timedelta(days=int(freq_days))
            while predicted < today:
                predicted += timedelta(days=int(freq_days))

            if predicted <= end:
                items.append(CashFlowItem(
                    date=predicted.isoformat(),
                    type=item_type,
                    amount=str(median.quantize(Decimal("0.01"))),
                    # Carry the source transactions' own currency (the latest in the
                    # group, whose description we also reuse) so the caller converts
                    # from the right base instead of assuming TRY.
                    currency=sorted_txns[-1].currency or "TRY",
                    description=sorted_txns[-1].description[:45],
                    source=source,
                    urgent=(predicted - today).days <= _URGENT_DAYS,
                ))

    _process(
        [t for t in transactions if t.transaction_type == "credit"],
        "recurring_income", "recurring_income",
    )
    return items


@router.get("/upcoming", response_model=list[CashFlowItem])
async def upcoming_cashflow(
    days: int = Query(default=30, ge=1, le=365),
    display_currency: str = Query(default="TRY"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CashFlowItem]:
    today = date.today()
    end = today + timedelta(days=days)
    cur = display_currency.upper()

    transactions = await get_transactions_for_user(current_user.id, session, all_batches=True)
    l_items = await _liability_items(current_user.id, session, today, end)
    r_items = await _receivable_items(current_user.id, session, today, end)
    rec_income = _recurring_income_items(transactions, today, end)
    rec_commit = await _recurring_commitment_items(current_user.id, session, today, end)

    all_items = l_items + r_items + rec_income + rec_commit
    all_items.sort(key=lambda x: x.date)

    # Convert every line item into the display currency so the timeline never
    # shows a converted summary above unconverted native rows. Cache factors per
    # source currency to avoid re-resolving the same pair repeatedly.
    factors: dict[str, float] = {}

    async def _factor(from_cur: str) -> float:
        fc = (from_cur or "TRY").upper()
        if fc == cur:
            return 1.0
        if fc not in factors:
            try:
                factors[fc] = float(await convert(1.0, fc, cur))
            except Exception:
                factors[fc] = 1.0
        return factors[fc]

    for item in all_items:
        f = await _factor(item.currency)
        if f != 1.0:
            try:
                item.amount = f"{float(item.amount) * f:.2f}"
            except (TypeError, ValueError):
                pass
        item.currency = cur

    return all_items


@router.get("/summary", response_model=CashFlowSummary)
async def cashflow_summary(
    days: int = Query(default=30, ge=1, le=365),
    display_currency: str = Query(default="TRY"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CashFlowSummary:
    today = date.today()
    end = today + timedelta(days=days)
    cur = display_currency.upper()

    month_start = today.replace(day=1)
    month_end = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    # Project items far enough to cover BOTH the rolling `days` window and month end.
    horizon = max(end, month_end)

    transactions = await get_transactions_for_user(current_user.id, session, all_batches=True)
    l_items = await _liability_items(current_user.id, session, today, horizon)
    r_items = await _receivable_items(current_user.id, session, today, horizon)
    rec_income = _recurring_income_items(transactions, today, horizon)
    rec_commit = await _recurring_commitment_items(current_user.id, session, today, horizon)
    all_items = l_items + r_items + rec_income + rec_commit

    income_types = {"income", "recurring_income"}
    payment_types = {"liability_payment", "subscription"}

    async def _conv(amount: Decimal, currency: str) -> Decimal:
        try:
            return Decimal(str(await convert(float(amount), currency, cur)))
        except Exception:
            return amount

    # Rolling `days`-window totals (used by the calendar page).
    total_income = Decimal("0")
    total_payments = Decimal("0")
    # Rest-of-current-month expectations (used by the Home projection).
    expected_income_rest = Decimal("0")
    expected_payments_rest = Decimal("0")

    for item in all_items:
        item_date = date.fromisoformat(item.date)
        converted = await _conv(Decimal(item.amount), item.currency)
        if item_date <= end:
            if item.type in income_types:
                total_income += converted
            elif item.type in payment_types:
                total_payments += converted
        if item_date <= month_end:
            if item.type in income_types:
                expected_income_rest += converted
            elif item.type in payment_types:
                expected_payments_rest += converted

    # Actual credited / debited transactions so far THIS calendar month.
    month_income_actual = Decimal("0")
    month_expenses_actual = Decimal("0")
    for t in transactions:
        if month_start <= t.transaction_date <= today:
            # Honor each transaction's own recorded currency; fall back to the legacy
            # TRY base only when a row predates per-transaction currency tracking.
            amt = await _conv(Decimal(str(t.amount)), t.currency or "TRY")
            if t.transaction_type == "credit":
                month_income_actual += amt
            elif t.transaction_type == "debit":
                month_expenses_actual += amt

    asset_result = await session.execute(
        select(Asset).where(
            Asset.user_id == current_user.id,
            Asset.asset_type.in_(_LIQUID_ASSET_TYPES),
        )
    )
    liquid = Decimal("0")
    for asset in asset_result.scalars().all():
        liquid += await _conv(Decimal(str(asset.current_value)), asset.currency)

    projected_net = total_income - total_payments
    projected_month_end = liquid + (expected_income_rest - expected_payments_rest)
    ratio = float(liquid / total_payments) if total_payments > 0 else None
    warning: str | None = None
    if total_payments > 0 and liquid < total_payments:
        warning = (
            f"Liquid assets ({cur} {liquid:,.0f}) may be insufficient for upcoming "
            f"payments ({cur} {total_payments:,.0f}) over the next {days} days."
        )

    q = Decimal("0.01")
    return CashFlowSummary(
        total_expected_income=str(total_income.quantize(q)),
        total_expected_payments=str(total_payments.quantize(q)),
        projected_net=str(projected_net.quantize(q)),
        liquid_assets=str(liquid.quantize(q)),
        display_currency=cur,
        liquid_to_payments_ratio=ratio,
        warning=warning,
        days=days,
        month_income_actual=str(month_income_actual.quantize(q)),
        month_expenses_actual=str(month_expenses_actual.quantize(q)),
        expected_income_rest=str(expected_income_rest.quantize(q)),
        expected_payments_rest=str(expected_payments_rest.quantize(q)),
        projected_month_end=str(projected_month_end.quantize(q)),
    )
