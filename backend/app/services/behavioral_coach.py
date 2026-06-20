"""
WHAT: Business logic for the conversational coaching feature.
      Context assembly, LLM call, profile extraction, and profile merging.
WHY: Kept separate from api/chat.py so the endpoint stays thin and
     the coaching logic can be tested or reused without an HTTP request.
"""

import json
import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavioral_profile import BehavioralProfile
from app.models.transaction import Transaction
from app.services.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

_COACH_SYSTEM_TEMPLATE = """\
Sen Mizan'sın — Türk kullanıcıların kişisel finans koçusun.
Kullanıcının gerçek harcama verisine ve biriktirdiğin profiline erişimin var.

KURALLAR:
- Kısa, samimi, Türkçe cevap ver. Emoji kullanma.
- Yargılayıcı değil, merak eden bir ton kullan.
- Rakam gösterme — kalıpları ve davranışı yorumla.
- 2-4 cümle, odaklı ve kişisel.
- Kullanıcı bir şey paylaştığında (kira, maaş, alışkanlık) bunu kabul et ve dikkate al.{profile_section}{spending_section}"""

_EXTRACTION_SYSTEM_PROMPT = """\
Kullanıcının mesajından SADECE açıkça belirtilen finansal bilgileri çıkar.
Tahmin etme, yorum yapma — sadece kullanıcının net olarak söylediklerini al.

SADECE şu JSON formatını döndür, başka hiçbir şey yazma:
{"fixed_expenses": {}, "income_sources": {}, "spending_patterns": {}, "user_notes": ""}

fixed_expenses: aylık sabit ödemeler, örn. {"kira": 8000, "yurt_ödemesi": 12500}
income_sources: gelir kaynakları, örn. {"maaş": 45000, "freelance": 5000}
spending_patterns: davranış kalıpları, örn. {"hafta_sonu_dışarı_çıkıyor": true}
user_notes: yaşam bağlamı — şehir, aile durumu, iş durumu vb.

Eğer mesajda öğrenilecek bir şey yoksa boş obje/string döndür."""


