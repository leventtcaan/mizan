"""
WHAT: Bank-agnostic PDF/CSV parser with a 3-layer extraction pipeline.
WHY: Many financial institutions generate image-based PDFs — pdfplumber returns empty text on them.
     A layered approach ensures at least one method always produces output:
     Layer 1 (pdfplumber) is fast and free; Layer 2 (Tesseract OCR) handles scanned PDFs;
     Layer 3 (vision LLM) is reserved for low-confidence OCR (future).
BREAKS IF REMOVED: Upload pipeline has no way to extract transaction data from files.
"""

import csv
import io
import json
import logging
import re
from dataclasses import dataclass, field

import pdfplumber

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class RawTransaction:
    """
    WHAT: Intermediate representation of one extracted transaction.
    WHY: Decouples parser output from the SQLAlchemy model — transaction_service
         owns the ORM mapping; parser stays free of DB imports.
    """
    date: str
    description: str
    amount: str           # Normalised: digits + dot decimal, e.g. "1234.56"
    transaction_type: str  # "debit" | "credit"
    raw_row: list[str] = field(default_factory=list)
    currency: str | None = None  # ISO code when the statement reveals it, else None


@dataclass
class ParseResult:
    """
    WHAT: Full output of a parse attempt with observability metadata + a user-facing
          outcome (status/reason) so the caller can fail LOUDLY instead of silently.
    WHY: source_type tells operators which layer ran. status/reason tell the USER
         exactly what happened — "encrypted PDF", "scanned image", "unrecognized
         format" — instead of a green "0 transactions" success that looks broken.
    """
    transactions: list[RawTransaction]
    page_count: int
    raw_row_count: int
    source_type: str  # "pdf-text-llm" | "pdf-text-regex" | "pdf-ocr-llm" | "pdf-ocr-regex" | "csv"
    status: str = "success"          # "success" (>0 tx) | "empty" (parsed, 0 tx) | "failed" (error)
    reason: str | None = None        # machine code: encrypted_pdf | scanned_image | ocr_unavailable | unrecognized_format | parse_error
    detected_currency: str | None = None  # dominant ISO currency across transactions, if any


# ─── Shared regex patterns ────────────────────────────────────────────────────

# Global date formats: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD,
# "DD Mon YYYY", "Mon DD, YYYY" (any language month names via the letter class).
_DATE_RE = re.compile(
    r'\b('
    r'\d{4}-\d{1,2}-\d{1,2}'                                  # 2026-06-23 (ISO)
    r'|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}'                       # 23.06.2026 / 06/23/2026 / 23-06-26
    r'|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\.?,?\s+\d{2,4}'    # 23 Jun 2026 / 23 Haziran 2026
    r'|[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}'    # Jun 23, 2026
    r')\b'
)

# Global amount with a 2-digit decimal, in either TR (1.234,56) or US (1,234.56)
# style, with or without thousands separators, optional sign / parentheses.
_AMOUNT_RE = re.compile(r'[-(]?\s*((?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2})\s*\)?')

_SKIP_KEYWORDS = {
    "tarih", "date", "açıklama", "description", "tutar", "amount",
    "bakiye", "balance", "borç", "alacak", "toplam", "total",
    "sayfa", "page", "hesap", "account", "özet", "summary",
}

# WHY: PDF footers repeat running totals as labelled lines (e.g. "Borç: 1.234,56 TL").
# These have a date-like format on the same row sometimes, so _SKIP_KEYWORDS alone
# doesn't catch them — the label appears in the description, not the line start.
_SUMMARY_DESCRIPTION_FRAGMENTS = ("borç:", "alacak:", "toplam", "bakiye", "bekleyen işlemler")

# WHY: 500,000 TRY is an implausibly high single transaction for a retail banking user.
# OCR misreads (e.g. "1" → "7", or merged columns) routinely produce these.
_SUSPICIOUS_AMOUNT_TRY = 500_000

# Minimum non-whitespace chars on a page to consider text extraction successful.
# WHY: Image-based PDFs often have stray characters (page numbers, watermarks)
# that fool pdfplumber into thinking it extracted real text.
_MIN_TEXT_CHARS = 100

