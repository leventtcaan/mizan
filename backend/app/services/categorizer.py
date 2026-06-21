"""
WHAT: LLM-powered batch categorizer — assigns a spending category to each transaction.
WHY: Batch prompt (all descriptions in one call) minimises API round-trips and cost.
     Category is written back to Transaction.category so it survives re-uploads
     without re-running the LLM.
BREAKS IF REMOVED: Transaction rows are stored with category=None; no behavioral
                   insight is possible downstream.
"""

import json
import logging

from app.models.transaction import Transaction
from app.services.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

# WHY: Legacy category slugs are stable API/storage values. Do not rename without a migration.
# Display labels can be localized above this layer.
VALID_CATEGORIES = {
    "market",
    "restoran",
    "ulasim",
    "fatura",
    "saglik",
    "giyim",
    "eglence",
    "nakit_atm",
    "transfer",
    "iade",
    "vergi",
    "teknoloji",
    "diger",
}

_SYSTEM_PROMPT = """\
You categorize global financial transactions.
For each transaction description, choose exactly one of these stable category slugs:
market, restoran, ulasim, fatura, saglik, giyim, eglence, nakit_atm, transfer, iade, vergi, teknoloji, diger

Category rules (priority order):
- teknoloji: "Yurt Dışı Sanal POS" + açıklamada AWS/Google/Azure/Apple/Spotify/Netflix/GitHub/Dropbox/Adobe/Microsoft/OpenAI/Anthropic/ChatGPT/cloud/dijital/yazılım/hosting geçiyorsa
- vergi: "Kambiyo Muameleleri Vergisi", "BSMV", "Vergi Kesintisi", "Stopaj"
- iade: "İade", "Debit Kart İade", "Geri Ödeme", "Refund", "İPTAL"
- transfer: "Havale", "EFT", "Tös Hesaba Havale", "FAST İşlemi", "Virman", kişi adı ile yapılan para transferleri
- nakit_atm: "ATM", "Para Çekme", "Nakit Avans"
- market: BİM, Migros, A101, Şok, CarrefourSA, Metro, Macrocenter, Kipa, Hakmar
- restoran: restoran, kafe, McDonald's, Burger King, Starbucks, yemeksepeti, getir (yemek), trendyol yemek
- ulasim: UBER, İBB, metro, otobüs, taksi, BiTaksi, Trafi, akaryakıt, benzin, Shell, BP, Opet
- fatura: elektrik, doğalgaz, su, internet, telefon, TTNET, Turkcell, Vodafone, Türk Telekom
- saglik: eczane, hastane, klinik, doktor, diş, optik, laborat
- giyim: Zara, H&M, LC Waikiki, Koton, Mango, Pull&Bear, DeFacto, Boyner, giyim, ayakkabı
- eglence: sinema, tiyatro, konser, oyun, Netflix (içerik), Spotify (içerik)
- If unsure, choose "diger"

General rule: use only one of the listed slugs. Return ONLY a JSON list, nothing else.
"""

_USER_PROMPT_TEMPLATE = """\
Aşağıdaki işlem açıklamalarını kategorize et.
Her açıklama için tam olarak bir kategori döndür, aynı sırada.
Yanıt formatı: ["kategori1", "kategori2", ...]

İşlemler:
{descriptions}
"""


async def categorize_batch(
    transactions: list[Transaction],
    provider: LLMProvider,
) -> list[Transaction]:
    """
    WHAT: Sends all transaction descriptions to the LLM in one call, writes categories back.
    WHY: One API call for N transactions instead of N calls — 10-100x cheaper at scale.
         If the LLM call fails, transactions are returned with category=None (not crashed).
    BREAKS IF REMOVED: All transactions remain uncategorized; behavioral analysis has no input.
    """
    if not transactions:
        return []

    descriptions = "\n".join(
        f"{i + 1}. {t.description}" for i, t in enumerate(transactions)
    )

    prompt = _USER_PROMPT_TEMPLATE.format(descriptions=descriptions)

    try:
        raw_response = provider.complete(prompt)
        categories = _parse_response(raw_response, len(transactions))
    except Exception as exc:
        # WHY: Never let LLM failure crash the upload — raw data is already persisted.
        # User can re-trigger categorization later; losing the upload would be worse.
        logger.error("LLM categorization failed: %s — leaving categories as None", exc)
        return transactions

    for transaction, category in zip(transactions, categories):
        transaction.category = category

    logger.info(
        "Categorized %d transactions — distribution: %s",
        len(transactions),
        _distribution(categories),
    )

    return transactions


def _parse_response(raw: str, expected_count: int) -> list[str]:
    """
    WHAT: Extracts the JSON list from the LLM response and validates each category.
    WHY: LLMs occasionally wrap JSON in markdown fences or add prose. Strip and retry
         rather than crashing on formatting noise.
    BREAKS IF REMOVED: Any LLM formatting deviation crashes categorization for the entire batch.
    """
    cleaned = raw.strip()

    # WHY: Strip markdown code fences that some models add despite instructions.
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON: %r — defaulting all to 'diger'", raw[:200])
        return ["diger"] * expected_count

    if not isinstance(parsed, list):
        logger.warning("LLM response was not a list: %r — defaulting all to 'diger'", parsed)
        return ["diger"] * expected_count

    result = []
    for item in parsed:
        cat = str(item).strip().lower()
        result.append(cat if cat in VALID_CATEGORIES else "diger")

    # WHY: Pad or truncate to match transaction count — LLM sometimes returns
    # fewer or more items than requested.
    if len(result) < expected_count:
        result.extend(["diger"] * (expected_count - len(result)))

    return result[:expected_count]


def _distribution(categories: list[str]) -> dict[str, int]:
    dist: dict[str, int] = {}
    for cat in categories:
        dist[cat] = dist.get(cat, 0) + 1
    return dist
