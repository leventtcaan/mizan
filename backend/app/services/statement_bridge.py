"""
WHAT: The cash-flow ↔ net-worth bridge. After a statement is parsed, deterministically
      detect its closing/account balance + kind (deposit vs credit card) + institution,
      then propose a net-worth action: add it as an asset, add it as a liability, or
      update a MATCHING existing asset's balance.
WHY:  Uploading a statement should feed net worth, not just spending. This is the link
      between the two halves of the product. Fully deterministic — NO LLM calls.
BREAKS IF REMOVED: Upload no longer suggests turning a statement into an asset/liability.
"""

import io
import json
import logging
import re
from datetime import date as _date, datetime as _datetime
from decimal import Decimal
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.asset import Asset
from app.models.networth_suggestion import NetworthSuggestion
from app.services.llm_provider import get_provider
from app.services.pdf_parser import (
    _AMOUNT_RE, _DATE_RE, _normalise_amount, _read_xlsx_rows,
    _XLSX_BALANCE_HINTS, _XLSX_DATE_HINTS,
)

logger = logging.getLogger(__name__)

# ── Statement-kind classification ─────────────────────────────────────────────
# STRUCTURAL credit-card markers (header/summary fields), NOT transaction descriptions
# — so a deposit statement that merely contains a "credit-card payment" transaction is
# never misclassified as a credit card. Multilingual (EN + TR).
_CC_STRONG = (
    "minimum payment", "minimum amount due", "asgari ödeme", "asgari odeme", "asgari tutar",
    "pagamento mínimo", "pagamento minimo", "pago mínimo", "pago minimo",  # PT/ES
    "paiement minimum", "mindestbetrag",                                    # FR/DE
)
_CC_MARKERS = _CC_STRONG + (
    "credit limit", "kredi limiti", "kullanılabilir limit", "kullanilabilir limit",
    "available credit", "statement balance", "ekstre bakiyesi", "dönem borcu", "donem borcu",
    "son ödeme tarihi", "payment due date", "ekstre kesim", "credit card statement",
    "kredi kartı ekstre", "kredi karti ekstre",
    # PT (fatura) / ES (tarjeta) / FR / DE
    "limite de crédito", "limite de credito", "limite total", "total da fatura",
    "vencimento da fatura", "fatura vencimento", "saldo devedor", "melhor dia de compra",
    "límite de crédito", "limite de la tarjeta", "pago total", "fecha de vencimiento",
    "limite de paiement", "kreditkarte", "kreditlimit",
)

# Labelled-balance keys for a DEPOSIT account (funds you HAVE). ORDER IS PRIORITY:
# the *true* current account-balance terms come FIRST; the generic "balance/saldo" word
# next; and the easily-confused "available" terms (which often fold in an overdraft/credit
# limit — e.g. Itaú's "saldo disponível" or "limite da conta disponível") come LAST, so a
# real "saldo em conta" always outranks an available-credit figure.
_DEPOSIT_BALANCE_KEYS = (
    # tier 1 — unambiguous current/closing account balance
    "closing balance", "ending balance", "account balance", "current balance", "new balance",
    "hesap bakiyesi", "kapanış bakiyesi", "kapanis bakiyesi", "kapanış bakiye", "kapanis bakiye",
    "güncel bakiye", "guncel bakiye", "son bakiye", "mevcut bakiye",
    "saldo em conta", "saldo da conta", "saldo em c/c", "saldo final", "saldo atual",
    "saldo contábil", "saldo contabil", "saldo total", "saldo en cuenta", "saldo de la cuenta",
    "solde du compte", "solde final", "kontostand", "kontosaldo",
    # tier 2 — the bare balance word (any language)
    "saldo", "solde", "bakiye", "balance",
    # tier 3 — "available" terms, last resort (may include overdraft/credit headroom)
    "available balance", "kullanılabilir bakiye", "kullanilabilir bakiye",
    "saldo disponível", "saldo disponivel", "solde disponible",
)

