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

1. **USD subtitle cosmetic bug** — asset cards always show `{a.currency}` subtitle even when display currency matches. Fix: guard with `a.currency !== displayCurrency`.
2. **Duplicate detection false positives** — `possible_duplicate_transaction` producer flags same-batch transactions. Fix: only flag cross-batch.
3. **large_transaction producer** — too many false positives. Remove entirely from producers.
4. **Net worth historical chart** — no dated snapshots; assets only have current value.
5. **Asset allocation pie** — missing from networth page.
4. **Auto-archive stale items** — dismissed alerts, received receivables, accepted suggestions clutter UI after 30 days. Need: filter by created_at < now-30d OR add `archived_at` column.
5. **"Turkish personal finance" in system prompts** — coach.py, behavioral_coach.py, weekly_summary.py still say "Turkish". Replace with locale-aware: use user's language preference or `lang` param.
6. **Onboarding bank list** — onboarding/page.tsx hardcodes Ziraat/Vakıfbank/Yapı Kredi/Garanti/Diğer. Make generic: "Your bank" + any bank name input, or detect from uploaded PDF.
7. **Transactions SpendingChart** — basic bar chart, needs redesign (pie + trend combo, or area chart).

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
1. Read AGENTS.md fully
2. State current phase + last completed task in one sentence
3. Confirm next action before touching any code

### Session END or user says "update AGENTS.md":
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
2. Update AGENTS.md with everything done this session
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
- [x] `AGENTS.md` — this file

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

> **NOTE:** This file lagged behind `CLAUDE.md` (older Phase 34 / head 0022 content below). `CLAUDE.md` is the authoritative project brain — read it first. Summary of Phases 35–53 added below.

### Phases 35–48 (summary — see CLAUDE.md for detail)
- Asset subtype forms (per-type folder of sub-forms), TEFAS/real-estate/BES forms, Action Queue restructure, i18n TR/EN, real-time asset prices (asset_prices.py), reconciliation queue handlers, wealth alerts (0025), app notifications (0026), assistant_actions (0027), networth snapshot breakdown (0028), Home command-center page, scheduled scanning (APScheduler), global AI assistant (5 structured actions), net-worth attribution ("Net Worth Story"), cold-start onboarding rework.

### Phase 49 — Settings + Persistent Display Currency (2026-06-22)
- [x] `User.display_currency` (0029); /settings page (lang, currency, email, account); api.ts getDefaultCurrency/setDefaultCurrencyLocal + `mizan-currency-change` event; Navbar CurrencyMenu dropdown; currency threaded into Home/networth/cashflow.

### Phase 50 — Home/Cashflow Logic + Currency Fixes (2026-06-22)
- [x] CashFlowItem.overdue (receivables only; liabilities never overdue); month-anchored projection (month actuals + rest-of-month expected → projected_month_end); Home pulse converts via ccyFactor; action items link by source.

### Phase 51 — Money Flow Overhaul (2026-06-22)
- [x] Unified recurring engine (subscription_detect + installment → recurring.py, dedup); 3 tabs Activity/Upcoming/Recurring; /subscriptions+/installments → redirects; MoneyOverview header; SpendingChart CSS redesign; tx filters; `transaction.currency` (0030).

### Phase 52 — Net Worth P0-P3 (2026-06-22)
- [x] current_value→Numeric(28,8) + quantity + unit_code + accounts table + assets.account_id (0031); stock repricing (shares×price); FX-exposure panel; staleness badges.

### Phase 53 — Cohesion + Hardening (2026-06-22)
- [x] Removed ChatPanel, installments API, subscriptions GET endpoints, dead networth analyze modal, analyzeNetWorth fn; transactions empty state; progress mizan-data-changed listener; currency-assumption note; fixed _parse_as_of_date bug. All 5 assistant executors verified schema-safe.

### Phase 54 — Progress rebuild: Financial Health scorecard (2026-06-22)
- [x] `services/scorecard.py` + `GET /insights/scorecard`. Score 0–100 = 4 transparent pillars × 25 (savings, debt, discipline, growth). Also trajectory (real snapshots OR cash-flow reconstruction flagged `estimated`), annotations, drivers, milestones, goal streaks. Returns numbers+keys; frontend composes text. Progress page rewritten (hero verdict → pillars → trajectory chart → drivers → milestones → streaks + GoalsPanel → AlertsPanel → demoted PersonalityCard). Inflation panel removed. `Flame` icon; `scorecard.*` locale TR+EN.

### Phase 55 — Net Worth AI guidance (2026-06-22)
- [x] `services/networth_guidance.py` + `GET /networth/guidance` — rule engine PROPOSES, LLM NARRATES (guardrails). 8 plays (negative_nw, debt_load, high_interest_debt, emergency_fund, concentration, fx_concentration, savings_rate, stale_prices). 4-beat findings (observation→context→why→move) + executable hooks (refresh_prices/create_alert/set_goal/add_liability/discuss). Cached 24h, busted on asset/liability mutation. `GuidancePanel` replaces ai_insight blurb + warning banners; GlobalAssistant accepts `prefill`. Summary stopped generating unused ai_insight.

### Phase 56 — Net Worth polish + fixes (2026-06-22→06-23)
- [x] AllocationChart (interactive recharts donut + currency bars, replaces text FX breakdown). `assetDetailLabel` — readable per-type cards, NEVER raw JSON. History chart + nwDelta removed (estimated/misleading). "Fiyatları Güncelle" button removed → `Güncellendi HH:MM` badge (locale 24h/12h) + per-card "Son fiyat · anlık değil"; refresh single-flight (fixed parallel calls); wealth-alert skips foreign_currency. Hero currency race FIXED (lazy-init displayCurrency before first fetch). Guidance overspend FIXED (suppress when 90d trend contradicts single month / very-cushioned). Stock share back-fill on refresh.

### Phase 57 — Activation hardening (2026-06-23)
- [x] Audit (3 subagents). TIER 1: parse_statement try/except (no 500s); ParseResult `status`(success|empty|failed)+`reason`(encrypted_pdf|scanned_image|ocr_unavailable|unrecognized_format|parse_error)+`detected_currency`; `/upload` returns status/reason; frontend shows amber actionable msg, not green "0". TIER 2: onboarding Step 3 echoes entered value; Home `hasData=hasAssets||hasStatement`, statement-only user leads with Cash Flow Pulse. TIER 3: global LLM prompt + multi-format dates + `_normalise_amount` (TR `1.234,56` & US `1,234.56`) + bilingual word-boundary sign inference (fixed "pos" in "deposit") + currency carry-through (no silent TRY).

