# Clarifin Full-Stack AI Developer Egitim Plani

## Amac

- Hedef: Clarifin'i ezberlemek degil; **sifirdan proje dusunebilen, sistem tasarlayabilen, teknolojileri nedenleriyle secebilen, agent ile bilincli uretebilen, canli urunu teknik olarak savunabilen full-stack AI developer refleksi** kazanmak.
- Ogrenim sekli: **harmonik spiral**. Konular ayri dersler gibi kopuk islenmez; fikir, frontend, backend, database, AI, deploy ve sunum surekli birbirine baglanir.
- Plan 3 buyuk parcaya bolunur.
- Sure temelli plan yok. Ilerleme `Part / Spiral / Node` ile takip edilir.
- Ana dil Turkce. Teknik terimler English kalir. Interview hazirligi icin kritik kavramlarda kisa English phrasing eklenir.
- Kullanici CSE temeli olan ama web stack, modern framework, deploy, AI engineering ve production pratiklerinde sifira yakin biri kabul edilir.

## PLAN.md Kurallari

- `CLAUDE.md` = proje beyni. Projenin tarihcesi, karar kaydi, production durumu ve teknik gercekleri oradadir.
- `PLAN.md` = egitim/progress beyni. Nerede kalindigi, nasil anlatilacagi, sonraki node ve not sistemi buradadir.
- Her session basinda:
  - `PLAN.md` oku.
  - Su anki konumu soyle: `Part X / Spiral Y / Node Z`.
  - Kalan node'lari soyle.
  - Bugunku mikro hedefi soyle.
- Context dolmaya yakin:
  - Hemen kullaniciyi uyar: **"Context dolmaya yakin."**
  - `PLAN.md` progress guncelle.
  - Kullanicinin yeni session'da agenta vermesi gereken **siradaki net promptu** yaz.
  - Prompt sunlari icermeli:
    - mevcut konum,
    - son tamamlanan node,
    - siradaki node,
    - ogrenim kurallari,
    - not formatini,
    - devam hedefini.
- Her node sonunda:
  - Ogrenilen kalici fikir yaz.
  - Not blogu uret.
  - Sunum/interview cumlesi uret.
  - Progress guncelle.
- Her node anlatimi:
  - Kullanici sifir kabul edilir.
  - Python/TypeScript/React/FastAPI/SQL/Docker bilgisi gerekiyorsa konu icine yedirilir.
  - Teknik anlatim onceliklidir: nasil calisir, nasil yazilir, hangi dosyada/kodda gorulur.
  - "Neden" kismi felsefi uzatilmaz; teknik ihtiyac, problem, tradeoff anlatilir.
  - Alternatif sadece anlamli mimari/teknoloji kararlarinda verilir; her kucuk syntax konusu icin alternatif anlatilmaz.
  - Tutorial hell yoktur; her teknik bilgi Clarifin'de bir davranisa, dosyaya veya karar noktasina baglanir.
  - Zor veya soyut kisimlarda kullanici rahatlatilir: "Su an soyut gelebilir; birazdan X ile birlesince anlam kazanacak."

## Current Position

- Part: 1 - Fikirden Ilk Calisan Sisteme
- Spiral: 3 - Ilk Vertical Slice Mantigi
- Node: 3.1 - Vertical slice nedir?
- Status: Not started
- Last completed: Node 2.7 - Clarifin kus bakisi
- Last permanent idea: Clarifin repo'su kavramsal katmanlara bolunmustur: frontend `app/components/lib/locales`, backend `api/services/models/core`. Frontend kullanici deneyimini ve API client'i tasir; backend request, business logic, data model ve core altyapiyi ayirir. Backend dependency direction kuralı `api -> services -> models` olmalidir.
- Next: Spiral 3 / Node 3.1 ile devam et; vertical slice kavramini sifirdan anlat, neden katman katman devasa sistem kurmak yerine kucuk ama uctan uca calisan akis kuruldugunu Clarifin'in ilk `/health` + frontend fetch ornegiyle bagla.

## Not Formatı

````markdown
## Konu

### Teknik Tanim
...

### Nasil Calisir?
...

### Clarifin'de Nerede?
...

### Kod / Komut / Akis
```dil
...
```

### Neden Boyle?
...

### Interview Cevabi
...

### Ozet Metin
...

### Akilda Kalacaklar
- **...**
- ==...==
````

## Dinamik Kontrol

- Sabit mini quiz yok.
- Kontrol gerektiğinde yapilir:
  - "Bunu 12 yasindaki birine anlat."
  - "45 saniyelik interview cevabi ver."
  - "Bu route hangi service'e gider?"
  - "Bu komut ne yapar?"
  - "Alternatif sec ve savun."
  - "Burada bug ciksa nereden baslarsin?"
