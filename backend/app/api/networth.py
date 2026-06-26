import hashlib
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.asset import Asset, ASSET_TYPES
from app.models.financial_event import FinancialEvent
from app.models.liability import Liability, LIABILITY_TYPES
from app.models.networth_suggestion import NetworthSuggestion
from app.models.progress_insight import ProgressInsight
from app.models.receivable import Receivable, RECEIVABLE_STATUSES
from app.models.transaction import Transaction
from app.models.user import User
from app.services.currency import convert
from app.services.llm_provider import get_provider
from app.services.networth_guidance import build_guidance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/networth", tags=["networth"])

_INSIGHT_DATA_TYPE = "networth_insight"
_GUIDANCE_DATA_TYPE = "networth_guidance"
_CACHE_TTL_HOURS = 24
_ARCHIVE_AFTER_DAYS = 30

# ---------- Pydantic models ----------

class AssetRequest(BaseModel):
    name: str
    asset_type: str
    currency: str = "TRY"
    current_value: str
    notes: str | None = None
    source: str = "manual"
    source_detail: str | None = None
    as_of_date: str | None = None  # ISO date YYYY-MM-DD
    quantity: str | None = None     # share/unit count for repriceable holdings
    unit_code: str | None = None    # ticker/symbol for repricing
    account_id: str | None = None   # optional Account this asset belongs to

    @field_validator("asset_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ASSET_TYPES:
            raise ValueError(f"asset_type must be one of: {sorted(ASSET_TYPES)}")
        return v

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v: str) -> str:
        return v.upper()

    @field_validator("current_value")
    @classmethod
    def valid_value(cls, v: str) -> str:
        try:
            val = Decimal(v.replace(",", "."))
        except Exception:
            raise ValueError("current_value must be a valid number")
        if val < 0:
            raise ValueError("current_value cannot be negative")
        return v

    @field_validator("name")
    @classmethod
    def non_empty_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class AssetResponse(BaseModel):
    id: str
    name: str
    asset_type: str
    currency: str
    current_value: str
    notes: str | None
    source: str
    source_detail: str | None
    as_of_date: str
    quantity: str | None
    unit_code: str | None
    account_id: str | None
    created_at: datetime
    updated_at: datetime


class LiabilityRequest(BaseModel):
    name: str
    liability_type: str
    currency: str = "TRY"
    total_amount: str
    remaining_amount: str
    monthly_payment: str | None = None
    due_date: str | None = None  # monthly payment-day anchor (YYYY-MM-DD; only the day is used)
    end_date: str | None = None  # final payment month (YYYY-MM-DD); null = open-ended
    interest_rate: str | None = None
    reminder_days: int | None = None  # lead time for the payment reminder (default 7)
    notes: str | None = None

    @field_validator("liability_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in LIABILITY_TYPES:
            raise ValueError(f"liability_type must be one of: {sorted(LIABILITY_TYPES)}")
        return v

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v: str) -> str:
        return v.upper()

    @field_validator("name")
    @classmethod
    def non_empty_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name cannot be empty")
        return v.strip()


class LiabilityResponse(BaseModel):
    id: str
    name: str
    liability_type: str
    currency: str
    total_amount: str
    remaining_amount: str
    monthly_payment: str | None
    due_date: str | None
    end_date: str | None
    interest_rate: str | None
    reminder_days: int
    notes: str | None
    created_at: datetime


