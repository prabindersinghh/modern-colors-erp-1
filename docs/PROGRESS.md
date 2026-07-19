# Modern Colours — Build Progress (LIVING LOG)

> **Purpose:** Append-only-ish running log so context never breaks between sessions.
> **After completing any build step, update this file**: what was built, what was tested,
> what's next. Read this + [`ARCHITECTURE.md`](./ARCHITECTURE.md) at the start of every session.

**Legend:** ✅ done · 🔄 in progress · ⬜ not started

## Build order & status

| # | Step | Status | Notes |
|---|------|--------|-------|
| 0 | Discovery + structural decisions | ✅ | Frontend = Vite (not Next). Existing prototype was Phase-2-scoped; keep shell, rebuild domain. Monorepo `frontend/`+`backend/`. Storage = Cloudflare R2 (disk fallback for dev). |
| 1 | Repo restructure + living docs | ✅ | Monorepo done. ARCHITECTURE.md + PROGRESS.md + README + architecture.png created. |
| 1b | Backend scaffold (NestJS + Prisma + Docker + config) | ✅ | package.json, tsconfig, nest-cli, main.ts, app.module, PrismaModule/Service, .env.example, docker-compose.yml. `npm install` ok (715 pkgs). `nest build` ✅ exit 0. |
| 2 | Prisma schema (all entities) | ✅ | Users/Roles, Catalogue, PO, POLineItem, Material(+status), QrCode, Setting, AuditLog. `prisma validate` ✅, `prisma generate` ✅. Migration NOT yet run (needs live Postgres). |
| 3 | Auth + RBAC (JWT, guards, seed admin) | ✅ | `auth`/`users`/`audit` modules. JWT login, JwtAuthGuard + RolesGuard + `@Roles` + `@CurrentUser`. Seed admin (idempotent). Migration applied to **Neon**. Verified e2e (login/me/403/401) + jest test for I5 (5/5 pass). + Security: fail-fast env validation, no secret fallbacks. |
| 5 | Settings (Claude API key) | ✅ | `settings` module + `CryptoService` (AES-256-GCM). Admin-only encrypt/mask/validate (live Claude check). `getDecryptedKey()` internal only (I2). 16/16 jest. e2e: status false, operator 403, bogus key → 400 CLAUDE_KEY_INVALID via real API. |
| 6 | PO upload + AI extraction + manual fallback | ✅ | `StorageService` (R2 + disk fallback), `purchase-order` + `ai-extraction` modules. Upload→PO_UPLOADED; extract via Claude forced-tool → POLineItems w/ catalogue match → AI_EXTRACTED; **manual fallback (I7)**; nothing persisted as Material pre-confirm (I1). 18/18 jest. e2e: upload 201, no-key→fallback, manual→EXACT/SIMILAR/NONE, materials=0, audit chain. |
| 7 | Operator review (edit/add/delete line items) | ✅ | Line-item CRUD on AI_EXTRACTED POs, re-runs catalogue match, marks `edited`, blocked post-confirm. |
| 8 | Confirm gate + Material registration + unique IDs + QR + label PDF | ✅ | `material` + `qr` modules. `POST /:id/confirm` (hard gate I1) → 1 Material/unit (I3) w/ `MC-000001` via Postgres sequence (I8) + QR each (data-URL); PO → OPERATOR_VERIFIED → REGISTERED. A4 label sheet (pdf-lib) via `StreamableFile` at `GET /purchase-orders/:id/labels.pdf`. e2e verified (5 units, sequential IDs, QR present, PDF 1.7). |
| 9 | Receiving: scan + manual weight + offline-idempotent | ✅ | `receiving` module. `POST /receiving/scan` (→ SCANNED, idempotent re-scan, I9), `POST /receiving/:uniqueId/weight` (→ READY_FOR_PRODUCTION; correction = audited new entry I4; weigh-before-scan → 400). e2e verified. |
| 11 | Dashboard (metrics, filters, search) | ✅ | `dashboard` module. `GET /dashboard/summary` (today's POs, received, pending scan/weigh, ready, supplier/material stats, PO status breakdown) + `GET /dashboard/search` (status/supplier/PO#/q/date filters). e2e verified. |
| 4 | Master Catalogue (import + CRUD + match) | ✅ | `catalogue` module. Column-tolerant CSV/Excel import (xlsx), CRUD (soft-delete), match (exact/similar/none, Levenshtein). RBAC: import/edit/delete=Admin, new-SKU create=Admin+Operator (daily new SKUs, provisional TMP- code). 11/11 jest pass; e2e verified (import 20, match 3 types, operator 201/403/200). |
| 10 | Audit logging threaded through all modules | ✅ | Invariant I4. Threaded through every module as it was built; extended to all Phase 2 and Phase 3 actions. |
| 12 | Frontend rebuild to Phase 1 + wire to API | ✅ | Real API client (JWT) + auth context + login + role-gated routes/nav. Pages: Dashboard, PO Upload, Review/Confirm (edit/add/delete + confirm gate), QR Labels (+PDF), Scan & Weigh (IndexedDB offline queue, I9), Master Catalogue (import/add), Settings (API key), Audit. `tsc`+`vite build` ✅. UI e2e via Playwright: login → live dashboard, settings, 21-SKU catalogue. |
| 13 | End-to-end pass | ✅ | Backend verified live on Neon (upload → confirm 5 units MC-000001… → scan → weigh → READY → labels PDF). Frontend verified via Playwright against the live API (auth, dashboard metrics, catalogue, settings). |

### Phase 2 — Requests, issuing & stock (complete)

| # | Step | Status | Notes |
|---|------|--------|-------|
| P2-1 | Roles + departments (OVERSIGHT, PRODUCTION_HEAD; PU/ENAMEL/POWDER) | ✅ | `Department` enum on User; `common/auth/department-scope.ts` centralises isolation (I10). |
| P2-2 | Production request creation (per-material lines) | ✅ | Head raises a request; `department` is **forced server-side** from the token, never taken from the body. |
| P2-3 | Catalogue-driven material picker | ✅ | Heads pick from the master catalogue so names match what Store will scan. |
| P2-4 | Store request inbox | ✅ | Per-LINE Accept / Partial / Reject with `approvedKg` + rejection reason; parent status derived from the line mix. |
| P2-5 | Scan & Issue (Add / Deduct / Discard) | ✅ | QR scan → unit → movement. Deduct is capped at `approvedKg`; over-deduction blocked (I11). |
| P2-6 | Live stock levels + append-only ledger | ✅ | `StockTransaction` + `Material.balanceKg` written in ONE transaction with `SELECT … FOR UPDATE`. |
| P2-7 | Admin (OVERSIGHT) oversight dashboard | ✅ | Read-only across all departments; every mutating route rejects OVERSIGHT. |
| P2-8 | Integration pass + written UAT script | ✅ | [`PHASE2_UAT.md`](./PHASE2_UAT.md) — client executes it. |
| P2-9 | Analytics dashboards for every login | ✅ | Role-specific KPI cards + recharts; low-stock red/amber alerts; heads see only their own department. |

### FIFO (First-In-First-Out) — complete

| # | Step | Status | Notes |
|---|------|--------|-------|
| F-1 | FIFO primitives | ✅ | `stock/fifo.util.ts` — `fifoSort` (arrivedAt asc, `uniqueId` tiebreak), `ageDays`, `ageingLevel`. |
| F-2 | Soft, non-blocking FIFO warning | ✅ | Deducting a newer unit while older stock exists warns and records a `FIFO_OVERRIDE` audit row — it never blocks. |
| F-3 | Ageing display | ✅ | Amber ≥ 30 days, red ≥ 60 days. Stock Levels sorts oldest-first; a Stock Ageing tab buckets fresh/amber/red. |
| F-4 | No migration | ✅ | Verified `arrivedAt` was 100 % populated first — FIFO needed **no schema change**. |

### Phase 3 — Finished Goods & Dispatch (complete)

| # | Step | Status | Notes |
|---|------|--------|-------|
| P3-1 | Schema + additive migration | ✅ | `20260719161842_phase3_finished_goods_dispatch`. Batch, ProductionOutput, FinishedGood, FinishedGoodQr; `DISPATCH` role; `BatchStatus`/`FgStatus`. All additive — `ProductionRequestItem.batchId` nullable, so the 17 existing rows were untouched. |
| P3-2 | Batch as a first-class record | ✅ | `@@unique([department, batchNumber])`. Heads open a batch or pick an existing one for a top-up. |
| P3-3 | Batch per request LINE | ✅ | `batchId` sits on the line, not the request, so one request can serve several batches. |
| P3-4 | Top-up: warn, don't block | ✅ | Requesting against a CONFIRMED/CLOSED batch warns and proceeds; consumption accumulates across requests. |
| P3-5 | Production output + confirm gate | ✅ | Head records product, package count, size, shade, date. Nothing is minted until `confirmed` (I12). |
| P3-6 | FG QR generation | ✅ | One `FG-000001` unit + QR per package, from its **own** Postgres sequence. `fgGeneratedAt` blocks double-minting. |
| P3-7 | Dispatch role + screens | ✅ | New `DISPATCH` role sees finished goods **only**; scan-to-dispatch, second dispatch of the same drum rejected. |
| P3-8 | Full traceability chain | ✅ | `GET /batches/:id/trace` → materials in (with source POs/suppliers) ↔ finished goods out. |
| P3-9 | Regression + isolation tests | ✅ | `phase1-access.spec.ts` (47 assertions — Operator/Supervisor keep every Phase 1 route) and `dispatch-isolation.spec.ts` (25 assertions — DISPATCH reaches no non-FG route). |

### Client feedback round (post-Phase-3) — complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| C-1 | "In-Hand" rename | ✅ | Terminology updated across the stock screens. |
| C-2 | Stock ageing display | ✅ | Ageing tab + amber/red badges on Stock Levels. |
| C-3 | QR generation speed | ✅ | **100 labels 8568 ms → 2555 ms (3.35×)**; PDF 1735 KB → 698 KB; ZIP 3580 → 1199 ms. |
| C-4 | Explicit Generate → Save → Print flow | ✅ | Each step is now a deliberate action instead of one implicit button. |
| C-5 | Review-before-issue gate | ✅ | Store reviews the line before the deduction commits. |
| C-6 | Actual quantity issued | ✅ | The weighed amount is captured, which may differ from the approved figure; both are kept. |


## Session log

### 2026-06-24 — Session 1
- **Discovery complete.** Read PRD v3.0. Scanned repo: existing Vite+React+TS+Tailwind+shadcn frontend
  prototype with good UI infra but Phase-2-scoped domain (Production/Warehouse/consumption). Backend: none.
- **Decisions confirmed with client:** keep frontend shell + rebuild domain; monorepo `frontend/`+`backend/`;
  Cloudflare R2 storage (with local disk fallback so dev isn't blocked).
- **Restructured repo** into `frontend/` (moved existing app) + reserved `backend/`. Added root `.gitignore`.
- **Created living docs:** ARCHITECTURE.md (architecture map + invariants I1–I9), this PROGRESS.md, README, architecture.png.
- **Backend scaffolded & verified:** NestJS 11 + Prisma 6 + config. `npm install` (715 pkgs), `nest build` exit 0,
  `prisma validate` + `prisma generate` pass. Dev `.env` created with random JWT_SECRET + ENCRYPTION_KEY (gitignored).
- **Prisma schema complete** (8 models, 4 enums) — see `backend/prisma/schema.prisma`. Encodes invariants
  I1–I4, I8 at the data layer (POLineItem working set vs Material; append-only AuditLog w/ self-reference; encrypted Setting).
- **ENV finding:** Docker is **not on PATH** in this shell. `docker-compose.yml` is provided (Postgres) but the
  user must have Docker Desktop running to `docker compose up -d`, OR point `DATABASE_URL` at any reachable Postgres.
  Migration (`prisma migrate dev`) is **deferred** until a DB is reachable. Building/compiling does not need it.
- **Next:** Step 3 — Auth + RBAC (JWT, guards, `@Roles`, seed admin), then Catalogue, Settings, etc.

### 2026-06-24 — Session 1 (cont.) — client corrections applied
- **Phase 2 excision (client correction).** Confirmed the prototype domain was Phase-2-modeled across
  27/40 files. Preserved the full prototype on the **`phase2-draft` git branch** (forked at commit cca9bfa),
  then on `phase-1` removed ALL Phase 2 code from the active app: pages (Dashboard/MaterialInward/Inventory/
  QRScanner/Production/Warehouse/Reports), domain hooks, mock services, and domain components (charts/inventory/
  material/qr). Stripped `types/index.ts` to generic types. App reduced to the reusable shell (ui/, common/,
  layout/) + Phase 1 nav + placeholder pages. **No Phase 2 route/type/component is reachable.**
  `npm run build` (tsc + vite) ✅ exit 0.
- **Database = Neon (client correction).** Docker dropped entirely: removed `docker-compose.yml`,
  updated `.env.example` + `.env` to Neon connection string format (`sslmode=require`), and documented in
  ARCHITECTURE.md §4 that Docker-Postgres must NOT be reintroduced. Awaiting the client's Neon `DATABASE_URL`.
- **Git:** working on `phase-1` branch (not main). `phase2-draft` preserves the prototype.
- **GATE:** Step 3 (Auth + RBAC) begins once the Neon `DATABASE_URL` is pasted into `backend/.env`
  (migrations + seed need a reachable DB). Auth code can be written meanwhile; verification needs the DB.

### 2026-06-24 — Session 1 (cont.) — Step 3: Auth + RBAC
- **Neon connected.** Client pasted the Neon `DATABASE_URL`. `prisma migrate dev --name init` applied the full
  schema to Neon (migration `20260624002144_init`). DB live.
- **Built `auth` + `users` + `audit` modules.** JWT login (`POST /api/auth/login`, `GET /api/auth/me`);
  `JwtStrategy` (re-checks user active on every request); `JwtAuthGuard` + `RolesGuard` + `@Roles()` +
  `@CurrentUser()`. Users CRUD is Admin-only. `AuditService` is append-only (no update/delete — I4); global.
  bcryptjs for hashing (pure-JS, no native build).
- **Seed admin** (`npm run seed`, idempotent) → `admin@moderncolours.local`. Created in Neon + audit row.
- **Verified end-to-end (curl):** admin login→JWT ✅, `/me` ✅, bad password→401 ✅, admin create operator→201 ✅,
  operator→`GET /users`→**403** ✅ (server-side RBAC I5), admin→200 ✅, no token→401 ✅, audit shows
  LOGIN/USER_CREATED/SEED_ADMIN_CREATED ✅. **Jest:** `roles.guard.spec.ts` 5/5 pass (locks I5).
- **Housekeeping:** added `.gitattributes` (LF normalization). `nest build` exit 0.
- **Next:** Step 4 — Master Catalogue module (Excel/CSV import + CRUD + match lookup for AI validation).

### 2026-06-24 — Session 1 (cont.) — Step 4: Master Catalogue
- **Built `catalogue` module.** Column-tolerant import (xlsx handles .csv/.xlsx; maps header variants,
  unknown cols → metadata, upsert by SKU). CRUD with soft-delete. Match util (Levenshtein similarity):
  EXACT (sku/name) / SIMILAR (≥0.82) / NONE — informational only, never gates (I6).
- **Client requirement baked in:** new SKUs arrive daily → operators can add a new SKU from a No-Match
  (with UI confirmation), additive + audited; provisional `TMP-XXXXXX` code auto-generated if no official
  SKU. Bulk import + edit/delete remain Admin-only.
- **Verified:** `nest build` exit 0; jest 11/11 (incl. match.util.spec); e2e curl — import sample CSV = 20 created,
  EXACT (score 1) / SIMILAR (0.94) / NONE; operator new-SKU → 201, operator bulk-import → 403, operator match → 200,
  provisional SKU + metadata confirmed.
- Sample CSV at `backend/prisma/sample-catalogue.csv` (20 realistic paint SKUs). Client's real ~70–600 SKU CSV
  to be dropped in when provided (importer should handle as-is).
- **Next:** Step 5 — Settings module (Claude API key: AES-256-GCM encrypt at rest, masked to FE, validate on save).

### 2026-06-24 — Session 1 (cont.) — Step 5: Settings (Claude API key)
- **Built `CryptoService`** (AES-256-GCM, key from `ENCRYPTION_KEY`) + **`settings` module**. Admin-only
  `GET/PUT/DELETE /api/settings/api-key`. PUT validates the key with a live 1-token Claude call (distinguishes
  invalid/quota/network), encrypts at rest, stores only a masked form; `getDecryptedKey()` is internal-only for
  the extraction module (I2). Full key never returned to any client.
- **Verified:** jest 16/16 (incl. crypto round-trip, unique IV, GCM tamper-detect, masking); e2e — status
  `configured:false`, operator → 403, bogus key validated against the real Claude API → 400 `CLAUDE_KEY_INVALID`.
- **GitHub:** pushed to `AmbreenSuri/modern-colors-erp`. Stripped all Claude co-author trailers from history per
  client request; future commits omit them. Wrote full technical README with banner.
- **Next:** Step 6 — PO upload + Claude extraction (uses `SettingsService.getDecryptedKey`) + manual fallback.

### 2026-06-24 — Session 1 (cont.) — Step 6: PO Upload + AI Extraction + manual fallback
- **`StorageService`** (global) — Cloudflare R2 (S3 API) with a local-disk fallback (`backend/.storage/`,
  gitignored) when R2 creds are absent; path-traversal guarded.
- **`ai-extraction` module** — pulls the decrypted key from Settings, sends the PO (PDF/image, base64) to
  Claude via a **forced tool call** (`record_purchase_order`) for reliable structured output; typed
  `ExtractionError` (no_key/invalid_key/quota/network/parse) so callers can fall back.
- **`purchase-order` module** — upload (→ storage + `PO_UPLOADED`), list/detail/file, `extract`
  (→ POLineItems with catalogue match → `AI_EXTRACTED`; on failure returns `{fallback:true}`, **I7**),
  and `manualEntry` (operator types the PO; same review-ready state). Editing the working set produces
  **no Material rows** — those wait for the confirm gate in Step 7 (**I1**).
- **Verified:** build 0; jest 18/18 (+ storage round-trip & traversal). e2e — upload 201; no-key extract →
  `fallback:true reason:no_key`; manual entry → EXACT/SIMILAR/NONE matches; `materials=0` pre-confirm;
  audit `PO_UPLOADED → AI_EXTRACTION_FAILED → PO_MANUAL_ENTRY`.
- **Git:** consolidated all Phase 1 work onto **`main`** (fast-forward) and pushed directly per client request.
- **Next:** Step 7 — Operator review/confirm (edit/add/delete line items) + the hard confirm gate that
  creates Materials.

### 2026-06-24 — Session 1 (cont.) — Steps 7–11: confirm gate, materials/QR, receiving, dashboard (backend complete)
- **Review + confirm (Steps 7–8):** line-item CRUD (edit/add/delete, re-match, blocked post-confirm); `confirm`
  is the hard gate (I1) — only there are Materials created: 1 per physical unit (I3), sequential `MC-000001`
  via a Postgres sequence (I8), each with a QR (data-URL); PO → OPERATOR_VERIFIED → REGISTERED, all audited.
  `qr` module builds A4 printable label sheets (pdf-lib) served as `StreamableFile`.
- **Receiving (Step 9):** scan → SCANNED (idempotent re-scan, I9); weight → READY_FOR_PRODUCTION; weight on an
  already-weighed unit = audited CORRECTION (I4); weigh-before-scan rejected.
- **Dashboard (Step 11):** live summary metrics + filtered search.
- **Fix:** binary endpoints (labels PDF, PO file) now return `StreamableFile` (raw bytes) — a returned Buffer was
  being JSON-serialized by Nest.
- **Verified end-to-end on Neon:** PO → manual entry (3 TiO2 + 2 Acrylic) → confirm → 5 units `MC-000001..5` with
  QR → scan (+idempotent re-scan) → weigh 24.8 → READY_FOR_PRODUCTION; weigh-before-scan 400; labels PDF (v1.7,
  40 KB); dashboard (todaysPOs/received/pending/ready/supplier stats). `nest build` 0; jest 18/18.
- **Backend is feature-complete for Phase 1.** Remaining: Step 12 frontend rebuild (wire Phase 1 screens to the
  API + IndexedDB offline queue), then a UI end-to-end pass.

### 2026-06-26 — Session — Step 12: Frontend rebuild (Phase 1 complete)
- **Foundation:** real REST client (`lib/api.ts`, JWT + 401 handling), `lib/auth.tsx` (AuthProvider/useAuth,
  session restore via `/auth/me`), `lib/offlineQueue.ts` (IndexedDB queue for scan/weight — I9 front-end side),
  domain types (`types/api.ts`). Login page + role-gated routes/nav (Audit = Admin/Supervisor, Settings = Admin).
- **Pages wired to the live API:** Dashboard (summary metrics + supplier/material stats), PO Upload (drag/drop
  + list), Review & Confirm (run extraction / manual fallback / edit-add-delete line items with match badges /
  confirm gate → registers units), QR Labels (unit list + print PDF), Scan & Weigh (scan → weight, offline queue
  + sync banner; weight auto-advances to READY_FOR_PRODUCTION — no separate tap), Master Catalogue (search,
  CSV/Excel import, add SKU), Settings (API-key status/save/remove), Audit Log.
- **Cleanup:** removed leftover mock `services/api.ts`, `useAsync.ts`, `PlaceholderPage.tsx`.
- **Verified:** `tsc -b && vite build` ✅. Playwright UI pass against live backend — login as admin → Dashboard
  shows live data (Received 5, Pending Scan 4, Ready 1, Acme 5), Settings (Not configured), Catalogue (21 SKUs).
- **PHASE 1 COMPLETE** — full stack built, wired, and verified end-to-end. Remaining optional polish only.

### 2026-06-26 — Mobile responsiveness audit (Playwright, 320–768px)
- **Sidebar (critical):** was permanently visible on mobile, covering ~64% of the screen. Now an off-canvas
  drawer (`-translate-x-full`, `lg:translate-x-0`) wired to the existing hamburger + backdrop; closes on
  nav-tap. Desktop (≥lg) unchanged.
- **Hover-only profile/notification menus (critical for touch):** opened on `group-hover` only — unreachable
  by tap (couldn't sign out). Added `group-focus-within` so a tap reveals them.
- **Hamburger tap target:** 40px → 44px (`h-11 w-11`, mobile-only via `lg:hidden`).
- **Modals:** added `max-w-[calc(100%-2rem)] sm:max-w-lg` gutter on dialog + alert-dialog (no edge-touch on
  small screens; desktop `max-w-lg` preserved).
- **Navbar:** title/subtitle truncate (`min-w-0`), subtitle hidden `<sm`; notification panel capped to viewport.
- **Verified (Playwright):** no horizontal overflow at 320/375/768; tables scroll within their own container,
  not the page; drawer open/close; dialog gutters; profile opens on tap; desktop (1280) identical (sidebar
  fixed, hamburger hidden). `vite build` ✅. Only 7 files touched; no design/branding/desktop changes.

### 2026-06-27 — Camera-first scanning (Scan & Weigh + PO Upload)
- **Scan & Weigh:** primary path is now a **live rear-camera QR scanner** (`html5-qrcode`,
  `components/scan/CameraQrScanner`, lazy-loaded + code-split). Decodes the QR JSON → `uniqueId` → same
  `/receiving/scan` flow. Manual / USB-scanner text entry demoted to a secondary, collapsible fallback.
- **PO Upload:** primary action is **photograph the document** (`components/scan/DocumentCamera`,
  getUserMedia live preview + `ImageCapture.takePhoto()` for full-res stills, canvas fallback for iOS).
  Produces a JPEG fed into the identical upload→extraction flow. File picker kept as the secondary “or” option.
- **Robustness:** html5-qrcode's `stop()` throws during React StrictMode's double-mount and (with no error
  boundary) blanked the page — fixed with a state-guarded, try/caught cleanup **and** an `ErrorBoundary`
  around both camera components so an unsupported device shows a fallback, never a crash.
- **Phone testing enabled:** Vite now proxies `/api` to the backend (same-origin → no CORS/mixed-content),
  binds to the LAN (`host: true`), and serves HTTPS when `VITE_HTTPS=true` (camera needs a secure context).
  Frontend API base switched to relative `/api`.
- **Verified (Playwright, 390px, via the proxy):** PO Upload shows camera-primary + file fallback; Scan & Weigh
  loads the scanner with reserved height + manual fallback; manual entry resolved `MC-000003 → SCANNED`
  (Titanium Dioxide) through the proxy; no crash; `vite build` ✅ (scanner code-split to its own chunk).
- **Pending (user, on a real phone):** verify live rear-camera QR decode and document-photo quality/focus is
  good enough for AI extraction — see README “Testing the camera on a phone”.

### 2026-07-03 — Phase 2 build + going LIVE
- **Phase 2 complete (Steps 1–9).** Departments and the two new roles; request creation from the catalogue;
  Store inbox with per-LINE Accept/Partial/Reject; Scan & Issue (Add/Deduct/Discard); live stock levels backed
  by an append-only ledger; OVERSIGHT read-only dashboard; a written UAT script the client executes.
- **Concurrency hardened.** Ledger row + `Material.balanceKg` are written in ONE transaction with the unit row
  locked `SELECT … FOR UPDATE`, so two simultaneous scans of the same drum cannot drive it negative (I11).
  A later review found the same class of race on `ProductionRequestItem.issuedKg` (two deducts against one line
  via different units could both pass the approved cap) — fixed by locking the request line inside the
  transaction too.
- **Department isolation centralised** in `common/auth/department-scope.ts` rather than re-implemented per
  controller: the department always comes from the JWT, never from the request body (I10).
- **WENT LIVE (2026-07-03).** Vercel (frontend) + Railway (backend, Singapore) + Neon (Postgres, Singapore) +
  Cloudflare R2. Gotchas hit and recorded in [`DEPLOYMENT.md`](./DEPLOYMENT.md): the Neon **pooler** host is
  required for `DATABASE_URL` while migrations need the direct host; Railway IPv6; and environment variables
  must be staged before the deploy that reads them.

### 2026-07-08 — Analytics dashboards for every login
- **Rich dashboards per role,** not just for Admin: KPI cards, recharts charts, and low-stock alerts
  (red/amber) sized to what that role can act on.
- **Isolation preserved.** Department scoping is applied in the query, server-side, so a PRODUCTION_HEAD's
  charts can only ever contain their own department's rows — the frontend does no filtering.
- Client asked whether the other logins had really been done; at that point only Admin had been, and this was
  said plainly rather than glossed over. Both were then built.

### 2026-07-10 — 2600-QR bug + catalogue verification
- **Bug: a PO wanted to print 2600 QR labels.** AI extraction had put the bulk KG figure (2300, 300) into
  `quantity`, which is a **package count**, so one label per kg was queued.
- **Fixed structurally, not just in the prompt:** a deterministic `BULK_UNITS` guard forces `quantity = 1`
  when the unit is a bulk measure, so a future prompt regression cannot reintroduce this. The prompt was
  tightened as well, and the live PO was corrected in the DB.
- **Catalogue verified end-to-end:** `.xlsx` upload works; the "Add to catalogue" path for No-Match PO SKUs
  was supported by the backend (`?source=no-match`) but **no UI called it** — the button was added on the
  Review screen.
- **Provisional-SKU lifecycle:** `TMP-` items get a badge, a filter, a count, and an audited edit path, so
  provisional entries are visible and get cleaned up. Receiving is still **never blocked by a missing SKU**.

### 2026-07-14 — FIFO (First-In-First-Out) stock consumption
- **Verified before designing:** `arrivedAt` was already 100 % populated, so FIFO needed **no migration**.
- **Soft by design.** Deducting a newer unit while older stock exists shows a warning and writes a
  `FIFO_OVERRIDE` audit row — it never blocks the issue, because the factory floor sometimes has a good
  reason. Ageing: amber ≥ 30 days, red ≥ 60 days. Stock Levels sorts oldest-first.

### 2026-07-19 — Phase 3: Finished Goods & Dispatch
- **Schema shown before it was applied,** then migrated additively
  (`20260719161842_phase3_finished_goods_dispatch`). Pre/post snapshots proved the existing data was untouched:
  171 materials, 400 audit rows, 6 units / 97.8 kg identical on both sides. Confirmed PG 18.4 supports
  `ALTER TYPE … ADD VALUE` in a transaction rather than assuming it.
- **Batch is a first-class record,** unique per department, held on the request **line** so one request can
  serve several batches. Top-ups against a confirmed batch warn rather than block, and consumption
  accumulates.
- **Confirm gate (I12):** finished-goods QRs cannot be minted until the production output is confirmed, and
  `fgGeneratedAt` makes a second generate a hard error — so a drum can never get two identities.
- **`FG-` has its own Postgres sequence,** separate from `MC-`, so a raw unit can never be mistaken for
  finished goods. `FinishedGoodQr` is a separate model because `QrCode` is hard-bound to `Material`; label
  rendering is shared through `QrService.buildLabelRoll()`.
- **New DISPATCH role** sees finished goods only. Proven by `dispatch-isolation.spec.ts` (25 assertions across
  all 9 non-FG controllers).
- **Phase 1 regression proven, not assumed.** While gating the previously ungated material/dashboard/catalogue/
  purchase-order controllers, the client asked directly whether Operator or Supervisor access had broken.
  `phase1-access.spec.ts` (47 assertions, using the same Reflector logic as `RolesGuard`) proves every endpoint
  those screens call is still reachable; git history confirmed the Supervisor restrictions pre-dated this change.

### 2026-07-19 — Client feedback round (six items)
- In-Hand rename; stock ageing display; explicit **Generate → Save → Print** flow; review-before-issue gate;
  and capture of the **actual** quantity issued (which may differ from the approved figure — both are kept).
- **QR speed, measured before and after.** Profiled first (encode 2.0 s / embed 0.84 s / save 2.05 s), then:
  print resolution 512 → 256 px, bounded-parallel encoding (`mapLimit`, concurrency 8), deduped embeds, and
  `save({ objectsPerTick: 200, useObjectStreams: false })`. **100 labels: 8568 ms → 2555 ms (3.35×)**,
  PDF 1735 KB → 698 KB, ZIP 3580 → 1199 ms.
- **Scannability checked numerically, not by eye:** 0.544 mm module at 4.2 px/module — both comfortably above
  scanner minimums, so the speed-up costs nothing at the label.

### 2026-07-20 — Scan UX (UPI-style) + mobile responsiveness audit
- **Scan loop reworked to feel like a payments app:** scan → camera closes → detail → confirm → ~2 s success →
  camera reopens automatically for the next unit. A failed scan keeps the camera open. Manual entry stays as
  the fallback.
- **The camera genuinely releases** (battery on the factory floor): the camera component is rendered *only*
  while scanning, so unmounting stops the media track. A module-level `cameraUnlocked` flag plus an `autoStart`
  prop makes every reopen after the first silent. New `components/scan/useScanFlow.ts` holds the state machine;
  `ScanPanel` / `ScanSuccess` share it across screens.
- **Mobile audit at 320/375/390/412/768.** Playwright MCP dropped mid-audit, so a self-auditing harness page
  was built and run in headless Chrome, measuring `scrollWidth` vs `innerWidth` in-page across 85
  screen × viewport combinations (with real login tokens, since the app calls `/auth/me`).
- **Stock Levels was the only overflowing screen** (+101 px @320, +46 @375, +31 @390, +9 @412, clean @768).
  Two root causes: a fixed-width `TabsList`, and `AppLayout`'s `<main>` having no width constraint. Fixed with
  `min-w-0 max-w-full overflow-x-clip` on `<main>` and `max-w-full overflow-x-auto` + `shrink-0` on the tabs,
  so wide content scrolls inside its own container instead of stretching the page. **Re-verified: 85/85 clean.**
- **Touch targets raised to 44 px** via `[@media(pointer:coarse)]` only — desktop output is byte-identical.
- **Regression:** 169/169 backend tests passing across 16 suites.

### 2026-07-20 — Documentation refresh
- Brought [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`FIELD_REFERENCE.md`](./FIELD_REFERENCE.md), this log,
  [`PHASE2_UAT.md`](./PHASE2_UAT.md), [`DEPLOYMENT.md`](./DEPLOYMENT.md) and the README current with Phase 3
  and everything since. Rewritten as coherent current documents rather than an original plus an addendum:
  where an earlier statement was superseded it was **corrected**, not left alongside the new one (e.g. the
  3-role `User.role` list, and the stale duplicate rows in the build table above).
- **Docs only — no code changed in this pass.**

## Open / pending

- **UI/UX overhaul — ON HOLD.** A 5-page preview PDF (3 complete options, each shown on laptop + iPad + phone,
  plus a tagline page for the moving strip on login and in the app bar) is with the factory owner. **No rebuild
  has started**; it waits on their choice of option and tagline.
- **Client click-through verification** still to be done by the client on real hardware: Phase 3 end-to-end,
  the six feedback items, the scan loop on an actual phone, and label printing on the real label printer.

---
_Update this log after every step. Newest entries at the bottom of the session log._
