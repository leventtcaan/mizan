import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.financial_event import FinancialEvent
from app.models.reconciliation_item import RECONCILIATION_STATUSES, ReconciliationItem
from app.models.user import User
from app.services.reconciliation_producers import run_reconciliation_producers

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])

# Action-queue gating: keep the queue short and trustworthy rather than overwhelming a
# brand-new account with chores. Show at most a few, hardest-first; hold back heuristic
# (low-confidence) items until the user has been around long enough to trust the app.
_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
_MAX_OPEN_ITEMS = 3
_TRUST_DAYS = 7
# Heuristic detectors (statistical guesses, not facts) — hidden for fresh accounts.
_LOW_CONFIDENCE_ISSUE_TYPES = {"possible_duplicate_transaction", "large_transaction_review"}


class FinancialEventResponse(BaseModel):
    id: str
    event_type: str
    entity_type: str
    entity_id: str | None
    amount: str | None
    currency: str | None
    event_date: str
    source: str
    source_detail: dict | str | None
    status: str
    confidence: str | None
    created_at: datetime


class ReconciliationItemResponse(BaseModel):
    id: str
    issue_type: str
    severity: str
    status: str
    title: str
    description: str
    related_event_id: str | None
    related_entity_type: str | None
    related_entity_id: str | None
    proposed_action: dict | str | None
    created_at: datetime
    resolved_at: datetime | None


class ReconciliationStatusPatch(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: str) -> str:
        if value not in RECONCILIATION_STATUSES:
            raise ValueError(f"status must be one of: {sorted(RECONCILIATION_STATUSES)}")
        return value


class ReconciliationScanResponse(BaseModel):
    created: int


def _json_or_text(raw: str | None) -> dict | str | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _event_resp(event: FinancialEvent) -> FinancialEventResponse:
    return FinancialEventResponse(
        id=str(event.id),
        event_type=event.event_type,
        entity_type=event.entity_type,
        entity_id=str(event.entity_id) if event.entity_id else None,
        amount=str(event.amount) if event.amount is not None else None,
        currency=event.currency,
        event_date=event.event_date.isoformat(),
        source=event.source,
        source_detail=_json_or_text(event.source_detail),
        status=event.status,
        confidence=str(event.confidence) if event.confidence is not None else None,
        created_at=event.created_at,
    )


def _item_resp(item: ReconciliationItem) -> ReconciliationItemResponse:
    return ReconciliationItemResponse(
        id=str(item.id),
        issue_type=item.issue_type,
        severity=item.severity,
        status=item.status,
        title=item.title,
        description=item.description,
        related_event_id=str(item.related_event_id) if item.related_event_id else None,
        related_entity_type=item.related_entity_type,
        related_entity_id=str(item.related_entity_id) if item.related_entity_id else None,
        proposed_action=_json_or_text(item.proposed_action),
        created_at=item.created_at,
        resolved_at=item.resolved_at,
    )


@router.get("/events", response_model=list[FinancialEventResponse])
async def list_events(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[FinancialEventResponse]:
    safe_limit = min(max(limit, 1), 250)
    result = await session.execute(
        select(FinancialEvent)
        .where(FinancialEvent.user_id == current_user.id)
        .order_by(FinancialEvent.event_date.desc(), FinancialEvent.created_at.desc())
        .limit(safe_limit)
    )
    return [_event_resp(event) for event in result.scalars().all()]


@router.get("/items", response_model=list[ReconciliationItemResponse])
async def list_items(
    status: str = "open",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReconciliationItemResponse]:
    if status not in RECONCILIATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {sorted(RECONCILIATION_STATUSES)}")

    result = await session.execute(
        select(ReconciliationItem)
        .where(
            ReconciliationItem.user_id == current_user.id,
            ReconciliationItem.status == status,
        )
        .order_by(ReconciliationItem.created_at.desc())
    )
    items = list(result.scalars().all())

    # Only gate the live "open" queue — historical (resolved/dismissed) lists are returned
    # in full so nothing is silently lost.
    if status == "open":
        created = current_user.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - created).days if created else 999

        # New account → hold back heuristic / low-severity items until trust is built.
        if age_days < _TRUST_DAYS:
            items = [
                i for i in items
                if i.severity != "low" and i.issue_type not in _LOW_CONFIDENCE_ISSUE_TYPES
            ]

        # Hardest-first (severity), then most-recent, capped so the queue stays digestible.
        items.sort(key=lambda i: (_SEVERITY_RANK.get(i.severity, 3), -i.created_at.timestamp()))
        items = items[:_MAX_OPEN_ITEMS]

    return [_item_resp(item) for item in items]


@router.post("/scan", response_model=ReconciliationScanResponse)
async def scan_reconciliation(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReconciliationScanResponse:
    created = await run_reconciliation_producers(current_user.id, session)
    await session.commit()
    return ReconciliationScanResponse(created=created)


@router.patch("/items/{item_id}/status", response_model=ReconciliationItemResponse)
async def update_item_status(
    item_id: str,
    body: ReconciliationStatusPatch,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReconciliationItemResponse:
    try:
        rid = uuid.UUID(item_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid reconciliation item ID")

    result = await session.execute(
        select(ReconciliationItem).where(
            ReconciliationItem.id == rid,
            ReconciliationItem.user_id == current_user.id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Reconciliation item not found")

    item.status = body.status
    item.resolved_at = datetime.now(timezone.utc) if body.status in {"resolved", "dismissed"} else None
    await session.commit()
    await session.refresh(item)
    return _item_resp(item)
