"""
WHAT: Algorithmic pattern detection over transaction history — no LLM needed.
      Finds recurring payments, post-salary spend spikes, and forgotten subscriptions.
WHY: These are structural patterns a user might not notice themselves. A recurring
     ₺49 charge they forgot about is pure waste. Detecting it algorithmically is
     cheap (pure Python, no API call) and can run on every request.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.models.transaction import Transaction

logger = logging.getLogger(__name__)

# Thresholds
_SIMILARITY_THRESHOLD = Decimal("0.05")   # ±5% amount variance to count as "same"
_MIN_AMOUNT = Decimal("10")               # ignore amounts below this (OCR noise)
_SUBSCRIPTION_MAX = Decimal("500")        # ≤500 TL/month → "forgotten subscription"
_SPIKE_MIN_PCT = 50                       # first-3-days must be ≥50% above daily avg
_MAX_RECURRING_ALERTS = 3                 # cap so we don't flood the panel
_MIN_MONTHS = 2                           # need at least 2 months of occurrence


@dataclass
class Alert:
    type: str          # "recurring" | "forgotten_subscription" | "post_salary_spike"
    message: str
    amount: Decimal
    actionable: bool
    dismiss_key: str   # stable key for user dismissal, survives re-detections


def detect_patterns(transactions: list[Transaction]) -> list[Alert]:
    """
    WHAT: Runs all pattern detectors over transaction list and returns combined alerts.
          Caller is responsible for filtering out already-dismissed alerts.
    WHY: Pure function — no DB access, easily testable.
    """
    if not transactions:
        return []

    cutoff = date.today() - timedelta(days=90)
    recent = [t for t in transactions if t.transaction_date >= cutoff]
    debits = [t for t in recent if t.transaction_type == "debit"]

    alerts: list[Alert] = []
    alerts.extend(_find_recurring_and_subscriptions(debits))
    alerts.extend(_find_post_salary_spike(debits))
    return alerts


def _normalize_key(description: str) -> str:
    """Stable, lowercase 30-char prefix used as grouping and dismiss key."""
    return description.strip().lower()[:30]


def _find_recurring_and_subscriptions(debits: list[Transaction]) -> list[Alert]:
    """
    Groups debits by normalized description. If the same description appears in
    ≥2 distinct calendar months with amounts within ±5%, it's flagged as recurring
    (>500 TL) or forgotten subscription (≤500 TL).
    """
    by_key: dict[str, list[Transaction]] = defaultdict(list)
    for t in debits:
        by_key[_normalize_key(t.description)].append(t)

    candidates: list[tuple[Decimal, Alert]] = []

    for key, group in by_key.items():
        by_month: dict[str, list[Decimal]] = defaultdict(list)
        for t in group:
            by_month[t.transaction_date.strftime("%Y-%m")].append(t.amount)

        if len(by_month) < _MIN_MONTHS:
            continue

        monthly_totals = [sum(amounts) for amounts in by_month.values()]
        median = sorted(monthly_totals)[len(monthly_totals) // 2]

        if median < _MIN_AMOUNT:
            continue

        # All monthly totals must be within ±5% of the median
        consistent = all(
            abs(total - median) / median <= _SIMILARITY_THRESHOLD
            for total in monthly_totals
            if median > 0
        )
        if not consistent:
            continue

        desc = group[0].description[:45]
        if median <= _SUBSCRIPTION_MAX:
            alert = Alert(
                type="forgotten_subscription",
                message=f"Her ay ~₺{median:.0f} gidiyor ({desc}) — bunu biliyor muydun?",
                amount=median,
                actionable=True,
                dismiss_key=f"subscription:{key}",
            )
        else:
            alert = Alert(
                type="recurring",
                message=f"Her ay ~₺{median:.0f} {desc} ödüyorsun — aktif mi hâlâ?",
                amount=median,
                actionable=True,
                dismiss_key=f"recurring:{key}",
            )
        candidates.append((median, alert))

    # Surface highest-impact alerts first, capped
    candidates.sort(key=lambda x: x[0], reverse=True)
    return [alert for _, alert in candidates[:_MAX_RECURRING_ALERTS]]


def _find_post_salary_spike(debits: list[Transaction]) -> list[Alert]:
    """
    Compares daily spend in the first 3 days of each month vs the rest.
    If first-3-days daily average is ≥50% higher than rest-of-month daily average
    across multiple months, flags a post-salary spike pattern.
    """
    by_month: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"first3": Decimal("0"), "rest": Decimal("0")}
    )
    for t in debits:
        key = t.transaction_date.strftime("%Y-%m")
        if t.transaction_date.day <= 3:
            by_month[key]["first3"] += t.amount
        else:
            by_month[key]["rest"] += t.amount

    if len(by_month) < _MIN_MONTHS:
        return []

    spike_pcts: list[float] = []
    for data in by_month.values():
        first3_daily = data["first3"] / 3
        rest_daily = data["rest"] / 27  # approximate rest-of-month days
        if rest_daily > 0 and first3_daily > rest_daily:
            pct = float((first3_daily / rest_daily - 1) * 100)
            if pct >= _SPIKE_MIN_PCT:
                spike_pcts.append(pct)

    if not spike_pcts:
        return []

    # Only report if the spike is consistent across ≥2 months
    if len(spike_pcts) < _MIN_MONTHS:
        return []

    avg_pct = sum(spike_pcts) / len(spike_pcts)
    return [Alert(
        type="post_salary_spike",
        message=f"Ayın ilk 3 gününde günlük harcaman ortalamanın %{avg_pct:.0f} üzerinde.",
        amount=Decimal("0"),
        actionable=True,
        dismiss_key="post_salary_spike",
    )]
