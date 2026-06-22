"""
Global AI assistant — one surface, full context, can propose AND execute actions.

Trust model: the LLM may emit ONE structured proposal per reply inside a fenced
```mizan_action {json} ``` block. We parse it out, persist it server-side as an
AssistantAction(status=proposed), and return it to the client. Execution happens
only via /assistant/action/confirm, which loads the stored row and re-validates
ownership of every referenced entity. LLM params are treated as untrusted.
"""

import json
import logging
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_notification import AppNotification
from app.models.asset import Asset, ASSET_TYPES
from app.models.assistant_action import AssistantAction, ASSISTANT_ACTION_TYPES
from app.models.behavioral_profile import BehavioralProfile  # noqa: F401 — ensure mapper registered
from app.models.liability import Liability, LIABILITY_TYPES
from app.models.receivable import Receivable
from app.models.reconciliation_item import ReconciliationItem
from app.models.transaction import Transaction
from app.models.user import User
from app.services.behavioral_coach import (
    build_profile_context,
    build_spending_summary,
    get_or_create_profile,
)
from app.services.llm_provider import get_provider
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)

_ACTION_BLOCK_RE = re.compile(r"```mizan_action\s*(\{.*?\})\s*```", re.DOTALL)

_SYSTEM_PROMPT = """You are Mizan, a global personal finance assistant. You can see the user's real financial data below.

RULES:
- Respond in the user's language. If unclear, use simple English.
- Be specific and grounded in the actual numbers/IDs provided. No generic advice.
- Keep replies short (2-4 sentences).
- You may PROPOSE exactly ONE concrete action when the user's request maps cleanly to it.
  When you do, append this block at the very end of your reply (and nowhere else):
```mizan_action
{"action_type": "<type>", "params": {...}, "confirmation_required": true, "description": "<one short human sentence>"}
```
- Only use IDs that appear in the context. Never invent IDs or amounts.
- If you are unsure or the user is just chatting, do NOT emit an action block.

ALLOWED action_type values and their params:
- mark_receivable_received: {"receivable_id": "<id>"}
- dismiss_reconciliation_item: {"item_id": "<id>"}
- categorize_transaction: {"transaction_id": "<id>", "category": "<category_slug>"}
- create_asset: {"name": "<str>", "asset_type": "<type>", "currency": "<CODE>", "current_value": "<number>"}
- add_liability: {"name": "<str>", "liability_type": "<type>", "currency": "<CODE>", "total_amount": "<number>", "remaining_amount": "<number>"}
"""


# ───────────────────────── context builders ─────────────────────────

async def _profile_and_spending(user_id: uuid.UUID, session: AsyncSession) -> str:
    profile = await get_or_create_profile(user_id, session)
    txns = await get_transactions_for_user(user_id, session, all_batches=False)
    return f"{build_profile_context(profile)}\n{build_spending_summary(txns)}"


async def _assets_block(user_id: uuid.UUID, session: AsyncSession) -> str:
    result = await session.execute(select(Asset).where(Asset.user_id == user_id))
    lines = [
        f"- [{a.id}] {a.name} · {a.asset_type} · {float(a.current_value):.2f} {a.currency}"
        for a in result.scalars().all()
    ]
    return "ASSETS:\n" + ("\n".join(lines) if lines else "None")


async def _liabilities_block(user_id: uuid.UUID, session: AsyncSession) -> str:
    result = await session.execute(select(Liability).where(Liability.user_id == user_id))
    lines = [
        f"- [{l.id}] {l.name} · {l.liability_type} · remaining {float(l.remaining_amount):.2f} {l.currency}"
        for l in result.scalars().all()
    ]
    return "LIABILITIES:\n" + ("\n".join(lines) if lines else "None")


async def _receivables_block(user_id: uuid.UUID, session: AsyncSession) -> str:
    result = await session.execute(
        select(Receivable).where(
            Receivable.user_id == user_id,
            Receivable.status.in_(["pending", "overdue"]),
        )
    )
    lines = [
        f"- [{r.id}] {r.from_person} owes {float(r.amount):.2f} {r.currency}"
        f" · status {r.status}" + (f" · due {r.expected_date.isoformat()}" if r.expected_date else "")
        for r in result.scalars().all()
    ]
    return "RECEIVABLES (open):\n" + ("\n".join(lines) if lines else "None")


