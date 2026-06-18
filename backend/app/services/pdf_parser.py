"""
WHAT: Bank-agnostic PDF/CSV parser with a 3-layer extraction pipeline.
WHY: Turkish banks generate image-based PDFs — pdfplumber returns empty text on them.
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


@dataclass
class ParseResult:
    """
    WHAT: Full output of a parse attempt with observability metadata.
    WHY: source_type tells operators which layer ran — critical for debugging
         when a bank's PDF format changes.
    """
    transactions: list[RawTransaction]
    page_count: int
    raw_row_count: int
    source_type: str  # "pdf-text-llm" | "pdf-text-regex" | "pdf-ocr-llm" | "pdf-ocr-regex" | "csv"


# ─── Shared regex patterns ────────────────────────────────────────────────────

# Matches Turkish date formats: DD.MM.YYYY or DD/MM/YYYY
_DATE_RE = re.compile(r'\b(\d{2}[./]\d{2}[./]\d{4})\b')

# Matches Turkish amount: 1.234,56 (dot=thousands, comma=decimal) or plain 1234,56
_TK_AMOUNT_RE = re.compile(r'\b([\d]{1,3}(?:\.[\d]{3})*,\d{2})\b')

_SKIP_KEYWORDS = {
    "tarih", "date", "açıklama", "description", "tutar", "amount",
    "bakiye", "balance", "borç", "alacak", "toplam", "total",
    "sayfa", "page", "hesap", "account", "özet", "summary",
}

# Minimum non-whitespace chars on a page to consider text extraction successful.
# WHY: Image-based PDFs often have stray characters (page numbers, watermarks)
# that fool pdfplumber into thinking it extracted real text.
_MIN_TEXT_CHARS = 100


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
    WHAT: Renders each PDF page as a 300 DPI image and runs Tesseract OCR on it.
    WHY: Image-based PDFs (scanned statements, most mobile bank app exports) contain
         no selectable text. pymupdf renders them pixel-perfect; Tesseract reads pixels.
         Turkish language pack (tur) is mandatory — English-only Tesseract misreads
         ş→s, ğ→g, ı→i, which corrupts Turkish merchant names and keywords.
    BREAKS IF REMOVED: Image-based PDFs (majority of Turkish bank statements) yield
                       zero transactions — the whole app is unusable without this.
    """
    import fitz          # pymupdf
    import pytesseract
    from PIL import Image

    pages_text: list[str] = []

    doc = fitz.open(stream=contents, filetype="pdf")
    for page_num in range(len(doc)):
        page = doc[page_num]
        # WHY: 300 DPI (zoom=300/72 ≈ 4.17) — Tesseract accuracy degrades below 200 DPI.
        # 300 DPI is the standard for OCR; higher DPI costs more memory with diminishing returns.
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # WHY: lang="tur+eng" — Turkish first (dominant), English second (bank codes,
        # SWIFT codes, and international merchant names are often in English).
        text = pytesseract.image_to_string(img, lang="tur+eng")
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
    "Sen bir banka ekstresi ayrıştırıcısısın. "
    "Verilen ham metin içindeki finansal işlemleri JSON formatında döndür. "
    "Sadece JSON döndür, başka hiçbir şey yazma."
)