# A balance line that mentions a credit limit / available credit / overdraft, OR an
# OPENING/PREVIOUS balance, is NOT the current account balance. Skip such lines when
# scanning for a deposit balance (NOT applied to credit-card statements, where the whole
# page is credit).
_BALANCE_LINE_EXCLUDE = (
    # credit limit / available credit / overdraft
    "limit", "limite", "límite", "available credit", "crédit disponible", "credito disponible",
    "crédito disponível", "credito disponivel", "kredi limiti", "kullanılabilir kredi",
    "kullanilabilir kredi", "cheque especial", "overdraft", "verfügbarer kredit", "kreditlimit",
    # opening / previous balance (the figure at the START of the period, not the current one)
    "saldo anterior", "saldo inicial", "previous balance", "opening balance", "beginning balance",
    "solde précédent", "solde precedent", "solde initial", "anfangssaldo", "önceki bakiye",
    "onceki bakiye", "devir bakiye", "açılış bakiye", "acilis bakiye",
)
# For a CREDIT CARD the relevant figure is the amount OWED.
_OWED_BALANCE_KEYS = (
    "statement balance", "ekstre bakiyesi", "dönem borcu", "donem borcu",
    "current balance", "new balance", "güncel borç", "guncel borc",
    "toplam borç", "toplam borc",
    # PT/ES total owed on a card statement
    "total da fatura", "valor total da fatura", "saldo devedor", "pago total", "total a pagar",
    "bakiye", "balance",
)

_BANK_MARKERS = (
    "bank", "banka", "bankası", "bankasi", "finansbank", "katılım", "katilim",
    "banco", "banque",  # PT/ES/IT · FR
)
_DEPOSIT_ASSET_TYPES = ("cash", "bank_account", "foreign_currency")

# A cell that IS a date (whole-cell), so it can't be mistaken for a numeric column value.
_DATE_CELL = re.compile(r"^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s*$")


def _extract_pdf_text(contents: bytes) -> str:
    """PDF text layer (first 2 + last 2 pages — where balances live). No OCR: a scanned
    PDF with no text layer simply yields '' and the bridge is skipped."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            pages = pdf.pages
            n = len(pages)
            idxs = sorted(set(list(range(min(2, n))) + list(range(max(0, n - 2), n))))
            parts = []
            for i in idxs:
                try:
                    parts.append(pages[i].extract_text() or "")
                except Exception:
                    pass
            return "\n".join(parts)
    except Exception:
        return ""


def _iso(c: object) -> str:
    if isinstance(c, (_datetime, _date)):
        return c.strftime("%Y-%m-%d")
    return "" if c is None else str(c)


# Trailing/leading isolated D / C after a number — the Brazilian (Itaú) & EU bank
# convention for débito (negative) / crédito (positive). Sign is carried as a LETTER,
# not a minus, so without this the amount column reads all-positive and the signed
# running-balance check can never match a debit row.
_SUFFIX_DEBIT_RE = re.compile(r"[\d)]\s*[Dd]\s*$")
_SUFFIX_CREDIT_RE = re.compile(r"[\d)]\s*[Cc]\s*$")


def _cell_num(v: object) -> float | None:
    """Numeric value of a cell (native Excel number OR a locale-formatted string), else
    None. Dates and text reject to None so they can't pollute column detection. A trailing
    'D'/'C' debit/credit marker (Brazilian/EU statements) is applied as the sign."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (_datetime, _date)):
        return None
    s = str(v or "").strip()
    if not s or _DATE_CELL.match(s):
        return None

    def _apply_suffix_sign(text: str, base: float) -> float:
        # Only meaningful for an otherwise-unsigned magnitude; 'D' → negative.
        if base >= 0 and _SUFFIX_DEBIT_RE.search(text) and not _SUFFIX_CREDIT_RE.search(text):
            return -base
        return base

    m = _AMOUNT_RE.search(s)               # a value with a 2-digit decimal
    if m:
        try:
            return _apply_suffix_sign(s, float(_normalise_amount(m.group(1))))
        except Exception:
            return None
    cleaned = s.replace(" ", "")           # a plain/grouped integer ("5000", "5.000")
    if re.fullmatch(r"[-(]?\d{1,3}(?:[.,]\d{3})*\)?", cleaned):
        try:
            return _apply_suffix_sign(s, float(_normalise_amount(cleaned)))
        except Exception:
            return None
    return None


