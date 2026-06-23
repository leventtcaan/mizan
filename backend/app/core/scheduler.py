"""
Background scheduler — makes reconciliation + daily notifications proactive.

WHY: Without this, the Action Center only updates when a user opens a page and
the frontend calls scanReconciliation()/generateDailyNotifications(). A user who
hasn't logged in for a week sees nothing. These jobs run server-side so "the app
worked while you were away" is actually true.

MVP note: APScheduler runs in-process (one AsyncIOScheduler in the FastAPI event
loop). No Redis needed. For multi-process/multi-replica prod, move to a job queue
or a single dedicated worker so jobs don't run N times.
"""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.notification_service import generate_for_user
from app.services.reconciliation_producers import run_reconciliation_producers

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

# Last-run bookkeeping for the dev status endpoint.
LAST_RUN: dict[str, str | None] = {
    "reconciliation": None,
    "daily_notifications": None,
    "price_refresh": None,
    "email_briefs": None,
}

JOB_RECONCILIATION = "reconciliation_all_users"
JOB_NOTIFICATIONS = "daily_notifications_all_users"
JOB_PRICE_REFRESH = "price_refresh_all_users"
JOB_EMAIL_BRIEFS = "email_briefs_all_users"


async def _all_user_ids() -> list:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User.id))
        return [row[0] for row in result.all()]


async def run_reconciliation_for_all_users() -> None:
    """Scan reconciliation producers for every user. Per-user failures are isolated."""
    user_ids = await _all_user_ids()
    total_created = 0
    for uid in user_ids:
        try:
            async with AsyncSessionLocal() as session:
                created = await run_reconciliation_producers(uid, session)
                await session.commit()
                total_created += created
        except Exception:
            logger.exception("Reconciliation scan failed for user=%s", uid)
            continue
    LAST_RUN["reconciliation"] = datetime.now(timezone.utc).isoformat()
    logger.info("Reconciliation scan: %d users, %d items created", len(user_ids), total_created)


async def run_price_refresh_for_all_users() -> None:
    """Refresh live asset prices for every user, then snapshot their net worth.

    This keeps the Home heartbeat current without any user action, and the fresh
    snapshot (with per-entity breakdown) is what powers change attribution.
    Per-user failures are isolated.
    """
    from app.services.asset_prices import fetch_all_for_user
    from app.services.networth_snapshot_service import upsert_snapshot

    user_ids = await _all_user_ids()
    total_updated = 0
    for uid in user_ids:
        try:
            async with AsyncSessionLocal() as session:
                result = await fetch_all_for_user(uid, session)
                total_updated += int(result.get("updated", 0))
                # Snapshot afterwards so attribution has fresh, breakdown-bearing data.
                await upsert_snapshot(uid, session)
        except Exception:
            logger.exception("Price refresh failed for user=%s", uid)
            continue
    LAST_RUN["price_refresh"] = datetime.now(timezone.utc).isoformat()
    logger.info("Price refresh: %d users, %d assets updated", len(user_ids), total_updated)


async def run_daily_notifications_for_all_users() -> None:
    """Generate daily notifications for every user. Per-user failures are isolated.

    generate_for_user already skips users that were generated today (UTC), so this
    is idempotent against page-load triggers that may have run first.
    """
    user_ids = await _all_user_ids()
    total_created = 0
    for uid in user_ids:
        try:
            async with AsyncSessionLocal() as session:
                # Default lang follows the user's preference when available.
                lang = "en"
                user = await session.get(User, uid)
                if user is not None:
                    lang = getattr(user, "language", None) or "en"
                result = await generate_for_user(uid, lang, session)
                total_created += int(result.get("created", 0))
        except Exception:
            logger.exception("Daily notification generation failed for user=%s", uid)
            continue
    LAST_RUN["daily_notifications"] = datetime.now(timezone.utc).isoformat()
    logger.info("Daily notifications: %d users, %d notifications created", len(user_ids), total_created)


async def run_email_briefs_for_all_users() -> None:
    """Send the weekly money-brief email to every due, opted-in user.

    Cadence (last_email_brief_sent + 6d) and the meaningful-change gate are enforced
    per user, so a re-run won't double-send and quiet weeks are skipped. Per-user
    failures are isolated, each in its own session.
    """
    from datetime import datetime as _dt
    from app.api.email import send_email_brief
    from app.services.email_brief import generate_email_brief, due_for_brief

    user_ids = await _all_user_ids()
    sent = 0
    for uid in user_ids:
        try:
            async with AsyncSessionLocal() as session:
                user = await session.get(User, uid)
                if user is None or not due_for_brief(user):
                    continue
                brief = await generate_email_brief(uid, session)
                if brief is None:
                    continue
                await send_email_brief(user.email, brief, brief["lang"])
                user.last_email_brief_sent = _dt.now(timezone.utc)
                session.add(user)
                await session.commit()
                sent += 1
        except Exception:
            logger.exception("Email brief failed for user=%s", uid)
            continue
    LAST_RUN["email_briefs"] = datetime.now(timezone.utc).isoformat()
    logger.info("Email briefs: %d users scanned, %d sent", len(user_ids), sent)


def start_scheduler() -> None:
    """Register jobs and start. Safe to call once on app startup."""
    if scheduler.running:
        return
    scheduler.add_job(
        run_reconciliation_for_all_users,
        trigger=IntervalTrigger(hours=6),
        id=JOB_RECONCILIATION,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        run_daily_notifications_for_all_users,
        trigger=CronTrigger(hour=9, minute=0),  # 09:00 UTC daily
        id=JOB_NOTIFICATIONS,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        run_price_refresh_for_all_users,
        trigger=IntervalTrigger(hours=12),  # twice daily — keeps the heartbeat fresh
        id=JOB_PRICE_REFRESH,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        run_email_briefs_for_all_users,
        trigger=CronTrigger(day_of_week="sun", hour=9, minute=0),  # Sunday 09:00 UTC
        id=JOB_EMAIL_BRIEFS,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Scheduler started — reconciliation 6h, notifications 09:00 UTC, price refresh 12h, email briefs Sun 09:00 UTC.")


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down.")


def scheduler_status() -> dict:
    """Snapshot for the dev status endpoint."""
    jobs = {}
    for job_id in (JOB_RECONCILIATION, JOB_NOTIFICATIONS, JOB_PRICE_REFRESH, JOB_EMAIL_BRIEFS):
        job = scheduler.get_job(job_id)
        jobs[job_id] = {
            "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        }
    return {
        "running": scheduler.running,
        "jobs": jobs,
        "last_run": dict(LAST_RUN),
    }
