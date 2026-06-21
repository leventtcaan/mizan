"""
WHAT: Detects taksit (installment) payment plans in transaction history.
WHY: Installment purchases are common in many markets. Some card statements show each
     monthly charge separately; few finance apps surface how many remain or the true cost.
     This service identifies those recurring monthly charges and estimates residual burden.
"""

import logging
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

# ±2% variance — tighter than subscription detection because installments are fixed amounts
_AMOUNT_VARIANCE = Decimal("0.02")
_MIN_AMOUNT = Decimal("50")   # ignore trivial amounts
_MIN_MONTHS = 3               # need at least 3 months to confidently call it installment
_DEFAULT_PLAN_MONTHS = 12     # assume 12-month plan when we can't parse it from description

# Installment markers seen in statement descriptions
_TAKSIT_RE = re.compile(
    r"(?:TAKSİT|TAKSIT|TAKS\.?)\s*(\d+)/(\d+)"   # "TAKSİT 3/12" or "TAKS.3/12"
    r"|(\d+)/(\d+)\s*(?:TAKSİT|TAKSIT)"            # "3/12 TAKSİT"
    r"|(?:^|\s)(\d+)/(\d+)(?:\s|$)",               # bare "3/12" in description
    re.IGNORECASE,
)


def _normalize_key(description: str) -> str:
    return description.strip().lower()[:30]


