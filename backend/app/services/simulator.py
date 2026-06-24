"""
WHAT: Financial "what-if" simulator. Projects a user's complete picture (net worth,
      liquid cash, debt payoff) forward month-by-month under a baseline AND a scenario
      with user-chosen levers applied, then reports the difference.
WHY: Turns Mizan from a mirror into a chief of staff — the user asks "what happens if
      I do X?" and gets a real, personalized answer across everything they own/owe, not
      a generic calculator. Architecture mirrors the guidance engine: the math is
      deterministic and trustworthy; the LLM only parses the question into levers and
      narrates the result — it never invents numbers.
BREAKS IF REMOVED: /simulator endpoints have no engine.

Model (stated plainly so it's never a black box):
  - Net worth grows each month by your recent average monthly surplus (income − expenses,
    last 90 days). No market growth is assumed on investments.
  - Debts decline on their current payment schedule (with interest). When a debt is fully
    paid, its monthly payment is "freed" and added to surplus from then on — so paying a
    debt off early visibly bends the curve upward.
  - Liquid cash follows the same surplus; a scenario that drives it negative raises a flag.
"""

import asyncio
import logging
import math
import re
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.asset import Asset
from app.models.liability import Liability
from app.models.transaction import Transaction
from app.services.currency import convert
from app.services.llm_provider import get_provider
from app.services.recurring import analyze_recurring

logger = logging.getLogger(__name__)

LIQUID_TYPES = {"cash", "bank_account"}
DEFAULT_HORIZON = 24
MAX_HORIZON = 120
_LOOKBACK_DAYS = 90
_LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}

# The lever vocabulary. The NL parser must emit only these.
ACTION_TYPES = {
    "cancel_recurring",   # stop a subscription → +amount/month surplus
    "save_monthly",       # set aside more each month → +amount/month surplus
    "income_change",      # raise / lost income / side gig → ±amount/month surplus
    "one_time_expense",   # a purchase now → −amount net worth & cash today
    "prepay_debt",        # lump sum onto a debt → cash down now, debt clears sooner
}


@dataclass
class Debt:
    id: str
    label: str
    remaining: float
    monthly_payment: float
    monthly_rate: float  # decimal, e.g. 0.03/12


@dataclass
class Model:
    """A starting financial state the projector evolves forward."""
    nw0: float
    liquid0: float
    base_surplus: float
    debts: list[Debt] = field(default_factory=list)


# ── currency helper ──────────────────────────────────────────────────────────

async def _factor(from_ccy: str, to_ccy: str, cache: dict[str, float]) -> float:
    fc = (from_ccy or to_ccy).upper()
    if fc == to_ccy.upper():
        return 1.0
    if fc not in cache:
        try:
            cache[fc] = float(await convert(1.0, fc, to_ccy))
        except Exception:  # noqa: BLE001 — unknown symbol → treat 1:1 rather than crash
            cache[fc] = 1.0
    return cache[fc]


# ── baseline ─────────────────────────────────────────────────────────────────

async def build_baseline(user_id: uuid.UUID, session: AsyncSession, ccy: str) -> Model:
    ccy = ccy.upper()
    cache: dict[str, float] = {}

    # Assets — convert(value, asset.currency, ccy) works for normal AND unit-priced
    # assets (crypto/gold store quantity in current_value with the symbol as currency).
    assets = (await session.execute(select(Asset).where(Asset.user_id == user_id))).scalars().all()
    nw_assets = 0.0
    liquid = 0.0
    for a in assets:
        f = await _factor(a.currency, ccy, cache)
        val = float(a.current_value) * f
        nw_assets += val
        if a.asset_type in LIQUID_TYPES:
            liquid += val

    # Liabilities → net worth drag + the debt schedule we project payoff on.
    liabs = (await session.execute(select(Liability).where(Liability.user_id == user_id))).scalars().all()
    nw_liab = 0.0
    debts: list[Debt] = []
    for l in liabs:
        f = await _factor(l.currency, ccy, cache)
        remaining = float(l.remaining_amount) * f
        nw_liab += remaining
        mp = float(l.monthly_payment or 0) * f
        if remaining > 0 and mp > 0:
            rate = float(l.interest_rate or 0) / 100.0 / 12.0
            debts.append(Debt(id=str(l.id), label=l.name, remaining=remaining,
                              monthly_payment=mp, monthly_rate=rate))

    # Monthly surplus from the last 90 days of real activity.
    since = date.today() - timedelta(days=_LOOKBACK_DAYS)
    txs = (await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= since,
        )
    )).scalars().all()
    income = 0.0
    expense = 0.0
    for t in txs:
        f = await _factor(t.currency or ccy, ccy, cache)
        amt = float(t.amount) * f
        if t.transaction_type == "credit":
            income += amt
        else:
            expense += amt
    months = max(1.0, _LOOKBACK_DAYS / 30.0)
    monthly_income = income / months
    monthly_expense = expense / months
    base_surplus = monthly_income - monthly_expense

    nw0 = nw_assets - nw_liab
    logger.info(
        "Simulator baseline — user=%s nw0=%.0f liquid=%.0f surplus=%.0f debts=%d %s",
        user_id, nw0, liquid, base_surplus, len(debts), ccy,
    )
    return Model(nw0=nw0, liquid0=liquid, base_surplus=base_surplus, debts=debts)


