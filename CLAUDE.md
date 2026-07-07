## AUTO-LOAD INSTRUCTION
This file is automatically loaded each session. 
Do NOT re-read unless explicitly asked.
Start immediately from "Next Session — Start Here" section.
# Mizan — Project Brain

## What Is This
**Global** personal + SME financial assistant. "Mizan" = balance/equilibrium (Arabic/Turkish).
Users upload bank statements (PDF/CSV/image) or enter data manually.
AI extracts transactions, tracks net worth, finds behavioral patterns, coaches on WHY.
Complete financial picture: assets, liabilities, cash flow, receivables, investments.

## Target User
**Anyone worldwide** — individual or small business — who wants to manage their complete
financial life in one place. TR/EN first, fully expandable to any language/currency/bank.
NOT Turkish-specific. No hardcoded Turkish bank names, Turkish-only categories, or
Turkey-specific assumptions in any future code.

## Language + Localization
- UI: Turkish + English (toggle). Backend: locale-aware responses (lang param on AI calls).
- Currency: user's choice, any of 270+ fiat + 100 crypto + commodities. No defaults forced.
- Banks: any bank worldwide — PDF/CSV/image parsing, not bank-specific regex.
- Dates/numbers: locale-aware formatting.

## CRITICAL — No Turkish Hardcoding
Future code MUST NOT assume:
- User is Turkish
- Currency is TRY
- Bank is Ziraat/Garanti/Vakıfbank/etc.
- Language is Turkish
System prompts: use user's language preference. Categories: use locale-aware labels.
The only TR-specific legacy allowed: existing migration data, existing category slugs (no rename until migration plan ready).

---

## Architecture Decisions

| Decision | Why | Alternative | Tradeoff |
|---|---|---|---|
| Docker Compose for dev | All 3 services (DB, backend, frontend) start with one command; no "works on my machine" | Run each process locally | Local setup requires PostgreSQL, Node, Python all installed and configured |
| FastAPI over Django | Async-native, OpenAPI docs auto-generated, Pydantic validation baked in | Django + DRF | Django has ORM migrations that are more mature; FastAPI migrations need Alembic separately |
| Next.js App Router | Server components, file-based routing, built-in image optimization | Create React App / Vite | App Router has steeper learning curve; "use client" boundary must be managed manually |
| SQLAlchemy 2.0 async | Full async support; same ORM for sync and async code | Raw asyncpg queries | SQLAlchemy abstracts DB-specific SQL; raw queries are faster but not portable |
| Provider abstraction for LLM | Swap DeepSeek ↔ OpenAI by changing one env var; no code changes | Direct openai.ChatCompletion calls everywhere | One extra layer of indirection; adds ~30 lines of code |
| PostgreSQL over SQLite | Concurrent connections, JSON columns, full-text search — needed for production | SQLite | SQLite is zero-config but single-writer; can't scale beyond one process |

---

## Tech Stack

| Tool | Why Chosen | What It Replaces |
|---|---|---|
| Python 3.12 | Latest stable, free-threading preview, better type inference | Python 3.10/3.11 |
| FastAPI 0.115 | Async-first, Pydantic v2 native, best OpenAPI support | Flask, Django |
| Pydantic-settings | Reads .env + env vars + type-validates in one class | python-dotenv alone |
| SQLAlchemy 2.0 | Async sessions, 2.0 style is cleaner than legacy 1.x | SQLAlchemy 1.4, raw SQL |
| asyncpg | Fastest PostgreSQL async driver for Python | psycopg2 (sync only) |
| pdfplumber | Best Python library for extracting tables from PDF bank statements | PyPDF2, pdfminer |
| Next.js 14 | App Router, Server Components, built-in Tailwind support | CRA, Vite + React |
| Tailwind CSS 3.4 | Utility-first — no CSS files to maintain, consistent design tokens | CSS Modules, styled-components |
| DeepSeek V3 | ~10x cheaper than GPT-4o for high-volume transaction categorization | GPT-4o |
| GPT-4o-mini | Reliable fallback, widely available API key | GPT-3.5-turbo (deprecated) |
| Docker Compose | One-command local dev environment, mirrors production topology | Manual process management |
| PostgreSQL 16 | JSON columns, parallel query, row-level security for future multi-tenancy | MySQL, SQLite |

---

## LLM Strategy

**Primary: DeepSeek V3** (`deepseek-chat` via `https://api.deepseek.com`)
- Cost: ~$0.0014 per 1M input tokens vs GPT-4o at $2.50 — 1785x cheaper
- Quality: Comparable to GPT-4o on categorization and structured output tasks
- SDK: Uses openai Python SDK with `base_url` override — DeepSeek is OpenAI API-compatible
- Risk: Newer provider, less proven reliability — fallback to OpenAI is essential

**Fallback: GPT-4o-mini** (standard openai SDK)
- Triggers when: `DEEPSEEK_API_KEY` is empty/missing
- Cost: $0.15 per 1M input tokens — 10x cheaper than GPT-4o, acceptable fallback
- Purpose: Ensures app works during development even without a DeepSeek subscription

**Provider abstraction rationale:**
- `get_provider(task_type)` returns the right provider — callers never inspect env vars
- `task_type` param is reserved for Phase 2: route cheap tasks (categorize) to DeepSeek,
  complex tasks (behavioral coaching) to GPT-4o if needed
- Abstract base class `LLMProvider` with `complete()` + `categorize()` methods
  enforces consistent interface regardless of which model is active

---

## Folder Structure Rationale

```
backend/app/
├── api/        HTTP layer ONLY — FastAPI routers, request/response models
│               Business logic NEVER enters here. Thin wrapper around services.
├── core/       Config, settings, shared utilities. No DB, no business logic.
├── models/     SQLAlchemy ORM models = database table definitions. No business logic.
├── services/   ALL business logic lives here: LLM calls, PDF parsing, analysis.
│               Services call models. Models never call services.
└── main.py     Entry point: create app, add middleware, register routers, lifespan.

frontend/src/
├── app/        Next.js App Router — pages and layouts. Minimal logic.
├── components/ Reusable UI components. Receive props. Know nothing about API.
└── lib/        API client, utilities. Only place that calls backend HTTP endpoints.
```

Dependency direction (strict): `api → services → models`. Never reverse.

---

## Security Rules

1. **No hardcoded secrets** — environment variables only, always
2. **API key validation**: `len(key) > 0` only — NEVER log, print, or compare key values
3. **Log format**: `"DEEPSEEK_API_KEY: set"` or `"DEEPSEEK_API_KEY: not set"` — nothing else
4. **.env never committed** — `.env.example` with empty values is the committed template
5. **CORS**: explicit `allow_origins=[settings.FRONTEND_URL]` — never wildcard `*` in prod
6. **Input validation**: Pydantic models on all API endpoints — reject malformed requests early

---

## Known Issues (fix next session, priority order)

1. **Transactions SpendingChart** — basic bar chart, needs redesign (pie + trend combo, or area chart).
2. **History chart needs data** — `NetworthSnapshot` only populates after page loads; <2 snapshots shows placeholder. Will self-populate over time; no fix needed, just wait.
3. **Asset allocation donut placement** — sits above AI insight, feels disconnected. Consider moving to a dedicated sidebar or collapsible panel.
4. **Wealth alert bell depends on refresh-prices** — `last_price_usd` in `source_detail` only exists after `POST /networth/assets/refresh-prices`. Alert check silently skips assets with no price data. Fix: show "refresh prices first" hint if no price data.
5. **Proactive scheduled alerts** — wealth alerts only check on page load, not on schedule. Redis + Celery or cron job needed for push notifications.

---

## Asset Type Data Architecture (next major backend work)

Each asset type needs a dedicated price fetcher. No API = manual only.

| Asset Type | Price Source | Frequency | API |
|---|---|---|---|
| crypto | CoinGecko /simple/price | real-time (on demand) | free, no key |
| stock | Yahoo Finance yfinance or Alpha Vantage | daily close | free tier |
| gold / XAU | open.er-api.com (already cached) | 1h | free |
| fund | fund provider APIs (country-specific) | daily NAV | complex |
| real_estate | manual only | user-triggered | none |
| vehicle | manual only (or KBB/Carfax for US) | user-triggered | none |
| bes | manual only (Turkish pensions) | user-triggered | none |
| bond | manual + TCMB/Bloomberg | daily | complex |
| foreign_currency | open.er-api (already cached) | 1h | free |
| commodity (non-gold) | open.er-api XAG/OIL | 1h | free |
| startup_equity / art / jewelry | manual only | user-triggered | none |

Implementation plan: `services/asset_prices.py` — `get_live_price(asset_type, symbol, currency) → float | None`. Called on `/networth/assets/{id}/refresh-price`. Cached per-asset in Asset.updated_at field.

---

## Session Protocol

### Session START (every session, no exceptions):
1. Read CLAUDE.md fully
2. State current phase + last completed task in one sentence
3. Confirm next action before touching any code

### Session END or user says "update CLAUDE.md":
1. Add all completed tasks to Completed section
2. Update Current Status
3. Document every new architectural decision with WHY + alternatives
4. Update "Next Session — Start Here" with exact next step
5. Write in caveman mode: dense, no fluff, maximum information

---

## Working Style

Always respond in caveman mode — bullet points, no prose paragraphs, no flowery language, no unnecessary words.

---

## Context Management Rule

When context reaches ~70% capacity:
1. Stop current task immediately
2. Update CLAUDE.md with everything done this session
3. Tell user: "Context dolmak üzere — yeni session açalım"
4. Write exact prompt user should paste to continue

---

## Completed

