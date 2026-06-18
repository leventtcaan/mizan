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

**Phases 1–7 complete.** Chat interface (transaction notes), behavioral vector (category corrections), and insight cache invalidation all live. 3 banks tested (Ziraat, VakıfBank, Yapı Kredi).

Full stack: register/login → JWT → upload (rate-limited) → 3-layer OCR → LLM extract → OCR description cleanup → dedup → zero-amount filter → persist → LLM categorize (13 categories) → insight cache check → LLM coach with behavioral context (corrections + notes injected) → spending chart → frontend display. Category correction invalidates insight cache → next /insights call regenerates with fresh behavioral context.

### Known Issues (open)
- **Layer 3 vision LLM**: stub ready, not wired. Needed for banks with fonts <8pt (some Ziraat mobile PDFs still misread at 400 DPI even after OCR post-processing).
- **Rate limiter is in-memory**: resets on backend restart. Redis needed for production multi-process deployment.
- **Migration drift in dev**: `create_all` adds base schema but not Alembic migrations. Must run `alembic upgrade head` in backend container after any fresh DB creation.
- **Insight cache `generated_at` timezone**: SQLite would return naive datetime; PostgreSQL returns tz-aware. Code uses `.replace(tzinfo=timezone.utc)` as safety — harmless on Postgres but check if switching DBs.

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

---

## Next Session — Start Here

**Next goal: month-over-month comparison (next highest ROI backlog item)**

Pre-flight (fresh DB or new machine):
```
# backend container
alembic upgrade head   # applies through 0006
pip install -r requirements.txt
```

Month-over-month tasks:
1. `backend/app/api/transactions.py` — add GET /transactions/summary?months=3 → aggregate debit totals by (category, year-month); return list[{month, category, total}]
2. `frontend/src/lib/api.ts` — add `getTransactionSummary(months)` + `MonthlySummary` type
3. `frontend/src/components/MonthlyChart.tsx` — grouped bar chart by month (recharts BarChart, one bar per category, x-axis = month)
4. `frontend/src/app/transactions/page.tsx` — fetch summary alongside transactions; render MonthlyChart below SpendingChart if ≥2 months of data exist

Start prompt:
```
Read CLAUDE.md. Phases 1–7 done. Start month-over-month comparison.
Add GET /transactions/summary endpoint aggregating debit totals by (category, year-month).
Build MonthlyChart frontend component. Wire into transactions page.
```

---

## Backlog (post-MVP, priority order)

1. **Month-over-month comparison** [NEXT] — `transaction_date` already in DB; aggregate by month, compute delta, show trend line on SpendingChart
3. **Manual transaction entry** — POST /transactions with amount/description/date/type; same categorize → coach pipeline
4. **Multi-statement management** — date-range index; overlapping upload detection; user sees "period already uploaded" warning; dedup by (date, amount, description)
5. **Goal setting** — user sets monthly budget per category; coach compares actuals to goals
6. **Subscription detection** — find recurring same-amount same-merchant transactions; surface as "you're paying X/month for Y"
7. **Installment analysis** — detect taksit patterns (e.g. 3×500 TRY → "you have 2 payments left on this purchase")

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
