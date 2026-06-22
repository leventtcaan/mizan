import json
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.asset import Asset
from app.models.liability import Liability
from app.models.wealth_alert import WealthAlert, ALERT_TYPES
from app.models.user import User
from app.services.currency import convert

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts/wealth", tags=["wealth-alerts"])


class CreateAlertRequest(BaseModel):
    alert_type: str
    asset_id: str | None = None
    threshold_usd: float | None = None
    message: str

    @field_validator("alert_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ALERT_TYPES:
            raise ValueError(f"alert_type must be one of: {sorted(ALERT_TYPES)}")
        return v

    @field_validator("message")
    @classmethod
    def non_empty_message(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message cannot be empty")
        return v


class AlertResponse(BaseModel):
    id: str
    alert_type: str
    condition_json: str
    message_template: str
    is_active: bool
    triggered_at: str | None
    created_at: str
    asset_id: str | None = None
    threshold_usd: float | None = None


class TriggeredAlert(BaseModel):
    alert: AlertResponse
    triggered_reason: str
    current_value: float | None


def _alert_resp(a: WealthAlert) -> AlertResponse:
    cond: dict = {}
    try:
        cond = json.loads(a.condition_json)
    except Exception:
        pass
    return AlertResponse(
        id=str(a.id),
        alert_type=a.alert_type,
        condition_json=a.condition_json,
        message_template=a.message_template,
        is_active=a.is_active,
        triggered_at=a.triggered_at.isoformat() if a.triggered_at else None,
        created_at=a.created_at.isoformat(),
        asset_id=cond.get("asset_id"),
        threshold_usd=cond.get("threshold_usd"),
    )


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: CreateAlertRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AlertResponse:
    condition: dict = {}

    if body.alert_type == "asset_price_drop":
        if not body.asset_id:
            raise HTTPException(status_code=422, detail="asset_id required for asset_price_drop")
        if body.threshold_usd is None or body.threshold_usd <= 0:
            raise HTTPException(status_code=422, detail="threshold_usd must be positive")
        try:
            aid = uuid.UUID(body.asset_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid asset_id")
        asset_check = await session.execute(select(Asset).where(Asset.id == aid, Asset.user_id == current_user.id))
        if not asset_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Asset not found")
        condition = {"asset_id": str(aid), "threshold_usd": body.threshold_usd}

    elif body.alert_type == "net_worth_drop":
        if body.threshold_usd is None or body.threshold_usd <= 0:
            raise HTTPException(status_code=422, detail="threshold_usd must be positive")
        condition = {"threshold_usd": body.threshold_usd}

    elif body.alert_type == "payment_coverage_risk":
        condition = {}

    alert = WealthAlert(
        user_id=current_user.id,
        alert_type=body.alert_type,
        condition_json=json.dumps(condition),
        message_template=body.message,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    session.add(alert)
    await session.commit()
    await session.refresh(alert)
    logger.info("WealthAlert created — user=%s type=%s", current_user.id, body.alert_type)
    return _alert_resp(alert)


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AlertResponse]:
    result = await session.execute(
        select(WealthAlert)
        .where(WealthAlert.user_id == current_user.id, WealthAlert.is_active == True)  # noqa: E712
        .order_by(WealthAlert.created_at.desc())
    )
    return [_alert_resp(a) for a in result.scalars().all()]


@router.get("/check", response_model=list[TriggeredAlert])
async def check_alerts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TriggeredAlert]:
    """Evaluate all active alerts against current data. Returns triggered ones."""
    result = await session.execute(
        select(WealthAlert)
        .where(WealthAlert.user_id == current_user.id, WealthAlert.is_active == True)  # noqa: E712
    )
    alerts = result.scalars().all()
    if not alerts:
        return []

    triggered: list[TriggeredAlert] = []

    for alert in alerts:
        cond: dict = {}
        try:
            cond = json.loads(alert.condition_json)
        except Exception:
            continue

        if alert.alert_type == "asset_price_drop":
            asset_id_str = cond.get("asset_id")
            threshold = cond.get("threshold_usd")
            if not asset_id_str or threshold is None:
                continue
            try:
                aid = uuid.UUID(asset_id_str)
            except ValueError:
                continue
            asset_result = await session.execute(
                select(Asset).where(Asset.id == aid, Asset.user_id == current_user.id)
            )
            asset = asset_result.scalar_one_or_none()
            if not asset or not asset.source_detail:
                continue
            # Skip nonsensical comparisons. A fiat holding priced in USD is just an
            # exchange rate (and USD itself is always 1.00) — fiat-vs-fiat is not a
            # real price-drop signal. Price alerts only make sense for genuinely
            # priced assets (crypto / stock / fund / gold / commodity).
            if asset.asset_type == "foreign_currency":
                continue
            try:
                detail = json.loads(asset.source_detail)
                last_price_usd = float(detail.get("last_price_usd", 0))
            except Exception:
                continue
            if last_price_usd <= 0:
                continue
            if last_price_usd < threshold:
                alert.triggered_at = datetime.now(timezone.utc)
                triggered.append(TriggeredAlert(
                    alert=_alert_resp(alert),
                    triggered_reason=f"Price dropped to ${last_price_usd:,.2f} (threshold: ${threshold:,.2f})",
                    current_value=last_price_usd,
                ))

        elif alert.alert_type == "net_worth_drop":
            threshold = cond.get("threshold_usd")
            if threshold is None:
                continue
            assets_result = await session.execute(select(Asset).where(Asset.user_id == current_user.id))
            assets = assets_result.scalars().all()
            liabilities_result = await session.execute(select(Liability).where(Liability.user_id == current_user.id))
            liabilities = liabilities_result.scalars().all()
            assets_usd = sum(
                (await convert(float(a.current_value), a.currency, "USD"))
                for a in assets
            )
            liabilities_usd = sum(
                (await convert(float(l.remaining_amount), l.currency, "USD"))
                for l in liabilities
            )
            net_usd = assets_usd - liabilities_usd
            if net_usd < threshold:
                alert.triggered_at = datetime.now(timezone.utc)
                triggered.append(TriggeredAlert(
                    alert=_alert_resp(alert),
                    triggered_reason=f"Net worth ${net_usd:,.0f} is below threshold ${threshold:,.0f}",
                    current_value=net_usd,
                ))

        elif alert.alert_type == "payment_coverage_risk":
            liquid_types = {"cash", "bank_account"}
            assets_result = await session.execute(select(Asset).where(Asset.user_id == current_user.id, Asset.asset_type.in_(liquid_types)))
            assets = assets_result.scalars().all()
            liabilities_result = await session.execute(select(Liability).where(Liability.user_id == current_user.id, Liability.monthly_payment != None))  # noqa: E711
            liabilities = liabilities_result.scalars().all()

            liquid_usd = sum((await convert(float(a.current_value), a.currency, "USD")) for a in assets)
            payments_usd = sum((await convert(float(l.monthly_payment), l.currency, "USD")) for l in liabilities)

            if payments_usd > 0 and liquid_usd < payments_usd:
                alert.triggered_at = datetime.now(timezone.utc)
                triggered.append(TriggeredAlert(
                    alert=_alert_resp(alert),
                    triggered_reason=f"Liquid assets ${liquid_usd:,.0f} < monthly payments ${payments_usd:,.0f}",
                    current_value=liquid_usd,
                ))

    if triggered:
        await session.commit()

    return triggered


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        aid = uuid.UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid alert ID")
    result = await session.execute(
        delete(WealthAlert).where(WealthAlert.id == aid, WealthAlert.user_id == current_user.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    await session.commit()