# WHY: 3+ consecutive consonants is a reliable signal for OCR garbling in Turkish —
# Turkish phonotactics rarely allow more than 2 consonants in a row.
# Covers: b,c,ç,d,f,g,ğ,h,j,k,l,m,n,p,r,s,ş,t,v,y,z (all Turkish consonants).
_CONSONANT_RUN_RE = re.compile(r"[bcçdfgğhjklmnprsştvy]{3,}", re.IGNORECASE)

# WHY: Characters outside printable Turkish text (letters, digits, common punct, ₺)
# indicate Tesseract substituted ink blobs with random symbols.
_NON_TR_CHAR_RE = re.compile(r"[^\w\s.,/\-:()\[\]₺+&]", re.UNICODE)


# ─── Layer 1: pdfplumber text extraction ──────────────────────────────────────

def _layer1_extract_text(contents: bytes) -> tuple[str, int]:
    """
    WHAT: Attempts to extract selectable text from each PDF page using pdfplumber.
    WHY: Vector/text-based PDFs (some banks' desktop-generated exports) yield perfect
         text here at zero cost. If the PDF is image-based, text will be empty or minimal.
    BREAKS IF REMOVED: No fast path for text-based PDFs; every upload hits Tesseract.
    """
    pages_text: list[str] = []

    with pdfplumber.open(io.BytesIO(contents)) as pdf:
        page_count = len(pdf.pages)
        logger.info("PDF opened — %d pages found", page_count)

        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages_text.append(text)

            if i == 0:
                preview = text[:500].replace("\n", " ↵ ")
                logger.info("Layer 1: page 1 raw text preview (first 500 chars): %s", preview)

    return "\n".join(pages_text), page_count


# ─── Layer 2: Tesseract OCR ───────────────────────────────────────────────────

def _layer2_ocr(contents: bytes, page_count: int) -> str:
    """
    WHAT: Renders each PDF page as a 400 DPI image, preprocesses it, and runs Tesseract OCR.
    WHY: Image-based PDFs (scanned statements, most mobile bank app exports) contain
         no selectable text. pymupdf renders them pixel-perfect; Tesseract reads pixels.
         Turkish language pack (tur) is mandatory — English-only Tesseract misreads
         ş→s, ğ→g, ı→i, which corrupts Turkish merchant names and keywords.
    BREAKS IF REMOVED: Image-based/scanned PDFs yield
                       zero transactions — the whole app is unusable without this.
    """
    import fitz          # pymupdf
    import pytesseract
    from PIL import Image

    pages_text: list[str] = []

    from PIL import ImageEnhance, ImageFilter

    # WHY: --oem 3 = LSTM engine (most accurate modern Tesseract mode).
    # --psm 6 = assume a single uniform block of text — bank statements are
    # laid out in dense rectangular blocks, not columns or mixed layouts.
    _TESS_CONFIG = "--oem 3 --psm 6"

    doc = fitz.open(stream=contents, filetype="pdf")
    for page_num in range(len(doc)):
        page = doc[page_num]
        # WHY: 400 DPI (zoom=400/72 ≈ 5.56) — upgraded from 300 DPI.
        # Some statement PDFs use small fonts (8-9pt); at 300 DPI these are ~33px tall,
        # which is below Tesseract's sweet spot. 400 DPI raises them to ~44px,
        # significantly improving recognition of ş, ğ, ı, ü, ö, ç.
        mat = fitz.Matrix(400 / 72, 400 / 72)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Preprocessing pipeline — each step targets a specific OCR failure mode:
        # 1. Grayscale: removes color noise that Tesseract interprets as ink variation.
        img = img.convert("L")

        # 2. Contrast enhancement (factor 2.0): bank statement PDFs are often low-contrast
        #    (grey text on white, or faded printer output). Factor 2.0 doubles the distance
        #    between foreground and background without over-saturating.
        img = ImageEnhance.Contrast(img).enhance(2.0)

        # 3. Sharpening: OCR errors on digits (1→7, 0→6) are reduced by sharpening
        #    edges before Tesseract samples the image.
        img = img.filter(ImageFilter.SHARPEN)

        # WHY: lang="tur+eng" — Turkish first (dominant), English second (bank codes,
        # SWIFT codes, and international merchant names are often in English).
        text = pytesseract.image_to_string(img, lang="tur+eng", config=_TESS_CONFIG)
        pages_text.append(text)

        if page_num == 0:
            preview = text[:500].replace("\n", " ↵ ")
            logger.info("Layer 2: page 1 OCR text preview (first 500 chars): %s", preview)

    doc.close()
    return "\n".join(pages_text)


