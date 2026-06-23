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


def _month_label(m: int | None, lang: str) -> str:
    if m is None:
        return "—"
    if m == 0:
        return "now" if lang != "tr" else "şimdi"
    years, rem = divmod(m, 12)
    if lang == "tr":
        parts = []
        if years:
            parts.append(f"{years} yıl")
        if rem:
            parts.append(f"{rem} ay")
        return " ".join(parts) or "0 ay"
    parts = []
    if years:
        parts.append(f"{years}y")
    if rem:
        parts.append(f"{rem}mo")
    return " ".join(parts) or "0mo"


_NARRATE_SYSTEM = """\
You are Mizan, a warm, sharp global personal-finance assistant. The user asked a
"what if" question and a deterministic engine computed the real answer. Write a SINGLE
short paragraph (2–4 sentences) telling them what changes, in plain language.
Preferred language: {language_name}. You MUST respond in that language.

Rules:
- Use ONLY the numbers given. Do not invent or add figures.
- Lead with the headline impact (net worth and/or debt-free timing), then the trade-off
  (e.g. lower cash now). Be encouraging but honest; flag risk if cash goes negative.
- No bullet points, no headings, no preamble, no investment/securities advice.
"""


def _narrate_facts(deltas: dict, scen: dict, horizon: int, ccy: str, lang: str, applied: list[str]) -> str:
    lines = [
        f"Horizon: {horizon} months. Currency: {ccy}.",
        f"Levers applied: {', '.join(applied) if applied else 'none'}.",
        f"Net worth at end — change vs baseline: {deltas['net_worth_end']:+,.0f} {ccy}.",
        f"Monthly cash flow change: {deltas['monthly_cashflow']:+,.0f} {ccy}.",
    ]
    if deltas["debt_free_months"]:
        lines.append(f"Debt paid off {abs(deltas['debt_free_months'])} months "
                     f"{'sooner' if deltas['debt_free_months'] > 0 else 'later'}.")
    if deltas["interest_saved"]:
        lines.append(f"Interest saved: {deltas['interest_saved']:+,.0f} {ccy}.")
    if scen["min_liquid"] < 0:
        lines.append(f"WARNING: liquid cash goes negative (down to {scen['min_liquid']:,.0f} {ccy} "
                     f"around month {scen['min_liquid_month']}).")
    return "\n".join(lines)


def _template_narrative(deltas: dict, scen: dict, ccy: str, lang: str) -> str:
    nw = deltas["net_worth_end"]
    if lang == "tr":
        s = (f"Bu senaryoda net değerin ufukta {('+' if nw >= 0 else '')}{_money(nw, ccy)} "
             f"{'daha yüksek' if nw >= 0 else 'daha düşük'} olur.")
        if deltas["debt_free_months"]:
            d = deltas["debt_free_months"]
            s += f" Borcun {abs(d)} ay {'daha erken' if d > 0 else 'daha geç'} biter."
        if scen["min_liquid"] < 0:
            s += " Dikkat: nakitin bu yolda eksiye düşüyor."
        return s
    s = (f"In this scenario your net worth ends {('+' if nw >= 0 else '')}{_money(nw, ccy)} "
         f"{'higher' if nw >= 0 else 'lower'} than your baseline.")
    if deltas["debt_free_months"]:
        d = deltas["debt_free_months"]
        s += f" You'd be debt-free {abs(d)} months {'sooner' if d > 0 else 'later'}."
    if scen["min_liquid"] < 0:
        s += " Heads up: your cash goes negative on this path."
    return s


def _generate_narrative(facts: str, lang: str) -> str | None:
    if not (len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0):
        return None
    try:
        provider = get_provider()
        system = _NARRATE_SYSTEM.format(language_name=_LANGUAGE_NAMES.get(lang, "English"))
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": facts},
            ],
            temperature=0.6,
        )
        return (resp.choices[0].message.content or "").strip() or None
    except Exception as exc:  # noqa: BLE001 — narration is best-effort
        logger.warning("Simulator narrative LLM failed: %s", exc)
        return None


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

    facts = _narrate_facts(deltas, scen_proj, horizon, ccy, lang, applied)
    narrative = await asyncio.to_thread(_generate_narrative, facts, lang) \
        or _template_narrative(deltas, scen_proj, ccy, lang)

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
    result = await run_simulation(user_id, session, ccy, actions, horizon, lang)
    return {"parsed": True, "actions": actions, "result": result}
