"""
WHAT: Financial Health scorecard — the engine behind the redesigned Progress page.
WHY:  Progress is the only page about *time* (trajectory), not a present-moment
      snapshot. It answers one question: "Am I getting better, and what's the one
      move that helps most?" The score is a fully-decomposed 0-100 built from four
      real pillars so it is honest (every point traces to a metric) and motivating
      (a single verdict + delta + streaks).

Returns plain numbers + keys; the frontend composes all display text so the page
stays correctly localized (TR/EN).
"""

import json
import logging
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.budget_goal import BudgetGoal
from app.models.liability import Liability
from app.models.networth_snapshot import NetworthSnapshot
from app.models.transaction import Transaction
from app.services.currency import convert
from app.services.transaction_service import dedup_transactions_orm

logger = logging.getLogger(__name__)

PILLAR_MAX = 25  # each of the 4 pillars contributes up to 25 → 100 total

# Round net-worth milestones, ascending. First one strictly above current net
# worth becomes the user's next target.
_NW_TARGETS = [
    1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000,
    100_000_000,
]


# ── month helpers ──────────────────────────────────────────────────────────────

def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _shift_month(year: int, month: int, back: int) -> tuple[int, int]:
    month -= back
    while month <= 0:
        month += 12
        year -= 1
    return year, month


def _recent_completed_month_keys(n: int) -> list[str]:
    """Last `n` COMPLETED calendar months, oldest→newest (excludes current month)."""
    now = datetime.now(timezone.utc)
    keys = []
    for i in range(n, 0, -1):
        y, m = _shift_month(now.year, now.month, i)
        keys.append(f"{y:04d}-{m:02d}")
    return keys


# ── pillar scoring (transparent step functions) ─────────────────────────────────

def _score_savings(rate: float | None) -> int:
    if rate is None:
        return 12  # neutral when income is unknown
    if rate >= 0.30:
        return 25
    if rate >= 0.20:
        return 21
    if rate >= 0.10:
        return 16
    if rate >= 0.0:
        return 9
    if rate >= -0.20:
        return 3
    return 0


def _score_debt(ratio: float | None) -> int:
    if ratio is None:
        return 18  # no debt data yet → lean positive (likely little/no debt)
    if ratio <= 0.0:
        return 25
    if ratio < 0.20:
        return 22
    if ratio < 0.35:
        return 18
    if ratio < 0.50:
        return 14
    if ratio < 0.70:
        return 9
    if ratio < 0.90:
        return 4
    return 1


def _score_discipline(met: int, total: int) -> int:
    if total == 0:
        return 15  # neutral when no goals are set
    return round(PILLAR_MAX * (met / total))


def _score_growth(pct: float | None) -> int:
    if pct is None:
        return 12  # not enough snapshot history
    if pct > 2.0:
        return 25
    if pct > 0.5:
        return 21
    if pct > 0.0:
        return 17
    if pct >= -0.5:
        return 12
    if pct >= -3.0:
        return 6
    return 2


def _band(score: int) -> str:
    if score >= 80:
        return "strong"
    if score >= 60:
        return "steady"
    if score >= 40:
        return "fragile"
    return "at_risk"


def _trend(curr: int, prev: int | None) -> str:
    if prev is None:
        return "none"
    if curr > prev:
        return "up"
    if curr < prev:
        return "down"
    return "flat"


# ── currency ────────────────────────────────────────────────────────────────────

async def _to(amount: float, frm: str, to: str) -> float:
    if amount == 0:
        return 0.0
    try:
        return float(await convert(amount, frm, to))
    except Exception:
        return amount


# ── main builder ────────────────────────────────────────────────────────────────

