"""
WHAT: Net Worth AI guidance — turns dead-end warnings ("debt is 84% of assets")
      into ranked, benchmarked, action-linked findings.
WHY:  A deterministic rule engine computes candidate "findings" from the user's
      real data (each = play_type + severity + their numbers + an executable hook).
      The LLM only *narrates* them — it cannot invent a recommendation. This keeps
      guidance honest, reproducible, and on the right side of the investment-advice
      line (recommendations come from a fixed library of financial-hygiene plays).

Each finding has four beats: observation · context/benchmark · why it matters · move.
Returns plain dicts; text is localized (TR/EN) by templates and optionally rewritten
warmer by the LLM within strict guardrails.
"""

import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.asset import Asset
from app.models.liability import Liability
from app.models.receivable import Receivable
from app.models.transaction import Transaction
from app.services.currency import convert
from app.services.llm_provider import get_provider
from app.services.scorecard import build_scorecard
from app.services.transaction_service import dedup_transactions_orm

logger = logging.getLogger(__name__)

# ── benchmarks (general financial-hygiene norms, not securities advice) ──────────
_DEBT_RATIO_HIGH = 0.70
_DEBT_RATIO_ELEVATED = 0.40
_HIGH_APR = 25.0            # annual %, above which debt is "expensive"
_EMERGENCY_MONTHS_MIN = 3
_CONCENTRATION_HIGH = 0.50  # single asset/category share of assets
_CONCENTRATION_ELEVATED = 0.40
_FX_CONCENTRATION = 0.60    # share of assets in a single foreign currency
_SAVINGS_RATE_LOW = 0.10
_LIQUID_TYPES = {"cash", "bank_account"}
_VOLATILE_TYPES = {"crypto", "commodity", "stock", "fund"}

_MAX_FINDINGS = 4
_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _fmt(amount: float, cur: str) -> str:
    return f"{cur} {amount:,.0f}"


# ── bilingual templates (deterministic fallback + LLM seed) ──────────────────────
# Each builder returns (observation, context, why, move) for the given language.

def _tpl(lang: str, en: str, tr: str) -> str:
    return tr if lang == "tr" else en


async def _to(amount: float, frm: str, cur: str) -> float:
    if amount == 0:
        return 0.0
    try:
        return float(await convert(amount, frm, cur))
    except Exception:
        return amount