# ── projection ───────────────────────────────────────────────────────────────

def _project(model: Model, months: int) -> dict:
    """Evolve a Model forward `months` steps. Returns points + summary metrics."""
    debts = deepcopy(model.debts)
    nw = model.nw0
    liquid = model.liquid0
    freed = 0.0
    total_interest = 0.0
    min_liquid = liquid
    min_liquid_month = 0
    debt_free_month: int | None = 0 if not debts else None

    points = [{"month": 0, "net_worth": round(nw), "liquid": round(liquid)}]
    for m in range(1, months + 1):
        for d in debts:
            if d.remaining > 0:
                interest = d.remaining * d.monthly_rate
                total_interest += interest
                d.remaining = d.remaining + interest - d.monthly_payment
                if d.remaining <= 0:
                    d.remaining = 0.0
                    freed += d.monthly_payment  # payment is freed up from here on

        surplus = model.base_surplus + freed
        nw += surplus
        liquid += surplus
        if liquid < min_liquid:
            min_liquid = liquid
            min_liquid_month = m
        points.append({"month": m, "net_worth": round(nw), "liquid": round(liquid)})

        if debt_free_month is None and debts and all(d.remaining <= 0 for d in debts):
            debt_free_month = m

    return {
        "points": points,
        "net_worth_end": round(nw),
        "liquid_end": round(liquid),
        "debt_free_month": debt_free_month,  # None = not within horizon
        "total_interest": round(total_interest),
        "min_liquid": round(min_liquid),
        "min_liquid_month": min_liquid_month,
    }


def apply_actions(baseline: Model, actions: list[dict]) -> tuple[Model, list[str]]:
    """Return a new Model with the levers applied + a human list of what was applied."""
    nw0 = baseline.nw0
    liquid0 = baseline.liquid0
    surplus = baseline.base_surplus
    debts = deepcopy(baseline.debts)
    applied: list[str] = []

    for a in actions:
        atype = a.get("type")
        amount = float(a.get("amount") or 0)
        if atype not in ACTION_TYPES or amount == 0:
            continue
        label = a.get("label") or ""
        if atype in ("cancel_recurring", "save_monthly"):
            surplus += abs(amount)
            applied.append(f"{atype}:{abs(amount):.0f}{(' ' + label) if label else ''}")
        elif atype == "income_change":
            surplus += amount  # may be negative
            applied.append(f"income_change:{amount:+.0f}")
        elif atype == "one_time_expense":
            nw0 -= abs(amount)
            liquid0 -= abs(amount)
            applied.append(f"one_time_expense:{abs(amount):.0f}{(' ' + label) if label else ''}")
        elif atype == "prepay_debt":
            pay = abs(amount)
            liquid0 -= pay  # cash leaves now; net worth is unchanged (cash → equity)
            target = None
            debt_id = a.get("debt_id")
            if debt_id:
                target = next((d for d in debts if d.id == debt_id), None)
            if target is None and debts:
                target = max(debts, key=lambda d: d.remaining)  # default: biggest debt
            if target is not None:
                target.remaining = max(0.0, target.remaining - pay)
            applied.append(f"prepay_debt:{pay:.0f}{(' ' + (target.label if target else '')).rstrip()}")

    return Model(nw0=nw0, liquid0=liquid0, base_surplus=surplus, debts=debts), applied


# ── narration ────────────────────────────────────────────────────────────────

def _money(n: float, ccy: str) -> str:
    return f"{n:,.0f} {ccy}"


# Uncertainty band: the projection is a steady-state estimate, so we widen a cone
# around it with the square root of time (random-walk style) to communicate that the
# further out you look, the less certain it is. This kills the "fake precision" of a
# perfectly straight line WITHOUT inventing fake month-to-month wiggles.
_UNCERTAINTY_K = 0.5


