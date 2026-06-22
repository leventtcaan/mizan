import json
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset
from app.models.receivable import Receivable
from app.models.reconciliation_item import ReconciliationItem
from app.models.transaction import Transaction


def _norm_description(value: str) -> str:
    return " ".join(value.lower().split())[:40]


def _json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


async def _ensure_item(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    issue_type: str,
    severity: str,
    title: str,
    description: str,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    proposed_action: dict | None = None,
) -> bool:
    filters = [
        ReconciliationItem.user_id == user_id,
        ReconciliationItem.issue_type == issue_type,
    ]
    if related_entity_type and related_entity_id:
        filters.extend(
            [
                ReconciliationItem.related_entity_type == related_entity_type,
                ReconciliationItem.related_entity_id == related_entity_id,
            ]
        )
    else:
        filters.append(ReconciliationItem.title == title)

    result = await session.execute(select(ReconciliationItem).where(*filters))
    existing = result.scalars().first()
    if existing:
        if existing.status == "open":
            existing.severity = severity
            existing.title = title
            existing.description = description
            existing.proposed_action = _json(proposed_action) if proposed_action else None
        return False

    session.add(
        ReconciliationItem(
            user_id=user_id,
            issue_type=issue_type,
            severity=severity,
            status="open",
            title=title,
            description=description,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            proposed_action=_json(proposed_action) if proposed_action else None,
            created_at=datetime.now(timezone.utc),
        )
    )
    return True


async def _produce_receivable_items(user_id: uuid.UUID, session: AsyncSession) -> int:
    today = date.today()
    created = 0
    result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status != "written_off",
        )
    )
    receivables = result.scalars().all()

    linked_asset_ids = {r.linked_asset_id for r in receivables if r.linked_asset_id}
    existing_assets: set[uuid.UUID] = set()
    if linked_asset_ids:
        asset_result = await session.execute(
            select(Asset.id).where(Asset.user_id == user_id, Asset.id.in_(linked_asset_ids))
        )
        existing_assets = set(asset_result.scalars().all())

    for receivable in receivables:
        if (
            receivable.status in {"pending", "overdue"}
            and receivable.expected_date
            and receivable.expected_date < today
        ):
            days_late = (today - receivable.expected_date).days
            if receivable.status == "pending":
                receivable.status = "overdue"
            created += int(
                await _ensure_item(
                    session,
                    user_id=user_id,
                    issue_type="overdue_receivable",
                    severity="high" if days_late >= 30 else "medium",
                    title=f"Receivable overdue: {receivable.from_person}",
                    description=(
                        f"{receivable.from_person} receivable is {days_late} day(s) overdue. "
                        "Confirm payment, change expected date, or write it off."
                    ),
                    related_entity_type="receivable",
                    related_entity_id=receivable.id,
                    proposed_action={
                        "actions": ["mark_received", "update_expected_date", "write_off"],
                        "amount": str(receivable.amount),
                        "currency": receivable.currency,
                        "expected_date": receivable.expected_date.isoformat(),
                    },
                )
            )

        if receivable.status == "received" and (
            not receivable.linked_asset_id or receivable.linked_asset_id not in existing_assets
        ):
            created += int(
                await _ensure_item(
                    session,
                    user_id=user_id,
                    issue_type="received_receivable_missing_asset",
                    severity="high",
                    title=f"Collected receivable has no linked asset: {receivable.from_person}",
                    description=(
                        "This receivable is marked received, but the linked cash asset is missing. "
                        "Net worth may be too low or the receivable status may be wrong."
                    ),
                    related_entity_type="receivable",
                    related_entity_id=receivable.id,
                    proposed_action={
                        "actions": ["create_cash_asset", "mark_pending", "write_off"],
                        "amount": str(receivable.amount),
                        "currency": receivable.currency,
                    },
                )
            )

    return created


async def _produce_duplicate_transaction_items(user_id: uuid.UUID, session: AsyncSession) -> int:
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
        .limit(750)
    )
    transactions = result.scalars().all()
    groups: dict[tuple, list[Transaction]] = defaultdict(list)
    for txn in transactions:
        key = (
            txn.transaction_date,
            str(txn.amount),
            txn.transaction_type,
            _norm_description(txn.description),
        )
        groups[key].append(txn)

    created = 0
    seen_id_sets: set[frozenset] = set()
    for rows in groups.values():
        if len(rows) < 2:
            continue
        id_set = frozenset(row.id for row in rows)
        if id_set in seen_id_sets:
            continue
        seen_id_sets.add(id_set)
        # Use the minimum UUID as a stable anchor so repeated scans always
        # resolve to the same related_entity_id and _ensure_item deduplicates.
        anchor = min(rows, key=lambda r: r.id)
        batch_ids = {row.upload_batch_id for row in rows if row.upload_batch_id}
        severity = "high" if len(batch_ids) > 1 else "medium"
        created += int(
            await _ensure_item(
                session,
                user_id=user_id,
                issue_type="possible_duplicate_transaction",
                severity=severity,
                title="Possible duplicate transaction",
                description=(
                    f"{len(rows)} matching transactions found on {anchor.transaction_date.isoformat()} "
                    f"for amount {anchor.amount}. Review before these rows affect insights twice."
                ),
                related_entity_type="transaction",
                related_entity_id=anchor.id,
                proposed_action={
                    "actions": ["review_duplicates", "delete_duplicate_batch", "keep_all"],
                    "transaction_ids": [str(row.id) for row in rows],
                    "upload_batch_ids": sorted(batch_ids),
                    "description": anchor.description,
                },
            )
        )
    return created


async def _produce_large_transaction_items(user_id: uuid.UUID, session: AsyncSession) -> int:
    result = await session.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc())
        .limit(180)
    )
    transactions = result.scalars().all()
    if len(transactions) < 8:
        return 0

    amounts = sorted(abs(txn.amount) for txn in transactions if txn.amount is not None)
    if not amounts:
        return 0
    median = amounts[len(amounts) // 2]
    threshold = max(median * Decimal("3"), Decimal("5000"))

    created = 0
    for txn in transactions:
        if abs(txn.amount) < threshold:
            continue
        created += int(
            await _ensure_item(
                session,
                user_id=user_id,
                issue_type="large_transaction_review",
                severity="medium",
                title="Large transaction needs review",
                description=(
                    f"{txn.transaction_date.isoformat()} transaction is much larger than recent median. "
                    "Confirm category, source, and whether it should update assets or liabilities."
                ),
                related_entity_type="transaction",
                related_entity_id=txn.id,
                proposed_action={
                    "actions": ["confirm_category", "link_to_asset", "link_to_liability", "ignore"],
                    "amount": str(txn.amount),
                    "transaction_type": txn.transaction_type,
                    "description": txn.description,
                },
            )
        )
        if created >= 10:
            break
    return created


async def run_reconciliation_producers(user_id: uuid.UUID, session: AsyncSession) -> int:
    created = 0
    created += await _produce_receivable_items(user_id, session)
    created += await _produce_duplicate_transaction_items(user_id, session)
    created += await _produce_large_transaction_items(user_id, session)
    return created