async def build_guidance(
    user_id: uuid.UUID,
    display_currency: str,
    lang: str,
    session: AsyncSession,
) -> list[dict]:
    cur = (display_currency or "TRY").upper()
    lang = "tr" if lang == "tr" else "en"

    assets = list((await session.execute(
        select(Asset).where(Asset.user_id == user_id)
    )).scalars().all())
    liabilities = list((await session.execute(
        select(Liability).where(Liability.user_id == user_id)
    )).scalars().all())
    receivables = list((await session.execute(
        select(Receivable).where(Receivable.user_id == user_id)
    )).scalars().all())

    # Converted values
    asset_vals: list[tuple[Asset, float]] = []
    total_assets = 0.0
    liquid = 0.0
    by_currency: dict[str, float] = defaultdict(float)
    for a in assets:
        v = await _to(float(a.current_value), a.currency, cur)
        asset_vals.append((a, v))
        total_assets += v
        if a.asset_type in _LIQUID_TYPES:
            liquid += v
        by_currency[a.currency.upper()] += v

    total_liab = 0.0
    for li in liabilities:
        total_liab += await _to(float(li.remaining_amount), li.currency, cur)

    net_worth = total_assets - total_liab

    # Monthly expenses (last 90d debit average), TRY-assumed → display
    tx_rows = list((await session.execute(
        select(Transaction).where(Transaction.user_id == user_id)
    )).scalars().all())
    txns = dedup_transactions_orm(tx_rows)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).date()
    spent_90 = sum(float(t.amount) for t in txns
                   if t.transaction_type == "debit" and t.transaction_date >= cutoff)
    monthly_expenses = await _to(spent_90 / 3.0, "TRY", cur) if spent_90 > 0 else 0.0

    # Scorecard context (pillars, score, milestones)
    try:
        sc = await build_scorecard(user_id, cur, session)
    except Exception as exc:
        logger.warning("guidance: scorecard unavailable: %s", exc)
        sc = None

    pillars = {p["key"]: p for p in sc["pillars"]} if sc else {}
    debt_pillar = pillars.get("debt", {})
    sav_pillar = pillars.get("savings", {})

    findings: list[dict] = []

    # ── PLAY: negative net worth ────────────────────────────────────────────────
    if net_worth < 0 and (total_assets > 0 or total_liab > 0):
        findings.append({
            "id": "negative_net_worth", "play": "debt_load", "severity": "high",
            "action": {"type": "discuss", "params": {"topic": "debt"}},
            "observation": _tpl(lang,
                f"Your debts ({_fmt(total_liab, cur)}) currently exceed everything you own ({_fmt(total_assets, cur)}).",
                f"Borçlarınız ({_fmt(total_liab, cur)}) şu an sahip olduğunuz her şeyi ({_fmt(total_assets, cur)}) aşıyor."),
            "context": _tpl(lang,
                "A negative net worth means there's nothing left after debts — the first goal is to cross back above zero.",
                "Negatif net değer, borçlardan sonra geriye bir şey kalmadığı anlamına gelir — ilk hedef yeniden sıfırın üzerine çıkmak."),
            "why": _tpl(lang,
                "Every payment that reduces debt directly lifts your net worth here.",
                "Borcu azaltan her ödeme net değerinizi doğrudan yükseltir."),
            "move": _tpl(lang,
                "Let's map which debt to attack first — talk it through with the assistant.",
                "Önce hangi borca yükleneceğinizi planlayalım — asistanla konuşun."),
        })

    # ── PLAY: high debt-to-asset ratio ──────────────────────────────────────────
    if total_assets > 0:
        ratio = total_liab / total_assets
        if ratio >= _DEBT_RATIO_ELEVATED and net_worth >= 0:
            sev = "high" if ratio >= _DEBT_RATIO_HIGH else "medium"
            pct = round(ratio * 100)
            pillar_note = ""
            if debt_pillar:
                pillar_note = _tpl(lang,
                    f" It's the main drag on your Financial Health (Debt pillar {debt_pillar.get('score', 0)}/25).",
                    f" Finansal Sağlığınızdaki en büyük yük bu (Borç sütunu {debt_pillar.get('score', 0)}/25).")
            findings.append({
                "id": "debt_ratio", "play": "debt_load", "severity": sev,
                "action": {"type": "discuss", "params": {"topic": "debt"}},
                "observation": _tpl(lang,
                    f"Your debt is {pct}% of your assets.",
                    f"Borcunuz varlıklarınızın %{pct}'i kadar."),
                "context": _tpl(lang,
                    "That's high — a common comfort zone is under ~40%.",
                    "Bu yüksek — yaygın bir rahatlık bölgesi ~%40'ın altıdır."),
                "why": _tpl(lang,
                    f"High leverage leaves less cushion if income or asset values dip.{pillar_note}",
                    f"Yüksek kaldıraç, gelir veya varlık değeri düşerse daha az tampon bırakır.{pillar_note}"),
                "move": _tpl(lang,
                    "Prioritizing debt paydown over new spending is the fastest lever — let's plan it.",
                    "Yeni harcama yerine borç ödemeye öncelik vermek en hızlı kaldıraçtır — planlayalım."),
            })

    # ── PLAY: high-interest debt ────────────────────────────────────────────────
    high_apr = [li for li in liabilities
                if li.interest_rate is not None and float(li.interest_rate) >= _HIGH_APR]
    if high_apr:
        worst = max(high_apr, key=lambda li: float(li.interest_rate or 0))
        apr = float(worst.interest_rate)
        remaining_disp = await _to(float(worst.remaining_amount), worst.currency, cur)
        annual_interest = remaining_disp * apr / 100.0
        findings.append({
            "id": "high_interest_debt", "play": "high_interest_debt", "severity": "high",
            "action": {"type": "discuss", "params": {"topic": "payoff", "name": worst.name}},
            "observation": _tpl(lang,
                f"\"{worst.name}\" carries a {apr:.0f}% interest rate.",
                f"\"{worst.name}\" %{apr:.0f} faiz taşıyor."),
            "context": _tpl(lang,
                f"Anything above ~{_HIGH_APR:.0f}% is expensive debt that compounds against you.",
                f"~%{_HIGH_APR:.0f} üzeri, aleyhinize işleyen pahalı borçtur."),
            "why": _tpl(lang,
                f"At {apr:.0f}%, this costs roughly {_fmt(annual_interest, cur)} a year in interest alone.",
                f"%{apr:.0f} ile bu, yılda yalnızca faiz olarak yaklaşık {_fmt(annual_interest, cur)} maliyet demek."),
            "move": _tpl(lang,
                "Clearing this before lower-rate debt usually saves the most — let's build a payoff plan.",
                "Bunu düşük faizli borçtan önce kapatmak genelde en çok tasarrufu sağlar — bir ödeme planı kuralım."),
        })

    # ── PLAY: thin emergency fund ───────────────────────────────────────────────
    if monthly_expenses > 0:
        months = liquid / monthly_expenses
        if months < _EMERGENCY_MONTHS_MIN:
            sev = "high" if months < 1 else "medium"
            findings.append({
                "id": "emergency_fund", "play": "emergency_fund", "severity": sev,
                "action": {"type": "discuss", "params": {"topic": "emergency_fund"}},
                "observation": _tpl(lang,
                    f"Your cash covers about {months:.1f} months of spending.",
                    f"Nakitiniz yaklaşık {months:.1f} aylık harcamayı karşılıyor."),
                "context": _tpl(lang,
                    f"A common rule of thumb is {_EMERGENCY_MONTHS_MIN}–6 months of expenses set aside.",
                    f"Yaygın bir kural, {_EMERGENCY_MONTHS_MIN}–6 aylık masrafı bir kenara ayırmaktır."),
                "why": _tpl(lang,
                    f"With monthly spending near {_fmt(monthly_expenses, cur)}, a thin buffer means a surprise bill could force new debt.",
                    f"Aylık harcama {_fmt(monthly_expenses, cur)} civarındayken ince bir tampon, beklenmedik bir masrafın yeni borca yol açabileceği anlamına gelir."),
                "move": _tpl(lang,
                    "Setting a small monthly savings target rebuilds this fastest — let's set one.",
                    "Küçük bir aylık tasarruf hedefi bunu en hızlı toparlar — bir tane belirleyelim."),
            })

    # ── PLAY: single-asset concentration ────────────────────────────────────────
    if total_assets > 0 and asset_vals:
        top_asset, top_val = max(asset_vals, key=lambda x: x[1])
        share = top_val / total_assets
        if share >= _CONCENTRATION_ELEVATED and top_asset.asset_type in _VOLATILE_TYPES:
            sev = "medium" if share >= _CONCENTRATION_HIGH else "low"
            pct = round(share * 100)
            findings.append({
                "id": "concentration", "play": "concentration", "severity": sev,
                "action": {"type": "create_alert", "params": {"asset_id": str(top_asset.id), "name": top_asset.name}},
                "observation": _tpl(lang,
                    f"\"{top_asset.name}\" is {pct}% of your assets.",
                    f"\"{top_asset.name}\" varlıklarınızın %{pct}'i."),
                "context": _tpl(lang,
                    "That's heavy concentration in a single, volatile holding.",
                    "Bu, tek ve oynak bir varlıkta yoğun birikim demek."),
                "why": _tpl(lang,
                    "If it swings sharply, your whole net worth swings with it.",
                    "Sert dalgalanırsa tüm net değeriniz onunla birlikte dalgalanır."),
                "move": _tpl(lang,
                    "We can't tell you to trade it — but you can set a price-drop alert so you're never caught off guard.",
                    "Alıp satmanızı söyleyemeyiz — ama hazırlıksız yakalanmamak için bir fiyat-düşüş uyarısı kurabilirsiniz."),
            })

    # ── PLAY: FX concentration ──────────────────────────────────────────────────
    if total_assets > 0:
        foreign = {c: v for c, v in by_currency.items() if c != cur}
        if foreign:
            top_ccy, top_ccy_val = max(foreign.items(), key=lambda x: x[1])
            share = top_ccy_val / total_assets
            if share >= _FX_CONCENTRATION:
                pct = round(share * 100)
                findings.append({
                    "id": "fx_concentration", "play": "fx_concentration", "severity": "low",
                    "action": {"type": "discuss", "params": {"topic": "fx"}},
                    "observation": _tpl(lang,
                        f"{pct}% of your assets are held in {top_ccy}.",
                        f"Varlıklarınızın %{pct}'i {top_ccy} cinsinden."),
                    "context": _tpl(lang,
                        f"Most of your wealth rides on one currency's moves against {cur}.",
                        f"Servetinizin çoğu tek bir para biriminin {cur} karşısındaki hareketine bağlı."),
                    "why": _tpl(lang,
                        f"If {top_ccy} weakens versus {cur}, your net worth drops even if nothing else changes.",
                        f"{top_ccy}, {cur} karşısında zayıflarsa başka hiçbir şey değişmese de net değeriniz düşer."),
                    "move": _tpl(lang,
                        "Worth understanding your currency exposure — talk it through with the assistant.",
                        "Döviz pozisyonunuzu anlamakta fayda var — asistanla konuşun."),
                })

    # ── PLAY: low savings rate ──────────────────────────────────────────────────
    if sav_pillar and sav_pillar.get("status") == "ok":
        rate = float(sav_pillar.get("value", 0)) / 100.0
        if rate < _SAVINGS_RATE_LOW:
            findings.append({
                "id": "savings_rate", "play": "savings_rate", "severity": "medium",
                "action": {"type": "set_goal", "params": {}},
                "observation": _tpl(lang,
                    f"You're keeping about {rate * 100:.0f}% of your income.",
                    f"Gelirinizin yaklaşık %{rate * 100:.0f}'ini elinizde tutuyorsunuz."),
                "context": _tpl(lang,
                    "Building wealth gets hard when little is left over each month.",
                    "Her ay geriye az şey kalınca servet biriktirmek zorlaşır."),
                "why": _tpl(lang,
                    "A higher savings rate is the single biggest driver of net-worth growth over time.",
                    "Daha yüksek tasarruf oranı, zamanla net değer büyümesinin en büyük itici gücüdür."),
                "move": _tpl(lang,
                    "Capping one or two spending categories frees up room — set a budget goal.",
                    "Bir-iki harcama kategorisine sınır koymak alan açar — bir bütçe hedefi belirleyin."),
            })

    # ── PLAY: stale prices on auto-priced assets ────────────────────────────────
    stale = []
    for a in assets:
        if a.asset_type not in _VOLATILE_TYPES and a.asset_type not in {"gold", "foreign_currency"}:
            continue
        try:
            sd = json.loads(a.source_detail) if a.source_detail else {}
        except Exception:
            sd = {}
        fetched = sd.get("price_fetched_at")
        if not fetched:
            stale.append(a)
    if stale and len(stale) >= 1:
        findings.append({
            "id": "stale_prices", "play": "stale_prices", "severity": "low",
            "action": {"type": "refresh_prices", "params": {}},
            "observation": _tpl(lang,
                f"{len(stale)} of your holdings have never been priced live.",
                f"{len(stale)} varlığınız hiç canlı fiyatlanmadı."),
            "context": _tpl(lang,
                "Their displayed value may be stale, which skews your net worth.",
                "Gösterilen değerleri eski olabilir, bu da net değerinizi saptırır."),
            "why": _tpl(lang,
                "Accurate guidance needs accurate inputs.",
                "Doğru rehberlik doğru girdiler ister."),
            "move": _tpl(lang,
                "One tap refreshes live prices for these.",
                "Tek dokunuş bunlar için canlı fiyatları günceller."),
        })

    # Rank by severity, then cap.
    findings.sort(key=lambda f: _SEVERITY_RANK.get(f["severity"], 3))
    findings = findings[:_MAX_FINDINGS]

    if not findings:
        return []

    # LLM narration within guardrails (optional; templates are the safety net).
    await _narrate(findings, lang)
    return findings