async def build_scorecard(
    user_id: uuid.UUID,
    display_currency: str,
    session: AsyncSession,
) -> dict:
    cur = (display_currency or "TRY").upper()

    # ---- transactions → per-month aggregation (deduped) ----
    tx_rows = list((await session.execute(
        select(Transaction).where(Transaction.user_id == user_id)
    )).scalars().all())
    txns = dedup_transactions_orm(tx_rows)

    by_month: dict[str, dict] = defaultdict(lambda: {
        "spent": Decimal("0"),
        "income": Decimal("0"),
        "by_category": defaultdict(lambda: Decimal("0")),
    })
    for t in txns:
        mk = _month_key(t.transaction_date)
        if t.transaction_type == "debit":
            by_month[mk]["spent"] += t.amount
            by_month[mk]["by_category"][t.category or "diger"] += t.amount
        else:
            by_month[mk]["income"] += t.amount

    now = datetime.now(timezone.utc)
    this_key = f"{now.year:04d}-{now.month:02d}"
    ly, lm = _shift_month(now.year, now.month, 1)
    last_key = f"{ly:04d}-{lm:02d}"

    def savings_rate(mk: str) -> float | None:
        income = float(by_month.get(mk, {}).get("income", 0) or 0)
        spent = float(by_month.get(mk, {}).get("spent", 0) or 0)
        if income <= 0:
            return None
        return (income - spent) / income

    rate_this = savings_rate(this_key)
    if rate_this is None:
        rate_this = savings_rate(last_key)  # fall back to last full month
    rate_last = savings_rate(last_key)

    # ---- assets / liabilities (live tables → current debt ratio) ----
    assets = list((await session.execute(
        select(Asset).where(Asset.user_id == user_id)
    )).scalars().all())
    liabilities = list((await session.execute(
        select(Liability).where(Liability.user_id == user_id)
    )).scalars().all())

    assets_usd = 0.0
    for a in assets:
        assets_usd += await _to(float(a.current_value), a.currency, "USD")
    liab_usd = 0.0
    for li in liabilities:
        liab_usd += await _to(float(li.remaining_amount), li.currency, "USD")

    debt_ratio = (liab_usd / assets_usd) if assets_usd > 0 else (None if liab_usd == 0 else 1.0)

    # ---- snapshots → net-worth growth + trajectory + annotations ----
    snaps = list((await session.execute(
        select(NetworthSnapshot)
        .where(NetworthSnapshot.user_id == user_id)
        .order_by(NetworthSnapshot.recorded_at.asc())
    )).scalars().all())

    growth_pct_this, growth_pct_last = _nw_growth(snaps)

    # ---- budget goals → discipline + streaks ----
    goals = list((await session.execute(
        select(BudgetGoal).where(BudgetGoal.user_id == user_id)
    )).scalars().all())

    met, total = _discipline_now(goals, by_month.get(this_key, {}).get("by_category", {}))
    met_last, total_last = _discipline_now(goals, by_month.get(last_key, {}).get("by_category", {}))

    # ---- pillar scores ----
    p_sav = _score_savings(rate_this)
    p_debt = _score_debt(debt_ratio)
    p_disc = _score_discipline(met, total)
    p_grow = _score_growth(growth_pct_this)
    score = p_sav + p_debt + p_disc + p_grow

    # last-month score (best-effort, same formula on shifted inputs)
    p_sav_l = _score_savings(rate_last)
    p_debt_l = p_debt  # no historical asset table; hold debt flat for the delta
    p_disc_l = _score_discipline(met_last, total_last)
    p_grow_l = _score_growth(growth_pct_last)
    score_last = p_sav_l + p_debt_l + p_disc_l + p_grow_l
    has_last = any(v is not None for v in (rate_last, growth_pct_last)) or total_last > 0
    score_delta = (score - score_last) if has_last else None

    pillars = [
        {"key": "savings", "score": p_sav, "max": PILLAR_MAX, "trend": _trend(p_sav, p_sav_l if has_last else None),
         "value": round((rate_this or 0) * 100, 1), "status": "ok" if rate_this is not None else "no_data"},
        {"key": "debt", "score": p_debt, "max": PILLAR_MAX, "trend": _trend(p_debt, p_debt_l if has_last else None),
         "value": round((debt_ratio or 0) * 100, 1), "status": "ok" if debt_ratio is not None else "no_data"},
        {"key": "discipline", "score": p_disc, "max": PILLAR_MAX, "trend": _trend(p_disc, p_disc_l if has_last else None),
         "value": met, "value2": total, "status": "ok" if total > 0 else "set_goals"},
        {"key": "growth", "score": p_grow, "max": PILLAR_MAX, "trend": _trend(p_grow, p_grow_l if has_last else None),
         "value": round(growth_pct_this, 1) if growth_pct_this is not None else 0.0,
         "status": "ok" if growth_pct_this is not None else "need_history"},
    ]

    # top mover = pillar whose score changed most (drives the verdict sentence)
    top_mover = None
    if has_last:
        diffs = [
            ("savings", p_sav - p_sav_l),
            ("debt", p_debt - p_debt_l),
            ("discipline", p_disc - p_disc_l),
            ("growth", p_grow - p_grow_l),
        ]
        diffs.sort(key=lambda x: abs(x[1]), reverse=True)
        if diffs[0][1] != 0:
            top_mover = {"key": diffs[0][0], "direction": "up" if diffs[0][1] > 0 else "down"}

    trajectory = await _trajectory(snaps, cur)
    annotations = await _annotations(snaps, cur)
    drivers = await _drivers(by_month.get(this_key, {}), by_month.get(last_key, {}), snaps, cur)
    milestones = await _milestones(liabilities, snaps, assets_usd, liab_usd, cur)
    streaks = _streaks(goals, by_month, cur, txns)

    has_data = bool(txns) or bool(assets) or bool(liabilities)

    return {
        "has_data": has_data,
        "currency": cur,
        "score": score,
        "score_delta": score_delta,
        "band": _band(score),
        "top_mover": top_mover,
        "pillars": pillars,
        "trajectory": trajectory,
        "annotations": annotations,
        "drivers": drivers,
        "milestones": milestones,
        "streaks": streaks,
    }


