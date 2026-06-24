"""
Subscription detection — shared by the legacy /subscriptions endpoint and the
unified recurring engine. Groups recurring debits whose monthly totals are
within ±10% of the median across ≥2 distinct months.
"""

from collections import Counter, defaultdict
from decimal import Decimal

_MIN_AMOUNT = Decimal("10")
_AMOUNT_VARIANCE = Decimal("0.10")
_MIN_MONTHS = 2


def normalize_key(description: str) -> str:
    return description.strip().lower()[:30]


def clean_merchant_name(description: str) -> str:
    """Best-effort display name from a raw statement description."""
    name = description.strip()
    for prefix in ("POS ALIŞVERİŞİ ", "SANAL POS ", "YURT DIŞI SANAL POS ", "İNTERNET ", "MOBİL "):
        if name.upper().startswith(prefix):
            name = name[len(prefix):]
            break
    return name[:45]


def detect_subscriptions(transactions) -> list[dict]:
    """Returns subscription candidates sorted by avg amount descending."""
    debits = [t for t in transactions if t.transaction_type == "debit"]

    by_key: dict[str, list] = defaultdict(list)
    for t in debits:
        by_key[normalize_key(t.description)].append(t)

    results = []
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
        if not all(
            abs(total - median) / median <= _AMOUNT_VARIANCE
            for total in monthly_totals if median > 0
        ):
            continue

        all_dates = sorted(t.transaction_date for t in group)
        if len(all_dates) >= 2:
            gaps = [(all_dates[i + 1] - all_dates[i]).days for i in range(len(all_dates) - 1)]
            avg_gap = sum(gaps) / len(gaps)
            frequency = "weekly" if avg_gap < 15 else "monthly"
        else:
            frequency = "monthly"

        latest_tx = max(group, key=lambda t: t.transaction_date)
        currency = Counter(getattr(t, "currency", None) or "TRY" for t in group).most_common(1)[0][0]
        results.append({
            "merchant_key": key,
            "merchant": clean_merchant_name(group[0].description),
            "avg_amount": str(median),
            "currency": currency,
            "frequency": frequency,
            "last_seen": all_dates[-1].isoformat(),
            "total_paid_all_time": str(sum(t.amount for t in group)),
            "months_active": len(by_month),
            "category": latest_tx.category or "diger",
            # Subscriptions require ≥2 distinct months to be detected at all → always confirmed.
            "confidence": "confirmed",
        })

    results.sort(key=lambda x: Decimal(x["avg_amount"]), reverse=True)
    return results
