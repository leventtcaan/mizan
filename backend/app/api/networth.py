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
from app.models.liability import Liability, LIABILITY_TYPES
from app.models.networth_suggestion import NetworthSuggestion
from app.models.progress_insight import ProgressInsight
from app.models.receivable import Receivable, RECEIVABLE_STATUSES
from app.models.user import User
from app.services.currency import convert
from app.services.llm_provider import get_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/networth", tags=["networth"])

_INSIGHT_DATA_TYPE = "networth_insight"
_CACHE_TTL_HOURS = 24

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
    created_at: datetime
    updated_at: datetime


class LiabilityRequest(BaseModel):
    name: str
    liability_type: str
    currency: str = "TRY"
    total_amount: str
    remaining_amount: str
    monthly_payment: str | None = None
    due_date: str | None = None  # ISO date string YYYY-MM-DD
    interest_rate: str | None = None
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
    interest_rate: str | None
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


class NetWorthSummary(BaseModel):
    total_assets_try: float
    total_liabilities_try: float
    net_worth_try: float
    assets_by_type: dict[str, float]
    liabilities_by_type: dict[str, float]
    pending_receivables_try: float
    currency_breakdown: dict[str, float]
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
        interest_rate=str(l.interest_rate) if l.interest_rate is not None else None,
        notes=l.notes,
        created_at=l.created_at,
    )


def _receivable_resp(r: Receivable) -> ReceivableResponse:
    return ReceivableResponse(
        id=str(r.id),
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
    )