async def _transactions_block(user_id: uuid.UUID, session: AsyncSession) -> str:
    txns = await get_transactions_for_user(user_id, session, all_batches=False)
    lines = [
        f"- [{t.id}] {t.transaction_date.isoformat()} · {t.description[:40]} · "
        f"{float(t.amount):.2f} · {t.transaction_type} · {t.category or 'uncategorized'}"
        for t in txns[:20]
    ]
    return "RECENT TRANSACTIONS:\n" + ("\n".join(lines) if lines else "None")


async def _action_queue_block(user_id: uuid.UUID, session: AsyncSession) -> str:
    recon = await session.execute(
        select(ReconciliationItem).where(
            ReconciliationItem.user_id == user_id,
            ReconciliationItem.status == "open",
        ).order_by(ReconciliationItem.created_at.desc()).limit(10)
    )
    recon_lines = [f"- [{i.id}] {i.issue_type} · {i.title}" for i in recon.scalars().all()]

    notifs = await session.execute(
        select(AppNotification).where(
            AppNotification.user_id == user_id,
            AppNotification.is_read == False,  # noqa: E712
        ).order_by(AppNotification.created_at.desc()).limit(5)
    )
    notif_lines = [f"- {n.title}: {n.message}" for n in notifs.scalars().all()]

    return (
        "ACTION QUEUE (open reconciliation items):\n"
        + ("\n".join(recon_lines) if recon_lines else "None")
        + "\n\nUNREAD NOTIFICATIONS:\n"
        + ("\n".join(notif_lines) if notif_lines else "None")
    )


async def build_context(user_id: uuid.UUID, page_context: str, session: AsyncSession) -> str:
    """Always include profile + spending + a compact balance sheet; add page-specific detail."""
    parts = [await _profile_and_spending(user_id, session)]
    parts.append(await _assets_block(user_id, session))
    parts.append(await _liabilities_block(user_id, session))
    parts.append(await _receivables_block(user_id, session))

    if page_context == "networth":
        pass  # assets + liabilities already fully listed above
    elif page_context == "transactions":
        parts.append(await _transactions_block(user_id, session))
    elif page_context == "home":
        parts.append(await _action_queue_block(user_id, session))

    return "\n\n".join(parts)


# ───────────────────────── LLM call + parse ─────────────────────────

def _strip_action_block(text: str) -> str:
    return _ACTION_BLOCK_RE.sub("", text).strip()


def _parse_proposal(text: str) -> dict | None:
    match = _ACTION_BLOCK_RE.search(text)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    action_type = data.get("action_type")
    if action_type not in ASSISTANT_ACTION_TYPES:
        return None
    params = data.get("params")
    if not isinstance(params, dict):
        return None
    return {
        "action_type": action_type,
        "params": params,
        "description": str(data.get("description") or action_type),
    }


async def run_chat(
    user: User,
    message: str,
    page_context: str,
    session_history: list[dict],
    session: AsyncSession,
) -> dict:
    """
    Returns {"reply": str, "proposal": {action_id, action_type, description, params} | None}.
    Persists a proposed AssistantAction when a valid proposal is parsed.
    """
    context = await build_context(user.id, page_context, session)
    lang = getattr(user, "language", None) or "en"

    messages = [
        {"role": "system", "content": f"{_SYSTEM_PROMPT}\n\nUser language: {lang}\n\nUSER FINANCIAL CONTEXT:\n{context}"}
    ]
    for m in session_history[-10:]:
        role = m.get("role")
        content = m.get("content") or m.get("text")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)[:2000]})
    messages.append({"role": "user", "content": message[:2000]})

    provider = get_provider("chat")
    try:
        response = provider.client.chat.completions.create(
            model=provider.model,
            messages=messages,
            temperature=0.4,
        )
        raw = response.choices[0].message.content or ""
    except Exception as exc:
        logger.error("Assistant LLM call failed: %s", exc)
        return {"reply": "I can't respond right now. Please try again shortly.", "proposal": None}

    reply = _strip_action_block(raw) or "Okay."
    parsed = _parse_proposal(raw)
    if not parsed:
        return {"reply": reply, "proposal": None}

    # Persist proposal server-side; client confirms by action_id only.
    action = AssistantAction(
        id=uuid.uuid4(),
        user_id=user.id,
        action_type=parsed["action_type"],
        params_json=json.dumps(parsed["params"]),
        description=parsed["description"],
        status="proposed",
        created_at=datetime.now(timezone.utc),
    )
    session.add(action)
    await session.commit()

    return {
        "reply": reply,
        "proposal": {
            "action_id": str(action.id),
            "action_type": parsed["action_type"],
            "description": parsed["description"],
            "params": parsed["params"],
        },
    }