- Kontrolun amaci sinav yapmak degil, eksik noronu bulmaktir.
- Eksik varsa yavasla.
- Anlasildiysa derinles.
- Gereksiz test yok.

---

# Part 1 - Fikirden Ilk Calisan Sisteme

**Bitis noktasi:** kullanici Clarifin'i urun olarak anlatabilir, browser -> frontend -> backend -> API akisinin temelini bilir, repo iskeletini okuyabilir, frontend/backend/database rollerini temel duzeyde savunabilir.

## Spiral 1 - Urun Fikri ve MVP Refleksi

### Node 1.1 - Clarifin ne problemi cozer?

- Personal finance ve SME finance problemi.
- Kullanici neden finansal durumunu tek yerde gormekte zorlanir?
- Banka ekstresi, manuel veri, varlik, borc, alacak, cash flow ve net worth neden ayni resmin parcasi?
- Spreadsheet neden ilk basta yeterli gibi gorunur ama zamanla kirilir?
- AI burada sus degil; hangi noktada deger yaratir?
- Clarifin canli urun karsiligi:
  - upload,
  - review,
  - brief,
  - home,
  - money flow,
  - net worth,
  - assistant.
- Interview hedefi:
  - "Clarifin is a financial operating system that turns scattered financial data into structured transactions, net-worth context, and explainable AI guidance."

### Node 1.2 - Kullanici, persona, pain point, job-to-be-done

- Persona nedir?
- Individual user ve small business user farki.
- Pain point nasil yazilir?
- Job-to-be-done mantigi.
- Clarifin icin temel JTBD:
  - "Finansal verilerim daginik; ne oldugunu ve ne yapmam gerektigini anlamak istiyorum."
- Bu node'da UI feature listesine atlanmaz; once kullanici ihtiyaci netlesir.

### Node 1.3 - MVP nedir?

- MVP = en kucuk calisan deger birimi.
- MVP "az ozellik" degil, "dogru ogrenme araci"dir.
- Clarifin MVP cekirdegi:
  - statement upload,
  - transaction extraction,
  - transaction review,
  - short financial brief,
  - basic net worth model.
- Ertelenenler:
  - account connectivity,
  - advanced billing,
  - full monitoring,
  - perfect OCR,
  - every-country bank integration.
- Neden once vertical slice?

### Node 1.4 - Global urun karari

- No Turkish hardcoding ne demek?
- Dil, para birimi, banka, tarih ve sayi formati neden product architecture karari?
- "TRY default olsun" gibi kucuk gorunen kararlar global urunu nasil bozar?
- Clarifin'de:
  - `display_currency`,
  - language preference,
  - parser currency carry-through,
  - locale-aware UI.

### Node 1.5 - Ilk pitch

- 30 saniyelik teknik olmayan anlatim.
- 60 saniyelik teknik ozet.
- Staj sunumu icin ilk taslak.
- Interview icin "what did you build?" cevabi.

### Spiral 1 Consolidation - Yeni fikirden urunlesme yonune ilk dusunme sistemi

- Bir fikir geldiginde hemen teknoloji secilmez, once problem ve kullanici netlestirilir.
- Temel sorular:
  - Kimin hangi acisini cozuyoruz?
  - Kullanici bugun bu isi nasil cozuyor?
  - Mevcut cozum nerede kiriliyor?
  - Bu urun hangi job-to-be-done'u tamamliyor?
  - MVP hangi en kucuk uctan uca deger dongusu olmali?
  - Hangi varsayimlari hardcode edersek ileride mimariyi bozariz?
  - Bu proje 30 saniyede nasil anlatilir?
- Cikti: problem cumlesi, persona/JTBD, MVP loop, guardrails, ilk pitch.

## Spiral 2 - Web Uygulamasi Ne Demek?

### Node 2.1 - Browser, website, web app farki

- Browser ne yapar?
- Website ile web app arasindaki fark.
- Static content vs interactive application.
- Clarifin neden "web app"tir?

### Node 2.2 - URL, domain, route, page

- URL parcalari.
- Domain nedir?
- Path/route nedir?
- Frontend route ile backend API route farki.
- Clarifin:
  - `/home`,
  - `/upload`,
  - `/api` mantigi backend tarafinda endpointlerle temsil edilir.

### Node 2.3 - HTTP request/response

- Method: GET, POST, PATCH, DELETE.
- Path.
- Status code.
- Headers.
- Body.
- JSON.
- Clarifin:
  - `GET /health`,
  - `POST /upload`,
  - `GET /auth/me`,
  - `POST /assistant/chat`.

### Node 2.4 - Frontend ne yapar?