def _load_grid(contents: bytes, content_type: str | None, filename: str):
    """(str_rows, num_rows) for a CSV/XLSX statement. str cells feed keyword scans; num
    cells (float|None) feed the running-balance delta detector. XLSX reuses the parser's
    reader (openpyxl + raw zip/XML fallback) so style-malformed exports are still read."""
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    raw_rows: list = []
    if "csv" in ct or name.endswith(".csv"):
        text = ""
        for enc in ("utf-8", "latin-1"):
            try:
                text = contents.decode(enc)
                break
            except Exception:
                continue
        if not text:
            return [], []
        try:
            import csv
            sample = text[:2000]
            delim = ";" if sample.count(";") > sample.count(",") else ","
            raw_rows = [list(r) for r in csv.reader(io.StringIO(text), delimiter=delim)][:400]
        except Exception:
            return [], []
    elif "xlsx" in ct or name.endswith(".xlsx") or "spreadsheet" in ct:
        try:
            raw_rows = [list(r) for r in (_read_xlsx_rows(contents) or [])][:400]
        except Exception:
            return [], []
    else:
        return [], []
    str_rows = [[_iso(c) for c in r] for r in raw_rows]
    num_rows = [[_cell_num(c) for c in r] for r in raw_rows]
    return str_rows, num_rows


def _columns_descending(str_rows: list[list[str]] | None, n: int) -> bool:
    """Is the statement ordered newest→oldest top-down? Picks the column with the most
    parseable dates and compares its first vs last date. Default False (assume oldest first,
    so current balance is the BOTTOM row) when there's no usable date column."""
    if not str_rows:
        return False
    ncols = max((len(r) for r in str_rows), default=0)
    best_col, best_count = None, 0
    for c in range(ncols):
        cnt = sum(
            1 for i in range(len(str_rows))
            if c < len(str_rows[i]) and _date_key(str_rows[i][c]) is not None
        )
        if cnt > best_count:
            best_count, best_col = cnt, c
    if best_col is None or best_count < 2:
        return False
    keys = [
        _date_key(str_rows[i][best_col])
        for i in range(len(str_rows)) if best_col < len(str_rows[i])
    ]
    keys = [k for k in keys if k]
    return len(keys) >= 2 and keys[0] > keys[-1]