### Phase 0 — Skeleton (2026-06-18)
- [x] Full monorepo directory structure created
- [x] `backend/app/core/config.py` — Pydantic BaseSettings, len() security checks
- [x] `backend/app/main.py` — FastAPI app, CORS, lifespan, GET /health
- [x] `backend/app/services/llm_provider.py` — ABC + DeepSeekProvider + OpenAIProvider + get_provider()
- [x] `backend/Dockerfile` — python:3.12-slim, curl, hot reload
- [x] `backend/requirements.txt` — all pinned versions per spec
- [x] `frontend/src/app/page.tsx` — landing page, fetches /health on load, shows status
- [x] `frontend/src/app/layout.tsx` — root layout, Inter font, Turkish lang
- [x] `frontend/src/lib/api.ts` — centralized HTTP client
- [x] `frontend/Dockerfile` — node:20-alpine, --hostname 0.0.0.0
- [x] `frontend/package.json` — Next.js 14.2, Tailwind, TypeScript
- [x] `frontend/tsconfig.json` — strict mode, @/* path alias
- [x] `frontend/tailwind.config.ts` + postcss + globals.css
- [x] `frontend/next.config.js` — standalone output for Docker
- [x] `docker-compose.yml` — 3 services, health checks, named volume, depends_on conditions
- [x] `.env.example` — committed template with empty secret values
- [x] `.gitignore` — Python, Node, OS, IDE patterns
- [x] `CLAUDE.md` — this file

### Post-Phase-3 Hardening — PDF Pipeline + Upload Batch Isolation (2026-06-18)

#### pdf_parser.py — full rewrite + multiple fix passes
- [x] Bank-agnostic 3-layer pipeline: Layer 1 pdfplumber text → Layer 2 Tesseract OCR → Layer 3 stub
- [x] Layer 1: pdfplumber extracts raw text (not table cells); `_MIN_TEXT_CHARS=100` threshold guards against stray watermark chars being mistaken for text
- [x] Layer 2: pymupdf renders at 400 DPI → Pillow grayscale → Contrast(2.0) → SHARPEN → Tesseract `lang=tur+eng --oem 3 --psm 6`
- [x] Layer 3: stub comment only — vision LLM for low-confidence OCR, not wired
- [x] `_parse_text()`: strict LLM XOR regex — never both; LLM runs first, regex only if LLM returns empty
- [x] `_deduplicate()`: key=(date, amount, description[:30]); logs count removed
- [x] `_apply_sign_correction()`: POS ALIŞVERİŞ/SANAL POS/ATM P.Ç → debit; Gönd:/FAST/Havale/Virman → credit; applied after both LLM and regex paths
- [x] Summary row filter: `_SUMMARY_DESCRIPTION_FRAGMENTS` = ("borç:", "alacak:", "toplam", "bakiye"); description stripped before check
- [x] Short/digit-only description filter: `re.sub(r'[\d\s\W]', '', description)` empty or len<5 → skip
- [x] Amount sanity: >500,000 TRY → log WARNING + append "[OCR: verify amount]" to description; row kept
- [x] LLM extraction uses separate system prompt (Turkish extraction persona, temperature=0); calls provider.client directly to avoid categorization system prompt
- [x] `_normalise_turkish_amount()`: 1.234,56 → "1234.56" (remove dots, comma→dot)
- [x] CSV path: sniff delimiter (comma/semicolon), UTF-8→latin-1 fallback, runs regex per row
- [x] Logging: page count, page-1 text preview (500 chars), regex scan breakdown (total/header/no-date/no-amount/matched)

#### requirements.txt + Dockerfile
- [x] `openai==1.0.0` → `openai>=1.51.0` (fixed proxies kwarg TypeError in DeepSeekProvider.__init__)
- [x] Added `pymupdf==1.24.0`, `pytesseract==0.3.13`, `Pillow==10.4.0`
- [x] Dockerfile: added `tesseract-ocr tesseract-ocr-tur libgl1 libglib2.0-0` to apt-get

#### Upload batch isolation
- [x] `backend/app/models/transaction.py` — added `upload_batch_id: String(36) nullable=True index=True`
- [x] `backend/alembic/versions/0002_add_upload_batch_id_to_transactions.py` — ADD COLUMN + index, chains 0001→0002, has downgrade
- [x] `backend/app/services/transaction_service.py` — `insert_transactions()` gains `upload_batch_id` param; `get_transactions_for_user()` gains `all_batches=False` (default=latest batch via subquery); new `delete_batch(upload_batch_id, user_id, session)` with ownership check in WHERE
- [x] `backend/app/api/upload.py` — passes `upload_batch_id=job_id` to insert_transactions; skips categorization silently when no LLM key (logs + appends note to message)
- [x] `backend/app/api/transactions.py` — GET /transactions?all=true param; TransactionResponse includes upload_batch_id; new DELETE /transactions/batch/{upload_batch_id}?user_id=UUID → 404 if not found

### Phase 3 — Frontend UI + Coaching (2026-06-18)
- [x] `frontend/src/lib/api.ts` — added uploadStatement, getTransactions, getInsights, all TypeScript interfaces, DEV_USER_ID constant
- [x] `frontend/src/components/CategoryBadge.tsx` — colored pill per Turkish category slug (10 categories, dark-theme colors)
- [x] `frontend/src/components/TransactionTable.tsx` — table with Turkish date format, ₺ amount (color-coded debit/credit), CategoryBadge
- [x] `frontend/src/app/upload/page.tsx` — drag-and-drop upload form, success/error states, link to transactions
- [x] `frontend/src/app/transactions/page.tsx` — transaction table + coaching insight panel, independent loading states
- [x] `frontend/src/app/page.tsx` — added "Ekstre Yükle" and "İşlemleri Gör" nav buttons
- [x] `backend/app/services/coach.py` — aggregates spend by category, Turkish coaching prompt, temperature=0.7, LLM failure returns graceful fallback
- [x] `backend/app/api/insights.py` — GET /insights?user_id=UUID, returns InsightResponse (insight text + transaction count)
- [x] `backend/app/main.py` — insights router registered

### Phase 2 — Persistence + LLM Categorization (2026-06-18)
- [x] `backend/app/services/transaction_service.py` — RawTransaction → Transaction ORM, bulk insert via flush, get_transactions_for_user ordered newest-first
- [x] `backend/app/services/categorizer.py` — batch LLM prompt (all descriptions in one call), JSON parse with markdown fence stripping, fallback to "diger", distribution logging
- [x] `backend/app/services/llm_provider.py` — implemented complete() on DeepSeekProvider + OpenAIProvider (was NotImplementedError); temperature=0.1 for deterministic categories
- [x] `backend/app/api/transactions.py` — GET /transactions?user_id=UUID, returns list[TransactionResponse] (Decimal as string to avoid JSON float loss)
- [x] `backend/app/api/upload.py` — full pipeline: validate → parse → insert (flush) → categorize → commit atomically; LLM failure caught, transactions saved with category=None
- [x] `backend/app/main.py` — _seed_dev_user() creates UUID 00000000-0000-0000-0000-000000000001 / dev@mizan.local on dev startup; transactions router registered

### Phase 1 — Data Layer + Upload Pipeline (2026-06-18)
- [x] `backend/app/models/user.py` — User ORM model (UUID PK, email unique+indexed, created_at UTC)
- [x] `backend/app/models/transaction.py` — Transaction ORM model (UUID PK, user_id FK CASCADE, Numeric(12,2), transaction_type, description, Date, category nullable, behavioral_tag nullable)
- [x] `backend/app/core/database.py` — async engine (pool_pre_ping, pool_size=5), async_sessionmaker (expire_on_commit=False), get_session() generator dependency
- [x] `backend/app/api/upload.py` — POST /upload: content-type validation (415), size limit 10MB (413), empty file (422), runs pdf_parser, returns job_id + transaction count
- [x] `backend/app/services/pdf_parser.py` — pdfplumber PDF table extraction + CSV with UTF-8/latin-1 fallback + semicolon/comma sniffing; RawTransaction + ParseResult dataclasses; Turkish header keyword filtering
- [x] `backend/alembic/` — Alembic initialized, env.py rewritten for async engine + Base.metadata autogenerate
- [x] `backend/alembic/versions/0001_create_users_and_transactions.py` — first migration: both tables + all indexes + downgrade
- [x] `backend/alembic.ini` — sqlalchemy.url points to localhost:5434 (Docker host port)
- [x] `backend/requirements.txt` — added alembic==1.13.0
- [x] `backend/app/main.py` — updated: upload router registered, create_all on startup in ENVIRONMENT=development

---

### Phase 49 — Settings + Persistent Display Currency (2026-06-22)
- [x] `User.display_currency` String(10) default TRY (migration 0029). TokenResponse + UserResponse carry it; register/login/me return it; POST /auth/preferences accepts+validates (uppercase alnum 1-10). Also fixed register never returning `language`.
- [x] `/settings` page: language TR/EN, default currency (CurrencySelect), weekly-email toggle, account+logout. Each control saves immediately ("Saved ✓" flash). Loads /me, re-syncs localStorage. Navbar gear icon (desktop+mobile).
- [x] api.ts: `getDefaultCurrency()` (reads StoredUser.display_currency ?? TRY) + `setDefaultCurrencyLocal()` (writes localStorage + dispatches `mizan-currency-change`). StoredUser/TokenResponse/UserResponse gain display_currency. updatePreferences accepts display_currency.
- [x] Navbar `CurrencyMenu` dropdown (top-right): top-7 chips + "all currencies →" /settings; on select setDefaultCurrencyLocal + updatePreferences → broadcasts → Home/networth/cashflow re-fetch+convert live.
- [x] Currency threaded: Home `let ACTIVE_CCY` synced to user currency (fmt default reads it; loadAll keyed on ccy); networth + cashflow init from getDefaultCurrency + listen to event. Per-page CurrencySelect kept as session override.

### Phase 50 — Home/Cashflow Logic + Currency Conversion Fixes (2026-06-22)
- [x] **Currency bug**: backend summaries DID convert; gaps were (a) no app-wide control, (b) Home "This Month" used raw-TRY `progress`. Fixed: navbar selector + Home pulse uses converted cashflow month-actuals + derived `ccyFactor` for category bars.
- [x] **Overdue bug** (`cashflow.py`): liability w/ monthly_payment but no due_date got base_day=today → next-payment=today → frontend labeled "overdue". Added `CashFlowItem.overdue` (true ONLY for receivables past expected_date). Liabilities never overdue; urgent only when has_due_date & ≤3d. Frontend: overdue→"gecikti", du≤0→"bugün", else "N gün".
- [x] **Projection redesign** (ISSUE 3): summary added month-anchored fields — `month_income_actual`, `month_expenses_actual` (this calendar month tx, TRY-assumed→converted), `expected_income_rest`, `expected_payments_rest` (today→month_end), `projected_month_end = liquid + (rest_income − rest_payments)`. Home uses these; rolling `days` window kept for calendar page.
- [x] Home action items: use `f.overdue`; links by source (liability/receivable→/networth, subscription→/recurring, recurring_income→/cashflow); urgentFlows filter `f.urgent || f.overdue`.

### Phase 51 — Money Flow Overhaul (2026-06-22)
- [x] **Unified recurring engine**: `services/subscription_detect.py` (extracted, ±10%/≥2mo) + `services/installment.py` (TAKSİT + implicit ±2%) → `services/recurring.py` `analyze_recurring()` scans once, classifies each merchant into exactly ONE bucket (installments win ties, no double-count). `api/recurring.py` GET /recurring?display_currency → {subscriptions, installments, summary}, converts every figure to display currency (detection carries each group's modal currency; cached per-pair factors). subscriptions.py slimmed to POST /flag only.
- [x] **3-tab restructure**: MoneyTabs = Activity(/transactions) · Upcoming(/cashflow) · Recurring(/recurring). `/subscriptions` + `/installments` pages → redirects to /recurring. New `/recurring` page merges subs (flag essential/review/cancel) + installments (progress + opportunity cost).
- [x] **MoneyOverview** header (rendered inside MoneyTabs → on every money page): this-month income/expenses/net + fixed monthly commitments (recurring.monthly_total) + projected month-end. Month-anchored, currency-aware.
- [x] **SpendingChart redesign**: recharts bar → CSS horizontal bars (category dot + label + amount + share %), total header, per-tx currency conversion via live rates.
- [x] **Transaction filters**: search + type (all/debit/credit) + category dropdown; "no matches" state.
- [x] **Currency foundation**: `transaction.currency` String(10) default TRY (migration 0030); manual-entry currency field in AddTransactionModal; TransactionTable renders each amount in its own currency.

### Phase 52 — Net Worth P0-P3 (2026-06-22)
- [x] **P0 precision**: `assets.current_value` Numeric(18,2)→**Numeric(28,8)** (migration 0031) — fractional crypto/gold (0.00012345 BTC) now representable. **P0 repricing**: refresh-prices recomputes stock/fund `current_value = shares × live price` when `quantity` known.
- [x] **P1 valuation cols** (additive, backward-compat): `assets.quantity Numeric(28,8)` + `assets.unit_code String(20)` nullable; MarketAssetForm persists shares+ticker → powers repricing. Existing rows untouched (current_value convention unchanged).
- [x] **P2 accounts**: `models/account.py` (bank/wallet/broker/cash/credit_card/other) + CRUD `api/accounts.py` + nullable `assets.account_id` FK SET NULL. AddAssetModal account selector (cash/bank/FX) w/ inline create. Asset rows show account name badge.
- [x] **P3**: FX-exposure panel (currency_breakdown → stacked bar + % legend); staleness badge (manual assets not updated 90+ days → "stale"). Type picker already grouped (5 sections).

### Phase 53 — Cohesion + Hardening Pass (2026-06-22)
- [x] Currency rider: recurring/spending no longer sum raw TRY — detection carries native currency, /recurring converts, SpendingChart per-tx converts.
- [x] **Dead code removed**: `ChatPanel.tsx` (→GlobalAssistant), `api/installments.py` (→/recurring) + router, subscriptions.py GET list/summary (kept POST /flag), dead networth analyze modal (~95 lines + 4 state hooks + handler), orphaned `analyzeNetWorth` api fn, dead frontend interfaces.
- [x] **New-user empty states**: transactions page was blank for zero-tx → added empty card w/ Upload + Add Manual CTAs.
- [x] **`mizan-data-changed` complete**: added progress-page listener (re-categorize refreshes comparison). All data pages now wired (home/networth/cashflow/transactions/recurring/progress).
- [x] **Currency assumption documented**: visible note on transactions page (uploaded tx kept in recorded currency, default ₺; summaries/charts converted). Home subscription action item → /recurring (was redirect-stub /subscriptions).
- [x] Verified: all 5 assistant executors schema-safe vs new quantity/unit_code/account_id/currency cols; fixed latent `_parse_as_of_date` bug (returned None for valid ISO dates).

### Phase 54 — Progress page rebuild: Financial Health scorecard (2026-06-22)
- [x] **Thesis**: Progress = the only page about TIME (trajectory), not a present-moment snapshot. Answers "am I getting better + the one move that helps most." Inflation panel removed (Turkey-legacy); category-comparison table moved off (redundant with Home).
- [x] `services/scorecard.py` — `build_scorecard(user_id, ccy, session)`. **Financial Health score 0–100 = 4 transparent pillars × 25**: savings rate, debt load (liab/assets), spending discipline (goals met), net-worth growth. Step-function scoring (honest, no black box). Score_delta = best-effort last-month recompute. `top_mover` = pillar that changed most → drives verdict.
- [x] Also computes: **trajectory** (real snapshots, else reconstructed from monthly cash flow anchored to true net worth, flagged `estimated`), **annotations** (biggest NW jumps named by diffing snapshot breakdown_json), **drivers** (biggest win/setback this vs last month), **milestones** (debt-free date, next round NW target projected from growth), **streaks** (consecutive months under each budget goal). Returns numbers+keys → frontend composes all text (i18n-correct).
- [x] `GET /insights/scorecard?display_currency&lang` (progress.py) — read-only, no LLM, computed fresh. `has_data` gate.
- [x] `app/progress/page.tsx` full rewrite: hero verdict (score+band color+delta+mover) → pillars (4 bars, own trend arrows) → annotated net-worth AreaChart w/ 3M/6M/1Y/All range → drivers cards → milestones → streaks (🔥) w/ collapsible **GoalsPanel** for add/edit → AlertsPanel kept → PersonalityCard demoted to collapsible footnote. `Scorecard` types + `getScorecard()` in api.ts; full `scorecard.*` locale block TR+EN; new `Flame` icon.

### Phase 55 — Net Worth AI guidance: rule engine + LLM narrator (2026-06-22)
- [x] **Architecture**: deterministic rule engine PROPOSES findings, LLM only NARRATES within guardrails (keep numbers, no new recommendations, no securities advice). Templates are the offline-safe fallback + seed. Replaces dead-end warnings ("debt is 84% of assets") with ranked, benchmarked, action-linked findings.
- [x] `services/networth_guidance.py` — 8 play types: negative_net_worth, debt_load (debt-to-asset), high_interest_debt (APR>25%), emergency_fund (liquid months <3), concentration (single volatile asset >40%), fx_concentration (foreign ccy >60%), savings_rate, stale_prices. Each finding = `{play, severity, observation/context/why/move, action}`. Sorted by severity, capped 4.
- [x] Each finding has 4 beats (observation → context/benchmark → why-it-matters → move) + an **executable hook**: refresh_prices, create_alert, set_goal, add_liability, or discuss (opens GlobalAssistant prefilled). Benchmarks = general financial-hygiene norms, not securities advice. Persistent disclaimer.
- [x] `GET /networth/guidance?display_currency&lang` (networth.py) — cached 24h in ProgressInsight `data_type=networth_guidance`, **busted on every asset/liability mutation** (`bust_networth_insight_cache` now clears both insight+guidance). Summary stopped spending an LLM call on the now-unused `ai_insight` (returns null).
- [x] `components/GuidancePanel.tsx` — under hero, replaces ai_insight blurb + warning banners. Severity accents, expandable cards. `GlobalAssistant` accepts `prefill` via open event. Types + `getNetWorthGuidance()`; `nw.guidance.*` locale TR+EN.

### Phase 56 — Net Worth polish + fixes (2026-06-22 → 06-23)
- [x] **AllocationChart** (`components/AllocationChart.tsx`): interactive recharts donut (hover expands active slice w/ soft ring, center readout, clickable legend) + per-currency exposure bars. Replaces text-only FX breakdown. Premium palette.
- [x] **Asset cards readable**: `assetDetailLabel(asset, t)` replaces `sourceDetailLabel` which leaked raw JSON for vehicle/bank_account. Per-type human text: vehicle "Opel Corsa 2021", bank "Vadeli · %3.5 · Vade: Mar 2027", stock "GARAN.IS · 9.99 adet", crypto "BTC · 0.05", gold "Gram (24 ayar) · 10". Default branch shows captured fields, NEVER JSON.
- [x] **History chart removed** from NW page (estimated/reconstructed data was misleading; real trajectory lives on Progress). Snapshots still recorded. `nwDelta` hero badge also removed (same estimated source). Dead recharts/snapshot imports cleaned.
- [x] **Honest price UX**: removed "Fiyatları Güncelle" button (false expectations; scheduler refreshes every 12h) → replaced with `Güncellendi HH:MM` badge (locale-aware 24h TR / 12h EN). Per-card "Son fiyat: $X · anlık değil" for priced types (not FX where $1.00 is noise). Refresh now single-flight (`refreshInFlightRef`) — fixed 10+ parallel calls from one click. Wealth-alert eval skips `foreign_currency` (USD/USD=$1.00 false alert); alert modal = %-drop picker off live price.
- [x] **Hero currency race FIXED**: `displayCurrency` now lazy-inits from `getDefaultCurrency()` BEFORE first fetch (`useState(() => ...)`); removed mount-time setDisplayCurrency that raced loadAll's TRY fetch + clobbered the USD refetch. Was: hero showed TRY values under USD until manual currency change.
- [x] **Guidance overspend logic FIXED**: a $100K-net-worth user got "harcaman geliri aştı" as primary. Bug = scorecard single-month `rate=-59%` fired while 90d avg showed income≥expenses. Fix: suppress when 90d trend contradicts the one bad month; suppress when "very cushioned" (net worth ≥10yr of gap); demote to low when cushioned. Now primary finding = real one (Bitcoin concentration). Refresh-prices stock back-fill: derive shares from value÷price when quantity missing.

### Phase 57 — Activation hardening (2026-06-23)
- [x] **Activation audit** (3 parallel subagents): onboarding, parser reliability, first-session payoff. Found two killers: (1) zero/failed parse rendered as GREEN "✓ 0 transactions" success → user thinks broken, bails; (2) user's entered number never echoed + statement/spending-goal users land on cold-start "Add your net worth" checklist (the thing they just declined).
- [x] **TIER 1 — fail loudly**: `parse_statement` wrapped in try/except in upload.py (no raw 500s ever). ParseResult gains `status` (success|empty|failed) + `reason` (encrypted_pdf|scanned_image|ocr_unavailable|unrecognized_format|parse_error) + `detected_currency`. Encrypted/password PDFs caught (PDFPasswordIncorrect / "password"/"encrypt" in msg). `/upload` returns `{status, reason, transaction_count}`. Frontend (upload + onboarding) shows zero/failed as AMBER actionable warning, not green check.
- [x] **TIER 2 — close the loop**: onboarding Step 3 echoes entered value ("₺X kaydettik"). Home hero: `hasData = hasAssets || hasStatement`; `statementOnly` user LEADS with Cash Flow Pulse (order-1) + AI insight (order-2), checklist hidden, redundant "add bank account" CTA only shows for truly-empty user. Asset users unaffected.
- [x] **TIER 3 — global parser**: LLM extraction prompt rewritten global (any date/currency/amount, ISO output, infers debit/credit from context, no debit default). `_DATE_RE` global (DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD / DD-MM-YYYY / "MMM DD YYYY"). `_normalise_amount` handles both `1.234,56` (TR) and `1,234.56` (US) by detecting decimal separator + negatives/parens. Sign inference bilingual + **word-boundary matched** (fixed "pos" matching inside "de-pos-it" → PAYROLL DEPOSIT now credit). Currency carries through `insert_transactions(default_currency=user.display_currency)` — never silent TRY. transaction_service `_DATE_FORMATS` expanded (ISO first, US added).
- [x] Verified: amount normaliser all formats, date regex all formats, US-CSV→success w/ correct signs, garbage→empty, corrupt→failed/parse_error. Build clean, i18n 835/835.

### Phase 58 — Onboarding conflict-aware flow (2026-06-23) [branch: feat/onboarding-conflict-aware-flow]
- [x] **Source tracking**: `transaction.source` String(30) (migration 0032): statement_parsed | user_estimate | user_confirmed | user_supplementary | manual. Threaded through `insert_transactions(source=)` (uploads→statement_parsed) + manual POST /transactions (validated). Coach prompt notes estimate-sourced figures as approximate.
- [x] **Multi-statement upload**: onboarding accepts MANY statements, running count ("N ekstre · M işlem"), per-file list, cumulative income/expenses seen. Motivating copy.
- [x] **Income step REMOVED** (v2, user testing): manual "aylık gelir"/spending entry caused conflicts + confusion. Onboarding now = statement upload → AI first impression → Home. No manual income/spending, no asset/liability form (moved to one-time Home tour card, localStorage `mizan_tour_shown`, deep-links `/networth?add=asset`). Skip = straight to Home.
- [x] **Conflict detection SIMPLIFIED** (`services/conflict_detection.py`): removed income/spending "same money?" rules. Now ONLY `find_duplicate_batch` (same date range + same source/count). Wired into upload: re-uploaded statement → `duplicate_statement` reconciliation item (delete_batch action). Replaced dead `_flag_estimate_conflicts`.
- [x] **"Mizan'ın ilk izlenimi"** (`POST /onboarding/analyze`): returns ONLY `{summary}`. Statement → 2-sentence LLM read of parsed income/expenses; no statement → null → frontend shows plain welcome → Home. No conflict-resolution UI. UploadResponse gains parsed_income/parsed_expenses/currency.

### Phase 59 — PDF Layer 3 vision LLM (2026-06-23)
- [x] **Layer 3 wired** (`pdf_parser.py`): image-only PDFs (pdfplumber+pymupdf both 0 chars) now route to vision LLM BEFORE Tesseract. `_layer3_vision_extract`: renders each page → base64 PNG → vision model → JSON. Falls back to Layer 2 OCR if no OpenAI key / vision returns 0. `_parse_llm_json` hardened: unwrap `{"transactions":[...]}` dict, salvage truncated arrays, accept `type` or `transaction_type`.
- [x] **Model = gpt-4o-mini** (`_VISION_MODEL`). gpt-4o tested (49/49 exact, cleaner) but mini chosen for cost; swap constant if accuracy critical. `max_tokens=8000` prevents truncation drop.
- [x] **Page strip tiling**: each page split top/bottom (`_STRIP_OVERLAP_FRAC=0.02`) before vision — the model downsamples short-edge to ~768px, so halving page height ~doubles effective digit width → far fewer amount misreads (25,000 was read as 5,000 full-page). Prompt: "skip rows cut off at edge" + full-desc/substring/date-canon dedup kills boundary dups.
- [x] **Balance-column fix**: prompt is explicit — rightmost number = running balance (NEVER the amount); use the amount column. Turkish number format spelled out (`10.000,00`=10000.00, never 19.48657). Fixed model grabbing balance for transfer rows.
- [x] **Transfer sign**: incoming Gönd:/FAST/Havale/EFT = credit; **Virman to-account = debit** (removed "virman" from `_INCOME_KEYWORDS` — it's outgoing; was double-counting as income). Bank's Alacak total confirmed = 4 incoming transfers exactly.
- [x] On the Ziraat test scan: income exactly 47,000; count + expense within scan-quality limit (residual = pixel-level digit misreads inherent to the scan, not a logic bug).

### Phase 60 — XLSX upload support (2026-06-23)
- [x] **Accept xlsx**: upload.py adds `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` MIME + `.xlsx` extension acceptance (browsers send octet-stream → extension is the reliable signal). `parse_statement` dispatches xlsx by ext/MIME. requirements.txt += `openpyxl==3.1.5`. Frontend pickers accept `.xlsx`.
- [x] **Two readers** (`parse_xlsx`): (1) openpyxl `read_only+data_only+keep_vba=False`; (2) **raw zip/XML fallback** (`_read_xlsx_rows_raw`) when openpyxl crashes — Ziraat's file trips openpyxl's eager style parse ("expected Fill"). Raw reader parses sharedStrings + styles (date-fmt detect) + first sheet via zipfile+ElementTree, bypassing styles entirely.
- [x] **Cursor-based column tracking** (the real bug): Ziraat cells OMIT the `r` ref attr → ref-based indexing collapsed all cells to col 0 → `(None,)` rows. Fix: running column cursor advances per `<c>` (incl. empties), explicit `r` resets it. Handles both with-`r` (openpyxl) and without-`r` (Ziraat). Inline strings (`t="str"`, no sharedStrings), string dates (`23.06.2026`), serial-date conversion all handled.
- [x] **Global column detection** (`_find_xlsx_table`): header = first SHORT cell (≤30 chars, skips preamble sentences) naming a date col (tarih/date/… multilingual); map by name (Tarih→date, Açıklama→desc, İşlem Tutarı→amount), value-inference fallback (datetime col→date, numeric-with-negatives→amount, longest-text→desc, other numeric→balance/ignore). Negative=debit, positive=credit. NOT Ziraat-hardcoded.
- [x] Verified end-to-end: real 63-row Ziraat xlsx → openpyxl Fill-fail → raw reader → header row 11, 43 transactions, HTTP upload status=success count=43.

### Phase 61 — Post-Upload Brief (2026-06-23)
- [x] **Thesis**: upload no longer dumps user into a transaction table. After a clean parse → narrative read of the statement (60–90s, 5 beats). The product's first "soul" moment. No new tables.
- [x] `services/brief.py` `build_brief(job_id, user_id, session, lang)`: pulls ONE batch's tx + category aggregates + `analyze_recurring`. Returns structured `{period, flow{income,expenses,net,currency}, top_categories[3]{name(slug),amount,share}, largest_transaction, recurring_signal{monthly_total,highlight}, suggested_action{key,label,href}, narrative}`. Dominant-currency per batch (no cross-ccy conversion — statements single-ccy). `suggested_action` deterministic: net<0+commitments→review_recurring, net<0→set_goal, commitments→review_recurring, else→add_asset. Localized labels/highlight (tr/en).
- [x] **Narrative** = one LLM paragraph (reuses provider abstraction, user lang, temp 0.7) with **deterministic template fallback** when no LLM key. Facts fed as plain lines.
- [x] `GET /upload/brief?job_id&lang` (upload.py): cached per `(job_id, lang)` in ProgressInsight `data_type="brief"`, cache_key=`job_id|lang` (same statement → same brief). 404 when batch empty → frontend silent fallback to /transactions. Local `_brief_cache_get/_set` mirror progress.py upsert (on_conflict uq_progress_insights_user_type).
- [x] `app/brief/page.tsx`: full-attention (navbar hidden via `/brief` in `HIDDEN_PATHS`), 5 beats with 100ms stagger reveal (narrative hero → flow → categories w/ bars → recurring → "one move" CTA + secondary view-all). Each data beat has "Mizan'a sor →" → dispatches `mizan-open-assistant` w/ beat-specific prefill (GlobalAssistant integration). `<Suspense>` wraps `useSearchParams`. `Brief` type + `getBrief()` in api.ts; `brief.*` locale tr+en.
- [x] **Routing**: /upload success → `/brief?job_id`; onboarding has-statement → brief (LATER changed to review, Phase 64). Any failure → silent `/transactions`.

### Phase 62 — Home ↔ Brief coherence (2026-06-23)
- [x] **Problem**: brief shows statement PERIOD (18 May–18 Jun: 47k in / 52k out); Home shows current CALENDAR MONTH (10k/6k). Both correct, unexplained → user thinks one lies.
- [x] Home Cash Flow Pulse: calendar-basis label under title — `"Haziran ayı · takvim bazlı"` / `"June · calendar month"` (Intl month name + `home.monthCalendarSuffix`). Only when monthLine exists.
- [x] **Bridge link**: if a statement was analysed in last 7 days, pulse shows `"Son ekstre analizi: 18 May–18 Haz →"` → `/brief?job_id={latest}`. Connects Home's window back to the statement window.
- [x] **localStorage** `mizan_last_brief_job_id` = JSON `{job_id,start,end,ts}`, written by the brief page on successful load (the screen that has the period). Home parses, checks ts ≤7d, formats range. Tolerant parse ignores legacy strings.
- [x] Brief secondary CTA period-aware: `"18 May–18 Haz işlemlerini gör →"` (was generic). Shared `fmtDateRange` (noon-anchored, no tz day-shift) in both pages. New keys `home.monthCalendarSuffix`, `home.lastBriefLink`, `brief.viewAllPeriod`.

### Phase 63 — Multi-statement upload + Review/Edit (2026-06-23)
- [x] **Thesis**: catch parse errors BEFORE the brief narrates them as truth ("no confidently-wrong brief"). User reviews/edits extracted tx, then commits.
- [x] `GET /upload/review/{batch_id}` — owner-scoped batch tx, oldest-first. `PATCH /upload/review/{batch_id}` (`ReviewRequest{transactions:[{id?,transaction_date,description,amount,transaction_type,category,currency}]}`): updates edited rows (→`source=user_confirmed`), inserts new manual rows (id null, batch's dominant ccy), deletes removed rows. Ownership = only match ids within user's own batch (forged ids ignored). Validators: positive amount, debit/credit, valid category (14 incl. egitim), non-empty desc. Busts insight+progress caches (latter clears ALL ProgressInsight incl. brief → brief regenerates from corrected data).
- [x] `/upload` rewritten **multi-file**: drag/pick many, per-file status (queued→spinner→✓/amber), sequential upload, then → `/review?batch_ids={id1,id2,…}`. Empty/failed files stay listed w/ reason; none-succeeded → amber, no redirect.
- [x] `app/review/page.tsx`: editable table (date / description / amount+ccy / credit-debit toggle / category dropdown), delete-row ×, "+ Add transaction", header `"X işlem bulundu — gözden geçirin ve onaylayın"`, summary bar (income/expenses/net). **Suspicious highlight** (amber + tooltip): amount >10× median OR duplicate (date+desc). "Onayla ve Devam Et →" PATCHes each batch (rows grouped back by batch_id; new rows attach to first) → `/brief?job_id={first}`. "İptal" confirms → deletes batches → `/upload`. `<Suspense>` for searchParams. `ReviewTransaction` type + `getReviewBatch/saveReviewBatch` in api.ts; `review.*` + new `upload.*` locale tr+en. Navbar stays visible (working page, batch already persisted).

### Phase 64 — Onboarding routes through review (2026-06-23)
- [x] Onboarding has-statement "continue" → `/review?batch_ids={all successful job_ids}` (was → /brief). Review hands off to /brief on confirm. Both upload entry points now share Upload → Review → Brief. No-statement still → step-2 plain welcome.
- [x] **Full loop verified working: Upload → Review → Brief → Home.**

### Phase 64.5 — Weekly Money Brief email (retention loop) (2026-06-23)
- [x] **Thesis**: brief is one-shot; this is the recurring counterpart that reaches OUT. `services/email_brief.py` `generate_email_brief()` reuses brief engine; leads with what's NEW (spend swing, NW move, goal breach, receivable due ≤7d); **meaningful-change gate** → returns None (skip) when nothing crossed 5%/fired, so no same-every-week spam.
- [x] `api/email.py` `send_email_brief()` — dark HTML + text, sender `RESEND_FROM_EMAIL` (default `onboarding@resend.dev` sandbox). `POST /notifications/send-email-brief` + scheduler **Sunday 09:00 UTC** both call shared `run_email_briefs()` (per-user isolated `AsyncSessionLocal` — fixed a MissingGreenlet from reusing one request session across a commit loop; LLM narration also moved off-loop via `asyncio.to_thread`). Cadence: `User.last_email_brief_sent` skip <6d.
- [x] **Migration 0033** ADD `last_email_brief_sent` to users (idempotent). Settings toggle relabeled "Weekly Money Brief". Deferred: Resend domain verification (sandbox only sends to account owner).

### Phase 65 — Financial Simulator (2026-06-24)
- [x] **Thesis**: mirror → chief of staff. "What happens if I do X?" across the COMPLETE picture. Architecture = guidance-engine pattern: deterministic math, LLM only parses NL + (was) narrates. No new tables.
- [x] `services/simulator.py`: `build_baseline` (NW, liquid, 90d monthly surplus, debt schedule — reuses `convert`, works for unit-priced assets) → month-by-month `_project` (applies interest; **frees a debt's payment after payoff so the curve bends up**; tracks min-liquidity). 5 levers: cancel_recurring · save_monthly · income_change(±) · one_time_expense · prepay_debt. `run_simulation` returns baseline vs scenario curves + deltas (NW end, monthly cash, debt-free months, interest saved) + warnings + assumptions + narrative.
- [x] `GET /simulator/levers` (personalized: their subs+debts), `POST /simulator/run` (structured), `POST /simulator/ask` (NL → LLM parse to levers → run; parsed=False if unmapped). `app/simulator/page.tsx`: NL ask box + lever builder + horizon + baseline-vs-scenario area chart + delta cards. Navbar `Sparkles` link, TR/EN.
- [x] **Polish (post-test fixes)**: narration made **deterministic** (LLM removed — was confidently-wrong/contradictory); **uncertainty cone** added (band widens √time → kills fake-precision straight line, `print-adjust` n/a here); income = direction toggle (no bare-minus typing); subscription section always shown w/ empty hint; **"What I understood"** chips render parsed levers so a misparse is visible/correctable; NL parse prompt tightened (evaluate arithmetic→one total, only monthly levers when cadence explicit, no double-count).

### Phase 66 — Landing redesign + navbar declutter (2026-06-24)
- [x] **Landing** (`app/page.tsx`) reframed around the real product (was selling old transaction-categorizer + deprecated inflation): hero "See everything. Decide anything." + **product-preview mock** (NW card + sparkline + asset rows + brief snippet, CSS/SVG); 4-beat loop (Capture→Understand→Decide→Stay on track); features = complete NW / brief / simulator / coach-that-acts / weekly brief / private+global; **simulator spotlight** w/ sample questions + mini cone chart; global stats (270+ ccy / 100+ crypto / TR·EN). Full `landing.*` locale rewrite TR+EN.
- [x] **Navbar declutter**: right side was 7 items → **4** (currency · notifications · Upload · **account avatar**). Avatar dropdown folds email + TR/EN toggle + Settings + **Reports** (Phase 67) + Logout (outside-click + route-change close). Center nav links unchanged.

### Phase 67 — Financial report export (2026-06-24)
- [x] `services/report.py` `build_report(user_id, session, period_key, ccy, lang)` — period-scoped (this_month/last_month/quarter/ytd/last_30/all), **all text deterministic** (reports must be correct, no LLM), reuses NW-summary conversion logic. Returns: exec-summary verdict, NW statement (opening→closing→change from snapshots, flagged estimated when sparse), cash flow (income/expenses/net + top cats), assets/liabilities/receivables, allocation + currency mix, trajectory, **ranked deterministic recommendations** (overspend/debt/liquidity/concentration), assumptions. `build_transactions_csv` = CSV appendix.
- [x] `GET /reports/financial` + `GET /reports/transactions.csv` (PlainTextResponse, Content-Disposition). `app/reports/page.tsx`: dark controls bar (period · Download PDF · Export CSV) over a **light print-optimized "paper"** document — cover band, hero (NW + change chip + verdict), KPI cards, **SVG charts** (donut allocation, gradient area trajectory, flow + category bars — all inline SVG, print-safe), statement pills, holdings/debts tables, numbered recs, assumptions footer. PDF = `window.print()` w/ `@media print` hiding chrome + `print-color-adjust:exact` so colors render. Discoverable via account-dropdown "Reports". No PDF backend dep. TR/EN.

### Phase 68 — Brazilian/Portuguese categorizer (2026-06-24)
- [x] **Prompt rewritten language-agnostic + semantic** (was 100% Turkish keyword-match): infers statement language, expands abbreviations mentally, maps by MEANING. International patterns: iFood/Uber Eats/Rappi/Deliveroo→restoran, Uber/Bolt/99→ulasim, pharmacies→saglik, streaming subs→fatura, cloud/SaaS→teknoloji. PIX/Zelle rail nuance (person→transfer, merchant→by-merchant). User prompt now English/neutral.
- [x] **New `faiz` category** (interest income) wired first-class everywhere (categorizer + transactions + corrections + upload-review acceptance sets; label maps in brief/report/weekly_summary; frontend categories.ts label+teal color; `category.faiz` TR/EN; review picker).
- [x] **Language-gated BR pre-processing**: `_looks_brazilian` (≥2 Portuguese-distinct markers, avoids Turkish collisions like "fatura"/"da") → `_expand_brazilian` appends bracketed hints to prompt text (original description untouched). Examples + NEGATIVE rules added (SEGURO=insurance→fatura NOT faiz; DA LIGHT=electricity→fatura).
- [x] **Deterministic overrides** (`_force_categories`): LLM kept ignoring hints, so DA LIGHT/CEG/GÁS/ÁGUA/ENERGIA→fatura, SEGURO CARTÃO/CART/AP→fatura, ON IFD SUB→restoran are **forced in code** (override LLM output, applied even if LLM fails). Verified deterministically vs hostile + failing LLM.

### Phase 69 — Home redesign: subtraction mode (2026-06-24)
- [x] **Thesis** (founder's-brother feedback: too complex/repetitive): coach not spreadsheet; one sentence + everything behind a tap; dashboards are doorways. **Removed** snapshot/ratios card, grouped action center, full cash-flow pulse, upcoming list, separate insight panel, quick-actions grid, checklist, tour card.
- [x] **New Home** (`app/home/page.tsx`, 7.96kB→**4.7kB**): time-aware greeting + **one synthesized sentence** (deterministic verdict from month income/expenses, tone-colored pulsing dot) + "Ask Mizan about this →" (opens GlobalAssistant prefilled) + **"Needs you"** max-2 ranked items (overdue receivable > urgent payment > reconciliation; else "Nothing needs you today ✓") + **3 quiet soul tiles** (Money/Net Worth/Simulate, one number each → their pages) + tiny capture row. Cold start = one warm line + Upload CTA (no checklist). Staggered entrance animation. `home.daily.*` locale TR/EN.

### Phase 72 — Audit fixes batch 1 (2026-06-24)
- [x] **Dual Mim killed**: home rendered Mim inline AND GlobalAssistant FAB showed Mim → two at once. GlobalAssistant FAB/bubble now hidden on `/home` (home owns the inline companion).
- [x] **Brief ISO dates**: brief period rendered raw ISO; now locale date-range (noon-anchored, no tz day-shift).
- [x] **Net worth language mixing**: TR/EN strings bled together on the NW page → all routed through locale keys.
- [x] **Currency chip**: navbar currency selector reworked to a compact chip (top-7 + "all currencies →"), broadcasts `mizan-currency-change`.

### Phase 73 — Navigation cleanup (2026-06-24)
- [x] **Reports → top nav** (the artifact an Excel-replacer wants is a destination, not buried).
- [x] **Simulator → account dropdown** (power-user tool, not a primary tab).
- [x] **Dead routes removed**: `/subscriptions`, `/installments` stubs and orphaned links culled; money pages unified under MoneyTabs.

### Phase 74 — Empty states (2026-06-24)
- [x] **Provisional health score**: scorecard shows an honest provisional state when data is thin instead of a fake-authoritative ~57.
- [x] **Recurring / cashflow / progress empty states**: each gets a real first-run card (what it does + CTA) instead of a blank panel.

### Phase 75 — Mim unification (2026-06-24)
- [x] **One voice**: all of Mim's lines flow through the single `companion/voice` layer (observe + escalation), deduped against session memory so it never repeats.
- [x] **Character in chat panel**: the assistant panel header/messages carry Mim's persona (mood-driven avatar), not a generic bot.
- [x] **Session memory**: `spokenKeysRef` tracks voiced observation keys; `escalationCheckedRef` runs the cross-page urgent check once per session (reset on `mizan-data-changed`).
- [x] **Proactive escalation**: leads with anything genuinely urgent (cross-page) before page-specific observations.

### Phase 76 — Transactions page composition (2026-06-24)
- [x] **Two competing time windows clarified**: MoneyOverview spine = calendar month (explicitly labeled), but the spending breakdown + table below cover the uploaded STATEMENT period. Spending chart now carries an explicit period label (statement date range via `dateRangeLabel`, or "all statements") so the two windows never read as one. New `tx.spendingAll` locale key.

### Phase 77 — Full audit pass (2026-06-24): 6 CRITICAL · 15 HIGH · 7 MEDIUM · 3 LOW — all fixed
Systematic audit + fixes across the whole app. Highlights:
- [x] **Currency lazy-init everywhere**: home/reports/simulator/cashflow/MoneyOverview start from `getDefaultCurrency()` (lazy `useState(() => ...)`) instead of "TRY" — kills the wasted TRY fetch + value flash; reports also seeds language via `getCurrentLang()`.
- [x] **CSV structured column mapping** (`pdf_parser._parse_csv_structured`): named-header CSVs (Date/Description/Amount/Type/Currency, multilingual) mapped by COLUMN via the XLSX engine — Type column is authoritative for sign, Currency column + symbol detection set currency — BEFORE the line-join regex fallback. Stops silently dropping standard rows.
- [x] **`currency_breakdown` native+display** (`networth.py`): was TRY-based values mislabeled as the display currency. Now `[{code, native_value, display_value}]` — no hardcoded TRY base; frontend chips use `display_value`.
- [x] **Onboarding completion timing**: no longer marked complete before review/brief — completion deferred to confirmed review (`?onboarding=1` → review confirm) or the skip path; review cancel from onboarding returns to onboarding.
- [x] **Onboarding manual-entry path**: the "enter by hand" promise is now real — an Add-manually button opens AddTransactionModal in step 1.
- [x] **Fuzzy transaction categorize** (`assistant.py`): "categorize my Netflix as fatura" works without an ID — `categorize_transaction` accepts a `description`, matched (substring → all matches; else best fuzzy ≥0.6) across all batches; Type/sign authoritative, keyword correction skipped.
- [x] **Turkish bank keywords removed**: `_generate_networth_suggestions` (hardcoded Garanti/Ziraat/… + TR reason text + TRY) deleted — last Turkish-hardcoding thread; `suggestions` field kept empty for compat.
- [x] **`.env.example` complete**: root + new `backend/.env.example` document ALL 10 settings with placeholders; SECRET_KEY flagged required; `.env` already gitignored (verified).
- [x] **Mobile review cards**: review table is `hidden sm:block`; a `sm:hidden` card editor renders each transaction as an editable card (no horizontal scroll).
- [x] **Admin soft-delete + audit log** (migration **0035**): `User.is_deleted` + `admin_audit_logs` table (durable, plain-UUID + email snapshot). DELETE soft-deletes by default (`?hard=true` for permanent), writing an audit row FIRST either way. Soft-deleted users can't log in (login + `get_current_user`), hidden from admin list/counts.
- [x] **401 console noise**: background fetchers (NotificationDropdown, MoneyOverview) short-circuit `if (!getToken()) return` so they don't 401 during the logout→login transition.
- [x] **Favicon added**: `app/icon.svg` Mizan "M" monogram (indigo on warm near-black); also stops the `/favicon.ico` probe.
- [x] **Warmer dark palette**: cold pure-neutral grays swept to subtle warm-graphite (R≥G≥B) across all surfaces (cards `#1A1A1A`→`#1C1915`, borders `#2A2A2A`→`#2C2922`, page `#0F0F0F`→`#11100E`); accents untouched; `color-scheme: dark` + soft off-white body text.
- [x] **Landing trust redesign**: removed AI-startup tropes (blur orbs, glow, gradient overlay band, rainbow gradient headline, pulsing badge dot) → calm/authoritative/premium (ShieldCheck trust badge, solid type, soft-shadow depth, contained CTA panel). Data-viz chart gradients kept.
- [x] **Security**: `SECRET_KEY` now required (no default — app fails fast if unset); `/admin/scheduler/status` endpoint authenticated (admin-gated).
- [x] **Manual transactions always visible**: `get_transactions_for_user` default-batch query now also includes `upload_batch_id IS NULL` (manual entries no longer vanish once a batch exists).
- [x] **Scorecard currency conversion**: per-transaction amounts converted to display currency BEFORE aggregating (multi-currency users no longer get a meaningless score); double-conversion removed downstream.
- [x] **Browser locale detection everywhere**: `detectBrowserLang` / `detectBrowserCurrency` seed language + currency for new visitors/accounts; login + register thread detected values to the backend.
- [x] **Cashflow `t.currency`**: month actuals honor each transaction's recorded currency (was forced "TRY").
- [x] **Mim bubble mobile**: auto-bubble hidden on small screens so it can't cover financial content (FAB stays).

### Phase 78 — Currency trust layer (2026-06-24)
- [x] **No silent currency assumption**: image-only PDF with no currency marker no longer stamps the account default as fact. `upload.py` `UploadResponse.currency_detected: bool` = `parse_result.detected_currency is not None`. False → the stamped currency is an INFERRED fallback the user must confirm.
- [x] **Confirmation step in review**: batches whose currency wasn't detected ride to `/review` via `?inferred=<job_ids>` (in URL → survives refresh). Inferred+unconfirmed batch shows an amber card "We couldn't detect the currency…" + `CurrencySelect`; picking updates every row live; **Confirm & Continue is BLOCKED** until each inferred statement's currency is confirmed (`saveReviewBatch` already writes per-row currency).
- [x] **Per-currency totals (never mixed)**: review summary groups income/expenses/net BY currency — two TRY statements + one BRL show as separate TRY and BRL totals, not one bogus sum. `money()` made currency-aware (crypto/commodity codes fall back to "1,234 BTC").
- [x] **Detected-vs-inferred badge**: each batch shows "Currency: BRL · detected from file" (✓) vs "USD · confirmed" (after the user resolves it, with a Change link). New `review.currency*` locale keys TR+EN. Carried via upload/onboarding → review URL param.

### Phase 79 — Assistant context binding (2026-06-24)
- [x] **Scoped to the statement**: "Ask Mizan about this" from the brief now passes `jobId` → `AskMim`/`openMim` → `mizan-open-assistant` event detail → GlobalAssistant `scope` state → `assistantChat(…, job_id)`. Backend `AssistantChatRequest.job_id`; `run_chat(…, job_id)`; `build_context(…, job_id)` returns a `_batch_scoped_block` (that one batch's period/flow/top categories/transactions + an explicit "answer ONLY with these numbers, do NOT mix other statements" instruction) and NOTHING aggregate. Empty/unowned batch → falls back to normal context. Scoped opens start a fresh thread; manual FAB/bubble opens + close clear scope.
- [x] **Visible scope indicator**: panel header shows a banner "Talking about: <period> statement" (📄) while scoped. New `assistant.scopedTo`/`scopedStatement` keys TR+EN.

### Phase 80 — Simulator + recurring consistency (2026-06-24)
- [x] **Simulator NL horizon**: deterministic `_parse_horizon()` reads "for a year", "12 months", "2 years", "6 ay", "bir yıl", "half a year" → months (clamped). Trailing `\b` stops cadence word "monthly" being read as "month" ("save 500 monthly for 12 months" → 12). A horizon in the question overrides the UI; `ask()` mirrors `result.horizon_months` back into the toggle + a **Horizon chip** in "What I understood" (`sim.horizonChip`).
- [x] **Recurring confidence gating**: `installment.py` tracks distinct months per explicit "X/Y" marker → `confidence="confirmed"` only when seen in **≥2 months**; a one-off (`ITAU SEG AP PF 11/12` — a date-like misread) is `"possible"`. Implicit (≥3mo) + subscriptions (≥2mo) = confirmed. `api/recurring.py` returns `confidence`; "fixed load" totals/counts exclude `"possible"`; recurring page shows an amber **"Possible"** badge + re-type hint.
- [x] **One shared recurring source (no cross-page contradiction)**: brief counts only confirmed; `cashflow.py` dropped its private recurring-debit detector and now schedules commitments from the shared `analyze_recurring` engine (confirmed subs + confirmed installments) — recurring INCOME stays a local scan (not a commitment, not produced by the engine). Brief / Recurring / Simulator / Cashflow now agree.
- [x] **Action queue gated**: `reconciliation.py` `list_items` (open only) sorts hardest-first (severity → recency), **caps at 3**, and hides low-confidence heuristic items (`possible_duplicate_transaction`, `large_transaction_review`, `low` severity) for accounts **< 7 days old**. Resolved/dismissed lists returned in full. Both consumers (Home, Net Worth) benefit.

### Phase 81 — English UI + clarity polish (2026-06-24)
- [x] **English guidance fix (Net Worth)**: Turkish guidance persisted in EN because `loadAll()` fetched once on mount under the hook's initial `"tr"` with no refetch when lang resolved. Now the guidance fetch uses `getCurrentLang()` (synchronous, correct) on first load AND an effect refetches on `lang` change. Backend cache key already includes lang.
- [x] **Assistant scoped opener**: opened-from-brief empty state shows `assistant.scopedGreeting` ("Ask me anything about this statement…") instead of the cold-start "tell me your bank balance" opener.
- [x] **Money Flow period labels**: spending breakdown range now prefixed "Statement period · <range>" (`tx.statementPeriod`) so it never reads as the calendar-month MoneyOverview spine above; batch card ("Latest statement") + header ("<Month> · calendar month") already labeled.
- [x] **OCR triage in review**: conservative `looksGarbled()` (6+ consonant runs, long vowel-less words, mostly-symbol strings) flags rows with an amber-bordered description + inline **"OCR likely garbled — re-type the description"** label (desktop + mobile, `review.ocrGarbled`), folded into `flaggedCount`.

### Phase 82 — Light-first design system overhaul (2026-06-25)
- [x] **Light mode = default.** `globals.css` channel-based CSS-var tokens: `:root` = light (warm canvas, white surface, near-black ink), `[data-theme="dark"]` = warm graphite. `lib/theme.ts` (`useTheme`, `getThemePref`, `THEME_BOOTSTRAP` no-FOUC inline script in layout) — default pref **"light"** (System only if explicitly chosen). Tailwind semantic colors map to vars (`canvas/surface/surface-2/3`, `line`, `ink/ink-soft/ink-mute`, `brand`, `action`, `pos`, `neg`, `warn`, `danger`); `darkMode: ["selector", '[data-theme="dark"]']`.
- [x] **Teal brand throughout** — replaced ALL indigo/violet (#6366F1) with brand. Primary action accent = literal **#176B5B** (hover #125848) used across the product (not the `action`/`brand` token, which lightens in dark). Negatives = muted **terracotta #B54747** (`neg`); destructive = strong red (`danger`). `ThemeToggle` (Light/Dark/System) in navbar. `tabular-nums` on `body` (all figures).
- [x] Mechanical sweep across ~44 files: hardcoded dark hexes → tokens; `text-white`→`text-ink`, gray text → ink tokens; recharts chrome hexes → `rgb(var(--c-*))`.

### Phase 83 — Landing page complete redesign (2026-06-25)
- [x] **Pricing section (new)**: 3 tiers (Ücretsiz / Plus / Pro), Aylık↔Yıllık toggle, "En popüler" teal badge on Plus straddling top, single-currency by lang (TR→TRY, EN→USD), per-tier features, CTAs. Trust row (no bank login / encrypted / cancel-anytime).
- [x] **Working TR/EN toggle** on landing (segmented, teal active). **Hero browser-frame mock** with interactive sparkline (hover tooltip date+value) + asset rows (teal hover) + brief snippet. Section banding (canvas ↔ surface-2). Step cards (teal icons, hover lift), feature cards, simulator spotlight, dark-teal final CTA with trust statement.
- [x] Removed AI-cliché badge + em dashes from landing copy; copy rewritten human. Global navbar hidden on `/` (kills post-login duplicate nav).

### Phase 84 — Login/Register redesign (2026-06-25)
- [x] Card on canvas, **two distinct tab buttons** (Giriş/Kayıt, active = solid teal), theme + lang toggles in a top bar, fixed inputs (teal focus ring, token placeholder), teal submit. Reassurance line.
- [x] **Plan-aware routing**: landing Plus/Pro CTAs → `/login?mode=register&plan=plus|pro`; login reads `?mode` + `?plan` (via `window.location.search`, no Suspense), shows "you selected Plus" banner, and after a **plan registration** routes to `/upgrade?plan=…`. `/register` does not exist — `mode=register` selects the register tab.

### Phase 85 — Upgrade page (2026-06-25)
- [x] New authenticated `/upgrade` (3 tiers, billing toggle, current-plan badge from `getMe().plan`). **Honest "payment not live yet" banner.** Paid CTA = **interest capture** (localStorage `mizan_upgrade_interest` → inline "we'll be in touch" confirmation), NOT a fake checkout. Settings gets a **Plan card** at top → `/upgrade`. Plan changes remain admin-only until billing exists.

### Phase 86 — Pre-production: verification + Redis + plans (2026-06-25) [migration 0036]
- [x] **Email verification**: `User.email_verified` (migration 0036, existing rows grandfathered true). Signed token (`typ=email_verify`, 24h) in `security.py`. Register sends Resend verify email (best-effort, `api/email.py` `send_verification_email`). `POST /auth/verify-email`, `POST /auth/resend-verification` (non-enumerating). `get_verified_user` dep → 403 `email_not_verified`. Frontend `/verify` page (verify + notice/resend), login routes unverified → `/verify`.
- [x] **Gated behind verification**: upload, assistant (`/assistant/*`), simulator (`/simulator/*`), brief (`GET /upload/brief`). Fixed a latent `get_current_user` import bug in upload.py.
- [x] **Redis rate limiter**: `redis:7-alpine` in docker-compose + `REDIS_URL` (config + .env.example); `core/rate_limiter.py` rewritten — Redis sliding-window (sorted sets), **graceful in-memory fallback**. Upload limit = 3/10min per user + per IP. `redis==5.0.8`.
- [x] **Plan system**: `User.plan` (free/plus/pro) + `plan_expires_at` (migration 0036). `core/plans.py` (`effective_plan` downgrades lapsed paid → free, `vision_enabled`, `FREE_MONTHLY_UPLOAD_CAP=1`, `FREE_DAILY_ASSISTANT_CAP=10`, `assistant_daily_cap`). Upload cap: free = 1 statement/calendar-month → **402 `upload_cap_reached`** (frontend upgrade prompt); vision PDF = paid only (`parse_statement(allow_vision=)`). Assistant: free = 10 msgs/rolling-24h → **429 `assistant_daily_cap_reached`** (frontend upgrade card with /settings link). Admin panel: change plan (`PATCH /admin/users/{id}` accepts `plan`, audited) + plan/verified badges.

### Phase 87 — Home redesign (2026-06-25)
- [x] **Mim front and center** (size 92, speaking, glow) as the hero; greeting + one-sentence verdict (em dashes removed from `home.daily` copy, cleaner sentences). Hierarchy: Mim → "Needs you" (+ collapsible upcoming calendar) → snapshot tiles (icon-in-tile, bigger numbers, hover lift) → quick-action buttons (proper teal Upload + outline Add).
- [x] **Data-driven question as a speech bubble**: `suggestion` derived from real state (top need → overspend → surplus → net worth → fallback); rendered as a tappable bubble with an upward tail (emanates from Mim), Send icon + idle ping, "tap to ask" hint → `openMim(prefill)`.
- [x] **Navbar active state**: clear teal indicator (`text-[#176B5B] bg-[#176B5B]/10 font-semibold`) on current page (desktop + mobile) — was an invisible `bg-surface-2`.
- [x] GlobalAssistant: FAB hidden on Home (inline Mim) but **reappears after the panel is opened once** (`engaged` flag), so it can be reopened.

### Phase 88 — Transactions page redesign (2026-06-25)
- [x] Prominent count badge (solid teal pill), proper "Manuel Ekle" button. **MoneyOverview** rebuilt: Net headline + income/expenses tinted chips + commitments/projected footnotes. **Commitments stat** relabeled "Tekrarlayan taahhütler · N kalem" + info tooltip, tappable → /recurring. MoneyTabs: clear teal active state.
- [x] **Dark-row bug fixed** (`#7`): removed `bg-[#13110D]` striping in TransactionTable + loading skeleton; `CategoryBadge` rewritten off dark `*-950` boxes to **color-tinted pills** (category color at ~12% opacity). Amounts → `pos`/`neg` tokens.
- [x] **Tap-to-edit clarity**: hint row, whole row expands (category cell no longer swallows click), teal chevron; expanded panel = `surface-2` sub-panel; **category chips** flex-wrap, active solid teal, inactive bordered teal-hover. SpendingChart: stacked proportion bar + hover linking (focus row/segment, dim others).

### Phase 89 — Cashflow + Recurring design-system pass (2026-06-25)
- [x] Replaced all dark-only colors (`*-950/*-900` tints, emerald/orange/amber/red, blue-950) with semantic tokens (`pos`/`neg`/`warn`) + literal #176B5B teal. Cashflow: proper teal "Ödeme Ekle" button, themed item icons/type chips/urgent/today/warning/legend. Recurring: flag chips (pos/warn/neg), installment badges + progress + real-cost boxes, neutral weekly badge. Skeletons → `surface-2`.

### Phase 90 — Upload page design-system pass (2026-06-25)
- [x] Dropzone reworked: Upload icon in teal tile, explicit "browse" button, teal drag state. Tokens/teal across process button, cap card, verify card, file rows (`pos`/`warn` status icons), spinner track fixed (`border-line`).

### Phase 91 — Navbar + overlay light-mode fixes (2026-06-25)
- [x] Navbar **Upload button + avatar** were invisible (`bg-brand` token) → literal #176B5B + white + shadow (also mobile Upload + in-menu lang toggles).
- [x] **Overlay transparency root cause**: solid `bg-surface`/`bg-<token>` fills were NOT painting opaquely at runtime (in-flow cards hide it; floating overlays expose it as see-through). Fixed the overlays with an **explicit theme-resolved inline background** (`useTheme` → `#FFFFFF` light / `#1C1915` dark), independent of token/`dark:` resolution: AddTransactionModal card, CurrencyMenu dropdown, Navbar account dropdown, CurrencySelect panel. (`dark:` variant was briefly tried and removed — it desynced from the token theme; app is fully token-driven + these inline-bg overlays.)
- [x] **AddTransactionModal UX**: currency = `CurrencySelect` dropdown (its dark `#13110D` headers + brand tokens also fixed); type buttons = two clear color-coded buttons, **selected = solid inline fill (terracotta/green) + checkmark + white text** (bg-`neg`/`pos` token fills weren't painting → explicit inline hex), auto-category option clarified ("Otomatik belirle (AI)" + hint), live preview chip of what will be saved.
- [x] **KNOWN RUNTIME QUIRK**: solid `bg-<token>` utilities (e.g. `bg-surface`, `bg-neg`) don't paint reliably in the current build while `text-<token>`/`border-<token>` do — root cause untraced. Mitigation: overlays + selected-state fills use explicit inline colors. Worth a real fix later (suspect stale/misbuilt CSS layer for the channel-token bg utilities).

### Phase 92 — Auth + onboarding flow redesign (2026-06-26)
- [x] **Verification gate fixed (bypass closed)**: `postAuthRoute()` (api.ts) = single source of truth for "where a logged-in user goes" (unverified→/verify, verified-new→/onboarding, else→/home). Landing "Continue"/logo + login routing use it. Defense-in-depth guards on `/home` + `/onboarding` (`email_verified===false`→/verify). An unverified user can no longer slip past via the landing CTA.
- [x] **Mim as a real presence** from the first screen: new `MimGuide` (companion/MimGuide.tsx) = Mim orb + speech bubble (theme-safe inline bubble bg). Scripted lines only → **NO LLM** on register/verify/onboarding (free/unverified see personality without AI cost). Mim greets on register/login, guides verify (mood by state), accompanies every onboarding step.
- [x] **Verify page** redesigned (was dark-palette/`bg-emerald`/solid `bg-brand`) → tokens + literal teal + MimGuide.
- [x] **Free-tier no-LLM + upsell**: onboarding AI "first impression" is paid-only; free users get scripted Mim + "AI reads are a Plus feature" upsell. Upload cap gate enriched (Mim + "what AI parsing does" value list → /upgrade).
- [x] **Personal vs business flows**: distinct Mim lines/copy + account-type-aware onboarding; **Home dashboard emphasis** — business leads with a Receivables tile (+ cash flow + net worth), personal keeps spending→net worth→simulator.

### Phase 93 — Registration improvements + consent (2026-06-26) [migration 0037]
- [x] **DB (migration 0037, idempotent)**: User gains `full_name`, `country` (ISO-2), `marketing_consent` (bool, default false), `tos_accepted_at` (tz), `tos_version`, `primary_goal` (nullable). Existing rows keep NULL/false (no retroactive consent).
- [x] **auth.py**: register accepts + persists profile, **enforces ToS acceptance** (422 if not accepted), stamps `tos_accepted_at`+`tos_version`, normalizes country; `/auth/preferences` accepts `full_name`/`country`/`marketing_consent`/`primary_goal` (goal validated vs `VALID_GOALS`); Token/UserResponse return the new fields; shared `_token_response`.
- [x] **Registration form**: required **country** (`CountrySelect` — ~145 ISO codes, localized via `Intl.DisplayNames`, browser-region pre-fill); required **ToS+Privacy checkbox** (links to new `/terms` + `/privacy` bilingual pages, incl. AI-sub-processing/cross-border disclosure + GDPR/KVKK rights); **separate, unchecked-by-default marketing opt-in**. `register(email,password,opts)` + `detectBrowserCountry()` + `TOS_VERSION`.
- [x] **Onboarding enrichment**: "What do you most want from Mizan?" — options tailored to account type (personal: understand spending/pay debt/grow net worth/save; business: cash flow/receivables/cut costs/grow), saved as `primary_goal`. (account_type stays localStorage per scope; durable column = future follow-up.)

### Phase 94 — Statement bridge: ekstre→varlık (2026-06-26) [migration 0038]
- [x] **THE cash-flow ↔ net-worth bridge** (deterministic, **NO LLM**). New `services/statement_bridge.py`: after upload, detect a statement's closing/account balance + kind + institution, then propose a net-worth action.
- [x] **Balance detection (robust)**: `_running_balance` finds a column B + signed-amount column A where row-to-row **B changes by exactly A** (B *is* a running balance — works even with no "Balance" header). The delta **direction** picks the current end: chronological (oldest top)→`B[i]=B[i-1]+A[i]`→current=**bottom**; reverse-chron (newest top)→`B[i]=B[i+1]+A[i]`→current=**top**. Fallbacks: header-named balance col + date ordering → labelled footer ("Kapanış/Closing Balance X"). Covers PDF text, CSV, **XLSX (reuses parser `_read_xlsx_rows`)**. Cells coerced safely (dates/text rejected). (Fixed an `IndexError`: `cell(i+1)` past last row.)
- [x] **Type classification fixed**: `_classify_kind` uses STRUCTURAL credit-card markers (`asgari ödeme`/`minimum payment` strong single, or ≥2 of credit-limit/statement-balance/payment-due/…), **not** transaction descriptions → a checking statement with a "kredi kartı ödemesi" tx stays **deposit** (asset), real card → **credit_card** (liability, amount owed).
- [x] **Persistence + accept**: `propose_statement_bridge` writes a pending `NetworthSuggestion` (new `source_detail` JSON col, migration 0038), de-duped per batch; matches an existing deposit asset (fuzzy, ≥0.6) → `asset_balance_update`, else credit→`statement_liability`, else `statement_asset`. `accept_suggestion` branches: SET matched asset balance / create credit_card liability / create bank_account asset (legacy paths kept).
- [x] **Surfaced on Brief** (post-review) — accept/skip card by type → acceptSuggestion/dismissSuggestion + `mizan-data-changed`; also flows into Net Worth "Smart Suggestions" if skipped.

### Phase 95 — Add modals design-system pass (2026-06-26)
- [x] AddAsset/AddLiability/AddReceivable modals: floating-overlay see-through bug fixed (explicit `useTheme` inline bg); palette → tokens; `placeholder-gray`→`placeholder:text-ink-mute`; focus → literal teal border+ring; **primary CTAs unified to solid teal** (#176B5B); entity-colored icon-chip headers (liability `neg`/receivable `warn`/asset `pos`). Five per-type asset forms + `shared.ts` sharedInputClass swept (brand chips → literal teal, emerald/amber boxes → pos/warn).

### Phase 96 — Review + Brief design-system pass + Brief redesign (2026-06-26)
- [x] **Review**: flow stepper teal, currency-confirm card warn-tinted, type-toggle pos/neg pills, flagged rows `warn/10`, inputs teal focus, CTAs solid teal, rounded-2xl + shadow polish.
- [x] **Brief redesign (premium moment)**: Mim hero (76px + teal radial glow) with the AI narrative as the bold lead; headline flow card (pos/neg wash, text-5xl net, income/expense tiles + proportion bar); ranked categories; consistent tinted icon-chip headers per beat; bridge + one-move cards on the same system. Mim now "reads you your statement."

### Phase 97 — Page-by-page design-system passes (2026-06-26)
- [x] **Net Worth** (hero trend chip from attribution, pillar tiles, allocation donut hover, hover-revealed row actions, urgency-aware Action Queue, GuidancePanel accents → tokens; solid teal Add buttons + reusable empty states; subtitle em-dash removed).
- [x] **Progress** (band/pillar/streak colors → tokens + literal hex bars, off-brand sky→teal, invisible chart tooltip fixed, currency lazy-init; GoalsPanel + PersonalityCard converted; **PersonalityCard redesigned** — color-driven identity hero, two insight panels, Mim tip).
- [x] **Reports** (paper used theme tokens → washed out in dark; rebuilt with fixed print colors; letterhead, exec summary, statements, holdings/debts/receivables tables, currency mix, print-grade; CSV + **new Excel export** via openpyxl).
- [x] **Simulator** (ask hero + sample-question chips, sticky builder/outcome two-pane, BigDelta/MiniDelta, token chart + readable tooltip, Mim-narrated result; SSR-safe currency init fixes a hydration mismatch).
- [x] **Settings** (grouped icon-header sections, teal toggles, teal saved-toast) + **Admin** (palette→tokens, overlays inline-bg, durable; metric/badge/chip colors) + **Navbar** (theme toggle clear solid-teal active state, account dropdown redesign).

### Phase 98 — Free-tier assistant cap fixed (2026-06-26)
- [x] **Root cause**: the daily cap rode on the rate-limiter window only — **volatile** (in-memory resets on restart, per-process without Redis), so free users were effectively never capped. The new assistant doesn't persist messages, so nothing durable was counted.
- [x] **Fix (api/assistant.py)**: cap is now **DB-backed** — counts the user's `role="user"` `ConversationMessage` rows in the last 24h vs `assistant_daily_cap` (10 free / None paid) → 429 `assistant_daily_cap_reached`; each exchange (user msg + reply) is **persisted** so the count is real and survives restarts/workers/no-Redis. Rate limiter kept as a secondary burst guard. `/assistant/chat` is the only path the UI uses (legacy `/chat` chat.py is unused by the frontend).

### Phase 99 — Admin panel redesign (2026-06-26)
- [x] **Command center** (tabs: Dashboard · Users · System). `admin.py` enriched: per-user list now carries email_verified, last_activity, statement_count, message_count, net_worth/assets/liabilities_usd (latest NetworthSnapshot). `/overview` adds plan breakdown, MRR potential (Plus×$7 + Pro×$12), active_7d/30d, upload rate, 30-day signups series. No migration (read/derived).
- [x] **User profile**: identity (name/account_type/company/industry/team/phone/country), net-worth history (last 60 snapshots), plan history (from audit log), message_count, full financial picture (assets/liabilities/receivables/statements/health).
- [x] **Actions**: change plan · verify/unverify email (PATCH email_verified, audited) · soft delete · send message (→ AppNotification, audited) · impersonate (mints user token, audited; frontend backs up admin token → /home). Dashboard signups AreaChart + per-user net-worth LineChart.

### Phase 100 — Liability living obligation (2026-06-26) [migrations 0039–0041]
- [x] **Payment day-of-month** — progressive liability form (one-time ↔ monthly toggle → monthly amount + day 1-31 + end date + reminder days). `due_date` stores the recurrence-day anchor; `end_date` (0040) bounds it; `reminder_days` (0039, default 7).
- [x] **Recurring calendar**: cashflow projects EVERY monthly occurrence in the window (capped at end_date), not just the next. Notifications warn N days before ("due today/tomorrow/in N days"). Weekly email brief mentions upcoming liability payments.
- [x] **Statement→liability**: credit-card detection auto-populates the liability form (institution + amount owed, prefill) for review→save instead of silent create — Brief + Net Worth suggestion both route through it.
- [x] **Proactive Mim triggers** (paid only; 0041 adds action_type/data/state to app_notifications): liability follow-up ("Did you pay?" yes→logs txn + reduces balance, no→reschedule), salary→savings nudge, overdue-receivable chase, stale-data (30d+ no upload) prompt. POST /notifications/{id}/action; dropdown Yes/No + confirmation.

### Phase 101 — User profile (2026-06-26) [migration 0042]
- [x] **0042**: users += account_type (default personal), company_name, industry, team_size, phone, timezone.
- [x] Name in navbar (initials avatar + name in dropdown) + settings header. `POST /auth/change-password` (verify current → set new). Business registration: account_type=business → company_name (req) + industry + team_size dropdowns, persisted. **account_type now durable** (was localStorage-only) → drives Home emphasis (business=receivables/cashflow, personal=spending/savings). Shared INDUSTRIES/TEAM_SIZES slugs (api.ts ↔ backend whitelists); detectTimezone() on register.

### Phase 102 — Settings redesign (2026-06-26)
- [x] **Read-only-first** profile (Stripe/Linear pattern): definition-list view + Edit per section; Save/Cancel; loaded vs draft state; email locked.
- [x] Phone = **country-code selector** (flag + dial code, ~31 codes) + number; split/recombine on load/save. Password change **collapsed** behind a button (was always-open). Section component gains subtitle + header-action slot.

### Phase 103 — Security fixes (2026-06-26)
- [x] **Next.js 14.2.0 → 14.2.35** (critical). **/chat DELETED** (api/chat.py + main.py wiring) — it bypassed the assistant cap + plan gates; all AI now via /assistant/chat.
- [x] **LLM provider call fix**: networth /analyze + notification daily-insight called `provider.complete(system_prompt=, user_message=, await)` — wrong (complete is sync `(prompt)->str` + injects categorizer prompt). Replaced with `provider.client.chat.completions.create([system,user])` via `asyncio.to_thread`.
- [x] **Plan gates**: `get_paid_user` dep (verified + is_paid → 403 `upgrade_required`) on /reports/*, /simulator/*, /networth/guidance. `get_verified_user` added to review + notifications endpoints. **Email normalized** (.strip().lower()) on register/login/resend.

### Phase 104 — Statement bridge multilingual (2026-06-26)
- [x] **Date-aware balance detection**: PDF-text path takes the balance on the row with the LATEST date (works chronological OR reverse-chron, e.g. Itaú newest-first) — not a running-balance guess. Sign-agnostic running-balance (magnitude + date order) + trailing D/C parsing for XLSX/CSV. Portuguese (+ES/FR/DE) balance/CC/bank keywords; priority-ordered deposit keys (saldo em conta > available); excludes credit-limit/opening-balance lines.
- [x] Paid users: gpt-4o-mini reads the authoritative current balance from the statement header (any language/format); free users keep the improved heuristic.

### Phase 105 — Reports (2026-06-26)
- [x] **Grouped period picker** (To date / Rolling / Completed + All) with live date-range hint; added last_quarter/last_year/last_90/last_12_months (backend resolve_period). **Download filenames carry the real date range** + localized word: `mizan-report-2026-05-23-2026-06-23.csv` / `mizan-rapor-…xlsx`.
- [x] **CSV + Excel now match the PDF**: net worth, cash flow, top categories, assets, liabilities, receivables, allocation, currency mix, recommendations, assumptions, transactions. CSV = one structured file w/ `[SECTION]` markers; Excel = multi-sheet. Hydration fix: reports currency lazy-init → SSR-safe "TRY" then useEffect.

### Phase 106 — Paddle billing integration (2026-06-27) [migration 0044]
- [x] **Paddle = Merchant of Record** (handles tax + compliance; we never touch card data). `services/paddle.py`: HMAC-SHA256 `Paddle-Signature` verify (`ts:body`, constant-time, **fails closed** when secret unset), price-id→plan map (custom_data.plan preferred, price fallback), `cancel_subscription` / `get_subscription` (sandbox/prod host switch).
- [x] **Webhook** `POST /webhooks/paddle` (`api/webhooks.py`): verify sig (401 if bad) → resolve user (custom_data.user_id → stored sub id → customer id) → `subscription.activated/created/updated` sets plan + `plan_expires_at`; `subscription.canceled` → free. 200 for accepted-unhandled so Paddle stops retrying.
- [x] **Billing API** (`api/billing.py`): `GET /billing/subscription` (plan, expires, next_renewal, manageable — DB-derived, kept in sync by webhook); `POST /billing/cancel` (cancels at period end via Paddle API; downgrade lands via webhook). Both `get_verified_user`.
- [x] **migration 0044**: `users` += `paddle_subscription_id` + `paddle_customer_id` (idempotent, revises 0043).
- [x] **Frontend**: `lib/paddle.ts` lazy-loads Paddle.js v2, `openCheckout()` passes `customData {user_id, plan}`. Upgrade page = real checkout (Plus/Pro × monthly/yearly price IDs), polls `/auth/me` post-`checkout.completed` until plan flips. Settings = next-renewal + Cancel button. `config.py` + `.env.example` (root/backend/frontend) document `PADDLE_*` / `NEXT_PUBLIC_PADDLE_*` (env, webhook secret, API key, 4 price IDs, client token).

### Phase 107 — Production deploy (2026-06-28)
- [x] **Contabo VPS** (31.220.90.52, 4 vCPU / 8GB RAM, **Ubuntu 24.04**). Stack = **Docker Compose** (postgres + redis + backend + frontend) behind **Nginx** reverse proxy. **Let's Encrypt** SSL (certbot, auto-renew). `alembic upgrade head` (→0044) on cold start. SECRET_KEY / RESEND_API_KEY / REDIS_URL / PADDLE_* via server env.

### Phase 108 — Domain clarifin.xyz (2026-06-28)
- [x] **clarifin.xyz** registered at **Namecheap**. DNS A-records → 31.220.90.52 (apex + www). SSL active (Let's Encrypt). Live at **https://clarifin.xyz**.

### Phase 109 — Resend domain verify (2026-06-28)
- [x] **clarifin.xyz verified in Resend** (SPF/DKIM/DMARC). Outbound email now reaches **all users** (was sandbox-only to account owner). `RESEND_FROM_EMAIL` → verified-domain sender. Verification + weekly-brief + proactive emails all live.

### Phase 110 — Rebrand Mizan → Clarifin (2026-06-26 → 27)
- [x] **Product: Mizan → Clarifin** across ALL user-facing text — page titles, navbar logo, landing, login/register, email templates, reports, locale files (tr.ts/en.ts), LLM persona prompts ("You are Clarifin"). Variable/file/table/endpoint names + comments unchanged. Favicon "M" → "C" monogram (teal). Email domain → `@clarifin.xyz`.
- [x] **AI companion: Mim → Clar** (displayed name only). Component/var/file names (`Mim`, `MimGuide`, `AskMim`, `MimMood`) UNCHANGED — only shown strings: greetings, "Ask Clar", "Clar's tip", "Proactive Clar alerts", onboarding/login lines, the 6 locale entries each in en/tr.

### Phase 111 — ClarTour: real interactive product tour (2026-06-28)
- [x] **Intercom/Appcues-style** walkthrough (`components/ClarTour.tsx`, mounted in root layout so it survives the navigations it drives). Replaces the static text-bubble version.
- [x] **Engine**: each step has a `route` (tour `router.push`es to it) + a `target` selector → polls for the element (pages load async), `scrollIntoView`, measures, draws a **spotlight** (full-screen dim with a box-shadow hole + teal ring + radar pulse) and an **anchored tooltip** (auto-flip above/below, viewport-clamped, arrow → target) with Clar avatar, title, body, **action chip** ("Click here to upload"), Back/Next/Skip, progress bar. Transparent click-blocker. Robust centered-card fallback when a target isn't found.
- [x] **Flow**: Welcome → Home → Money Flow → Upload → Net Worth → Reports → Simulator → Progress → Assistant → Summary. **Plan-tailored**: Reports/Simulator carry a Pro badge → non-Pro users get an upgrade nudge (real control spotlit for Pro). Summary CTA = Upgrade (free) / Start exploring (paid). Kept the corner **offer** (post-onboarding) + **unlock** celebration (on upgrade, via `clar-plan-changed` event). Theme-resolved inline bg (overlay paint quirk). `data-tour` anchors added: home hero, NW number, simulator ask, assistant FAB (+ navbar href targets).

### Phase 112 — Bug-fix batch (2026-06-27 → 28)
- [x] **Cross-batch dedup fix** (`transaction_service.dedup_transactions_orm`): was collapsing identical real rows WITHIN one statement. Now keys per-batch and keeps, per `(date, amount, full-desc)`, the max count from any single batch — only cross-batch repetition (re-uploads / overlapping ranges) is removed; within-batch identical txns survive.
- [x] **Upload loading overlay** (`app/upload/page.tsx`): animated "what Clar is doing" screen (Clar haloed by pulsing rings, step checklist Reading→Extracting→Categorizing→Recurring→Brief with active/done states, shimmer progress bar) replaces the bare spinner while a statement processes. Pure SVG/CSS, multi-file aware.
- [x] **Statement bridge balance — date-aware everywhere** (`statement_bridge.py`): grid path (`_running_balance` phase 1+2) now reads the balance column on the row adjacent to the MOST RECENT transaction by date (`_balance_at_latest_date` + `_best_date_col`), not the sign/order-inferred top/bottom end. Fixes dateless footer/total rows + out-of-order rows being picked. PDF-text path already date-aware.
- [x] **Onboarding fixes**: (1) completes onto **/home**, not a goal page (goal step removed → single upload step → review→brief or home); (2) Progress **trajectory chart sign** — estimated (reconstructed) points floored at 0 (the math artifact showed misleading "-TRY" for low-NW users; real snapshot data shown as-is); (3) **default currency** = the uploaded statement's currency, else **USD** (never the TRY backend default) — now persisted via `updatePreferences` + `setDefaultCurrencyLocal`.