- HTML: structure.
- CSS: presentation/layout.
- JavaScript: behavior.
- TypeScript: type safety.
- React/Next: component ve routing framework.
- Clarifin frontend:
  - pages,
  - components,
  - API client,
  - state.

### Node 2.5 - Backend ne yapar?

- Request alir.
- Validation yapar.
- Business logic calistirir.
- Database ile konusur.
- External API/LLM call yapar.
- Response dondurur.
- Clarifin backend:
  - FastAPI routes,
  - services,
  - models.

### Node 2.6 - API nedir?

- API = iki sistem arasindaki sozlesme.
- Frontend backend'i function gibi cagiramaz; HTTP uzerinden API endpoint cagirir.
- Request/response modeli neden onemlidir?
- Clarifin:
  - `frontend/src/lib/api.ts` merkezi sozlesme noktasi.

### Node 2.7 - Clarifin kus bakisi

- `frontend/src/app` = routes/pages.
- `frontend/src/components` = reusable UI.
- `frontend/src/lib/api.ts` = backend client.
- `backend/app/api` = HTTP layer.
- `backend/app/services` = business logic.
- `backend/app/models` = database tables.
- `backend/app/core` = config, db, auth dependencies, scheduler.

## Spiral 3 - Ilk Vertical Slice Mantigi

### Node 3.1 - Vertical slice nedir?

- Feature'i katman katman degil, uctan uca kucuk calistirma.
- "Frontend var ama backend yok" veya "DB var ama UI yok" yerine kucuk canli akis.
- Clarifin ilk slice:
  - frontend page backend `/health` endpointini cagirir.

### Node 3.2 - Health check neden ilk endpoint olur?

- Servis ayakta mi?
- Docker healthcheck.
- Frontend backend'e ulasabiliyor mu?
- Production monitoring baslangici.

### Node 3.3 - Local development server

- Process nedir?
- Port nedir?
- `localhost` nedir?
- Frontend port 3000.
- Backend port 8000.
- Port collision ne demek?

### Node 3.4 - Frontend `fetch` ile backend'e nasil gider?

- `fetch` browser API'si.
- Promise ve async/await temel.
- JSON parse.
- Error handling.
- Clarifin:
  - `frontend/src/lib/api.ts`.

### Node 3.5 - Browser DevTools Network tab

- Request listesi.
- Method/status.
- Headers/body/response.
- Debug refleksi:
  - UI bozuksa once request gidiyor mu?
  - status ne?
  - response ne?

### Node 3.6 - Clarifin Phase 0

- `backend/app/main.py`.
- `frontend/src/app/page.tsx`.
- `frontend/src/lib/api.ts`.
- Bu dosyalar uzerinden ilk calisan sistem okunur.

## Spiral 4 - Repo ve Developer Zemini

### Node 4.1 - Repo nasil okunur?

- Entry point.
- Config.
- Dependency files.
- Folder structure.
- "Nereden baslarim?" refleksi.

### Node 4.2 - Terminal ihtiyac kadar

- `pwd`.
- `ls`.
- `rg`.
- `sed`.
- Komut ciktisi nasil okunur?
- Terminal dersi gibi degil; repo okurken kullanilir.

### Node 4.3 - Git ihtiyac kadar

- Working tree.
- Diff.
- Commit.
- Branch.
- Remote.
- GitHub PR ve issue mantigina hazirlik.

### Node 4.4 - `.env`, `.env.example`, `.gitignore`

- Secret nedir?
- Environment variable nedir?
- Neden `.env` commitlenmez?
- `.env.example` neden commitlenir?

### Node 4.5 - Dependency files

- Python: `requirements.txt`.
- Node: `package.json`, `package-lock.json`.
- Version pinning.
- Dependency risk.

### Node 4.6 - Clarifin klasorleri

- API layer.
- Service layer.
- Model layer.
- Frontend pages/components/lib.
- Alembic migrations.
- Docker files.

## Spiral 5 - Frontend Temeli

### Node 5.1 - HTML structure

- Element.
- Attribute.
- Semantic structure.
- Form/input/button.
- Accessibility temel.

### Node 5.2 - CSS box model ve layout

- Box model.
- Margin/padding/border.
- Flex/grid temel.
- Responsive design.
- Tailwind utility mantigi.

### Node 5.3 - JavaScript runtime, event, async

- Variable/function.
- Event handler.
- Promise.
- async/await.
- Browser runtime.

### Node 5.4 - TypeScript

- Type nedir?
- Interface nedir?
- Compile-time check.
- Runtime ile type farki.
- Clarifin API types.

### Node 5.5 - React component

- Component.
- Props.
- State.
- Render.
- Event handler.
- Conditional rendering.