def _running_balance(
    num_rows: list[list[float | None]], str_rows: list[list[str]] | None = None
) -> float | None:
    """THE robust balance detector (no header keyword needed): find a column B and an amount
    column A such that, row to row, B changes by A — i.e. B is a running balance.

    Phase 1 (SIGNED, preferred): B[i] - B[neighbour] == A[i]. Because the sign only lines up
    one way, the direction that matches tells us which end is current:
      - chronological (oldest→newest top-down): B[i] = B[i-1] + A[i]  → current = BOTTOM
      - reverse-chron (newest first, top-down):  B[i] = B[i+1] + A[i]  → current = TOP

    Phase 2 (MAGNITUDE, fallback): many statements (e.g. Brazilian Itaú) carry the debit/
    credit sign as a separate column or a 'D'/'C' letter, so the amount column reads
    unsigned. Then only |B[i] - B[i-1]| == |A[i]| holds. Magnitude is direction-symmetric,
    so the current end is taken from the DATE column order instead of the sign.

    Returns the current balance, or None if no running relationship is confidently found."""
    n = len(num_rows)
    if n < 3:
        return None

    def cell(i: int, c: int) -> float | None:
        if not (0 <= i < n):
            return None
        r = num_rows[i]
        return r[c] if c < len(r) else None

    ncols = max((len(r) for r in num_rows), default=0)
    numeric_cols = [
        c for c in range(ncols)
        if sum(1 for i in range(n) if cell(i, c) is not None) >= max(3, n * 0.5)
    ]

    def _end_value(B: int, from_bottom: bool) -> float | None:
        rng = range(n - 1, -1, -1) if from_bottom else range(n)
        return next((cell(i, B) for i in rng if cell(i, B) is not None), None)

    # ── Phase 1: signed (unambiguous direction) ──────────────────────────────
    best: tuple[float, float] | None = None  # (confidence, current_value)
    for B in numeric_cols:
        for A in numeric_cols:
            if A == B:
                continue
            for chron in (True, False):
                hits = comps = 0
                for i in range(n):
                    bi, ai = cell(i, B), cell(i, A)
                    if bi is None or ai is None:
                        continue
                    nb = cell(i - 1, B) if chron else cell(i + 1, B)
                    if (chron and i == 0) or (not chron and i == n - 1) or nb is None:
                        continue
                    comps += 1
                    if abs((bi - nb) - ai) <= max(0.02, abs(ai) * 0.02):
                        hits += 1
                if comps >= 2 and hits >= 2 and hits / comps >= 0.6:
                    cur = _end_value(B, from_bottom=chron)
                    if cur is not None and (best is None or hits / comps > best[0]):
                        best = (hits / comps, cur)
    if best is not None:
        return round(abs(best[1]), 2)

    # ── Phase 2: magnitude (unsigned amount column); direction from date order ─
    descending = _columns_descending(str_rows, n)
    best_mag: tuple[float, float, float] | None = None  # (conf, mean_abs(B), current)
    for B in numeric_cols:
        b_abs = [abs(cell(i, B)) for i in range(n) if cell(i, B) is not None]
        mean_abs = sum(b_abs) / len(b_abs) if b_abs else 0.0
        for A in numeric_cols:
            if A == B:
                continue
            hits = comps = 0
            for i in range(1, n):
                bi, ai, nb = cell(i, B), cell(i, A), cell(i - 1, B)
                if bi is None or ai is None or nb is None:
                    continue
                comps += 1
                if abs(abs(bi - nb) - abs(ai)) <= max(0.02, abs(ai) * 0.02):
                    hits += 1
            if comps >= 2 and hits >= 2 and hits / comps >= 0.6:
                conf = hits / comps
                cur = _end_value(B, from_bottom=not descending)
                if cur is not None and (
                    best_mag is None or (conf, mean_abs) > (best_mag[0], best_mag[1])
                ):
                    best_mag = (conf, mean_abs, cur)
    return round(abs(best_mag[2]), 2) if best_mag else None


