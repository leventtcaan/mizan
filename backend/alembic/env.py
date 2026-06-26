"""
WHAT: Alembic environment — wires SQLAlchemy metadata and async engine for migrations.
WHY: Alembic needs to know which models exist (via Base.metadata) and how to connect
     to the database (via our settings). Without this, autogenerate produces empty migrations.
BREAKS IF REMOVED: `alembic revision --autogenerate` finds no tables; migrations can't run.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

# WHY: Import every model so its table is registered in Base.metadata.
# Alembic autogenerate compares Base.metadata against the live DB schema.
# Any model NOT imported here is invisible to autogenerate — keep this list complete.
from app.models.user import Base, User  # noqa: F401
from app.models.account import Account  # noqa: F401
from app.models.admin_audit_log import AdminAuditLog  # noqa: F401
from app.models.app_notification import AppNotification  # noqa: F401
from app.models.asset import Asset  # noqa: F401
from app.models.assistant_action import AssistantAction  # noqa: F401
from app.models.behavioral_profile import BehavioralProfile  # noqa: F401
from app.models.budget_goal import BudgetGoal  # noqa: F401
from app.models.conversation import ConversationMessage  # noqa: F401
from app.models.dismissed_alert import DismissedAlert  # noqa: F401
from app.models.financial_event import FinancialEvent  # noqa: F401
from app.models.liability import Liability  # noqa: F401
from app.models.networth_snapshot import NetworthSnapshot  # noqa: F401
from app.models.networth_suggestion import NetworthSuggestion  # noqa: F401
from app.models.progress_insight import ProgressInsight  # noqa: F401
from app.models.receivable import Receivable  # noqa: F401
from app.models.reconciliation_item import ReconciliationItem  # noqa: F401
from app.models.subscription_flag import SubscriptionFlag  # noqa: F401
from app.models.transaction import Transaction  # noqa: F401
from app.models.transaction_note import TransactionNote  # noqa: F401
from app.models.upload_insight import UploadInsight  # noqa: F401
from app.models.user_correction import UserCorrection  # noqa: F401
from app.models.wealth_alert import WealthAlert  # noqa: F401

config = context.config

# WHY: fileConfig wires Alembic's own logging (migration progress, SQL echo).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# WHY: target_metadata tells autogenerate what the schema SHOULD look like.
# Alembic diffs this against the live DB to generate upgrade/downgrade steps.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    WHAT: Generates migration SQL without a live DB connection.
    WHY: Used in CI or staging environments where DB access is restricted —
         outputs raw SQL that a DBA can review and apply manually.
    """
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """
    WHAT: Runs migrations against a live DB using the async engine from settings.
    WHY: asyncpg requires an async engine — the default sync Alembic runner can't
         use it directly. We run the sync migration logic inside run_sync().
    BREAKS IF REMOVED: `alembic upgrade head` fails with async driver incompatibility.
    """
    connectable = create_async_engine(settings.DATABASE_URL)

    async with connectable.connect() as connection:
        # WHY: run_sync() bridges Alembic's synchronous migration API into async context.
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
