"""
WHAT: FastAPI application entry point — creates the app, wires middleware, registers routes.
WHY: Uvicorn targets this file (`app.main:app`); everything that must run at startup lives here.
BREAKS IF REMOVED: No web server, no routes, nothing to run.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.cashflow import router as cashflow_router
from app.api.currency import router as currency_router
from app.api.networth import router as networth_router
from app.api.installments import router as installments_router
from app.api.subscriptions import router as subscriptions_router
from app.api.email import router as email_router
from app.api.inflation import router as inflation_router
from app.api.chat import router as chat_router
from app.api.corrections import router as corrections_router
from app.api.goals import router as goals_router
from app.api.insights import router as insights_router
from app.api.notes import router as notes_router
from app.api.patterns import router as patterns_router
from app.api.personality import router as personality_router
from app.api.progress import router as progress_router
from app.api.reconciliation import router as reconciliation_router
from app.api.transactions import router as transactions_router
from app.api.upload import router as upload_router
from app.api.wealth_alerts import router as wealth_alerts_router
from app.api.notifications import router as notifications_router
from app.api.assistant import router as assistant_router
from app.core.config import settings
from app.core.database import engine
from app.models.user import Base
from app.models.transaction import Transaction  # noqa: F401 — registers table in metadata
from app.models.transaction_note import TransactionNote  # noqa: F401 — registers table in metadata
from app.models.upload_insight import UploadInsight  # noqa: F401 — registers table in metadata
from app.models.user_correction import UserCorrection  # noqa: F401 — registers table in metadata
from app.models.behavioral_profile import BehavioralProfile  # noqa: F401 — registers table in metadata
from app.models.budget_goal import BudgetGoal  # noqa: F401 — registers table in metadata
from app.models.conversation import ConversationMessage  # noqa: F401 — registers table in metadata
from app.models.progress_insight import ProgressInsight  # noqa: F401 — registers table in metadata
from app.models.dismissed_alert import DismissedAlert  # noqa: F401 — registers table in metadata
from app.models.subscription_flag import SubscriptionFlag  # noqa: F401 — registers table in metadata
from app.models.asset import Asset  # noqa: F401 — registers table in metadata
from app.models.liability import Liability  # noqa: F401 — registers table in metadata
from app.models.receivable import Receivable  # noqa: F401 — registers table in metadata
from app.models.networth_suggestion import NetworthSuggestion  # noqa: F401 — registers table in metadata
from app.models.financial_event import FinancialEvent  # noqa: F401 — registers table in metadata
from app.models.reconciliation_item import ReconciliationItem  # noqa: F401 — registers table in metadata
from app.models.networth_snapshot import NetworthSnapshot  # noqa: F401 — registers table in metadata
from app.models.wealth_alert import WealthAlert  # noqa: F401 — registers table in metadata
from app.models.app_notification import AppNotification  # noqa: F401 — registers table in metadata
from app.models.assistant_action import AssistantAction  # noqa: F401 — registers table in metadata

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    WHAT: Modern FastAPI lifespan handler — replaces deprecated @app.on_event("startup").
    WHY: Validates required env vars once at boot; fails loudly before serving any traffic.
    BREAKS IF REMOVED: Misconfigured instances (missing DB URL) only fail at the first query.
    """
    logger.info("Mizan backend starting — environment: %s", settings.ENVIRONMENT)
    settings.log_api_key_status()

    if not len(settings.DATABASE_URL) > 0:
        raise RuntimeError("DATABASE_URL env var is required but not set")

    # WHY: create_all in dev only — Alembic owns schema in staging/prod.
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Dev: tables created (or already exist).")

    # Start background scheduler (reconciliation + daily notifications).
    # Imported here (after module load) to keep the import graph acyclic.
    from app.core.scheduler import start_scheduler, shutdown_scheduler
    start_scheduler()

    logger.info("Startup validation passed.")
    yield
    shutdown_scheduler()
    logger.info("Mizan backend shutting down.")


app = FastAPI(
    title="Mizan Backend",
    version="0.1.0",
    description="Global personal finance and net worth operating system API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(upload_router)
app.include_router(transactions_router)
app.include_router(notes_router)
app.include_router(corrections_router)
app.include_router(insights_router)
app.include_router(progress_router)
app.include_router(goals_router)
app.include_router(chat_router)
app.include_router(personality_router)
app.include_router(patterns_router)
app.include_router(email_router)
app.include_router(inflation_router)
app.include_router(subscriptions_router)
app.include_router(installments_router)
app.include_router(currency_router)
app.include_router(networth_router)
app.include_router(reconciliation_router)
app.include_router(cashflow_router)
app.include_router(wealth_alerts_router)
app.include_router(notifications_router)
app.include_router(assistant_router)


@app.get("/health")
async def health() -> dict:
    """
    WHAT: Liveness probe endpoint for Docker health checks and frontend connectivity test.
    WHY: Docker Compose `depends_on: condition: service_healthy` requires this to return 200.
    BREAKS IF REMOVED: Frontend can't confirm backend is up; Docker services start in wrong order.
    """
    return {"status": "ok", "service": "mizan-backend", "version": "0.1.0"}


@app.get("/admin/scheduler/status")
async def scheduler_status_endpoint() -> dict:
    """
    WHAT: Dev-only visibility into the background scheduler.
    WHY: Verify jobs are registered and running inside Docker (next_run + last_run).
    NOTE: No auth — development convenience only. Gate or remove before prod.
    """
    from app.core.scheduler import scheduler_status
    return scheduler_status()