async def get_or_create_profile(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> BehavioralProfile:
    result = await session.execute(
        select(BehavioralProfile).where(BehavioralProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = BehavioralProfile(user_id=user_id)
        session.add(profile)
        await session.flush()
    return profile


def build_profile_context(profile: BehavioralProfile) -> str:
    parts: list[str] = []

    fixed = json.loads(profile.fixed_expenses or "{}")
    if fixed:
        lines = ", ".join(f"{k}: {v} ₺" for k, v in fixed.items())
        parts.append(f"Sabit giderler: {lines}")

    income = json.loads(profile.income_sources or "{}")
    if income:
        lines = ", ".join(f"{k}: {v} ₺" for k, v in income.items())
        parts.append(f"Gelir kaynakları: {lines}")

    patterns = json.loads(profile.spending_patterns or "{}")
    active = [k for k, v in patterns.items() if v]
    if active:
        parts.append(f"Bilinen alışkanlıklar: {', '.join(active)}")

    if profile.user_notes:
        parts.append(f"Kişisel bağlam: {profile.user_notes}")

    return "\n".join(parts)


def build_spending_summary(transactions: list[Transaction]) -> str:
    totals: dict[str, Decimal] = {}
    total_income = Decimal("0")
    for t in transactions:
        if t.transaction_type == "debit":
            cat = t.category or "diger"
            totals[cat] = totals.get(cat, Decimal("0")) + t.amount
        else:
            total_income += t.amount

    if not totals and total_income == Decimal("0"):
        return ""

    today = date.today()
    lines = [f"Dönem: {today.strftime('%Y-%m')}"]
    for cat, amount in sorted(totals.items(), key=lambda x: x[1], reverse=True)[:8]:
        lines.append(f"  {cat}: {amount:.0f} ₺")
    if total_income > 0:
        lines.append(f"Gelir: {total_income:.0f} ₺")
    return "\n".join(lines)


def build_system_prompt(profile_context: str, spending_summary: str) -> str:
    profile_section = ""
    if profile_context:
        profile_section = f"\n\nKULLANICI PROFİLİ:\n{profile_context}"

    spending_section = ""
    if spending_summary:
        spending_section = f"\n\nGÜNCEL HARCAMA ÖZETİ:\n{spending_summary}"

    return _COACH_SYSTEM_TEMPLATE.format(
        profile_section=profile_section,
        spending_section=spending_section,
    )


def extract_profile_facts(message: str, provider: LLMProvider) -> dict:
    """
    WHAT: Second LLM call — extracts learnable financial facts from a user message.
    WHY: Keeps profile extraction decoupled from the main chat response so failures
         here never affect the conversation (return empty dict → profile unchanged).
    """
    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": message},
            ],
            temperature=0,
        )
        raw = (response.choices[0].message.content or "{}").strip()
        # Strip markdown fences if the model added them despite instructions
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as exc:
        logger.debug("Profile extraction failed (non-fatal): %s", exc)
        return {}


_INTENT_SYSTEM_PROMPT = """\
Bu mesaj bir finansal işlem içeriyor mu?

EVET ise şu JSON formatını döndür:
{{"amount": "150.00", "type": "debit", "description": "Market alışverişi", "date": "{today}", "category": "market"}}

Kurallar:
- type: "debit" (gider/ödeme) veya "credit" (gelir/para gelen)
- amount: pozitif sayı, string olarak
- date: belirtilmediyse bugün ({today})
- category: market|restoran|ulasim|eglence|saglik|fatura|giyim|nakit_atm|transfer|iade|vergi|teknoloji|diger

HAYIR ise sadece null döndür.
SADECE JSON veya null yaz, başka hiçbir şey yazma."""

VALID_CATEGORIES = {
    "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
    "giyim", "nakit_atm", "transfer", "iade", "vergi", "teknoloji", "diger",
}


def detect_transaction_intent(message: str, provider: LLMProvider) -> dict | None:
    """
    WHAT: Lightweight LLM call to detect if a user message describes a financial transaction.
    WHY: Lets users add transactions conversationally ("bugün 150 TL market harcadım")
         instead of opening a separate form. Returns None on failure — safe to ignore.
    """
    today = date.today().isoformat()
    prompt = _INTENT_SYSTEM_PROMPT.format(today=today)
    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": message},
            ],
            temperature=0,
        )
        raw = (response.choices[0].message.content or "").strip()
        if raw.lower() in ("null", "none", ""):
            return None
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw.strip())
        # Validate the extracted data before returning
        if not isinstance(data, dict):
            return None
        amount_str = str(data.get("amount", "0")).replace(",", ".")
        try:
            amount = Decimal(amount_str)
        except InvalidOperation:
            return None
        if amount <= 0:
            return None
        tx_type = data.get("type", "debit")
        if tx_type not in ("debit", "credit"):
            tx_type = "debit"
        category = data.get("category", "diger")
        if category not in VALID_CATEGORIES:
            category = "diger"
        tx_date = data.get("date", today)
        # Validate date format
        try:
            date.fromisoformat(tx_date)
        except ValueError:
            tx_date = today
        return {
            "amount": f"{amount:.2f}",
            "type": tx_type,
            "description": str(data.get("description", message[:80])),
            "date": tx_date,
            "category": category,
        }
    except Exception as exc:
        logger.debug("Transaction intent detection failed (non-fatal): %s", exc)
        return None


def merge_profile(profile: BehavioralProfile, facts: dict) -> bool:
    """
    WHAT: Merges extracted facts into the profile, updating only changed fields.
    WHY: Merge (not overwrite) so a message about rent doesn't erase previously
         stored income data. Returns True if any field changed — signals the caller
         to set profile_updated=True in the API response.
    """
    updated = False

    existing_fixed = json.loads(profile.fixed_expenses or "{}")
    new_fixed = facts.get("fixed_expenses") or {}
    if isinstance(new_fixed, dict) and new_fixed:
        existing_fixed.update(new_fixed)
        profile.fixed_expenses = json.dumps(existing_fixed, ensure_ascii=False)
        updated = True

    existing_income = json.loads(profile.income_sources or "{}")
    new_income = facts.get("income_sources") or {}
    if isinstance(new_income, dict) and new_income:
        existing_income.update(new_income)
        profile.income_sources = json.dumps(existing_income, ensure_ascii=False)
        updated = True

    existing_patterns = json.loads(profile.spending_patterns or "{}")
    new_patterns = facts.get("spending_patterns") or {}
    if isinstance(new_patterns, dict) and new_patterns:
        existing_patterns.update(new_patterns)
        profile.spending_patterns = json.dumps(existing_patterns, ensure_ascii=False)
        updated = True

    new_notes = (facts.get("user_notes") or "").strip()
    if new_notes:
        existing_notes = profile.user_notes or ""
        # Append to existing notes (don't overwrite — prior context still valid)
        combined = (existing_notes + " " + new_notes).strip() if existing_notes else new_notes
        if combined != profile.user_notes:
            profile.user_notes = combined
            updated = True

    if updated:
        profile.updated_at = datetime.now(timezone.utc)

    return updated