# ─── Layer 3: Vision LLM (stub) ───────────────────────────────────────────────

# FUTURE: if OCR confidence is low (pytesseract.image_to_data confidence avg < 60),
# send the page image to a vision-capable LLM (GPT-4o-mini vision, Claude 3 Haiku).
# This handles handwritten amounts, unusual fonts, and rotated text that Tesseract
# cannot reliably decode.
# Requires: openai>=1.51.0 with image input support, or anthropic SDK with vision.
# Cost estimate: ~$0.003 per page with GPT-4o-mini — acceptable for high-value users.


# ─── LLM transaction extraction (text → structured JSON) ─────────────────────

_LLM_SYSTEM = (
    "You are a precise bank-statement parser. Extract every financial transaction "
    "from the raw statement text — for ANY bank, country, language, or currency. "
    "Return ONLY a JSON array, nothing else."
)

_LLM_USER_TEMPLATE = """\
Extract ALL transactions from the bank statement text below.

For each transaction return an object with exactly these fields:
- "date": ISO format "YYYY-MM-DD". Convert from whatever format appears in the
  statement (DD.MM.YYYY, MM/DD/YYYY, DD-MM-YYYY, "23 Jun 2026", "Jun 23, 2026", …).
- "description": the merchant / counterparty text, cleaned of column noise.
- "amount": a PLAIN POSITIVE number using a dot as the decimal separator, with NO
  thousands separators and NO currency symbol. Convert BOTH "1.234,56" (TR/EU) and
  "1,234.56" (US/UK) to "1234.56".
- "transaction_type": "debit" if money LEFT the account (purchase, withdrawal,
  payment, fee, outgoing transfer) or "credit" if money ENTERED (deposit, salary,
  refund, interest, incoming transfer). Infer from the sign, the debit/credit
  column, and the surrounding context. Do NOT default to "debit" when the context
  clearly indicates money coming in.
- "currency": the ISO 4217 code of the transaction if it can be determined from the
  statement (e.g. "USD", "EUR", "TRY", "GBP", "JPY"), otherwise null.

Skip header rows, balance/total/summary rows, and blank lines. If a row has both a
debit and a credit column and one is empty/zero, use the populated one.

Respond with ONLY this JSON array (no prose, no code fences):
[{{"date":"YYYY-MM-DD","description":"...","amount":"1234.56","transaction_type":"debit","currency":"USD"}}]

Bank statement text:
{text}
"""

# WHY: 40k chars ≈ ~10k tokens — covers 20-30 page statements without hitting context limits.
_MAX_TEXT_CHARS = 40_000


def _has_llm_key() -> bool:
    return len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0


def _call_llm_for_extraction(text: str) -> list[RawTransaction]:
    """
    WHAT: Sends raw text (from pdfplumber or OCR) to the LLM, parses JSON response.
    WHY: LLM handles arbitrary layouts — no column position assumptions.
         Works on both Layer 1 and Layer 2 text output.
    BREAKS IF REMOVED: No structured extraction from text; falls back to regex only.
    """
    from app.services.llm_provider import get_provider

    provider = get_provider(task_type="extract")
    prompt = _LLM_USER_TEMPLATE.format(text=text[:_MAX_TEXT_CHARS])

    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": _LLM_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        raw = response.choices[0].message.content or "[]"
    except Exception as exc:
        logger.error("LLM extraction API call failed: %s", exc)
        return []

    return _parse_llm_json(raw)