# ───────────────────────── executors ─────────────────────────

class ActionError(Exception):
    """Raised when an action cannot be executed (bad params, missing entity, etc.)."""


def _to_decimal(value, field: str) -> Decimal:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ActionError(f"Invalid number for {field}")
    if d <= 0:
        raise ActionError(f"{field} must be positive")
    return d


async def _exec_mark_receivable_received(user: User, params: dict, session: AsyncSession) -> str:
    from app.api.networth import _add_financial_event, _find_receivable_asset, bust_networth_insight_cache

    try:
        rid = uuid.UUID(str(params.get("receivable_id")))
    except (ValueError, TypeError):
        raise ActionError("Invalid receivable_id")

    result = await session.execute(
        select(Receivable).where(Receivable.id == rid, Receivable.user_id == user.id)
    )
    receivable = result.scalar_one_or_none()
    if not receivable:
        raise ActionError("Receivable not found")

    existing = await _find_receivable_asset(receivable, session)
    if existing:
        receivable.linked_asset_id = existing.id
    else:
        now = datetime.now(timezone.utc)
        asset = Asset(
            id=uuid.uuid4(),
            user_id=user.id,
            name=f"Receivable: {receivable.from_person}",
            asset_type="cash",
            currency=receivable.currency,
            current_value=receivable.amount,
            source="receivable_collection",
            source_detail=json.dumps({
                "subtype": "receivable_collection",
                "receivable_id": str(receivable.id),
                "from_person": receivable.from_person,
            }),
            as_of_date=date.today(),
            created_at=now,
            updated_at=now,
        )
        session.add(asset)
        await session.flush()
        receivable.linked_asset_id = asset.id
        _add_financial_event(
            session,
            user_id=user.id,
            event_type="receivable_collected",
            entity_type="receivable",
            entity_id=receivable.id,
            amount=receivable.amount,
            currency=receivable.currency,
            source="assistant",
            source_detail={"asset_id": str(asset.id), "from_person": receivable.from_person},
        )
    receivable.status = "received"
    await bust_networth_insight_cache(user.id, session)
    return f"{receivable.from_person} receivable marked received."