def _parse_as_of_date(as_of_date_str: str | None) -> date:
    if not as_of_date_str:
        return date.today()
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
    """Delete cached networth AI insight so next summary request regenerates it."""
    await session.execute(
        delete(ProgressInsight).where(
            ProgressInsight.user_id == user_id,
            ProgressInsight.data_type == _INSIGHT_DATA_TYPE,
        )
    )
    logger.info("Networth insight cache busted — user_id=%s", user_id)


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
    due = None
    if body.due_date:
        try:
            due = date.fromisoformat(body.due_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="due_date must be YYYY-MM-DD")

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
        interest_rate=Decimal(body.interest_rate.replace(",", ".")) if body.interest_rate else None,
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

    due = None
    if body.due_date:
        try:
            due = date.fromisoformat(body.due_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="due_date must be YYYY-MM-DD")

    liability.name = body.name
    liability.liability_type = body.liability_type
    liability.currency = body.currency
    liability.total_amount = Decimal(body.total_amount.replace(",", "."))
    liability.remaining_amount = Decimal(body.remaining_amount.replace(",", "."))
    liability.monthly_payment = Decimal(body.monthly_payment.replace(",", ".")) if body.monthly_payment else None
    liability.due_date = due
    liability.interest_rate = Decimal(body.interest_rate.replace(",", ".")) if body.interest_rate else None
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
    result = await session.execute(
        select(Receivable).where(Receivable.user_id == current_user.id).order_by(Receivable.created_at)
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

    receivable.status = body.status
    created_asset_resp: AssetResponse | None = None
    toast_msg: str | None = None

    if body.status == "received":
        # Auto-create cash asset from the received receivable
        now = datetime.now(timezone.utc)
        asset = Asset(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=f"Alacak: {receivable.from_person}",
            asset_type="cash",
            currency=receivable.currency,
            current_value=receivable.amount,
            source="receivable_collection",
            source_detail=f"Alacak tahsilatı: {receivable.from_person}",
            as_of_date=date.today(),
            created_at=now,
            updated_at=now,
        )
        session.add(asset)
        await session.flush()  # get asset.id populated
        await session.refresh(asset)
        created_asset_resp = _asset_resp(asset)
        toast_msg = f"{receivable.from_person}'den alınan {receivable.currency} {receivable.amount} nakit olarak eklendi."
        await bust_networth_insight_cache(current_user.id, session)

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
        delete(Receivable).where(Receivable.id == rid, Receivable.user_id == current_user.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Receivable not found")
    await session.commit()


# ---------- Suggestions ----------

@router.get("/suggestions", response_model=list[SuggestionResponse])
async def list_suggestions(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SuggestionResponse]:
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

    if suggestion.asset_id:
        # Apply suggested_change to existing asset
        asset_result = await session.execute(
            select(Asset).where(Asset.id == suggestion.asset_id, Asset.user_id == current_user.id)
        )
        asset = asset_result.scalar_one_or_none()
        if asset:
            asset.current_value = asset.current_value + suggestion.suggested_change
            asset.updated_at = datetime.now(timezone.utc)
            logger.info("Suggestion accepted — updated asset %s by %s", asset.id, suggestion.suggested_change)
    else:
        # Create new asset
        now = datetime.now(timezone.utc)
        new_asset = Asset(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=f"Öneri: {suggestion.reason[:80]}",
            asset_type="bank_account",
            currency=suggestion.currency,
            current_value=abs(suggestion.suggested_change),
            source="auto_detected",
            source_detail=suggestion.reason,
            as_of_date=date.today(),
            created_at=now,
            updated_at=now,
        )
        session.add(new_asset)
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
    """Generate a brief Turkish financial coaching insight. Returns None on failure."""
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
            "Bu finansal tablo hakkında 2-3 cümlelik kısa, somut ve motive edici bir Türkçe koçluk yorumu yaz. "
            "Güçlü yanları ve geliştirilebilecek bir noktayı belirt."
        )

        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": "Sen Türk kullanıcılara kişisel finans koçluğu yapan bir uzmansın. Kısa ve net konuş."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
        )
        text = response.choices[0].message.content or ""
        return text.strip() if text.strip() else None
    except Exception as exc:
        logger.warning("Networth AI insight generation failed: %s", exc)
        return None


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
    all_receivables = receivables_result.scalars().all()
    pending_receivables = [r for r in all_receivables if r.status == "pending"]

    total_assets = 0.0
    assets_by_type: dict[str, float] = {}
    currency_breakdown: dict[str, float] = {}

    for a in assets:
        val = await convert(float(a.current_value), a.currency, target)
        total_assets += val
        assets_by_type[a.asset_type] = assets_by_type.get(a.asset_type, 0.0) + val
        original_try = await convert(float(a.current_value), a.currency, "TRY")
        currency_breakdown[a.currency] = currency_breakdown.get(a.currency, 0.0) + original_try

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

    # AI insight with cache
    asset_ids = [str(a.id) for a in assets]
    liability_ids = [str(l.id) for l in liabilities]
    cache_key = _insight_cache_key(current_user.id, asset_ids, liability_ids)

    cached_data = await _insight_cache_get(current_user.id, cache_key, session)
    if cached_data:
        ai_insight: str | None = json.loads(cached_data).get("insight")
        logger.info("Networth insight cache hit — user_id=%s", current_user.id)
    else:
        ai_insight = await _generate_ai_insight(
            total_assets, total_liabilities,
            total_assets - total_liabilities,
            assets_by_type, liabilities_by_type,
            target,
        )
        await _insight_cache_set(
            current_user.id,
            cache_key,
            json.dumps({"insight": ai_insight}),
            session,
        )
        await session.commit()

    return NetWorthSummary(
        total_assets_try=round(total_assets, 2),
        total_liabilities_try=round(total_liabilities, 2),
        net_worth_try=round(total_assets - total_liabilities, 2),
        assets_by_type={k: round(v, 2) for k, v in assets_by_type.items()},
        liabilities_by_type={k: round(v, 2) for k, v in liabilities_by_type.items()},
        pending_receivables_try=round(pending_recv_total, 2),
        currency_breakdown={k: round(v, 2) for k, v in currency_breakdown.items()},
        warnings=warnings,
        ai_insight=ai_insight,
    )
