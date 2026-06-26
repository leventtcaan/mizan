"""
WHAT: Paddle (Merchant of Record) integration helpers — webhook signature verification,
      price-id → plan mapping, and the few server-side API calls we need (cancel, fetch).
WHY:  Paddle is our MoR: it handles tax + compliance. We never touch card data. The only
      server responsibilities are (1) trust webhook events by verifying their signature,
      and (2) cancel/read a subscription via Paddle's API. Centralising it here keeps the
      webhook + billing endpoints thin and keeps the HMAC logic in one audited place.
BREAKS IF REMOVED: The billing webhook can't verify events and /billing/cancel can't act.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# API hosts by environment. Sandbox is the test mode; production is live.
_API_HOSTS = {
    "sandbox": "https://sandbox-api.paddle.com",
    "production": "https://api.paddle.com",
}


def api_base() -> str:
    env = (settings.PADDLE_ENVIRONMENT or "sandbox").strip().lower()
    return _API_HOSTS.get(env, _API_HOSTS["sandbox"])


def _parse_sig_header(header: str) -> tuple[str, str] | None:
    """Paddle-Signature looks like 'ts=1700000000;h1=<hex>'. Returns (ts, h1) or None."""
    ts = h1 = None
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == "ts":
            ts = v
        elif k == "h1":
            h1 = v
    if ts and h1:
        return ts, h1
    return None


def verify_signature(raw_body: bytes, signature_header: str | None, secret: str | None) -> bool:
    """
    Verify a Paddle webhook. The signed payload is `f"{ts}:{raw_body}"`, HMAC-SHA256 with
    the destination's webhook secret; the result must equal h1 from the header. Fails
    CLOSED: a missing secret or malformed header returns False (never silently accept).
    """
    if not secret or not signature_header:
        return False
    parsed = _parse_sig_header(signature_header)
    if parsed is None:
        return False
    ts, h1 = parsed
    signed_payload = ts.encode("utf-8") + b":" + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    # constant-time compare to avoid timing leaks
    return hmac.compare_digest(expected, h1)


def plan_for_price(price_id: str | None) -> str | None:
    """Map a Paddle price id (pri_…) back to our plan tier, or None if unknown."""
    if not price_id:
        return None
    plus = {settings.PADDLE_PRICE_PLUS_MONTHLY, settings.PADDLE_PRICE_PLUS_YEARLY}
    pro = {settings.PADDLE_PRICE_PRO_MONTHLY, settings.PADDLE_PRICE_PRO_YEARLY}
    if price_id in pro and price_id:
        return "pro"
    if price_id in plus and price_id:
        return "plus"
    return None


def plan_from_subscription(data: dict) -> str | None:
    """
    Resolve the plan a subscription grants. Prefers explicit custom_data.plan (we set it at
    checkout), falls back to mapping the first item's price id. Returns 'plus'/'pro'/None.
    """
    custom = data.get("custom_data") or {}
    cd_plan = (custom.get("plan") or "").strip().lower() if isinstance(custom, dict) else ""
    if cd_plan in ("plus", "pro"):
        return cd_plan
    for item in data.get("items", []) or []:
        price = (item.get("price") or {}).get("id") or item.get("price_id")
        mapped = plan_for_price(price)
        if mapped:
            return mapped
    return None


def parse_dt(value: str | None) -> datetime | None:
    """Parse a Paddle ISO-8601 timestamp (handles the trailing 'Z') into aware UTC."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def subscription_period_end(data: dict) -> datetime | None:
    """The moment the current paid period ends / next bills — used for plan_expires_at."""
    end = parse_dt(data.get("next_billed_at"))
    if end is not None:
        return end
    period = data.get("current_billing_period") or {}
    return parse_dt(period.get("ends_at"))


async def cancel_subscription(subscription_id: str) -> dict | None:
    """
    Cancel a Paddle subscription at the end of the current billing period (the user keeps
    access until then). Returns the API response dict, or None if not configured / on error.
    The actual plan downgrade is applied later by the subscription.canceled webhook.
    """
    if not settings.PADDLE_API_KEY or not subscription_id:
        return None
    url = f"{api_base()}/subscriptions/{subscription_id}/cancel"
    headers = {
        "Authorization": f"Bearer {settings.PADDLE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, headers=headers, json={"effective_from": "next_billing_period"})
            if resp.status_code >= 400:
                logger.warning("Paddle cancel failed (%s): %s", resp.status_code, resp.text[:300])
                return None
            return resp.json()
    except Exception as exc:
        logger.warning("Paddle cancel request error: %s", exc)
        return None


async def get_subscription(subscription_id: str) -> dict | None:
    """Fetch a subscription's live state from Paddle (best-effort; None if unavailable)."""
    if not settings.PADDLE_API_KEY or not subscription_id:
        return None
    url = f"{api_base()}/subscriptions/{subscription_id}"
    headers = {"Authorization": f"Bearer {settings.PADDLE_API_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return None
            return resp.json().get("data")
    except Exception as exc:
        logger.warning("Paddle get_subscription error: %s", exc)
        return None
