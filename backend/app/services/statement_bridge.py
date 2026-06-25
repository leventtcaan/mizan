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
from app.services.pdf_parser import _AMOUNT_RE, _normalise_amount

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


def _extract_scan_text(contents: bytes, content_type: str | None, filename: str) -> str:
    """Best-effort plain text for the balance scan. PDF text layer only (no OCR — if a
    scan has no text, we simply skip the bridge); CSV decoded; XLSX skipped."""
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    if "pdf" in ct or name.endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(contents)) as pdf:
                pages = pdf.pages
                n = len(pages)
                # Balances live in the header/summary or the footer → scan first 2 + last 2.
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
    if "csv" in ct or name.endswith(".csv"):
        for enc in ("utf-8", "latin-1"):
            try:
                return contents.decode(enc)
            except Exception:
                continue
    return ""


def _find_balance(lines_lower: list[str]) -> float | None:
    """Most-specific balance label whose line carries an amount; the last such line wins."""
    for key in _BALANCE_KEYS:
        found: str | None = None
        for line in lines_lower:
            if key in line:
                amts = _AMOUNT_RE.findall(line)
                if amts:
                    found = amts[-1]  # the last number on the labelled line
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
    statement, or None when no balance is found. Never raises (best-effort)."""
    try:
        text = _extract_scan_text(contents, content_type, filename)
        if not text:
            return None
        lines = text.splitlines()
        lines_lower = [ln.lower() for ln in lines]
        balance = _find_balance(lines_lower)
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