### Node 5.6 - Next.js App Router

- `page.tsx`.
- `layout.tsx`.
- route folders.
- client component.
- server/client boundary.

### Node 5.7 - Clarifin frontend akisi

- Upload page.
- Review page.
- Brief page.
- Home page.
- Bu ekranlar kullanici yolculuguna baglanir.

### Node 5.8 - Merkezi API client

- Neden her component raw `fetch` yazmaz?
- Auth header merkezi.
- Error handling merkezi.
- Type merkezi.
- Clarifin: `frontend/src/lib/api.ts`.

## Spiral 6 - Backend Temeli

### Node 6.1 - Python syntax refresh

- Function.
- Class.
- Import.
- Type hints.
- Dataclass/Pydantic farkina hazirlik.

### Node 6.2 - Async Python

- `async`.
- `await`.
- Coroutine.
- Blocking vs non-blocking.
- Neden web backend'de onemli?

### Node 6.3 - FastAPI route

- Decorator.
- Path.
- Request parameters.
- Response.
- `@router.get`, `@router.post`.

### Node 6.4 - Router ve app registration

- Router neden var?
- `app.include_router`.
- API layer neden ince kalir?

### Node 6.5 - Pydantic model

- Request body validation.
- Response model.
- Field validation.
- 422 hatasi.

### Node 6.6 - Dependency injection

- `Depends`.
- DB session dependency.
- Current user dependency.
- Testability ve tekrar kullanilabilirlik.

### Node 6.7 - Error handling

- `HTTPException`.
- 401, 403, 404, 422, 500.
- Kullaniciya anlamli hata.
- Internal exception logging.

### Node 6.8 - Clarifin backend

- `backend/app/main.py`.
- `backend/app/api/upload.py`.
- `backend/app/core/config.py`.
- `backend/app/core/dependencies.py`.

### Node 6.9 - Alternatif karar

- FastAPI vs Django.
- FastAPI vs Flask.
- FastAPI vs Node/NestJS.
- Bu proje icin neden FastAPI mantikliydi?

---

# Part 2 - Data, Auth, Upload, AI, Finansal Domain

**Bitis noktasi:** kullanici Clarifin'in cekirdek sistemini anlatabilir: auth, DB, migrations, upload pipeline, parser, LLM categorization, review, brief, net worth, cash flow, assistant.

## Spiral 7 - Database ve Veri Modelleme

### Node 7.1 - Database neden var?

- Memory/file/localStorage neden yetmez?
- Concurrent user.
- Query.
- Durability.
- Backup.

### Node 7.2 - SQL temeli

- Table.
- Row.
- Column.
- `SELECT`.
- `INSERT`.
- `UPDATE`.
- `DELETE`.

### Node 7.3 - Primary key, foreign key, index

- Identity.
- Relationship.
- Lookup performance.
- Clarifin: user -> transactions.

### Node 7.4 - Transaction

- Atomicity.
- Commit.
- Rollback.
- Upload pipeline'da neden kritik?

### Node 7.5 - SQLAlchemy ORM

- Python class -> database table.
- Object ile row arasindaki iliski.
- ORM neyi kolaylastirir, neyi saklar?

### Node 7.6 - Async session

- Request basina session.
- Connection pool.
- `expire_on_commit=False`.
- Async implicit IO riski.

### Node 7.7 - Alembic migration

- Schema evrimi.
- Revision chain.
- Upgrade/downgrade.
- Production deploy'da migration.

### Node 7.8 - Clarifin modelleri

- User.
- Transaction.
- Asset.
- Liability.
- Receivable.
- Account.
- ProgressInsight.
- AssistantAction.

### Node 7.9 - Money data hassasiyeti

- Float neden riskli?
- Decimal/Numeric.
- Currency code.
- Date/timezone.
- Locale formatting.

### Node 7.10 - Alternatif karar

- PostgreSQL vs SQLite.
- PostgreSQL vs MongoDB.
- ORM vs raw SQL.

## Spiral 8 - Auth ve Security

### Node 8.1 - Authentication vs authorization

- Kim oldugunu bilmek.
- Ne yapmaya yetkili oldugunu bilmek.

### Node 8.2 - Password hashing

- Hash nedir?
- bcrypt.
- Salt.
- Raw password neden saklanmaz?

### Node 8.3 - JWT

- Token nedir?
- Claims.
- Expiry.
- Authorization header.
- Frontend local storage riski.

### Node 8.4 - Verified user dependency

- Email verification.
- `get_verified_user`.
- Route gate.

### Node 8.5 - User preferences

- Language.
- Display currency.
- Plan.
- Account type.

### Node 8.6 - Secrets

