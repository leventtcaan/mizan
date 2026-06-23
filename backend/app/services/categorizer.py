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
import re

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
- faiz — ONLY investment return the bank PAYS YOU: yield/interest on deposits or funds.
  Brazilian: "REND PAGO", "REND PAGO APLIC", "RENDIMENTO". English: "interest", "yield",
  "dividend". If it is something you PAY (a bill, insurance, subscription, purchase, transfer)
  it is NEVER faiz. The words "automatic" / "AUT" / "débito automático" do NOT mean faiz —
  those are usually automatic BILL payments.
- iade — refunds, reversals, chargebacks ("estorno", "devolução", "refund", "iade", "İPTAL").
- vergi — taxes & bank levies ("imposto", "IOF", "tax", "BSMV", "stopaj", "vergi").
- teknoloji — cloud / SaaS / developer & business software: AWS, Google Cloud, Azure,
  GitHub, OpenAI, Anthropic, Adobe, Microsoft 365, hosting, domains.
- diger — use ONLY when you genuinely cannot place it. Do not force a guess.

BRAZILIAN / PORTUGUESE STATEMENTS — common bank patterns and their correct slug:
- "PAY IFD" → iFood, food delivery → restoran
- "ON IFD SUB" → iFood subscription → restoran (a subscription to a food app is still restoran)
- "PAY DL" / "ON DL ..." → delivery/courier; judge by the merchant ("ON DL UberRide" → ulasim, food → restoran)
- "REND PAGO" / "REND PAGO APLIC" / "REND PAGO APLIC AUT MAIS" / "RENDIMENTO" → investment yield → faiz (ALWAYS)
- "PAY CEA" → C&A department store → diger
- "RSHOP" / "RSCSS" → generic card retail purchase → diger
- "FATURA PAGA" → credit-card bill payment → transfer
- "PIX TRANSF <person name>" → person-to-person transfer → transfer
- "ESTORNO" → refund / reversal → iade

faiz is the most over-used mistake — apply these NEGATIVE rules strictly:
- "SEGURO" / "SEGURO CARTAO" → insurance premium you PAY → fatura, NOT faiz
- "DA LIGHT" → electricity utility bill → fatura, NOT faiz
- "DA CEG-GAS" / "CEG" → gas utility bill → fatura, NOT faiz
- "ON IFD SUB" → iFood subscription → restoran, NOT faiz
- "débito automático" (a "DA …" prefix) or anything with "AUT"/"automatic" is an automatic BILL
  payment, NOT investment yield. faiz is ONLY "REND PAGO" / "RENDIMENTO".

A bracketed hint like "[... → fatura]" may be appended to a description to help you — trust it.

Return ONLY a JSON array of slugs, one per transaction, in the SAME order. Nothing else.
"""

_USER_PROMPT_TEMPLATE = """\
Categorize the following transactions. Descriptions may be in any language — reason about
each merchant/purpose semantically, then return exactly one slug per transaction, in the
same order, as a JSON array like ["slug1", "slug2", ...].

