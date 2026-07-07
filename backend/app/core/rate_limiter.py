"""
WHAT: Rate limiter — Redis-backed sliding window, with an in-memory fallback.
WHY:  Redis lets limits survive a backend restart and be shared across multiple
      instances (in-memory counters reset per-process and don't coordinate). When
      REDIS_URL is unset/unreachable we degrade gracefully to the per-process
      in-memory window so single-process dev still throttles.
BREAKS IF REMOVED: No throttling — a single user/IP could trigger unbounded LLM
      calls or upload work.

Public surface is unchanged: each module-level singleton exposes
`is_allowed(key, max_calls, window_seconds)` and `remaining(...)`, called
synchronously from async endpoints (one or two Redis ops per check — sub-ms).
"""

import logging
import time
import uuid
from collections import defaultdict
from threading import Lock

from app.core.config import settings

logger = logging.getLogger(__name__)


class RateLimiter:
    """In-memory sliding-window counter keyed by an arbitrary string. Fallback path."""

    def __init__(self) -> None:
        self._calls: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, key: str, max_calls: int, window_seconds: int) -> bool:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = self._calls[key]
            self._calls[key] = [t for t in timestamps if t > cutoff]
            if len(self._calls[key]) >= max_calls:
                return False
            self._calls[key].append(now)
            return True

    def remaining(self, key: str, max_calls: int, window_seconds: int) -> int:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            active = sum(1 for t in self._calls[key] if t > cutoff)
        return max(0, max_calls - active)


# ── Shared Redis client (lazy, single connection pool for all limiters) ──────────
_redis_client = None
_redis_ready = False
_redis_checked = False


def _get_redis():
    """Connect once; cache the client. Returns None if Redis is unavailable so the
    caller falls back to in-memory. A failed ping disables Redis for the process."""
    global _redis_client, _redis_ready, _redis_checked
    if _redis_checked:
        return _redis_client if _redis_ready else None
    _redis_checked = True
    url = (settings.REDIS_URL or "").strip()
    if not url:
        logger.info("REDIS_URL not set — rate limiter using in-memory fallback.")
        return None
    try:
        import redis  # local import so the package is optional in dev without Redis
        client = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        _redis_client = client
        _redis_ready = True
        logger.info("Rate limiter using Redis at %s", url.split("@")[-1])
        return client
    except Exception as exc:  # connection refused, bad URL, package missing
        logger.warning("Redis unavailable (%s) — rate limiter falling back to in-memory.", exc)
        return None


class RedisRateLimiter:
    """
    Redis sliding-window limiter. One sorted set per (prefix, key); members are
    unique timestamps. On every check we trim entries older than the window, count
    what remains, and (if allowed) add the current call. Falls back to a private
    in-memory limiter if any Redis op raises, so a mid-flight Redis outage never
    turns into a 500.
    """

    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._fallback = RateLimiter()

    def _zkey(self, key: str) -> str:
        return f"rl:{self._prefix}:{key}"

    def is_allowed(self, key: str, max_calls: int, window_seconds: int) -> bool:
        client = _get_redis()
        if client is None:
            return self._fallback.is_allowed(key, max_calls, window_seconds)
        now = time.time()
        zkey = self._zkey(key)
        member = f"{now:.6f}:{uuid.uuid4().hex}"
        try:
            pipe = client.pipeline()
            pipe.zremrangebyscore(zkey, 0, now - window_seconds)
            pipe.zcard(zkey)
            pipe.zadd(zkey, {member: now})
            pipe.expire(zkey, window_seconds + 1)
            results = pipe.execute()
            count_before_add = int(results[1])
            if count_before_add >= max_calls:
                # We optimistically added our entry; remove it so a denied call
                # doesn't permanently occupy a slot in the window.
                client.zrem(zkey, member)
                return False
            return True
        except Exception as exc:
            logger.warning("Redis rate-limit check failed (%s) — using in-memory fallback.", exc)
            return self._fallback.is_allowed(key, max_calls, window_seconds)

    def remaining(self, key: str, max_calls: int, window_seconds: int) -> int:
        client = _get_redis()
        if client is None:
            return self._fallback.remaining(key, max_calls, window_seconds)
        now = time.time()
        zkey = self._zkey(key)
        try:
            pipe = client.pipeline()
            pipe.zremrangebyscore(zkey, 0, now - window_seconds)
            pipe.zcard(zkey)
            active = int(pipe.execute()[1])
            return max(0, max_calls - active)
        except Exception:
            return self._fallback.remaining(key, max_calls, window_seconds)


def _make_limiter(prefix: str):
    """A Redis-backed limiter (shared client, namespaced by prefix). The instance
    transparently falls back to in-memory when Redis is down, so callers don't care."""
    return RedisRateLimiter(prefix)


# WHY: Module-level singletons — one limiter per concern so windows are independent.
# Each namespaces its Redis keys by prefix.
insight_limiter = _make_limiter("insight")       # max 10 /insights per user per hour
upload_user_limiter = _make_limiter("upload_user")  # max 3 uploads per user per 10 minutes
upload_ip_limiter = _make_limiter("upload_ip")    # max 3 uploads per IP per 10 minutes
# WHY: Each correction busts the insight cache and can trigger an LLM regeneration.
correction_limiter = _make_limiter("correction")  # max 20 corrections per user per hour
# WHY: Free-tier AI assistant cap — 10 messages per rolling 24h per user.
assistant_limiter = _make_limiter("assistant")
# WHY: Throttle verification-email resends so the endpoint can't be used to spam an
# inbox or hammer the email provider — max 3 per hour per email address.
resend_verification_limiter = _make_limiter("resend_verification")
# WHY: Same protection for password-reset requests — max 3 per hour per email address.
password_reset_limiter = _make_limiter("password_reset")
# WHY: Feedback is open to any signed-in user — throttle to 5/hour so it can't be spammed.
feedback_limiter = _make_limiter("feedback")
