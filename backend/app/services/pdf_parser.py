"""
WHAT: Bank-agnostic PDF/CSV parser with a 3-layer extraction pipeline.
WHY: Many financial institutions generate image-based PDFs — pdfplumber returns empty text on them.
     A layered approach ensures at least one method always produces output:
     Layer 1 (pdfplumber) is fast and free; Layer 3 (vision LLM) reads scanned/image PDFs
     directly off the rendered page; Layer 2 (Tesseract OCR) is the offline fallback when
     no vision-capable key is configured.
BREAKS IF REMOVED: Upload pipeline has no way to extract transaction data from files.
"""

import base64
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
        # NOTE: higher DPI (500/600) and binarization were both trialled on real scanned
        # statements — they recover some faint glyphs but ERASE the thin comma/period
        # separators in amounts ("10.000,00" → "1000000", a 100× error), which is far
        # worse than a dropped row. 400 DPI grayscale preserves separators best.
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


# ─── Layer 3: Vision LLM ──────────────────────────────────────────────────────

# WHY: For image-only PDFs (scanned statements), Tesseract→text→LLM loses the visual
# column structure — the amount and running-balance columns bleed together and the LLM
# can't tell which number is which. A vision model reads the rendered page directly and
# SEES the columns, so it reliably picks the transaction amount over the balance and
# recovers rows whose glyphs Tesseract garbles. This is the right path for scans.

# Vision model for reading scanned statement pages. DeepSeek's deepseek-chat is NOT
# vision-capable, so vision always routes to OpenAI regardless of which provider is
# primary for text.
# gpt-4o-mini is vision-capable and cheap. With page strip tiling (each page split into
# top/bottom halves, enlarging the digits) its column alignment and Turkish-number reads
# improve markedly. gpt-4o is more accurate on dense scans but costs ~10x more; mini is
# the chosen default for cost. Swap to "gpt-4o" here if extraction accuracy on poor-quality
# scans becomes critical.
_VISION_MODEL = "gpt-4o-mini"

# WHY: 150 DPI → ~1650px long edge for a letter/A4 page. The vision model caps the long
# edge at 2048px and downsamples the short edge to ~768px, so rendering much higher just
# inflates the base64 payload without giving the model more detail. 150 DPI reads dense
# 8-9pt rows while keeping each strip well under OpenAI's 20MB image limit.
_VISION_DPI = 150

# Cap pages sent to vision so a 100-page statement can't blow up cost/latency.
_MAX_VISION_PAGES = 25

# Each page is split into a top and a bottom strip before being sent to the vision model.
# WHY: the model downsamples its input to ~768px on the short edge. A full portrait page
# becomes ~768px wide, so the dense numeric columns shrink and digits get misread
# (25.000 → 5.000). Halving the page height roughly doubles the effective width after
# downsampling, so digits are larger and read more accurately. Cost is 2 calls/page.
# A small vertical overlap means a row sitting on the split line still appears whole in
# at least one strip; the per-strip "skip rows cut off at the edge" instruction plus
# full-description + substring dedup keep boundary rows from being double-counted.
# Kept deliberately small (2%): a larger band put whole rows inside BOTH strips, which
# the model then extracted twice with slightly different text — inflating the count and
# expense total. 2% still covers a single row straddling the split line.
_STRIP_OVERLAP_FRAC = 0.02

_VISION_SYSTEM = (
    "You are a precise bank-statement parser that reads statement page images. "
    "Return ONLY a JSON array — no prose, no code fences."
)

_VISION_USER = (
    "This is an image of a horizontal STRIP (a section) of a bank statement page. Extract "
    "EVERY transaction row visible in this strip — do NOT skip rows, summarise, or stop "
    "early.\n\n"
    "NUMBER FORMAT (critical): amounts are in Turkish/European format where '.' is the "
    "THOUSANDS separator and ',' is the DECIMAL separator. Read them as:\n"
    "    826,77      = 826.77\n"
    "    10.000,00   = 10000.00   (ten thousand)\n"
    "    19.486,57   = 19486.57\n"
    "    1.234,56    = 1234.56\n"
    "Output every amount as a plain number with a '.' decimal and NO thousands separator. "
    "NEVER turn '10.000,00' into 10.0 and NEVER turn '19.486,57' into 19.48657.\n\n"
    "COLUMNS (critical): each transaction row ends with TWO numbers in this order:\n"
    "    ...<description>   <TRANSACTION AMOUNT>   <RUNNING BALANCE>\n"
    "The TRANSACTION AMOUNT is the FIRST of the two numbers; the RUNNING BALANCE is the "
    "LAST (rightmost) number. Use ONLY the transaction amount. NEVER report the running "
    "balance as the amount.\n\n"
    "DIRECTION (critical): the transaction amount carries a sign / direction.\n"
    "- A NEGATIVE amount (e.g. '-873,09'), or a purchase / POS / withdrawal / fee, is a "
    '"debit" (money out, an EXPENSE).\n'
    "- A POSITIVE amount (money in) is a \"credit\" (INCOME).\n"
    "- Money RECEIVED from someone — a row showing a sender such as 'Gönd:' / 'Gönderen "
    "<name>', or an incoming FAST / Havale / EFT — is \"credit\" (income).\n"
    "- A transfer you SEND OUT is \"debit\". In particular a 'Virman' to another account "
    "(wording like '... Nolu Hesaba ... Virman', i.e. \"to account\") is an OUTGOING "
    'transfer → "debit", NOT income.\n'
    "- Always include transfers; never report a transfer amount as 0. Use the +/- sign "
    "and the wording to decide direction.\n\n"
    "Return a JSON array, one object per row, with fields:\n"
    '- "date": ISO "YYYY-MM-DD" (convert from whatever format is shown).\n'
    '- "description": the merchant / counterparty text.\n'
    '- "amount": the TRANSACTION amount as a POSITIVE plain number (no sign), dot decimal, '
    "no thousands separator, no currency symbol.\n"
    '- "transaction_type": "credit" or "debit" per the DIRECTION rules above.\n'
    '- "currency": the ISO 4217 code if shown, otherwise null.\n\n'
    "If a transaction row is CUT OFF at the very top or bottom edge of this image (you "
    "cannot read its full description AND amount), SKIP it — it appears complete in the "
    "adjacent strip. Only extract rows you can read in full.\n"
    "Skip header rows and summary/total rows ('Borç:', 'Alacak:', 'Toplam', 'Bakiye'). "
    "Respond with ONLY the JSON array."
)