# ── sub-computations ─────────────────────────────────────────────────────────────

def _nw_growth(snaps: list) -> tuple[float | None, float | None]:
    """Returns (recent_30d_growth_pct, prior_30d_growth_pct) from net_worth_usd."""
    if len(snaps) < 2:
        return None, None

    def pct(old: float, new: float) -> float | None:
        if old == 0:
            return None
        return (new - old) / abs(old) * 100

    latest = float(snaps[-1].net_worth_usd)
    # find snapshot closest to 30 and 60 days before the latest
    latest_at = snaps[-1].recorded_at

    def nearest_before(days: int):
        target = latest_at.timestamp() - days * 86400
        best = None
        for s in snaps:
            if s.recorded_at.timestamp() <= target:
                best = s
        return best

    s30 = nearest_before(30) or snaps[0]
    s60 = nearest_before(60)
    g_this = pct(float(s30.net_worth_usd), latest)
    g_last = pct(float(s60.net_worth_usd), float(s30.net_worth_usd)) if s60 else None
    return g_this, g_last


def _discipline_now(goals: list, by_category: dict) -> tuple[int, int]:
    """How many budget goals are currently within limit (met, total)."""
    if not goals:
        return 0, 0
    met = 0
    for g in goals:
        spent = float(by_category.get(g.category, 0) or 0)
        if spent <= float(g.monthly_limit):
            met += 1
    return met, len(goals)


async def _trajectory(snaps: list, cur: str) -> list[dict]:
    """Net-worth points in display currency, downsampled to ≤40 points."""
    if not snaps:
        return []
    pts = snaps[-180:] if len(snaps) > 180 else snaps
    # downsample
    if len(pts) > 40:
        step = len(pts) / 40
        idx = sorted({int(i * step) for i in range(40)} | {len(pts) - 1})
        pts = [pts[i] for i in idx]
    out = []
    for s in pts:
        nw = await _to(float(s.net_worth_usd), "USD", cur)
        out.append({"date": s.recorded_at.date().isoformat(), "net_worth": round(nw, 2)})
    return out


async def _annotations(snaps: list, cur: str) -> list[dict]:
    """Largest net-worth jumps between consecutive snapshots, named by top mover."""
    if len(snaps) < 2:
        return []
    try:
        events = []
        for prev, curr in zip(snaps, snaps[1:]):
            delta = float(curr.net_worth_usd) - float(prev.net_worth_usd)
            base = abs(float(prev.net_worth_usd)) or 1.0
            if abs(delta) / base < 0.03:  # ignore <3% wobble
                continue
            mover = _top_breakdown_mover(prev.breakdown_json, curr.breakdown_json)
            events.append({
                "date": curr.recorded_at.date().isoformat(),
                "direction": "up" if delta > 0 else "down",
                "amount": round(await _to(abs(delta), "USD", cur), 2),
                "mover": mover,
                "_abs": abs(delta),
            })
        events.sort(key=lambda e: e["_abs"], reverse=True)
        for e in events:
            e.pop("_abs", None)
        return events[:3]
    except Exception as exc:
        logger.warning("annotation build failed: %s", exc)
        return []


def _top_breakdown_mover(prev_json: str | None, curr_json: str | None) -> str | None:
    """Diff two snapshot breakdowns → name of the single biggest-moving line."""
    try:
        prev = json.loads(prev_json) if prev_json else {}
        curr = json.loads(curr_json) if curr_json else {}
    except Exception:
        return None
    best_name, best_delta = None, 0.0
    for section in ("assets", "liabilities"):
        p = prev.get(section, {}) or {}
        c = curr.get(section, {}) or {}
        for key in set(p) | set(c):
            pv = float((p.get(key) or {}).get("usd", 0) or 0)
            cv = float((c.get(key) or {}).get("usd", 0) or 0)
            d = abs(cv - pv)
            if d > best_delta:
                best_delta = d
                best_name = (c.get(key) or p.get(key) or {}).get("name")
    return best_name


