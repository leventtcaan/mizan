"""
WHAT: FastAPI application entry point — creates the app, wires middleware, registers routes.
WHY: Uvicorn targets this file (`app.main:app`); everything that must run at startup lives here.
BREAKS IF REMOVED: No web server, no routes, nothing to run.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.upload import router as upload_router
from app.core.config import settings
from app.core.database import engine
from app.models.user import Base
from app.models.transaction import Transaction  # noqa: F401 — registers table in metadata

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

    # WHY: len() check validates presence without touching the value.
    # A missing DATABASE_URL would produce a confusing SQLAlchemy error later — fail fast instead.
    if not len(settings.DATABASE_URL) > 0:
        raise RuntimeError("DATABASE_URL env var is required but not set")

    # WHY: create_all in dev only — Alembic owns schema in staging/prod.
    # This lets `docker compose up` work without running `alembic upgrade head` manually.
    # ALTERNATIVE: Always use Alembic. TRADEOFF: Requires extra step in dev setup.
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Dev: tables created (or already exist).")

    logger.info("Startup validation passed.")
    yield
    logger.info("Mizan backend shutting down.")


app = FastAPI(
    title="Mizan Backend",
    version="0.1.0",
    description="Turkish personal finance behavioral coaching API",
    lifespan=lifespan,
)

# WHY: CORS must be added before any route registration so it intercepts all preflight requests.
# ALTERNATIVE: Allow all origins ("*"). TRADEOFF: Exposes API to any web page — security risk.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(upload_router)


@app.get("/health")
async def health() -> dict:
    """
    WHAT: Liveness probe endpoint for Docker health checks and frontend connectivity test.
    WHY: Docker Compose `depends_on: condition: service_healthy` requires this to return 200.
    BREAKS IF REMOVED: Frontend can't confirm backend is up; Docker services start in wrong order.
    """
    return {"status": "ok", "service": "mizan-backend", "version": "0.1.0"}