def _has_vision() -> bool:
    """Vision requires an OpenAI key (gpt-4o). DeepSeek can't do vision."""
    return len(settings.OPENAI_API_KEY) > 0


def _render_clip_png_b64(page, clip, dpi: int = _VISION_DPI) -> str:
    """Render a clipped region of a pymupdf page to a base64-encoded PNG string."""
    import fitz  # pymupdf
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, clip=clip)
    return base64.b64encode(pix.tobytes("png")).decode("ascii")


def _page_strips(page):
    """
    Split a page into a top and a bottom strip (with a small vertical overlap) so each
    strip, after the vision model downsamples it, has larger/clearer digits.
    Returns a list of (label, clip_rect).
    """
    import fitz  # pymupdf
    r = page.rect
    mid = (r.y0 + r.y1) / 2.0
    overlap = (r.y1 - r.y0) * _STRIP_OVERLAP_FRAC
    return [
        ("top", fitz.Rect(r.x0, r.y0, r.x1, mid + overlap)),
        ("bottom", fitz.Rect(r.x0, mid - overlap, r.x1, r.y1)),
    ]


def _vision_call(client, b64: str) -> list[RawTransaction]:
    """One vision API call for a single strip image → parsed transactions."""
    response = client.chat.completions.create(
        model=_VISION_MODEL,
        messages=[
            {"role": "system", "content": _VISION_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _VISION_USER},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64}",
                            "detail": "high",
                        },
                    },
                ],
            },
        ],
        temperature=0,
        # WHY: a dense strip can hold 20+ rows; without a high cap the JSON array gets
        # truncated and the strip is lost. 8000 tokens is ample and within gpt-4o's limit.
        max_tokens=8000,
    )
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) == "length":
        logger.warning("Layer 3: vision response hit the token cap — output may be truncated")
    return _parse_llm_json(choice.message.content or "[]")


def _layer3_vision_extract(contents: bytes) -> list[RawTransaction]:
    """
    WHAT: Renders each PDF page as two horizontal strips (top + bottom) and asks a vision
          LLM to read the transactions off each strip. Results from all strips/pages are
          aggregated; the caller deduplicates.
    WHY: Vision preserves the column layout that OCR-to-text destroys, so the model can
         tell the transaction-amount column from the running-balance column. Splitting
         into strips enlarges the digits after the model's downsampling, cutting misreads.
    BREAKS IF REMOVED: Scanned/image statements fall back to the less accurate
         Tesseract OCR path.
    """
    import fitz  # pymupdf
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    results: list[RawTransaction] = []
    doc = fitz.open(stream=contents, filetype="pdf")
    try:
        n_pages = min(len(doc), _MAX_VISION_PAGES)
        for page_num in range(n_pages):
            page = doc[page_num]
            for label, clip in _page_strips(page):
                b64 = _render_clip_png_b64(page, clip)
                try:
                    strip_txs = _vision_call(client, b64)
                except Exception as exc:
                    logger.error(
                        "Layer 3: vision call failed on page %d %s strip: %s",
                        page_num + 1, label, exc,
                    )
                    continue
                logger.info(
                    "Layer 3: page %d %s strip → %d transactions",
                    page_num + 1, label, len(strip_txs),
                )
                results.extend(strip_txs)
    finally:
        doc.close()

    logger.info("Layer 3: vision extracted %d transactions across %d page(s)", len(results), n_pages)
    return results


# ─── LLM transaction extraction (text → structured JSON) ─────────────────────

