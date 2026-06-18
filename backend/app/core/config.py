"""
WHAT: Reads environment variables and exposes them as typed Python attributes via Pydantic.
WHY: Single source of truth for config — every module imports `settings`, never os.environ directly.
BREAKS IF REMOVED: Database URL, API keys, and environment flags become scattered and unvalidated.
"""

import logging
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    WHAT: Pydantic model that reads .env / environment variables on instantiation.
    WHY: Pydantic validates types at startup — typos in DATABASE_URL crash fast, not at query time.
    BREAKS IF REMOVED: No type safety, no default values, no central config contract.
    """

    DATABASE_URL: str = "postgresql+asyncpg://mizan:password@postgres:5432/mizan"
    DEEPSEEK_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ENVIRONMENT: str = "development"

    # WHY: Frontend URL is needed by CORS middleware to allow only our own origin.
    FRONTEND_URL: str = "http://localhost:3000"

    # WHY: "env_file" lets .env override Docker env vars during local dev without Docker.
    # case_sensitive=True prevents DATABASE_URL from matching database_url in .env.
    model_config = {"env_file": ".env", "case_sensitive": True, "extra": "ignore"}

    def log_api_key_status(self) -> None:
        """
        WHAT: Logs whether each API key is configured, without revealing the key value.
        WHY: Security rule — len() check reveals presence, never the secret itself.
        BREAKS IF REMOVED: Operators can't diagnose missing keys without accessing secrets.
        """
        # WHY: len() check only — NEVER log, print, or compare the key value itself.
        # ALTERNATIVE: Log first N chars. TRADEOFF: Leaks partial secret into log files.
        logger.info("DEEPSEEK_API_KEY: %s", "set" if len(self.DEEPSEEK_API_KEY) > 0 else "not set")
        logger.info("OPENAI_API_KEY: %s", "set" if len(self.OPENAI_API_KEY) > 0 else "not set")


# WHY: Module-level singleton — imported once, reused everywhere.
# ALTERNATIVE: Dependency injection via FastAPI Depends(). TRADEOFF: More boilerplate for same result.
settings = Settings()
