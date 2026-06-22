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
}

JOB_RECONCILIATION = "reconciliation_all_users"
JOB_NOTIFICATIONS = "daily_notifications_all_users"


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
    scheduler.start()
    logger.info("Scheduler started — reconciliation every 6h, daily notifications at 09:00 UTC.")


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler shut down.")


def scheduler_status() -> dict:
    """Snapshot for the dev status endpoint."""
    jobs = {}
    for job_id in (JOB_RECONCILIATION, JOB_NOTIFICATIONS):
        job = scheduler.get_job(job_id)
        jobs[job_id] = {
            "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        }
    return {
        "running": scheduler.running,
        "jobs": jobs,
        "last_run": dict(LAST_RUN),
    }
