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
    # Also the base for email verification links (FRONTEND_URL/verify?token=...).
    FRONTEND_URL: str = "http://localhost:3000"

    # WHY: Redis backs the rate limiter so limits survive restarts and are shared across
    # multiple backend instances (in-memory limits reset per-process). Empty/unreachable
    # → the limiter falls back to in-memory (single-process dev still works).
    REDIS_URL: str = "redis://redis:6379/0"

    # WHY: Resend API key for outbound email. Empty disables email sending (dev default).
    RESEND_API_KEY: str = ""

    # WHY: From-address for outbound email. Default is Resend's shared sandbox sender
    # (works without domain verification); prod must set a verified domain sender.
    RESEND_FROM_EMAIL: str = "Clarifin <onboarding@resend.dev>"
    # Where user-feedback notifications land (founder inbox).
    FEEDBACK_NOTIFY_EMAIL: str = "ceylanleventcan@gmail.com"

    # WHY: SECRET_KEY signs JWTs — must be random and long (32+ bytes of entropy).
    # No default: a missing SECRET_KEY raises a Pydantic ValidationError when Settings()
    # is instantiated at import, so the app fails fast instead of signing tokens with a
    # publicly-known key. Generate one with `openssl rand -hex 32`.
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # ── Paddle (payments — Merchant of Record; handles tax + compliance) ──────────
    # PADDLE_ENVIRONMENT selects the API host: "sandbox" (test) or "production".
    PADDLE_ENVIRONMENT: str = "sandbox"
    # Secret that signs incoming webhooks (Paddle dashboard → Notifications). Used to
    # verify the Paddle-Signature header. Empty in dev → the webhook rejects everything
    # (fail closed) so a misconfigured prod can't silently accept forged events.
    PADDLE_WEBHOOK_SECRET: str = ""
    # Server-side API key (Paddle dashboard → Authentication). Needed to cancel a
    # subscription via the Paddle API. Empty disables the cancel call.
    PADDLE_API_KEY: str = ""
    # Price IDs (pri_…) — map an incoming subscription's price back to our plan tier
    # as a fallback when checkout custom_data is absent. Set the ones you've created.
    PADDLE_PRICE_PLUS_MONTHLY: str = ""
    PADDLE_PRICE_PLUS_YEARLY: str = ""
    PADDLE_PRICE_PRO_MONTHLY: str = ""
    PADDLE_PRICE_PRO_YEARLY: str = ""

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
        logger.info("RESEND_API_KEY: %s", "set" if len(self.RESEND_API_KEY) > 0 else "not set")


# WHY: Module-level singleton — imported once, reused everywhere.
# ALTERNATIVE: Dependency injection via FastAPI Depends(). TRADEOFF: More boilerplate for same result.
settings = Settings()