def _add_band(points: list[dict], surplus: float, nw0: float) -> None:
    """Attach low/high to each scenario point in place (a widening cone of uncertainty)."""
    scale = max(abs(surplus), abs(nw0) * 0.01, 1.0)
    for p in points:
        dev = _UNCERTAINTY_K * scale * math.sqrt(p["month"])
        p["low"] = round(p["net_worth"] - dev)
        p["high"] = round(p["net_worth"] + dev)


def _summary(deltas: dict, scen: dict, horizon: int, ccy: str, lang: str) -> str:
    """
    Deterministic, correct-by-construction summary built from the SAME deltas the cards
    show. No LLM — so the headline text can never contradict the numbers (the previous
    LLM narration confidently narrated wrong/contradictory figures).
    """
    nw = deltas["net_worth_end"]
    mc = deltas["monthly_cashflow"]
    df = deltas["debt_free_months"]
    interest = deltas["interest_saved"]
    sign = lambda v: "+" if v >= 0 else "−"  # noqa: E731

    if lang == "tr":
        parts = [f"{horizon} ay sonra net değerin baz senaryoya göre {sign(nw)}{_money(abs(nw), ccy)}."]
        if mc:
            parts.append(f"Aylık nakit akışın {sign(mc)}{_money(abs(mc), ccy)} değişiyor.")
        if df:
            parts.append(f"Borcun {abs(df)} ay {'erken' if df > 0 else 'geç'} biter.")
        if interest:
            parts.append(f"Faizden {sign(interest)}{_money(abs(interest), ccy)} "
                         f"{'tasarruf' if interest >= 0 else 'fazla'}.")
        if scen["min_liquid"] < 0:
            parts.append(f"⚠ Bu yolda nakitin {scen['min_liquid_month']}. ay civarında eksiye düşüyor.")
        return " ".join(parts)

    parts = [f"In {horizon} months your net worth is {sign(nw)}{_money(abs(nw), ccy)} vs your baseline."]
    if mc:
        parts.append(f"Monthly cash changes by {sign(mc)}{_money(abs(mc), ccy)}.")
    if df:
        parts.append(f"You'd be debt-free {abs(df)} months {'sooner' if df > 0 else 'later'}.")
    if interest:
        parts.append(f"{sign(interest)}{_money(abs(interest), ccy)} "
                     f"{'saved in interest' if interest >= 0 else 'more interest'}.")
    if scen["min_liquid"] < 0:
        parts.append(f"⚠ Your cash goes negative around month {scen['min_liquid_month']} on this path.")
    return " ".join(parts)


def _assumptions(lang: str) -> list[str]:
    if lang == "tr":
        return [
            "Son 90 günün ortalama aylık gelir/giderinin devam ettiği varsayılır.",
            "Yatırımlarda piyasa getirisi varsayılmaz (muhafazakâr).",
            "Borçlar mevcut ödeme planıyla azalır; bir borç bitince ödemesi tasarrufa eklenir.",
            "Döviz kurları bugünün canlı kurlarıdır.",
        ]
    return [
        "Assumes your average monthly income/spending from the last 90 days continues.",
        "No market growth is assumed on investments (deliberately conservative).",
        "Debts decline on their current schedule; a paid-off debt's payment is added to savings.",
        "Currency conversions use today's live rates.",
    ]


# ── orchestration ────────────────────────────────────────────────────────────