Transactions:
{descriptions}
"""


# ── Brazilian / Portuguese pre-processing ────────────────────────────────────
# Bank statements abbreviate aggressively (PAY IFD, REND PAGO APLIC, DA LIGHT...).
# We expand them into the prompt as bracketed hints so the LLM has the meaning, but
# ONLY when the batch actually looks Portuguese/Brazilian — so Turkish/other-language
# statements are never touched. The original Transaction.description is never modified;
# the expansion only affects the text sent to the model.

# Markers chosen to be Portuguese/Brazilian-distinct and NOT collide with Turkish
# (avoid "fatura", "da", "ödeme" etc. which also appear in Turkish statements).
_BR_MARKERS = (
    "pix", "rend pago", "rendimento", "aplic", "estorno", "rscss", "rshop", "ifd",
    "r$", "compra", "saque", "pagamento", "seguro", "débito", "ã", "õ",
)

# (pattern, hint). Ordered: most specific first. Each hint appended at most once.
_BR_PATTERNS = [
    # Specific/multi-word first. Ambiguous ones carry the target slug to stop faiz bleed.
    (re.compile(r"REND\s+PAGO(\s+APLIC\w*)?", re.I), "Rendimento — investment yield / interest income → faiz"),
    (re.compile(r"\bRENDIMENTO\b", re.I), "investment yield / interest income → faiz"),
    (re.compile(r"FATURA\s+PAGA", re.I), "Pagamento de fatura — credit-card bill payment → transfer"),
    (re.compile(r"\bESTORNO\b", re.I), "Estorno — refund / reversal → iade"),
    (re.compile(r"\bSEGURO\b", re.I), "Seguro — insurance premium (recurring bill) → fatura, NOT faiz"),
    (re.compile(r"\bDA\s+LIGHT\b", re.I), "conta de luz — electricity utility bill → fatura, NOT faiz"),
    (re.compile(r"\bCEG\b", re.I), "CEG — gas utility bill → fatura, NOT faiz"),
    (re.compile(r"\bIFD\b", re.I), "iFood — food delivery → restoran"),
    (re.compile(r"\bSUB\b", re.I), "subscription (categorize by the merchant, not faiz)"),
    (re.compile(r"\bDL\b", re.I), "Delivery / courier"),
    (re.compile(r"\bTRANSF\b", re.I), "Transferência — transfer"),
    (re.compile(r"\bPIX\b", re.I), "PIX — instant payment rail"),
    (re.compile(r"\bRSHOP\b", re.I), "card retail purchase → diger"),
    (re.compile(r"\bRSCSS\b", re.I), "card retail purchase → diger"),
    (re.compile(r"\bCEA\b", re.I), "C&A — clothing / department store → diger"),
    (re.compile(r"^\s*DA\s+", re.I), "direct debit — recurring bill payment (NOT investment yield)"),
]


def _looks_brazilian(descriptions: list[str]) -> bool:
    """True when ≥2 distinct Portuguese/Brazilian markers appear across the batch."""
    text = " ".join(descriptions).lower()
    hits = sum(1 for m in _BR_MARKERS if m in text)
    return hits >= 2


def _expand_brazilian(description: str) -> str:
    """Append bracketed expansion hints for any Brazilian abbreviations found."""
    hints: list[str] = []
    for pattern, hint in _BR_PATTERNS:
        if pattern.search(description) and hint not in hints:
            hints.append(hint)
    return f"{description}  [{'; '.join(hints)}]" if hints else description


# Deterministic overrides: some patterns are unambiguous and the LLM keeps getting them
# wrong (DA LIGHT / SEGURO CARTAO drifting into faiz). For these we force the category in
# code and ignore whatever the LLM returns. Patterns are specific enough that they cannot
# collide with other languages, so they run regardless of language detection.
_FORCED_PATTERNS = [
    # Utility bills paid by direct debit ("DA …") → fatura
    (re.compile(r"\bDA\s+(LIGHT|CEG|G[ÁA]S|[ÁA]GUA|AGUA|ENERGIA)\b", re.I), "fatura"),
    # Card / accident / generic insurance → fatura
    (re.compile(r"\bSEGURO\s+(CART[ÃA]O|CART|AP)\b", re.I), "fatura"),
    # iFood subscription → restoran
    (re.compile(r"\bON\s+IFD\s+SUB\b", re.I), "restoran"),
]


def _forced_category(description: str) -> str | None:
    for pattern, category in _FORCED_PATTERNS:
        if pattern.search(description):
            return category
    return None


def _force_categories(descriptions: list[str], transactions=None) -> dict[int, str]:
    """Returns {index: forced_category} for descriptions matching a known override pattern."""
    return {i: cat for i, d in enumerate(descriptions) if (cat := _forced_category(d))}


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

    raw_descs = [t.description for t in transactions]

    # Deterministic overrides for unambiguous patterns the LLM keeps getting wrong.
    # Computed up front so they apply even if the LLM call fails entirely.
    forced = _force_categories(raw_descs, transactions)

    # Language-gated pre-processing: expand Brazilian/Portuguese bank abbreviations into
    # the prompt (as hints) only when the batch looks Portuguese/Brazilian.
    descs = raw_descs
    if _looks_brazilian(raw_descs):
        descs = [_expand_brazilian(d) for d in raw_descs]
        logger.info("Categorizer: Portuguese/Brazilian statement detected — expanded abbreviations")

    descriptions = "\n".join(f"{i + 1}. {d}" for i, d in enumerate(descs))

    prompt = _USER_PROMPT_TEMPLATE.format(descriptions=descriptions)

    try:
        raw_response = provider.complete(prompt)
        categories = _parse_response(raw_response, len(transactions))
    except Exception as exc:
        # WHY: Never let LLM failure crash the upload — raw data is already persisted.
        # User can re-trigger categorization later; losing the upload would be worse.
        # Forced categories are still applied so known patterns are never left uncategorized.
        logger.error("LLM categorization failed: %s — applying forced categories only", exc)
        for idx, cat in forced.items():
            transactions[idx].category = cat
        return transactions

    # Forced categories WIN over the LLM — guaranteed correctness for known patterns.
    for idx, cat in forced.items():
        if 0 <= idx < len(categories):
            categories[idx] = cat

    for transaction, category in zip(transactions, categories):
        transaction.category = category

    logger.info(
        "Categorized %d transactions (%d forced) — distribution: %s",
        len(transactions),
        len(forced),
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
