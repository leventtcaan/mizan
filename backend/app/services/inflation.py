"""
WHAT: Inflation-adjusted spending analysis using hardcoded Turkish TUFE monthly rates.
WHY: Turkey had 60-80% annual inflation 2022-2024. Nominal spend increases look alarming
     but may just track inflation. This converts nominal changes to real changes so users
     understand whether they're actually spending more in real terms.
"""

import logging
import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction import Transaction

logger = logging.getLogger(__name__)

# Monthly TUFE (CPI) rates — approximate, sourced from TÜİK public data.
# Unit: percent per month (e.g., 6.7 means +6.7% price level that month).
TUFE_RATES: dict[str, float] = {
    # 2023
    "2023-01": 6.65, "2023-02": 3.15, "2023-03": 2.28, "2023-04": 2.39,
    "2023-05": 0.04, "2023-06": 3.92, "2023-07": 9.49, "2023-08": 9.09,
    "2023-09": 4.75, "2023-10": 3.43, "2023-11": 3.28, "2023-12": 2.93,
    # 2024
    "2024-01": 6.70, "2024-02": 4.53, "2024-03": 3.16, "2024-04": 3.18,
    "2024-05": 3.37, "2024-06": 1.64, "2024-07": 3.23, "2024-08": 2.47,
    "2024-09": 2.97, "2024-10": 2.88, "2024-11": 2.24, "2024-12": 1.03,
    # 2025 — approximate, based on TCMB disinflation trajectory
    "2025-01": 5.03, "2025-02": 2.71, "2025-03": 2.84, "2025-04": 2.60,
    "2025-05": 1.31, "2025-06": 1.51, "2025-07": 1.52, "2025-08": 1.80,
    "2025-09": 1.95, "2025-10": 1.78, "2025-11": 1.50, "2025-12": 1.20,
    # 2026 — approximate projection
    "2026-01": 2.80, "2026-02": 2.50, "2026-03": 2.00, "2026-04": 1.80,
    "2026-05": 1.50, "2026-06": 1.30, "2026-07": 1.20, "2026-08": 1.10,
    "2026-09": 1.10, "2026-10": 1.00, "2026-11": 1.00, "2026-12": 1.00,
}

_DEFAULT_MONTHLY_RATE = 2.0  # fallback for months not in the table


def _month_key(d) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _cumulative_inflation(month_old: str, month_new: str) -> float:
    """
    Cumulative TUFE % from the month AFTER month_old through month_new (inclusive).
    Returns 0.0 if month_old >= month_new (no time has passed).
    """
    if month_old >= month_new:
        return 0.0

    y_o, m_o = int(month_old[:4]), int(month_old[5:7])
    y_n, m_n = int(month_new[:4]), int(month_new[5:7])

    cumulative = 1.0
    y, m = y_o, m_o + 1
    if m > 12:
        m, y = 1, y + 1

    while (y < y_n) or (y == y_n and m <= m_n):
        key = f"{y:04d}-{m:02d}"
        rate = TUFE_RATES.get(key, _DEFAULT_MONTHLY_RATE)
        cumulative *= 1 + rate / 100
        m += 1
        if m > 12:
            m, y = 1, y + 1

    return (cumulative - 1) * 100


def calculate_real_change(
    amount_old: float,
    amount_new: float,
    month_old: str,
    month_new: str,
) -> dict:
    """
    Compare amount_old (in month_old) with amount_new (in month_new) in real terms.

    Returns:
        nominal_change_pct  — simple % change
        inflation_between   — cumulative TUFE between the two months
        real_change_pct     — inflation-adjusted change (approximately nominal - inflation)
        verdict             — human-readable Turkish label
    """
    if amount_old <= 0:
        return {
            "nominal_change_pct": 0.0,
            "inflation_between": _cumulative_inflation(month_old, month_new),
            "real_change_pct": 0.0,
            "verdict": "yetersiz veri",
        }

    nominal_pct = (amount_new - amount_old) / amount_old * 100
    inflation_pct = _cumulative_inflation(month_old, month_new)

    # Exact real return formula: real = (1 + nominal) / (1 + inflation) - 1
    real_pct = (
        (1 + nominal_pct / 100) / (1 + inflation_pct / 100) - 1
    ) * 100

    if real_pct > 5:
        verdict = "gerçek artış"
    elif real_pct < -5:
        verdict = "enflasyonun altında"
    else:
        verdict = "enflasyonla aynı"

    return {
        "nominal_change_pct": round(nominal_pct, 1),
        "inflation_between": round(inflation_pct, 1),
        "real_change_pct": round(real_pct, 1),
        "verdict": verdict,
    }


def _months_between(month_old: str, month_new: str) -> int:
    y_o, m_o = int(month_old[:4]), int(month_old[5:7])
    y_n, m_n = int(month_new[:4]), int(month_new[5:7])
    return (y_n - y_o) * 12 + (m_n - m_o)


async def analyze_user_inflation(user_id: uuid.UUID, session: AsyncSession) -> list[dict]:
    """
    For each category with data in at least 2 distinct months, compare the oldest
    month's average daily spend against the latest month's average daily spend.
    Returns results sorted by real_change_pct descending (worst offenders first).
    """
    result = await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == "debit",
        )
    )
    transactions = result.scalars().all()

    if not transactions:
        return []

    # Group debit amounts by (category, month)
    by_cat_month: dict[str, dict[str, list[Decimal]]] = defaultdict(lambda: defaultdict(list))
    for t in transactions:
        cat = t.category or "diger"
        mkey = _month_key(t.transaction_date)
        by_cat_month[cat][mkey].append(t.amount)

    analyses: list[dict] = []
    for cat, month_data in by_cat_month.items():
        if len(month_data) < 2:
            continue  # need at least 2 months to compare

        sorted_months = sorted(month_data.keys())
        old_month = sorted_months[0]
        new_month = sorted_months[-1]

        old_avg = float(sum(month_data[old_month])) / len(month_data[old_month])
        new_avg = float(sum(month_data[new_month])) / len(month_data[new_month])

        change = calculate_real_change(old_avg, new_avg, old_month, new_month)

        analyses.append({
            "category": cat,
            "old_avg": round(old_avg, 2),
            "new_avg": round(new_avg, 2),
            "old_month": old_month,
            "new_month": new_month,
            "nominal_pct": change["nominal_change_pct"],
            "inflation_pct": change["inflation_between"],
            "real_pct": change["real_change_pct"],
            "verdict": change["verdict"],
            "months_compared": _months_between(old_month, new_month),
        })

    analyses.sort(key=lambda x: x["real_pct"], reverse=True)
    logger.info(
        "Inflation analysis complete — user=%s categories=%d", user_id, len(analyses)
    )
    return analyses
