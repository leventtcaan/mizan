"""
WHAT: Provider abstraction for LLM backends — DeepSeek V3 (primary) and GPT-4o-mini (fallback).
WHY: Decouples business logic from specific LLM vendors; swapping providers = change one function.
BREAKS IF REMOVED: Every LLM call site is coupled to a specific provider, vendor lock-in guaranteed.
"""

from abc import ABC, abstractmethod

from openai import OpenAI

from app.core.config import settings


class LLMProvider(ABC):
    """
    WHAT: Abstract base class defining the contract all LLM providers must fulfill.
    WHY: Python's ABC enforces method implementation at class definition time, not at call time.
    BREAKS IF REMOVED: No contract — providers could silently omit methods; bugs surface at runtime.
    """

    @abstractmethod
    def complete(self, prompt: str) -> str:
        """
        WHAT: Send a free-form prompt, return the model's text response.
        WHY: General-purpose completion for coaching messages and summaries.
        BREAKS IF REMOVED: Cannot generate behavioral coaching text in Phase 2+.
        """

    @abstractmethod
    def categorize(self, transaction: dict) -> str:
        """
        WHAT: Classify a single transaction dict into a spending category string.
        WHY: Separated from complete() so we can prompt-engineer categorization independently.
        BREAKS IF REMOVED: Transaction categorization has no LLM entry point in Phase 1+.
        """


class DeepSeekProvider(LLMProvider):
    """
    WHAT: LLM provider backed by DeepSeek V3 via the OpenAI-compatible REST API.
    WHY: DeepSeek costs ~10x less than GPT-4o for high-volume categorization of transactions.
    BREAKS IF REMOVED: No primary LLM — every user falls back to the more expensive OpenAI.
    """

    def __init__(self) -> None:
        # WHY: DeepSeek exposes an OpenAI-compatible API, so we reuse the same SDK.
        # ALTERNATIVE: Use httpx directly. TRADEOFF: Lose retry logic and streaming helpers.
        self.client = OpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com",
        )
        self.model = "deepseek-chat"

    def complete(self, prompt: str) -> str:
        """
        WHAT: Sends a user prompt with the categorization system prompt, returns response text.
        WHY: system prompt is set at the provider level so categorizer.py stays model-agnostic.
        BREAKS IF REMOVED: categorize_batch() has no LLM entry point.
        """
        from app.services.categorizer import _SYSTEM_PROMPT  # local import avoids circular
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,  # WHY: Low temperature = deterministic categories, less hallucination
        )
        return response.choices[0].message.content or ""

    def categorize(self, transaction: dict) -> str:
        """Single-transaction wrapper — delegates to complete() for consistency."""
        return self.complete(str(transaction))


class OpenAIProvider(LLMProvider):
    """
    WHAT: LLM provider backed by GPT-4o-mini as fallback when DeepSeek key is absent.
    WHY: Guarantees the app works during development even without a DeepSeek subscription.
    BREAKS IF REMOVED: App is unusable for developers who haven't signed up for DeepSeek.
    """

    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)
        self.model = "gpt-4o-mini"

    def complete(self, prompt: str) -> str:
        """
        WHAT: Sends prompt to GPT-4o-mini with the categorization system prompt.
        WHY: Same interface as DeepSeekProvider — callers are unaware which model runs.
        BREAKS IF REMOVED: categorize_batch() has no fallback LLM entry point.
        """
        from app.services.categorizer import _SYSTEM_PROMPT  # local import avoids circular
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        return response.choices[0].message.content or ""

    def categorize(self, transaction: dict) -> str:
        """Single-transaction wrapper — delegates to complete() for consistency."""
        return self.complete(str(transaction))


def get_provider(task_type: str) -> LLMProvider:
    """
    WHAT: Factory — returns the correct LLMProvider based on which API key is present.
    WHY: All provider selection logic lives here; callers never inspect env vars themselves.
    BREAKS IF REMOVED: Every service would duplicate key-presence logic and make inconsistent choices.

    Args:
        task_type: Reserved for Phase 2 — will route cheap tasks to DeepSeek, complex to GPT-4.
    """
    # WHY: len() check only — never compare the value or log it (security rule).
    # ALTERNATIVE: Always use DeepSeek. TRADEOFF: Breaks onboarding for devs without DeepSeek key.
    if len(settings.DEEPSEEK_API_KEY) > 0:
        return DeepSeekProvider()
    return OpenAIProvider()