### Phase 58 — Onboarding conflict-aware flow (2026-06-23) [branch feat/onboarding-conflict-aware-flow]
- [x] `transaction.source` (0032): statement_parsed|user_estimate|user_confirmed|user_supplementary|manual. Threaded through insert_transactions + manual POST; coach notes estimates as approximate.
- [x] Multi-statement upload (running count, per-file list, cumulative income/expenses). Income step REMOVED (caused conflicts/confusion) → onboarding = statement → AI impression → Home; no manual income/spending; asset/liability moved to one-time Home tour card (`mizan_tour_shown`, deep-link `/networth?add=asset`).
- [x] `conflict_detection.py` simplified to ONLY `find_duplicate_batch` (date range + source/count); wired into upload → `duplicate_statement` reconciliation item. `POST /onboarding/analyze` returns ONLY `{summary}` (statement→2-sentence LLM read; none→null→welcome). No conflict-resolution UI.

### Phase 59 — PDF Layer 3 vision LLM (2026-06-23)
- [x] Image-only PDFs (pdfplumber+pymupdf=0 chars) route to vision BEFORE Tesseract. `_layer3_vision_extract`: per-page render→base64 PNG→vision→JSON; fallback to Layer 2 if no key/0 rows. `_parse_llm_json` hardened (dict-unwrap, truncated-array salvage, `type`/`transaction_type`).
- [x] `_VISION_MODEL=gpt-4o-mini` (gpt-4o tested 49/49 exact but cost). max_tokens=8000. **Page strip tiling** (`_STRIP_OVERLAP_FRAC=0.02`, top/bottom) — bigger digits after model's ~768px downsample → fewer misreads. Prompt: rightmost number=running balance NEVER amount; TR number format explicit; incoming Gönd/FAST/Havale/EFT=credit, **Virman to-account=debit** (removed "virman" from `_INCOME_KEYWORDS`). Ziraat scan: income exactly 47,000; residual = pixel-level digit misreads (scan-quality limit).

### Phase 60 — XLSX upload support (2026-06-23)
- [x] upload.py accepts xlsx MIME + `.xlsx` ext (octet-stream → ext is reliable signal); requirements += `openpyxl==3.1.5`; frontend pickers accept `.xlsx`.
- [x] `parse_xlsx`: (1) openpyxl read_only+data_only+keep_vba=False; (2) **raw zip/XML fallback** `_read_xlsx_rows_raw` when openpyxl crashes on styles ("expected Fill") — parses sharedStrings+styles+sheet via zipfile+ElementTree. **Cursor-based column tracking** (real bug: Ziraat cells omit `r` attr → all collapsed to col 0 → `(None,)` rows; cursor advances per `<c>`, explicit `r` resets). Inline strings, string dates, serial-date convert handled.
- [x] `_find_xlsx_table` global: header=first SHORT cell (≤30c) naming a date col; map by name + value-inference fallback (datetime→date, numeric-w-negatives→amount, longest-text→desc, other numeric→balance). Negative=debit/positive=credit. Verified: real 63-row Ziraat xlsx → raw reader → 43 tx, HTTP upload success.

### Phase 61 — Post-Upload Brief (2026-06-23)
- [x] Upload no longer dumps user into a tx table → narrative read (5 beats, 60–90s). `services/brief.py` `build_brief(job_id,user_id,session,lang)`: one batch's tx + category aggregates + `analyze_recurring` → `{period, flow, top_categories[3], largest_transaction, recurring_signal, suggested_action{key,label,href}, narrative}`. Dominant-ccy per batch (no cross-ccy). LLM narration (provider abstraction, user lang) + **deterministic template fallback** (no key). `suggested_action` deterministic from net/commitments.
- [x] `GET /upload/brief?job_id&lang`: cached per `(job_id,lang)` in ProgressInsight `data_type="brief"` (no new table); 404 on empty batch → frontend silent fallback. `app/brief/page.tsx` full-attention (navbar hidden), 100ms stagger beats, per-beat "Mizan'a sor →" dispatches `mizan-open-assistant` w/ prefill. `Brief` type + `getBrief()`; `brief.*` locale.

### Phase 62 — Home ↔ Brief coherence (2026-06-23)
- [x] Brief = statement PERIOD, Home = CALENDAR MONTH → looked contradictory. Home pulse: calendar-basis label (`"Haziran ayı · takvim bazlı"`/`"June · calendar month"`); bridge link `"Son ekstre analizi: 18 May–18 Haz →"` → `/brief?job_id` when statement analysed ≤7d. localStorage `mizan_last_brief_job_id` = JSON `{job_id,start,end,ts}` written by brief page on load. Brief secondary CTA period-aware. Shared `fmtDateRange` (noon-anchored). Keys `home.monthCalendarSuffix/lastBriefLink`, `brief.viewAllPeriod`.

### Phase 63 — Multi-statement upload + Review/Edit (2026-06-23)
- [x] Catch parse errors before the brief narrates them. `GET /upload/review/{batch_id}` (owner-scoped tx). `PATCH /upload/review/{batch_id}`: update edited (→`source=user_confirmed`), insert new manual (batch dominant ccy), delete removed; ownership via id-in-own-batch (forged ignored); busts insight+progress caches (latter clears brief cache → regenerates). `/upload` multi-file (per-file status, sequential) → `/review?batch_ids=…`. `app/review/page.tsx` editable table (date/desc/amount+ccy/type-toggle/category), delete/add row, summary bar, **suspicious highlight** (amount>10×median OR dup date+desc) amber+tooltip; confirm PATCHes each batch → `/brief?job_id={first}`; cancel deletes batches → `/upload`. `ReviewTransaction` + `getReviewBatch/saveReviewBatch`; `review.*` + new `upload.*` locale.

### Phase 64 — Onboarding routes through review (2026-06-23)
- [x] Onboarding has-statement "continue" → `/review?batch_ids={all successful}` (was /brief) → review hands off to /brief. Both entry points share Upload → Review → Brief. **Full loop verified: Upload → Review → Brief → Home.**