_LLM_SYSTEM = (
    "You are a precise bank-statement parser. Extract every financial transaction "
    "from the raw statement text — for ANY bank, country, language, or currency. "
    "Return ONLY a JSON array, nothing else."
)

_LLM_USER_TEMPLATE = """\
Extract ALL transactions from the bank statement text below. The text may be OCR
output with garbled characters — recover what you can.

Many statements are a table laid out as:
    date | (reference) | description | TRANSACTION AMOUNT | RUNNING BALANCE
When a row has TWO numbers like this, the rightmost is the RUNNING BALANCE and the one
just before it is the TRANSACTION AMOUNT. Use the transaction amount, NEVER the running
balance. (When a row has only one number, that is the transaction amount.)

For each transaction return an object with exactly these fields:
- "date": ISO format "YYYY-MM-DD". Convert from whatever format appears in the
  statement (DD.MM.YYYY, MM/DD/YYYY, DD-MM-YYYY, "23 Jun 2026", "Jun 23, 2026", …).
- "description": the merchant / counterparty text, cleaned of column noise.
- "amount": the TRANSACTION amount as a PLAIN POSITIVE number with a dot decimal
  separator, NO thousands separators, NO currency symbol. Convert BOTH "1.234,56"
  (TR/EU) and "1,234.56" (US/UK) to "1234.56". Copy the digits exactly as printed —
  never scale, round, or invent extra zeros.
- "transaction_type": "debit" if money LEFT the account (purchase, withdrawal,
  payment, fee, outgoing transfer) or "credit" if money ENTERED (deposit, salary,
  refund, interest, INCOMING transfer such as FAST / Havale / Virman / EFT / wire).
  Infer from the sign, an explicit debit/credit column, and the surrounding context.
  Do NOT default to "debit" when the context clearly indicates money coming in.
- "currency": the ISO 4217 code of the transaction if it can be determined from the
  statement (e.g. "USD", "EUR", "TRY", "GBP", "JPY"), otherwise null.

Output EXACTLY ONE object per real transaction row — never split one row into two and
never merge two rows. Skip header rows, blank lines, and summary/total rows such as
"Borç:", "Alacak:", "Total", "Balance".

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


def _salvage_truncated_json_array(text: str) -> list | None:
    """
    WHAT: Recovers as many complete objects as possible from a truncated JSON array.
    WHY: A long page can produce a response that gets cut off mid-array; json.loads then
         fails on the whole thing and we'd lose every transaction on that page. Trimming
         to the last complete '}' and closing the bracket salvages the rest.
    Returns the parsed list, or None if nothing usable can be recovered.
    """
    start = text.find("[")
    if start == -1:
        return None
    last_obj_end = text.rfind("}")
    if last_obj_end == -1 or last_obj_end < start:
        return None
    candidate = text[start:last_obj_end + 1] + "]"
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, list):
            logger.warning(
                "Salvaged %d object(s) from truncated JSON array (response was cut off)",
                len(parsed),
            )
            return parsed
    except json.JSONDecodeError:
        return None
    return None


def _parse_llm_json(raw: str) -> list[RawTransaction]:
    """
    WHAT: Parses the LLM's JSON response, strips markdown fences, validates fields.
    WHY: LLMs occasionally wrap JSON in code fences, wrap the array in an object, or get
         truncated — each is handled so one formatting quirk doesn't drop a whole page.
    BREAKS IF REMOVED: Any LLM formatting variation silently drops all transactions.
    """
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(l for l in lines if not l.strip().startswith("```"))
    cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Salvage a truncated array (model hit max_tokens or stopped mid-list): keep
        # everything up to the last complete object and close the array. Without this,
        # ONE oversized/cut-off response silently drops an entire page of transactions.
        parsed = _salvage_truncated_json_array(cleaned)
        if parsed is None:
            logger.warning("LLM returned non-JSON for extraction: %r", raw[:300])
            return []

    # Some models wrap the array in an object, e.g. {"transactions": [...]}. Unwrap the
    # first list value instead of dropping the whole response.
    if isinstance(parsed, dict):
        list_vals = [v for v in parsed.values() if isinstance(v, list)]
        if list_vals:
            parsed = list_vals[0]

    if not isinstance(parsed, list):
        logger.warning("LLM extraction response was not a list (type=%s)", type(parsed).__name__)
        return []

    results = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date", "")).strip()
        description = str(item.get("description", "")).strip()
        amount = _normalise_amount(str(item.get("amount", "")).strip())
        # Accept "transaction_type" (text-LLM schema) or "type" (vision schema).
        tx_type = str(item.get("transaction_type") or item.get("type") or "debit").strip().lower()
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
        # comma is the decimal separator (TR/EU): dots are thousands → drop them.
        s = s.replace(".", "")
        # Multiple commas means OCR/LLM mangled thousands separators — only the last
        # comma is the decimal point (e.g. "9,470,18" → "9470.18").
        if s.count(",") > 1:
            head, _, tail = s.rpartition(",")
            s = head.replace(",", "") + "." + tail
        else:
            s = s.replace(",", ".")
    elif last_dot > last_comma:
        # dot is the decimal separator (US/UK): commas are thousands → drop them.
        s = s.replace(",", "")
        # Multiple dots means dotted thousands (TR balance OCR'd without its comma,
        # e.g. "9.470.18") — only the last dot is the decimal point → "9470.18".
        if s.count(".") > 1:
            head, _, tail = s.rpartition(".")
            s = head.replace(".", "") + "." + tail
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


# ─── XLSX extraction ──────────────────────────────────────────────────────────

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Multilingual header hints — tried FIRST. Value-based inference is the fallback so the
# parser stays GLOBAL (works on banks whose column names we've never seen, and on any
# language). No single bank's column names are required.
_XLSX_DATE_HINTS = (
    "tarih", "date", "datum", "fecha", "data", "dato", "tanggal", "valör", "valeur",
)
_XLSX_DESC_HINTS = (
    "açıklama", "aciklama", "description", "desc", "detay", "detail", "narrative",
    "libelle", "concepto", "verwendungszweck", "beschreibung", "explanation", "memo",
    "note", "işlem", "islem", "reference", "açıklamalar",
)
_XLSX_AMOUNT_HINTS = (
    "tutar", "amount", "montant", "betrag", "importe", "importo", "valor", "miktar",
    "value", "debit", "credit",
)
_XLSX_BALANCE_HINTS = (
    "bakiye", "balance", "saldo", "solde", "kontostand", "available", "guncel bakiye",
)

_XLSX_HEADER_SCAN_ROWS = 15  # how many leading rows to scan for the real header row


def _coerce_number(v: object) -> float | None:
    """Return a float if the cell is numeric (Excel number OR a locale-formatted string),
    else None. Booleans are explicitly rejected (Excel sometimes yields them)."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return float(_normalise_amount(s))
        except (ValueError, ArithmeticError):
            return None
    return None


