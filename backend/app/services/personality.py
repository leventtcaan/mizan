"""
WHAT: Financial personality analysis — single LLM call over 3 months of transaction
      data + behavioral profile → one of 5 Turkish personality types with description,
      strengths, watch-outs, and one actionable tip.
WHY: A personality type gives users a frame for their own behaviour. "You're an Instant
     Decision Maker" is more memorable and actionable than a pie chart. Cached per
     upload batch so the expensive LLM call only runs once per new statement.
"""

import json
import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavioral_profile import BehavioralProfile
from app.models.transaction import Transaction
from app.services.behavioral_coach import build_profile_context, get_or_create_profile
from app.services.llm_provider import LLMProvider, get_provider
from app.services.transaction_service import get_latest_batch_id, get_transactions_for_user

logger = logging.getLogger(__name__)

PERSONALITY_TYPES = {
    "Anlık Karar Verici",
    "Planlı Harcayan",
    "Tasarruf Odaklı",
    "Konfor Odaklı",
    "Dengesiz Harcayan",
}

_NO_DATA_RESULT = {
    "type": "Henüz Analiz Yok",
    "description": "Bir banka ekstresi yükledikten sonra finansal kişiliğinizi öğrenin.",
    "strengths": [],
    "watch_out": [],
    "tip": "Analizi başlatmak için bir banka ekstresi yükleyin.",
}

_SYSTEM_PROMPT = """\
Sen bir finansal davranış uzmanısın. Kullanıcının harcama verisine bakarak \
finansal kişilik analizi yapacaksın.

Sadece şu 5 kişilik tipinden birini seç:
- Anlık Karar Verici: Plansız, anlık kararlarla harcıyor. Aylara göre tutarsız.
- Planlı Harcayan: Düzenli kategorilerde harcıyor, bütçe bilinçli.
- Tasarruf Odaklı: Harcaması geliriyle kıyasla düşük; geri kalan biriktirilmiş görünüyor.
- Konfor Odaklı: Yaşam kalitesine yatırım yapıyor, sabit ve konfor harcamaları yüksek.
- Dengesiz Harcayan: Bazı kategorilerde aşırı, bazılarında beklenenden az harcıyor.

SADECE şu JSON yapısını döndür, başka hiçbir şey yazma:
{
  "type": "...",
  "description": "...",
  "strengths": ["...", "..."],
  "watch_out": ["...", "..."],
  "tip": "..."
}

Kurallar:
- type: yukarıdaki 5 tipten tam olarak biri
- description: 2-3 cümle, sıcak ve destekleyici ton, yargılayıcı değil
- strengths: 2 madde — olumlu, "sen yapıyorsun" yerine davranışı tanımla
- watch_out: 2 madde — yapıcı, "dikkat etmek faydalı olabilir" tonunda
- tip: tek, somut, uygulanabilir bir ipucu
- Her şey Türkçe"""


def _build_analysis_prompt(
    transactions: list[Transaction],
    profile: BehavioralProfile,
) -> str:
    three_months_ago = date.today() - timedelta(days=90)
    recent = [t for t in transactions if t.transaction_date >= three_months_ago]

    # Category totals
    totals: dict[str, Decimal] = {}
    total_income = Decimal("0")
    for t in recent:
        if t.transaction_type == "debit":
            cat = t.category or "diger"
            totals[cat] = totals.get(cat, Decimal("0")) + t.amount
        else:
            total_income += t.amount

    total_spend = sum(totals.values()) if totals else Decimal("0")

    dist_lines = "\n".join(
        f"  {cat}: {amt:.0f} TL"
        for cat, amt in sorted(totals.items(), key=lambda x: x[1], reverse=True)[:10]
    ) or "  veri yok"

    # Monthly variance — tells us how consistent the user is
    by_month: dict[str, Decimal] = {}
    for t in recent:
        if t.transaction_type == "debit":
            key = t.transaction_date.strftime("%Y-%m")
            by_month[key] = by_month.get(key, Decimal("0")) + t.amount
    monthly_vals = list(by_month.values())
    if len(monthly_vals) >= 2:
        avg_m = sum(monthly_vals) / len(monthly_vals)
        variance_pct = (
            max(monthly_vals) - min(monthly_vals)
        ) / avg_m * 100 if avg_m > 0 else Decimal("0")
        variance_line = f"Aylık harcama değişimi: %{variance_pct:.0f}"
    else:
        variance_line = "Tek ay verisi mevcut"

    profile_ctx = build_profile_context(profile)
    profile_section = f"\nKullanıcı profili:\n{profile_ctx}" if profile_ctx else ""

    return (
        f"Son 3 aylık harcama özeti ({len(recent)} işlem):\n"
        f"  Toplam gider: {total_spend:.0f} TL\n"
        f"  Toplam gelir: {total_income:.0f} TL\n"
        f"  {variance_line}\n"
        f"\nKategori dağılımı:\n{dist_lines}"
        f"{profile_section}"
    )


def _call_llm(prompt: str, provider: LLMProvider) -> dict:
    response = provider.client.chat.completions.create(
        model=provider.model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
    )
    raw = (response.choices[0].message.content or "").strip()
    if "```" in raw:
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    # Validate required keys and type
    if data.get("type") not in PERSONALITY_TYPES:
        data["type"] = "Dengesiz Harcayan"
    data.setdefault("description", "")
    data.setdefault("strengths", [])
    data.setdefault("watch_out", [])
    data.setdefault("tip", "")
    return data


async def analyze_personality(user_id: uuid.UUID, session: AsyncSession) -> dict:
    """
    WHAT: Returns personality analysis dict for user — from cache if batch unchanged,
          from LLM otherwise. Returns _NO_DATA_RESULT if user has no uploads yet.
    """
    latest_batch_id = await get_latest_batch_id(user_id, session)
    if latest_batch_id is None:
        return _NO_DATA_RESULT

    profile = await get_or_create_profile(user_id, session)

    # Cache hit: same batch, result already stored
    if (
        profile.personality_cache is not None
        and profile.personality_batch_id == latest_batch_id
    ):
        logger.info("Personality cache hit — user=%s batch=%s", user_id, latest_batch_id)
        return json.loads(profile.personality_cache)

    # Cache miss — generate
    transactions = await get_transactions_for_user(user_id, session, all_batches=True)
    if not transactions:
        return _NO_DATA_RESULT

    prompt = _build_analysis_prompt(transactions, profile)
    provider = get_provider("personality")

    try:
        result = _call_llm(prompt, provider)
    except Exception as exc:
        logger.error("Personality LLM call failed: %s", exc)
        return _NO_DATA_RESULT

    # Write to cache
    profile.personality_cache = json.dumps(result, ensure_ascii=False)
    profile.personality_batch_id = latest_batch_id
    await session.commit()

    logger.info("Personality generated and cached — user=%s type=%s", user_id, result.get("type"))
    return result