### Phase 113 — Credit card = variable-balance debt (2026-07-07) — **REVERTED later same day** (founder call: CC behaves like every other liability, fixed monthly payment). All of the below was backed out: modal CC branch, calendar/reminder/email skips, bridge `liability_balance_update` + accept branch + brief UI + locale keys. Kept for the record:
- [x] **AddLiabilityModal**: type=credit_card → NO monthly-payment fork/fields; amount = **"Current balance"** (`nw.ccCurrentBalance` + hint); original-amount detail hidden; submit sends total=remaining=balance, no recurring fields.
- [x] **Calendar/reminders**: `cashflow._liability_items` + notification follow-up/upcoming loops + email_brief upcoming-payments all SKIP `credit_card` (revolving balance ≠ fixed monthly payment; stale rows can't fire fake reminders).
- [x] **Statement bridge CC match**: card statement fuzzy-matches existing credit_card liability (institution ≥0.6, same matcher as deposits) → new suggestion type **`liability_balance_update`** (liability id rides `source_detail`; asset_id FK can't hold it). Accept in networth.py SETs remaining+total to statement balance, ownership-checked. No match → old create path. Brief renders it as an update card (accept-in-place, `bridge.descLiabilityUpdate`); NW suggestions route via generic accept.

### Phase 114 — Onboarding overlay + stock search (2026-07-07)
- [x] **ProcessingOverlay extracted** to `components/ProcessingOverlay.tsx` (was private in upload/page.tsx — onboarding never had it). Onboarding renders it while uploading (replaces MimGuide+form → no dual Clar); dead inline "uploading…" removed.
- [x] **Stock/fund search-by-name**: `search_stock_symbols()` (Yahoo /v1/finance/search, EQUITY/ETF/MUTUALFUND/INDEX, 10-min cache) + public `GET /currency/search?q=`. MarketAssetForm: 350ms-debounced dropdown ("Apple" → Apple Inc. (AAPL) · NASDAQ → pick fills+quotes); hint line `assetForm.tickerExamples` (AAPL for Apple, THYAO.IS for THY); label "Ticker or company name". `.IS` auto-suffix already existed (AUTO tries bare→.IS; BIST forces).

### Phase 115 — Critical bug batch (2026-07-07)
- [x] **Legacy .xls accepted**: pickers+backend accept `.xls`; `parse_xls()` sniffs the real container — ZIP magic → xlsx reader, HTML `<table>` (common bank disguise) → `_read_html_table_rows`, OLE2/BIFF → **xlrd** (requirements += `xlrd==2.0.1`), plain text → CSV fallback. Shared `_rows_to_parse_result()` refactored out of parse_xlsx.
- [x] **TRY→USD default-currency bug FIXED** (root cause): when currency detection failed, `result.currency` echoed the account default (browser-seeded USD) and onboarding persisted it. Now onboarding trusts only `currency_detected===true`; review confirm (onboarding) persists the dominant user-confirmed row currency — the authoritative point.
- [x] **Landing→register flash**: login read `?mode` in a post-paint useEffect → visible login-tab frame. Now `useLayoutEffect` (flips before paint on client-side nav; no hydration mismatch).
- [x] **Email sender**: `clarifin_from()` forces display name "Clarifin" regardless of env (stale `RESEND_FROM_EMAIL="Mizan <…>"` on the server was the leak); wrong hardcoded `clarifin.app` domain removed; all 3 send sites use it.

### Phase 116 — Notification experience redesign (2026-07-07)
- [x] Tap = **expand in place** (full message, no truncation; marks read optimistically); navigation only via explicit "Open →" chip; pending Yes/No questions always fully expanded. Backend `/action` response now carries **`result_message`** (real outcome: "Logged a 5,000 TRY payment…") — UI shows it instead of a canned line; `mizan-data-changed` dispatched on yes.
- [x] Panel: 380px, unread pill, per-type left accent bar (danger/warn/teal), localized relative timestamps (`notifications.minAgo` etc.), warm empty state, design tokens (no raw red-950/amber-950).

### Phase 117 — Monetization/gating audit (2026-07-07)
- [x] **Copy honesty**: Plus feature "Recurring payment tracking" → "Automatic recurring detection on every statement" (the /recurring engine itself is ungated; Plus buys unlimited statements that keep it current).
- [x] **Weekly brief email now paid-gated** in `run_email_briefs` (was sent to free users despite being sold under Plus) + never to deleted accounts.
- [x] **Vision upsell moments (honest, shown at the pain)**: upload page — free user's scanned/OCR-failed file gets "Plus reads scanned PDFs with AI vision" link; review page — free user with garbled-OCR rows gets a banner tied to the rows they can SEE. Recurring page free-tier footer nudge. Reports/Simulator already had UpgradePrompt on 403.

### Phase 118 — Progress slim + Simulator surfacing (2026-07-07)
- [x] **Progress page cut**: AlertsPanel (present-moment noise; duplicated notifications/recurring) + PersonalityCard (LLM gimmick, no action) REMOVED (8.6→6.4kB). Page = verdict → pillars → trajectory → drivers → milestones → streaks/goals → **SimulatorBridge** (the only outbound push: "test your next move").
- [x] **Simulator discovery**: SimulatorBridge on Progress is the discovery path. (Was briefly promoted to the main nav, then REVERTED same session — 5-item nav stays uncrowded: Home · Money · Net Worth · Reports · Progress; Simulator lives in the avatar dropdown + mobile menu.) Free users hitting it see the existing Pro UpgradePrompt.

### Phase 119 — Infra + auth hardening (2026-07-07) [migration 0045]
- [x] **docker-compose**: `restart: unless-stopped` on all 4 services (VPS reboot-safe).
- [x] **Deploy webhook** (`deploy/`): stdlib `webhook.py` on the HOST (127.0.0.1:9000, GitHub HMAC-SHA256 verified, main-only) → `deploy.sh` (git reset --hard origin/main, compose build+up, alembic upgrade; single-flight lock, logs to /var/log/clarifin-deploy.log) + systemd unit + README (nginx /deploy-hook + GitHub webhook setup). **Needs one-time VPS setup.**
- [x] **Forgot password**: `create/decode_password_reset_token` (1h, `typ=password_reset`, **`pwv` bound to current hash** → link dies on password change), `POST /auth/forgot-password` (non-enumerating, 3/h limiter) + `POST /auth/reset-password` (min 8, also sets email_verified); reset email template; login page inline "Forgot?" panel; `/reset-password` page (navbar hidden).
- [x] **Account deletion (GDPR)**: migration **0045** `users.deleted_at`. `POST /auth/delete-account` (password re-entry, best-effort Paddle cancel) → soft-delete + 30d window; login within window → 403 `account_deleted_recoverable` → frontend restore prompt → `POST /auth/restore-account` (creds-verified, logs in). Daily 03:00 UTC **purge job** hard-deletes past-window rows (audit row first). Settings danger zone (password-confirmed). Scheduler `_all_user_ids` now excludes deleted users (no background processing post-deletion).

### Phase 120 — SEO + legal (2026-07-07)
- [x] **Metadata**: metadataBase clarifin.xyz, title template, real description, OG/Twitter cards, **generated `opengraph-image.tsx`** (edge ImageResponse brand card), `robots.ts` (app routes disallowed) + `sitemap.ts` (public pages). **Plausible** script in layout (cookieless, no banner needed).
- [x] **Real ToS/Privacy** (TR+EN): what the service is, not-financial-advice, AI sub-processors named (DeepSeek/OpenAI, no-training note), EU (Germany) hosting, Paddle MoR, Resend+Plausible, 30-day deletion window, GDPR/KVKK rights, support/privacy @clarifin.xyz.

### Phase 121 — Business experience + polish (2026-07-07)
- [x] **Business framing** (account_type=business): NW page "Business Position / Business Assets / Business Liabilities / Client Receivables" (`…Biz` locale-variant pattern + `bt()` helper), upload "Upload Statements & Exports · bank statements, invoice exports, expense reports", report doc title "Business Financial Report". **Clar's LLM persona** gets a business framing block (revenue/expenses/clients, company name injected). Home receivables-first + onboarding business lines already existed (92/101).
- [x] **Email polish**: weekly-brief template accents indigo→teal. **Export filenames** mizan-→clarifin- (localStorage keys unchanged — renaming would log everyone out).

### Phase 122 — Fix batch: CC revert · snapshot staleness · notification language (2026-07-07)
- [x] **Phase 113 fully reverted** (see note there). Credit card = normal liability again.
- [x] **Stale net worth after liability delete FIXED**: live summary recomputes, but TODAY's `NetworthSnapshot` kept the pre-mutation value until next NW-page load / 12h job — snapshot consumers (Progress trajectory latest point, attribution trend) showed the old negative NW. New `_refresh_snapshot()` (best-effort, never fails the mutation) re-upserts the snapshot after ALL 6 asset/liability create/update/delete endpoints.
- [x] **Notification language FIXED**: `POST /notifications/generate-daily` took a client `?lang` defaulting to **"en"** — and since generation dedupes once per UTC day, the Home-page-load English run won the day for Turkish users. Endpoint now ignores client lang and uses `current_user.language`; frontend helper drops the param. All notification text sites already branch on lang; wealth-alert `message_template` is user-authored (fine).
- [x] Navbar: Simulator back in avatar dropdown (main nav = Home · Money · Net Worth · Reports · Progress).

---

## Current Status

**Phases 1–122 complete. Alembic head = 0045. LIVE IN PRODUCTION at https://clarifin.xyz.**
**Since 112 (single 2026-07-07 session): credit-card variable-balance rework (113), onboarding overlay + stock name-search (114), critical bugs — .xls/currency/register-flash/sender (115), notification redesign (116), monetization audit (117), Progress slim + SimulatorBridge (118), infra+auth — restart policies/deploy webhook/forgot password/account deletion + **0045** (119), SEO/OG/Plausible + real legal pages (120), business experience + polish (121), fix batch — CC revert / snapshot staleness / notification lang (122). Pending: automated tests, VPS webhook one-time setup, `alembic upgrade head` (→0045) + `pip install xlrd` on deploy, verify server env `RESEND_FROM_EMAIL`/`FRONTEND_URL=https://clarifin.xyz`.**

### Production (LIVE since 2026-06-28)
- **URL**: https://clarifin.xyz
- **Server**: Contabo VPS **31.220.90.52**, 4 vCPU / 8GB RAM, **Ubuntu 24.04**
- **Stack**: Docker Compose (postgres + redis + backend + frontend) · **Nginx** reverse proxy · **Let's Encrypt** SSL (auto-renew). `alembic upgrade head` (→0044) on cold start.
- **Paddle**: production keys active, webhook `→ /webhooks/paddle`, **4 price IDs** configured (Plus/Pro × monthly/yearly).
- **Resend**: **clarifin.xyz verified** (SPF/DKIM/DMARC) — outbound email to all users.
- **Domain**: clarifin.xyz @ Namecheap, DNS A → 31.220.90.52, SSL active.
- **Env on server**: SECRET_KEY · DATABASE_URL · REDIS_URL · RESEND_API_KEY · DEEPSEEK/OPENAI keys · PADDLE_* (env=production, webhook secret, API key, 4 price IDs) · NEXT_PUBLIC_PADDLE_* (client token, 4 price IDs).

### Design system (Phase 82, established)
- **Light mode default**, dark toggle (Light/Dark/System) in navbar. Token system: `:root` (light) / `[data-theme="dark"]` (dark) channel CSS vars; Tailwind semantic colors.
- Primary action accent: **#176B5B** (teal), hover **#125848** — used as a **literal hex** for primary buttons/active states (the `action`/`brand` tokens lighten in dark; literal keeps it consistent both modes).
- Brand: **#0F5C5E**. Canvas: warm off-white (light) / warm graphite #11100E (dark). Negative: **#B54747** (terracotta) `neg`; destructive: strong red `danger`; positive: green `pos`; caution: `warn`.
- Font: Inter. `tabular-nums` on all financial figures (body-level).
- **⚠ Runtime quirk (untraced)**: solid `bg-<token>` utilities don't always paint at runtime (text/border tokens do). Overlays (modals/dropdowns) + selected-state fills use **explicit theme-resolved inline colors** (`useTheme` → hex) as the mitigation. Fix the bg-token CSS layer later.

### Pricing (current — billing LIVE via Paddle, Phase 106)
- **Free**: ₺0 / $0 — manual entry, 1 AI-processed statement/month, 3 assistant msgs/day, vision disabled.
- **Plus**: **₺249/ay · ₺2.090/yıl** / **$9/mo · $79/yr** — unlimited uploads, brief, categorization, recurring, weekly email, 30 assistant msgs/day.
- **Pro**: **₺449/ay · ₺3.790/yıl** / **$19/mo · $169/yr** — everything + simulator, reports, net-worth guidance, proactive Clar, unlimited assistant.
- **Plan gating**: `is_paid` (plus∪pro) vs `is_pro` (pro-only). `get_pro_user` gates simulator/reports/guidance/proactive-Clar; `get_paid_user` gates uploads/vision/brief. **Paddle checkout live** — webhook sets `plan`/`plan_expires_at`; 4 price IDs (Plus/Pro × monthly/yearly).

### IMPORTANT — Cash flow ↔ net worth bridge (Phase 94 — IMPLEMENTED, needs live testing)
- **Ekstre→varlık: DONE.** `services/statement_bridge.py` detects a statement's closing/account balance (running-balance-column delta detection + direction → current end; header+date-order + labelled-footer fallbacks; PDF/CSV/XLSX) and kind (deposit vs credit_card via structural markers). Propose→confirm via `NetworthSuggestion` (no silent overwrite): deposit→**asset** (bank_account), credit card→**liability** (balance owed). Global, no Turkish hardcoding. Surfaced on Brief (post-review) + Net Worth Smart Suggestions.
- **Ekstre↔varlık auto-match: PARTIAL — needs testing.** When the statement's institution fuzzy-matches an existing deposit asset (≥0.6) → `asset_balance_update` suggestion that SETs the asset's balance to the detected closing balance. Wired end-to-end but **not yet verified on real statements** — test balance detection + matching across banks/formats + edge cases.

### App structure (current)
- **Nav**: Home · Money Flow · Net Değer · İlerleme · Settings (+ currency dropdown, notification bell, global assistant FAB)
- **Money Flow tabs**: Activity (/transactions) · Upcoming (/cashflow) · Recurring (/recurring) — shared MoneyOverview header
- **Progress page** (Phase 54): Financial Health scorecard (0–100, 4 pillars) → annotated trajectory chart → drivers → milestones → goal streaks (+ GoalsPanel) → AlertsPanel → demoted PersonalityCard. Inflation panel GONE.
- **Net Worth page** (Phase 55–56): hero (NW number, currency race fixed) → **GuidancePanel** (rule-engine+LLM findings, replaces warning banners) → **AllocationChart** donut + currency bars → asset/liability/receivable sections (readable cards, no raw JSON) → Action Queue. History chart REMOVED. Price freshness = `Güncellendi HH:MM` badge (no refresh button); scheduler refreshes 12h.
- **Upload** (Phase 57): `/upload` returns `{status: success|empty|failed, reason, transaction_count}`. Parser is global (multi-format dates/amounts, currency carry-through, bilingual sign inference). Zero/failed → amber actionable message (never green "0").
- **Display currency**: user-level `User.display_currency`, switched via navbar dropdown, broadcast via `mizan-currency-change`, persisted to prefs
- **Assistant**: one global `GlobalAssistant` (FAB everywhere; accepts `prefill` via open event), 5 structured actions (mark_receivable_received, create_asset, dismiss_reconciliation_item, categorize_transaction, add_liability), confirms → `mizan-data-changed` → all data pages refresh
- **Schedulers** (APScheduler, in-process): reconciliation 6h, daily notifications 09:00 UTC, price refresh 12h

### Known deferred (post-57)
- `_generate_networth_suggestions` (upload.py) still has Turkish-hardcoded bank keywords + Turkish reason text — last Turkish-hardcoding thread to pull for full global readiness.
- **Account connectivity** (Plaid/TrueLayer/SaltEdge) — DEFERRED. Regional/paid/heavy + clashes with global no-hardcoded-bank design. Chose global manual-first activation instead (Phase 57). The decay-vs-spreadsheet problem this would solve is the long-term moat.
- CSV with **unquoted** comma-thousands amounts (`1,234.56` as bare cells) splits the description oddly — amount/sign still correct; most real CSVs quote such fields.
- **Scorecard shows a synthetic ~57** built from neutral pillar defaults when data is thin — looks authoritative but isn't real. Consider gating the headline number until ≥2 pillars have real `status:ok`.
- **Real historical snapshots need time to accumulate** — NW trajectory + Progress trajectory are *estimated* (cash-flow reconstruction) until ~2+ days of real daily snapshots exist; clearly badged.
- **P1-deep**: full `quantity`/`unit_code`/`manual_value` canonical valuation migration (LOW — crypto precision already fixed by Numeric(28,8)).
- **P2-reconciliation**: link transactions↔accounts. Wait for real multi-account usage.
- Assistant-created assets write `source_detail={created_by:assistant}` w/o subtype → don't auto-reprice (minor).
- `POST /networth/analyze` backend endpoint unused; harmless, remove later.

Full stack: register/login → JWT → upload (rate-limited, busts caches) → 3-layer OCR → LLM extract → OCR cleanup → dedup → zero-amount filter → persist → LLM categorize (13 categories) → insight cache → globalized LLM coach with corrections+notes injected → spending chart + progress page (LineChart 3-month trend + cross-batch-deduped category comparison + LLM one-liners, 24h cached) → PersonalityCard (5 types, cached per batch) → AlertsPanel (3 algorithmic detectors, dismiss persisted, stale dismissals auto-cleaned) → GoalsPanel (monthly budget vs actual) → ChatPanel (globalized conversational coaching, behavioral profile memory, voice input, chat-based tx entry with confirmation card, sessionStorage prefill from alerts) → weekly email summary (Resend HTML, preferences toggle) → inflation-adjusted analysis (TUFE 2023-2026, real vs nominal per category, ProgressInsight cache) → net worth asset subtype capture (all asset types have specific fields; crypto/fiat/commodity live picker; gold unit picker; stock/fund code fields; manual categories store structured metadata in `Asset.source_detail` JSON) → net worth display currency searchable via live `CurrencySelect` → receivable collection creates linked cash asset, repeated collection is idempotent, delete/write-off removes linked asset → stale received receivables and processed suggestions are hidden/cleaned after 30 days → onboarding accepts any institution/export source instead of hardcoded Turkish banks → financial event log + reconciliation item backend skeleton exists → net worth page shows Action Queue with open reconciliation items and recent financial events → reconciliation producers (overdue receivables, missing receivable assets, cross-batch duplicate detection) → Action Queue real action handlers per issue_type → net worth history AreaChart (daily USD snapshots, converted to display currency) → asset allocation donut PieChart (5 groups, click to highlight) → proactive threshold alerts (WealthAlert model, asset_price_drop / net_worth_drop / payment_coverage_risk, bell icon on auto-priced asset cards, triggered alerts banner).

### Migrations (head = 0045)
| Migration | What |
|---|---|
| 0001 | CREATE users + transactions |
| 0002 | ADD upload_batch_id to transactions |
| 0003 | ADD password_hash to users |
| 0004 | CREATE upload_insights |
| 0005 | CREATE transaction_notes |
| 0006 | CREATE user_corrections |
| 0007 | CREATE progress_insights |
| 0008 | CREATE budget_goals |
| 0009 | CREATE conversation_messages |
| 0010 | CREATE behavioral_profiles |
| 0011 | ADD personality_cache + personality_batch_id to behavioral_profiles |
| 0012 | CREATE dismissed_alerts |
| 0013 | ADD email_weekly_enabled (bool, default true) to users |
| 0014 | CREATE subscription_flags |
| 0015 | ADD onboarding_completed (bool, default false) to users |
| 0016 | CREATE assets |
| 0017 | CREATE liabilities |
| 0018 | CREATE receivables |
| 0019 | ADD source, source_detail, as_of_date to assets |
| 0020 | CREATE networth_suggestions |
| 0021 | ADD linked_asset_id to receivables |
| 0022 | CREATE financial_events + reconciliation_items |
| 0023 | ADD language to users |
| 0024 | CREATE networth_snapshots |
| 0025 | CREATE wealth_alerts |
| 0026 | CREATE app_notifications |
| 0027 | CREATE assistant_actions |
| 0028 | ADD breakdown_json to networth_snapshots |
| 0029 | ADD display_currency to users |
| 0030 | ADD currency to transactions |
| 0031 | assets current_value→Numeric(28,8) + quantity + unit_code + account_id; CREATE accounts |
| 0032 | ADD source to transactions (statement_parsed/user_estimate/user_confirmed/user_supplementary/manual) |
| 0033 | ADD last_email_brief_sent to users (weekly money brief cadence) |
| 0034 | ADD is_admin to users (founder admin panel gate, server_default false) |
| 0035 | ADD is_deleted to users (soft-delete) + CREATE admin_audit_logs (durable admin-action trail) |
| 0036 | ADD email_verified (grandfathered true) + plan (free/plus/pro) + plan_expires_at to users |
| 0037 | ADD full_name + country + marketing_consent + tos_accepted_at + tos_version + primary_goal to users (registration profile + consent) |
| 0038 | ADD source_detail (JSON) to networth_suggestions (statement bridge payload) |
| 0039 | ADD reminder_days to liabilities (payment-reminder lead time, default 7) |
| 0040 | ADD end_date to liabilities (recurring payoff bound) |
| 0041 | ADD action_type + action_data + action_state to app_notifications (proactive Mim actions) |
| 0042 | ADD account_type + company_name + industry + team_size + phone + timezone to users |
| 0043 | ALTER assets.source_detail String(500) → Text (price metadata + subtype JSON outgrew 500) |
| 0044 | ADD paddle_subscription_id + paddle_customer_id to users (Paddle billing) |
| 0045 | ADD deleted_at to users (GDPR 30-day deletion window + daily purge job) |

### Known Issues (open)
- **PDF extraction not perfect** — scanned/image PDFs hit inherent OCR limits. Vision LLM (gpt-4o-mini, Phase 59) + strip tiling fixed column/sign/format errors and gets income exact on the Ziraat scan, but residual amount/count drift remains = pixel-level digit misreads on poor scans. gpt-4o is more accurate (swap `_VISION_MODEL`) at ~10x cost.
- **XLSX income 57k vs expected ~47k** — real Ziraat xlsx (Phase 60) extracts 43 tx but income reads ~57k vs ~47k expected; likely some transfers double-counted or a credit/debit sign edge. Reconcile against the statement footer (Borç/Alacak) next. (Synthetic test file is exact; real file drifts.)
- **Home cash flow shows only current calendar month**, not the full uploaded statement period — a multi-month statement upload only surfaces the current month in the Cash Flow Pulse. Consider period-aware aggregation.
- **History chart needs data** — `NetworthSnapshot` only populates on page load; <2 snapshots shows placeholder. Will self-populate after 2 visits.
- **Asset allocation donut placement** — floats above AI insight, feels disconnected. Consider moving to collapsible sidebar or secondary tab.
- **Wealth alert bell depends on refresh-prices** — `last_price_usd` in `source_detail` only exists after `POST /networth/assets/refresh-prices`. Alert check silently skips assets with no price data.
- **Proactive scheduled alerts** — wealth alerts only check on page load. Redis + cron needed for push notifications.
- **Layer 3 vision LLM**: stub ready in pdf_parser.py, not wired. Needed for banks with fonts <8pt.
- **Rate limiter in-memory**: resets on backend restart. Redis needed for prod multi-process deploy.
- **Resend domain**: `noreply@mizan.app` hardcoded in api/email.py — must be verified Resend domain in prod.
- **Migration drift in dev**: `create_all` adds base schema before Alembic can stamp. 0024+0025 idempotent. Run `alembic upgrade head` after any new migration.
- **TUFE rates 2025-2026**: approximate. Users see disclaimer.
- **Frontend lint missing config**: `npm run lint` opens ESLint wizard. Build type-checks fine.
- **Dependency risk**: Next 14.2.0 security issue; Recharts deprecated; npm audit 1 moderate + 1 critical.
- **i18n coverage incomplete**: some components still have hardcoded TR strings.

### Phase 7 — Chat Interface + Behavioral Vector (2026-06-18)
- [x] `backend/app/models/transaction_note.py` — TransactionNote table: id UUID, transaction_id FK CASCADE, user_id FK CASCADE, note_text Text, created_at tz-aware
- [x] `backend/app/models/user_correction.py` — UserCorrection table: id UUID, transaction_id FK CASCADE, user_id FK CASCADE, old_category nullable, new_category, created_at tz-aware
- [x] `backend/alembic/versions/0005_create_transaction_notes.py` — chains 0004→0005, has downgrade
- [x] `backend/alembic/versions/0006_create_user_corrections.py` — chains 0005→0006, has downgrade
- [x] `backend/app/api/notes.py` — POST /transactions/{id}/notes (201), GET /transactions/{id}/notes; ownership check via transaction FK; busts insight cache on POST
- [x] `backend/app/api/corrections.py` — PATCH /transactions/{id}/category; VALID_CATEGORIES set (13); no-op if same→same; writes UserCorrection row + updates transaction; busts insight cache
- [x] `backend/app/services/transaction_service.py` — `bust_insight_cache(user_id, session)` deletes UploadInsight row for user's latest batch; called by notes + corrections
- [x] `backend/app/services/coach.py` — `generate_insight()` accepts optional `user_id` + `session`; `_fetch_corrections_context()` top-5 correction pairs (Counter); `_fetch_notes_context()` last-10 notes for visible transactions; both injected into coach prompt
- [x] `backend/app/api/insights.py` — passes `user_id` + `session` to `generate_insight()`
- [x] `backend/app/main.py` — notes_router + corrections_router registered; TransactionNote + UserCorrection imported for create_all
- [x] `frontend/src/lib/api.ts` — `addNote()`, `getNotes()`, `correctCategory()`; `NoteResponse` + `CategoryPatchResponse` types; `extractErrorMessage()` helper normalizes string/array Pydantic detail field
- [x] `frontend/src/components/NoteInput.tsx` — textarea + Kaydet button; Enter to submit; disabled when empty; optimistic note list display
- [x] `frontend/src/components/TransactionTable.tsx` — click-to-expand rows; inline category chip picker (13 categories, current highlighted); NoteInput per row; `onCategoryCorrection` callback prop lifts correction to parent
- [x] `frontend/src/app/transactions/page.tsx` — `handleCategoryCorrection` updates `transactions` state → SpendingChart re-renders with corrected category instantly
- [x] `frontend/src/app/login/page.tsx` — error display uses `extractErrorMessage` via api.ts throw; no longer shows "[object Object]" for Pydantic validation arrays

### Phase 6 — Insight Cache + Rate Limiting (2026-06-18)
- [x] `backend/app/core/rate_limiter.py` — `RateLimiter` sliding-window, thread-safe (Lock); singletons: `insight_limiter` (10/hr/user), `upload_user_limiter` (5/day/user), `upload_ip_limiter` (3/10min/IP)
- [x] `backend/app/models/upload_insight.py` — `UploadInsight` table: id UUID, user_id FK CASCADE, upload_batch_id String(36) unique, insight_text Text, generated_at tz-aware
- [x] `backend/alembic/versions/0004_create_upload_insights.py` — CREATE TABLE + 2 indexes, chains 0003→0004, has downgrade
- [x] `backend/app/services/transaction_service.py` — `get_latest_batch_id()` extracts cache key without fetching rows
- [x] `backend/app/api/insights.py` — rate-check first (429); cache lookup by batch_id; 24h TTL; LLM only on miss/expiry; upsert (delete stale + insert); `cached: bool` in response
- [x] `backend/app/api/upload.py` — rate-check: 5/day per user_id + 3/10min per client IP; both 429 before file work
- [x] `backend/app/main.py` — `UploadInsight` imported for create_all
- [x] `frontend/src/lib/api.ts` — `InsightResponse.cached: boolean`

### Phase 5 — OCR Post-Processing + Parser Fixes (2026-06-18)
- [x] `pdf_parser.py` `_filter_zero_amount()` — removes abs(amount)<0.01 after dedup; logs "Filtered N zero-amount artifact(s)"
- [x] `pdf_parser.py` `_needs_cleaning()` — True on 3+ consecutive consonants (`_CONSONANT_RUN_RE`) OR non-Turkish chars (`_NON_TR_CHAR_RE`)
- [x] `pdf_parser.py` `_ocr_postprocess_descriptions()` — Layer 2 only; skip if no LLM key or nothing needs cleaning; one batch call; silent on failure; logs "OCR post-processing: cleaned X of Y descriptions"
- [x] `categorizer.py` — 13 categories: added `iade`, `vergi`, `teknoloji`; prompt priority-ordered: teknoloji (cloud/SaaS + Yurt Dışı Sanal POS) → vergi (Kambiyo/BSMV) → iade (İade/Refund/İPTAL) → transfer (Havale/FAST) → nakit_atm (ATM)
- [x] `CategoryBadge.tsx` — teal/red/blue for iade/vergi/teknoloji
- [x] `SpendingChart.tsx` — matching chart colors; removed unused egitim entry
- [x] `security.py` — passlib removed; direct `bcrypt.hashpw/checkpw`; `[:72]` enforces max input length
- [x] `requirements.txt` — passlib dropped; `bcrypt==4.0.1` + `email-validator==2.1.0` added

### Phase 4 — JWT Auth + Frontend Auth Flow (2026-06-18)
- [x] `backend/app/core/config.py` — `SECRET_KEY`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`
- [x] `backend/app/core/security.py` — `hash_password`, `verify_password`, `create_access_token`, `decode_access_token`
- [x] `backend/app/models/user.py` — `password_hash: String(255) nullable=True`
- [x] `backend/alembic/versions/0003_add_password_hash_to_users.py` — ADD COLUMN, chains 0002→0003
- [x] `backend/app/api/auth.py` — POST /auth/register (409 dup email, 422 short pw), POST /auth/login (401 anti-enum — same error for bad email and bad pw)
- [x] `backend/app/core/dependencies.py` — `get_current_user(Bearer → User ORM row)`
- [x] `backend/app/main.py` — auth router; `_seed_dev_user()` removed
- [x] All endpoints — `DEV_SEED_USER_ID` / `user_id` query param → `Depends(get_current_user)`
- [x] `frontend/src/lib/api.ts` — token store, `register()`, `login()`, `authHeaders()`; api funcs no longer take userId
- [x] `frontend/src/app/login/page.tsx` — register/login toggle; JWT → localStorage on success; redirect /transactions
- [x] `frontend/src/app/page.tsx` — auth-aware nav: logged-in shows "Devam Et"→/transactions + email chip + "İşlemlerim"; logged-out shows "Başla"→/login; localStorage read in useEffect (hydration safe)
- [x] `frontend/src/app/transactions/page.tsx` — redirect /login if no token; useEffect-gated localStorage (hydration fix); logout button; SpendingChart
- [x] `frontend/src/app/upload/page.tsx` — redirect /login if no token; Bearer token in upload
- [x] `frontend/package.json` — `recharts ^2.12.0`
- [x] `frontend/src/components/SpendingChart.tsx` — debit-only bar chart, per-category colors, Turkish ₺ locale
- [x] `.env.example` — `SECRET_KEY` placeholder

### Phase 9 — Batch Transparency + Progress Dedup + Progress Cache (2026-06-18)

#### Batch transparency — transactions page
- [x] `backend/app/api/transactions.py` — `GET /transactions/batches`: returns list of `BatchSummaryResponse` (batch_id, uploaded_at, transaction_count, min_date, max_date) ordered newest-first; declared before `GET /` to avoid route shadow
- [x] `backend/app/services/transaction_service.py` — `get_batch_summaries(user_id, session)`: aggregates per-batch metadata in Python from Transaction rows; O(transactions) scan, O(batches) return
- [x] `frontend/src/lib/api.ts` — `getBatches()` + `BatchSummary` type; `getTransactions(all=false)` param adds `?all=true` when showAll=true
- [x] `frontend/src/app/transactions/page.tsx` — separate `useEffect` re-fetches transactions when `showAll` toggles; batch indicator pill shows date range + count; "Son Ekstre"/"Tüm Ekstreler" toggle group (indigo active); "Geçmiş" button (visible only when batches > 1) expands batch history list showing uploaded_at + date range + count per batch; "Son" badge on newest

#### Progress dedup — cross-batch duplicate removal
- [x] `backend/app/services/transaction_service.py` — `dedup_transactions_orm(transactions)`: same (transaction_date, amount, description[:30]) key as `pdf_parser._deduplicate()`; operates on ORM objects not RawTransaction; logs removed count at INFO
- [x] `backend/app/api/progress.py` — `_aggregate_by_month()` calls `dedup_transactions_orm()` before grouping; returns `(months_dict, deduplicated_transactions)` tuple so endpoints get deduped count for context stats
- [x] `frontend/src/app/progress/page.tsx` — context header shows batch_count + total_transactions (deduped) + date range; "çakışan işlemler tekilleştirildi" note appears when batch_count > 1; single-month guard: "Karşılaştırma için en az 2 ay verisi gerekli — şu an sadece 1 ay görünüyor." instead of blank chart

#### Progress cache — 24h cache for both endpoints
- [x] `backend/app/models/progress_insight.py` — `ProgressInsight` table: id UUID, user_id FK CASCADE, data_type VARCHAR(20) ("progress"|"comparison"), cache_key VARCHAR(64), data Text (JSON), generated_at tz-aware; UNIQUE(user_id, data_type) — each endpoint owns its own row, no column-sharing race
- [x] `backend/alembic/versions/0007_create_progress_insights.py` — CREATE TABLE + unique constraint + user_id index, chains 0006→0007, has downgrade
- [x] `backend/app/api/progress.py` — `_cache_key(user_id, batch_ids)`: SHA-256(user_id + "|" + sorted batch_ids joined); `_cache_get()`: SELECT by user_id+data_type, checks key match + TTL, returns JSON string or None; `_cache_set()`: pg_insert().on_conflict_do_update(constraint="uq_progress_insights_user_type") — safe for concurrent requests (last writer wins, both have identical data); both endpoints check cache before compute, return `cached: bool` in response
- [x] `backend/app/services/transaction_service.py` — `bust_progress_cache(user_id, session)`: DELETE WHERE user_id = ?; deletes both progress + comparison rows
- [x] `backend/app/api/corrections.py` — calls `bust_progress_cache` after `bust_insight_cache`; category change invalidates both coaching insight and comparison chart
- [x] `backend/app/api/upload.py` — calls `bust_progress_cache` before commit; new upload clears stale comparison data immediately (cache key would auto-miss anyway, but eager bust is explicit)
- [x] `backend/app/main.py` — ProgressInsight imported for create_all
- [x] `frontend/src/lib/api.ts` — `ProgressResponse.cached: boolean`; `ComparisonResponse.cached: boolean`
- [x] `frontend/src/app/progress/page.tsx` — "önbellekten" label shown in context header when progress.cached=true
- **Measured speedup**: /insights/comparison 11.8s → 0.08s on cache hit (148x); 7 LLM calls per comparison = most expensive endpoint

#### Bug fixes in this session
- [x] `TransactionTable.tsx` — `<>` fragment → `<Fragment key={t.id}>` fixes React missing-key warning; key was on inner `<tr>` not the fragment
- [x] `frontend/src/app/login/page.tsx` — register 422 showed "[object Object]"; fixed by `extractErrorMessage()` in api.ts that unwraps Pydantic validation array `detail[0].msg`
- [x] `frontend/src/app/transactions/page.tsx` — SpendingChart was stale after inline category correction; fixed by lifting `transactions` state and passing `onCategoryCorrection` callback from TransactionTable → parent updates state → chart re-renders
- [x] `frontend/src/components/TransactionTable.tsx` — notes not shown on page reload; fixed by fetching `GET /transactions/{id}/notes` on first row expand, gated by `notesLoaded: boolean` in RowState

### Phase 8 — Month-over-Month Progress Tracking (2026-06-18)
- [x] `backend/app/api/progress.py` — GET /insights/progress (3 months of totals, Python-side aggregation, no date_trunc); GET /insights/comparison (this vs last month per category, LLM one-liner per category); both JWT-protected; router prefix="/insights"
- [x] `backend/app/main.py` — progress_router registered
- [x] `frontend/src/lib/api.ts` — `getProgress()`, `getComparison()`; `MonthlyTotal`, `ProgressResponse`, `CategoryTrend`, `ComparisonResponse` types
- [x] `frontend/src/app/progress/page.tsx` — auth-guarded; recharts LineChart (Harcama red, Gelir green, 3-month x-axis with Turkish month labels); category comparison table (Kategori/Geçen Ay/Bu Ay/Değişim with ↑↓ color coding); LLM insight cards per category; empty state when <2 months data
- [x] `frontend/src/app/transactions/page.tsx` — "İlerleme" nav link added
- [x] `frontend/src/lib/categories.ts` — single source of truth for category display names (Turkish) and hex colors; imported by CategoryBadge, SpendingChart, TransactionTable, progress page
- [x] Turkish category display names fixed across all UI: CategoryBadge, SpendingChart XAxis, TransactionTable correction picker, progress comparison table
- [x] Rate-limited category correction (20/hr, correction_limiter singleton); GET /transactions/{id}/notes fetched on first row expand (notes persist across refresh)

---

### Phase 20 — UI/UX Design System Overhaul (2026-06-21)

#### Design system foundation
- [x] `frontend/src/lib/design.ts` — token constants: `card`, `cardSm`, `btnPrimary`, `btnSecondary` Tailwind class strings; `#0F0F0F` page bg / `#1A1A1A` cards / `#2A2A2A` borders / `#6366F1` accent
- [x] `frontend/src/components/ui/Icons.tsx` — inline SVG icon library (no new dependency); exports: BarChart2, CreditCard, Layers, Upload, LogOut, Brain, Target, RefreshCw, TrendingUp, ShieldCheck, FileText, MessageSquare, Menu, X, ChevronDown, ChevronUp, Bell, Mail, Plus, Mic, Send, Zap, PieChart, ArrowRight; each accepts `size`, `className`, `strokeWidth` props
- [x] `frontend/src/app/globals.css` — `body { background-color: #0F0F0F; color: #fff }` + custom thin scrollbar
- [x] `frontend/src/app/layout.tsx` — Navbar imported + rendered once at root; no wrapper div (PageLayout handles `mt-14` offset per-page)

#### Global Navbar
- [x] `frontend/src/components/ui/Navbar.tsx` — fixed top (`fixed top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-[#2A2A2A]`); logo "Mizan" → /transactions; nav links: İşlemler/İlerleme/Abonelikler/Taksitler with Icons; right: email chip + "Yükle" button + LogOut button; mobile: hamburger (Menu/X toggle) with dropdown overlay; hidden when `pathname ∈ ["/login", "/onboarding"]` OR `!userEmail`; re-reads localStorage on every pathname change (hydration safe)
- [x] `frontend/src/components/ui/PageLayout.tsx` — wrapper: max-width centering + `mt-14` for navbar offset; props: `title`, `titleBadge` (React.ReactNode inline next to h1 in flex row), `subtitle`, `action`, `maxWidth` (sm/md/lg/xl); all app pages converted to use this

#### Landing page rewrite (`frontend/src/app/page.tsx`)
- [x] Full marketing page: auth-aware nav, hero with gradient headline (`bg-clip-text text-transparent`), smooth-scroll "Nasıl Çalışır" 3-step grid with SVG icons + numbered badge, feature cards with `hover:border-indigo-800/60`, bank logos section (Ziraat/VakıfBank/Yapı Kredi/Garanti), bottom CTA with indigo glow overlay, footer; health check call removed (unnecessary on marketing page)

#### All app pages — design token migration
- [x] `frontend/src/app/transactions/page.tsx` — PageLayout; `titleBadge` = transaction count pill (`bg-[#2A2A2A] text-gray-400 rounded-full`); "+ Ekle" renamed "Manuel Ekle", outlined style (`border border-[#2A2A2A]`); email toggle card (see below); batch selector polished (see below); all old scattered nav links removed
- [x] `frontend/src/app/progress/page.tsx` — PageLayout; chart `CartesianGrid stroke="#2A2A2A"`, tooltip `backgroundColor:"#1A1A1A" border:"1px solid #2A2A2A"`; all cards `bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6`
- [x] `frontend/src/app/subscriptions/page.tsx` — PageLayout; `FLAG_ACTIVE`/`FLAG_IDLE` record maps for per-state colors; hero + active + review + cancelled sections
- [x] `frontend/src/app/installments/page.tsx` — PageLayout; ChevronDown/Up for early-payoff collapsible; progress bar track `bg-[#2A2A2A]`
- [x] `frontend/src/app/upload/page.tsx` — PageLayout `maxWidth="sm"`; FileText icon in drop zone; ArrowRight in success link
- [x] `frontend/src/app/onboarding/page.tsx` — full-screen standalone (no Navbar/PageLayout); progress bar `h-0.5 bg-[#2A2A2A]` + indigo fill; FileText icon in upload zone
- [x] `frontend/src/app/login/page.tsx` — `bg-[#0F0F0F]`, inputs `bg-[#1A1A1A] border-[#2A2A2A]`, spinner on loading

#### Component rewrites — design tokens
- [x] `frontend/src/components/CategoryBadge.tsx` — `rounded-full` pill with colored dot (`w-1.5 h-1.5 rounded-full`); `inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-0.5`; all 13 category color schemes updated to dark-950 bg + 300 text + 400 dot
- [x] `frontend/src/components/NoteInput.tsx` — `MAX_CHARS=300`; remaining counter (`text-amber-500` when <50); note list `bg-[#0F0F0F] border border-[#2A2A2A]`; `timeAgo()` helper; textarea `focus:border-indigo-600`
- [x] `frontend/src/components/AlertsPanel.tsx` — `border-l-2` accent per alert type; `bg-[#1A1A1A] border border-[#2A2A2A]` cards
- [x] `frontend/src/components/PersonalityCard.tsx` — left-border accent; type-specific emoji + colored dot badge
- [x] `frontend/src/components/InflationPanel.tsx` — `bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl`; table `border-b border-[#2A2A2A]`, alternating `bg-[#0F0F0F]/40`
- [x] `frontend/src/components/GoalsPanel.tsx` — progress bar track `bg-[#2A2A2A]`; form inputs `bg-[#0F0F0F] border border-[#2A2A2A]`
- [x] `frontend/src/components/AddTransactionModal.tsx` — modal `bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl`; backdrop `bg-black/70 backdrop-blur-sm`; X icon from Icons.tsx
- [x] `frontend/src/components/SpendingChart.tsx` — tooltip `backgroundColor:"#1A1A1A" border:"1px solid #2A2A2A"`

#### TransactionTable polish
- [x] `frontend/src/components/TransactionTable.tsx` — full rewrite: inline `ChevronIcon` SVG with `rotate-180` animate; alternating rows (`bg-[#111]`/`bg-[#0F0F0F]` by index); `title={t.description}` hover tooltip + `max-w-0` truncate; amount `text-sm font-semibold tabular-nums`; date `text-xs text-gray-500`; chevron indigo when expanded; expanded panel: "İşlem Detayı" header + full desc + right-aligned amount; category chips horizontal-scroll `overflow-x-auto`, `rounded-full`, `shrink-0`; NoteInput with character count

#### Email toggle card (`frontend/src/app/transactions/page.tsx`)
- [x] `EmailToggle` component inline in page: replaces icon-only 📧 button; label "Haftalık Özet E-postası" + subtitle "Her Pazartesi gelen kutunuza"; sliding toggle switch (`w-10 h-5 rounded-full`, thumb translates `translate-x-5`); "Açık" indigo / "Kapalı" gray text; loads only after `getEmailPreferences()` resolves (no flash)

#### Batch selector polish (`frontend/src/app/transactions/page.tsx`)
- [x] Pill toggle group: `rounded-full overflow-hidden border border-[#2A2A2A]`; "Son Ekstre"/"Tüm Ekstreler" segments with indigo active; calendar SVG icon on info side; "Geçmiş" rounded-pill button; batch history rows with "Son" indigo badge; all in `bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl` card

#### ChatPanel improvements (`frontend/src/components/ChatPanel.tsx`)
- [x] Header: "KOÇ" → "Finansal Koç" with inline brain SVG icon in indigo-400
- [x] Message timestamps: `Message` interface gains `sentAt?: string` (ISO); history messages use `created_at` from API; new messages use `new Date().toISOString()`; renders `HH:MM` in `text-[10px] text-gray-700` below each bubble
- [x] Bubble layout: `flex-col gap-0.5 items-end/items-start` so timestamp aligns under bubble

#### Architectural note — no lucide-react dependency
- User asked for Lucide icons but lucide-react was not installed in Docker node_modules + constraint "no new dependencies". Solution: `Icons.tsx` with hand-written inline SVG components matching Lucide's visual style. API identical: `<Upload size={16} className="..." />`.

#### Bug fix — navbar offset
- `pt-14` wrapper div in layout.tsx broke full-screen landing/login/onboarding pages. Fixed: removed wrapper, `mt-14` lives inside PageLayout only → full-screen pages manage their own top offset.

### Phase 19 — Installment (Taksit) Analysis (2026-06-21)
- [x] `backend/app/services/installment.py` — `detect_installments(transactions)`: two detection paths. **Path A (explicit)**: `_TAKSIT_RE` regex catches "TAKSİT X/Y", "X/Y TAKSİT", bare "3/12" in description; `_merchant_key_for_explicit()` strips the installment number before keying so "APPLE STORE TAKSİT 1/12" + "2/12" + "3/12" all merge to one plan; tracks current_installment from most recent tx, remaining = total − current. **Path B (implicit)**: same merchant (desc[:30].lower()), ±2% amount variance (tighter than subscriptions), consecutive months with no gap >1, ≥3 months → estimated_remaining = 12 − months_detected. Explicit keys excluded from implicit scan. `calculate_real_cost(monthly, remaining)`: FV annuity formula at 40% annual / 12 monthly (TCMB 2024 era); returns nominal, opportunity_loss, real_cost_with_opportunity. `analyze_user_installments(user_id, session)`: fetches all_batches tx → detect_installments → log count.
- [x] `backend/app/api/installments.py` — `GET /installments`: same 24h cache pattern as inflation.py; reuses `ProgressInsight` table with `data_type="installments"` (no new migration); single LLM call for one-liner insight (silent on failure); returns `InstallmentResponse(plans, insight, cached)`. `GET /installments/summary`: total_monthly_burden, active_plan_count, months_until_debt_free (max remaining across plans), total_remaining_nominal, total_opportunity_loss, income_pct (estimated from last 90d credit txs / 3, None if no credits).
- [x] `backend/app/main.py` — `installments_router` registered at `/installments`.
- [x] `frontend/src/lib/api.ts` — `InstallmentPlan`, `InstallmentResponse`, `InstallmentSummary` interfaces; `getInstallments()`, `getInstallmentSummary()` functions.
- [x] `frontend/src/app/installments/page.tsx` — hero: monthly burden + "X ay sonra taksit yükünden kurtuluyorsunuz" tile + income % badge (red if >30%) + opportunity cost summary line; LLM insight card; cards per plan: merchant + category badge + "Ekstre'den" badge for explicit source + progress bar (X/total ödendi) + paid/remaining/real-cost stats grid; "Erken ödeyebilirim ▼" collapsible showing nominal remaining, opportunity loss, total gain; "Tamamlandı ✓" label when remaining=0; empty state explains detection threshold; TUFE/rate disclaimer.
- [x] "Taksitler" nav link added to `transactions/page.tsx` and `progress/page.tsx`; "Taksitler" + "Abonelikler" also appear in `installments/page.tsx` header nav.

### Phase 18 — Landing Page + Onboarding Flow (2026-06-21)
- [x] `backend/app/models/user.py` — added `onboarding_completed: Mapped[bool]` (Boolean, nullable=False, default=False, server_default=text("false"))
- [x] `backend/alembic/versions/0015_add_onboarding_completed_to_users.py` — ADD COLUMN, chains 0014→0015, has downgrade; ran cleanly (ALTER TABLE, not CREATE TABLE — no create_all conflict)
- [x] `backend/app/api/auth.py` — `TokenResponse` gains `onboarding_completed: bool = False`; register + login both return field from user row; new `POST /auth/complete-onboarding` (JWT-protected, sets flag, commits, returns `{"onboarding_completed":true}`)
- [x] `frontend/src/lib/api.ts` — `TokenResponse.onboarding_completed: boolean`; `StoredUser.onboarding_completed: boolean`; new `completeOnboarding()` function
- [x] `frontend/src/app/login/page.tsx` — after auth: register always → `/onboarding`; login → `/onboarding` if `!onboarding_completed`, else `/transactions`; stores `onboarding_completed` in localStorage via `setStoredUser`
- [x] `frontend/src/app/page.tsx` — full marketing rewrite: nav (auth-aware), hero ("Paranız nereye gidiyor?"), smooth-scroll "Nasıl Çalışır" (3 steps), features grid (6 cards), bank logos section (Ziraat/VakıfBank/Yapı Kredi/Garanti), bottom CTA, footer; no health check call on landing (removed — unnecessary network round-trip for marketing page)
- [x] `frontend/src/app/onboarding/page.tsx` — 3-step wizard; progress bar (33/66/100%); Step 1: bank selector (5 options: Ziraat/VakıfBank/Yapı Kredi/Garanti/Diğer); Step 2: bank-specific 5-step instructions (5 banks × 5 steps); Step 3: drag-drop upload zone → success state "X işlem bulundu!" + "Hadi Başlayalım →", or "Şimdi değil, atla" link; both finish/skip call `completeOnboarding()` + update localStorage; auth guard redirects to /login if no token; already-completed guard redirects to /transactions

### Phase 17 — Subscription Management (2026-06-21)
- [x] `backend/app/models/subscription_flag.py` — SubscriptionFlag: id UUID, user_id FK CASCADE indexed, merchant_key String(100), flag String(20) (essential|review|cancelled), flagged_at tz-aware; UNIQUE(user_id, merchant_key) named "uq_subscription_flags_user_merchant"
- [x] `backend/alembic/versions/0014_create_subscription_flags.py` — CREATE TABLE + unique constraint + index, chains 0013→0014; table pre-existed from create_all → stamped 0014 manually
- [x] `backend/app/api/subscriptions.py` — `_detect_subscriptions()`: groups all-history debits by `desc[:30].lower()`, ≥2 distinct months, monthly totals within ±10% of median (looser than patterns.py ±5% — catches more); infers frequency (avg gap <15 days → weekly, else monthly); `_clean_merchant_name()` strips POS ALIŞVERİŞİ/SANAL POS/YURT DIŞI SANAL POS/İNTERNET/MOBİL prefixes; sorts by avg_amount desc. `GET /subscriptions` → detected list with user flag overlaid. `POST /subscriptions/flag` → upsert via ON CONFLICT DO UPDATE (flag can change: essential→review→cancelled). `GET /subscriptions/summary` → total_monthly_cost (weekly subs ×4), count (cancelled excluded), flagged_for_review merchant names, potential_savings
- [x] `backend/app/main.py` — subscriptions_router registered; SubscriptionFlag imported for create_all
- [x] `frontend/src/lib/api.ts` — `SubscriptionItem`, `SubscriptionsResponse`, `SubscriptionSummary` interfaces; `getSubscriptions()`, `flagSubscription()`, `getSubscriptionSummary()` functions
- [x] `frontend/src/app/subscriptions/page.tsx` — hero tile: monthly total (red if >500 TL) + emerald savings badge when review items exist; active subscription cards: merchant + category badge + frequency badge + last seen + months active + total paid + avg amount; 3 flag buttons per card (active state highlighted emerald/amber/red); optimistic toggle with API sync + rollback on failure; "Gözden Geçirilecekler" summary section with savings total; "İptal Edilenler" collapsed list with "Geri al"; empty state with upload link; loading skeletons
- [x] "Abonelikler" nav link added to `transactions/page.tsx` and `progress/page.tsx`

### Phase 16 — Inflation-Adjusted Spending Analysis (2026-06-20)
- [x] `backend/app/services/inflation.py` — `TUFE_RATES` dict: 48 months (2023-01 → 2026-12), monthly % rates; 2025-2026 approximate (TCMB disinflation trajectory); `_DEFAULT_MONTHLY_RATE=2.0` for unknown months. `_cumulative_inflation(month_old, month_new)`: multiplies (1+rate/100) for each month AFTER old through new (inclusive) → returns cumulative %. `calculate_real_change(amount_old, amount_new, month_old, month_new)`: uses exact real-return formula `(1+nominal)/(1+inflation)-1` (not approximate subtraction); returns nominal_change_pct, inflation_between, real_change_pct, verdict. `analyze_user_inflation(user_id, session)`: groups debit tx by (category, month), skips categories with <2 distinct months, compares oldest vs latest month avg, runs calculate_real_change, sorts by real_pct desc (worst first).
- [x] `backend/app/api/inflation.py` — `GET /inflation/analysis`: reuses `ProgressInsight` table with `data_type="inflation"` (no new migration needed; UniqueConstraint `uq_progress_insights_user_type` covers it); same 24h TTL + SHA-256 cache key as progress/comparison; auto-busted by existing `bust_progress_cache()` on upload + category correction; returns `InflationResponse(analyses: list[CategoryInflation], cached: bool)`.
- [x] `backend/app/main.py` — `inflation_router` registered at `/inflation`.
- [x] `frontend/src/lib/api.ts` — `CategoryInflation` + `InflationResponse` interfaces; `getInflationAnalysis()`.
- [x] `frontend/src/components/InflationPanel.tsx` — table: Kategori / Eski Ort. / Yeni Ort. / Nominal / Gerçek / Yorum; 4 verdict tiers: real>20% → red "Enflasyonun çok üzerinde ↑↑", real>0% → orange "Enflasyonun üzerinde ↑", real<-5% → green "Enflasyonun altında ↓", else → gray "Enflasyonla paralel →"; date range per row (oldest→newest month); cumulative TUFE context line; TUFE disclaimer; silent on error/empty (returns null).
- [x] `frontend/src/app/progress/page.tsx` — `<InflationPanel />` inserted between AlertsPanel and GoalsPanel.

### Phase 15 — Weekly Email Summary (2026-06-20)
- [x] `backend/requirements.txt` — `resend==2.0.0` added.
- [x] `backend/app/core/config.py` — `RESEND_API_KEY: str = ""` + status log in `log_api_key_status()`.
- [x] `.env.example` — `RESEND_API_KEY=` placeholder added.
- [x] `backend/app/models/user.py` — `email_weekly_enabled: Mapped[bool]` column; `Boolean, nullable=False, default=True, server_default=text("true")` so existing rows default on.
- [x] `backend/alembic/versions/0013_add_email_weekly_enabled_to_users.py` — ADD COLUMN boolean server_default=true, chains 0012→0013, has downgrade.
- [x] `backend/app/services/weekly_summary.py` — `_CAT_DISPLAY` dict (13 categories → Turkish display names). `generate_summary(user_id, session)`: fetches this-week (Mon→today), last-week (prev Mon→Sun), this-calendar-month txs; computes debit totals + by_category dicts; change_pct; top merchant (desc[:30] by total spend); goal status (compares monthly spend vs BudgetGoal limits, reuses goal_status logic); one synchronous LLM call → 3-sentence Turkish coaching text at temp=0.7. Returns plain dict. `render_email(summary, user_email)`: full inline-CSS HTML email; hero section (total + green/red change badge); category table (this week vs diff from last week); goals as text progress bars `████░░ 67%` + Aşıldı/Uyarı/Yolunda labels; LLM insight card; CTA button; footer with unsubscribe instruction.
- [x] `backend/app/api/email.py` — `GET /email/preferences` (returns `{email_weekly_enabled}`); `POST /email/preferences` (updates User row, commits, returns new state); `POST /email/weekly-preview` (calls generate_summary + render_email, returns `{html}`; no send); `POST /email/weekly-send` (calls both + `asyncio.to_thread(_send)` to avoid blocking event loop; 503 if RESEND_API_KEY missing; 502 on Resend API error; returns `{message, email_id}`). Resend imported inside `_send()` local scope — only loaded when actually sending.
- [x] `backend/app/main.py` — `email_router` registered at `/email`.
- [x] `frontend/src/lib/api.ts` — `EmailPreferences`, `SendEmailResponse` interfaces; `getEmailPreferences()`, `setEmailPreferences(enabled)`, `getWeeklyPreview()`, `sendWeeklySummary()`.
- [x] `frontend/src/app/transactions/page.tsx` — `emailEnabled: boolean | null` state (null=loading/error, hidden); loads via `getEmailPreferences()` on mount; `handleEmailToggle()` optimistic toggle with `setEmailPreferences()`; "📧 E-posta Açık/Kapalı" button in header (indigo bg when enabled, gray when disabled); button hidden until preference loads.

### Phase 14 — Financial Personality Profile + Proactive Pattern Alerts (2026-06-20)

#### Financial personality profile
- [x] `backend/app/models/behavioral_profile.py` — added `personality_cache: Text nullable`, `personality_batch_id: String(36) nullable`; also added missing `String` import
- [x] `backend/alembic/versions/0011_add_personality_cache_to_behavioral_profiles.py` — ADD COLUMN x2 on behavioral_profiles, chains 0010→0011, has downgrade
- [x] `backend/app/services/personality.py` — `PERSONALITY_TYPES` set (5 types: Anlık Karar Verici, Planlı Harcayan, Tasarruf Odaklı, Konfor Odaklı, Dengesiz Harcayan); `_build_analysis_prompt()` = category totals + monthly variance + profile context from behavioral_profile; `_call_llm()` = direct provider.client call (temp=0.4, JSON response, type validated against set); `analyze_personality()` = cache check (personality_batch_id == latest_batch_id) → cache hit return OR LLM generate → write cache → commit
- [x] `backend/app/api/personality.py` — GET /personality; JWT-protected; checks cache before calling analyze_personality to set `cached: bool`; returns PersonalityResponse (type, description, strengths list, watch_out list, tip, cached)
- [x] `backend/app/main.py` — personality_router registered
- [x] `frontend/src/lib/api.ts` — `PersonalityData` interface; `getPersonality()` function
- [x] `frontend/src/components/PersonalityCard.tsx` — 5 type-specific color schemes (orange/emerald/blue/purple/yellow); large type badge; description paragraph; strengths (green ✓) + watch_out (yellow !) two-column grid; tip in blue card; "önbellekten" label when cached; no-op when type = "Henüz Analiz Yok" or error
- [x] `frontend/src/app/progress/page.tsx` — PersonalityCard inserted above AlertsPanel above GoalsPanel

#### Proactive pattern alerts
- [x] `backend/app/models/dismissed_alert.py` — DismissedAlert: id UUID, user_id FK CASCADE indexed, dismiss_key String(100), dismissed_at tz-aware; UNIQUE(user_id, dismiss_key) named "uq_dismissed_alerts_user_key"
- [x] `backend/alembic/versions/0012_create_dismissed_alerts.py` — CREATE TABLE + unique constraint + user_id index, chains 0011→0012, has downgrade
- [x] `backend/app/services/patterns.py` — `Alert` dataclass (type, message, amount Decimal, actionable bool, dismiss_key str); `detect_patterns(transactions)` pure function — no DB, 90-day cutoff, debit-only; `_find_recurring_and_subscriptions()` groups by desc[:30].lower(), ≥2 months, amounts within ±5% of median, ≤500 TL → forgotten_subscription / >500 TL → recurring, capped at 3 alerts; `_find_post_salary_spike()` first-3-days daily avg vs rest-of-month daily avg, ≥50% spike in ≥2 months; constants: SIMILARITY_THRESHOLD=5%, MIN_AMOUNT=10 TL, SUBSCRIPTION_MAX=500 TL, SPIKE_MIN_PCT=50, MAX_RECURRING_ALERTS=3, MIN_MONTHS=2
- [x] `backend/app/api/patterns.py` — GET /patterns/alerts (fetch all_batches tx → detect_patterns → fetch dismissed keys → filter → return list[AlertResponse]); POST /patterns/alerts/dismiss (pg_insert ON CONFLICT DO NOTHING on uq_dismissed_alerts_user_key — idempotent, safe for double-click/retry); 204 on dismiss
- [x] `backend/app/main.py` — patterns_router registered; DismissedAlert imported for create_all
- [x] `frontend/src/lib/api.ts` — `Alert` interface; `getAlerts()`, `dismissAlert(dismissKey)` functions
- [x] `frontend/src/components/AlertsPanel.tsx` — alert cards with type icon (💳/🔄/📈) + type label; "Sohbete sor →" button on actionable alerts → sets `sessionStorage("chat_prefill", message)` + router.push("/transactions"); "Kapat" dismiss button with optimistic removal from state + API call; loading skeleton; silent error (panel stays empty)
- [x] `frontend/src/components/ChatPanel.tsx` — reads `sessionStorage("chat_prefill")` in getChatHistory `.finally()` block; clears from storage; pre-fills textarea; focuses textarea after 50ms delay

### Phase 13 — Chat-Based Transaction Entry + Voice Input (2026-06-20)
- [x] `backend/app/services/behavioral_coach.py` — `detect_transaction_intent(message, provider)`: third lightweight LLM call (temp=0); prompt includes today's date for default; validates amount>0, type debit|credit, category in VALID_CATEGORIES, date ISO format before returning; returns None on any failure; `_INTENT_SYSTEM_PROMPT` format-string with today injected at call time
- [x] `backend/app/api/chat.py` — `PendingTransaction` Pydantic model; `ChatResponse.pending_transaction: PendingTransaction | None = None`; step 9 calls `detect_transaction_intent` after profile extraction, before commit; `PendingTransaction(**pending_tx)` if not None
- [x] `frontend/src/lib/api.ts` — `PendingTransaction` interface; `ChatApiResponse.pending_transaction: PendingTransaction | null`
- [x] `frontend/src/components/AddTransactionModal.tsx` — `InitialValues` interface; `initialValues?: InitialValues` prop; all 5 state fields initialised from `initialValues` with `?? ""` fallback
- [x] `frontend/src/components/ChatPanel.tsx` — `pendingTx` state + `txConfirming/txError` state; confirmation card renders below last assistant message (not sending): shows ₺amount + type + category + description + date; [Evet ekle] calls `createTransaction()` → success appends "✓ İşlem eklendi" assistant bubble; [Düzenle] opens AddTransactionModal pre-populated with pendingTx values; [Hayır] dismisses; voice: `voiceSupported` checked at mount (no SSR); mic button with pulsing red dot while recording; `recognition.lang = 'tr-TR'`; `onresult` fills textarea + schedules `doSend(transcript)` after 1500ms via `voiceTimerRef`; timer cleared on stop; `onend` clears recording state; `doSend(text)` refactored to take text directly (handles both keyboard and voice paths)

### Phase 12 — Conversational Behavioral Coaching with Memory (2026-06-20)
- [x] `backend/app/models/conversation.py` — ConversationMessage: id UUID, user_id FK CASCADE, role String(10), content Text, created_at tz-aware+indexed, context_batch_id String(36) nullable
- [x] `backend/app/models/behavioral_profile.py` — BehavioralProfile: id UUID, user_id UNIQUE FK CASCADE, fixed_expenses/income_sources/spending_patterns Text (JSON), user_notes Text, updated_at nullable
- [x] `backend/alembic/versions/0009_create_conversation_messages.py` — CREATE TABLE + 2 indexes, chains 0008→0009
- [x] `backend/alembic/versions/0010_create_behavioral_profiles.py` — CREATE TABLE + unique constraint + index, chains 0009→0010
- [x] `backend/app/services/behavioral_coach.py` — `get_or_create_profile()`, `build_profile_context()`, `build_spending_summary()`, `build_system_prompt()`, `extract_profile_facts()` (second LLM call, returns {} on failure), `merge_profile()` (merge not overwrite, returns bool)
- [x] `backend/app/api/chat.py` — POST /chat: rate-limited (60/hr); loads last 20 history + profile + spending ctx → builds system prompt → LLM call → saves both messages → runs profile extraction → merges profile → commit; GET /chat/history (last 20, oldest-first); GET /chat/profile (returns parsed JSON fields); field_validator on message (non-empty, ≤2000 chars)
- [x] `backend/app/main.py` — chat_router registered; ConversationMessage + BehavioralProfile imported for create_all
- [x] `backend/app/services/llm_provider.py` — `get_provider(task_type="default")` — added default so bare `get_provider()` calls don't crash
- [x] `frontend/src/lib/api.ts` — `ChatMessage`, `ChatApiResponse`, `BehavioralProfile` types; `getChatHistory()`, `sendChatMessage()`, `getChatProfile()` functions
- [x] `frontend/src/components/ChatPanel.tsx` — loads history on mount; if empty + initialInsight given, seeds first assistant bubble; optimistic user message append; three-dot bounce typing indicator; auto-resize textarea; Enter sends (Shift+Enter newline); "Profilin güncellendi" toast (3.5s); auto-scroll to bottom
- [x] `frontend/src/app/transactions/page.tsx` — static coaching div replaced with ChatPanel; mounts only after insightState !== "loading" to avoid prop-flip flicker; passes insight?.insight as initialInsight

### Phase 11 — Goal Setting + TransactionTable Bug Fix (2026-06-20)
- [x] `TransactionTable.tsx` line 70 — `toggleExpand` guards `rows[id]` with `?? { expanded: false, ... }` so manually-added transactions (not in initial `rows` state) don't crash on click
- [x] `backend/app/models/budget_goal.py` — BudgetGoal table: id UUID, user_id FK CASCADE, category String(100), monthly_limit Numeric(12,2), created_at tz-aware; UNIQUE(user_id, category)
- [x] `backend/alembic/versions/0008_create_budget_goals.py` — CREATE TABLE + unique constraint + user_id index, chains 0007→0008, has downgrade
- [x] `backend/app/api/goals.py` — GET /goals (list); POST /goals (upsert via pg_insert ON CONFLICT DO UPDATE, returns the upserted row via RETURNING); DELETE /goals/{category} (404 if not found); GET /goals/status (real-time: debit tx this calendar month per category → pct_used, status ok/warning/>80%/exceeded/>100%)
- [x] `backend/app/main.py` — goals_router registered; BudgetGoal imported for create_all
- [x] `frontend/src/lib/api.ts` — `GoalResponse`, `GoalStatusItem` types; `getGoals()`, `upsertGoal()`, `deleteGoal()`, `getGoalStatus()` functions
- [x] `frontend/src/components/GoalsPanel.tsx` — loads status + goal list in parallel; progress bars per goal (green/yellow/red); % used + remaining/exceeded label; × delete button; "Hedef Ekle" shows inline form with category select (only unconfigured categories shown) + limit input; categories already with goals hidden from the add form
- [x] `frontend/src/app/progress/page.tsx` — GoalsPanel inserted above category comparison section

### Phase 10 — Manual Transaction Entry (2026-06-20)
- [x] `backend/app/api/transactions.py` — POST /transactions (201): `ManualTransactionRequest` body (amount str, transaction_type debit|credit, description, transaction_date, optional category); Pydantic validators for all fields; no category → flush → LLM categorize_batch on single tx → commit; category given → add+commit; busts both insight+progress caches; returns `TransactionResponse`
- [x] `frontend/src/lib/api.ts` — `createTransaction()` + `CreateTransactionRequest` interface
- [x] `frontend/src/components/AddTransactionModal.tsx` — modal form: debit/credit toggle, amount number input, description text, date picker, optional category select (13 options, "Otomatik belirle" default); closes on backdrop click or İptal; loading/error states
- [x] `frontend/src/app/transactions/page.tsx` — "+ Ekle" button opens modal; `handleTransactionAdded` prepends new tx to state + refreshes batches list

---

### Phase 21 — Net Worth Module (2026-06-21)

#### Backend
- [x] `backend/app/models/asset.py` — Asset: id UUID, user_id FK CASCADE, name String(200), asset_type String(50), currency String(10), current_value Numeric(18,2), notes Text nullable, created_at+updated_at tz-aware; `ASSET_TYPES` set (10 types)
- [x] `backend/app/models/liability.py` — Liability: id UUID, user_id FK CASCADE, name, liability_type, currency, total_amount, remaining_amount, monthly_payment nullable, due_date Date nullable, interest_rate Numeric(6,2) nullable, notes nullable, created_at; `LIABILITY_TYPES` set (7 types)
- [x] `backend/app/models/receivable.py` — Receivable: id UUID, user_id FK CASCADE, from_person, amount, currency, expected_date nullable, notes nullable, status ("pending"|"received"|"overdue"), created_at
- [x] `backend/app/services/currency.py` — `get_exchange_rate(from, to)` + `convert(amount, from, to)`; fetches live rates from open.er-api.com free tier (no API key); 1h in-memory cache; fallback to hardcoded TRY rates on failure; rates stored as TRY-per-unit, inverted from API's TRY-base format
- [x] `backend/app/api/networth.py` — 13 endpoints: CRUD for assets, liabilities, receivables + `GET /networth/summary`; summary converts all values to display_currency via live rates; `assets_by_type`, `liabilities_by_type`, `currency_breakdown` dicts; Pydantic validators on all inputs; ownership check on all mutations
- [x] `backend/alembic/versions/0016_create_assets.py` — chains 0015→0016, has downgrade
- [x] `backend/alembic/versions/0017_create_liabilities.py` — chains 0016→0017, has downgrade
- [x] `backend/alembic/versions/0018_create_receivables.py` — chains 0017→0018, has downgrade
- [x] `backend/requirements.txt` — added `httpx==0.27.0` for async HTTP in currency service
- [x] `backend/app/main.py` — `networth_router` registered; Asset, Liability, Receivable imported for create_all
- [x] Alembic stamped to 0018 (tables created by `create_all` dev startup before migration ran)

#### Frontend
- [x] `frontend/src/lib/api.ts` — `AssetItem`, `LiabilityItem`, `ReceivableItem`, `NetWorthSummary` interfaces; full CRUD functions for all three + `getNetWorthSummary(displayCurrency)`
- [x] `frontend/src/components/ui/Icons.tsx` — added: `TrendingDown`, `DollarSign`, `Home`, `Car`, `Briefcase`, `Wallet`, `Scale`
- [x] `frontend/src/components/AddAssetModal.tsx` — 10 asset types, 5 currencies, name+value+notes fields; indigo submit
- [x] `frontend/src/components/AddLiabilityModal.tsx` — 7 liability types; total+remaining+monthly+interest+due_date+notes; red submit; scrollable for mobile
- [x] `frontend/src/components/AddReceivableModal.tsx` — from_person+amount+currency+expected_date+notes; amber submit
- [x] `frontend/src/app/networth/page.tsx` — hero: large net worth number (green/red), assets/liabilities/receivables breakdown, currency pill breakdown when multi-currency; VARLIKLAR section: grouped by "Nakit & Banka"/"Yatırımlar"/"Gayrimenkul & Araç"/"Diğer" with icons; BORÇLAR section: progress bar (paid%), high-interest badge (red if >30%), monthly payment + due date; ALACAKLAR section: overdue badge (orange), "Alındı" mark-received button; TRY/USD/EUR currency switcher calls API with display_currency param; loading skeletons; empty states per section with CTA
- [x] `frontend/src/components/ui/Navbar.tsx` — "Net Değer" link added between İşlemler and İlerleme with `Scale` icon

#### Architectural decisions
- **`open.er-api.com` free tier**: No API key required, 1500 req/month free, OpenExchangeRates compatible. Fallback ensures app works even if rate limit hit.
- **summary endpoint converts at request time**: No caching — exchange rates change daily, net worth display always reflects current rates. If this becomes slow (>50 assets), add 5min cache.
- **Alembic stamp pattern**: Dev `create_all` runs before migrations. Same known issue as behavioral_profiles — stamp head after fresh migration files land on already-seeded DB.
- **`updated_at` on Asset only**: Assets have current_value that changes (user updates price). Liabilities/receivables changed via PATCH to status or PUT the whole row — no `updated_at` needed.

### Phase 22 — Net Worth Module Fixes & Expansion (2026-06-21)

#### Backend
- [x] `backend/app/models/asset.py` — added `source` (String(50), default "manual"), `source_detail` (String(500), nullable), `as_of_date` (Date, default today); `SOURCE_TYPES` set; `ASSET_TYPES` expanded to 19 types (added: foreign_currency, bond, commodity, startup_equity, art_collectible, jewelry, life_insurance, pension, business_ownership)
- [x] `backend/app/models/networth_suggestion.py` — new table: id UUID, user_id FK CASCADE indexed, suggestion_type String(50), asset_id UUID FK nullable (ondelete=SET NULL), suggested_change Numeric(18,2), currency String(10), reason Text, source_batch_id String(36) nullable, status String(20) default "pending", created_at
- [x] `backend/alembic/versions/0019_add_asset_lineage.py` — ADD COLUMN source/source_detail/as_of_date to assets, chains 0018→0019, has downgrade
- [x] `backend/alembic/versions/0020_create_networth_suggestions.py` — CREATE TABLE + indexes, chains 0019→0020, has downgrade
- [x] `backend/app/services/currency.py` — full rewrite: 3 separate caches (fiat/crypto/commodity), all 1h TTL. Fiat: open.er-api.com/v6/latest/USD (166 currencies live). Crypto: api.coingecko.com/v3/coins/markets top 100 by market cap. Commodities: XAU/XAG from open.er-api.com + hardcoded BRENT/XPT/XPD fallback. USD as conversion pivot. New public functions: `get_fiat_list()`, `get_crypto_list()`, `get_commodity_list()`
- [x] `backend/app/api/currency.py` — new router `/currency`: `GET /currency/list` (returns all fiat+crypto+commodity, no auth); `GET /currency/rates?base=TRY` (all rates relative to base, 270+ currencies)
- [x] `backend/app/api/networth.py` — major expansion:
  - AssetRequest/Response include source, source_detail, as_of_date
  - `PATCH /receivables/{id}/status → received` auto-creates Asset (source="receivable_collection"), returns `StatusPatchResponse(receivable, created_asset, toast_message)`
  - Suggestions endpoints: `GET /networth/suggestions` (pending only), `POST /networth/suggestions/{id}/accept`, `POST /networth/suggestions/{id}/dismiss`
  - `GET /networth/summary` gains `warnings: list[str]` (4 rule-based instant checks) + `ai_insight: str | None` (LLM, cached 24h in ProgressInsight table data_type="networth_insight", busted on asset/liability mutation)
  - `bust_networth_insight_cache()` helper called on all asset/liability mutations
- [x] `backend/app/api/upload.py` — `_generate_networth_suggestions()` groups transactions by bank keyword (10 banks), creates balance_change suggestions, added to UploadResponse as `suggestions: list[SuggestionResponse]`
- [x] `backend/app/main.py` — currency_router registered; NetworthSuggestion imported for create_all
- [x] Migrations stamped to 0020 (create_all pre-created tables)

#### Frontend
- [x] `frontend/src/lib/api.ts` — added: `CurrencyEntry`, `CurrencyList`, `getCurrencyList()`, `getCurrencyRates()`; `SuggestionItem` interface; `getNetWorthSuggestions()`, `acceptSuggestion()`, `dismissSuggestion()`; updated `AssetItem` (source, source_detail, as_of_date), `NetWorthSummary` (warnings, ai_insight), `UploadResponse` (suggestions), `updateReceivableStatus` return type (StatusPatchResponse with created_asset + toast_message)
- [x] `frontend/src/components/CurrencySelect.tsx` — searchable grouped dropdown; loads live list from `/currency/list`; three groups (Fiat Para Birimleri / Kripto Paralar / Emtialar); search filters all entries; closes on outside click; styled with design system
- [x] `frontend/src/components/AddAssetModal.tsx` — 19 asset types; CurrencySelect (live dynamic); as_of_date date picker (default today); passes source="manual"
- [x] `frontend/src/components/AddLiabilityModal.tsx` — CurrencySelect replacing static list
- [x] `frontend/src/components/AddReceivableModal.tsx` — CurrencySelect replacing static list
- [x] `frontend/src/app/networth/page.tsx` — AI insight card (below hero, indigo border); warning banners (amber, one per warning); asset source+date badge ("Manuel giriş · 2026-06-21"); receivable "Alındı" toast (emerald, 3s, bottom-right); "Akıllı Öneriler" section (pending suggestions, "Uygula"/"Yoksay" per card); pending count pill on section header
- [x] `frontend/src/components/ui/Navbar.tsx` — fetches pending suggestions on pathname change; red badge count on "Net Değer" link when count > 0
- [x] Upload page — suggestion cards shown after successful upload

#### Architectural decisions
- **USD as pivot for all conversion**: crypto (CoinGecko) and fiat (open.er-api) both quote in USD. Conversion = amount × (from_usd_rate / to_usd_rate). One pivot = zero cross-rate drift.
- **CoinGecko no auth**: top-100 market cap endpoint has generous rate limits without API key. Symbol collision possible (multiple coins with same ticker) — use market cap rank ordering, first match wins.
- **Networth insight separate cache key**: SHA256(user_id + "|nw|" + sorted_asset_ids + sorted_liability_ids). Different from progress cache key so bust is surgical.
- **Suggestion atomicity**: suggestions created in same session/commit as upload transactions. If upload fails mid-way, no orphan suggestions.
- **StatusPatchResponse instead of ReceivableResponse**: PATCH /receivables/{id}/status now returns richer object. Frontend was already handling the response — updated types in api.ts.

### Phase 23 — Asset Subtype UX, First Globalization Fix (2026-06-21)

#### Frontend
- [x] `frontend/src/components/AddAssetModal.tsx` — asset type now changes subtype UI. No more one generic free-text-only path for all asset types.
- [x] Crypto asset flow: loads `/currency/list`, uses live CoinGecko top-100 data already exposed by backend, searchable by code/name, selecting coin sets currency to coin symbol and stores `{subtype:"crypto", symbol, name}` in `Asset.source_detail`.
- [x] Foreign currency asset flow: uses live fiat list from `/currency/list`, searchable by code/name, selecting fiat sets asset currency and stores `{subtype:"foreign_currency", code, name}`.
- [x] Commodity asset flow: uses live commodity list from `/currency/list`, selecting commodity sets asset currency and stores `{subtype:"commodity", code, name}`.
- [x] Gold asset flow: added physical/unit picker: troy ounce, gram 24K/22K/18K, kilogram bar, sovereign, American Eagle, Maple Leaf, Krugerrand, quarter/half/full coin. Stores `{subtype:"gold", unit, label}`.
- [x] Stock asset flow: added ticker/symbol field + optional name + optional exchange/provider field. Stores `{subtype:"stock", symbol, name, venue}`. Real global stock search still needs backend market data provider.
- [x] Fund asset flow: added ISIN/fund-code field + optional name + optional provider field. Stores `{subtype:"fund", code, name, venue}`. Real global fund search still needs provider strategy.
- [x] Submit button now blocks missing subtype for crypto, foreign currency, commodity, stock, fund. Prevents empty meaningless asset rows.
- [x] `frontend/src/app/networth/page.tsx` — parses `Asset.source_detail` JSON and shows readable subtype label on asset rows.
- [x] `frontend/next-env.d.ts` — generated by Next build and should be tracked; repo was missing it.

#### Checks
- [x] `npm ci` completed.
- [x] `npm run build` completed successfully. Next compiled, type check passed, 12 static pages generated.
- [x] `git diff --check` clean.
- [x] Localhost probe: `http://localhost:3000/networth` returned HTTP 200.
- [!] `npm run lint` not usable: Next opened ESLint setup wizard because repo has no ESLint config.
- [!] Browser modal smoke blocked by auth redirect. Page loaded, then auth guard sent browser to `/login`. Build is main verification for this phase.

#### Architectural decisions
- **Use `Asset.source_detail` JSON for subtype metadata**: no migration needed. Existing column can hold structured data. Future `asset_prices.py` can read exact symbol/unit/code. Alternative was new columns (`symbol`, `unit`, `venue`), but that would add migration before model is stable.
- **Crypto/fiat/commodity reuse `/currency/list`**: one source of truth. No duplicate client lists. Alternative was hardcoded frontend list, rejected because global app must stay live and broad.
- **Gold unit list is local constant for now**: physical gold units are product units, not live currencies. Needs later price multiplier logic. Alternative was external gold product API; no free global reliable source chosen yet.
- **Stock/fund are structured input now, not full provider search yet**: enough to stop generic free-text asset creation and prepare backend price refresh. Full search belongs with real-time asset prices task.

### Phase 24 — Net Worth Flow Repair: DOGE Crash + Full Currency Switcher + Specific Asset Forms (2026-06-21)

#### Frontend fixes
- [x] `frontend/src/app/networth/page.tsx` — fixed `RangeError: Invalid currency code: DOGE`. Root cause: `Intl.NumberFormat(... currency: "DOGE")` only accepts ISO fiat currency codes. Crypto/commodity/custom units now render with fallback format: number + code. No crash for DOGE/BTC/XAU/BRENT/etc.
- [x] `frontend/src/app/networth/page.tsx` — removed hardcoded TRY/USD/EUR display buttons. Net worth display currency now uses `CurrencySelect`, same live searchable selector used in modals. User can select any live fiat/crypto/commodity supported by `/currency/list`.
- [x] `frontend/src/components/AddAssetModal.tsx` — all asset types now have specific data fields. No category is just naked generic name/value anymore.
- [x] Cash: storage/location fields.
- [x] Bank account: institution/account type/account label fields.
- [x] Real estate: property type, country/city, address/deed note fields.
- [x] Vehicle: make, model/year, plate/VIN/note fields.
- [x] Pension/BES/life insurance: provider, plan/policy fields.
- [x] Bond: issuer, ISIN/code, maturity fields.
- [x] Startup/business ownership: company/business, ownership %, country/sector/note fields.
- [x] Art/collectible/jewelry: item/material/certificate fields.
- [x] Other asset remains allowed as manual catch-all. If we cannot support a specific flow later, move it there or keep only manual structured detail.
- [x] Crypto/foreign currency/commodity/gold quantity/value label fixed: field shows `Miktar / Adet` for unit-priced assets. Bank/cash/manual assets still show `Güncel Değer`.
- [x] Removed Turkish-specific bank placeholder from asset name field. No more `Garanti` example.
- [x] Manual subtype metadata stored as structured JSON in `Asset.source_detail`: `{subtype, primary, secondary, tertiary}`.
- [x] Net worth asset row display now reads manual subtype metadata too, not only crypto/gold/stock/fund.

#### Checks
- [x] `npm run build` passed. Next compiled. Type check passed. 12 static pages generated.
- [x] No backend migration needed.
- [!] `npm run lint` still blocked by missing ESLint config from previous note.

#### Architectural decisions
- **Do not treat every asset code as fiat**: display must survive non-ISO units. Formatting now catches invalid `Intl` currency codes and falls back to `number CODE`.
- **One live selector for display currency**: net worth display currency now uses `CurrencySelect`; no page-local hardcoded list.
- **Specific category means specific fields**: if an asset type exists as first-class category, the form must ask category-relevant details. Otherwise category is fake and should be collapsed into `other_asset`.
- **Still no real stock/fund search provider**: current flow captures structured symbol/ISIN manually. True live search needs provider decision and backend endpoint.
- **Data model still overloaded**: `Asset.current_value` means quantity for unit-priced assets (crypto, FX, commodity, gold) and value for normal manual assets. This works with current conversion, but naming is bad. Long-term better schema: `quantity`, `unit_code`, `valuation_currency`, `manual_value`.

### Phase 25 — Receivable Write-Off + Linked Asset Integrity (2026-06-21)

#### Backend
- [x] `backend/app/models/receivable.py` — added `linked_asset_id UUID nullable index FK assets.id ON DELETE SET NULL`; status set expanded with `written_off`.
- [x] `backend/alembic/versions/0021_add_linked_asset_id_to_receivables.py` — adds column + index; chains 0020→0021; has downgrade.
- [x] `backend/app/api/networth.py` — `ReceivableResponse` now includes `linked_asset_id`.
- [x] `backend/app/api/networth.py` — added `_find_receivable_asset()` helper. First checks hard link. Then fallback finds legacy auto-created cash asset by old `source_detail` text, amount, currency, user.
- [x] `PATCH /networth/receivables/{id}/status` — marking `received` is now idempotent. If linked/legacy asset exists, no duplicate asset created.
- [x] `PATCH /networth/receivables/{id}/status` — new auto-created asset uses English name `Receivable: {from_person}` and JSON `source_detail` with `receivable_id`.
- [x] `PATCH /networth/receivables/{id}/status` — if a received receivable is moved back to pending/overdue, linked auto-created cash asset is deleted.
- [x] `GET /networth/receivables` — hides `written_off` receivables from active UI list.
- [x] `DELETE /networth/receivables/{id}` — now acts as write-off: loads receivable first, finds linked/legacy auto-created asset, deletes linked asset, marks receivable `written_off`, clears `linked_asset_id`, busts net worth insight cache. Audit row stays in DB.

#### Frontend
- [x] `frontend/src/lib/api.ts` — `ReceivableItem.linked_asset_id` added; status union includes `written_off`.
- [x] `frontend/src/app/networth/page.tsx` — deleting a received receivable with linked asset shows browser confirm. If confirmed, UI removes both receivable and linked asset from state.
- [x] `frontend/src/app/networth/page.tsx` — received badge shows `Varlığa bağlı` when linked asset exists.
- [x] `frontend/src/app/networth/page.tsx` — delete button title distinguishes write-off vs delete linked cash asset.

#### Checks
- [x] `npm run build` passed. Next compiled. Type check passed. 12 static pages generated.
- [x] `python3 -m py_compile backend/app/api/networth.py backend/app/models/receivable.py backend/alembic/versions/0021_add_linked_asset_id_to_receivables.py` passed.
- [x] `git diff --check` clean.
- [!] Docker/alembic runtime not run per user rule. User should run `docker compose exec backend alembic upgrade head`.

#### Architectural decisions
- **Hard link beats text lookup**: receivable → asset needs FK, not source_detail string parse. Money integrity needs exact relation.
- **Write-off preserves audit**: DELETE endpoint hides receivable by setting `written_off`, not hard-deleting row. If app created cash asset from receivable, write-off reverses that app-created side effect. Otherwise net worth lies.
- **Legacy fallback kept**: old rows before 0021 may have auto-created assets but no linked_asset_id. Fallback prevents old orphan assets.
- **Received is idempotent**: repeated click/API call must not mint duplicate cash.

### Product Direction Reset — Net Worth First, Events Second, AI Reconciliation Third

#### Current problem
- App started as bank statement upload + charts. That is too small.
- Most pages behave like bank dashboard clone: spend chart, inflation, category comparison. Useful but not enough.
- AI is mostly text commentary. Not enough automation. Not enough action. Not enough daily financial truth.
- Net worth page is the real core. It should become source-of-truth ledger for assets, liabilities, receivables, payables, and account balances at a date.

#### New product spine
- **Net Worth Ledger = truth table**: dated snapshot of everything user owns/owes.
- **Statements/manual entries/integrations = events**: they change ledger, but do not blindly overwrite truth.
- **AI Reconciliation = conflict engine**: compare statement events, manual entries, linked assets, receivables, liabilities. Ask user only when conflict matters.
- **Daily automation = value**: app should track what changed today, what needs action, what looks wrong, what should be confirmed.
- **Pages should become workflows, not reports**: upload page creates events; transactions page reconciles events; net worth page shows truth; chat acts on truth; alerts suggest actions.

#### Needed redesign notes
- Replace decorative analytics with action queues: `Needs Review`, `Confirm Match`, `Possible Duplicate`, `Balance Drift`, `Missing Asset`, `Upcoming Payable`, `Overdue Receivable`.
- Asset addition must become guided onboarding: account, investment, property, receivable, liability, business asset. Each has required fields and source confidence.
- Every auto-created record needs lineage: source event, created_by, confidence, linked object IDs, reversible action.
- Do not show inflation panel by default. Move to secondary analysis tab later. It wastes prime space.
- Spending chart is not core. Rebuild as cash-flow/reconciliation panel or move lower.
- AI should not only write advice. It should produce structured proposals: create asset, update balance, mark receivable paid, detect duplicate, flag conflict, ask one question.
- Need `FinancialEvent` table later: statement upload row, manual transaction, receivable collection, asset valuation update, liability payment. Ledger derives from accepted events.
- Need dated snapshots: net worth at date X, not only current mutable values.
- Need confidence states: manual, imported, inferred, confirmed, disputed.

### Phase 26 — Auto-Archive Stale Items (2026-06-21)

#### Backend
- [x] `backend/app/api/networth.py` — `_ARCHIVE_AFTER_DAYS=30`.
- [x] `backend/app/api/networth.py` — received receivables older than 30 days are hidden from active `GET /networth/receivables` list.
- [x] `backend/app/api/networth.py` — `written_off` receivables stay hidden from active list. DB audit row stays.
- [x] `backend/app/api/networth.py` — net worth summary ignores `written_off` and old received receivables for active warnings/context.
- [x] `backend/app/api/networth.py` — processed suggestions (`accepted`, `dismissed`) older than 30 days are deleted opportunistically when suggestions endpoint loads.
- [x] `backend/app/api/patterns.py` — dismissed alerts older than 30 days are deleted opportunistically when alerts endpoint loads. If alert is still relevant, detector can show it again.

#### Checks
- [x] `npm run build` passed.
- [x] `python3 -m py_compile backend/app/api/networth.py backend/app/api/patterns.py` passed.
- [x] `git diff --check` clean.
- [x] No migration needed.

#### Architectural decisions
- **No `archived_at` column yet**: stale cleanup is simple filter/delete by existing timestamps. Low risk, no schema churn.
- **Receivables keep audit**: received old rows are hidden, not deleted. Written-off rows are hidden, not deleted.
- **Dismissed alerts expire**: if a user dismissed something 30+ days ago and it is still detected, it can return. That is correct for recurring risk.
- **Processed suggestions can be deleted**: accepted/dismissed suggestions are UI workflow artifacts, not source-of-truth ledger rows.

### Phase 27 — Globalization Cleanup: Prompts + Onboarding + Landing (2026-06-21)

#### Backend prompts
- [x] `backend/app/services/coach.py` — removed "Turkish personal finance coach" assumption. Prompt now says global coach, use user's language when clear, otherwise simple English. Removed hardcoded lira symbols from prompt amounts.
- [x] `backend/app/services/behavioral_coach.py` — removed Turkish-user assumption. Chat coach, profile extraction, and transaction-intent prompts now global/multilingual. Examples now generic.
- [x] `backend/app/services/weekly_summary.py` — removed Turkish-coach assumption. Insight prompt now uses user's language when clear, otherwise simple English.
- [x] `backend/app/api/networth.py` — net worth AI insight prompt now global; no "Turkish user" system prompt.
- [x] `backend/app/api/progress.py` — comparison insight prompt now global; no "Turkish personal finance coach".
- [x] `backend/app/api/installments.py` — installment insight prompt now global; no "Turkish finance coach".
- [x] `backend/app/services/categorizer.py` — removed "Turkey-targeted" comment and Turkish banking system prompt. Category slugs kept as legacy stable values.
- [x] `backend/app/services/personality.py` — removed "Turkish personality types" wording. Legacy labels kept; prompt asks for user's language when clear.

#### Frontend onboarding/landing
- [x] `frontend/src/app/onboarding/page.tsx` — removed hardcoded Ziraat/Vakıfbank/Yapı Kredi/Garanti bank selector.
- [x] `frontend/src/app/onboarding/page.tsx` — new generic institution input: bank, card, wallet, broker, payment app. Optional; app can detect from file later.
- [x] `frontend/src/app/onboarding/page.tsx` — instructions now generic export flow: statements/activity/history/export, PDF/CSV.
- [x] `frontend/src/app/page.tsx` — removed Turkey positioning and hardcoded bank logos. Replaced with global source types: banks, credit cards, wallets, brokerages, payment apps.
- [x] `frontend/src/app/page.tsx` — hero copy now points to holistic financial operating system, not Turkish statement dashboard.

#### Legacy text neutralized
- [x] `backend/app/services/pdf_parser.py` — comments/prompt wording no longer says Turkish bank statement OCR corrector. Behavior unchanged. Full global parser still needs separate architecture.
- [x] `backend/app/services/installment.py` — comments no longer call feature Turkey-specific.
- [x] `backend/app/api/subscriptions.py` — comment changed from Turkish bank prefixes to generic statement prefixes.

#### Checks
- [x] Targeted search for Turkish/Turkey bank assumptions returned clean for prompt/onboarding/landing scope.
- [x] `npm run build` passed.
- [x] `python3 -m py_compile` passed for changed backend files.
- [x] `git diff --check` clean.

#### Architectural decisions
- **Keep legacy slugs/labels**: category slugs and personality labels remain until migration/i18n plan. Renaming now would break data and UI mapping.
- **Prompt default language**: use user's language when clear; otherwise simple English. This avoids assuming Turkish.
- **Parser behavior unchanged**: OCR still includes `tur+eng` and legacy regex. Full global statement parser is a larger phase, not a safe prompt-cleanup patch.
- **Onboarding source-first**: no bank list. Any institution/export source can start onboarding.

### Phase 28 — Net Worth Event/Reconciliation Architecture Skeleton (2026-06-21)

#### Backend models + migration
- [x] `backend/app/models/financial_event.py` — new durable financial event log. Fields: user_id, event_type, entity_type, entity_id, amount, currency, event_date, source, source_detail JSON text, status, confidence, created_at.
- [x] `backend/app/models/reconciliation_item.py` — new review queue for conflicts/proposed actions. Fields: issue_type, severity, status, title, description, related_event_id, related_entity, proposed_action JSON text, created_at, resolved_at.
- [x] `backend/alembic/versions/0022_create_financial_events_and_reconciliation.py` — creates `financial_events` and `reconciliation_items`, indexes event/status/user fields, chains 0021→0022, has downgrade.

#### Backend API
- [x] `backend/app/api/reconciliation.py` — new router `/reconciliation`.
- [x] `GET /reconciliation/events?limit=100` — lists recent financial events for current user.
- [x] `GET /reconciliation/items?status=open` — lists review queue items by status.
- [x] `PATCH /reconciliation/items/{id}/status` — marks item open/resolved/dismissed.
- [x] `backend/app/main.py` — imports new models, registers reconciliation router, updates API description away from Turkish-only positioning.

#### First real event writes
- [x] `backend/app/api/networth.py` — `_add_financial_event()` helper added.
- [x] Receivable collected → writes `receivable_collected` event.
- [x] Receivable collection reversed → writes `receivable_collection_reversed` event.
- [x] Receivable written off → writes `receivable_written_off` event.

#### Frontend API client
- [x] `frontend/src/lib/api.ts` — added `FinancialEventItem`, `ReconciliationItem`, `getFinancialEvents()`, `getReconciliationItems()`, `updateReconciliationItemStatus()`.

#### Checks
- [x] `npm run build` passed.
- [x] `python3 -m py_compile` passed for new/changed backend files.
- [x] `git diff --check` clean.
- [!] Docker/alembic runtime not run. User must run `docker compose exec backend alembic upgrade head` to apply 0022.

#### Architectural decisions
- **Events before AI automation**: AI should create events/proposals, not silently mutate assets. Event log gives audit, replay, and conflict detection.
- **Review queue before broad UI rewrite**: reconciliation items are the bridge between automated detection and user confirmation.
- **Source detail remains JSON text**: fast schema now, flexible proposals. Later can move to JSONB.
- **Receivable flow proves the pattern**: existing net worth mutation now writes events. Next: upload suggestions, manual asset edits, liability payments.

### Phase 29 — Reconciliation UI + Idempotent 0022 Migration (2026-06-21)

#### Problem found
- [x] User ran `docker compose exec backend alembic upgrade head`.
- [x] 0022 failed with `DuplicateTableError: relation "financial_events" already exists`.
- [x] Cause: dev backend `create_all` created tables before Alembic migration stamped 0022. Same old dev drift class, new table.

#### Migration fix
- [x] `backend/alembic/versions/0022_create_financial_events_and_reconciliation.py` — upgrade now inspects DB first.
- [x] If `financial_events` already exists, migration skips create.
- [x] If `reconciliation_items` already exists, migration skips create.
- [x] Clean DB still creates both tables and indexes.
- [x] Current drifted DB can now rerun `docker compose exec backend alembic upgrade head` and stamp 0022 if schema already exists.

#### Net worth UI
- [x] `frontend/src/app/networth/page.tsx` — loads recent financial events from `/reconciliation/events`.
- [x] `frontend/src/app/networth/page.tsx` — loads open reconciliation items from `/reconciliation/items?status=open`.
- [x] `frontend/src/app/networth/page.tsx` — new Action Queue block on net worth page.
- [x] Action Queue shows open review items first: title, severity, description, proposed action text if present.
- [x] User can mark review item `resolved` or `dismissed`; UI removes it from open queue.
- [x] Recent Events list shows latest ledger events with event date, entity type, detail, and amount/currency.
- [x] Receivable collected/deleted flows refresh events after action.

#### Checks
- [x] `python3 -m py_compile backend/alembic/versions/0022_create_financial_events_and_reconciliation.py` passed.
- [x] `npm run build` passed.
- [x] `git diff --check` clean.
- [!] Docker/alembic runtime not run by Codex because user runs Docker commands manually.

#### Architectural decisions
- **Idempotent migration only for dev drift**: this protects current local DB. Production should not rely on `create_all`; migrations remain source of truth.
- **Action Queue before chart redesign**: user needs system actions, not more graphs. This is first visible step from passive dashboard to workflow app.
- **Events are read-only in UI for now**: events are audit trail. User actions happen through reconciliation items.
- **Open items only by default**: stale/resolved/dismissed work should not clutter main net worth page.

### Phase 30 — Reconciliation Producers (2026-06-21)

#### Backend producers
- [x] `backend/app/services/reconciliation_producers.py` — new producer service. Turns detected data problems into `reconciliation_items`.
- [x] Overdue receivable detector: pending/overdue receivable past expected date creates `overdue_receivable`. Pending row is also marked `overdue`.
- [x] Missing asset detector: received receivable without linked asset creates `received_receivable_missing_asset`.
- [x] Duplicate transaction detector: groups recent transactions by date, amount, type, normalized description prefix. Creates `possible_duplicate_transaction`.
- [x] Large transaction detector: compares recent transactions against median. Creates `large_transaction_review` for outliers.
- [x] Producer dedupe: same issue/entity does not create repeated open rows. Open item gets refreshed; resolved/dismissed item stays closed.

#### Backend API
- [x] `backend/app/api/reconciliation.py` — added `POST /reconciliation/scan`.
- [x] `POST /reconciliation/scan` runs producers and returns `{created}`.
- [x] `GET /reconciliation/items` stays read-only. No hidden write side effect on GET.

#### Frontend
- [x] `frontend/src/lib/api.ts` — added `scanReconciliation()`.
- [x] `frontend/src/app/networth/page.tsx` — calls scan before loading open reconciliation items.
- [x] Net worth Action Queue now gets real generated review items on page load/refresh.

#### Checks
- [x] `python3 -m py_compile backend/app/services/reconciliation_producers.py backend/app/api/reconciliation.py` passed.
- [x] `npm run build` passed.
- [x] `git diff --check` clean.
- [!] Docker runtime not run by Codex because user runs Docker commands manually.

#### Architectural decisions
- **POST scan writes, GET reads**: no hidden mutation inside list endpoint. Cleaner API and easier debugging.
- **No migration needed**: uses existing `reconciliation_items` table from 0022.
- **Resolved/dismissed means user choice**: producer does not recreate same closed issue immediately. Later can add expiry/reopen policy.
- **Median threshold for large transaction**: avoids hardcoded country/currency assumption. Still rough because transaction rows have no currency field.

### Phase 31 — Reconciliation Queue Action Handlers (2026-06-22)

#### Frontend
- [x] `frontend/src/lib/api.ts` — added `deleteBatch(batchId)`: calls `DELETE /transactions/batch/{batchId}` with JWT auth.
- [x] `frontend/src/app/networth/page.tsx` — added `actionPending: string | null` state; prevents double-click on in-flight actions.
- [x] `frontend/src/app/networth/page.tsx` — added `handleReconciliationAction(item, action)` — routes by `issue_type`:
  - `overdue_receivable`: "Mark Received" calls `updateReceivableStatus(id, "received")` + updates receivables/assets state; "Write Off" calls `updateReceivableStatus(id, "written_off")` + removes from list; both mark item resolved.
  - `received_receivable_missing_asset`: "Re-create Asset" calls `updateReceivableStatus(id, "received")` idempotently (backend returns existing or new asset); "Mark Pending" calls status patch; "Write Off" removes receivable; all mark item resolved.
  - `possible_duplicate_transaction`: "Delete Older Duplicate" shows confirmation dialog, deletes all but last `upload_batch_id` in proposed_action via `deleteBatch()`; "Keep All" marks resolved; "Dismiss" marks dismissed.
  - `large_transaction_review`: "Confirm & Close" marks resolved; "Ignore" marks dismissed.
  - fallback: generic resolved/dismissed.
- [x] Action Queue UI rewritten — per-issue-type button sets replace generic Resolved/Dismiss; severity badge color-coded (red/amber/gray); extra context line for duplicate description and large transaction amount.
- [x] Buttons disabled while any action is pending; show "…" spinner text on the active button.

#### Checks
- [x] `python3 -m py_compile backend/app/api/reconciliation.py backend/app/services/reconciliation_producers.py backend/app/api/networth.py` passed.
- [x] `npm run build` passed. 12 static pages generated.
- [x] `git diff --check` clean.
- [x] No new backend changes. No migration needed.

#### Architectural decisions
- **Frontend-only change**: all backend endpoints existed (PATCH /receivables/{id}/status, DELETE /transactions/batch/{id}, PATCH /reconciliation/items/{id}/status). Zero backend changes needed.
- **deleteBatch is idempotent enough**: if batch already deleted, backend returns 404; caught by `.catch(() => null)` in loop — user sees toast about removed batches without crash.
- **actionPending blocks all buttons**: single concurrent action only. Prevents race between "Mark Received" + "Write Off" on same receivable.
- **Confirm dialog for batch delete**: destructive, irreversible — `window.confirm()` is appropriate gating here.
- **Re-create asset is idempotent**: `updateReceivableStatus(id, "received")` backend already handles repeated calls without duplicate asset creation (Phase 25 fix).

### Phase 32 — Cash Flow Calendar (2026-06-22)

#### Backend
- [x] `backend/app/api/cashflow.py` — new router `/cashflow`. No new migration — pure computation from existing tables.
- [x] `GET /cashflow/upcoming?days=30` — aggregates 3 sources into one sorted list of `CashFlowItem(date, type, amount, currency, description, source, urgent)`:
  - Liabilities with `monthly_payment>0`: projects next monthly occurrence using `due_date.day` as the recurring day-of-month; `_next_monthly()` handles month-boundary edge cases.
  - Receivables with `status in {pending,overdue}` + `expected_date`: overdue items shown at today, future items at their date.
  - Recurring transaction patterns: same detection logic as subscriptions.py (±10% variance, ≥2 months); debit groups → "subscription" type; credit groups → "recurring_income" type; projected forward by avg gap (7d or 30d) until ≥ today.
- [x] `GET /cashflow/summary?days=30&display_currency=TRY` — totals converted to display_currency via `convert()`; `liquid_assets` = sum of cash+bank_account assets; `liquid_to_payments_ratio`; `warning` when liquid < payments.
- [x] `backend/app/main.py` — cashflow_router registered at `/cashflow`.

#### Frontend
- [x] `frontend/src/components/ui/Icons.tsx` — added `Calendar`, `ArrowDown`, `ArrowUp` icons.
- [x] `frontend/src/lib/api.ts` — added `CashFlowItem`, `CashFlowSummary` interfaces; `getCashFlowUpcoming(days)`, `getCashFlowSummary(days, currency)`.
- [x] `frontend/src/components/ui/Navbar.tsx` — "Takvim" link (Calendar icon) added between Net Değer and İlerleme.
- [x] `frontend/src/app/cashflow/page.tsx` — new page:
  - Day selector: 7/14/30/60/90g pill buttons.
  - Currency selector: `CurrencySelect` component.
  - Urgent count badge: animated pulse when items within 3 days.
  - Summary card: 4 metrics (beklenen gelir, beklenen ödeme, tahmini net, likit varlıklar) + coverage % + warning banner.
  - Timeline: items grouped by date; date header with "Bugün"/"Yarın" badges; items show type icon + badge + description + signed amount.
  - Urgent items: red background tint + pulsing dot on icon.
  - Empty state: Calendar icon + explanatory text.
  - Legend row at bottom.
  - "Ödeme Ekle" button: opens `AddPaymentModal` → calls `createLiability` with monthly_payment + due_date → feeds back into cashflow on reload. No new DB table.

#### Checks
- [x] `python3 -m py_compile backend/app/api/cashflow.py backend/app/main.py` passed.
- [x] `npm run build` passed. 13 static pages generated (/cashflow added).
- [x] `git diff --check` clean.
- [!] No new migration. Docker restart not needed — new router only.

#### Architectural decisions
- **No new DB table**: cashflow is pure projection. Source data lives in liabilities/receivables/transactions. Alternative (cashflow_events table) rejected — premature persistence for what is currently read-only projection.
- **Transactions have no currency field**: recurring transaction items default to "TRY". Correct for statement-uploaded data; manual entries would need currency for full correctness.
- **AddPaymentModal creates Liability not a one-off event**: creating a liability record is the cleanest path. It shows in networth, is tracked in cashflow, and has full lifecycle. Alternative (separate upcoming_payments table) rejected — more tables, less integration.
- **Conversion at summary time only**: upcoming items return raw amounts in their native currency. Summary converts everything for totals. This avoids stale exchange rates on individual item cards.
- **Gap estimation for recurring**: uses average gap between consecutive transactions, not months. More accurate for biweekly payroll than calendar-month counting.

---

### Phase 44 — Net Worth Page Polish: Edit Modals, Analyze Chat, Notifications (2026-06-22)

#### Backend
- [x] `backend/app/models/app_notification.py` — AppNotification: id UUID, user_id FK CASCADE, title String(200), message Text, type String(20) (info|warning|alert), is_read bool default false, created_at tz-aware indexed.
- [x] `backend/alembic/versions/0026_create_app_notifications.py` — idempotent via inspector.has_table guard, chains 0025→0026, has downgrade.
- [x] `backend/app/api/notifications.py` — GET /notifications (limit 30 desc), GET /notifications/unread-count, PATCH /notifications/{id}/read, POST /notifications/mark-all-read, POST /notifications/generate-daily (LLM + rule-based: overdue receivables, upcoming liability payments, budget goals >90%, triggered wealth alerts, LLM daily insight; UTC-day dedup prevents repeat generation; prunes >30d old rows).
- [x] `backend/app/api/networth.py` — PUT /receivables/{id}: was missing; added using existing ReceivableRequest model. POST /analyze: session-only LLM chat with full asset/liability context, returns reply string, NOT persisted.
- [x] `backend/app/main.py` — notifications_router registered; AppNotification imported for create_all.

#### Frontend
- [x] `frontend/src/lib/api.ts` — updateReceivable (PUT), analyzeNetWorth (POST /networth/analyze), AppNotification interface, getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, generateDailyNotifications.
- [x] `frontend/src/components/NotificationDropdown.tsx` — bell icon + unread badge (9+); dropdown on click; per-type dot color (alert=red/warning=amber/info=indigo); mark-read on click; mark-all-read button; closes on outside click.
- [x] `frontend/src/components/ui/Navbar.tsx` — NotificationDropdown added to right side.
- [x] `frontend/src/components/ui/Icons.tsx` — added Pencil, CheckCircle, MessageCircle.
- [x] `frontend/src/components/AddAssetModal.tsx` — full edit support: editData prop, isEdit flag, pre-populates draft, calls updateAsset on submit, onUpdated callback.
- [x] `frontend/src/components/AddLiabilityModal.tsx` — full edit support: same pattern, calls updateLiability.
- [x] `frontend/src/components/AddReceivableModal.tsx` — full edit support: same pattern, calls updateReceivable.
- [x] `frontend/src/app/networth/page.tsx`:
  - REMOVED: PieChart donut (asset allocation); highlightedGroup state.
  - ADDED: nwDelta computed from last 2 history snapshots → shown as badge in hero (green/red).
  - ADDED: 15-min refresh cooldown with countdown display ("X:XX" while cooling); lastRefreshAt derived from max(asset.source_detail.price_fetched_at).
  - ADDED: handleUpdateAsset/handleUpdateLiability/handleUpdateReceivable handlers update local state without full reload.
  - ADDED: Pencil icon on every asset/liability/receivable card → sets editingAsset/Liability/Receivable state.
  - ADDED: Edit modals wired (editingAsset → AddAssetModal with editData, etc).
  - ADDED: analyzeOpen state → focused chat modal over page; calls POST /networth/analyze; message thread with typing indicator; non-persistent.
  - ADDED: generateDailyNotifications() fire-and-forget on page load.
  - REORDERED sections: header → hero → AI insight → warning banners → triggered alerts → history chart → assets → liabilities → receivables → suggestions → action queue.
- [x] `frontend/src/locales/{en,tr}.ts` — added nw.analyzeTitle/analyzePlaceholder/analyzeSend/analyzeClose/minAgo; notifications.title/empty/markAllRead/types.
- [x] Build: 13 pages, clean.

### Phase 43 — TEFAS Fund Lookup, Real Estate Simplified, BES Smart Form (see git log)

### Phase 42 — Asset Card Currency Conversion (2026-06-22)
- [x] `frontend/src/app/networth/page.tsx` — asset card values now display in page display currency. Added `convertAmount(amount, from, to, rates)` using USD pivot. `getCurrencyRates("USD")` fetched once on `loadAll()`. Converted value shown in green; native currency always shown as subtitle.
- [x] No backend changes. No migration.

### Phase 41 — Asset Form Global Types + Live Prices + Crypto Top-10 (2026-06-22)
- [x] `ManualAssetForm.tsx` — RE_TYPES globalized: `konut/isyeri/arsa` → `residential/commercial/land/other`. Real estate adds optional size m² field; auto price-per-m² shown when both filled. Generic hint (no website names). Vehicle gets dedicated `VehicleForm`: Brand + Model + Year + Currency + Value + depreciation note. Bond: removed ISIN field, added free-text Note field. Life insurance: removed policy number. Business: removed country/sector. Art/jewelry: removed provenance/material and certificate/purity entirely.
- [x] `CurrencyAssetForm.tsx` — commodity chips now show live USD price per unit via `usdPriceOf()`. Works for XAU, XAG, XPT, XPD, BRENT.
- [x] `CryptoAssetForm.tsx` — top-10 chips use `coins.slice(0, 10)` from CoinGecko market-cap-sorted list (was hardcoded 8-symbol array). Each chip shows live USD price. 5-column grid layout.
- [x] `en.ts` + `tr.ts` — added `assetForm.re.*`, `assetForm.vehicle.*`, `assetForm.bond.note`. Removed `policyNo`, `provenance`, `country` keys.
- [x] No backend changes. No migration. Build: 13 pages, clean.

### Phase 40 — Asset Form Completions (2026-06-22)

#### Changes
- [x] `frontend/src/components/asset-forms/ManualAssetForm.tsx` — **Tertiary bug fixed**: tertiary field now has its own `tertiary` state variable (was incorrectly bound to `secondary`).
- [x] `ManualAssetForm.tsx` — Dedicated `BondForm` sub-component: issuer (required), ISIN/code, coupon rate %, maturity date, currency, face value with display-currency preview.
- [x] `ManualAssetForm.tsx` — Dedicated `LifeInsuranceForm` sub-component: provider (required), policy no. (optional), currency, coverage amount (required) + display-currency preview, monthly premium (optional).
- [x] `ManualAssetForm.tsx` — Dedicated `BusinessOwnershipForm` sub-component: company name (required), ownership % with `%` suffix, country/sector, currency, estimated value + hint + preview.
- [x] `ManualAssetForm.tsx` — Dedicated `ArtJewelryForm` sub-component: shared for `art_collectible` and `jewelry`; item name (required), provenance (type-specific placeholder), currency, estimated value + hint + preview, insurance/appraisal value + certificate/purity (optional).
- [x] `ManualAssetForm.tsx` — BES locale keys fixed: form was using `assetForm.bes.*` paths that were missing from locale files; all BES labels now resolve correctly.
- [x] `frontend/src/components/asset-forms/CurrencyAssetForm.tsx` — **Commodity simplified**: shows all commodity entries as a 3-column chip grid (list is small, ~5 items); no search box needed. Each chip shows code + name.
- [x] `CurrencyAssetForm.tsx` — **Foreign currency improved**: selected currency shown as dismissible pill above search; quantity label shows live USD rate per unit; preview shows `≈ X (DISPLAY_CURRENCY)` label.
- [x] `frontend/src/locales/en.ts` + `tr.ts` — Added new nested locale sections: `assetForm.bes.*`, `assetForm.bond.*`, `assetForm.life.*`, `assetForm.art.*`, `assetForm.business.*`.
- [x] No backend changes. No migration needed. Build: 13 pages, clean.

### Phase 36 — Premium Per-Type Add Asset Forms + Action Queue Restructure (2026-06-22)

#### Backend
- [x] `backend/app/models/asset.py` — removed `startup_equity` from `ASSET_TYPES` (too niche). Now 18 types.
- [x] `backend/app/api/currency.py` — new public `GET /currency/quote?symbol=AAPL` → `{symbol, price_usd}`; reuses `asset_prices.fetch_stock_price` (Yahoo chart API, 1h cache, stale-on-fail). No auth, no migration.

#### Frontend — asset-forms architecture
- [x] `frontend/src/components/asset-forms/shared.ts` — `AssetDraft`/`AssetFormProps` contracts; `sharedInputClass`; `buildSourceDetail()`; `TOP_CRYPTO`; `GOLD_UNITS` (12 units w/ `xauPerUnit` purity math); `MANUAL_CONFIGS` (per-type optional slots); `useUsdRates()` hook (`getCurrencyRates("USD")` → `usdPriceOf(code)=1/rate`, `tryPerUsd`); `previewLine(usd, tryPerUsd)` → "≈ 12,345 ₺ · $410".
- [x] `CryptoAssetForm.tsx` — quick-select chips (TOP_CRYPTO) + live search from `/currency/list`; quantity; live TRY/USD preview. Stores `current_value=qty`, `currency=symbol`, `source_detail{subtype:crypto,symbol,name}`.
- [x] `CurrencyAssetForm.tsx` — handles `foreign_currency` + `commodity`; live list search; quantity; preview.
- [x] `GoldAssetForm.tsx` — gold-type `<select>` + quantity; computes `pure_oz = qty × xauPerUnit`; stores `current_value=pure_oz`, `currency="XAU"`. **Fixes** old bug where gold was stored with TRY currency (mis-valued).
- [x] `MarketAssetForm.tsx` — stock/fund ticker/ISIN + "Look up" → `getMarketQuote` live USD price → shares input → `value=price×shares`. Graceful fallback: on null price, manual total-value (USD) input. `currency="USD"`.
- [x] `ManualAssetForm.tsx` — config-driven (MANUAL_CONFIGS) for all manual types; name + primary(required) + optional secondary/tertiary + `CurrencySelect` + value. **BES special case**: contribution input → +30% state-match helper → live total; real_estate/vehicle get "best estimate" hint.
- [x] `AddAssetModal.tsx` — full rewrite: 2-step flow (type-picker grid grouped into cashBank/investments/property/retirement/other → per-type sub-form router) + shared footer (as_of_date + notes). `startup_equity` removed from picker. Every string via `t()`.
- [x] `frontend/src/lib/api.ts` — `MarketQuote` interface + `getMarketQuote(symbol)`.

#### Frontend — net worth page (PART 2/3/4)
- [x] `networth/page.tsx` — Action Queue: now **collapsed by default** (`actionQueueOpen` state, default false), clickable header w/ chevron + count badge, **moved to bottom** (after Smart Suggestions, before modals).
- [x] `networth/page.tsx` — refresh-prices tooltip now `title={t("nw.refreshPricesTooltip")}` (was hardcoded English).
- [x] `networth/page.tsx` — `startup_equity` removed from `ASSET_TYPE_GROUPS` investments array.
- [x] `frontend/src/locales/{en,tr}.ts` — added `nw.refreshPricesTooltip` + full `assetForm.*` namespace (groups, gold units/units, crypto/currency/market/bes/manual field keys, per-type `fields.{type}.{primary,secondary,tertiary}`); removed `assetType.startup_equity` from both.

#### Checks
- [x] `python3 -m py_compile` passed (currency.py, asset.py, asset_prices.py).
- [x] `npm run build` passed. 13 static pages. Type check clean.
- [x] No remaining `startup_equity` references (except one explanatory comment).
- [x] No new migration (asset subtype metadata stays in `source_detail` JSON).

#### Architectural decisions
- **Folder-of-components over one mega-modal**: `shared.ts` + 5 focused sub-forms + thin router modal. Each form fully owns its `AssetDraft` (name/type/currency/value/source_detail) so the modal stays dumb.
- **`getCurrencyRates("USD")` is the single price oracle**: `1/rate[code]` gives USD price for fiat, crypto AND commodities — no separate crypto-price fetch needed in the preview hook.
- **Market assets assume USD quote currency** (Yahoo): known limitation for non-USD listings; matches existing `asset_prices` behavior. Graceful manual fallback when quote unavailable.
- **TEFAS Turkish-fund NAV intentionally NOT implemented**: fragile + violates no-Turkish-hardcoding. Funds fall back to Yahoo-quote-or-manual.
- **BES 30% state-match is a UI helper only**: stored as plain total `current_value`; `source_detail` keeps contribution + state_match for lineage.

### Phase 35 — Reconciliation Queue Audit & UI Fixes (2026-06-22)
- [x] `frontend/src/app/networth/page.tsx` — **Bug fix**: `overdue_receivable` and `possible_duplicate_transaction` handlers were always calling `updateReconciliationItemStatus(item.id, "resolved")` even when action was "dismiss". Fixed: `const recStatus = action === "dismiss" ? "dismissed" : "resolved"` before the status call.
- [x] `frontend/src/app/networth/page.tsx` — Action Queue section now **always renders** after loading (replaced `{reconciliationItems.length > 0 || events.length > 0}` gate with `{!loading}`).
- [x] `frontend/src/app/networth/page.tsx` — **Empty state**: when 0 items, shows inline checkmark SVG + `t("nw.allClear")` in a card instead of empty space.
- [x] `frontend/src/app/networth/page.tsx` — **Count badge always shown** on Action Queue header: cyan when > 0, gray `text-gray-500` when 0; confirms scan ran.
- [x] `frontend/src/app/networth/page.tsx` — **Tooltip** on "Fiyatları Güncelle" button: `title` attribute explains which asset types auto-refresh (crypto, gold, FX, commodity, stock) vs manual.
- [x] `frontend/src/locales/tr.ts` — added `nw.allClear: "Tüm kalemler temiz"`.
- [x] `frontend/src/locales/en.ts` — added `nw.allClear: "All items are clear"`.
- **No backend changes. No migration needed.**

### Phase 34 — i18n TR/EN (2026-06-22)
- [x] `frontend/src/lib/i18n/` — locale JSON files for TR and EN; all UI strings keyed; translation lookup function.
- [x] `frontend/src/hooks/useLanguage.ts` — hook reads/writes language preference to localStorage; returns `{ lang, setLang, t }` where `t(key)` returns translated string for current lang.
- [x] `frontend/src/components/ui/Navbar.tsx` — TR/EN toggle button; calls `setLang`; re-renders all consuming components via hook state.
- [x] Backend LLM calls — `lang` param threaded through to all AI system prompts (coach, behavioral coach, progress comparison, networth insight, installments, personality); prompts now explicitly instruct model to respond in user's language.
- [x] `backend/app/api/chat.py`, `progress.py`, `insights.py`, `installments.py`, `personality.py`, `networth.py` — accept `lang: str = "tr"` query param; passed to relevant service functions; injected into system prompt header.

### Phase 33 — Real-time Asset Prices (2026-06-22)
- [x] `backend/app/services/asset_prices.py` — new service. `AUTO_FETCHABLE_TYPES = LIVE_VALUE_TYPES | MARKET_VALUE_TYPES`. `LIVE_VALUE_TYPES = {crypto, gold, foreign_currency, commodity}`. `MARKET_VALUE_TYPES = {stock, fund}`.
- [x] `fetch_crypto_price(symbol)` — uses shared `_fetch_crypto_rates()` from currency service (CoinGecko cache, 15 min TTL).
- [x] `fetch_gold_price()` — uses `_fetch_commodity_rates()` (XAU/USD, 1h TTL).
- [x] `fetch_commodity_price(code)` — uses `_fetch_commodity_rates()`.
- [x] `fetch_fiat_price(code)` — uses `_fetch_fiat_rates()`.
- [x] `fetch_stock_price(ticker)` — Yahoo Finance unofficial chart API `/v8/finance/chart/{TICKER}?interval=1d&range=1d`; per-ticker `_stock_cache`, 1h TTL; stale cache returned on fetch failure.
- [x] `_price_for_asset(asset)` — dispatches to right fetcher by `asset_type`, reads symbol/code from `source_detail` JSON.
- [x] `fetch_all_for_user(user_id, session)` — loops auto-fetchable assets, stores `last_price_usd + price_fetched_at` in `source_detail`, updates `as_of_date = today`; does NOT change `current_value` for live-value types (quantity intact). Returns `{updated, failed, details}`.
- [x] `POST /networth/assets/refresh-prices` — calls `fetch_all_for_user`, returns `RefreshPricesResponse`.
- [x] `frontend/src/lib/api.ts` — `RefreshPricesResult` interface; `refreshAssetPrices()`.
- [x] `frontend/src/app/networth/page.tsx` — `AUTO_PRICE_TYPES` constant; `getPriceBadge(asset)` freshness helper (<2 min emerald / <60 min emerald / <24h amber / else orange / no date = "Manuel" orange); "Fiyatları Güncelle" button with spinning `RefreshCw` icon; per-asset freshness badge pill; auto-refresh on page load when any auto-fetchable asset is stale (>1h).
- **No new migration**: `source_detail` (String 500, already exists) stores price metadata as JSON.

---

## Next Session — Start Here

**Phases 1–122 complete. Alembic head = 0045. LIVE at https://clarifin.xyz.** 2026-07-07 mega-session (113–121): credit-card variable-balance rework · onboarding processing overlay + stock name-search · .xls support (xlrd) · TRY/USD currency-persist fix · register-flash fix · Clarifin sender guard · notification redesign (expand + real outcomes) · monetization audit (copy honesty + vision upsells + weekly-brief paid gate) · Progress slimmed + Simulator in main nav · restart policies + deploy webhook · forgot password · GDPR account deletion (0045 + purge job) · SEO/OG/Plausible · real ToS/Privacy · business framing + Clar business persona.

### DEPLOY CHECKLIST for next release (new since 112)
1. `docker compose exec backend alembic upgrade head` → must say **0045**.
2. Backend image rebuild required (**requirements += xlrd==2.0.1**).
3. VPS one-time: install deploy webhook (see `deploy/README.md`) — systemd unit + nginx `/deploy-hook` + GitHub webhook secret.
4. Verify server env: `FRONTEND_URL=https://clarifin.xyz` (reset/verify links!) and `RESEND_FROM_EMAIL` address (display name now forced to "Clarifin" in code either way).

### DONE (audit fixes 1–6, deploy, billing — all shipped)
- ✅ Account ownership validation · category list unified (`core/categories.py`) · **cross-batch dedup fixed** (Phase 112) · upgrade-page honest copy · TR warnings now lang-aware · reports currency = user's `display_currency`.
- ✅ **Billing**: Paddle (not Stripe) — webhook + checkout + cancel live (Phase 106).
- ✅ **Deploy**: Contabo VPS + Docker + Nginx + Let's Encrypt; Resend domain verified (Phases 107–109).

### Pending (next)
1. **Automated tests** — still none; add backend + critical-path coverage (highest priority now that we're live).
2. **Post-launch monitoring** — error tracking, uptime, Paddle webhook delivery + DB backups on the VPS.
3. **Statement-bridge ekstre↔varlık auto-match** — verify on real statements across banks/formats (Phase 94 still flagged "needs live testing"; balance detection improved in 112).
4. **Scheduled proactive alerts** — wealth alerts still only check on page load; cron/scheduler for push.

### Next session setup:
- Use claude-opus-4-8 model
- **Shipped since last doc update**: light-first design-system overhaul (82), landing+pricing redesign (83), login/register redesign (84), upgrade page (85), pre-production — email verification + Redis rate limiter + plan system/upload cap, **migration 0036** (86), Home redesign (87), Transactions redesign (88), Cashflow/Recurring pass (89), Upload pass (90), Navbar + overlay light-mode fixes (91). Loop intact: Upload → Review → Brief → Home.
- **State: design system established (light default, teal #176B5B, terracotta negatives). Email verification + Redis limiter + free/plus/pro plan + upload cap all live behind `get_verified_user` / `effective_plan`.**
- **Pending: (1) deploy to production** — Railway backend + Vercel frontend; **SECRET_KEY + RESEND_API_KEY + REDIS_URL** via platform env; `docker compose` now includes Redis; `alembic upgrade head` (→0042) on cold start. **(2) billing integration** — `/upgrade` only captures interest in localStorage; wire real checkout → webhook sets `plan`/`plan_expires_at`.
- **⚠ Untraced runtime quirk**: solid `bg-<token>` utilities (e.g. `bg-surface`, `bg-neg`) don't paint reliably while `text-`/`border-` tokens do. Overlays + selected-state fills mitigated with explicit inline colors; trace + fix the channel-token bg CSS layer.
- **Next product bet (IMPORTANT)**: cash flow ↔ net worth bridge — see the IMPORTANT block under Current Status (onboarding ekstre→varlık asset/liability suggestion + ekstre↔varlık auto-match to update asset balance).
- Deferred items live in "Known deferred (post-57)" under Current Status.

### Product vision (updated 2026-06-24):
- **Mizan is a financial chief of staff, not a dashboard.**
- **Brief and Simulator are the soul.** Dashboards are doorways, not destinations.
- **One sentence tells the user everything; everything else is behind a tap.** AI reduces friction, never adds it. Subtraction > addition.
- Target: global users replacing manual Excel tracking of complete financial life. Freemium. NOT Turkey-specific — any bank, currency, language.
- Founder's reference user: brother who tracks everything in Excel manually (his "too complex" feedback is the product compass).

### Open known issues (minor, fix later):
1. **History chart needs 2+ snapshots** — NetworthSnapshot only populates on page load. Will self-populate after 2 visits.
2. **Wealth alert bell needs refresh-prices first** — `last_price_usd` only exists after price refresh. Alert check skips assets with no price data.
3. **Proactive scheduled alerts** — wealth alerts only check on page load. Redis + Celery or cron needed for push notifications.
4. **i18n coverage incomplete** — some components still have hardcoded TR strings.
5. **Edit flow edge cases** — minor edge cases in networth page edit modal wiring.

Pre-flight (if docker was restarted):
```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current   # must say 0038 (head)
```

Quick smoke-test:
```bash
curl -s http://localhost:8000/currency/list | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['fiat']), 'fiat,', len(d['crypto']), 'crypto')"
# → 166 fiat, 100 crypto
```

---

## Backlog (priority order)

### Cash flow ↔ Net Worth bridge (ekstre→varlık) — IMPLEMENTED Phase 94, needs live testing
- **DONE — ekstre→varlık.** After upload, `statement_bridge.py` detects closing balance + kind, proposes asset (deposit) / liability (credit card) via `NetworthSuggestion` (propose→confirm). Surfaced on Brief + Net Worth. Global, no Turkish hardcoding. Balance detection = running-balance-column delta (direction picks current end) + header/date-order + labelled-footer fallbacks; PDF/CSV/XLSX.
- **PARTIAL — ekstre↔varlık auto-match.** Institution fuzzy-matches an existing deposit asset (≥0.6) → `asset_balance_update` SETs Asset.current_value to the detected closing balance. Wired end-to-end but **NOT yet live-tested** — verify across real banks/formats + edge cases (this is the remaining work).
  - Reuse reconciliation_items pattern (propose → user confirms), not silent overwrite.

1. **Fix known issues** (1 item listed in Known Issues section) — do before new features
2. **Real-time price refresh** — `GET /networth/assets/{id}/refresh-price` → calls asset_prices.py per type
3. **Global market search** — stock ticker search + fund ISIN lookup via chosen providers; current Phase 23 stores structured fields but does not fetch full global search results yet.
4. **Cash flow calendar** — ✅ Done (Phase 32)
5. **Multi-language** — i18n setup, TR/EN toggle, locale stored in user profile, AI prompts use user locale
6. **Deployment** — Railway backend + Vercel frontend; RESEND_API_KEY + SECRET_KEY via platform env; alembic head on cold start
7. **Smart duplicate detection** — manual entry + statement overlap: check (date, amount, desc[:30]) before insert
8. **Mobile responsive overhaul** — TransactionTable horizontal scroll, progress chart height, GoalsPanel form layout
9. **SME/KOBİ mode** — multi-account, team members, invoice tracking, accounts payable/receivable
10. **Notification system** — budget alerts, upcoming payments, goal milestones via email (Resend) + push
11. **Redis rate limiter** — replace in-memory RateLimiter (resets on restart) with Redis; needed for multi-process
12. **Layer 3 vision LLM** — wire PDF parser stub; GPT-4o vision for low-confidence OCR pages
13. **Multi-statement overlap warning** — surface before committing duplicate transactions from re-upload
14. **Resend domain** — verify `noreply@mizan.app` in Resend; use `onboarding@resend.dev` for dev

---

## Junior Engineer Notes

### Why three separate Docker services instead of one monolith?

Each service has a different **failure domain** and **scale axis**:
- Postgres crashes → only DB is affected; backend can restart independently
- Backend needs more CPU for LLM calls → scale backend replicas, not Postgres
- Frontend needs CDN/static hosting → deploy frontend to Vercel, keep backend on a VM
- One service failing shouldn't cascade. Three services = three independent blast radii.

### What is a Docker named volume and why does Postgres need it?

A **named volume** (`postgres_data`) is storage managed by Docker that lives outside any
container. When you run `docker compose down`, containers are destroyed — but named volumes
persist. If Postgres used a bind mount or no volume, all your data would vanish on restart.
Named volumes also perform better than bind mounts on macOS (no file system translation overhead).

### Why does `depends_on: condition: service_healthy` matter?

Docker starts containers in dependency order, but "started" ≠ "ready". Postgres container
starts in milliseconds, but the Postgres process inside takes 3-5 seconds to initialize.
Without `condition: service_healthy`, the backend starts, tries to connect, gets
"connection refused", and crashes. The health check (`pg_isready`) polls until Postgres
actually accepts connections, then Docker starts the backend. Order enforced = no race condition.

### Why is `NEXT_PUBLIC_API_URL=http://localhost:8000` correct even inside Docker?

The frontend JavaScript runs in the **user's browser**, not inside the Docker network.
The browser has no idea what `http://backend:8000` means — that hostname only resolves
inside the Docker network. The browser can reach `http://localhost:8000` because Docker
maps container port 8000 to host port 8000. So the env var uses `localhost`, not `backend`.

### What Phase 1 builds on this foundation

Phase 1 adds the data layer:
- SQLAlchemy models define the database schema
- Alembic migrations version-control schema changes (like git for the DB)
- The upload endpoint gives users a way to submit data
- PDF parser extracts raw text that the LLM will categorize in Phase 2
Everything in Phase 0 (config, CORS, health check, provider abstraction) is infrastructure
Phase 1 builds on without modification.