def _parse_llm_json(raw: str) -> list[RawTransaction]:
    """
    WHAT: Parses the LLM's JSON response, strips markdown fences, validates fields.
    WHY: LLMs occasionally wrap JSON in code fences or add explanatory prose —
         strip-and-retry is more robust than crashing on formatting noise.
    BREAKS IF REMOVED: Any LLM formatting variation silently drops all transactions.
    """
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(l for l in lines if not l.strip().startswith("```"))

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON for extraction: %r", raw[:300])
        return []

    if not isinstance(parsed, list):
        logger.warning("LLM extraction response was not a list")
        return []

    results = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date", "")).strip()
        description = str(item.get("description", "")).strip()
        amount = _normalise_amount(str(item.get("amount", "")).strip())
        tx_type = str(item.get("transaction_type", "debit")).strip().lower()
        cur_raw = item.get("currency")
        currency = str(cur_raw).strip().upper() if cur_raw and str(cur_raw).strip().lower() not in ("none", "null", "") else None
        if currency and (len(currency) != 3 or not currency.isalpha()):
            currency = None
        if not date or not amount:
            continue
        if tx_type not in ("debit", "credit"):
            tx_type = "debit"
        results.append(RawTransaction(
            date=date,
            description=description,
            amount=amount,
            transaction_type=tx_type,
            currency=currency,
        ))

    logger.info("LLM extracted %d transactions from text", len(results))
    return results


# ─── OCR description post-processing ─────────────────────────────────────────

_OCR_CLEANUP_SYSTEM = (
    "You are a multilingual financial statement OCR corrector. "
    "Fix garbled OCR text in transaction descriptions. "
    "Return only JSON, nothing else."
)

_OCR_CLEANUP_TEMPLATE = """\
These are financial transaction descriptions extracted via OCR. Some are garbled due to OCR errors.
Clean each one to readable text in the original language when possible. Keep merchant names and amounts untouched.
If a description is already clean, return it as-is.
Return a JSON array in the same order: [{{"index": 0, "cleaned_description": "..."}}, ...]

Descriptions:
{descriptions_json}
"""


def _needs_cleaning(description: str) -> bool:
    """
    WHAT: Heuristic check for OCR-garbled description text.
    WHY: Avoids sending every clean Layer-1 batch to the LLM — only triggers when
         the description contains patterns that are impossible in valid Turkish text.
    BREAKS IF REMOVED: Every description goes to LLM regardless; 10x wasted tokens.
    """
    if _CONSONANT_RUN_RE.search(description):
        return True
    if _NON_TR_CHAR_RE.search(description):
        return True
    return False


def _parse_cleanup_response(raw: str) -> list[dict]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(l for l in lines if not l.strip().startswith("```"))
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        logger.warning("OCR cleanup LLM returned non-JSON: %r", raw[:200])
        return []


