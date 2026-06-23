"""
WHAT: Detects whether a freshly uploaded statement duplicates one already on file
      (same date range + same bank/source). Pure functions — no DB, no LLM.
WHY: Manual income/spending entry was removed from onboarding, so the old income/spending
     "same money?" conflict rules are gone (they created conflicts with statement data and
     confused users). The only conflict still worth surfacing is an accidental RE-UPLOAD of
     the same statement, which would double-count every transaction.
BREAKS IF REMOVED: A user who uploads the same statement twice silently doubles their data.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BatchInfo:
    """Lightweight descriptor of an upload batch used only for duplicate detection."""
    min_date: str               # ISO date of the earliest transaction in the batch
    max_date: str               # ISO date of the latest transaction in the batch
    source: str | None = None   # bank / source identifier when known (else None)
    count: int | None = None    # number of transactions in the batch


def is_duplicate_batch(new: BatchInfo, existing: BatchInfo) -> bool:
    """
    Two batches are the same statement when they cover the SAME date range and the SAME
    bank/source. When no bank identifier is available, fall back to also requiring the same
    transaction count, so two genuinely different statements that merely share a date range
    are not wrongly flagged as duplicates.
    """
    if new.min_date != existing.min_date or new.max_date != existing.max_date:
        return False
    if new.source and existing.source:
        return new.source == existing.source
    return new.count is not None and new.count == existing.count


def find_duplicate_batch(new: BatchInfo, existing: list[BatchInfo]) -> bool:
    """True if `new` duplicates any already-uploaded batch in `existing`."""
    return any(is_duplicate_batch(new, e) for e in existing)