### Phase 64.5 — Weekly Money Brief email (2026-06-23)
- [x] `services/email_brief.py` `generate_email_brief` (reuses brief engine; leads with what's NEW; meaningful-change gate → None when nothing crossed 5%). `api/email.py send_email_brief` (HTML+text, `RESEND_FROM_EMAIL`). `POST /notifications/send-email-brief` + scheduler **Sun 09:00 UTC** → shared `run_email_briefs()` (per-user isolated sessions — fixed MissingGreenlet; LLM narration off-loop). **Migration 0033** `last_email_brief_sent`; cadence skip <6d. Deferred: Resend domain verification.

### Phase 65 — Financial Simulator (2026-06-24)
- [x] `services/simulator.py` deterministic engine (baseline NW/liquid/90d surplus/debt schedule → month-by-month `_project`, frees debt payment after payoff). 5 levers (cancel_recurring/save_monthly/income_change/one_time_expense/prepay_debt). `GET /simulator/levers`, `POST /run` (structured), `POST /ask` (NL→LLM parse→run). `app/simulator/page.tsx`: NL box + builder + baseline-vs-scenario chart + delta cards. **Post-test**: narration deterministic (LLM removed), **uncertainty cone** (no fake precision), income direction toggle, "What I understood" lever chips, tightened NL parse. Navbar Sparkles, TR/EN. No new tables.

### Phase 66 — Landing redesign + navbar declutter (2026-06-24)
- [x] Landing reframed (chief-of-staff; product-preview mock; 4-beat loop; simulator spotlight; global stats); `landing.*` rewritten TR/EN. Navbar right side 7→4 items (currency · notifications · Upload · **account avatar dropdown** = email+lang+Settings+Reports+Logout).

### Phase 67 — Financial report export (2026-06-24)
- [x] `services/report.py build_report` (period-scoped, deterministic text, reuses NW-summary conversion) + `build_transactions_csv`. `GET /reports/financial` + `/reports/transactions.csv`. `app/reports/page.tsx`: light **print-optimized** doc (cover, hero verdict, KPI cards, **inline-SVG donut + area + bars**, statement, tables, recs); PDF via `window.print()` + `print-color-adjust:exact`; CSV download. No PDF backend dep. Discoverable via account dropdown. TR/EN.

### Phase 68 — Brazilian/Portuguese categorizer (2026-06-24)
- [x] Prompt rewritten language-agnostic + semantic (was Turkish keyword-match); international patterns (iFood/Rappi→restoran, etc.); PIX rail nuance. **New `faiz`** (interest income) wired everywhere. Language-gated BR pre-processing (`_looks_brazilian` ≥2 PT-distinct markers → `_expand_brazilian` bracketed hints). **Deterministic `_force_categories`** (LLM ignored hints): DA LIGHT/CEG/GÁS/ÁGUA/ENERGIA→fatura, SEGURO CART*/AP→fatura, ON IFD SUB→restoran, force-override + applied on LLM failure. Verified vs hostile/failing LLM.

### Phase 69 — Home redesign: subtraction mode (2026-06-24)
- [x] Removed 6+ panels (snapshot/ratios, action center, cash-flow pulse, upcoming, insight, quick-actions, checklist, tour). New Home (7.96kB→**4.7kB**): greeting + **one deterministic sentence** (tone dot) + "Ask Mizan about this →" (assistant prefill) + **"Needs you"** max-2 ranked + **3 soul tiles** (Money/Net Worth/Simulate) + tiny capture row; cold start = one line + Upload. `home.daily.*` TR/EN. Coach not spreadsheet; dashboards = doorways.

### Phase 72 — Audit fixes batch 1 (2026-06-24)
- [x] Dual Mim killed (GlobalAssistant FAB/bubble hidden on `/home`; home owns inline Mim). Brief ISO dates → locale range (noon-anchored). NW language mixing → locale keys. Currency chip in navbar (top-7 + all →, broadcasts `mizan-currency-change`).

### Phase 73 — Navigation cleanup (2026-06-24)
- [x] Reports → top nav (destination, not buried). Simulator → account dropdown (power tool). Dead routes removed (`/subscriptions`, `/installments` stubs + orphan links); money unified under MoneyTabs.

### Phase 74 — Empty states (2026-06-24)
- [x] Scorecard provisional (honest thin-data state vs fake ~57). Recurring/cashflow/progress get real first-run cards (what + CTA) not blank panels.

### Phase 75 — Mim unification (2026-06-24)
- [x] One voice via `companion/voice` (observe + escalation, deduped vs session memory). Character in chat panel (mood avatar, not generic bot). Session memory: `spokenKeysRef` + `escalationCheckedRef` (once/session, reset on `mizan-data-changed`). Proactive escalation leads with cross-page urgent before page observations.

### Phase 76 — Transactions page composition (2026-06-24)
- [x] Two windows clarified: MoneyOverview = calendar month (labeled); spending chart + table below = STATEMENT period. Spending chart now labels its window (`dateRangeLabel` or "all statements") so they don't read as one. `tx.spendingAll` key.

### Phase 77 — Full audit pass (2026-06-24): 6 CRITICAL · 15 HIGH · 7 MEDIUM · 3 LOW — all fixed
- [x] **Currency lazy-init everywhere**: home/reports/simulator/cashflow/MoneyOverview `useState(() => getDefaultCurrency())` (no TRY flash/wasted fetch); reports seeds lang via `getCurrentLang()`.
- [x] **CSV structured column mapping** (`pdf_parser._parse_csv_structured`): named-header CSVs mapped by column (Date/Desc/Amount/Type/Currency, multilingual) — Type authoritative for sign, Currency col + symbol detect — BEFORE regex fallback. Stops dropping standard rows.
- [x] **`currency_breakdown` native+display** (networth.py): `[{code, native_value, display_value}]`, no hardcoded TRY base; chips use display_value.
- [x] **Onboarding completion timing**: deferred to confirmed review (`?onboarding=1`) or skip path (not before review). Cancel-from-onboarding → back to onboarding.
- [x] **Onboarding manual-entry path**: "enter by hand" real — Add-manually opens AddTransactionModal in step 1.
- [x] **Fuzzy categorize** (assistant.py): `categorize_transaction` accepts `description` (substring→all; else best ≥0.6) across all batches; no ID needed. Turkish reason/keyword path gone.
- [x] **Turkish bank keywords removed**: `_generate_networth_suggestions` deleted (last TR-hardcoding); `suggestions` kept empty for compat.
- [x] **`.env.example` complete**: root + new `backend/.env.example`, all 10 settings, SECRET_KEY flagged required; `.env` gitignored (verified).
- [x] **Mobile review cards**: table `hidden sm:block`; `sm:hidden` editable card per tx (no h-scroll).
- [x] **Admin soft-delete + audit** (migration **0035**): `User.is_deleted` + `admin_audit_logs` (durable, plain-UUID + email snapshot). DELETE soft by default (`?hard=true` permanent), audit row FIRST either way. Soft-deleted can't log in (login + `get_current_user`), hidden from admin list/counts.
- [x] **401 console noise**: NotificationDropdown + MoneyOverview short-circuit `if (!getToken()) return`.
- [x] **Favicon**: `app/icon.svg` Mizan M monogram; stops `/favicon.ico` probe.
- [x] **Warmer dark palette**: cold grays → warm-graphite (R≥G≥B) all surfaces (`#1A1A1A`→`#1C1915`, `#2A2A2A`→`#2C2922`, `#0F0F0F`→`#11100E`); accents untouched; `color-scheme: dark` + soft off-white body text.
- [x] **Landing trust redesign**: removed AI-startup tropes (orbs/glow/gradient band/rainbow headline/pulsing dot) → ShieldCheck badge, solid type, soft-shadow depth, contained CTA. Chart gradients kept.
- [x] **Security**: SECRET_KEY required (no default, fail-fast); `/admin/scheduler/status` admin-authenticated.
- [x] **Manual tx always visible**: `get_transactions_for_user` default batch also includes `upload_batch_id IS NULL`.
- [x] **Scorecard currency**: per-tx convert to display ccy BEFORE aggregate (multi-ccy score fixed); downstream double-convert removed.
- [x] **Browser locale detection everywhere**: `detectBrowserLang`/`detectBrowserCurrency` seed lang+ccy for new visitors; login+register thread to backend.
- [x] **Cashflow `t.currency`** (was forced TRY). **Mim bubble** hidden on mobile (can't cover content).

### Phase 78 — Currency trust layer (2026-06-24)
- [x] **No silent ccy assumption**: `UploadResponse.currency_detected` = `detected_currency is not None`; False → stamped ccy is an INFERRED fallback to confirm.
- [x] **Review confirmation step**: inferred batches → `/review?inferred=<job_ids>` (URL → survives refresh). Amber "couldn't detect currency" card + `CurrencySelect`; **Confirm BLOCKED** until each inferred statement confirmed (PATCH writes per-row ccy).
- [x] **Per-currency totals**: review summary grouped BY currency (never mixed); `money()` currency-aware (BTC/XAU fall back to "1,234 CODE").
- [x] **Detected-vs-inferred badge** per batch ("detected from file" ✓ / "confirmed" + Change). `review.currency*` keys TR+EN.

### Phase 79 — Assistant context binding (2026-06-24)
- [x] **Scoped to statement**: brief "Ask Mizan" → `jobId` → `openMim` event → GlobalAssistant `scope` → `assistantChat(…, job_id)`. Backend `run_chat(…, job_id)` → `build_context` returns `_batch_scoped_block` (that batch's period/flow/top-cats/txns + "use ONLY these, don't mix other statements") and nothing aggregate; empty/unowned → normal fallback. Scoped open = fresh thread; FAB/bubble/close clear scope.
- [x] **Scope banner**: "Talking about: <period> statement" (📄). `assistant.scopedTo`/`scopedStatement` TR+EN.

### Phase 80 — Simulator + recurring consistency (2026-06-24)
- [x] **Sim NL horizon**: `_parse_horizon()` reads "for a year"/"12 months"/"2 years"/"6 ay"/"bir yıl"/"half a year"; trailing `\b` stops "monthly"→"month" ("save 500 monthly for 12 months"→12). Overrides UI; `ask()` mirrors back + Horizon chip (`sim.horizonChip`).
- [x] **Recurring confidence**: installment explicit "X/Y" `confidence="confirmed"` only ≥2 distinct months; one-off (`…11/12` date-misread) = `"possible"`. Implicit (≥3mo)/subs (≥2mo) confirmed. `api/recurring.py` returns confidence; "fixed load" excludes possible; recurring page shows amber "Possible" badge + re-type hint.
- [x] **One shared recurring source**: brief counts only confirmed; `cashflow.py` dropped its private recurring-debit detector → schedules commitments from `analyze_recurring` (confirmed subs+installments); recurring INCOME stays local scan. Brief/Recurring/Simulator/Cashflow agree.
- [x] **Action queue gated**: `reconciliation.py` open list sorts hardest-first, **caps at 3**, hides low-confidence heuristics (`possible_duplicate_transaction`/`large_transaction_review`/`low`) for accounts <7d. Resolved/dismissed full.

### Phase 81 — English UI + clarity polish (2026-06-24)
- [x] **EN guidance fix (NW)**: TR guidance persisted because `loadAll()` fetched once on mount under hook's initial "tr" w/ no refetch. Now uses `getCurrentLang()` on first load + effect refetches on `lang` change (cache key already includes lang).
- [x] **Assistant scoped opener**: opened-from-brief empty state shows `assistant.scopedGreeting` (not the "tell me your bank balance" cold start).
- [x] **Money Flow period labels**: spending breakdown prefixed "Statement period · <range>" (`tx.statementPeriod`) so it never reads as the calendar-month MoneyOverview spine; batch card + header already labeled.
- [x] **OCR triage in review**: `looksGarbled()` (6+ consonant runs / vowel-less long words / mostly-symbol) flags rows with amber border + inline "OCR likely garbled — re-type the description" (`review.ocrGarbled`, desktop+mobile), folded into `flaggedCount`.

### Phase 82 — Light-first design system (2026-06-25)
- [x] Light default + dark toggle. Channel CSS-var tokens (`:root` light / `[data-theme="dark"]`); Tailwind semantic colors (`canvas/surface/line/ink/brand/action/pos/neg/warn/danger`). `lib/theme.ts` + no-FOUC bootstrap. Indigo/violet → teal. Primary accent literal **#176B5B** (hover #125848); negatives terracotta **#B54747**. `tabular-nums` on body. ~44-file sweep.

### Phase 83 — Landing redesign + pricing (2026-06-25)
- [x] Pricing section (Free/Plus/Pro, Aylık↔Yıllık toggle, popular badge, single-currency by lang). Working TR/EN toggle. Interactive hero browser-frame mock (sparkline hover tooltip, asset-row hover). Section banding, hover-lift cards, dark-teal final CTA. Em dashes + AI-cliché badge removed; global navbar hidden on `/`.

### Phase 84 — Login/Register redesign (2026-06-25)
- [x] Tabbed card (active = solid teal), theme + lang toggles, teal focus inputs. Plan-aware: landing Plus/Pro → `/login?mode=register&plan=…`; reads `?mode`/`?plan`, "selected Plus" banner, plan-registration → `/upgrade?plan=…`. (`/register` doesn't exist; mode selects tab.)

### Phase 85 — Upgrade page (2026-06-25)
- [x] `/upgrade` (3 tiers, billing toggle, current-plan badge). Honest "payment not live" banner; paid CTA = localStorage interest capture (`mizan_upgrade_interest`), no fake checkout. Settings Plan card → /upgrade. Plan change admin-only.

### Phase 86 — Pre-production: verification + Redis + plans [migration 0036] (2026-06-25)
- [x] **Email verification**: `User.email_verified` (0036, existing→true). Signed `typ=email_verify` 24h token. Register sends Resend verify (best-effort). `POST /auth/verify-email`, `/auth/resend-verification`. `get_verified_user` → 403 `email_not_verified`. `/verify` page. Gates: upload + `/assistant/*` + `/simulator/*` + `/upload/brief`.
- [x] **Redis rate limiter**: `redis:7-alpine` + `REDIS_URL`; sorted-set sliding window w/ in-memory fallback; upload 3/10min per user+IP. `redis==5.0.8`.
- [x] **Plans**: `User.plan` + `plan_expires_at` (0036). `core/plans.py` (`effective_plan`, `vision_enabled`, `FREE_MONTHLY_UPLOAD_CAP=1`, `FREE_DAILY_ASSISTANT_CAP=10`). Free upload cap → 402 `upload_cap_reached`; vision paid-only. Assistant free 10/day → 429 `assistant_daily_cap_reached`. Admin can change plan (audited).

### Phase 87 — Home redesign (2026-06-25)
- [x] Mim front-and-center hero (size 92, speaking); clean verdict (em dashes removed). Hierarchy Mim → Needs you (+ collapsible calendar) → snapshot tiles → action buttons. Data-driven question rendered as a tappable **speech bubble** (tail to Mim, Send + ping) → `openMim`. Navbar active state = teal pill (was invisible). GlobalAssistant FAB hidden on Home but reappears after first open (`engaged`).

### Phase 88 — Transactions redesign (2026-06-25)
- [x] Teal count badge, proper Manuel Ekle. MoneyOverview rebuilt (Net headline + chips + footnotes); commitments → "Tekrarlayan taahhütler · N kalem" tappable + tooltip. Dark-row bug fixed (`#13110D` striping + skeleton); CategoryBadge → color-tinted pills (no dark `*-950`). Tap-to-edit hint, flex-wrap teal category chips, SpendingChart stacked bar + hover linking.

### Phase 89 — Cashflow + Recurring design-system pass (2026-06-25)
- [x] Dark-only colors → `pos`/`neg`/`warn` tokens + #176B5B; proper teal buttons, themed chips/badges/skeletons.

### Phase 90 — Upload design-system pass (2026-06-25)
- [x] Dropzone (Upload icon tile + browse button + teal drag), tokens/teal on cap/verify cards + file rows; spinner track fixed.

### Phase 91 — Navbar + overlay light-mode fixes (2026-06-25)
- [x] Navbar Upload + avatar (were `bg-brand`-invisible) → literal #176B5B. **Overlay transparency**: solid `bg-<token>` fills don't paint at runtime → overlays use explicit theme-resolved inline bg (`useTheme` → #FFFFFF/#1C1915): AddTransactionModal, CurrencyMenu, Navbar account dropdown, CurrencySelect. AddTransactionModal: CurrencySelect dropdown (dark headers/brand fixed), type buttons = solid inline fill (terracotta/green) + check when selected, auto-category clarified + hint, live preview chip.
- [x] **⚠ Untraced quirk**: solid `bg-<token>` utilities don't paint reliably (text/border tokens do) — overlays + selected fills mitigated with inline hex; fix the bg-token CSS layer later.

### Phase 92 — Auth + onboarding redesign (2026-06-26)
- [x] **Verification bypass closed**: `postAuthRoute()` (single source of truth: unverified→/verify, new→/onboarding, else→/home) on landing CTA/logo + login; guards on /home + /onboarding (`email_verified===false`→/verify). **Mim present** (new `MimGuide`, scripted = NO LLM) on register/verify/onboarding. Verify page → tokens + teal. **Free-tier no-LLM + upsell** (onboarding AI read paid-only; upload cap = Mim + value list → /upgrade). **Personal vs business flows** (distinct Mim/copy; Home emphasis: business=receivables tile, personal=simulator tile).

### Phase 93 — Registration + consent (2026-06-26) [migration 0037]
- [x] User +`full_name`/`country`/`marketing_consent`/`tos_accepted_at`/`tos_version`/`primary_goal` (0037 idempotent). register persists profile + **enforces ToS** (422), normalizes country; `/auth/preferences` accepts new fields (`primary_goal` validated). Form: required **country** (`CountrySelect`, Intl.DisplayNames), required **ToS+Privacy** (new `/terms` + `/privacy` pages), **unchecked marketing opt-in**. Onboarding goal step (tailored by account_type) → `primary_goal`.

### Phase 94 — Statement bridge ekstre→varlık (2026-06-26) [migration 0038]
- [x] **THE cash-flow↔net-worth bridge** (deterministic, NO LLM). `services/statement_bridge.py`: detect closing balance + kind + institution → propose asset (deposit)/liability (credit card) via `NetworthSuggestion` (propose→confirm; new `source_detail` JSON col, 0038). **Balance**: `_running_balance` = column whose row-to-row delta == signed amount (B is a running balance, no header needed); delta direction picks current end (chron→bottom, reverse→top); fallbacks header+date-order, labelled footer; PDF/CSV/XLSX. **Kind fixed**: structural credit-card markers (asgari ödeme/minimum payment strong, or ≥2) NOT tx descriptions. `accept_suggestion` branches: SET matched asset / create credit_card liability / create bank_account asset. Surfaced on Brief + Net Worth Smart Suggestions.

### Phase 95 — Add modals DS pass (2026-06-26)
- [x] AddAsset/Liability/Receivable: overlay see-through fixed (inline bg), tokens, teal CTAs, icon-chip headers; 5 asset-forms + sharedInputClass swept.

### Phase 96 — Review + Brief DS pass + Brief redesign (2026-06-26)
- [x] Review: stepper/toggles/cards → tokens + teal. **Brief redesign**: Mim hero (glow) + narrative lead, headline flow card (tiles + proportion bar), ranked categories, icon-chip beat headers, bridge/one-move on-system. Mim reads you your statement.

### Phase 97 — Page DS passes (2026-06-26)
- [x] Net Worth (hero trend chip, pillar/allocation polish, teal Add + empty states), Progress (bands/bars→tokens, sky→teal, tooltip fix; PersonalityCard redesign), Reports (fixed print colors + Excel export via openpyxl), Simulator (ask hero + sample chips + Mim-narrated + SSR currency fix), Settings/Admin/Navbar.

### Phase 98 — Free-tier assistant cap fixed (2026-06-26)
- [x] Cap was volatile (rate-limiter window only, resets on restart). Now **DB-backed**: counts user's `ConversationMessage` (role=user) in 24h vs `assistant_daily_cap` (10 free/None paid)→429; exchanges persisted so the count survives restarts/no-Redis. Limiter kept as burst guard.

### Phase 106 — Paddle billing (2026-06-27) [migration 0044]
- [x] **Paddle = Merchant of Record** (tax/compliance; no card data on us). `services/paddle.py`: HMAC-SHA256 `Paddle-Signature` verify (fails closed), price-id→plan, cancel/get-subscription (sandbox/prod). Webhook `POST /webhooks/paddle` (verify→resolve user via custom_data/sub-id/customer-id→activated/updated set plan+expires, canceled→free). Billing API `GET /billing/subscription` + `POST /billing/cancel` (`get_verified_user`). **0044**: users += paddle_subscription_id + paddle_customer_id. Frontend: `lib/paddle.ts` Paddle.js v2 checkout (custom_data {user_id,plan}), upgrade page real checkout + poll, settings cancel button. `.env` PADDLE_* / NEXT_PUBLIC_PADDLE_* (4 price IDs).

### Phases 107–109 — Production deploy + domain + email (2026-06-28)
- [x] **107 Deploy**: Contabo VPS (31.220.90.52, 4 vCPU/8GB, **Ubuntu 24.04**), Docker Compose (pg+redis+backend+frontend), **Nginx** proxy, **Let's Encrypt** SSL, `alembic upgrade head`→0044 on cold start.
- [x] **108 Domain**: **clarifin.xyz** @ Namecheap, DNS A→31.220.90.52, SSL active → **https://clarifin.xyz**.
- [x] **109 Resend**: **clarifin.xyz verified** (SPF/DKIM/DMARC) → outbound email to ALL users (was sandbox-only).

### Phase 110 — Rebrand Mizan → Clarifin (2026-06-26/27)
- [x] **Product Mizan→Clarifin** all user-facing text (titles, navbar, landing, login/register, emails, reports, locales, LLM persona "You are Clarifin"); var/file/table/endpoint names + comments unchanged; favicon M→C teal; email `@clarifin.xyz`. **Companion Mim→Clar** (displayed name only — component/var/file names `Mim`/`MimGuide`/`AskMim` UNCHANGED).

### Phase 111 — ClarTour interactive tour (2026-06-28)
- [x] Intercom-style walkthrough (`components/ClarTour.tsx`, in root layout). Each step `route` (router.push) + `target` selector → poll/scroll/measure → **spotlight** (dim hole + teal ring + pulse) + **anchored tooltip** (auto-flip, arrow, Clar avatar, action chip, Back/Next/Skip, progress). Flow Welcome→Home→Money→Upload→NetWorth→Reports→Simulator→Progress→Assistant→Summary. Plan-tailored (Pro steps → upgrade nudge for non-Pro); kept corner offer + upgrade-unlock celebration. `data-tour` anchors added (home/networth/simulator/assistant) + navbar href targets.

### Phase 112 — Bug-fix batch (2026-06-27/28)
- [x] **Cross-batch dedup fixed** (`dedup_transactions_orm`): keeps max per-batch count per (date,amount,full-desc) — within-batch identical real rows survive, only cross-batch repeats removed. **Upload loading overlay** ("what Clar is doing" animated steps, SVG/CSS). **Statement bridge balance date-aware** (grid `_running_balance` reads balance on most-recent-dated row via `_balance_at_latest_date`/`_best_date_col` — fixes footer/out-of-order rows). **Onboarding**: lands on /home (goal step removed); trajectory-chart sign (estimated points floored at 0); default currency = statement ccy else USD, persisted.

---

## Current Status

**Phases 1–112 complete. Alembic head = 0044. LIVE IN PRODUCTION at https://clarifin.xyz.** Since 105: Paddle billing — webhook+checkout+cancel, **0044** (106); production deploy — Contabo VPS 31.220.90.52 (4 vCPU/8GB, Ubuntu 24.04), Docker Compose, Nginx, Let's Encrypt (107); domain clarifin.xyz @ Namecheap + SSL (108); Resend clarifin.xyz verified → email to all users (109); **rebrand Mizan→Clarifin + companion Mim→Clar** (110); ClarTour interactive tour (111); bug-fix batch — dedup/upload-overlay/statement-bridge-date-aware/onboarding (112). **Audit fixes 1–6 + billing + deploy all DONE. Pending: automated tests (highest priority now live), post-launch monitoring (errors/uptime/DB backups/Paddle webhook), statement-bridge auto-match live testing, scheduled proactive alerts.** (CLAUDE.md is authoritative for detail.) **Prod env on VPS: SECRET_KEY · DATABASE_URL · REDIS_URL · RESEND_API_KEY · DEEPSEEK/OPENAI · PADDLE_* (production keys, webhook secret, 4 price IDs) · NEXT_PUBLIC_PADDLE_* (client token, 4 price IDs).** **Design: light default, teal #176B5B primary (literal hex — `bg-<token>` solid fills have an untraced runtime paint quirk, so overlays + selected fills use inline colors), terracotta #B54747 negatives. Pricing (billing LIVE via Paddle): Free ₺0 · Plus ₺249/ay·₺2.090/yıl ($9/$79) · Pro ₺449/ay·₺3.790/yıl ($19/$169). Plan gating: is_paid (uploads/vision/brief) vs is_pro/get_pro_user (simulator/reports/guidance/proactive-Clar). IMPORTANT: cash flow↔net worth bridge (ekstre→varlık) IMPLEMENTED Phase 94 (statement_bridge.py — balance detect + asset/liability propose→confirm; balance detection improved 112); ekstre↔varlık auto-match wired but needs live testing.** **Vision: chief of staff, not dashboard. Brief + Simulator = soul; dashboards = doorways. One sentence + everything behind a tap; subtraction > addition.** Home (69) is now a one-sentence coach. Most of 65–69 verified by build/py_compile only (no live LLM key here). Loop: Upload → Review → Brief → Home (Phases 61–64). Brief reuses ProgressInsight `data_type="brief"` (no new table). Progress = Financial Health scorecard. Net Worth = GuidancePanel + AllocationChart (no history chart). Upload returns status/reason; parser is global. Deferred: `_generate_networth_suggestions` Turkish bank keywords; account connectivity (Plaid — deferred, manual-first chosen); CSV unquoted comma-thousands edge case; scorecard synthetic score when thin; real snapshots need time (trajectory estimated until then); P1-deep valuation migration; P2 tx↔account reconciliation.

**(historical, Phase 34) Phases 1–34 complete. Alembic head = 0022. No new migrations since Phase 32.**

Full stack: register/login → JWT → upload (rate-limited, busts caches) → 3-layer OCR → LLM extract → OCR cleanup → dedup → zero-amount filter → persist → LLM categorize (13 categories) → insight cache → LLM coach with corrections+notes injected → spending chart + progress page (LineChart 3-month trend + cross-batch-deduped category comparison + LLM one-liners, 24h cached) → PersonalityCard (5 types, cached per batch) → AlertsPanel (3 algorithmic detectors, dismiss persisted) → GoalsPanel (monthly budget vs actual) → ChatPanel (conversational coaching, behavioral profile memory, voice input, chat-based tx entry with confirmation card, sessionStorage prefill from alerts) → weekly email summary (Resend HTML, preferences toggle) → inflation-adjusted analysis (TUFE 2023-2026, real vs nominal per category, ProgressInsight cache).

### Migrations (partial/historical list — real head = 0044; CLAUDE.md has the full table)
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

### Known Issues (open)
- **Layer 3 vision LLM**: stub ready in pdf_parser.py, not wired. Needed for banks with fonts <8pt.
- **Rate limiter in-memory**: resets on backend restart. Redis needed for prod multi-process deploy.
- **Resend domain**: `noreply@mizan.app` hardcoded in api/email.py — must be a verified Resend domain in prod.
- **Migration drift in dev**: `create_all` adds base schema but not Alembic migrations. Must run `alembic upgrade head` then `alembic stamp HEAD` after fresh DB. behavioral_profiles.personality_cache + personality_batch_id had to be manually ALTER TABLE'd in current dev DB (same issue will recur on fresh DB — 0011 migration runs correctly on clean install).
- **TUFE rates 2025-2026**: approximate (TCMB trajectory estimates). Users see disclaimer. Real rates available from TÜİK monthly.
- **Subscription flag toggle**: UI supports toggle-off optimistically but backend has no "unflag" endpoint — only upsert. Visually works but flag is never deleted; workaround: flag to different value.
- **"Fiyatları Güncelle" button UX**: updates current_value for auto-fetchable assets (crypto, gold, stocks) but user may not understand scope. Needs tooltip explaining which asset types auto-refresh vs manual.
- **Reconciliation Action Queue**: Phase 31 action handlers (mark received, write off, delete duplicate batch) need live verification that items close and disappear correctly after action.
- **i18n coverage incomplete**: Phase 34 added locale files + useLanguage hook + navbar toggle, but some components may still have hardcoded TR strings not yet wired to translation keys.

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

### Phase 31 — Reconciliation Queue Action Handlers (2026-06-22)

#### Frontend
- [x] `frontend/src/lib/api.ts` — added `deleteBatch(batchId: string): Promise<void>`.
- [x] `frontend/src/app/networth/page.tsx` — `actionPending: string | null` state guards double-click; `handleReconciliationAction(item, action)` routes by `issue_type`:
  - `overdue_receivable`: "Mark Received" → PATCH receivable status; "Write Off" → DELETE receivable; "Dismiss" → mark item dismissed.
  - `received_receivable_missing_asset`: "Re-create Asset" → PATCH receivable status received (idempotent); "Mark Pending" → PATCH status pending; "Write Off" → DELETE receivable.
  - `possible_duplicate_transaction`: "Delete Older Duplicate" (red, only when ≥2 batch_ids in proposed_action) → `deleteBatch`; "Keep All" → mark resolved; "Dismiss".
  - `large_transaction_review`: "Confirm & Close" → mark resolved; "Ignore" → mark dismissed.
- [x] Severity badges color-coded: high=red, medium=amber, low=gray.
- [x] Context lines show transaction description for duplicates, amount/type for large tx.
- [x] `ReactNode` import fix: used `type ReactNode` from "react" not `React.ReactNode` — `React` not imported directly. `!!pa?.description` cast for `unknown` JSX conditional.

#### Architectural decisions
- **All backend endpoints already existed**: PATCH /receivables/{id}/status, DELETE /transactions/batch/{id}, PATCH /reconciliation/items/{id}/status. Phase 31 was frontend-only.
- **Proposed_action is Record<string, unknown>**: typed loosely so any issue type can store arbitrary metadata. Frontend reads keys like `batch_ids`, `transaction_ids` directly.

### Phase 32 — Cash Flow Calendar (2026-06-22)

#### Backend
- [x] `backend/app/api/cashflow.py` — new router `/cashflow`. `CashFlowItem` model: date, type, amount, currency, description, source, urgent. `CashFlowSummary` model: income/payment totals, projected_net, liquid_assets, ratio, warning, days.
- [x] `_next_monthly(base_day, today)` — uses `calendar.monthrange` to safely handle months with fewer days (e.g., day=31 in February).
- [x] `_liability_items()` — async, queries all user liabilities with monthly_payment; uses `due_date.day` as recurring payment day.
- [x] `_receivable_items()` — async, pending/overdue receivables with expected_date; overdue shown at today.
- [x] `_recurring_items()` — pure function, reuses ±10% variance + ≥2 months detection from subscriptions; debit→subscription, credit→recurring_income.
- [x] `GET /cashflow/upcoming?days=30` — merged, date-sorted list of all items.
- [x] `GET /cashflow/summary?days=30&display_currency=TRY` — cross-currency totals via `convert()`; liquid_assets = cash+bank_account asset values; warning when liquid < expected payments.
- [x] `backend/app/main.py` — cashflow_router registered.

#### Frontend
- [x] `frontend/src/components/ui/Icons.tsx` — added Calendar, ArrowDown, ArrowUp icons.
- [x] `frontend/src/lib/api.ts` — `CashFlowItem`, `CashFlowSummary` interfaces; `getCashFlowUpcoming()`, `getCashFlowSummary()` functions.
- [x] `frontend/src/components/ui/Navbar.tsx` — "Takvim" link with Calendar icon inserted between Net Değer and İlerleme.
- [x] `frontend/src/app/cashflow/page.tsx` — day selector (7/14/30/60/90); `TYPE_CONFIG` map for icon+color per item type; `AddPaymentModal` creates Liability record (feeds back into _liability_items); summary card (4 metrics, coverage %, red warning banner); timeline grouped by date with "Bugün"/"Yarın" badges; urgent days get red border highlight; `Intl.NumberFormat` with non-ISO fallback for crypto/commodity codes.

#### Architectural decisions
- **No new DB migration**: cashflow is pure computation from existing liabilities, receivables, transactions tables.
- **Recurring tx default currency TRY**: transactions table has no currency column. Accepted limitation. Fix needs currency column on Transaction or disclaimer.
- **AddPaymentModal creates Liability**: avoids one-off event table. Liability record feeds cashflow AND net worth naturally.
- **_recurring_items is pure**: no DB call, takes transaction list. Testable, no async complexity.

---

### Phase 33 — Real-time Asset Prices (2026-06-22)

#### Backend
- [x] `backend/app/services/asset_prices.py` — new service. `AUTO_FETCHABLE_TYPES = LIVE_VALUE_TYPES | MARKET_VALUE_TYPES`. `LIVE_VALUE_TYPES = {crypto, gold, foreign_currency, commodity}` — stored as quantity × asset_code, value is always live via conversion service. `MARKET_VALUE_TYPES = {stock, fund}` — stored as total value, quantity not tracked.
- [x] `fetch_crypto_price(symbol)` — uses `_fetch_crypto_rates()` from currency service (shared CoinGecko cache, 15 min TTL).
- [x] `fetch_gold_price()` — uses `_fetch_commodity_rates()` from currency service (XAU/USD, 1h TTL).
- [x] `fetch_commodity_price(code)` — uses `_fetch_commodity_rates()`.
- [x] `fetch_fiat_price(code)` — uses `_fetch_fiat_rates()`.
- [x] `fetch_stock_price(ticker)` — Yahoo Finance unofficial chart API `/v8/finance/chart/{TICKER}?interval=1d&range=1d`; per-ticker in-memory cache (`_stock_cache`), 1h TTL; stale cache returned on failure; User-Agent header set.
- [x] `_price_for_asset(asset)` — dispatches to right fetcher based on `asset_type`, reads symbol/code from `source_detail` JSON.
- [x] `fetch_all_for_user(user_id, session)` — loops auto-fetchable assets, calls `_price_for_asset`, stores `last_price_usd + price_fetched_at` in `source_detail`, updates `as_of_date = today`, commits. Does NOT change `current_value` (quantity stays intact for live-value types). Returns `{updated, failed, details}`.
- [x] `POST /networth/assets/refresh-prices` — calls `fetch_all_for_user`, returns `RefreshPricesResponse`.

#### Frontend
- [x] `frontend/src/lib/api.ts` — `RefreshPricesResult` interface; `refreshAssetPrices()`.
- [x] `frontend/src/app/networth/page.tsx` — imports `RefreshCw` + `refreshAssetPrices`.
- [x] `AUTO_PRICE_TYPES` set constant.
- [x] `getPriceBadge(asset)` helper: reads `source_detail.price_fetched_at`; returns `{label, cls}` for freshness badge. <2 min → "az önce" emerald; <60 min → "X dak önce" emerald; <24h → amber; else → orange. No fetchedAt → "Manuel" orange.
- [x] `refreshing: boolean` state + `handleRefreshPrices()`: calls API, reloads assets, shows toast with updated/failed counts.
- [x] "Fiyatları Güncelle" button in PageLayout action row alongside CurrencySelect; `RefreshCw` spins while loading.
- [x] Per-asset freshness badge rendered next to asset name as small pill.
- [x] Auto-refresh on page load: after `loadAll` detects any auto-fetchable asset with stale price (>1h or no `price_fetched_at`), triggers `refreshAssetPrices()` silently in background, reloads assets on success.

#### Architectural decisions
- **No new migration**: `source_detail` (String 500, already exists) stores price metadata as JSON. Avoids schema churn before quantity/value split is done.
- **current_value unchanged for live types**: crypto/gold/FX assets store quantity. Changing current_value to a TRY value would break the conversion math. Price freshness is shown via badge; live value is computed at display time.
- **Shared currency service caches**: crypto and commodity fetchers reuse the same CoinGecko/ER-API caches already used for currency conversion. No duplicate API calls.
- **Stock: no quantity stored**: Yahoo Finance gives per-share price. Without quantity, total value can't be recomputed. Refresh stores price in source_detail for display only.
- **Per-ticker stock cache separate**: `_stock_cache` is independent from `_crypto_cache`. TTL = 1h (daily close data doesn't change intraday).

### Phase 34 — i18n TR/EN (2026-06-22)
- [x] `frontend/src/lib/i18n/` — locale JSON files for TR and EN; all UI strings keyed; translation lookup function.
- [x] `frontend/src/hooks/useLanguage.ts` — hook reads/writes language preference to localStorage; returns `{ lang, setLang, t }` where `t(key)` returns translated string for current lang.
- [x] `frontend/src/components/ui/Navbar.tsx` — TR/EN toggle button; calls `setLang`; re-renders all consuming components via hook state.
- [x] Backend LLM calls — `lang` param threaded through to all AI system prompts; prompts now explicitly instruct model to respond in user's language.
- [x] `backend/app/api/chat.py`, `progress.py`, `insights.py`, `installments.py`, `personality.py`, `networth.py` — accept `lang: str = "tr"` query param; injected into system prompt header.

#### Architectural decisions
- **Language preference in localStorage**: no new DB column needed for MVP. Future: store in user profile so language persists across devices.
- **t(key) lookup at render time**: no build-time extraction, no i18next dependency. Simple dict lookup. Sufficient for current string volume.
- **LLM lang param default "tr"**: existing users and cached prompts continue in Turkish by default. Opt-in to EN via toggle.

---

## Next Session — Start Here

**Phases 1–122 complete. Alembic head = 0045. LIVE IN PRODUCTION at https://clarifin.xyz.** Phase 122: CC variable-balance REVERTED (normal liability again); snapshot re-upsert on asset/liability mutations (stale negative NW fix); notifications always use user.language (client ?lang=en param removed). (Older notes below are historical — CLAUDE.md is authoritative; see its Phases 113–121 for the 2026-07-07 mega-session: credit-card variable-balance rework (113), onboarding overlay + stock name-search (114), .xls/currency/register-flash/sender bug batch (115), notification redesign (116), monetization audit (117), Progress slim + SimulatorBridge (118), restart policies + deploy webhook + forgot password + GDPR deletion w/ migration 0045 (119), SEO/OG/Plausible + real legal (120), business experience (121).) **Deploy checklist: alembic → 0045, backend rebuild (xlrd added), VPS webhook one-time setup (deploy/README.md), verify FRONTEND_URL + RESEND_FROM_EMAIL env.**

Pre-flight (if docker was restarted):
```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current   # must say 0038 (head)
```

### Immediate fixes (do first, in order):
1. **USD subtitle bug** — asset cards always show `{a.currency}` subtitle. Fix: show only when `a.currency !== displayCurrency`. One-line frontend change.
2. **Duplicate detection false positives** — producer flags same-batch transactions. Fix: only flag cross-batch duplicates. Change in `reconciliation_producers.py`.
3. **Remove large_transaction producer** — too many false positives. Remove from `reconciliation_producers.py`. Keep: overdue_receivable, received_receivable_missing_asset, possible_duplicate_transaction.

### Next feature after fixes:
Proactive threshold alerts — user sets price/value threshold per asset on networth page. On price refresh, evaluate all thresholds, write `threshold_breach` to `reconciliation_items`. No new migration.

---

## Backlog (priority order)

### Next product bet — Cash flow ↔ Net Worth bridge (ekstre→varlık)
- **Onboarding ekstre→varlık akışı.** After statement upload, read closing/account balance from statement footer. Suggest as asset. Example: "Ziraat vadesiz hesap, ₺8,643 — varlık olarak ekleyelim mi?" → one tap creates Asset.
  - Credit card statement → suggest as **liability** (balance owed), not asset. Detect statement kind → asset vs liability.
  - Closing-balance parse = new parser job (footer / "bakiye" / "closing balance"). Global, not bank-specific. No Turkish hardcoding.
- **Ekstre↔varlık otomatik eşleştirme.** User has named asset (e.g. "Ziraat vadesiz") + uploads Ziraat statement → auto-detect match → offer "varlığını güncelle: ₺X kapanış bakiyesi". One tap updates Asset.current_value to statement closing balance.
  - Match heuristic: asset name ↔ statement institution/account hints (fuzzy, language-agnostic).
  - **The bridge**: cash flow (transactions) ↔ net worth (assets). Upload feeds net worth, not just spending.
  - Reuse reconciliation_items pattern (propose → user confirms), not silent overwrite.

1. **Immediate fixes** — USD subtitle, duplicate detection, remove large_transaction producer
2. **Proactive threshold alerts** — per-asset price thresholds → reconciliation_items on breach
3. **Net worth historical chart** — dated snapshots; area chart. Needs new table or event-log derivation.
4. **Asset allocation pie** — frontend only; distribution by type/currency on networth page.
5. **Transactions SpendingChart redesign** — replace bar chart with area or cash-flow panel.
6. **i18n coverage audit** — remaining hardcoded TR strings.
7. **Schema cleanup** — split `Asset.current_value` into quantity/value fields.
8. **Global market search** — stock ticker + fund ISIN live search.
9. **Deployment** — Railway + Vercel; alembic on cold start.
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