- `SECRET_KEY`.
- API keys.
- Env vars.
- Log safety.

### Node 8.7 - CORS ve trust boundary

- Browser security.
- Origin.
- Why explicit frontend URL.
- Public/private service boundary.

### Node 8.8 - Rate limiting

- Abuse prevention.
- Redis.
- In-memory vs shared limiter.

### Node 8.9 - Clarifin auth flow

- Register.
- Login.
- Verify.
- Upload gate.
- Plan gate.

## Spiral 9 - Upload Pipeline

### Node 9.1 - File upload teknik temeli

- multipart/form-data.
- UploadFile.
- File bytes.
- Streaming vs in-memory.

### Node 9.2 - File validation

- MIME.
- Extension.
- Size limit.
- Empty file.
- HTTP error mapping.

### Node 9.3 - CSV parsing

- Delimiter.
- Encoding.
- Header mapping.
- Amount/date normalization.

### Node 9.4 - PDF parsing

- Text extraction.
- Table extraction.
- PDF layout zorlugu.

### Node 9.5 - OCR

- Scanned PDF.
- Tesseract.
- Image preprocessing.
- OCR failure modes.

### Node 9.6 - Vision LLM

- Image input.
- Structured extraction.
- Cost/accuracy tradeoff.
- Paid plan gate.

### Node 9.7 - ParseResult

- `success`.
- `empty`.
- `failed`.
- `reason`.
- User-facing failure UX.

### Node 9.8 - Persist step

- RawTransaction.
- Transaction ORM.
- Bulk insert.
- DB transaction.

### Node 9.9 - Batch isolation

- `upload_batch_id`.
- Duplicate statement detection.
- Cross-batch vs same-batch.

### Node 9.10 - Review/edit flow

- User confirmation.
- `source=user_confirmed`.
- Trust before analysis.

### Node 9.11 - Clarifin dosyalari

- `backend/app/api/upload.py`.
- `backend/app/services/pdf_parser.py`.
- `backend/app/services/transaction_service.py`.
- `frontend/src/app/review/page.tsx`.

## Spiral 10 - AI Engineering

### Node 10.1 - LLM call teknik temeli

- Model.
- Messages.
- Prompt.
- Temperature.
- Tokens.
- Latency/cost.

### Node 10.2 - OpenAI-compatible SDK

- Client.
- Base URL.
- Model name.
- API key.

### Node 10.3 - Provider abstraction

- DeepSeek primary.
- OpenAI fallback.
- Call sites provider secmez.
- Vendor lock-in azalir.

### Node 10.4 - Categorization

- Batch prompt.
- JSON parse.
- Fallback category.
- User correction learning.

### Node 10.5 - Prompt reliability

- Model output contract degildir.
- Markdown fence.
- Invalid JSON.
- Truncated output.
- Defensive parsing.

### Node 10.6 - Structured action pattern

- LLM action onerir.
- Backend action schema dogrular.
- User confirm eder.
- Backend uygular.

### Node 10.7 - Rule engine + LLM narrator

- Money math deterministic.
- LLM numbers uydurmaz.
- LLM anlatir, karar motoru onerir.

### Node 10.8 - Guardrails

- No invented numbers.
- No securities advice.
- Language preference.
- Locale-aware response.

### Node 10.9 - Clarifin AI dosyalari

- `backend/app/services/llm_provider.py`.
- `backend/app/services/categorizer.py`.
- `backend/app/services/brief.py`.
- `backend/app/services/networth_guidance.py`.
- `backend/app/services/assistant.py`.

### Node 10.10 - Alternatif karar

- Direct API calls everywhere vs provider abstraction.
- Hosted model vs local model.
- Deterministic rules vs LLM-only system.

## Spiral 11 - Finansal Domain

### Node 11.1 - Transaction

- Debit.
- Credit.
- Category.
- Source.
- Batch.

### Node 11.2 - Cash flow

- Income.
- Expense.
- Net.
- Calendar month.
- Projection.

### Node 11.3 - Net worth

- Assets - liabilities.
- Snapshot.
- Breakdown.

### Node 11.4 - Asset modelleme

- Cash.
- Bank account.
- Crypto.
- Stock.
- Gold.
- Manual asset.
- Quantity/unit/current value.

### Node 11.5 - Liability modelleme

- Debt.
- Monthly payment.
- Due date.
- APR.
- Reminder.

### Node 11.6 - Receivable modelleme

- Alacak.
- Expected date.
- Collection.
- Linked asset.

### Node 11.7 - Currency conversion

- Recorded currency.
- Display currency.
- Rate cache.
- UI formatting.

### Node 11.8 - Statement period vs calendar month

- Statement analysis period.
- Home calendar month.
- Why mismatch can confuse users.