def _date_key(v: object):
    if isinstance(v, (_datetime, _date)):
        return (v.year, v.month, v.day)
    s = str(v or "").strip()
    m = re.match(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return (y + 2000 if y < 100 else y, mo, d)
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _balance_by_header_order(str_rows: list[list[str]], num_rows: list[list[float | None]]) -> float | None:
    """Fallback when amounts aren't signed (so the delta check can't run): take the balance
    column NAMED in the header, and use the date column's direction to decide which end is
    current (ascending dates → bottom; descending → top)."""
    bcol = hdr = None
    for hi in range(min(15, len(str_rows))):
        for ci, cell in enumerate(str_rows[hi]):
            cl = str(cell).lower().strip()
            if (cl and len(cl) <= 24 and any(k in cl for k in _XLSX_BALANCE_HINTS)
                    and not any(x in cl for x in _BALANCE_LINE_EXCLUDE)):
                bcol, hdr = ci, hi
                break
        if bcol is not None:
            break
    if bcol is None or hdr is None:
        return None
    data = range(hdr + 1, len(num_rows))
    present = [i for i in data if bcol < len(num_rows[i]) and num_rows[i][bcol] is not None]
    if not present:
        return None
    dcol = next((ci for ci, c in enumerate(str_rows[hdr]) if any(k in str(c).lower() for k in _XLSX_DATE_HINTS)), None)
    order_desc = False  # default: chronological (oldest→newest) → current = last
    if dcol is not None:
        keys = [_date_key(str_rows[i][dcol]) for i in present if dcol < len(str_rows[i])]
        keys = [k for k in keys if k]
        if len(keys) >= 2:
            order_desc = keys[0] > keys[-1]  # first newer than last → reverse-chron
    idx = present[0] if order_desc else present[-1]
    cur = num_rows[idx][bcol]
    return round(abs(cur), 2) if cur is not None else None


def _running_balance_from_text(lines: list[str]) -> float | None:
    """Date-aware current-balance detection for PDF text (no positional grid).

    The current balance is always the one adjacent to the MOST RECENT transaction — i.e. the
    row with the latest date. This holds whether the statement is chronological (oldest →
    newest) or reverse-chronological (newest first, as Itaú prints), so we don't have to
    guess the order: just find the latest-dated row and read its balance.

    Each transaction line ends with '… amount  balance', so the balance is the last amount on
    the row (a row needs ≥2 amounts so the balance is distinct from the transaction amount)."""
    rows: list[tuple[tuple, float, int]] = []  # (date_key, balance, doc_index)
    for idx, ln in enumerate(lines):
        m = _DATE_RE.search(ln)
        if not m:
            continue
        dk = _date_key(m.group(0))
        if dk is None:
            continue
        amts = _AMOUNT_RE.findall(ln)
        if len(amts) < 2:
            continue
        try:
            bal = float(_normalise_amount(amts[-1]))
        except Exception:
            continue
        rows.append((dk, bal, idx))

    if len(rows) < 2:
        return None

    # Determine document order from the first vs last dated row, so same-day ties resolve
    # to the END-of-day balance: chronological → the last such row; reverse → the first.
    chronological = rows[0][0] <= rows[-1][0]
    max_dk = max(r[0] for r in rows)
    latest = [r for r in rows if r[0] == max_dk]
    chosen = latest[-1] if chronological else latest[0]

    bal = abs(chosen[1])
    return round(bal, 2) if bal >= 0.01 else None


def _find_balance(lines_lower: list[str], keys: tuple, exclude: tuple = ()) -> float | None:
    """Highest-priority labelled-balance key (keys are ordered most-trustworthy → generic)
    whose line (or the next one) carries an amount; the last such occurrence wins (footers
    repeat totals; the final one is the closing one). Lines matching `exclude` (credit-limit
    / available-credit / overdraft) are skipped so they can't masquerade as the balance."""
    def _excluded(line: str) -> bool:
        return bool(exclude) and any(x in line for x in exclude)

    for key in keys:
        found: str | None = None
        for i, line in enumerate(lines_lower):
            if key in line and not _excluded(line):
                amts = _AMOUNT_RE.findall(line)
                if not amts and i + 1 < len(lines_lower) and not _excluded(lines_lower[i + 1]):
                    amts = _AMOUNT_RE.findall(lines_lower[i + 1])  # label/value split across lines
                if amts:
                    found = amts[-1]
        if found is not None:
            try:
                val = abs(float(_normalise_amount(found)))
                if val >= 0.01:
                    return round(val, 2)
            except Exception:
                continue
    return None


def _classify_kind(lines_lower: list[str]) -> str:
    """deposit vs credit_card from STRUCTURAL markers (a single strong one, or ≥2 markers)."""
    blob = " \n ".join(lines_lower)
    if any(m in blob for m in _CC_STRONG):
        return "credit_card"
    return "credit_card" if sum(1 for m in set(_CC_MARKERS) if m in blob) >= 2 else "deposit"


def _find_institution(lines: list[str]) -> str | None:
    """Only return a name when a header line clearly names a bank — otherwise None, so the
    proposal falls back to a generic name rather than a random header like 'STATEMENT'."""
    for raw in lines[:10]:
        l = raw.strip()
        if not (2 <= len(l) <= 40):
            continue
        if any(m in l.lower() for m in _BANK_MARKERS):
            return l
    return None


def _statement_lines(contents: bytes, content_type: str | None, filename: str):
    """(lines, str_rows, num_rows, is_pdf) for a statement. PDF → text lines (no grid);
    CSV/XLSX → grid rows joined into lines plus the numeric grid."""
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    is_pdf = "pdf" in ct or name.endswith(".pdf")
    str_rows: list[list[str]] = []
    num_rows: list[list[float | None]] = []
    if is_pdf:
        lines = _extract_pdf_text(contents).splitlines()
    else:
        str_rows, num_rows = _load_grid(contents, content_type, filename)
        lines = [" ".join(c for c in r) for r in str_rows]
    return lines, str_rows, num_rows, is_pdf


def detect_statement_metadata(contents: bytes, content_type: str | None, filename: str) -> dict | None:
    """Deterministically detect {closing_balance, statement_kind, institution} from a
    statement (PDF text, CSV or XLSX), or None when no balance is found. Never raises.
    This is the FREE-tier path (heuristics only); paid users go through
    detect_statement_balance(), which lets an LLM read the authoritative balance."""
    try:
        lines, str_rows, num_rows, is_pdf = _statement_lines(contents, content_type, filename)
        lines_lower = [ln.lower() for ln in lines]
        if not any(lines_lower):
            return None

        kind = _classify_kind(lines_lower)
        balance: float | None = None
        if kind == "credit_card":
            # The figure that matters is what's OWED — a labelled summary line.
            balance = _find_balance(lines_lower, _OWED_BALANCE_KEYS)
        else:
            # Deposit: prefer the running-balance column (self-validating, order-aware),
            # then a header-named balance column by date order, then a labelled line
            # (skipping credit-limit / available-credit lines that aren't the balance).
            if num_rows:
                balance = _running_balance(num_rows, str_rows) or _balance_by_header_order(str_rows, num_rows)
            if balance is None and is_pdf:
                # PDF has no positional grid — scan the '… amount  balance' line layout.
                balance = _running_balance_from_text(lines)
            if balance is None:
                balance = _find_balance(lines_lower, _DEPOSIT_BALANCE_KEYS, _BALANCE_LINE_EXCLUDE)

        if balance is None:
            return None
        return {
            "closing_balance": balance,
            "statement_kind": kind,
            "institution": _find_institution(lines),
            "balance_source": "heuristic",
        }
    except Exception as exc:  # never let detection break the upload
        logger.warning("Statement metadata detection failed: %s", exc)
        return None


# ── Paid-tier LLM balance extraction ──────────────────────────────────────────
# WHY: keyword heuristics can't keep up with 100+ countries' terminology for "account
# balance" vs "credit limit" vs "available credit". For paid users we hand the statement
# header to gpt-4o-mini, which understands any language/format, and ask one precise
# question. The deterministic path stays the free fallback (and the safety net).
_BALANCE_MODEL = "gpt-4o-mini"
_BALANCE_SYSTEM = (
    "You read bank and credit-card statements in ANY language and extract a single number. "
    "You never explain, never add currency symbols, never guess."
)
_BALANCE_USER_TMPL = (
    "Below is the header/summary of a bank statement.\n"
    "Return ONLY the CURRENT ACCOUNT BALANCE — the money actually in the account right now "
    "(the closing/ending balance for a deposit account, or the amount OWED for a credit-card "
    "statement).\n"
    "Do NOT return the credit limit, the available credit, the available limit, the overdraft "
    "limit, the previous/opening balance, or any total of transactions.\n"
    "Reply with ONLY the number using a dot as the decimal separator (e.g. 9302.55). "
    "If you cannot find it, reply exactly: NONE.\n\n"
    "STATEMENT:\n{body}"
)
_MAX_LLM_CHARS = 6000


def _llm_excerpt(lines: list[str]) -> str:
    """Header + footer of the statement (where balances live) within a char budget — keeps
    the prompt small and cheap while still covering opening/closing summary blocks."""
    clean = [ln.strip() for ln in lines if ln and ln.strip()]
    if not clean:
        return ""
    head, tail = clean[:45], clean[-15:]
    seen, merged = set(), []
    for ln in head + tail:
        if ln not in seen:
            seen.add(ln)
            merged.append(ln)
    return "\n".join(merged)[:_MAX_LLM_CHARS]


def _render_first_page_png_b64(contents: bytes) -> str | None:
    """First PDF page → base64 PNG (for image-only statements with no text layer)."""
    try:
        import base64
        import fitz  # pymupdf
        doc = fitz.open(stream=contents, filetype="pdf")
        try:
            if len(doc) == 0:
                return None
            pix = doc[0].get_pixmap(dpi=150)
            return base64.b64encode(pix.tobytes("png")).decode("ascii")
        finally:
            doc.close()
    except Exception:
        return None


def _parse_balance_reply(raw: str | None) -> float | None:
    """Parse the model's reply ('9302.55', '9.302,55', 'NONE') → positive float or None."""
    if not raw:
        return None
    s = raw.strip()
    if not s or "none" in s.lower():
        return None
    m = _AMOUNT_RE.search(s)
    cand = m.group(1) if m else s
    try:
        val = abs(float(_normalise_amount(cand)))
        return round(val, 2) if val >= 0.01 else None
    except Exception:
        return None


def _llm_balance_sync(body_text: str, image_b64: str | None) -> float | None:
    """Synchronous gpt-4o-mini (text, or vision for image-only PDFs) balance read. Prefers
    OpenAI gpt-4o-mini; if only a DeepSeek key is present, uses it for the text case. Never
    raises — returns None on any failure so the deterministic value stands."""
    try:
        from openai import OpenAI
        if settings.OPENAI_API_KEY:
            client = OpenAI(api_key=settings.OPENAI_API_KEY)
            if image_b64:
                user_content = [
                    {"type": "text", "text": _BALANCE_USER_TMPL.format(body="(see image)")},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{image_b64}", "detail": "high"}},
                ]
            else:
                if not body_text.strip():
                    return None
                user_content = _BALANCE_USER_TMPL.format(body=body_text)
            resp = client.chat.completions.create(
                model=_BALANCE_MODEL,
                messages=[
                    {"role": "system", "content": _BALANCE_SYSTEM},
                    {"role": "user", "content": user_content},
                ],
                temperature=0,
                max_tokens=20,
            )
            return _parse_balance_reply(resp.choices[0].message.content)

        # No OpenAI key: fall back to the configured provider (DeepSeek) for text only.
        if not body_text.strip():
            return None
        provider = get_provider()
        resp = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": _BALANCE_SYSTEM},
                {"role": "user", "content": _BALANCE_USER_TMPL.format(body=body_text)},
            ],
            temperature=0,
            max_tokens=20,
        )
        return _parse_balance_reply(resp.choices[0].message.content)
    except Exception as exc:
        logger.warning("LLM balance read failed: %s", exc)
        return None