_LLM_USER_TEMPLATE = """\
Aşağıdaki banka ekstresi metninden tüm işlemleri çıkar.

Kurallar:
- Her işlem için: date (DD.MM.YYYY), description, amount (sadece rakam ve nokta, ör. "125.50"), transaction_type ("debit" veya "credit")
- Türkçe format: 1.234,56 → "1234.56" olarak normalize et (noktayı kaldır, virgülü noktaya çevir)
- "Borç", "Çekim", "Ödeme" → debit; "Alacak", "Yatırma", "Gelen" → credit
- Header satırları, bakiye satırları ve boş satırları atla
- Eğer bir satırda hem borç hem alacak sütunu varsa ve biri 0 veya boşsa, dolu olanı kullan

Yanıt formatı (başka hiçbir şey ekleme):
[{{"date":"DD.MM.YYYY","description":"...","amount":"...","transaction_type":"debit|credit"}}, ...]

Banka ekstresi metni:
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
        amount = str(item.get("amount", "")).strip()
        tx_type = str(item.get("transaction_type", "debit")).strip().lower()
        if not date or not amount:
            continue
        if tx_type not in ("debit", "credit"):
            tx_type = "debit"
        results.append(RawTransaction(
            date=date,
            description=description,
            amount=amount,
            transaction_type=tx_type,
        ))

    logger.info("LLM extracted %d transactions from text", len(results))
    return results


# ─── Regex extraction (offline fallback for both layers) ─────────────────────

def _normalise_turkish_amount(raw: str) -> str:
    """
    WHAT: Converts Turkish amount format (1.234,56) to dot-decimal string (1234.56).
    WHY: Decimal("1.234,56") crashes — normalisation must happen before any Decimal() call.
    BREAKS IF REMOVED: transaction_service crashes on every amount from Turkish PDFs.
    """
    return raw.replace(".", "").replace(",", ".")


def _infer_type_from_line(line: str) -> str:
    lower = line.lower()
    credit_signals = {"alacak", "yatırma", "gelen", "havale alındı", "maaş", "iade"}
    for signal in credit_signals:
        if signal in lower:
            return "credit"
    return "debit"


def _extract_with_regex(text: str) -> list[RawTransaction]:
    """
    WHAT: Scans text line-by-line for DD.MM.YYYY + Turkish amount patterns.
    WHY: Works with zero dependencies beyond Python stdlib — no API key, no network.
         Covers Ziraat, Garanti, Akbank, İş Bankası, Yapı Kredi whose statements
         all use DD.MM.YYYY dates and Turkish decimal format on the same line.
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

        amounts = _TK_AMOUNT_RE.findall(stripped)
        if not amounts:
            skipped_no_amount += 1
            continue

        date_str = date_match.group(1).replace("/", ".")
        # WHY: Last amount on the line is the transaction amount; earlier amounts are often running balance
        amount_norm = _normalise_turkish_amount(amounts[-1])

        date_end = date_match.end()
        first_amount_pos = stripped.find(amounts[0], date_end)
        if first_amount_pos > date_end:
            description = stripped[date_end:first_amount_pos].strip(" -|:\t")
        else:
            description = _TK_AMOUNT_RE.sub("", stripped[date_end:]).strip(" -|:\t")

        results.append(RawTransaction(
            date=date_str,
            description=description or "İşlem",
            amount=amount_norm,
            transaction_type=_infer_type_from_line(stripped),
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
    WHY: Turkish bank CSVs vary between UTF-8/latin-1 and comma/semicolon delimiters.
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

    logger.info("CSV parse complete — %d raw rows, %d transactions", raw_row_count, len(transactions))
    return ParseResult(
        transactions=transactions,
        page_count=1,
        raw_row_count=raw_row_count,
        source_type="csv",
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
    raw_text, page_count = _layer1_extract_text(contents)
    text_chars = len(raw_text.strip())

    if text_chars >= _MIN_TEXT_CHARS:
        logger.info("Layer 1: text extraction successful — %d chars extracted", text_chars)
        transactions, source_suffix = _parse_text(raw_text, layer="1")
        return ParseResult(
            transactions=transactions,
            page_count=page_count,
            raw_row_count=len(transactions),
            source_type=f"pdf-text-{source_suffix}",
        )

    # ── Layer 2: Tesseract OCR ────────────────────────────────────────────────
    logger.info(
        "Layer 1: text extraction returned %d chars (below %d threshold) — "
        "switching to Layer 2: OCR via Tesseract",
        text_chars, _MIN_TEXT_CHARS,
    )
    try:
        ocr_text = _layer2_ocr(contents, page_count)
    except Exception as exc:
        logger.error("Layer 2: Tesseract OCR failed: %s — returning empty result", exc)
        return ParseResult(transactions=[], page_count=page_count, raw_row_count=0, source_type="pdf-ocr-failed")

    logger.info("Layer 2: OCR via Tesseract — %d chars extracted", len(ocr_text.strip()))
    transactions, source_suffix = _parse_text(ocr_text, layer="2")

    # ── Layer 3: Vision LLM (stub) ────────────────────────────────────────────
    # FUTURE: if OCR confidence low, send image to vision LLM
    # Requires: OpenAI GPT-4o-mini or similar vision-capable model

    return ParseResult(
        transactions=transactions,
        page_count=page_count,
        raw_row_count=len(transactions),
        source_type=f"pdf-ocr-{source_suffix}",
    )


def _parse_text(text: str, layer: str) -> tuple[list[RawTransaction], str]:
    """
    WHAT: Given extracted text (from pdfplumber or OCR), runs LLM or regex extraction.
    WHY: Both Layer 1 and Layer 2 produce text strings — the downstream parse logic
         is identical regardless of which layer produced the text.
    """
    if _has_llm_key():
        transactions = _call_llm_for_extraction(text)
        if transactions:
            return transactions, "llm"
        logger.warning("Layer %s: LLM returned 0 transactions — falling back to regex", layer)

    transactions = _extract_with_regex(text)
    return transactions, "regex"