### Node 11.9 - Recurring detection

- Subscription.
- Installment.
- Recurring income.
- Merchant grouping.

### Node 11.10 - Scorecard, simulator, reports

- Health score.
- Scenario simulation.
- Export/report.
- Deterministic vs narrative pieces.

### Node 11.11 - Clarifin ekran baglari

- Money Flow.
- Net Worth.
- Progress.
- Reports.
- Simulator.

## Spiral 12 - Product UX ve Activation

### Node 12.1 - First value moment

- Kullanici ilk faydayi ne zaman hisseder?
- Upload -> brief akisinin onemi.

### Node 12.2 - Onboarding neden kisa olmali?

- Friction.
- Trust.
- User intent.

### Node 12.3 - Upload loading state

- Kullanici beklerken ne oldugunu anlamali.
- Technical latency product experience'a donusur.

### Node 12.4 - Review screen guven problemi cozer

- AI/OCR hatasi olabilir.
- User edits trust boundary'dir.

### Node 12.5 - Brief screen tablo yerine anlati verir

- Raw table yerine interpretation.
- First payoff.

### Node 12.6 - Home dashboard degil doorway

- Kullaniciya her seyi yigmamak.
- En onemli next action.

### Node 12.7 - Empty state ve failure state

- Sifir veri.
- Parse failed.
- Payment gate.
- Upgrade prompt.

### Node 12.8 - i18n/l10n

- Language.
- Currency.
- Date.
- Number.
- Copy ownership.

### Node 12.9 - ClarTour

- In-app product education.
- Spotlight, route transition, target selectors.

### Node 12.10 - Product kararini teknik kararla beraber savunma

- UX karari teknik mimariye baglanir.
- Example: review page requires editable transaction API.

---

# Part 3 - Production, Agentic Coding, Sektor, Sunum

**Bitis noktasi:** kullanici canli deploy zincirini, Docker/Nginx/domain/SSL/payment/email entegrasyonlarini, agentic coding best practice'lerini, sunum ve mulakat savunmasini yapabilir.

## Spiral 13 - Docker ve Calistirma Ortami

### Node 13.1 - Process ve dependency problemi

- "Works on my machine" problemi.
- Runtime dependency.
- Version mismatch.

### Node 13.2 - Docker image

- Image nedir?
- Layer mantigi.
- Base image.

### Node 13.3 - Docker container

- Running instance.
- Isolation.
- Environment variables.

### Node 13.4 - Docker volume

- Container silinince data ne olur?
- Named volume.
- Postgres persistence.

### Node 13.5 - Docker network

- Service-to-service hostname.
- Internal network.
- Public port binding.

### Node 13.6 - Dockerfile

- `FROM`.
- `WORKDIR`.
- `COPY`.
- `RUN`.
- `CMD`.
- Dev vs production command.

### Node 13.7 - Docker Compose

- Multiple services.
- `depends_on`.
- Healthcheck.
- Env file.
- Ports.

### Node 13.8 - Local dev volume mount

- Hot reload.
- Source code mount.
- Tradeoff: production'da farkli.

### Node 13.9 - Clarifin Docker yapisi

- Postgres.
- Redis.
- Backend.
- Frontend.
- `docker-compose.yml`.
- `backend/Dockerfile`.
- `frontend/Dockerfile`.

### Node 13.10 - Alternatif karar

- Local install vs Compose.
- Compose vs Kubernetes.
- Self-hosted DB vs managed DB.

## Spiral 14 - Production Deploy

### Node 14.1 - Development vs production

- Hot reload vs stable process.
- Debug logs vs secure logs.
- Localhost vs public internet.

### Node 14.2 - Build nedir?

- Next build.
- Python dependencies.
- Docker image build.
- Static/runtime distinction.

### Node 14.3 - VPS nedir?

- VM.
- CPU/RAM/disk.
- Ubuntu server.
- SSH mental model.

### Node 14.4 - Domain ve DNS

- Registrar.
- A record.
- Apex.
- www.
- DNS propagation.

### Node 14.5 - Nginx reverse proxy

- Public 80/443.
- Internal 3000/8000.
- Proxy headers.
- Static frontend vs API backend routing.

### Node 14.6 - HTTPS ve TLS

- Certificate.
- Let's Encrypt.
- Certbot.
- Renewal.

### Node 14.7 - Production env vars

- Server secrets.
- API keys.
- Frontend public env vs backend secret env.

### Node 14.8 - Migration on deploy

- `alembic upgrade head`.
- Cold start.
- Schema compatibility.

### Node 14.9 - Healthcheck, logs, restart

- Docker healthcheck.
- Container logs.
- Restart policy mental model.

