"""
WHAT: Async SQLAlchemy engine + session factory for PostgreSQL.
WHY: Centralizes all DB connection logic — every service imports `get_session`,
     never creates its own engine. One place to tune pool size, timeouts, echo.
BREAKS IF REMOVED: No DB connectivity; all services that need a session have nowhere to import from.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# WHY: echo=False in all environments — SQL logs expose query structure and can
# leak data shapes into log aggregators. Enable temporarily via env var if needed for debugging.
# pool_pre_ping=True sends a lightweight "SELECT 1" before each connection is used,
# discarding stale connections that Postgres closed after idle timeout.
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# WHY: async_sessionmaker is the 2.0-style factory — returns AsyncSession instances.
# expire_on_commit=False prevents SQLAlchemy from expiring attributes after commit,
# which would trigger lazy-load errors in async context (no implicit IO allowed).
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    WHAT: FastAPI dependency that yields one AsyncSession per request, then closes it.
    WHY: `async with` guarantees the session is closed even if the route handler raises.
         Using yield (not return) lets FastAPI run cleanup after the response is sent.
    BREAKS IF REMOVED: Routes that need DB access have no standard way to get a session;
                       connection pool leaks if sessions are opened without a guaranteed close.
    """
    async with AsyncSessionLocal() as session:
        yield session
