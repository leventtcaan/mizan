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

from app.models.asset import Asset
from app.models.networth_suggestion import NetworthSuggestion
from app.services.pdf_parser import (
    _AMOUNT_RE, _normalise_amount, _read_xlsx_rows,
    _XLSX_BALANCE_HINTS, _XLSX_DATE_HINTS,
)

logger = logging.getLogger(__name__)

# ── Statement-kind classification ─────────────────────────────────────────────
# STRUCTURAL credit-card markers (header/summary fields), NOT transaction descriptions
# — so a deposit statement that merely contains a "credit-card payment" transaction is
# never misclassified as a credit card. Multilingual (EN + TR).
_CC_STRONG = (
    "minimum payment", "minimum amount due", "asgari ödeme", "asgari odeme", "asgari tutar",
)
_CC_MARKERS = _CC_STRONG + (
    "credit limit", "kredi limiti", "kullanılabilir limit", "kullanilabilir limit",
    "available credit", "statement balance", "ekstre bakiyesi", "dönem borcu", "donem borcu",
    "son ödeme tarihi", "payment due date", "ekstre kesim", "credit card statement",
    "kredi kartı ekstre", "kredi karti ekstre",
)

# Labelled-balance keys for a DEPOSIT account (funds you HAVE), specific → generic.
_DEPOSIT_BALANCE_KEYS = (
    "closing balance", "ending balance", "available balance", "current balance",
    "new balance", "account balance",
    "kapanış bakiye", "kapanis bakiye", "kapanış bakiyesi", "kapanis bakiyesi",
    "kullanılabilir bakiye", "kullanilabilir bakiye", "güncel bakiye", "guncel bakiye",
    "hesap bakiyesi", "son bakiye", "mevcut bakiye", "bakiye", "balance",
)
# For a CREDIT CARD the relevant figure is the amount OWED.
_OWED_BALANCE_KEYS = (
    "statement balance", "ekstre bakiyesi", "dönem borcu", "donem borcu",
    "current balance", "new balance", "güncel borç", "guncel borc",
    "toplam borç", "toplam borc", "bakiye", "balance",
)

_BANK_MARKERS = ("bank", "banka", "bankası", "bankasi", "finansbank", "katılım", "katilim")
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


def _cell_num(v: object) -> float | None:
    """Numeric value of a cell (native Excel number OR a locale-formatted string), else
    None. Dates and text reject to None so they can't pollute column detection."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (_datetime, _date)):
        return None
    s = str(v or "").strip()
    if not s or _DATE_CELL.match(s):
        return None
    m = _AMOUNT_RE.search(s)               # a value with a 2-digit decimal
    if m:
        try:
            return float(_normalise_amount(m.group(1)))
        except Exception:
            return None
    cleaned = s.replace(" ", "")           # a plain/grouped integer ("5000", "5.000")
    if re.fullmatch(r"[-(]?\d{1,3}(?:[.,]\d{3})*\)?", cleaned):
        try:
            return float(_normalise_amount(cleaned))
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


def _running_balance(num_rows: list[list[float | None]]) -> float | None:
    """THE robust balance detector (no header keyword needed): find a column B and a signed
    amount column A such that, row to row, B changes by exactly A — i.e. B is a running
    balance. The DIRECTION of that relationship tells us which end is current:
      - chronological (oldest→newest top-down): B[i] = B[i-1] + A[i]  → current = BOTTOM
      - reverse-chron (newest first, top-down):  B[i] = B[i+1] + A[i]  → current = TOP
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
                    if chron:  # current = bottom-most present value
                        cur = next((cell(i, B) for i in range(n - 1, -1, -1) if cell(i, B) is not None), None)
                    else:      # current = top-most present value
                        cur = next((cell(i, B) for i in range(n) if cell(i, B) is not None), None)
                    if cur is not None and (best is None or hits / comps > best[0]):
                        best = (hits / comps, cur)
    return round(abs(best[1]), 2) if best else None


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
            if cl and len(cl) <= 24 and any(k in cl for k in _XLSX_BALANCE_HINTS):
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


def _find_balance(lines_lower: list[str], keys: tuple) -> float | None:
    """Most-specific labelled-balance key whose line (or the next one) carries an amount;
    the last such occurrence wins (footers repeat totals; the final one is the closing one)."""
    for key in keys:
        found: str | None = None
        for i, line in enumerate(lines_lower):
            if key in line:
                amts = _AMOUNT_RE.findall(line)
                if not amts and i + 1 < len(lines_lower):
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


def detect_statement_metadata(contents: bytes, content_type: str | None, filename: str) -> dict | None:
    """Deterministically detect {closing_balance, statement_kind, institution} from a
    statement (PDF text, CSV or XLSX), or None when no balance is found. Never raises."""
    try:
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
            # then a header-named balance column by date order, then a labelled line.
            if num_rows:
                balance = _running_balance(num_rows) or _balance_by_header_order(str_rows, num_rows)
            if balance is None:
                balance = _find_balance(lines_lower, _DEPOSIT_BALANCE_KEYS)

        if balance is None:
            return None
        return {
            "closing_balance": balance,
            "statement_kind": kind,
            "institution": _find_institution(lines),
        }
    except Exception as exc:  # never let detection break the upload
        logger.warning("Statement metadata detection failed: %s", exc)
        return None


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