def _ocr_postprocess_descriptions(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """
    WHAT: Sends all OCR-extracted descriptions to the LLM in one batch to fix garbling.
    WHY: Tesseract misreads Turkish chars (ş→s, ğ→g) and produces impossible consonant
         clusters. One LLM call per upload (not per transaction) keeps cost near zero.
         Only fires when at least one description triggers _needs_cleaning — skips
         clean batches entirely.
    BREAKS IF REMOVED: Garbled merchant names like "BANAL POS ALIŞTERİŞ" reach the DB
                       and confuse the coaching LLM's category classification.
    """
    if not transactions or not _has_llm_key():
        return transactions

    if not any(_needs_cleaning(t.description) for t in transactions):
        return transactions

    descriptions_json = json.dumps(
        [t.description for t in transactions], ensure_ascii=False
    )
    prompt = _OCR_CLEANUP_TEMPLATE.format(descriptions_json=descriptions_json)

    from app.services.llm_provider import get_provider
    provider = get_provider(task_type="extract")

    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": _OCR_CLEANUP_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        raw = response.choices[0].message.content or "[]"
    except Exception as exc:
        logger.warning("OCR post-processing LLM call failed: %s — keeping originals", exc)
        return transactions

    cleaned_count = 0
    for item in _parse_cleanup_response(raw):
        idx = item.get("index")
        new_desc = str(item.get("cleaned_description", "")).strip()
        if isinstance(idx, int) and 0 <= idx < len(transactions) and new_desc:
            if new_desc != transactions[idx].description:
                transactions[idx].description = new_desc
                cleaned_count += 1

    logger.info(
        "OCR post-processing: cleaned %d of %d descriptions", cleaned_count, len(transactions)
    )
    return transactions


# ─── Regex extraction (offline fallback for both layers) ─────────────────────

def _normalise_amount(raw: str) -> str:
    """
    WHAT: Converts ANY locale's amount format to a dot-decimal string.
          "1.234,56" → "1234.56" (TR/EU)   "1,234.56" → "1234.56" (US/UK)
          "1234,56" → "1234.56"   "1234.56" → "1234.56"   "(1.234,56)" → "-1234.56"
    WHY:  The app is global — Decimal() only accepts dot-decimal, and the wrong
          separator assumption silently corrupts every non-Turkish amount.
    """
    s = raw.strip().replace(" ", "")
    neg = s.startswith("-") or s.startswith("(")
    s = s.strip("()+-")
    last_comma = s.rfind(",")
    last_dot = s.rfind(".")
    if last_comma > last_dot:
        # comma is the decimal separator (TR/EU): drop dots, comma→dot
        s = s.replace(".", "").replace(",", ".")
    elif last_dot > last_comma:
        # dot is the decimal separator (US/UK): drop commas
        s = s.replace(",", "")
    # else: no separators → already a plain integer string
    return ("-" + s) if neg else s


# Backwards-compatible alias (older callers/tests reference the Turkish name).
def _normalise_turkish_amount(raw: str) -> str:
    return _normalise_amount(raw)


# Bilingual debit/credit signals — money OUT vs money IN. Used only by the offline
# regex fallback; the LLM path infers type per-transaction from full context.
_CREDIT_SIGNALS = {
    "alacak", "yatırma", "gelen", "havale alındı", "maaş", "iade", "faiz",
    "deposit", "salary", "refund", "credit", "received", "incoming", "interest",
    "reversal", "rebate", "payout",
}
_DEBIT_SIGNALS = {
    "borç", "çekim", "ödeme", "alışveriş", "pos", "atm", "komisyon",
    "withdrawal", "purchase", "payment", "fee", "charge", "debit", "sent",
    "transfer to", "bill", "subscription",
}


def _infer_type_from_line(line: str, amount_raw: str = "") -> str:
    """
    Sign-first, then bilingual keywords. A clearly negative amount (leading "-" or
    parentheses) is a debit. Otherwise weigh credit vs debit signals. Only when the
    line gives no signal at all do we fall back to debit (the common case for the
    offline path) — we never blindly mark EVERYTHING debit.
    """
    amt = amount_raw.strip()
    if amt.startswith("-") or amt.startswith("("):
        return "debit"
    lower = line.lower()
    # Word-boundary match so short keywords don't false-positive as substrings
    # (e.g. "pos" must not match inside "de-pos-it").
    def _has(signals: set[str]) -> bool:
        return any(re.search(r"\b" + re.escape(sig) + r"\b", lower) for sig in signals)
    has_credit = _has(_CREDIT_SIGNALS)
    has_debit = _has(_DEBIT_SIGNALS)
    if has_credit and not has_debit:
        return "credit"
    if has_debit and not has_credit:
        return "debit"
    return "debit"


def _extract_with_regex(text: str) -> list[RawTransaction]:
    """
    WHAT: Scans text line-by-line for DD.MM.YYYY + comma-decimal amount patterns.
    WHY: Works with zero dependencies beyond Python stdlib — no API key, no network.
         This is a legacy offline fallback for statements that use DD.MM.YYYY dates
         and comma-decimal amounts on the same line.
    BREAKS IF REMOVED: No offline extraction path; app is unusable without an LLM key.
    """
    results: list[RawTransaction] = []
    total_lines = skipped_header = skipped_no_date = skipped_no_amount = 0

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        total_lines += 1

        lower = stripped.lower()
        if any(kw in lower for kw in _SKIP_KEYWORDS) and not _DATE_RE.search(stripped):
            skipped_header += 1
            continue

        date_match = _DATE_RE.search(stripped)
        if not date_match:
            skipped_no_date += 1
            continue

        amounts = _AMOUNT_RE.findall(stripped)
        if not amounts:
            skipped_no_amount += 1
            continue

        date_str = date_match.group(1).replace("/", ".")
        # WHY: Last amount on the line is the transaction amount; earlier amounts are often running balance
        amount_norm = _normalise_amount(amounts[-1])

        date_end = date_match.end()
        first_amount_pos = stripped.find(amounts[0], date_end)
        if first_amount_pos > date_end:
            description = stripped[date_end:first_amount_pos].strip(" -|:\t")
        else:
            description = _AMOUNT_RE.sub("", stripped[date_end:]).strip(" -|:\t")

        description = description.strip() or "İşlem"

        # Skip PDF footer summary lines — description contains total/balance labels.
        # WHY: OCR output often has leading whitespace so the label is mid-description
        # rather than at line-start; stripping first ensures the match works reliably.
        if any(frag in description.lower() for frag in _SUMMARY_DESCRIPTION_FRAGMENTS):
            skipped_header += 1
            continue

        # Skip rows where the description is trivially short or contains only digits and
        # punctuation — these are page numbers, reference codes, or OCR artifacts, not
        # merchant names.
        stripped_desc = re.sub(r'[\d\s\W]', '', description)
        if len(description.strip()) < 5 or not stripped_desc:
            skipped_header += 1
            continue

        # Fix 2: amount sanity check — flag OCR-inflated amounts without discarding the row.
        # WHY: Discarding would silently lose real large transactions; flagging lets the
        # user verify while keeping the data pipeline intact.
        try:
            amount_float = float(amount_norm)
            if amount_float > _SUSPICIOUS_AMOUNT_TRY:
                logger.warning(
                    "Suspicious amount detected: %.2f TRY on line %r — flagging for verification",
                    amount_float, stripped[:80],
                )
                description = f"{description} [OCR: verify amount]"
        except ValueError:
            pass

        results.append(RawTransaction(
            date=date_str,
            description=description,
            amount=amount_norm,
            transaction_type=_infer_type_from_line(stripped, amounts[-1]),
            raw_row=[stripped],
        ))

    logger.info(
        "Regex scan complete — total_lines=%d skipped_header=%d skipped_no_date=%d "
        "skipped_no_amount=%d matched=%d",
        total_lines, skipped_header, skipped_no_date, skipped_no_amount, len(results),
    )
    return results


# ─── CSV extraction ───────────────────────────────────────────────────────────

def _parse_csv(contents: bytes) -> ParseResult:
    """
    WHAT: Extracts transactions from a CSV bank statement, sniffing delimiter and encoding.
    WHY: CSV exports vary between UTF-8/latin-1 and comma/semicolon delimiters.
         Sniffing handles both without per-bank configuration.
    BREAKS IF REMOVED: CSV statements produce no transactions.
    """
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")
        logger.info("CSV decoded with latin-1 fallback")

    try:
        dialect = csv.Sniffer().sniff(text[:2048])
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
        logger.info("CSV delimiter sniff failed — defaulting to semicolon")

    reader = csv.reader(io.StringIO(text), dialect=dialect)
    transactions: list[RawTransaction] = []
    raw_row_count = 0

    for row in reader:
        if not row:
            continue
        raw_row_count += 1
        line = " ".join(cell.strip() for cell in row)
        transactions.extend(_extract_with_regex(line))

    transactions = _deduplicate(transactions)
    transactions = _filter_zero_amount(transactions)
    transactions = _apply_sign_correction(transactions)
    logger.info("CSV parse complete — %d raw rows, %d transactions", raw_row_count, len(transactions))
    if transactions:
        return ParseResult(
            transactions=transactions, page_count=1, raw_row_count=raw_row_count,
            source_type="csv", status="success",
            detected_currency=_dominant_currency(transactions),
        )
    return ParseResult(
        transactions=[], page_count=1, raw_row_count=raw_row_count,
        source_type="csv", status="empty", reason="unrecognized_format",
    )


# ─── Public entry point ───────────────────────────────────────────────────────

def parse_statement(contents: bytes, content_type: str, filename: str) -> ParseResult:
    """
    WHAT: 3-layer extraction pipeline for PDF; direct regex for CSV.
    WHY: Single entry point — callers never inspect file internals or key availability.
    BREAKS IF REMOVED: Upload endpoint has no dispatch logic.

    Layer 1 — pdfplumber text extraction (fast, free, works on vector PDFs)
    Layer 2 — Tesseract OCR at 300 DPI (handles image-based/scanned PDFs)
    Layer 3 — Vision LLM (stub; for low-confidence OCR in the future)
    """
    logger.info(
        "Parsing statement — filename=%s content_type=%s size=%d llm_available=%s",
        filename, content_type, len(contents), _has_llm_key(),
    )

    if content_type != "application/pdf":
        return _parse_csv(contents)

    # ── Layer 1: pdfplumber text extraction ───────────────────────────────────
    # Catch the two failure classes loudly: password-protected PDFs (pdfminer
    # raises PDFPasswordIncorrect) and otherwise-unreadable/corrupt files. Never
    # let either surface as a raw 500.
    try:
        raw_text, page_count = _layer1_extract_text(contents)
    except Exception as exc:
        emsg = str(exc).lower()
        if "password" in emsg or "encrypt" in emsg or type(exc).__name__ == "PDFPasswordIncorrect":
            logger.error("PDF is password-protected/encrypted: %s", exc)
            return ParseResult([], 0, 0, "pdf-encrypted", status="failed", reason="encrypted_pdf")
        logger.error("Layer 1: PDF could not be opened/read: %s", exc)
        return ParseResult([], 0, 0, "pdf-error", status="failed", reason="parse_error")

    text_chars = len(raw_text.strip())

    if text_chars >= _MIN_TEXT_CHARS:
        logger.info("Layer 1: text extraction successful — %d chars extracted", text_chars)
        transactions, source_suffix, currency = _parse_text(raw_text, layer="1")
        return _finalize(transactions, page_count, f"pdf-text-{source_suffix}", currency)

    # ── Layer 2: Tesseract OCR ────────────────────────────────────────────────
    logger.info(
        "Layer 1: text extraction returned %d chars (below %d threshold) — "
        "switching to Layer 2: OCR via Tesseract",
        text_chars, _MIN_TEXT_CHARS,
    )
    try:
        ocr_text = _layer2_ocr(contents, page_count)
    except Exception as exc:
        logger.error("Layer 2: Tesseract OCR failed: %s", exc)
        return ParseResult([], page_count, 0, "pdf-ocr-failed", status="failed", reason="ocr_unavailable")

    ocr_chars = len(ocr_text.strip())
    logger.info("Layer 2: OCR via Tesseract — %d chars extracted", ocr_chars)
    if ocr_chars < _MIN_TEXT_CHARS:
        # OCR ran but the page yielded almost no text → a scanned image we can't read.
        logger.warning("Layer 2: OCR produced only %d chars — treating as unreadable scan", ocr_chars)
        return ParseResult([], page_count, 0, "pdf-ocr-empty", status="failed", reason="scanned_image")

    transactions, source_suffix, currency = _parse_text(ocr_text, layer="2")
    transactions = _ocr_postprocess_descriptions(transactions)
    return _finalize(transactions, page_count, f"pdf-ocr-{source_suffix}", currency)


def _finalize(
    transactions: list[RawTransaction], page_count: int, source_type: str, currency: str | None
) -> ParseResult:
    """Stamp the user-facing outcome: success (>0), or empty (parsed cleanly, 0 found)."""
    if transactions:
        return ParseResult(
            transactions=transactions, page_count=page_count, raw_row_count=len(transactions),
            source_type=source_type, status="success", detected_currency=currency,
        )
    return ParseResult(
        transactions=[], page_count=page_count, raw_row_count=0,
        source_type=source_type, status="empty", reason="unrecognized_format",
    )


def _deduplicate(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """
    WHAT: Removes duplicate transactions using (date, amount, description[:30]) as key.
    WHY: OCR occasionally renders the same line twice from adjacent pixels; LLM may
         also repeat entries when the same text appears in header and body. A 30-char
         description prefix is enough to distinguish real same-day same-amount entries
         at different merchants while collapsing true duplicates.
    BREAKS IF REMOVED: Duplicate rows inflate transaction counts and skew coaching analysis.
    """
    seen: set[tuple[str, str, str]] = set()
    result: list[RawTransaction] = []
    for t in transactions:
        key = (t.date, t.amount, t.description[:30])
        if key not in seen:
            seen.add(key)
            result.append(t)
    removed = len(transactions) - len(result)
    if removed:
        logger.warning("Deduplication removed %d duplicate transaction(s)", removed)
    return result


def _filter_zero_amount(transactions: list[RawTransaction]) -> list[RawTransaction]:
    result = [t for t in transactions if abs(float(t.amount)) >= 0.01]
    removed = len(transactions) - len(result)
    if removed:
        logger.warning("Filtered %d zero-amount artifact(s)", removed)
    return result


# WHY: These keywords appear in the raw description (from OCR or LLM) and override
# the generic _infer_type_from_line heuristic. Checked case-insensitively.
_EXPENSE_KEYWORDS = {"pos alışveriş", "sanal pos", "atm p.ç"}
_INCOME_KEYWORDS  = {"gönd:", "fast işlemi", "havale", "virman"}


def _apply_sign_correction(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """
    WHAT: Corrects transaction_type based on legacy banking keywords.
    WHY: The regex heuristic (alacak/yatırma keywords) misses POS/ATM lines that
         pdfplumber or OCR output without the Turkish debit/credit column label.
         LLM output also gets this correction because the LLM may infer type from
         description context alone and get it wrong on ambiguous lines.
    BREAKS IF REMOVED: POS ALIŞVERİŞ transactions appear as "credit" in the table,
                       inverting the user's expense/income breakdown.
    """
    for t in transactions:
        lower = (t.description + " ".join(t.raw_row)).lower()
        if any(kw in lower for kw in _EXPENSE_KEYWORDS):
            t.transaction_type = "debit"
        elif any(kw in lower for kw in _INCOME_KEYWORDS):
            t.transaction_type = "credit"
    return transactions


def _dominant_currency(transactions: list[RawTransaction]) -> str | None:
    """Most common non-null currency across the transactions, if the LLM tagged any."""
    counts: dict[str, int] = {}
    for t in transactions:
        if t.currency:
            counts[t.currency] = counts.get(t.currency, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def _parse_text(text: str, layer: str) -> tuple[list[RawTransaction], str, str | None]:
    """
    WHAT: Given extracted text (from pdfplumber or OCR), runs LLM XOR regex extraction,
          then deduplicates and applies sign correction. Returns (txns, source, currency).
    WHY: LLM and regex must never both run on the same text — combined output would
         duplicate every transaction the LLM found that the regex also matched.
         Deduplication is an additional safety net for OCR rendering artifacts.
    BREAKS IF REMOVED: No structured extraction from either source; parse pipeline stalls.
    """
    if _has_llm_key():
        transactions = _call_llm_for_extraction(text)
        source = "llm"
        if not transactions:
            logger.warning("Layer %s: LLM returned 0 transactions — falling back to regex", layer)
            transactions = _extract_with_regex(text)
            source = "regex"
    else:
        transactions = _extract_with_regex(text)
        source = "regex"

    transactions = _deduplicate(transactions)
    transactions = _filter_zero_amount(transactions)
    transactions = _apply_sign_correction(transactions)
    return transactions, source, _dominant_currency(transactions)