def _xlsx_date_str(v: object) -> str:
    """Excel date cells come back as datetime/date; emit ISO. Otherwise pass the text
    through (transaction_service._parse_date handles DD.MM.YYYY, ISO, etc.)."""
    from datetime import date as _date, datetime as _datetime
    if isinstance(v, _datetime) or isinstance(v, _date):
        return v.strftime("%Y-%m-%d")
    return "" if v is None else str(v).strip()


def _looks_like_date(v: object) -> bool:
    from datetime import date as _date, datetime as _datetime
    if isinstance(v, (_datetime, _date)):
        return True
    return bool(v) and bool(_DATE_RE.search(str(v)))


def _identify_xlsx_columns(
    header: tuple, data_rows: list[tuple]
) -> tuple[int | None, int | None, int | None]:
    """
    Return (date_idx, desc_idx, amount_idx) for a table. Header keyword hints win; where a
    hint is missing we infer from the column VALUES so the parser stays bank-agnostic:
      - date column  = the column whose cells mostly look like dates
      - amount column = a numeric column, preferring the one carrying negative values
                        (debits) — the running-balance column rarely goes negative
      - desc column  = the remaining column with the longest average text
    """
    n = len(header)
    headers = [str(h).strip().lower() if h is not None else "" for h in header]

    def by_hint(hints: tuple) -> int | None:
        for i, h in enumerate(headers):
            if h and any(k in h for k in hints):
                return i
        return None

    date_idx = by_hint(_XLSX_DATE_HINTS)
    desc_idx = by_hint(_XLSX_DESC_HINTS)
    amount_idx = by_hint(_XLSX_AMOUNT_HINTS)
    balance_idx = by_hint(_XLSX_BALANCE_HINTS)

    # Per-column value profiles for fallback inference.
    date_frac = [0.0] * n
    num_frac = [0.0] * n
    neg_frac = [0.0] * n
    avg_text = [0.0] * n
    for c in range(n):
        total = dt = num = neg = 0
        text_len = 0
        for row in data_rows:
            if c >= len(row):
                continue
            v = row[c]
            if v is None or (isinstance(v, str) and not v.strip()):
                continue
            total += 1
            if _looks_like_date(v):
                dt += 1
            number = _coerce_number(v)
            if number is not None:
                num += 1
                if number < 0:
                    neg += 1
            elif isinstance(v, str):
                text_len += len(v.strip())
        if total:
            date_frac[c] = dt / total
            num_frac[c] = num / total
            neg_frac[c] = neg / total
            avg_text[c] = text_len / total

    if date_idx is None:
        cand = max(range(n), key=lambda c: date_frac[c], default=None)
        if cand is not None and date_frac[cand] >= 0.5:
            date_idx = cand

    if amount_idx is None:
        numeric_cols = [c for c in range(n) if num_frac[c] >= 0.5 and c != balance_idx]
        if numeric_cols:
            # Prefer the numeric column that actually carries debits (negatives); the
            # balance column is excluded above and rarely negative anyway.
            amount_idx = max(numeric_cols, key=lambda c: (neg_frac[c], num_frac[c]))

    # A column can't be two roles at once — re-derive description if it collided.
    if desc_idx is not None and desc_idx in (date_idx, amount_idx):
        desc_idx = None
    if desc_idx is None:
        used = {date_idx, amount_idx, balance_idx}
        cand = max(
            (c for c in range(n) if c not in used),
            key=lambda c: avg_text[c],
            default=None,
        )
        if cand is not None and avg_text[cand] > 0:
            desc_idx = cand

    return date_idx, desc_idx, amount_idx


