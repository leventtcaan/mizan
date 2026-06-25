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
from decimal import Decimal
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.networth_suggestion import NetworthSuggestion
from app.services.pdf_parser import _AMOUNT_RE, _normalise_amount, _read_xlsx_rows

logger = logging.getLogger(__name__)

# Markers that say "this is a credit-card statement" (balance = money OWED, → liability),
# multilingual (EN + TR + common). A single strong hit flips kind to credit_card.
_CREDIT_CARD_MARKERS = (
    "credit card", "kredi kartı", "kredi karti", "minimum payment", "minimum amount due",
    "asgari ödeme", "asgari odeme", "asgari tutar", "credit limit", "kredi limiti",
    "available limit", "kullanılabilir limit", "kullanilabilir limit",
    "statement balance", "ekstre tutarı", "ekstre tutari", "son ödeme tarihi",
    "payment due", "kart numarası", "kart numarasi", "kart no",
)

# Balance labels, most-specific → generic. The amount on the LAST matching line wins
# (footers/summaries repeat the running balance; the final one is the closing balance).
_BALANCE_KEYS = (
    "closing balance", "ending balance", "available balance", "current balance",
    "new balance", "statement balance", "account balance",
    "kapanış bakiye", "kapanis bakiye", "kapanış bakiyesi", "kapanis bakiyesi",
    "kullanılabilir bakiye", "kullanilabilir bakiye", "güncel bakiye", "guncel bakiye",
    "hesap bakiyesi", "son bakiye", "mevcut bakiye",
    "bakiye", "balance",  # generic — last resort
)

_BANK_MARKERS = ("bank", "banka", "bankası", "bankasi", "finansbank", "katılım", "katilim")

# Existing deposit-style assets a statement balance could correspond to.
_DEPOSIT_ASSET_TYPES = ("cash", "bank_account", "foreign_currency")


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


def _extract_grid(contents: bytes, content_type: str | None, filename: str) -> list[list[str]]:
    """Rows of a CSV/XLSX statement as string cells, so we can both column-scan a running
    balance AND join to text for labelled-line scanning. XLSX reuses the parser's reader
    (openpyxl with a raw zip/XML fallback) so even style-malformed exports are readable."""
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    if "csv" in ct or name.endswith(".csv"):
        text = ""
        for enc in ("utf-8", "latin-1"):
            try:
                text = contents.decode(enc)
                break
            except Exception:
                continue
        if not text:
            return []
        try:
            import csv
            sample = text[:2000]
            delim = ";" if sample.count(";") > sample.count(",") else ","
            rows = list(csv.reader(io.StringIO(text), delimiter=delim))
            return [[(c or "") for c in r] for r in rows[:300]]
        except Exception:
            return []
    if "xlsx" in ct or name.endswith(".xlsx") or "spreadsheet" in ct:
        try:
            rows = _read_xlsx_rows(contents) or []
            return [[("" if c is None else str(c)) for c in r] for r in rows[:300]]
        except Exception:
            return []
    return []


def _grid_balance(rows: list[list[str]]) -> float | None:
    """Column-aware: a SHORT header cell naming a balance → the last numeric value in that
    column (the running balance's final value = the closing balance)."""
    for hi, row in enumerate(rows):
        for ci, cell in enumerate(row):
            cl = str(cell or "").lower().strip()
            if cl and len(cl) <= 24 and any(k in cl for k in _BALANCE_KEYS):
                last: str | None = None
                for r in rows[hi + 1:]:
                    if ci < len(r):
                        amts = _AMOUNT_RE.findall(str(r[ci]))
                        if amts:
                            last = amts[-1]
                if last is not None:
                    try:
                        val = abs(float(_normalise_amount(last)))
                        if val >= 0.01:
                            return round(val, 2)
                    except Exception:
                        pass
    return None


def _find_balance(lines_lower: list[str]) -> float | None:
    """Most-specific balance label whose line (or the next one) carries an amount; the last
    such occurrence wins (footers repeat running totals; the final one is the closing one)."""
    for key in _BALANCE_KEYS:
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

        balance: float | None = None
        if is_pdf:
            lines = _extract_pdf_text(contents).splitlines()
        else:
            rows = _extract_grid(contents, content_type, filename)
            balance = _grid_balance(rows)  # column-aware running balance (CSV/XLSX)
            lines = [" ".join(c for c in r) for r in rows]

        lines_lower = [ln.lower() for ln in lines]
        if balance is None:
            balance = _find_balance(lines_lower)  # labelled footer/summary line
        if balance is None:
            return None

        is_credit = any(m in ln for ln in lines_lower for m in _CREDIT_CARD_MARKERS)
        return {
            "closing_balance": balance,
            "statement_kind": "credit_card" if is_credit else "deposit",
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