async def _drivers(this_m: dict, last_m: dict, snaps: list, cur: str) -> dict:
    """Biggest win (best) and biggest setback (worst) this month vs last."""
    this_cat = {k: float(v) for k, v in (this_m.get("by_category") or {}).items()}
    last_cat = {k: float(v) for k, v in (last_m.get("by_category") or {}).items()}
    cats = set(this_cat) | set(last_cat)

    increases = []  # spent more (setback)
    decreases = []  # spent less (win)
    for c in cats:
        delta = this_cat.get(c, 0) - last_cat.get(c, 0)
        if delta > 0:
            increases.append((c, delta))
        elif delta < 0:
            decreases.append((c, -delta))
    increases.sort(key=lambda x: x[1], reverse=True)
    decreases.sort(key=lambda x: x[1], reverse=True)

    worst = None
    if increases:
        worst = {"kind": "category", "name": increases[0][0],
                 "amount": round(await _to(increases[0][1], "TRY", cur), 2)}
    best = None
    if decreases:
        best = {"kind": "category", "name": decreases[0][0],
                "amount": round(await _to(decreases[0][1], "TRY", cur), 2)}

    # debt paydown can beat a category cut as the headline win
    if len(snaps) >= 2:
        try:
            d_old = float(snaps[-1].liabilities_usd)
            ref = None
            target = snaps[-1].recorded_at.timestamp() - 30 * 86400
            for s in snaps:
                if s.recorded_at.timestamp() <= target:
                    ref = s
            if ref is not None:
                paid = float(ref.liabilities_usd) - d_old
                paid_cur = await _to(abs(paid), "USD", cur)
                if paid > 0 and (best is None or paid_cur > best["amount"]):
                    best = {"kind": "debt", "name": None, "amount": round(paid_cur, 2)}
        except Exception:
            pass

    return {"best": best, "worst": worst}


async def _milestones(liabilities: list, snaps: list, assets_usd: float, liab_usd: float, cur: str) -> list[dict]:
    out: list[dict] = []

    # Debt-free date: total remaining / total monthly payment
    monthly = 0.0
    for li in liabilities:
        if li.monthly_payment and float(li.monthly_payment) > 0:
            monthly += await _to(float(li.monthly_payment), li.currency, "USD")
    if liab_usd > 0 and monthly > 0:
        months = liab_usd / monthly
        out.append({"key": "debt_free", "status": "on_track",
                    "date": _add_months(date.today(), int(round(months))).isoformat(),
                    "months": int(round(months))})
    elif liab_usd > 0:
        out.append({"key": "debt_free", "status": "no_plan", "date": None, "months": None})

    # Net-worth target: next round number above current, projected from growth
    nw_cur = await _to(assets_usd - liab_usd, "USD", cur)
    target_cur = next((tgt for tgt in _NW_TARGETS if tgt > nw_cur), None)
    if target_cur is not None:
        monthly_growth = _avg_monthly_growth_abs(snaps)  # in USD/month
        monthly_growth_cur = await _to(monthly_growth, "USD", cur) if monthly_growth else 0.0
        if monthly_growth_cur and monthly_growth_cur > 0:
            months = (target_cur - nw_cur) / monthly_growth_cur
            out.append({"key": "nw_target", "status": "on_track", "target": target_cur,
                        "date": _add_months(date.today(), int(round(months))).isoformat(),
                        "months": int(round(months))})
        else:
            out.append({"key": "nw_target", "status": "stalled", "target": target_cur,
                        "date": None, "months": None})
    return out


def _avg_monthly_growth_abs(snaps: list) -> float | None:
    """Average absolute net-worth change per 30 days (USD), from first→last snapshot."""
    if len(snaps) < 2:
        return None
    first, last = snaps[0], snaps[-1]
    days = (last.recorded_at - first.recorded_at).total_seconds() / 86400
    if days < 1:
        return None
    total = float(last.net_worth_usd) - float(first.net_worth_usd)
    return total / days * 30.0


def _streaks(goals: list, by_month: dict, cur: str, txns: list) -> list[dict]:
    """For each budget goal: consecutive completed months under limit + current-month pct."""
    if not goals:
        return []
    completed = _recent_completed_month_keys(6)  # oldest→newest
    now = datetime.now(timezone.utc)
    this_key = f"{now.year:04d}-{now.month:02d}"

    out = []
    for g in goals:
        limit = float(g.monthly_limit)
        # walk backward over completed months, counting consecutive "under"
        streak = 0
        for mk in reversed(completed):
            spent = float((by_month.get(mk, {}).get("by_category") or {}).get(g.category, 0) or 0)
            # only count months that actually have data for this category/month
            has_month = mk in by_month
            if has_month and spent <= limit:
                streak += 1
            elif has_month and spent > limit:
                break
            else:
                break
        spent_this = float((by_month.get(this_key, {}).get("by_category") or {}).get(g.category, 0) or 0)
        current_pct = round((spent_this / limit) * 100, 1) if limit > 0 else 0.0
        out.append({
            "category": g.category,
            "months": streak,
            "current_pct": current_pct,
            "limit": round(limit, 2),
            "spent": round(spent_this, 2),
        })
    out.sort(key=lambda s: (s["months"], -s["current_pct"]), reverse=True)
    return out


def _add_months(d: date, months: int) -> date:
    if months < 0:
        months = 0
    months = min(months, 1200)  # cap at 100 years
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, 1)
