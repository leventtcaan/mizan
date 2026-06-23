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
    "faiz",
    "iade",
    "vergi",
    "teknoloji",
    "diger",
}

_SYSTEM_PROMPT = """\
You are a financial transaction categorizer that works for ANY country and ANY language.
Descriptions may be in Turkish, Portuguese, English, German, Spanish, French, Arabic, etc.,
and usually contain merchant names, bank abbreviations, and payment-rail codes.

HOW TO REASON (do NOT keyword-match):
1. Infer the statement's language from the descriptions.
2. For each line, work out semantically WHAT the merchant or transaction actually is —
   expand bank abbreviations mentally (e.g. "PAY IFD" → iFood; "REND PAGO" → rendimento/yield;
   "RSHOP" → a card purchase, judged by the rest of the line).
3. Map that meaning to exactly ONE slug from this fixed list:
market, restoran, ulasim, fatura, saglik, giyim, eglence, nakit_atm, transfer, faiz, iade, vergi, teknoloji, diger

WHAT EACH SLUG MEANS (match by meaning, in any language):
- market — groceries, supermarkets, convenience stores (Migros, BIM, Carrefour, Walmart,
  Pão de Açúcar, Rewe, Mercadona; words like "mercado", "market", "supermarkt", "épicerie").
- restoran — restaurants, cafes, bars AND food delivery in any country: iFood, Uber Eats,
  Rappi, Deliveroo, Glovo, Just Eat, DoorDash, Yemeksepeti, Getir Yemek (e.g. "PAY IFD" = iFood).
- ulasim — transport & fuel: ride-hailing (Uber, Bolt, Cabify, Lyft, 99, BiTaksi), transit,
  taxis, fuel/gas stations (Shell, BP, Petrobras, Ipiranga, Opet).
- fatura — recurring bills AND digital subscriptions: utilities (electricity, water, gas,
  internet, phone) AND streaming/app subscriptions: Netflix, Spotify, Apple, Google Play,
  Amazon Prime, YouTube Premium, Disney+.
- saglik — health: pharmacy (farmácia, eczane, pharmacy, apotheke, farmacia), hospital,
  clinic, doctor, dentist, lab, optician.
- giyim — clothing, shoes, apparel (Zara, H&M, Renner, Riachuelo, Nike, Boyner).
- eglence — entertainment & leisure: cinema, theatre, concerts, events, video games,
  gyms / fitness studios.
- nakit_atm — ATM withdrawals, cash advances ("saque", "ATM", "nakit", "retrait").
- transfer — money moved between PEOPLE via any rail (PIX, Zelle, FAST, Havale, EFT, wire,
  SEPA). IMPORTANT: a payment rail alone is NOT a transfer — if the counterparty is a
  MERCHANT or marketplace (e.g. "PIX ... Marketplace"), categorize by the merchant instead.
- faiz — interest / yield / finance income the bank pays the USER: "REND PAGO",
  "rendimento", "interest", "yield", "dividend", "faiz geliri", automatic-investment returns.
- iade — refunds, reversals, chargebacks ("estorno", "devolução", "refund", "iade", "İPTAL").
- vergi — taxes & bank levies ("imposto", "IOF", "tax", "BSMV", "stopaj", "vergi").
- teknoloji — cloud / SaaS / developer & business software: AWS, Google Cloud, Azure,
  GitHub, OpenAI, Anthropic, Adobe, Microsoft 365, hosting, domains.
- diger — use ONLY when you genuinely cannot place it. Do not force a guess.

Return ONLY a JSON array of slugs, one per transaction, in the SAME order. Nothing else.
"""

_USER_PROMPT_TEMPLATE = """\
Categorize the following transactions. Descriptions may be in any language — reason about
each merchant/purpose semantically, then return exactly one slug per transaction, in the
same order, as a JSON array like ["slug1", "slug2", ...].

Transactions:
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