class ReceivableRequest(BaseModel):
    from_person: str
    amount: str
    currency: str = "TRY"
    expected_date: str | None = None
    notes: str | None = None

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, v: str) -> str:
        return v.upper()

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, v: str) -> str:
        try:
            val = Decimal(v.replace(",", "."))
        except Exception:
            raise ValueError("amount must be a valid number")
        if val <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("from_person")
    @classmethod
    def non_empty_person(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("from_person cannot be empty")
        return v.strip()


class ReceivableResponse(BaseModel):
    id: str
    linked_asset_id: str | None
    from_person: str
    amount: str
    currency: str
    expected_date: str | None
    notes: str | None
    status: str
    created_at: datetime


class StatusPatchRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in RECEIVABLE_STATUSES:
            raise ValueError(f"status must be one of: {sorted(RECEIVABLE_STATUSES)}")
        return v


class StatusPatchResponse(BaseModel):
    receivable: ReceivableResponse
    created_asset: AssetResponse | None
    toast_message: str | None


class CurrencyExposure(BaseModel):
    """Per-currency holdings: the raw amount in its own currency (native_value) and
    that amount converted to the requested display currency (display_value). Never a
    third hardcoded base — TRY was leaking into the UI before."""
    code: str
    native_value: float
    display_value: float


class NetWorthSummary(BaseModel):
    total_assets_try: float
    total_liabilities_try: float
    net_worth_try: float
    assets_by_type: dict[str, float]
    liabilities_by_type: dict[str, float]
    pending_receivables_try: float
    currency_breakdown: list[CurrencyExposure]
    warnings: list[str]
    ai_insight: str | None


class SuggestionResponse(BaseModel):
    id: str
    suggestion_type: str
    asset_id: str | None
    suggested_change: str
    currency: str
    reason: str
    source_batch_id: str | None
    status: str
    created_at: datetime
    source_detail: str | None = None


# ---------- Helpers ----------

def _asset_resp(a: Asset) -> AssetResponse:
    return AssetResponse(
        id=str(a.id),
        name=a.name,
        asset_type=a.asset_type,
        currency=a.currency,
        current_value=str(a.current_value),
        notes=a.notes,
        source=a.source,
        source_detail=a.source_detail,
        as_of_date=a.as_of_date.isoformat() if a.as_of_date else date.today().isoformat(),
        quantity=str(a.quantity) if a.quantity is not None else None,
        unit_code=a.unit_code,
        account_id=str(a.account_id) if a.account_id else None,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


def _liability_resp(l: Liability) -> LiabilityResponse:
    return LiabilityResponse(
        id=str(l.id),
        name=l.name,
        liability_type=l.liability_type,
        currency=l.currency,
        total_amount=str(l.total_amount),
        remaining_amount=str(l.remaining_amount),
        monthly_payment=str(l.monthly_payment) if l.monthly_payment is not None else None,
        due_date=l.due_date.isoformat() if l.due_date else None,
        end_date=l.end_date.isoformat() if l.end_date else None,
        interest_rate=str(l.interest_rate) if l.interest_rate is not None else None,
        reminder_days=l.reminder_days if l.reminder_days is not None else 7,
        notes=l.notes,
        created_at=l.created_at,
    )


def _clean_reminder_days(v: int | None) -> int:
    """Clamp the reminder lead time to a sane 0–30 day window; default 7."""
    if v is None:
        return 7
    return max(0, min(30, int(v)))


def _parse_opt_date(raw: str | None, field: str) -> "date | None":
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")


def _receivable_resp(r: Receivable) -> ReceivableResponse:
    return ReceivableResponse(
        id=str(r.id),
        linked_asset_id=str(r.linked_asset_id) if r.linked_asset_id else None,
        from_person=r.from_person,
        amount=str(r.amount),
        currency=r.currency,
        expected_date=r.expected_date.isoformat() if r.expected_date else None,
        notes=r.notes,
        status=r.status,
        created_at=r.created_at,
    )


def _suggestion_resp(s: NetworthSuggestion) -> SuggestionResponse:
    return SuggestionResponse(
        id=str(s.id),
        suggestion_type=s.suggestion_type,
        asset_id=str(s.asset_id) if s.asset_id else None,
        suggested_change=str(s.suggested_change),
        currency=s.currency,
        reason=s.reason,
        source_batch_id=s.source_batch_id,
        status=s.status,
        created_at=s.created_at,
        source_detail=s.source_detail,
    )


def _parse_as_of_date(as_of_date_str: str | None) -> date:
    if not as_of_date_str:
        return date.today()
    try:
        return date.fromisoformat(as_of_date_str)
    except ValueError:
        return date.today()


def _parse_quantity(raw: str | None) -> Decimal | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        q = Decimal(str(raw).replace(",", "."))
        return q if q > 0 else None
    except Exception:
        return None


def _parse_account_id(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except (ValueError, TypeError):
        return None


def _archive_cutoff() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=_ARCHIVE_AFTER_DAYS)


async def _cleanup_processed_suggestions(
    user_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    result = await session.execute(
        delete(NetworthSuggestion).where(
            NetworthSuggestion.user_id == user_id,
            NetworthSuggestion.status.in_(("accepted", "dismissed")),
            NetworthSuggestion.created_at < _archive_cutoff(),
        )
    )
    if result.rowcount:
        logger.info("Archived processed networth suggestions — user=%s count=%s", user_id, result.rowcount)


def _add_financial_event(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    event_type: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    amount: Decimal | None = None,
    currency: str | None = None,
    event_date: date | None = None,
    source: str = "system",
    source_detail: dict | None = None,
    status: str = "confirmed",
) -> FinancialEvent:
    event = FinancialEvent(
        id=uuid.uuid4(),
        user_id=user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        amount=amount,
        currency=currency,
        event_date=event_date or date.today(),
        source=source,
        source_detail=json.dumps(source_detail) if source_detail else None,
        status=status,
        created_at=datetime.now(timezone.utc),
    )
    session.add(event)
    return event


async def _find_receivable_asset(
    receivable: Receivable,
    session: AsyncSession,
) -> Asset | None:
    """Find the auto-created asset linked to a received receivable."""
    if receivable.linked_asset_id:
        result = await session.execute(
            select(Asset).where(
                Asset.id == receivable.linked_asset_id,
                Asset.user_id == receivable.user_id,
                Asset.source == "receivable_collection",
            )
        )
        asset = result.scalar_one_or_none()
        if asset:
            return asset

    # Legacy fallback: rows created before linked_asset_id existed.
    legacy_detail = f"Alacak tahsilatı: {receivable.from_person}"
    result = await session.execute(
        select(Asset).where(
            Asset.user_id == receivable.user_id,
            Asset.source == "receivable_collection",
            Asset.currency == receivable.currency,
            Asset.current_value == receivable.amount,
            Asset.source_detail == legacy_detail,
        )
    )
    return result.scalar_one_or_none()
    try:
        return date.fromisoformat(as_of_date_str)
    except ValueError:
        return date.today()


# ---------- Cache helpers for AI insight ----------

def _insight_cache_key(user_id: uuid.UUID, asset_ids: list[str], liability_ids: list[str]) -> str:
    content = f"{user_id}|{','.join(sorted(asset_ids))}|{','.join(sorted(liability_ids))}"
    return hashlib.sha256(content.encode()).hexdigest()


async def _insight_cache_get(
    user_id: uuid.UUID,
    expected_key: str,
    session: AsyncSession,
) -> str | None:
    result = await session.execute(
        select(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type == _INSIGHT_DATA_TYPE,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    if row.cache_key != expected_key:
        return None
    age = datetime.now(timezone.utc) - row.generated_at.replace(tzinfo=timezone.utc)
    if age >= timedelta(hours=_CACHE_TTL_HOURS):
        return None
    return row.data


async def _insight_cache_set(
    user_id: uuid.UUID,
    cache_key: str,
    data: str,
    session: AsyncSession,
) -> None:
    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            data_type=_INSIGHT_DATA_TYPE,
            cache_key=cache_key,
            data=data,
            generated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            constraint="uq_progress_insights_user_type",
            set_={
                "cache_key": cache_key,
                "data": data,
                "generated_at": datetime.now(timezone.utc),
            },
        )
    )
    await session.execute(stmt)


async def bust_networth_insight_cache(user_id: uuid.UUID, session: AsyncSession) -> None:
    """Delete cached networth AI insight + guidance so they regenerate next request.
    Guidance reacts to every asset/liability mutation, so it is busted here too."""
    await session.execute(
        delete(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type.in_((_INSIGHT_DATA_TYPE, _GUIDANCE_DATA_TYPE)),
        )
    )
    logger.info("Networth insight + guidance cache busted — user_id=%s", user_id)


# ---------- Assets ----------

@router.get("/assets", response_model=list[AssetResponse])
async def list_assets(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AssetResponse]:
    result = await session.execute(
        select(Asset).where(Asset.user_id == current_user.id).order_by(Asset.created_at)
    )
    return [_asset_resp(a) for a in result.scalars().all()]


@router.post("/assets", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AssetResponse:
    now = datetime.now(timezone.utc)
    asset = Asset(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name,
        asset_type=body.asset_type,
        currency=body.currency,
        current_value=Decimal(body.current_value.replace(",", ".")),
        notes=body.notes,
        source=body.source,
        source_detail=body.source_detail,
        as_of_date=_parse_as_of_date(body.as_of_date),
        quantity=_parse_quantity(body.quantity),
        unit_code=(body.unit_code.strip().upper()[:20] if body.unit_code else None),
        account_id=_parse_account_id(body.account_id),
        created_at=now,
        updated_at=now,
    )
    session.add(asset)
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()
    await session.refresh(asset)
    logger.info("Asset created — user=%s type=%s value=%s %s", current_user.id, body.asset_type, body.current_value, body.currency)
    return _asset_resp(asset)


@router.put("/assets/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: str,
    body: AssetRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AssetResponse:
    try:
        aid = uuid.UUID(asset_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid asset ID")

    result = await session.execute(
        select(Asset).where(Asset.id == aid, Asset.user_id == current_user.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    asset.name = body.name
    asset.asset_type = body.asset_type
    asset.currency = body.currency
    asset.current_value = Decimal(body.current_value.replace(",", "."))
    asset.notes = body.notes
    asset.source = body.source
    asset.source_detail = body.source_detail
    asset.as_of_date = _parse_as_of_date(body.as_of_date)
    asset.quantity = _parse_quantity(body.quantity)
    asset.unit_code = body.unit_code.strip().upper()[:20] if body.unit_code else None
    asset.account_id = _parse_account_id(body.account_id)
    asset.updated_at = datetime.now(timezone.utc)
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()
    await session.refresh(asset)
    return _asset_resp(asset)


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        aid = uuid.UUID(asset_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid asset ID")

    result = await session.execute(
        delete(Asset).where(Asset.id == aid, Asset.user_id == current_user.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()


class RefreshPricesResponse(BaseModel):
    updated: int
    failed: int
    details: list[dict]


@router.post("/assets/refresh-prices", response_model=RefreshPricesResponse)
async def refresh_asset_prices(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefreshPricesResponse:
    """
    Fetch live prices for all auto-refreshable assets (crypto, gold, FX, commodity, stock, fund).
    Stores last_price_usd + price_fetched_at in source_detail; updates as_of_date.
    Does not alter current_value for quantity-based assets (crypto/gold/FX/commodity).
    """
    from app.services.asset_prices import fetch_all_for_user
    result = await fetch_all_for_user(current_user.id, session)
    return RefreshPricesResponse(**result)


# ---------- Liabilities ----------

@router.get("/liabilities", response_model=list[LiabilityResponse])
async def list_liabilities(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[LiabilityResponse]:
    result = await session.execute(
        select(Liability).where(Liability.user_id == current_user.id).order_by(Liability.created_at)
    )
    return [_liability_resp(l) for l in result.scalars().all()]


@router.post("/liabilities", response_model=LiabilityResponse, status_code=status.HTTP_201_CREATED)
async def create_liability(
    body: LiabilityRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LiabilityResponse:
    due = _parse_opt_date(body.due_date, "due_date")
    end = _parse_opt_date(body.end_date, "end_date")

    liability = Liability(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name,
        liability_type=body.liability_type,
        currency=body.currency,
        total_amount=Decimal(body.total_amount.replace(",", ".")),
        remaining_amount=Decimal(body.remaining_amount.replace(",", ".")),
        monthly_payment=Decimal(body.monthly_payment.replace(",", ".")) if body.monthly_payment else None,
        due_date=due,
        end_date=end,
        interest_rate=Decimal(body.interest_rate.replace(",", ".")) if body.interest_rate else None,
        reminder_days=_clean_reminder_days(body.reminder_days),
        notes=body.notes,
        created_at=datetime.now(timezone.utc),
    )
    session.add(liability)
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()
    await session.refresh(liability)
    logger.info("Liability created — user=%s type=%s remaining=%s %s", current_user.id, body.liability_type, body.remaining_amount, body.currency)
    return _liability_resp(liability)


@router.put("/liabilities/{liability_id}", response_model=LiabilityResponse)
async def update_liability(
    liability_id: str,
    body: LiabilityRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LiabilityResponse:
    try:
        lid = uuid.UUID(liability_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid liability ID")

    result = await session.execute(
        select(Liability).where(Liability.id == lid, Liability.user_id == current_user.id)
    )
    liability = result.scalar_one_or_none()
    if not liability:
        raise HTTPException(status_code=404, detail="Liability not found")

    due = _parse_opt_date(body.due_date, "due_date")
    end = _parse_opt_date(body.end_date, "end_date")

    liability.name = body.name
    liability.liability_type = body.liability_type
    liability.currency = body.currency
    liability.total_amount = Decimal(body.total_amount.replace(",", "."))
    liability.remaining_amount = Decimal(body.remaining_amount.replace(",", "."))
    liability.monthly_payment = Decimal(body.monthly_payment.replace(",", ".")) if body.monthly_payment else None
    liability.due_date = due
    liability.end_date = end
    liability.interest_rate = Decimal(body.interest_rate.replace(",", ".")) if body.interest_rate else None
    liability.reminder_days = _clean_reminder_days(body.reminder_days)
    liability.notes = body.notes
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()
    await session.refresh(liability)
    return _liability_resp(liability)


@router.delete("/liabilities/{liability_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_liability(
    liability_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        lid = uuid.UUID(liability_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid liability ID")

    result = await session.execute(
        delete(Liability).where(Liability.id == lid, Liability.user_id == current_user.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Liability not found")
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()


# ---------- Receivables ----------

@router.get("/receivables", response_model=list[ReceivableResponse])
async def list_receivables(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReceivableResponse]:
    cutoff = _archive_cutoff()
    result = await session.execute(
        select(Receivable)
        .where(
            Receivable.user_id == current_user.id,
            Receivable.status != "written_off",
            ~(
                (Receivable.status == "received")
                & (Receivable.created_at < cutoff)
            ),
        )
        .order_by(Receivable.created_at)
    )
    return [_receivable_resp(r) for r in result.scalars().all()]


@router.post("/receivables", response_model=ReceivableResponse, status_code=status.HTTP_201_CREATED)
async def create_receivable(
    body: ReceivableRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReceivableResponse:
    exp = None
    if body.expected_date:
        try:
            exp = date.fromisoformat(body.expected_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="expected_date must be YYYY-MM-DD")

    receivable = Receivable(
        id=uuid.uuid4(),
        user_id=current_user.id,
        from_person=body.from_person,
        amount=Decimal(body.amount.replace(",", ".")),
        currency=body.currency,
        expected_date=exp,
        notes=body.notes,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    session.add(receivable)
    await session.commit()
    await session.refresh(receivable)
    logger.info("Receivable created — user=%s from=%s amount=%s %s", current_user.id, body.from_person, body.amount, body.currency)
    return _receivable_resp(receivable)


@router.patch("/receivables/{receivable_id}/status", response_model=StatusPatchResponse)
async def update_receivable_status(
    receivable_id: str,
    body: StatusPatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StatusPatchResponse:
    try:
        rid = uuid.UUID(receivable_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid receivable ID")

    result = await session.execute(
        select(Receivable).where(Receivable.id == rid, Receivable.user_id == current_user.id)
    )
    receivable = result.scalar_one_or_none()
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")

    created_asset_resp: AssetResponse | None = None
    toast_msg: str | None = None

    if body.status == "received":
        existing_asset = await _find_receivable_asset(receivable, session)
        if existing_asset:
            receivable.linked_asset_id = existing_asset.id
            created_asset_resp = _asset_resp(existing_asset)
            toast_msg = "Bu alacak zaten nakit varlık olarak işlenmiş."
        else:
            # Auto-create cash asset from the received receivable.
            now = datetime.now(timezone.utc)
            asset = Asset(
                id=uuid.uuid4(),
                user_id=current_user.id,
                name=f"Receivable: {receivable.from_person}",
                asset_type="cash",
                currency=receivable.currency,
                current_value=receivable.amount,
                source="receivable_collection",
                source_detail=json.dumps(
                    {
                        "subtype": "receivable_collection",
                        "receivable_id": str(receivable.id),
                        "from_person": receivable.from_person,
                    }
                ),
                as_of_date=date.today(),
                created_at=now,
                updated_at=now,
            )
            session.add(asset)
            await session.flush()  # get asset.id populated
            receivable.linked_asset_id = asset.id
            await session.refresh(asset)
            created_asset_resp = _asset_resp(asset)
            toast_msg = f"{receivable.from_person} receivable added as cash asset."
            _add_financial_event(
                session,
                user_id=current_user.id,
                event_type="receivable_collected",
                entity_type="receivable",
                entity_id=receivable.id,
                amount=receivable.amount,
                currency=receivable.currency,
                source="manual",
                source_detail={
                    "asset_id": str(asset.id),
                    "from_person": receivable.from_person,
                },
            )
        await bust_networth_insight_cache(current_user.id, session)
    elif receivable.status == "received":
        linked_asset = await _find_receivable_asset(receivable, session)
        if linked_asset:
            await session.delete(linked_asset)
            receivable.linked_asset_id = None
            toast_msg = "Linked cash asset removed because receivable is no longer received."
            _add_financial_event(
                session,
                user_id=current_user.id,
                event_type="receivable_collection_reversed",
                entity_type="receivable",
                entity_id=receivable.id,
                amount=receivable.amount,
                currency=receivable.currency,
                source="manual",
                source_detail={
                    "asset_id": str(linked_asset.id),
                    "from_person": receivable.from_person,
                    "new_status": body.status,
                },
            )
            await bust_networth_insight_cache(current_user.id, session)

    receivable.status = body.status
    await session.commit()
    await session.refresh(receivable)

    return StatusPatchResponse(
        receivable=_receivable_resp(receivable),
        created_asset=created_asset_resp,
        toast_message=toast_msg,
    )


@router.delete("/receivables/{receivable_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_receivable(
    receivable_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        rid = uuid.UUID(receivable_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid receivable ID")

    result = await session.execute(
        select(Receivable).where(Receivable.id == rid, Receivable.user_id == current_user.id)
    )
    receivable = result.scalar_one_or_none()
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")

    linked_asset = await _find_receivable_asset(receivable, session)
    if linked_asset:
        await session.delete(linked_asset)
        logger.info(
            "Receivable delete removed linked asset — receivable=%s asset=%s user=%s",
            receivable.id,
            linked_asset.id,
            current_user.id,
        )

    receivable.status = "written_off"
    receivable.linked_asset_id = None
    _add_financial_event(
        session,
        user_id=current_user.id,
        event_type="receivable_written_off",
        entity_type="receivable",
        entity_id=receivable.id,
        amount=receivable.amount,
        currency=receivable.currency,
        source="manual",
        source_detail={
            "removed_asset_id": str(linked_asset.id) if linked_asset else None,
            "from_person": receivable.from_person,
        },
    )
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()


# ---------- Receivables PUT (full update) ----------

@router.put("/receivables/{receivable_id}", response_model=ReceivableResponse)
async def update_receivable(
    receivable_id: str,
    body: ReceivableRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReceivableResponse:
    try:
        rid = uuid.UUID(receivable_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid receivable ID")

    result = await session.execute(
        select(Receivable).where(Receivable.id == rid, Receivable.user_id == current_user.id)
    )
    receivable = result.scalar_one_or_none()
    if not receivable:
        raise HTTPException(status_code=404, detail="Receivable not found")

    exp = None
    if body.expected_date:
        try:
            exp = date.fromisoformat(body.expected_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="expected_date must be YYYY-MM-DD")

    receivable.from_person = body.from_person
    receivable.amount = Decimal(body.amount.replace(",", "."))
    receivable.currency = body.currency
    receivable.expected_date = exp
    receivable.notes = body.notes
    await session.commit()
    await session.refresh(receivable)
    return _receivable_resp(receivable)


# ---------- Net Worth Analyze (focused session-only chat) ----------

class AnalyzeRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("message cannot be empty")
        if len(v) > 2000:
            raise ValueError("message too long")
        return v.strip()


class AnalyzeResponse(BaseModel):
    reply: str


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_networth(
    body: AnalyzeRequest,
    lang: str = "en",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AnalyzeResponse:
    """
    Session-only focused analysis chat. Not persisted. Uses full net worth context.
    """
    from app.services.llm_provider import get_provider
    from app.services.currency import convert

    assets_result = await session.execute(select(Asset).where(Asset.user_id == current_user.id))
    assets = assets_result.scalars().all()
    liabilities_result = await session.execute(select(Liability).where(Liability.user_id == current_user.id))
    liabilities = liabilities_result.scalars().all()

    total_assets_usd = 0.0
    total_liabilities_usd = 0.0
    asset_lines = []
    for a in assets:
        try:
            usd = await convert(float(a.current_value), a.currency, "USD")
            total_assets_usd += usd
            asset_lines.append(f"- {a.name} ({a.asset_type}): {float(a.current_value):.2f} {a.currency} ≈ ${usd:,.0f}")
        except Exception:
            asset_lines.append(f"- {a.name} ({a.asset_type}): {float(a.current_value):.2f} {a.currency}")

    for l in liabilities:
        try:
            usd = await convert(float(l.remaining_amount), l.currency, "USD")
            total_liabilities_usd += usd
        except Exception:
            pass

    net_worth_usd = total_assets_usd - total_liabilities_usd

    context = f"""Net worth: ${net_worth_usd:,.0f} USD
Total assets: ${total_assets_usd:,.0f} USD
Total liabilities: ${total_liabilities_usd:,.0f} USD

Assets:
{chr(10).join(asset_lines) if asset_lines else "None"}

Liabilities:
{"; ".join(f"{l.name}: {float(l.remaining_amount):.2f} {l.currency}" for l in liabilities) or "None"}"""

    lang_line = f"Respond in {lang}." if lang else "Respond in English."
    system = f"""You are a focused financial analyst. The user wants a quick, data-driven analysis of their net worth.
{lang_line}
Use the exact numbers provided. Do calculations when asked (e.g. what-if scenarios).
Be direct, specific, and concise. No generic advice — only analysis grounded in the user's actual data.

USER'S FINANCIAL SNAPSHOT:
{context}"""

    try:
        provider = get_provider()
        reply = await provider.complete(
            system_prompt=system,
            user_message=body.message,
            temperature=0.3,
        )
        return AnalyzeResponse(reply=reply or "I could not generate an analysis. Please try again.")
    except Exception:
        return AnalyzeResponse(reply="Analysis unavailable right now. Please try again.")


# ---------- Suggestions ----------

@router.get("/suggestions", response_model=list[SuggestionResponse])
async def list_suggestions(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SuggestionResponse]:
    await _cleanup_processed_suggestions(current_user.id, session)
    await session.commit()
    result = await session.execute(
        select(NetworthSuggestion).where(
            NetworthSuggestion.user_id == current_user.id,
            NetworthSuggestion.status == "pending",
        ).order_by(NetworthSuggestion.created_at.desc())
    )
    return [_suggestion_resp(s) for s in result.scalars().all()]


@router.post("/suggestions/{suggestion_id}/accept", response_model=SuggestionResponse)
async def accept_suggestion(
    suggestion_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SuggestionResponse:
    try:
        sid = uuid.UUID(suggestion_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid suggestion ID")

    result = await session.execute(
        select(NetworthSuggestion).where(
            NetworthSuggestion.id == sid,
            NetworthSuggestion.user_id == current_user.id,
        )
    )
    suggestion = result.scalar_one_or_none()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if suggestion.status != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")

    now = datetime.now(timezone.utc)
    value = abs(suggestion.suggested_change)
    detail: dict = {}
    if suggestion.source_detail:
        try:
            detail = json.loads(suggestion.source_detail)
        except Exception:
            detail = {}
    proposed_name = (detail.get("proposed_name") or suggestion.reason[:80])
    stype = suggestion.suggestion_type

    if stype == "asset_balance_update" and suggestion.asset_id:
        # Cash-flow ↔ net-worth bridge: SET the matched asset to the statement's closing
        # balance (replace, not add) — propose→confirm, never a silent overwrite.
        asset = (await session.execute(
            select(Asset).where(Asset.id == suggestion.asset_id, Asset.user_id == current_user.id)
        )).scalar_one_or_none()
        if asset:
            asset.current_value = value
            asset.as_of_date = date.today()
            asset.updated_at = now
            logger.info("Bridge accepted — asset %s balance set to %s", asset.id, value)

    elif stype == "statement_liability":
        # Credit-card statement → a liability (balance owed).
        session.add(Liability(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=proposed_name,
            liability_type="credit_card",
            currency=suggestion.currency,
            total_amount=value,
            remaining_amount=value,
            notes=None,
            created_at=now,
        ))
        logger.info("Bridge accepted — created credit-card liability for user %s", current_user.id)

    elif stype == "statement_asset":
        # Deposit/bank statement → a bank-account asset at the detected balance.
        session.add(Asset(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=proposed_name,
            asset_type="bank_account",
            currency=suggestion.currency,
            current_value=value,
            source="auto_detected",
            source_detail=suggestion.source_detail,
            as_of_date=date.today(),
            created_at=now,
            updated_at=now,
        ))
        logger.info("Bridge accepted — created bank-account asset for user %s", current_user.id)

    elif suggestion.asset_id:
        # Legacy "balance_change": apply the delta to the existing asset.
        asset = (await session.execute(
            select(Asset).where(Asset.id == suggestion.asset_id, Asset.user_id == current_user.id)
        )).scalar_one_or_none()
        if asset:
            asset.current_value = asset.current_value + suggestion.suggested_change
            asset.updated_at = now
            logger.info("Suggestion accepted — updated asset %s by %s", asset.id, suggestion.suggested_change)

    else:
        # Legacy create.
        session.add(Asset(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=f"Öneri: {suggestion.reason[:80]}",
            asset_type="bank_account",
            currency=suggestion.currency,
            current_value=value,
            source="auto_detected",
            source_detail=suggestion.reason,
            as_of_date=date.today(),
            created_at=now,
            updated_at=now,
        ))
        logger.info("Suggestion accepted — created new asset for user %s", current_user.id)

    suggestion.status = "accepted"
    await bust_networth_insight_cache(current_user.id, session)
    await session.commit()
    await session.refresh(suggestion)
    return _suggestion_resp(suggestion)


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=SuggestionResponse)
async def dismiss_suggestion(
    suggestion_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SuggestionResponse:
    try:
        sid = uuid.UUID(suggestion_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid suggestion ID")

    result = await session.execute(
        select(NetworthSuggestion).where(
            NetworthSuggestion.id == sid,
            NetworthSuggestion.user_id == current_user.id,
        )
    )
    suggestion = result.scalar_one_or_none()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    suggestion.status = "dismissed"
    await session.commit()
    await session.refresh(suggestion)
    return _suggestion_resp(suggestion)


# ---------- Summary ----------

def _build_warnings(
    total_assets: float,
    total_liabilities: float,
    assets: list[Asset],
    liabilities: list[Liability],
    receivables: list[Receivable],
    target: str,
) -> list[str]:
    warnings: list[str] = []

    if total_assets > 0 and total_liabilities > 0.4 * total_assets:
        pct = round(total_liabilities / total_assets * 100)
        warnings.append(f"Borçlarınız varlıklarınızın %{pct}'ini oluşturuyor. Finansal risk yüksek.")

    # Liquid assets check (cash + bank_account, only TRY or converted)
    liquid_types = {"cash", "bank_account"}
    liquid_total = sum(
        float(a.current_value) for a in assets if a.asset_type in liquid_types
    )
    if liquid_total == 0:
        warnings.append("Likit varlık yok. Acil nakit ihtiyacında risk var.")

    # Overdue receivables
    today_str = date.today().isoformat()
    overdue = [
        r for r in receivables
        if r.status == "pending" and r.expected_date and r.expected_date.isoformat() < today_str
    ]
    if overdue:
        warnings.append(f"{len(overdue)} alacağınız gecikmiş durumda.")

    # High interest liabilities
    high_interest = [
        l for l in liabilities
        if l.interest_rate is not None and float(l.interest_rate) > 30
    ]
    for l in high_interest:
        warnings.append(f"Yüksek faizli borcunuz var (%{l.interest_rate}). Erken ödeme düşünebilirsiniz.")

    return warnings


async def _generate_ai_insight(
    total_assets: float,
    total_liabilities: float,
    net_worth: float,
    assets_by_type: dict[str, float],
    liabilities_by_type: dict[str, float],
    display_currency: str,
) -> str | None:
    """Generate a brief financial coaching insight. Returns None on failure."""
    llm_available = len(settings.DEEPSEEK_API_KEY) > 0 or len(settings.OPENAI_API_KEY) > 0
    if not llm_available:
        return None

    try:
        provider = get_provider()
        asset_breakdown = ", ".join(f"{k}: {v:.0f}" for k, v in assets_by_type.items())
        liability_breakdown = ", ".join(f"{k}: {v:.0f}" for k, v in liabilities_by_type.items()) or "yok"

        prompt = (
            f"Kullanıcının net değer durumu ({display_currency} bazında):\n"
            f"Toplam varlıklar: {total_assets:.0f}\n"
            f"Toplam borçlar: {total_liabilities:.0f}\n"
            f"Net değer: {net_worth:.0f}\n"
            f"Varlık dağılımı: {asset_breakdown}\n"
            f"Borç dağılımı: {liability_breakdown}\n\n"
            "Write a short, concrete, motivating 2-3 sentence coaching note about this net worth picture. "
            "Use the user's language when clear; otherwise use simple English. Mention one strength and one improvement point."
        )

        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": "You are a global personal finance coach. Be concise, practical, and non-judgmental."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
        )
        text = response.choices[0].message.content or ""
        return text.strip() if text.strip() else None
    except Exception as exc:
        logger.warning("Networth AI insight generation failed: %s", exc)
        return None


# ---------- AI Guidance ----------

class GuidanceAction(BaseModel):
    type: str
    params: dict = {}


class GuidanceFinding(BaseModel):
    id: str
    play: str
    severity: str
    observation: str
    context: str
    why: str
    move: str
    action: GuidanceAction | None = None


class GuidanceResponse(BaseModel):
    findings: list[GuidanceFinding]
    cached: bool = False


def _guidance_cache_key(user_id: uuid.UUID, asset_ids: list[str], liability_ids: list[str], cur: str, lang: str) -> str:
    content = f"{user_id}|{cur}|{lang}|{','.join(sorted(asset_ids))}|{','.join(sorted(liability_ids))}"
    return hashlib.sha256(content.encode()).hexdigest()


@router.get("/guidance", response_model=GuidanceResponse)
async def get_guidance(
    display_currency: str = "TRY",
    lang: str = "tr",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GuidanceResponse:
    """
    WHAT: Ranked, benchmarked, action-linked findings about the user's net worth.
    WHY:  Replaces dead-end warnings. A deterministic rule engine computes findings;
          the LLM only narrates them. Cached 24 h, busted on asset/liability change.
    """
    cur = display_currency.upper()

    asset_ids = [str(a) for a in (await session.execute(
        select(Asset.id).where(Asset.user_id == current_user.id)
    )).scalars().all()]
    liability_ids = [str(li) for li in (await session.execute(
        select(Liability.id).where(Liability.user_id == current_user.id)
    )).scalars().all()]
    key = _guidance_cache_key(current_user.id, asset_ids, liability_ids, cur, lang)

    # Cache lookup (separate data_type row from the legacy insight).
    row = (await session.execute(
        select(ProgressInsight).where(
            ProgressInsight.user_id == current_user.id,
            ProgressInsight.data_type == _GUIDANCE_DATA_TYPE,
        )
    )).scalar_one_or_none()
    if row is not None and row.cache_key == key:
        age = datetime.now(timezone.utc) - row.generated_at.replace(tzinfo=timezone.utc)
        if age < timedelta(hours=_CACHE_TTL_HOURS):
            findings = json.loads(row.data)
            return GuidanceResponse(findings=findings, cached=True)

    findings = await build_guidance(current_user.id, cur, lang, session)

    stmt = (
        pg_insert(ProgressInsight)
        .values(
            id=uuid.uuid4(),
            user_id=current_user.id,
            data_type=_GUIDANCE_DATA_TYPE,
            cache_key=key,
            data=json.dumps(findings, ensure_ascii=False),
            generated_at=datetime.now(timezone.utc),
        )
        .on_conflict_do_update(
            constraint="uq_progress_insights_user_type",
            set_={"cache_key": key, "data": json.dumps(findings, ensure_ascii=False),
                  "generated_at": datetime.now(timezone.utc)},
        )
    )
    await session.execute(stmt)
    await session.commit()
    return GuidanceResponse(findings=findings, cached=False)


# ---------- Snapshots ----------

class SnapshotResponse(BaseModel):
    id: str
    net_worth_usd: str
    assets_usd: str
    liabilities_usd: str
    recorded_at: str
    estimated: bool = False


@router.post("/snapshot", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SnapshotResponse:
    """Upserts today's net-worth snapshot in USD (one per day)."""
    from app.services.networth_snapshot_service import upsert_snapshot

    snap = await upsert_snapshot(current_user.id, session)
    return SnapshotResponse(
        id=str(snap.id),
        net_worth_usd=str(snap.net_worth_usd),
        assets_usd=str(snap.assets_usd),
        liabilities_usd=str(snap.liabilities_usd),
        recorded_at=snap.recorded_at.isoformat(),
    )


class AttributionDriver(BaseModel):
    label: str
    kind: str
    amount: float
    direction: str


class AttributionResponse(BaseModel):
    period_days: int
    delta: float
    currency: str
    drivers: list[AttributionDriver]


@router.get("/attribution", response_model=AttributionResponse | None)
async def networth_attribution(
    display_currency: str = "TRY",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AttributionResponse | None:
    """Explains why net worth moved since the previous snapshot. Null until two
    breakdown-bearing snapshots exist."""
    from app.services.networth_attribution import build_attribution

    data = await build_attribution(current_user.id, session, display_currency)
    if data is None:
        return None
    return AttributionResponse(**data)


@router.get("/history", response_model=list[SnapshotResponse])
async def get_history(
    days: int = 90,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SnapshotResponse]:
    from app.models.networth_snapshot import NetworthSnapshot

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await session.execute(
        select(NetworthSnapshot)
        .where(
            NetworthSnapshot.user_id == current_user.id,
            NetworthSnapshot.recorded_at >= cutoff,
        )
        .order_by(NetworthSnapshot.recorded_at.asc())
    )
    snaps = list(result.scalars().all())

    if len(snaps) >= 2:
        return [
            SnapshotResponse(
                id=str(s.id),
                net_worth_usd=str(s.net_worth_usd),
                assets_usd=str(s.assets_usd),
                liabilities_usd=str(s.liabilities_usd),
                recorded_at=s.recorded_at.isoformat(),
            )
            for s in snaps
        ]

    # Too few real snapshots to draw a line — reconstruct an estimated USD
    # trajectory from monthly cash flow, anchored to the true current net worth.
    return await _reconstruct_history_usd(current_user.id, session)


async def _reconstruct_history_usd(user_id: uuid.UUID, session: AsyncSession) -> list[SnapshotResponse]:
    import calendar as _cal
    from app.services.transaction_service import dedup_transactions_orm

    assets = list((await session.execute(select(Asset).where(Asset.user_id == user_id))).scalars().all())
    liabilities = list((await session.execute(select(Liability).where(Liability.user_id == user_id))).scalars().all())
    assets_usd = 0.0
    for a in assets:
        assets_usd += await convert(float(a.current_value), a.currency, "USD")
    liab_usd = 0.0
    for li in liabilities:
        liab_usd += await convert(float(li.remaining_amount), li.currency, "USD")
    nw_usd = assets_usd - liab_usd

    tx_rows = list((await session.execute(select(Transaction).where(Transaction.user_id == user_id))).scalars().all())
    txns = dedup_transactions_orm(tx_rows)
    by_month: dict[str, float] = {}
    for t in txns:
        mk = f"{t.transaction_date.year:04d}-{t.transaction_date.month:02d}"
        flow = float(t.amount) if t.transaction_type == "credit" else -float(t.amount)
        by_month[mk] = by_month.get(mk, 0.0) + flow

    months = sorted(by_month.keys())
    if len(months) < 2:
        return []
    months = months[-12:]

    today = date.today()
    this_key = f"{today.year:04d}-{today.month:02d}"
    # net flows TRY-assumed → USD
    flows_usd: dict[str, float] = {}
    for mk in months:
        flows_usd[mk] = await convert(by_month[mk], "TRY", "USD")

    running = nw_usd
    pts: list[SnapshotResponse] = []
    for mk in reversed(months):
        if mk == this_key:
            d = today
        else:
            y, m = int(mk[:4]), int(mk[5:7])
            d = date(y, m, _cal.monthrange(y, m)[1])
        pts.append(SnapshotResponse(
            id=f"est-{mk}",
            net_worth_usd=str(round(running, 2)),
            assets_usd=str(round(max(running, 0.0), 2)),
            liabilities_usd="0",
            recorded_at=datetime(d.year, d.month, d.day, tzinfo=timezone.utc).isoformat(),
            estimated=True,
        ))
        running -= flows_usd.get(mk, 0.0)
    pts.reverse()
    return pts


# ---------- Summary ----------

@router.get("/summary", response_model=NetWorthSummary)
async def get_summary(
    display_currency: str = "TRY",
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NetWorthSummary:
    """Aggregates all assets, liabilities, receivables converted to display_currency."""
    target = display_currency.upper()

    assets_result = await session.execute(
        select(Asset).where(Asset.user_id == current_user.id)
    )
    assets = assets_result.scalars().all()

    liabilities_result = await session.execute(
        select(Liability).where(Liability.user_id == current_user.id)
    )
    liabilities = liabilities_result.scalars().all()

    receivables_result = await session.execute(
        select(Receivable).where(Receivable.user_id == current_user.id)
    )
    receivable_archive_cutoff = _archive_cutoff()
    all_receivables = [
        r for r in receivables_result.scalars().all()
        if r.status != "written_off"
        and not (r.status == "received" and r.created_at < receivable_archive_cutoff)
    ]
    pending_receivables = [r for r in all_receivables if r.status == "pending"]

    total_assets = 0.0
    assets_by_type: dict[str, float] = {}
    # Per currency: keep the native sum AND the display-converted sum — no TRY base.
    currency_breakdown: dict[str, dict[str, float]] = {}

    for a in assets:
        val = await convert(float(a.current_value), a.currency, target)
        total_assets += val
        assets_by_type[a.asset_type] = assets_by_type.get(a.asset_type, 0.0) + val
        entry = currency_breakdown.setdefault(a.currency, {"native": 0.0, "display": 0.0})
        entry["native"] += float(a.current_value)
        entry["display"] += val

    total_liabilities = 0.0
    liabilities_by_type: dict[str, float] = {}

    for l in liabilities:
        val = await convert(float(l.remaining_amount), l.currency, target)
        total_liabilities += val
        liabilities_by_type[l.liability_type] = liabilities_by_type.get(l.liability_type, 0.0) + val

    pending_recv_total = 0.0
    for r in pending_receivables:
        pending_recv_total += await convert(float(r.amount), r.currency, target)

    # Warnings (rule-based, instant)
    warnings = _build_warnings(total_assets, total_liabilities, list(assets), list(liabilities), all_receivables, target)

    # AI commentary now lives in GET /networth/guidance (ranked, action-linked
    # findings). The summary no longer spends an LLM call on a single blurb;
    # `ai_insight` stays in the schema as null for backward compatibility.
    ai_insight: str | None = None

    return NetWorthSummary(
        total_assets_try=round(total_assets, 2),
        total_liabilities_try=round(total_liabilities, 2),
        net_worth_try=round(total_assets - total_liabilities, 2),
        assets_by_type={k: round(v, 2) for k, v in assets_by_type.items()},
        liabilities_by_type={k: round(v, 2) for k, v in liabilities_by_type.items()},
        pending_receivables_try=round(pending_recv_total, 2),
        currency_breakdown=[
            CurrencyExposure(
                code=code,
                native_value=round(v["native"], 2),
                display_value=round(v["display"], 2),
            )
            for code, v in sorted(currency_breakdown.items(), key=lambda kv: kv[1]["display"], reverse=True)
        ],
        warnings=warnings,
        ai_insight=ai_insight,
    )