def _row_has_date_header(row: tuple) -> bool:
    """True if any cell in the row names a date column (tarih/date/… — multilingual).
    Only SHORT cells qualify: a real header label like 'Tarih' is brief, whereas a
    preamble sentence ('… tarihleri arasındaki hesap hareketleri …') also contains the
    word but is not a header."""
    for c in row:
        if isinstance(c, str) and c.strip() and len(c.strip()) <= 30:
            cl = c.strip().lower()
            if any(k in cl for k in _XLSX_DATE_HINTS):
                return True
    return False


def _find_xlsx_table(rows: list[tuple]) -> tuple[int, int | None, int | None, int | None]:
    """
    Locate the header row + the date / description / amount column indices.

    Strategy (bank exports often have title/preamble rows above the table):
      1. Header row = the first row whose cells NAME a date column ('tarih'/'date'/…).
         Columns are then mapped by header name (Tarih→date, Açıklama→description,
         Tutar→amount), with per-column value inference filling anything not named.
      2. If no named header is found, value-based inference over each candidate row:
         a column of datetimes → date, a numeric column (preferring one with negatives)
         → amount, the longest-text column → description, the other numeric → balance.
      3. Last resort: treat row 0 as the header.
    """
    limit = min(len(rows), _XLSX_HEADER_SCAN_ROWS)

    # (1) Named header — first row that mentions a date column.
    for h in range(limit):
        if _row_has_date_header(rows[h]):
            date_idx, desc_idx, amount_idx = _identify_xlsx_columns(rows[h], rows[h + 1:])
            if date_idx is not None and amount_idx is not None and date_idx != amount_idx:
                logger.info(
                    "XLSX: header row=%d (by name) → date=%s desc=%s amount=%s",
                    h, date_idx, desc_idx, amount_idx,
                )
                return h, date_idx, desc_idx, amount_idx

    # (2) Value-based — first candidate row whose data below yields distinct date+amount.
    for h in range(limit):
        date_idx, desc_idx, amount_idx = _identify_xlsx_columns(rows[h], rows[h + 1:])
        if date_idx is not None and amount_idx is not None and date_idx != amount_idx:
            logger.info(
                "XLSX: header row=%d (by value inference) → date=%s desc=%s amount=%s",
                h, date_idx, desc_idx, amount_idx,
            )
            return h, date_idx, desc_idx, amount_idx

    # (3) Last resort.
    if rows:
        date_idx, desc_idx, amount_idx = _identify_xlsx_columns(rows[0], rows[1:])
        logger.warning(
            "XLSX: no header detected — using row 0; date=%s desc=%s amount=%s",
            date_idx, desc_idx, amount_idx,
        )
        return 0, date_idx, desc_idx, amount_idx
    return 0, None, None, None


# Excel built-in numFmt ids that denote dates/times (so a numeric cell is really a date).
_XLSX_BUILTIN_DATE_FMT = {14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47}


def _read_xlsx_rows(contents: bytes) -> list[tuple] | None:
    """
    Read the first worksheet as a list of row tuples. Tries openpyxl first; if openpyxl
    raises (it eagerly parses styles.xml and crashes with errors like 'expected <Fill>' on
    some banks' files), falls back to a dependency-free raw zip+XML reader that bypasses
    style parsing entirely. Returns None only if BOTH readers fail.
    """
    try:
        import openpyxl
        # read_only + data_only is the cheapest mode; keep_vba=False (the default) is set
        # explicitly so a macro-enabled export never drags in extra parsing.
        wb = openpyxl.load_workbook(
            io.BytesIO(contents), read_only=True, data_only=True, keep_vba=False
        )
        try:
            return [row for row in wb.active.iter_rows(values_only=True)]
        finally:
            wb.close()
    except Exception as exc:
        logger.warning("openpyxl could not read xlsx (%s) — using raw zip/XML reader", exc)

    try:
        return _read_xlsx_rows_raw(contents)
    except Exception as exc:
        logger.error("Raw xlsx reader also failed: %s", exc)
        return None


def _col_index_from_ref(ref: str) -> int:
    """'C3' → 2, 'AA10' → 26. Excel cell ref column letters → 0-based index."""
    letters = "".join(ch for ch in ref if ch.isalpha())
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx - 1 if idx else 0


def _excel_serial_to_dt(num: float):
    """Excel date serial → datetime. Base 1899-12-30 absorbs Excel's 1900-leap-year bug
    for all real-world (post-1900) statement dates."""
    from datetime import datetime, timedelta
    return datetime(1899, 12, 30) + timedelta(days=float(num))