async def run_simulation(
    user_id: uuid.UUID, session: AsyncSession, ccy: str,
    actions: list[dict], horizon: int, lang: str,
) -> dict:
    ccy = ccy.upper()
    horizon = max(1, min(MAX_HORIZON, horizon or DEFAULT_HORIZON))
    baseline = await build_baseline(user_id, session, ccy)

    base_proj = _project(baseline, horizon)
    scen_model, applied = apply_actions(baseline, actions)
    scen_proj = _project(scen_model, horizon)

    def _df_delta(base_m: int | None, scen_m: int | None) -> int:
        # positive = scenario is sooner. Treat None as "beyond horizon".
        b = base_m if base_m is not None else horizon + 1
        s = scen_m if scen_m is not None else horizon + 1
        return b - s

    deltas = {
        "net_worth_end": scen_proj["net_worth_end"] - base_proj["net_worth_end"],
        "monthly_cashflow": round(scen_model.base_surplus - baseline.base_surplus),
        "debt_free_months": _df_delta(base_proj["debt_free_month"], scen_proj["debt_free_month"]),
        "interest_saved": base_proj["total_interest"] - scen_proj["total_interest"],
        "liquid_end": scen_proj["liquid_end"] - base_proj["liquid_end"],
    }

    warnings: list[str] = []
    if scen_proj["min_liquid"] < 0:
        if lang == "tr":
            warnings.append(f"Bu senaryoda nakitin {scen_proj['min_liquid_month']}. ay civarında "
                            f"eksiye düşüyor ({_money(scen_proj['min_liquid'], ccy)}).")
        else:
            warnings.append(f"Cash goes negative around month {scen_proj['min_liquid_month']} "
                            f"({_money(scen_proj['min_liquid'], ccy)}) on this path.")

    # Widen a cone of uncertainty around the scenario line (honest about precision),
    # and summarise deterministically (correct by construction — no LLM, no contradiction).
    _add_band(scen_proj["points"], scen_model.base_surplus, scen_model.nw0)
    narrative = _summary(deltas, scen_proj, horizon, ccy, lang)

    return {
        "currency": ccy,
        "horizon_months": horizon,
        "baseline": base_proj,
        "scenario": scen_proj,
        "deltas": deltas,
        "warnings": warnings,
        "assumptions": _assumptions(lang),
        "narrative": narrative,
        "applied": applied,
    }


async def get_levers(user_id: uuid.UUID, session: AsyncSession, ccy: str) -> dict:
    """Personalized lever options so the UI is built from the user's real data."""
    ccy = ccy.upper()
    baseline = await build_baseline(user_id, session, ccy)
    cache: dict[str, float] = {}

    subs_out: list[dict] = []
    try:
        subscriptions, _installments = await analyze_recurring(user_id, session)
        for s in subscriptions:
            try:
                avg = float(s.get("avg_amount") or 0)
            except (TypeError, ValueError):
                continue
            monthly = avg * (4 if s.get("frequency") == "weekly" else 1)
            f = await _factor(s.get("currency") or ccy, ccy, cache)
            subs_out.append({
                "key": s.get("merchant_key"),
                "label": s.get("merchant", "—"),
                "monthly_amount": round(monthly * f, 2),
            })
    except Exception as exc:  # noqa: BLE001 — levers are best-effort
        logger.warning("Simulator levers: recurring failed: %s", exc)

    debts_out = [
        {"id": d.id, "label": d.label, "remaining": round(d.remaining),
         "monthly_payment": round(d.monthly_payment)}
        for d in baseline.debts
    ]

    return {
        "currency": ccy,
        "net_worth": round(baseline.nw0),
        "liquid": round(baseline.liquid0),
        "monthly_surplus": round(baseline.base_surplus),
        "subscriptions": subs_out,
        "debts": debts_out,
    }


# ── natural language → levers ────────────────────────────────────────────────

_PARSE_SYSTEM = """\
You convert a personal-finance "what if" question into a JSON array of levers.
Output ONLY a JSON array (no prose). Each lever is one of:
  {{"type":"cancel_recurring","amount":<monthly>,"label":"<name>"}}
  {{"type":"save_monthly","amount":<monthly>}}
  {{"type":"income_change","amount":<monthly, negative if income drops>}}
  {{"type":"one_time_expense","amount":<total>,"label":"<name>"}}
  {{"type":"prepay_debt","amount":<lump sum>,"label":"<debt name if mentioned>"}}
Amounts are plain numbers in the user's currency ({currency}), no symbols.
If the question mentions a named subscription/debt, copy the name into "label".
If you cannot map it to any lever, output []. Never invent amounts not implied by the text.

Critical rules:
- Evaluate any arithmetic and use the SINGLE resulting total. "12.500+12.500=25.000" is
  one amount of 25000 — never emit separate levers for each number in an expression.
- Never emit two levers that refer to the same money (no double-counting).
- Only use "save_monthly" or "income_change" when a monthly cadence is explicit
  (per month / monthly / ayda / aylık / /ay). A one-off "save up X for a goal" with no
  monthly cadence is NOT save_monthly — if it maps to no lever, leave it out (output []
  if nothing else maps). It is better to return [] than to guess a cadence.
- Note: numbers may use "." as a thousands separator (25.000 = 25000).

Known subscriptions: {subs}
Known debts: {debts}
"""


