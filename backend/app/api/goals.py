import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.dependencies import get_current_user
from app.models.budget_goal import BudgetGoal
from app.models.transaction import Transaction
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/goals", tags=["goals"])

VALID_CATEGORIES = {
    "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
    "giyim", "nakit_atm", "transfer", "iade", "vergi", "teknoloji", "diger",
}


class GoalRequest(BaseModel):
    category: str
    monthly_limit: str  # string so the frontend can send "1500" or "1500.00"

    @field_validator("category")
    @classmethod
    def valid_cat(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category. Must be one of: {sorted(VALID_CATEGORIES)}")
        return v

    @field_validator("monthly_limit")
    @classmethod
    def valid_limit(cls, v: str) -> str:
        try:
            val = Decimal(v.replace(",", "."))
        except Exception:
            raise ValueError("monthly_limit must be a valid number")
        if val <= 0:
            raise ValueError("monthly_limit must be positive")
        return v


class GoalResponse(BaseModel):
    id: str
    category: str
    monthly_limit: str
    created_at: datetime


class GoalStatusItem(BaseModel):
    category: str
    monthly_limit: str
    spent_this_month: str
    remaining: str
    pct_used: float
    status: str  # "ok" | "warning" | "exceeded"


@router.get("", response_model=list[GoalResponse])
async def list_goals(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GoalResponse]:
    result = await session.execute(
        select(BudgetGoal)
        .where(BudgetGoal.user_id == current_user.id)
        .order_by(BudgetGoal.category)
    )
    goals = result.scalars().all()
    return [
        GoalResponse(
            id=str(g.id),
            category=g.category,
            monthly_limit=str(g.monthly_limit),
            created_at=g.created_at,
        )
        for g in goals
    ]


@router.post("", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
async def upsert_goal(
    body: GoalRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GoalResponse:
    """
    WHAT: Creates or updates the monthly spending limit for one category.
    WHY: Upsert (INSERT … ON CONFLICT DO UPDATE) so the frontend can POST the same
         category twice to update the limit — no separate PUT/PATCH needed.
    """
    limit = Decimal(body.monthly_limit.replace(",", "."))
    goal_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    stmt = (
        pg_insert(BudgetGoal)
        .values(
            id=goal_id,
            user_id=current_user.id,
            category=body.category,
            monthly_limit=limit,
            created_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_budget_goals_user_category",
            set_={"monthly_limit": limit, "created_at": now},
        )
        .returning(BudgetGoal.id, BudgetGoal.category, BudgetGoal.monthly_limit, BudgetGoal.created_at)
    )
    result = await session.execute(stmt)
    row = result.one()
    await session.commit()

    logger.info("Goal upserted — user=%s category=%s limit=%s", current_user.id, body.category, limit)
    return GoalResponse(
        id=str(row.id),
        category=row.category,
        monthly_limit=str(row.monthly_limit),
        created_at=row.created_at,
    )


@router.delete("/{category}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    category: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    result = await session.execute(
        delete(BudgetGoal)
        .where(BudgetGoal.user_id == current_user.id, BudgetGoal.category == category)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No goal found for category '{category}'")
    await session.commit()


@router.get("/status", response_model=list[GoalStatusItem])
async def goal_status(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GoalStatusItem]:
    """
    WHAT: For each budget goal, computes how much has been spent in the current calendar month.
    WHY: Real-time — not cached, because spending changes every time a transaction is added.
         Debit transactions only; credit/transfer excluded from spend.
    """
    goals_result = await session.execute(
        select(BudgetGoal)
        .where(BudgetGoal.user_id == current_user.id)
        .order_by(BudgetGoal.category)
    )
    goals = goals_result.scalars().all()

    if not goals:
        return []

    today = date.today()
    month_start = date(today.year, today.month, 1)

    # Fetch all debit transactions this month for this user
    tx_result = await session.execute(
        select(Transaction)
        .where(
            Transaction.user_id == current_user.id,
            Transaction.transaction_type == "debit",
            Transaction.transaction_date >= month_start,
        )
    )
    txs = tx_result.scalars().all()

    # Aggregate spending per category
    spent_by_cat: dict[str, Decimal] = {}
    for t in txs:
        if t.category:
            spent_by_cat[t.category] = spent_by_cat.get(t.category, Decimal("0")) + t.amount

    items: list[GoalStatusItem] = []
    for g in goals:
        spent = spent_by_cat.get(g.category, Decimal("0"))
        remaining = g.monthly_limit - spent
        pct = float(spent / g.monthly_limit * 100) if g.monthly_limit > 0 else 0.0
        if pct >= 100:
            goal_status_str = "exceeded"
        elif pct >= 80:
            goal_status_str = "warning"
        else:
            goal_status_str = "ok"

        items.append(GoalStatusItem(
            category=g.category,
            monthly_limit=str(g.monthly_limit),
            spent_this_month=str(spent),
            remaining=str(remaining),
            pct_used=round(pct, 1),
            status=goal_status_str,
        ))

    return items