async def detect_statement_balance(
    contents: bytes, content_type: str | None, filename: str,
    *, allow_llm: bool, lang: str = "tr",
) -> dict | None:
    """Statement metadata with an LLM balance read for paid users. Always runs the
    deterministic detector first (kind/institution/heuristic balance); when `allow_llm`
    is set, an LLM reads the authoritative current account balance and OVERRIDES the
    heuristic. Never raises."""
    import asyncio

    meta = detect_statement_metadata(contents, content_type, filename)
    if not allow_llm:
        return meta

    try:
        lines, str_rows, _num, is_pdf = _statement_lines(contents, content_type, filename)
    except Exception:
        return meta

    body = _llm_excerpt(lines)
    image_b64 = None
    if is_pdf and not body.strip():
        image_b64 = _render_first_page_png_b64(contents)  # scanned/image PDF → vision
    if not body.strip() and image_b64 is None:
        return meta

    llm_balance = await asyncio.to_thread(_llm_balance_sync, body, image_b64)
    if llm_balance is None:
        return meta  # LLM unsure → keep the deterministic value

    if meta is None:
        lines_lower = [ln.lower() for ln in lines]
        meta = {
            "statement_kind": _classify_kind(lines_lower),
            "institution": _find_institution(lines),
        }
    meta["closing_balance"] = llm_balance
    meta["balance_source"] = "llm"
    logger.info("Statement balance from LLM — overriding heuristic (%s)", llm_balance)
    return meta