### Node 14.10 - Backup ve monitoring

- DB backup.
- Uptime.
- Error tracking.
- Webhook delivery monitoring.

### Node 14.11 - Clarifin canli zinciri

- Namecheap -> Contabo -> Nginx -> Docker -> Next/FastAPI -> Postgres.

## Spiral 15 - External Services: Billing ve Email

### Node 15.1 - External API nedir?

- Third-party service.
- API key.
- Request/response.
- Failure dependency.

### Node 15.2 - Webhook nedir?

- External service backend'imize event gonderir.
- Checkout success neden source of truth degildir?

### Node 15.3 - Signature verification

- HMAC.
- Constant-time compare.
- Fail closed.

### Node 15.4 - Paddle Merchant of Record

- Tax/compliance.
- Card data bizde degil.
- Subscription state.

### Node 15.5 - Plan gating

- Free.
- Plus.
- Pro.
- `is_paid` vs `is_pro`.

### Node 15.6 - Billing cancel flow

- Cancel at period end.
- Webhook downgrade.
- UI state.

### Node 15.7 - Resend email

- Outbound email API.
- From address.
- API key.

### Node 15.8 - Email verification

- Signed token.
- Expiry.
- Resend verification.

### Node 15.9 - SPF/DKIM/DMARC

- Domain verification.
- Deliverability.
- Spoofing prevention.

### Node 15.10 - Clarifin external-service dosyalari

- `backend/app/services/paddle.py`.
- `backend/app/api/webhooks.py`.
- `backend/app/api/billing.py`.
- `backend/app/api/email.py`.

### Node 15.11 - Interview cumlesi

- "Webhook is the source of truth for subscription state."

## Spiral 16 - Testing, Debugging, Reliability

### Node 16.1 - Bug, regression, edge case

- Bug nedir?
- Regression nedir?
- Edge case nasil bulunur?

### Node 16.2 - Unit test

- Kucuk fonksiyon.
- Deterministic logic.
- Fast feedback.

### Node 16.3 - Integration test

- API + DB.
- Service interactions.

### Node 16.4 - E2E test

- Browser flow.
- Upload -> review -> brief.

### Node 16.5 - Manual QA

- Product feel.
- Visual state.
- Edge file testing.

### Node 16.6 - Browser DevTools

- Network.
- Console.
- Storage.

### Node 16.7 - Backend logs

- Request logs.
- Exception trace.
- Security-safe logging.

### Node 16.8 - DB inspection

- Querying tables.
- Checking migrations.
- Data consistency.

### Node 16.9 - Migration drift

- Dev `create_all` vs Alembic.
- Production schema truth.

### Node 16.10 - Async/race bugs

- Concurrent request.
- Single-flight.
- Cache invalidation.

### Node 16.11 - Production incident thinking

- Triage.
- Rollback.
- Logs.
- User impact.

### Node 16.12 - Clarifin acik riskleri

- Automated tests eksik.
- Monitoring/backups gelistirilmeli.
- OCR edge cases.
- Dependency/security updates.

## Spiral 17 - Agentic Coding Mastery

### Node 17.1 - 2026'da developer rolu

- Implementer.
- Orchestrator.
- Reviewer.
- System designer.

### Node 17.2 - Agent'a dogru gorev verme

- Context.
- Goal.
- Constraints.
- Acceptance criteria.
- Verification.

### Node 17.3 - Explore-first workflow

- Once repo oku.
- Sonra plan.
- Sonra edit.
- Sonra verify.

### Node 17.4 - Plan mode vs execution mode

- Ne zaman plan?
- Ne zaman implement?
- Mutating vs non-mutating action.

### Node 17.5 - Small diff, verify hard

- Kucuk degisiklik.
- Odakli test.
- Regression risk.

### Node 17.6 - Memory

- `CLAUDE.md`.
- `PLAN.md`.
- Session continuity.
- Context compacting.

### Node 17.7 - Skills

- Ne zaman skill yazilir?
- Reusable workflow.
- Domain-specific instructions.

### Node 17.8 - MCP

- External tool/context entegrasyonu.
- Repository, docs, browser, database gibi kaynaklari agenta baglama.

### Node 17.9 - Hooks

- Otomatik kontrol.
- Guvenlik.
- Commit-time validation.

### Node 17.10 - Subagents

- Arastirma.
- Audit.
- Test.
- Refactor.
- Context bloat azaltma.

### Node 17.11 - Agent security

- Prompt injection.
- Unknown repo zero-trust.
- Shell command riski.
- Secret leakage.

### Node 17.12 - Kaynaklar

- Claude Code best practices.
- Claude Code memory.
- Claude Code hooks.
- Claude Code skills.
- Claude Code subagents.
- Anthropic Building Effective Agents.

