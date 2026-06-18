"""
WHAT: Simple in-memory rate limiter using a sliding window per key.
WHY: MVP needs protection against LLM abuse and storage bloat without adding Redis.
     In-memory is fine for a single-process backend; keys are per-user or per-IP.
BREAKS IF REMOVED: No throttling — a single user could trigger unbounded LLM calls.
"""

import time
from collections import defaultdict
from threading import Lock


class RateLimiter:
    """
    WHAT: Sliding-window counter keyed by an arbitrary string (user_id, IP, etc.).
    WHY: Sliding window is fairer than fixed-window — a burst at the window boundary
         doesn't allow 2x the limit. Implementation is O(n) per check where n is
         the call count in the window, which is small by design (≤10 calls).
    """

    def __init__(self) -> None:
        # key → list of call timestamps (float, seconds since epoch)
        self._calls: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, key: str, max_calls: int, window_seconds: int) -> bool:
        """
        WHAT: Returns True if the caller is within limits, False if throttled.
        WHY: Mutates the call log on every check — expire old entries eagerly to
             prevent unbounded list growth for long-running processes.
        """
        now = time.time()
        cutoff = now - window_seconds

        with self._lock:
            timestamps = self._calls[key]
            # Discard timestamps outside the window
            self._calls[key] = [t for t in timestamps if t > cutoff]

            if len(self._calls[key]) >= max_calls:
                return False

            self._calls[key].append(now)
            return True

    def remaining(self, key: str, max_calls: int, window_seconds: int) -> int:
        """Returns how many calls are left in the current window (for headers/logging)."""
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            active = sum(1 for t in self._calls[key] if t > cutoff)
        return max(0, max_calls - active)


# WHY: Module-level singletons — one limiter per concern so windows are independent.
insight_limiter = RateLimiter()   # max 10 /insights per user per hour
upload_user_limiter = RateLimiter()   # max 5 uploads per user per day
upload_ip_limiter = RateLimiter()     # max 3 uploads per IP per 10 minutes
