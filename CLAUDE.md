# Mizan — Project Brain

## What Is This
Turkish personal finance behavioral coaching app. Users upload bank statements (PDF/CSV).
AI extracts transactions, categorizes them, finds behavioral patterns, coaches users on
WHY they overspend — not just what they spent. "Mizan" = balance/equilibrium in Turkish.

## Target User
Turkish individual. Has a bank account. Uploads PDF statements. Wants to understand
spending psychology, not just see pie charts. Probably frustrated that every finance app
just shows graphs without insight.

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
- [x] `backend/alembic.ini` — sqlalchemy.url points to localhost:5433 (Docker host port)
- [x] `backend/requirements.txt` — added alembic==1.13.0
- [x] `backend/app/main.py` — updated: upload router registered, create_all on startup in ENVIRONMENT=development

---

## Current Status

**Phases 1–14 complete.** Docker was unresponsive at end of session (disk full — now cleared). All code written; not yet tested after Phase 14.

Full stack: register/login → JWT → upload (rate-limited, busts caches) → 3-layer OCR → LLM extract → OCR cleanup → dedup → zero-amount filter → persist → LLM categorize (13 categories) → insight cache → LLM coach with corrections+notes injected → spending chart + progress page (LineChart 3-month trend + cross-batch-deduped category comparison + LLM one-liners, 24h cached) → PersonalityCard (5 types, cached per batch) → AlertsPanel (3 algorithmic detectors, dismiss persisted) → GoalsPanel (monthly budget vs actual) → ChatPanel (conversational coaching, behavioral profile memory, voice input, chat-based tx entry with confirmation card, sessionStorage prefill from alerts).

### Known Issues (open)
- **Layer 3 vision LLM**: stub ready, not wired. Needed for banks with fonts <8pt (some Ziraat mobile PDFs misread at 400 DPI).
- **Rate limiter is in-memory**: resets on backend restart. Redis needed for production multi-process deployment.
- **Migration drift in dev**: `create_all` adds base schema but not Alembic migrations. Must run `alembic upgrade head` then `alembic stamp HEAD` in backend container after fresh DB.
- **Insight cache `generated_at` timezone**: uses `.replace(tzinfo=timezone.utc)` as safety for SQLite compat — harmless on Postgres.
- **Progress cache key**: SHA-256(user_id + sorted batch_ids). Key changes on new upload (automatic miss). Category corrections bust explicitly.
- **Phase 14 untested**: docker was unresponsive at session end. First thing next session: restart docker, run alembic upgrade head through 0012, smoke-test personality + alerts endpoints.

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

## Next Session — Start Here

**Phase 14 code written but NOT tested — docker was unresponsive (disk full). First task: restart docker + run migrations + smoke-test.**

Pre-flight:
```bash
# 1. Restart docker desktop, then:
docker compose up -d

# 2. In backend container (alembic must reach 0012):
docker compose exec backend alembic upgrade head
# If error "can't locate revision 0011/0012" — run stamp first:
docker compose exec backend alembic stamp 0010
docker compose exec backend alembic upgrade head

# 3. Verify:
docker compose exec backend alembic current   # should say 0012 (head)
```

Smoke-test checklist:
1. GET /personality — returns PersonalityData JSON (or no-data state if no uploads)
2. GET /patterns/alerts — returns [] or list of Alert objects
3. POST /patterns/alerts/dismiss with `{"dismiss_key": "test"}` — 204, idempotent
4. Progress page /progress — PersonalityCard renders above AlertsPanel above GoalsPanel
5. AlertsPanel "Sohbete sor →" → navigates to /transactions, ChatPanel textarea pre-filled

After smoke-test passes → next goal: **subscription detection UI** (backlog) or **UI/UX polish**.

Start prompt:
```
Read CLAUDE.md. Phases 1–14 complete. Docker was unresponsive last session (disk full, now cleared).
First task: docker compose up + alembic upgrade head through 0012 + smoke-test personality and alerts.
If all green, start subscription detection UI or discuss next priority.
```

---

## Backlog (post-MVP, priority order)

1. **Smoke-test Phase 14** [IMMEDIATE] — restart docker, alembic upgrade head → 0012, test personality + alerts + chat prefill
2. **Subscription detection UI** — patterns.py already detects recurring + forgotten_subscription algorithmically; need dedicated /subscriptions page or section showing merchant name, monthly cost, months active, cancel CTA
3. **Installment analysis** — detect taksit patterns (3×500 TL same merchant ≈30 days apart → "2 taksit kaldı"); pure Python, no LLM; new service `installments.py`
4. **UI/UX polish** — mobile responsiveness; empty states; loading skeletons consistent across all panels; PersonalityCard fade-in animation
5. **Multi-statement overlap warning** — before insert, check (date, amount, desc[:30]) already exists for user; warn before committing duplicate
6. **Layer 3 vision LLM** — wire stub in pdf_parser.py; trigger when OCR confidence low; use GPT-4o vision with base64-encoded page image
7. **Redis rate limiter** — replace in-memory RateLimiter (resets on restart) with Redis; needed for multi-process production deploy
8. **Deployment** — Vercel for frontend (NEXT_PUBLIC_API_URL → prod backend URL); fly.io or Railway for backend + Postgres; env vars via platform secrets

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