async def propose_statement_bridge(
    user_id, batch_id: str, meta: dict, currency: str, lang: str, session: AsyncSession,
) -> None:
    """Create a pending net-worth suggestion from a detected statement balance. Idempotent
    per batch. Caller commits the session."""
    balance = meta.get("closing_balance")
    if not balance or balance <= 0:
        return

    # De-dupe: one bridge suggestion per batch.
    exists = await session.execute(
        select(NetworthSuggestion).where(
            NetworthSuggestion.user_id == user_id,
            NetworthSuggestion.source_batch_id == batch_id,
            NetworthSuggestion.status == "pending",
        )
    )
    if exists.scalar_one_or_none() is not None:
        return

    tr = lang == "tr"
    kind = meta.get("statement_kind") or "deposit"
    institution = meta.get("institution")

    # Bridge #2: does the user already track a deposit asset that matches this statement?
    # If so, offer to UPDATE its balance instead of creating a duplicate.
    matched: Asset | None = None
    if kind == "deposit" and institution:
        res = await session.execute(
            select(Asset).where(
                Asset.user_id == user_id,
                Asset.asset_type.in_(_DEPOSIT_ASSET_TYPES),
            )
        )
        il = institution.lower()
        best = 0.0
        for a in res.scalars().all():
            nl = (a.name or "").lower()
            if not nl:
                continue
            ratio = SequenceMatcher(None, il, nl).ratio()
            if il in nl or nl in il:
                ratio = max(ratio, 0.85)
            if ratio > best:
                best, matched = ratio, a
        if best < 0.6:
            matched = None

    proposed_name = institution or ("Hesap bakiyesi" if tr else "Account balance")
    detail = json.dumps({
        "institution": institution,
        "statement_kind": kind,
        "proposed_name": proposed_name,
        "matched_asset_name": matched.name if matched else None,
    })

    if matched is not None:
        stype = "asset_balance_update"
        asset_id = matched.id
        reason = (
            f"{matched.name} bakiyesini ekstredeki kapanış bakiyesine güncelle"
            if tr else f"Update {matched.name} to the statement's closing balance"
        )
    elif kind == "credit_card":
        stype = "statement_liability"
        asset_id = None
        reason = (
            f"{proposed_name} · ekstre bakiyesi (borç)"
            if tr else f"{proposed_name} · statement balance (owed)"
        )
    else:
        stype = "statement_asset"
        asset_id = None
        reason = (
            f"{proposed_name} · kapanış bakiyesi"
            if tr else f"{proposed_name} · closing balance"
        )

    session.add(NetworthSuggestion(
        user_id=user_id,
        suggestion_type=stype,
        asset_id=asset_id,
        suggested_change=Decimal(str(balance)),
        currency=currency,
        reason=reason,
        source_batch_id=batch_id,
        status="pending",
        source_detail=detail,
    ))
    logger.info(
        "Statement bridge proposed — user=%s batch=%s type=%s matched=%s",
        user_id, batch_id, stype, bool(matched),
    )
