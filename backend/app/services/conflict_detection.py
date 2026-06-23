"""
WHAT: Pure functions that compare user-entered figures against statement-parsed figures
      and flag likely double-counts. No DB, no LLM — deterministic rules only.
WHY: A user who uploads a statement AND types a manual income/spending estimate would have
     both counted, doubling their real numbers. These rules detect when the manual figure
     is "the same money" (and should be skipped) vs genuinely additional (supplementary).
BREAKS IF REMOVED: Onboarding and statement uploads silently double-count estimates.

The rules (apply everywhere a manual figure meets a parsed figure):
  - Manual income ≈ parsed salary-like credit (within SAME_THRESHOLD) → income_duplicate.
  - Manual spending within SAME_THRESHOLD of parsed expenses → spending_same.
  - Manual spending much larger than parsed (> EXCESS_THRESHOLD over) → spending_excess (ask).
"""

from __future__ import annotations

from typing import TypedDict

# Within ±20% → assume the manual figure is the same money as the parsed figure.
SAME_THRESHOLD = 0.20
# Manual spending more than 20% above parsed → genuinely more, ask the user.
EXCESS_THRESHOLD = 0.20
# Income figures within ±5% are effectively identical — never raise a question (and
# never imply "same money" for anything wider than this).
NEAR_THRESHOLD = 0.05
# Gap wide enough that the two income figures plausibly represent SEPARATE sources,
# so offering "both are correct — use the total" makes sense.
SUM_THRESHOLD = 0.25


class Conflict(TypedDict):
    kind: str            # income_mismatch | spending_same | spending_excess
    field: str           # income | spending
    parsed: float
    manual: float
    diff_pct: float      # signed: (manual - parsed) / parsed
    recommendation: str  # use_statement | use_manual | ask | add_supplementary
    allow_sum: bool      # whether "use the total of both" is a sensible third option


def _diff_pct(parsed: float, manual: float) -> float:
    if parsed == 0:
        return 0.0 if manual == 0 else 1.0
    return (manual - parsed) / abs(parsed)


def detect_income_conflict(parsed: float | None, manual: float | None) -> Conflict | None:
    """
    Compare a user-entered monthly income against the income seen in the statement.
    Only raises a question when they differ by more than NEAR_THRESHOLD (5%) — within
    that band they are treated as the same figure (no double-count, no prompt). When
    the gap is wide (> SUM_THRESHOLD) the two may be genuinely separate income sources,
    so the resolver may offer "use the total".
    """
    if not parsed or not manual or parsed <= 0 or manual <= 0:
        return None
    diff = _diff_pct(parsed, manual)
    if abs(diff) <= NEAR_THRESHOLD:
        return None
    return Conflict(
        kind="income_mismatch",
        field="income",
        parsed=round(parsed, 2),
        manual=round(manual, 2),
        diff_pct=round(diff, 4),
        recommendation="use_statement",
        allow_sum=abs(diff) > SUM_THRESHOLD,
    )


def detect_spending_conflict(parsed: float | None, manual: float | None) -> Conflict | None:
    """Manual spending near parsed → same money; far above → genuinely additional (ask)."""
    if not parsed or not manual or parsed <= 0 or manual <= 0:
        return None
    diff = _diff_pct(parsed, manual)
    if abs(diff) <= SAME_THRESHOLD:
        return Conflict(
            kind="spending_same",
            field="spending",
            parsed=round(parsed, 2),
            manual=round(manual, 2),
            diff_pct=round(diff, 4),
            recommendation="use_statement",
            allow_sum=False,
        )
    if diff > EXCESS_THRESHOLD:
        return Conflict(
            kind="spending_excess",
            field="spending",
            parsed=round(parsed, 2),
            manual=round(manual, 2),
            diff_pct=round(diff, 4),
            recommendation="ask",
            allow_sum=True,
        )
    return None


def detect_conflicts(
    parsed_income: float | None,
    parsed_expenses: float | None,
    manual_income: float | None,
    manual_spending: float | None,
) -> list[Conflict]:
    """Run all rules. Only fires when BOTH a parsed and a manual figure exist for a field."""
    conflicts: list[Conflict] = []
    inc = detect_income_conflict(parsed_income, manual_income)
    if inc:
        conflicts.append(inc)
    sp = detect_spending_conflict(parsed_expenses, manual_spending)
    if sp:
        conflicts.append(sp)
    return conflicts