async def _narrate(findings: list[dict], lang: str) -> None:
    """Rewrite each finding's prose warmer/personalized. The LLM may NOT add
    recommendations or give securities advice; numbers stay exact. Falls back to
    templates silently on any failure."""
    llm_available = len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0
    if not llm_available:
        return
    try:
        provider = get_provider()
        payload = [
            {"id": f["id"], "observation": f["observation"], "context": f["context"],
             "why": f["why"], "move": f["move"]}
            for f in findings
        ]
        lang_name = "Turkish" if lang == "tr" else "English"
        system = (
            "You are Mizan, a global personal finance coach. You receive pre-computed "
            "financial findings. Rewrite each finding's four fields (observation, context, "
            "why, move) to be warm, natural, and concise. STRICT RULES: keep every number "
            "exactly as given; do NOT add new recommendations; do NOT give investment or "
            "securities advice (never say buy, sell, or predict prices); never invent facts. "
            f"Write in {lang_name}. Return ONLY a JSON object mapping each id to "
            '{"observation","context","why","move"}.'
        )
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        # Accept either {id: {...}} or [{"id":..., ...}] or {"findings":[...]}.
        data: dict = {}
        if isinstance(parsed, dict) and "findings" in parsed and isinstance(parsed["findings"], list):
            parsed = parsed["findings"]
        if isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict) and "id" in item:
                    data[item["id"]] = item
        elif isinstance(parsed, dict):
            data = parsed
        for f in findings:
            got = data.get(f["id"])
            if isinstance(got, dict):
                for k in ("observation", "context", "why", "move"):
                    v = got.get(k)
                    if isinstance(v, str) and v.strip():
                        f[k] = v.strip()
    except Exception as exc:
        logger.warning("guidance narration failed, using templates: %s", exc)
