"""Single source of truth for transaction category slugs.

Imported by the categorizer (LLM output validation), the transactions API
(manual entry + correction validation) and the upload review endpoint. Keep
this list and the categorizer prompt's slug list in sync — nowhere else should
redeclare the set.

Slugs are stable legacy values (Turkish-derived) — labels are localized on the
frontend. Do NOT rename without a data migration plan.
"""

VALID_CATEGORIES: frozenset[str] = frozenset(
    {
        "market",
        "restoran",
        "ulasim",
        "fatura",
        "saglik",
        "giyim",
        "eglence",
        "nakit_atm",
        "transfer",
        "faiz",
        "iade",
        "vergi",
        "teknoloji",
        "egitim",
        "diger",
    }
)