def _read_xlsx_rows_raw(contents: bytes) -> list[tuple]:
    """
    Parse an .xlsx as a zip archive directly — shared strings + styles (for date detection)
    + the first worksheet — WITHOUT openpyxl, so a malformed style block can't abort the
    read. Returns row tuples whose date cells are datetime objects (like openpyxl would).
    """
    import zipfile
    import xml.etree.ElementTree as ET

    def localname(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    with zipfile.ZipFile(io.BytesIO(contents)) as z:
        names = set(z.namelist())

        # 1) Shared strings table (cells with t="s" reference these by index).
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            sroot = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in sroot:
                shared.append("".join(
                    t.text or "" for t in si.iter() if localname(t.tag) == "t"
                ))

        # 2) Styles → which cell-format indices are dates (numFmt id or a y/d format code).
        date_style_idx: set[int] = set()
        if "xl/styles.xml" in names:
            st = ET.fromstring(z.read("xl/styles.xml"))
            custom_fmt: dict[str, str] = {}
            cell_xfs = None
            for el in st.iter():
                ln = localname(el.tag)
                if ln == "numFmt":
                    custom_fmt[el.get("numFmtId", "")] = (el.get("formatCode") or "")
                elif ln == "cellXfs":
                    cell_xfs = list(el)
            if cell_xfs is not None:
                for i, xf in enumerate(cell_xfs):
                    fid = xf.get("numFmtId", "")
                    code = custom_fmt.get(fid, "").lower()
                    is_date = (fid.isdigit() and int(fid) in _XLSX_BUILTIN_DATE_FMT) or (
                        "y" in code or "d" in code
                    )
                    if is_date:
                        date_style_idx.add(i)

        # 3) Locate the first worksheet (workbook order via rels; else sorted sheetN).
        sheet_path = _first_sheet_path(z, names, localname)

        sheet_root = ET.fromstring(z.read(sheet_path))
        sheet_data = next(
            (el for el in sheet_root.iter() if localname(el.tag) == "sheetData"), None
        )
        if sheet_data is None:
            return []

        parsed: list[dict[int, object]] = []
        max_col = -1
        for row in sheet_data:
            if localname(row.tag) != "row":
                continue
            cells: dict[int, object] = {}
            # Excel may OMIT the cell ref (`r="C5"`): then cells are positional, in order.
            # Track a running column cursor; an explicit ref resets it (so sparse rows that
            # skip empty columns still land correctly). Advance the cursor for EVERY <c>,
            # including empties, or following cells shift left.
            col_cursor = 0
            for c in row:
                if localname(c.tag) != "c":
                    continue
                ref = c.get("r")
                if ref:
                    col = _col_index_from_ref(ref)
                    col_cursor = col
                else:
                    col = col_cursor
                col_cursor += 1
                max_col = max(max_col, col)

                ctype = c.get("t")
                style = c.get("s")
                if ctype == "inlineStr":
                    txt = "".join(x.text or "" for x in c.iter() if localname(x.tag) == "t")
                    if txt:
                        cells[col] = txt
                    continue
                v = next((x for x in c if localname(x.tag) == "v"), None)
                if v is None or v.text is None:
                    continue  # empty cell — cursor already advanced
                raw = v.text
                if ctype == "s":
                    i = int(raw)
                    cells[col] = shared[i] if 0 <= i < len(shared) else ""
                elif ctype in ("str", "e"):
                    cells[col] = raw
                elif ctype == "b":
                    cells[col] = raw == "1"
                else:
                    try:
                        num = float(raw)
                    except ValueError:
                        cells[col] = raw
                        continue
                    if style is not None and style.isdigit() and int(style) in date_style_idx:
                        cells[col] = _excel_serial_to_dt(num)
                    else:
                        cells[col] = num
            parsed.append(cells)

    width = max_col + 1
    return [tuple(cells.get(i) for i in range(width)) for cells in parsed]


def _first_sheet_path(z, names: set, localname) -> str:
    """Path of the first worksheet in workbook order (via rels), else the lowest sheetN."""
    import xml.etree.ElementTree as ET
    try:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        first_rid = None
        for el in wb.iter():
            if localname(el.tag) == "sheet":
                first_rid = next((v for k, v in el.attrib.items() if localname(k) == "id"), None)
                break
        if first_rid and "xl/_rels/workbook.xml.rels" in names:
            rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            for rel in rels:
                if rel.get("Id") == first_rid:
                    target = rel.get("Target", "")
                    if target.startswith("/"):
                        return target.lstrip("/")      # absolute → relative to zip root
                    if target.startswith("xl/"):
                        return target
                    return "xl/" + target              # relative to xl/ (workbook location)
    except Exception:
        pass
    sheets = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
    return sheets[0] if sheets else "xl/worksheets/sheet1.xml"


def parse_xlsx(contents: bytes) -> ParseResult:
    """
    WHAT: Extracts transactions from an .xlsx bank statement. Reads the first worksheet,
          locates the date / description / amount columns (by multilingual header hints,
          then by value inference so it works for any bank/language), and treats a
          NEGATIVE amount as a debit, POSITIVE as a credit. The running-balance is ignored.
    WHY: Many banks export Excel.
    BREAKS IF REMOVED: .xlsx uploads produce no transactions.
    """
    rows = _read_xlsx_rows(contents)
    if rows is None:
        # Neither openpyxl nor the raw zip reader could read the file.
        return ParseResult([], 1, 0, "xlsx-error", status="failed", reason="parse_error")
    if not rows:
        return ParseResult([], 1, 0, "xlsx", status="empty", reason="unrecognized_format")

    header_idx, date_idx, desc_idx, amount_idx = _find_xlsx_table(rows)
    if date_idx is None or amount_idx is None:
        logger.warning("XLSX: could not identify date/amount columns")
        return ParseResult([], 1, 0, "xlsx", status="empty", reason="unrecognized_format")

    logger.info(
        "XLSX: header row=%d, columns date=%s desc=%s amount=%s",
        header_idx, date_idx, desc_idx, amount_idx,
    )

    transactions: list[RawTransaction] = []
    for row in rows[header_idx + 1:]:
        if amount_idx >= len(row):
            continue
        num = _coerce_number(row[amount_idx])
        if num is None or abs(num) < 0.01:
            continue  # not a transaction row (blank, text, or zero)

        # The date cell must actually look like a date — this drops preamble/title rows
        # and footer summary rows (e.g. "Borç:" / "Toplam") that carry a number but no date.
        if date_idx >= len(row) or not _looks_like_date(row[date_idx]):
            continue
        date_str = _xlsx_date_str(row[date_idx])

        description = ""
        if desc_idx is not None and desc_idx < len(row) and row[desc_idx] is not None:
            description = str(row[desc_idx]).strip()

        # Skip footer summary rows (Borç:/Alacak:/Toplam/Bakiye/total).
        if any(frag in description.lower() for frag in _SUMMARY_DESCRIPTION_FRAGMENTS):
            continue

        transactions.append(RawTransaction(
            date=date_str,
            description=description or "İşlem",
            # Store a positive amount + explicit direction (negative amount = debit).
            amount=_normalise_amount(str(abs(num))),
            transaction_type="debit" if num < 0 else "credit",
        ))

    transactions = _deduplicate(transactions)
    transactions = _filter_zero_amount(transactions)
    logger.info("XLSX parse complete — %d transactions", len(transactions))

    if transactions:
        return ParseResult(
            transactions=transactions, page_count=1, raw_row_count=len(rows),
            source_type="xlsx", status="success",
            detected_currency=_dominant_currency(transactions),
        )
    return ParseResult(
        transactions=[], page_count=1, raw_row_count=len(rows),
        source_type="xlsx", status="empty", reason="unrecognized_format",
    )


# ─── Public entry point ───────────────────────────────────────────────────────

def parse_statement(contents: bytes, content_type: str, filename: str) -> ParseResult:
    """
    WHAT: 3-layer extraction pipeline for PDF; direct regex for CSV.
    WHY: Single entry point — callers never inspect file internals or key availability.
    BREAKS IF REMOVED: Upload endpoint has no dispatch logic.

    Layer 1 — pdfplumber text extraction (fast, free, works on vector/text PDFs)
    Layer 3 — Vision LLM (image-only PDFs; reads the rendered page directly — preferred
              over OCR when an OpenAI vision key is available)
    Layer 2 — Tesseract OCR at 400 DPI (offline fallback when no vision key is set)
    """
    logger.info(
        "Parsing statement — filename=%s content_type=%s size=%d llm_available=%s",
        filename, content_type, len(contents), _has_llm_key(),
    )

    fn = (filename or "").lower()
    is_pdf = content_type == "application/pdf" or fn.endswith(".pdf")

    # Excel exports: dispatch by extension OR the openxml MIME (browsers sometimes send
    # xlsx as application/octet-stream, so extension is the reliable signal).
    if fn.endswith(".xlsx") or content_type == _XLSX_MIME:
        return parse_xlsx(contents)

    if not is_pdf:
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

    # ── Layer 3: Vision LLM (preferred for image-only PDFs) ───────────────────
    # WHY: This is a scanned/image PDF (no usable text layer). A vision model reads
    # the rendered page directly and preserves the column layout, which is far more
    # accurate than Tesseract→text→LLM. Only available when an OpenAI key is set;
    # otherwise we fall through to Layer 2 OCR.
    if _has_vision():
        logger.info(
            "Layer 1 returned %d chars (below %d threshold) — image PDF; trying Layer 3 vision",
            text_chars, _MIN_TEXT_CHARS,
        )
        try:
            vision_txs = _layer3_vision_extract(contents)
        except Exception as exc:
            logger.error("Layer 3: vision extraction failed: %s — falling back to Layer 2 OCR", exc)
            vision_txs = []
        if vision_txs:
            vision_txs = _deduplicate(vision_txs)
            vision_txs = _filter_zero_amount(vision_txs)
            vision_txs = _apply_sign_correction(vision_txs)
            return _finalize(vision_txs, page_count, "pdf-vision-llm", _dominant_currency(vision_txs))
        logger.warning("Layer 3: vision returned 0 transactions — falling back to Layer 2 OCR")

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


def _canon_date_key(raw: str) -> str:
    """
    Canonicalise a date string to 'YYYY-MM-DD' for dedup-key purposes ONLY (the stored
    transaction date is left untouched). The vision model is inconsistent about format
    across strips — ISO here, DD.MM.YYYY there — and without this the same row would key
    differently and survive as a duplicate.
    """
    s = raw.strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$", s)
    if m:
        day, mon, yr = int(m.group(1)), int(m.group(2)), m.group(3)
        if len(yr) == 2:
            yr = "20" + yr
        return f"{yr}-{mon:02d}-{day:02d}"
    return s


def _deduplicate(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """
    WHAT: Removes duplicate transactions using (date, amount, FULL description) as key.
    WHY: OCR occasionally renders the same line twice; the LLM may repeat entries. We key
         on the FULL normalised description, NOT a 30-char prefix: statement rows routinely
         share a long generic prefix ("POS ALIŞVERİŞ KART NO: 6500 **** **** 7028 İŞYERİ:")
         with the distinguishing merchant name only appearing AFTER ~30 chars. A short
         prefix key wrongly merged distinct same-day same-amount purchases at different
         merchants, silently dropping real transactions.
    BREAKS IF REMOVED: Duplicate rows inflate transaction counts and skew coaching analysis.
    """
    seen: set[tuple[str, str, str]] = set()
    result: list[RawTransaction] = []
    for t in transactions:
        # Normalise the description (collapse whitespace + casefold) and the date (the
        # model emits ISO in one strip but DD.MM.YYYY in another for the same row) so the
        # SAME row read twice across the top/bottom strip boundary collapses to one entry,
        # without merging genuinely distinct merchants.
        norm_desc = re.sub(r"\s+", " ", t.description).strip().casefold()
        key = (_canon_date_key(t.date), t.amount, norm_desc)
        if key not in seen:
            seen.add(key)
            result.append(t)
    removed = len(transactions) - len(result)
    if removed:
        logger.warning("Deduplication removed %d exact duplicate transaction(s)", removed)
    return _merge_substring_duplicates(result)


def _merge_substring_duplicates(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """
    WHAT: Within rows sharing the same date + amount, if one row's description is a
          substring of another's, they are the SAME boundary row read twice (one strip
          truncated the merchant text). Keep the longer description, drop the shorter.
    WHY: Strip tiling can read a boundary row in both strips; the truncated copy survives
         exact dedup because its full text differs. This collapses those without merging
         genuinely distinct merchants (whose descriptions are NOT substrings of each other,
         e.g. two different 60,00 charges on the same day stay separate).
    """
    from collections import defaultdict

    norm = [re.sub(r"\s+", " ", t.description).strip().casefold() for t in transactions]
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, t in enumerate(transactions):
        groups[(_canon_date_key(t.date), t.amount)].append(i)

    drop: set[int] = set()
    for idxs in groups.values():
        if len(idxs) < 2:
            continue
        # Longest descriptions first; drop any shorter one contained in a kept longer one.
        for i in sorted(idxs, key=lambda j: len(norm[j]), reverse=True):
            if i in drop:
                continue
            for j in idxs:
                if j == i or j in drop:
                    continue
                if norm[j] and len(norm[j]) < len(norm[i]) and norm[j] in norm[i]:
                    drop.add(j)

    if drop:
        logger.warning("Deduplication merged %d boundary substring duplicate(s)", len(drop))
    return [t for i, t in enumerate(transactions) if i not in drop]


def _filter_zero_amount(transactions: list[RawTransaction]) -> list[RawTransaction]:
    """Drop zero-value rows AND rows whose amount text can't be parsed as a number —
    a single malformed amount must never crash the whole upload."""
    result: list[RawTransaction] = []
    unparseable = 0
    for t in transactions:
        try:
            if abs(float(t.amount)) >= 0.01:
                result.append(t)
        except (ValueError, TypeError):
            unparseable += 1
    removed = len(transactions) - len(result)
    if removed:
        logger.warning(
            "Filtered %d row(s): zero-amount or unparseable (%d unparseable)", removed, unparseable
        )
    return result


# WHY: These keywords appear in the raw description (from OCR or LLM) and override
# the generic _infer_type_from_line heuristic. Checked case-insensitively.
# NOTE: "virman" is intentionally NOT a credit signal — an inter-account virman is
# directionally ambiguous and is usually OUTGOING ("... Nolu Hesaba ... Virman" = "to
# account"), so forcing it to credit double-counted it as income. Direction for virman
# is left to the per-row sign/context (vision prompt + _infer_type_from_line).
_EXPENSE_KEYWORDS = {"pos alışveriş", "sanal pos", "atm p.ç"}
_INCOME_KEYWORDS  = {"gönd:", "fast işlemi", "havale"}


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
