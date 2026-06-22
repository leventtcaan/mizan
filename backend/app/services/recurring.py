"""
Unified recurring-commitments engine.

Single source of truth for "money you're committed to each month." Scans the
transaction history once, then classifies each recurring merchant into exactly
ONE bucket so nothing is double-counted across the old subscriptions/installments
detectors:

  - installment  → finite, debt-like (explicit "X/Y" markers or a tight ±2% monthly
                   series). Has a remaining count + real (opportunity) cost.
  - subscription → ongoing, cancellable small recurring charge.

Installments win ties (a phone-on-installments is a commitment, not a subscription).
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.installment import detect_installments
from app.services.subscription_detect import detect_subscriptions
from app.services.transaction_service import get_transactions_for_user

logger = logging.getLogger(__name__)


async def analyze_recurring(user_id, session: AsyncSession) -> tuple[list[dict], list[dict]]:
    """Returns (subscriptions, installments) with no overlap between the two."""
    transactions = await get_transactions_for_user(user_id, session, all_batches=True)

    installments = detect_installments(transactions)
    installment_keys = {p["merchant_key"] for p in installments}

    subscriptions = [
        s for s in detect_subscriptions(transactions)
        if s["merchant_key"] not in installment_keys
    ]

    logger.info(
        "Recurring analysis — user=%s subs=%d installments=%d",
        user_id, len(subscriptions), len(installments),
    )
    return subscriptions, installments
