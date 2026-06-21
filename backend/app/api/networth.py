import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.asset import Asset, ASSET_TYPES
from app.models.liability import Liability, LIABILITY_TYPES
from app.models.receivable import Receivable, RECEIVABLE_STATUSES
from app.models.user import User
from app.services.currency import convert

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/networth", tags=["networth"])

SUPPORTED_CURRENCIES = {"TRY", "USD", "EUR", "GBP", "CHF", "JPY", "XAU"}

# ---------- Pydantic models ----------

class AssetRequest(BaseModel):
    name: str
    asset_type: str
    currency: str = "TRY"
    current_value: str
    notes: str | None = None

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


class NetWorthSummary(BaseModel):
    total_assets_try: float
    total_liabilities_try: float
    net_worth_try: float
    assets_by_type: dict[str, float]
    liabilities_by_type: dict[str, float]
    pending_receivables_try: float
    currency_breakdown: dict[str, float]


# ---------- Helpers ----------

def _asset_resp(a: Asset) -> AssetResponse:
    return AssetResponse(
        id=str(a.id),
        name=a.name,
        asset_type=a.asset_type,
        currency=a.currency,
        current_value=str(a.current_value),
        notes=a.notes,
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
        created_at=now,
        updated_at=now,
    )
    session.add(asset)
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
    asset.updated_at = datetime.now(timezone.utc)
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


@router.patch("/receivables/{receivable_id}/status", response_model=ReceivableResponse)
async def update_receivable_status(
    receivable_id: str,
    body: StatusPatchRequest,
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

    receivable.status = body.status
    await session.commit()
    await session.refresh(receivable)
    return _receivable_resp(receivable)


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
        select(Receivable).where(
            Receivable.user_id == current_user.id,
            Receivable.status == "pending",
        )
    )
    receivables = receivables_result.scalars().all()

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

    pending_receivables = 0.0
    for r in receivables:
        pending_receivables += await convert(float(r.amount), r.currency, target)

    return NetWorthSummary(
        total_assets_try=round(total_assets, 2),
        total_liabilities_try=round(total_liabilities, 2),
        net_worth_try=round(total_assets - total_liabilities, 2),
        assets_by_type={k: round(v, 2) for k, v in assets_by_type.items()},
        liabilities_by_type={k: round(v, 2) for k, v in liabilities_by_type.items()},
        pending_receivables_try=round(pending_receivables, 2),
        currency_breakdown={k: round(v, 2) for k, v in currency_breakdown.items()},
    )
