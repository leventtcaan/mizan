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
    income_90 = sum(float(t.amount) for t in txns
                    if t.transaction_type == "credit" and t.transaction_date >= cutoff)
    monthly_expenses = await _to(spent_90 / 3.0, "TRY", cur) if spent_90 > 0 else 0.0
    monthly_income = await _to(income_90 / 3.0, "TRY", cur) if income_90 > 0 else 0.0

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
                    "That's on the high side — most people feel comfortable keeping it under about 40%.",
                    "Bu biraz yüksek — çoğu kişi bunu yaklaşık %40'ın altında tutunca rahat eder."),
                "why": _tpl(lang,
                    f"When debt is this big a share, there's less cushion if your income or your assets dip.{pillar_note}",
                    f"Borç bu kadar büyük bir pay olunca, geliriniz ya da varlıklarınız düşerse daha az tamponunuz olur.{pillar_note}"),
                "move": _tpl(lang,
                    "Leaning into debt before new spending for a while is the quickest way down — want to map it out?",
                    "Bir süre yeni harcama yerine borca yüklenmek en hızlı çıkış yolu — birlikte planlayalım mı?"),
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
                f"Borrowing above ~{_HIGH_APR:.0f}% is the expensive kind that quietly works against you.",
                f"~%{_HIGH_APR:.0f} üzeri borç, sessizce aleyhinize çalışan pahalı türden."),
            "why": _tpl(lang,
                f"At {apr:.0f}%, just the interest runs about {_fmt(annual_interest, cur)} a year — money that buys you nothing.",
                f"%{apr:.0f} ile yalnızca faizi yılda yaklaşık {_fmt(annual_interest, cur)} — hiçbir şey almayan para."),
            "move": _tpl(lang,
                "Knocking this out before your cheaper debts usually saves the most — want to build a payoff plan?",
                "Bunu daha ucuz borçlarınızdan önce kapatmak genelde en çok kazandırır — bir ödeme planı kuralım mı?"),
        })

    # ── PLAY: thin emergency fund ───────────────────────────────────────────────
    if monthly_expenses > 0:
        months = liquid / monthly_expenses
        if months < _EMERGENCY_MONTHS_MIN:
            sev = "high" if months < 1 else "medium"
            if liquid <= 0:
                obs = _tpl(lang,
                    "You don't have any cash set aside right now.",
                    "Şu an kenara ayrılmış nakdiniz yok.")
                why = _tpl(lang,
                    f"You're spending around {_fmt(monthly_expenses, cur)} a month, so a single surprise bill could push you into debt.",
                    f"Ayda yaklaşık {_fmt(monthly_expenses, cur)} harcıyorsunuz; tek bir beklenmedik masraf sizi borca sürükleyebilir.")
            elif months < 1:
                obs = _tpl(lang,
                    "Your cash wouldn't cover even a full month of spending.",
                    "Nakitiniz bir aylık giderinizi bile karşılamaz.")
                why = _tpl(lang,
                    f"At roughly {_fmt(monthly_expenses, cur)} a month, there's almost no room for a surprise.",
                    f"Ayda yaklaşık {_fmt(monthly_expenses, cur)} ile sürpriz bir gidere neredeyse hiç alan yok.")
            else:
                n = round(months)
                obs = _tpl(lang,
                    f"Your cash would last about {n} month{'s' if n != 1 else ''} if income stopped.",
                    f"Geliriniz dursa nakitiniz yaklaşık {n} ay idare eder.")
                why = _tpl(lang,
                    f"That's a start, but a longer runway means a rough patch won't turn into debt.",
                    f"Bu bir başlangıç, ama daha uzun bir tampon zor bir dönemin borca dönüşmesini önler.")
            findings.append({
                "id": "emergency_fund", "play": "emergency_fund", "severity": sev,
                "action": {"type": "discuss", "params": {"topic": "emergency_fund"}},
                "observation": obs,
                "context": _tpl(lang,
                    f"Most people aim to keep {_EMERGENCY_MONTHS_MIN}–6 months of expenses within easy reach.",
                    f"Çoğu kişi {_EMERGENCY_MONTHS_MIN}–6 aylık gideri kolay erişilebilir tutmayı hedefler."),
                "why": why,
                "move": _tpl(lang,
                    "Even a small, steady amount set aside each month builds this back — want to start a target?",
                    "Her ay kenara ayrılan küçük ama düzenli bir tutar bile bunu toparlar — bir hedef başlatalım mı?"),
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
    # Cash flow read alone is misleading: someone with a large asset base and a
    # long runway is in a very different place than someone overspending with no
    # buffer. Weight this finding by the cushion (liquid runway + net-worth years),
    # so a wealthy month-of-overspend never outranks the real structural issues.
    if sav_pillar and sav_pillar.get("status") == "ok":
        rate = float(sav_pillar.get("value", 0)) / 100.0
        if rate < _SAVINGS_RATE_LOW:
            overspend = monthly_expenses - monthly_income
            gap = overspend if overspend > 0 else monthly_expenses  # monthly drain
            runway_months = (liquid / gap) if gap > 0 else 999.0
            nw_years = (net_worth / (gap * 12)) if gap > 0 else 999.0
            # Cushioned: liquid covers a year+ of the gap, or net worth covers 2+ years.
            cushioned = net_worth > 0 and (runway_months >= 12 or nw_years >= 2)
            severity = "low" if cushioned else "medium"
            logger.info(
                "GUIDANCE savings — cur=%s net_worth=%.0f liquid=%.0f mExp=%.0f mInc=%.0f "
                "gap=%.0f runway=%.1f nw_years=%.2f rate=%.3f cushioned=%s sev=%s",
                cur, net_worth, liquid, monthly_expenses, monthly_income,
                gap, runway_months, nw_years, rate, cushioned, severity,
            )

            # "Decades of runway" — a large net worth versus a tiny monthly gap.
            # At that point a low/negative month is simply not a finding worth surfacing.
            very_cushioned = net_worth > 0 and nw_years >= 10

            flag = True
            obs = context = why = None

            if rate < 0 and overspend <= 0:
                # The scorecard rate is a single-month read; the 90-day average here
                # shows income >= expenses. Recent reality contradicts the one bad
                # month, so don't cry wolf — suppress entirely.
                flag = False
                logger.info("GUIDANCE savings — suppressed: 90d trend (income>=expenses) contradicts single-month rate")
            elif rate < 0:
                # Genuinely overspending across the 90-day window.
                if very_cushioned:
                    flag = False
                    logger.info("GUIDANCE savings — suppressed: very cushioned (nw_years=%.1f)", nw_years)
                elif cushioned:
                    obs = _tpl(lang,
                        "Your spending has been running ahead of your income lately.",
                        "Son dönemde harcamanız gelirinizin biraz önünde gidiyor.")
                    why = _tpl(lang,
                        f"Your assets cover the gap comfortably for now, but at about {_fmt(gap, cur)} a month it's worth keeping an eye on.",
                        f"Varlıklarınız bu farkı şimdilik rahatça karşılıyor, ama ayda yaklaşık {_fmt(gap, cur)} ile göz ucuyla takip etmekte fayda var.")
                    context = _tpl(lang,
                        "Nothing urgent given your cushion — just a trend to keep from becoming a habit.",
                        "Tamponunuz göz önüne alınınca acil bir şey yok — sadece alışkanlığa dönüşmemesi gereken bir eğilim.")
                else:
                    obs = _tpl(lang,
                        "Lately you're spending more than you bring in.",
                        "Son dönemde kazandığınızdan fazlasını harcıyorsunuz.")
                    why = _tpl(lang,
                        f"You're running roughly {_fmt(overspend, cur)} short each month with little buffer to absorb it.",
                        f"Her ay yaklaşık {_fmt(overspend, cur)} açık veriyorsunuz ve bunu karşılayacak tampon az.")
                    context = _tpl(lang,
                        "The goal isn't perfection — just getting back to spending a little less than you earn.",
                        "Amaç kusursuzluk değil — yalnızca kazandığınızdan biraz azını harcamaya dönmek.")
            else:
                # Positive but low savings rate.
                if very_cushioned:
                    flag = False  # already wealthy; a low savings month isn't a problem
                    logger.info("GUIDANCE savings — suppressed: low rate but very cushioned (nw_years=%.1f)", nw_years)
                else:
                    pct = round(rate * 100)
                    obs = _tpl(lang,
                        f"You're holding on to only about {pct}% of what you earn.",
                        f"Kazandığınızın yalnızca yaklaşık %{pct}'ini elinizde tutuyorsunuz.")
                    context = _tpl(lang,
                        "Building wealth gets hard when there's little left at the end of the month.",
                        "Ay sonunda geriye az şey kalınca servet biriktirmek zorlaşır.")
                    why = _tpl(lang,
                        "How much you keep each month is the single biggest lever on your net worth over time.",
                        "Her ay ne kadar elinizde tuttuğunuz, zamanla net değerinizdeki en büyük kaldıraçtır.")

            if flag:
                findings.append({
                    "id": "savings_rate", "play": "savings_rate", "severity": severity,
                    "action": {"type": "set_goal", "params": {}},
                    "observation": obs,
                    "context": context,
                    "why": why,
                    "move": _tpl(lang,
                        "Putting a cap on a category or two is the easiest place to start — want to set one?",
                        "Bir-iki kategoriye sınır koymak başlamak için en kolay yer — bir tane belirleyelim mi?"),
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
            "You are Mizan — a sharp, warm friend who happens to know personal finance. "
            "You receive pre-computed findings. Rewrite each one's four fields (observation, "
            "context, why, move) so they sound like one short, natural spoken thought — NOT a "
            "report, NOT a calculator reading itself out loud.\n"
            "TONE: talk to the person, not at them. Plain, kind, a little direct. No jargon, "
            "no bullet-point voice, no robotic phrasing. The four fields should flow together "
            "like something a friend would actually say.\n"
            "NUMBERS: keep amounts accurate but human — round to clean figures, never show a "
            "negative percentage, and never print mechanical values like '0.0 months' or "
            "'%-59'. If someone is spending more than they earn, say so in words (and the "
            "shortfall amount), don't show a negative rate. Drop decimals that add no meaning.\n"
            "HARD RULES: do NOT invent facts or numbers that aren't in the input; do NOT add "
            "new recommendations; do NOT give investment or securities advice (never say buy, "
            "sell, or predict prices).\n"
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