def _parse_actions(question: str, ccy: str, subs: list[dict], debts: list[dict]) -> list[dict]:
    if not (len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0):
        return []
    import json
    try:
        provider = get_provider()
        sub_names = ", ".join(f"{s['label']} ({s['monthly_amount']:.0f}/mo)" for s in subs[:10]) or "none"
        debt_names = ", ".join(f"{d['label']} (remaining {d['remaining']:.0f})" for d in debts[:10]) or "none"
        system = _PARSE_SYSTEM.format(currency=ccy, subs=sub_names, debts=debt_names)
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": question},
            ],
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        start, end = raw.find("["), raw.rfind("]")
        if start == -1 or end == -1:
            return []
        parsed = json.loads(raw[start:end + 1])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Simulator NL parse failed: %s", exc)
        return []

    # Validate + map prepay labels back to debt ids.
    actions: list[dict] = []
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict) or item.get("type") not in ACTION_TYPES:
            continue
        try:
            amount = float(item.get("amount"))
        except (TypeError, ValueError):
            continue
        if amount == 0:
            continue
        action = {"type": item["type"], "amount": amount}
        if item.get("label"):
            action["label"] = str(item["label"])[:60]
        if item["type"] == "prepay_debt" and item.get("label"):
            match = next((d for d in debts if d["label"].lower() in str(item["label"]).lower()
                          or str(item["label"]).lower() in d["label"].lower()), None)
            if match:
                action["debt_id"] = match["id"]
        actions.append(action)
    return actions


# Word-number → value, for "a/one/two year(s)" style horizons in either language.
_WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "bir": 1, "two": 2, "iki": 2, "three": 3, "üç": 3, "uc": 3,
    "four": 4, "dört": 4, "dort": 4, "five": 5, "beş": 5, "bes": 5, "six": 6, "altı": 6, "alti": 6,
}
_YEAR_WORDS = r"years?|yıl|yil|sene"
# Trailing \b keeps "month" from matching inside "monthly" (a cadence, not a horizon),
# so "save 500 monthly for 12 months" reads 12 months, not 500.
_MONTH_WORDS = r"months?|ay"
# "2 years", "for a year", "18 months", "6 ay", "bir yıl", "yarım yıl" → a horizon in months.
_HORIZON_NUM_RE = re.compile(
    rf"(\d+)\s*(?:{_YEAR_WORDS}|{_MONTH_WORDS})\b", re.IGNORECASE
)
_HORIZON_WORD_RE = re.compile(
    rf"\b({'|'.join(map(re.escape, _WORD_NUMBERS))})\s+(?:{_YEAR_WORDS}|{_MONTH_WORDS})\b",
    re.IGNORECASE,
)
_HALF_YEAR_RE = re.compile(r"half\s+a\s+year|yar[ıi]m\s+y[ıi]l", re.IGNORECASE)


def _is_year_unit(match_text: str) -> bool:
    return bool(re.search(_YEAR_WORDS, match_text, re.IGNORECASE))


def _parse_horizon(question: str) -> int | None:
    """
    Deterministically read a time horizon out of the question ("for a year", "12 months",
    "2 years", "6 ay", "bir yıl"). Returns months clamped to [1, MAX_HORIZON], or None
    when no explicit horizon is mentioned (caller keeps the UI's default).
    """
    if not question:
        return None
    q = question.lower()

    if _HALF_YEAR_RE.search(q):
        return 6

    # Numeric: "12 months" / "2 years" / "6 ay".
    m = _HORIZON_NUM_RE.search(q)
    if m:
        try:
            n = int(m.group(1))
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            months = n * 12 if _is_year_unit(m.group(0)) else n
            return max(1, min(MAX_HORIZON, months))

    # Worded: "a year" / "one year" / "two years" / "bir yıl".
    m = _HORIZON_WORD_RE.search(q)
    if m:
        n = _WORD_NUMBERS.get(m.group(1).lower(), 0)
        if n > 0:
            months = n * 12 if _is_year_unit(m.group(0)) else n
            return max(1, min(MAX_HORIZON, months))

    return None


async def ask_simulation(
    user_id: uuid.UUID, session: AsyncSession, ccy: str, question: str, horizon: int, lang: str,
) -> dict:
    """NL → levers → run. The LLM only translates; the engine does the math."""
    levers = await get_levers(user_id, session, ccy)
    actions = await asyncio.to_thread(
        _parse_actions, question, ccy.upper(), levers["subscriptions"], levers["debts"]
    )
    if not actions:
        return {"parsed": False, "actions": [], "result": None}
    # A time expression in the question ("for a year", "next 6 months") overrides the
    # horizon the UI sent, so "what if I cancel Netflix for a year" projects 12 months.
    parsed_horizon = _parse_horizon(question)
    effective_horizon = parsed_horizon or horizon
    result = await run_simulation(user_id, session, ccy, actions, effective_horizon, lang)
    return {"parsed": True, "actions": actions, "result": result}