async def _exec_dismiss_reconciliation_item(user: User, params: dict, session: AsyncSession) -> str:
    try:
        iid = uuid.UUID(str(params.get("item_id")))
    except (ValueError, TypeError):
        raise ActionError("Invalid item_id")

    result = await session.execute(
        select(ReconciliationItem).where(
            ReconciliationItem.id == iid,
            ReconciliationItem.user_id == user.id,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise ActionError("Reconciliation item not found")
    item.status = "dismissed"
    item.resolved_at = datetime.now(timezone.utc)
    return "Item dismissed."


async def _exec_categorize_transaction(user: User, params: dict, session: AsyncSession) -> str:
    from app.api.corrections import VALID_CATEGORIES
    from app.services.transaction_service import bust_insight_cache, bust_progress_cache
    from app.models.user_correction import UserCorrection

    category = str(params.get("category") or "")
    if category not in VALID_CATEGORIES:
        raise ActionError(f"Invalid category: {category}")
    try:
        tid = uuid.UUID(str(params.get("transaction_id")))
    except (ValueError, TypeError):
        raise ActionError("Invalid transaction_id")

    result = await session.execute(
        select(Transaction).where(Transaction.id == tid, Transaction.user_id == user.id)
    )
    tx = result.scalar_one_or_none()
    if not tx:
        raise ActionError("Transaction not found")

    old = tx.category
    if old != category:
        tx.category = category
        session.add(UserCorrection(
            id=uuid.uuid4(),
            transaction_id=tx.id,
            user_id=user.id,
            old_category=old,
            new_category=category,
            created_at=datetime.now(timezone.utc),
        ))
        await bust_insight_cache(user.id, session)
        await bust_progress_cache(user.id, session)
    return f"Transaction categorized as {category}."


async def _exec_create_asset(user: User, params: dict, session: AsyncSession) -> str:
    from app.api.networth import bust_networth_insight_cache

    name = str(params.get("name") or "").strip()
    if not name:
        raise ActionError("Asset name required")
    asset_type = str(params.get("asset_type") or "")
    if asset_type not in ASSET_TYPES:
        raise ActionError(f"Invalid asset_type: {asset_type}")
    currency = str(params.get("currency") or "").strip().upper()[:10] or "TRY"
    value = _to_decimal(params.get("current_value"), "current_value")

    now = datetime.now(timezone.utc)
    session.add(Asset(
        id=uuid.uuid4(),
        user_id=user.id,
        name=name[:200],
        asset_type=asset_type,
        currency=currency,
        current_value=value,
        source="assistant",
        source_detail=json.dumps({"created_by": "assistant"}),
        as_of_date=date.today(),
        created_at=now,
        updated_at=now,
    ))
    await bust_networth_insight_cache(user.id, session)
    return f"Asset '{name}' created."


async def _exec_add_liability(user: User, params: dict, session: AsyncSession) -> str:
    from app.api.networth import bust_networth_insight_cache

    name = str(params.get("name") or "").strip()
    if not name:
        raise ActionError("Liability name required")
    liability_type = str(params.get("liability_type") or "")
    if liability_type not in LIABILITY_TYPES:
        raise ActionError(f"Invalid liability_type: {liability_type}")
    currency = str(params.get("currency") or "").strip().upper()[:10] or "TRY"
    total = _to_decimal(params.get("total_amount"), "total_amount")
    remaining = _to_decimal(params.get("remaining_amount"), "remaining_amount")

    now = datetime.now(timezone.utc)
    session.add(Liability(
        id=uuid.uuid4(),
        user_id=user.id,
        name=name[:200],
        liability_type=liability_type,
        currency=currency,
        total_amount=total,
        remaining_amount=remaining,
        created_at=now,
    ))
    await bust_networth_insight_cache(user.id, session)
    return f"Liability '{name}' added."


_EXECUTORS = {
    "mark_receivable_received": _exec_mark_receivable_received,
    "dismiss_reconciliation_item": _exec_dismiss_reconciliation_item,
    "categorize_transaction": _exec_categorize_transaction,
    "create_asset": _exec_create_asset,
    "add_liability": _exec_add_liability,
}


async def confirm_action(user: User, action_id: str, session: AsyncSession) -> dict:
    """Execute a previously-proposed action from its stored row. Returns {ok, message}."""
    try:
        aid = uuid.UUID(action_id)
    except (ValueError, TypeError):
        raise ActionError("Invalid action_id")

    result = await session.execute(
        select(AssistantAction).where(
            AssistantAction.id == aid,
            AssistantAction.user_id == user.id,
        )
    )
    action = result.scalar_one_or_none()
    if not action:
        raise ActionError("Action not found")
    if action.status != "proposed":
        raise ActionError(f"Action already {action.status}")

    executor = _EXECUTORS.get(action.action_type)
    if not executor:
        raise ActionError(f"Unknown action_type: {action.action_type}")

    try:
        params = json.loads(action.params_json)
    except json.JSONDecodeError:
        raise ActionError("Corrupt action params")

    message = await executor(user, params, session)
    action.status = "confirmed"
    await session.commit()
    return {"ok": True, "message": message, "action_type": action.action_type}


async def reject_action(user: User, action_id: str, session: AsyncSession) -> dict:
    try:
        aid = uuid.UUID(action_id)
    except (ValueError, TypeError):
        raise ActionError("Invalid action_id")

    result = await session.execute(
        select(AssistantAction).where(
            AssistantAction.id == aid,
            AssistantAction.user_id == user.id,
        )
    )
    action = result.scalar_one_or_none()
    if not action:
        raise ActionError("Action not found")
    if action.status == "proposed":
        action.status = "rejected"
        await session.commit()
    return {"ok": True}