## Spiral 18 - Sektor Okuryazarligi

### Node 18.1 - GitHub etkin kullanimi

- Trending.
- Stars.
- Issues.
- PRs.
- Releases.

### Node 18.2 - Engineering blog okuma

- Company engineering blogs.
- Postmortems.
- Architecture writeups.

### Node 18.3 - Reddit/Hacker News takip

- Noise vs signal.
- Discussion reading.
- Tool discovery.

### Node 18.4 - Hugging Face

- Models.
- Spaces.
- Datasets.
- Model cards.

### Node 18.5 - Kaggle

- Notebooks.
- Datasets.
- Competitions.
- Practical ML exposure.

### Node 18.6 - Changelog disiplini

- Next.js.
- FastAPI.
- OpenAI/Anthropic.
- Postgres.
- Security advisories.

### Node 18.7 - AI model/API degisimlerini izleme

- Pricing.
- Context windows.
- Tool use.
- Structured output.
- Model safety.

### Node 18.8 - Portfolio ve CV dili

- Impact.
- Technical specificity.
- Tradeoff.
- Production proof.

### Node 18.9 - English technical communication

- Short phrases.
- Interview-ready wording.
- Architecture explanation.

### Node 18.10 - Haftalik sektor radar notu

- Agent web taramasi ile guncel gelismeleri getirir.
- Kullanici repo icine hapsolmaz.

## Spiral 19 - Sunum ve Interview Mastery

### Node 19.1 - 30 saniyelik pitch

- Non-technical.
- Clear problem.
- Clear solution.

### Node 19.2 - 2 dakikalik non-technical pitch

- User journey.
- Value.
- Live status.

### Node 19.3 - 8-10 dakikalik staj sunumu

- Problem.
- Architecture.
- Demo.
- Key decisions.
- Lessons learned.
- Next steps.

### Node 19.4 - Architecture diagram anlatimi

- Browser.
- Frontend.
- Backend.
- DB.
- AI providers.
- External services.
- Deploy.

### Node 19.5 - "Neden bu teknoloji?" soru seti

- FastAPI.
- Next.js.
- PostgreSQL.
- Docker.
- Redis.
- Nginx.
- Paddle/Resend.

### Node 19.6 - "Bunu gercekten sen mi yaptin?" junior interview savunmasi

- Kod akisini takip et.
- Karari nedenleriyle anlat.
- Eksikleri durustce soyle.

### Node 19.7 - Upload pipeline deep dive

- File validation.
- Parser.
- OCR/vision.
- Persist.
- Categorize.
- Review.
- Brief.

### Node 19.8 - Auth/security deep dive

- Password hash.
- JWT.
- Verified user.
- Rate limit.
- Secrets.

### Node 19.9 - DB/migration deep dive

- Models.
- Relationships.
- Alembic.
- Money precision.

### Node 19.10 - Docker/deploy deep dive

- Compose.
- Nginx.
- SSL.
- Env.
- Migrations.

### Node 19.11 - AI provider/LLM safety deep dive

- Provider abstraction.
- Guardrails.
- Deterministic money math.
- Structured actions.

### Node 19.12 - Zayif noktalari durust savunma

- Test eksikleri.
- Monitoring eksikleri.
- OCR limitleri.
- Dependency risk.

### Node 19.13 - CV bullet -> teknik kanit eslesmesi

- Her CV maddesi icin:
  - hangi dosyalar,
  - hangi karar,
  - hangi tradeoff,
  - hangi sonuc.

### Node 19.14 - Final mock interview

- HR pitch.
- Technical interview.
- Architecture defense.
- Debug scenario.
- Tradeoff scenario.

---

# Basari Kriteri

Kullanici ezbersiz savunabilir:

- Clarifin fikri nasil urune donustu?
- Web request browser'dan DB'ye nasil akar?
- Frontend/backend/database/AI/deploy rolleri ne?
- FastAPI, Next.js, PostgreSQL, Docker neden secildi?
- Upload pipeline nasil calisir?
- LLM nerede kullanilir, nerede kullanilmaz?
- Provider abstraction neden var?
- Money math neden deterministic?
- Docker Compose ve Nginx neden var?
- Canli deploy nasil calisir?
- Paddle/Resend webhook/email sistemi ne yapar?
- Agent'i nasil dogru kullanir, ciktisini nasil denetler?

Kullanici yeni proje fikrinde:

- MVP cikarir.
- Vertical slice tasarlar.
- Stack secimini savunur.
- Agent'a dogru is verir.
- Uretilen sistemi denetler.
- Sunum ve mulakatta alti dolu ozguvenle konusur.