def _merchant_key_for_explicit(description: str) -> str:
    """
    Strip taksit number/sequence from description so that
    'APPLE STORE TAKSİT 1/12' and 'APPLE STORE TAKSİT 2/12'
    both map to the same merchant key.
    """
    cleaned = _TAKSIT_RE.sub("", description).strip()
    # Also strip trailing 'TAKSİT' or 'TAKSIT' keyword if left alone
    cleaned = re.sub(r"\s*(TAKSİT|TAKSIT|TAKS\.?)\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned.lower()[:30] if cleaned else description.strip().lower()[:30]


def _parse_installment_number(description: str) -> tuple[int, int] | None:
    """
    Extracts (current_installment, total_installments) from description.
    Returns None if not parseable.
    """
    m = _TAKSIT_RE.search(description)
    if not m:
        return None
    groups = m.groups()
    # Find the first non-None pair
    for i in range(0, len(groups), 2):
        if groups[i] is not None and groups[i + 1] is not None:
            try:
                current = int(groups[i])
                total = int(groups[i + 1])
                if 1 <= current <= total <= 120:  # sanity: up to 10 years
                    return (current, total)
            except ValueError:
                pass
    return None


def detect_installments(transactions) -> list[dict]:
    """
    Two detection paths:

    Path A — Explicit: description contains "TAKSİT X/Y" → extract plan directly.
    Path B — Implicit: same merchant, same amount ±2%, consecutive months ≥3.

    Returns list of plan dicts sorted by monthly_amount descending.
    """
    debits = [t for t in transactions if t.transaction_type == "debit"]

    # --- Path A: explicit TAKSİT markers ---
    explicit_plans: dict[str, dict] = {}  # merchant_key → best plan info

    for t in debits:
        parsed = _parse_installment_number(t.description)
        if parsed is None:
            continue
        current_num, total_num = parsed
        key = _merchant_key_for_explicit(t.description)
        if key not in explicit_plans:
            explicit_plans[key] = {
                "merchant_key": key,
                "merchant": t.description.strip()[:45],
                "monthly_amount": t.amount,
                "current_installment": current_num,
                "total_installments": total_num,
                "remaining": total_num - current_num,
                "last_seen": t.transaction_date,
                "first_seen": t.transaction_date,
                "category": t.category or "diger",
                "source": "explicit",
            }
        else:
            plan = explicit_plans[key]
            if t.transaction_date < plan["first_seen"]:
                plan["first_seen"] = t.transaction_date
            # Track the latest installment number seen (tells us where we are in the plan)
            if t.transaction_date > plan["last_seen"]:
                plan["last_seen"] = t.transaction_date
                plan["current_installment"] = current_num
                plan["total_installments"] = total_num
                plan["remaining"] = total_num - current_num

    # --- Path B: implicit consecutive-month detection ---
    by_key: dict[str, list] = defaultdict(list)
    for t in debits:
        by_key[_normalize_key(t.description)].append(t)

    implicit_plans: list[dict] = []
    explicit_keys = set(explicit_plans.keys())

    for key, group in by_key.items():
        if key in explicit_keys:
            continue  # already handled by Path A

        by_month: dict[str, list[Decimal]] = defaultdict(list)
        for t in group:
            by_month[t.transaction_date.strftime("%Y-%m")].append(t.amount)

        if len(by_month) < _MIN_MONTHS:
            continue

        monthly_totals = {m: sum(amounts) for m, amounts in by_month.items()}
        sorted_months = sorted(monthly_totals.keys())
        median_amount = sorted(monthly_totals.values())[len(monthly_totals) // 2]

        if median_amount < _MIN_AMOUNT:
            continue

        # All monthly totals must be within ±2% of median (tighter than subscriptions)
        consistent = all(
            abs(total - median_amount) / median_amount <= _AMOUNT_VARIANCE
            for total in monthly_totals.values()
            if median_amount > 0
        )
        if not consistent:
            continue

        # Must be consecutive months — no gaps > 1
        consecutive = True
        for i in range(len(sorted_months) - 1):
            y1, m1 = int(sorted_months[i][:4]), int(sorted_months[i][5:7])
            y2, m2 = int(sorted_months[i + 1][:4]), int(sorted_months[i + 1][5:7])
            gap_months = (y2 - y1) * 12 + (m2 - m1)
            if gap_months > 1:
                consecutive = False
                break

        if not consecutive:
            continue

        months_detected = len(sorted_months)
        # Estimate: assume 12-month plan, figure out where we are
        # Use months_detected as "current installment count"
        estimated_remaining = max(0, _DEFAULT_PLAN_MONTHS - months_detected)

        all_txs = sorted(group, key=lambda t: t.transaction_date)
        latest_tx = max(group, key=lambda t: t.transaction_date)

        implicit_plans.append({
            "merchant_key": key,
            "merchant": group[0].description.strip()[:45],
            "monthly_amount": median_amount,
            "current_installment": months_detected,
            "total_installments": _DEFAULT_PLAN_MONTHS,
            "remaining": estimated_remaining,
            "last_seen": latest_tx.transaction_date,
            "first_seen": all_txs[0].transaction_date,
            "category": latest_tx.category or "diger",
            "source": "implicit",
        })

    # Merge: explicit takes priority
    all_plans = list(explicit_plans.values()) + implicit_plans
    total_paid_map: dict[str, Decimal] = {}
    for t in debits:
        key = _normalize_key(t.description)
        total_paid_map[key] = total_paid_map.get(key, Decimal("0")) + t.amount

    results = []
    for plan in all_plans:
        key = plan["merchant_key"]
        monthly = plan["monthly_amount"]
        total_installments = plan["total_installments"]
        remaining = plan["remaining"]
        total_paid = total_paid_map.get(key, monthly * plan["current_installment"])
        estimated_total = monthly * total_installments

        # Real cost calculation
        real_cost = calculate_real_cost(monthly, remaining)

        results.append({
            "merchant_key": key,
            "merchant": plan["merchant"],
            "monthly_amount": float(monthly),
            "months_detected": plan["current_installment"],
            "estimated_remaining": remaining,
            "total_plan_months": total_installments,
            "total_paid": float(total_paid),
            "estimated_total": float(estimated_total),
            "first_seen": plan["first_seen"].isoformat(),
            "last_seen": plan["last_seen"].isoformat(),
            "category": plan["category"],
            "source": plan["source"],
            # Real cost fields
            "total_nominal": real_cost["total_nominal"],
            "opportunity_loss": real_cost["opportunity_loss"],
            "real_cost_with_opportunity": real_cost["real_cost_with_opportunity"],
        })

    results.sort(key=lambda x: x["monthly_amount"], reverse=True)
    return results


def calculate_real_cost(monthly_amount: Decimal, remaining_months: int) -> dict:
    """
    Opportunity cost: what if you saved that money each month instead of paying installments?
    Assumes Turkish deposit/investment rate of 40% annual (approx TCMB policy rate era).
    Uses compound interest: FV = PMT * [(1+r)^n - 1] / r

    WHY 40%: Turkish policy rate peaked at 50% in 2024. Savings accounts offered 40-45%.
    A consumer paying installments is giving up that return on the capital.
    """
    if remaining_months <= 0:
        return {
            "total_nominal": 0.0,
            "opportunity_loss": 0.0,
            "real_cost_with_opportunity": 0.0,
        }

    annual_rate = 0.40
    monthly_rate = annual_rate / 12
    n = remaining_months
    pmt = float(monthly_amount)

    total_nominal = pmt * n

    # Future value of annuity (what savings would grow to)
    if monthly_rate > 0:
        fv = pmt * ((1 + monthly_rate) ** n - 1) / monthly_rate
    else:
        fv = total_nominal

    opportunity_loss = round(fv - total_nominal, 2)
    real_cost = round(total_nominal + opportunity_loss, 2)

    return {
        "total_nominal": round(total_nominal, 2),
        "opportunity_loss": round(opportunity_loss, 2),
        "real_cost_with_opportunity": real_cost,
    }


async def analyze_user_installments(user_id, session: AsyncSession) -> list[dict]:
    transactions = await get_transactions_for_user(user_id, session, all_batches=True)
    plans = detect_installments(transactions)
    logger.info("Installment analysis — user=%s plans_found=%d", user_id, len(plans))
    return plans
