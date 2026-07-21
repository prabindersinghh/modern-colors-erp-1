# Modern Colours — Architecture Map (LIVING DOCUMENT)

> **Document version:** 3.0  
> **Last updated:** 2026-07-21  
> **Describes:** Phases 1-3 complete and live, plus analytics and handover tooling. This is the CURRENT architecture.  
> **Earlier versions:** see [`docs/archive/`](./archive/) · full history in [`CHANGELOG.md`](./CHANGELOG.md)


> **Purpose:** This is the single source of truth for the system's shape. It must
> stay alive across coding sessions. **Whenever a structural decision, module
> boundary, data model, or contract changes, update THIS file in the same change.**
> Read this first at the start of any new session before touching code.
>
> Companion file: [`PROGRESS.md`](./PROGRESS.md) tracks what has actually been built.
> Field-by-field data reference: [`FIELD_REFERENCE.md`](./FIELD_REFERENCE.md).
> Manual test script: [`PHASE2_UAT.md`](./PHASE2_UAT.md).
> Original scope: [`Modern_Colours_PRD_Phase1_Final (1).docx`](./Modern_Colours_PRD_Phase1_Final%20(1).docx) (PRD v3.0) — Phase 1 only; Phases 2–3 were specified later by the client directly.

---

## 1. What this system is

An ERP for a paint factory, covering the full material journey from supplier delivery
to dispatched finished goods. It has shipped in three phases, all now live.

```
PHASE 1 — Raw material inward
  Operator uploads supplier invoice (PDF/img/scan)
     → Claude API extracts fields (PO#, supplier, materials, qty, unit, batch, date)
     → Each material matched against the Master Catalogue (exact / similar / no-match)
     → Operator REVIEWS & CORRECTS, then EXPLICITLY CONFIRMS   (HARD GATE)
     → ONE Material record PER PHYSICAL UNIT, unique ID MC-000001…
     → ONE QR per unit + printable 3×1.5" label roll (PDF)
     → Truck arrives → scan each QR → enter one confirmed weight
     → Unit reaches "Ready for Production"

PHASE 2 — Requests, Store approval, stock movement
     Production head raises a multi-material request (per-line quantities)
     → Store reviews EACH LINE: accept / partial / reject-with-reason
     → Store scans a physical unit, QR-verifies the material, REVIEWS, confirms
     → Add / Deduct / Discard recorded in an append-only ledger; per-unit balance updated
     → FIFO advisory: oldest stock recommended, override warned + audited

PHASE 3 — Finished goods & dispatch
     Head opens a BATCH → requests raw materials against it (top-ups allowed)
     → Head records production OUTPUT for that batch → REVIEWS → CONFIRMS  (HARD GATE)
     → FG QR minted per drum, FG-000001…, same 3×1.5" label roll
     → Dispatch role scans FG QRs to ship them (or bulk-dispatches a batch)
     → Full traceability: FG unit → batch → issues → source units → PO → supplier
```

## 2. Scope guardrails

Phases 1–3 are complete and live. Still explicitly **out of scope** (do not build without
a client decision):

- Live weighing-machine hardware integration (USB/RS-232/Ethernet/BT/SDK). **All weights
  are manual entry.**
- Inventory forecasting, demand prediction, AI optimisation.
- A purchase review/approval gate before QR printing (client explicitly deferred this).
- The UI/UX visual overhaul (three design directions were proposed and are awaiting the
  factory owner's choice — see `Modern_Colours_Design_Options.pdf`).

## 3. Non-negotiable invariants (enforced + tested)

| # | Invariant | Where enforced |
|---|-----------|----------------|
| I1 | **No auto-save of AI output.** Materials persist ONLY after explicit operator confirm. | `purchase-order` confirm endpoint + service; test |
| I2 | **Claude API key encrypted at rest**, never returned in full to frontend (masked `sk-ant-…xxxx`). | `settings` module crypto; unit test on masking |
| I3 | **QR is 1:1 with physical units**, not line items. 50 bags ⇒ 50 IDs + 50 QRs. Same rule for FG drums. | `material` + `finished-goods` services; tests assert count |
| I4 | **Audit log is append-only.** Corrections = new entries referencing the original; never overwrite/delete. Extends to `StockTransaction`. | `audit` module; no update/delete path |
| I5 | **RBAC enforced server-side** on every protected endpoint (not just UI hiding). | `RolesGuard` + `@Roles()`; `phase1-access.spec.ts`, `dispatch-isolation.spec.ts` |
| I6 | **Master Catalogue never gates operations.** No-match materials can still be confirmed. | validation returns status only |
| I7 | **Any extraction failure ⇒ manual fallback**, operator never blocked — covers Claude being down, no API key, *and* file storage being unavailable. | extraction service returns fallback flag; `extract-degradation.spec.ts` |
| I8 | **Unique IDs are sequential, zero-padded** — `MC-000001` (raw), `FG-000001` (finished). Separate Postgres sequences. | `material` / `finished-goods` services; concurrency-safe |
| I9 | **Scans tolerate offline**, queue locally, sync on reconnect — no silent data loss. Re-scanning a unit is idempotent. | frontend IndexedDB queue + idempotent endpoints |
| I10 | **Department isolation is server-side.** A production head can never read or write another department's data. | `common/auth/department-scope.ts`; verified against live data |
| I11 | **Stock can never go negative.** Deduct/discard above a unit's balance is rejected. | `stock.service` row-locked check; tests |
| I12 | **FG QRs require a confirmed output**, and can be minted only once per output. | `finished-goods.service` confirm + `fgGeneratedAt` guards; tests |

## 4. Tech stack (locked)

**Monorepo root** = `d:/modern-colors-erp`

```
modern-colors-erp/
├── frontend/          Vite 6 + React 19 + TS + Tailwind 3 + shadcn/ui + react-router 7 + recharts
├── backend/           NestJS 11 + TypeScript + Prisma 6 + PostgreSQL
├── docs/              ARCHITECTURE.md (this) + PROGRESS.md + FIELD_REFERENCE.md + UAT + PRD
└── README.md
```

> **DATABASE = Neon (hosted Postgres, Singapore). NOT Docker.** The client does not have
> Docker and will not install it. There is intentionally **no `docker-compose.yml`**.
> `DATABASE_URL` is the pooled Neon string; `DIRECT_URL` is the non-pooled one used only
> for migrations (Prisma's advisory locks hang on PgBouncer). **Do not reintroduce a
> Docker Postgres in any future session.**

- **Backend:** NestJS + TS, Neon PostgreSQL + Prisma, JWT auth + RBAC, REST (no GraphQL).
- **AI:** Anthropic official SDK `@anthropic-ai/sdk`.
- **QR:** `qrcode` for generation, `pdf-lib` for the label roll.
- **File storage:** **Cloudflare R2** (S3 API) in prod, behind `StorageService`; disk
  fallback locally when R2 creds are absent.
- **Frontend:** Vite stack (NOT migrated to Next.js). Charts via recharts, lazy-loaded so
  the library only downloads when a dashboard is opened.

## 5. Roles (6)

| Role (enum) | Called in the UI | Scope |
|---|---|---|
| `ADMIN` | **Store** | Everything in Phase 1 + Store actions in Phases 2–3. The original admin login. |
| `OVERSIGHT` | **Admin** | Factory-wide, **view only** — structurally: no mutating `@Roles` route grants it (machine-checked). ONE named exception: the audited finished-goods **correction** endpoint (`/finished-goods/corrections/:id`, non-identity fields only, before→after audit, reprint flag) behind its own `@AllowCorrection` + `CorrectionsGuard`, so the view-only sweep stays assertable. Also reads the **handover readiness** panel. |
| `PRODUCTION_HEAD` | PU / Enamel / Powder Head | Scoped to **one department** via `User.department`. Raises requests, records output. |
| `OPERATOR` | Operator | Phase 1 inward screens. |
| `SUPERVISOR` | Supervisor | Phase 1 read access + audit log. |
| `DISPATCH` | Dispatch | **Finished goods only.** Sees FG across all departments (it ships everything) but has zero access to raw stock, requests, batches, POs or Phase 1 screens. |

**Isolation is enforced server-side, not by hiding nav.** Two specs guard this:
- `dispatch-isolation.spec.ts` — asserts from the real `@Roles` metadata that every route
  on all nine non-FG controllers is gated and never grants `DISPATCH`.
- `phase1-access.spec.ts` — asserts Operator/Supervisor still reach every endpoint their
  Phase 1 screens call, so tightening a gate can never silently lock them out.

## 6. Backend module map

| Module | Responsibility | Key endpoints (REST, prefix `/api`) |
|--------|----------------|----------------------|
| `auth` | JWT login, token issue/verify, password hashing | `POST /auth/login`, `GET /auth/me` |
| `users` | User CRUD (Admin), role assignment, seed admin | `GET/POST/PATCH /users` |
| `catalogue` | Master Catalogue import (**.xlsx / .xls / .csv**) + CRUD + match + provisional-SKU lifecycle | `POST /catalogue/import`, `GET /catalogue/import/template`, `POST /catalogue/import/preview|validate|revalidate|rows`, `GET /catalogue?provisional=`, `GET /catalogue/provisional-count`, `POST /catalogue?source=no-match`, `PATCH /catalogue/:id` |
| `settings` | Claude API key: encrypt/store/mask/validate/remove (Admin) | `GET/PUT/DELETE /settings/api-key` |
| `purchase-order` | PO upload, lifecycle, history, **confirm gate** | `POST /purchase-orders`, `POST /:id/extract`, `POST /:id/confirm` |
| `ai-extraction` | Claude call, JSON parse, catalogue validation, **bulk-unit guard** | invoked by purchase-order |
| `material` | Register 1 record/unit, unique ID gen, status transitions, label outputs | `GET /materials`, `GET /purchase-orders/:poId/units`, `.../labels.pdf|zip|csv` |
| `qr` | QR image generation + 3×1.5" label roll PDF (shared by raw + FG) | used by `material` and `finished-goods` |
| `receiving` | Scan resolve + rapid-fire scanning + status → Ready. Weighing is **no longer part of the receiving flow** (balance comes from the PO pack weight, see §8), but the endpoint survives as a **weight-correction** path. | `POST /receiving/scan`, `POST /receiving/:uniqueId/weight` |
| `dashboard` | Phase 1 material-inward metrics + search | `GET /dashboard/summary`, `GET /dashboard/search` |
| `audit` | Append-only log writer + reader | `GET /audit` |
| `production-request` | Multi-material requests, per-line review, oversight rollup | `POST /production-requests`, `PATCH /:reqId/items/:itemId/review`, `GET /overview` |
| `stock` | Unit lookup, Add/Deduct/Discard ledger, live levels, **stock ageing**, FIFO | `GET /stock/units/:id`, `POST /stock/transactions`, `GET /stock/levels`, `GET /stock/ageing`, `GET /stock/transactions` |
| `analytics` | Role-specific dashboards (Admin / Store / Head), **dispatch analytics** (Dispatch + Admin), and the **Company Brain** factory-wide flow (**Admin only**) | `GET /analytics/overview`, `/analytics/store`, `/analytics/my`, `/analytics/dispatch`, `/analytics/flow` |
| `batch` | Batches as first-class records + **traceability chain** | `POST /batches`, `GET /batches`, `GET /batches/:id/trace` |
| `production-output` | Output recording + **confirm gate** | `POST /production-outputs`, `POST /:id/confirm` |
| `finished-goods` | FG minting, FG labels, dispatch | `POST /finished-goods/generate/:outputId`, `GET /by-output/:id/labels.pdf`, `POST /dispatch/scan`, `POST /dispatch/batch` |

| `health` | Liveness probe (**public**, Railway polls it) + storage round-trip probe (**guarded**, Store/Admin) | `GET /health`, `GET /health/storage?deep=1` |

Cross-cutting: `common/` (guards, decorators, `auth/department-scope.ts`, crypto, `storage/`), `prisma/`.

> **Storage errors carry no infrastructure identifiers.** Client-facing messages give a
> plain-English hint only — never the endpoint host, bucket name or account ID, because those
> messages reach `OPERATOR` and are written to the append-only audit log. The path-traversal
> guard is re-thrown untouched: it is a security check, not an outage.

## 7. Data model (Prisma) — canonical entities

> Full schema in `backend/prisma/schema.prisma`; field-level detail in `FIELD_REFERENCE.md`.

**Phase 1**
- **User** `{ id, email, passwordHash, name, role(Role), department(Department?), active }`
- **MasterCatalogueItem** `{ id, materialName, sku(unique), hsnCode?, category?, unit?, standardPackaging?, metadata Json?, active }`
- **PurchaseOrder** `{ id, poNumber?, supplier?, fileKey, status(POStatus), source(AI|MANUAL), extractedJson?, deliveryDate? }`
- **POLineItem** (pre-confirm working set) `{ id, poId, materialName, sku?, hsnCode?, quantity, unit?, weight?, matchType, edited }`
- **Material** (ONE per physical unit) `{ id, uniqueId "MC-000001", poId, materialName, sku?, status(MaterialStatus), receivedWeight?, arrivedAt?, balanceKg? }`
- **QrCode** `{ id, materialId(unique), payload Json, imageRef }`
- **Setting**, **AuditLog** (append-only)

**Phase 2**
- **ProductionRequest** (header) `{ id, department, requestedById, note?, status(RequestStatus), reviewedById?, reviewedAt? }`
- **ProductionRequestItem** (line) `{ id, requestId, materialName, sku?, requestedKg, status, approvedKg?, rejectionReason?, issuedKg, batchId? }`
- **StockTransaction** (APPEND-ONLY ledger) `{ id, materialId, type(ADD|DEDUCT|DISCARD), quantityKg, department?, requestItemId?, actorId, balanceAfter, note? }`

**Phase 3**
- **Batch** `{ id, batchNumber, department, status(BatchStatus), note?, createdById }` — `@@unique([department, batchNumber])`
- **ProductionOutput** `{ id, batchId, productName, packageCount, sizePerPackage, sizeUnit, productionDate, shade?, productSku?, notes?, confirmed, confirmedById?, confirmedAt?, fgGeneratedAt? }`
- **FinishedGood** (ONE per drum) `{ id, uniqueId "FG-000001", outputId, batchId, productName, sizePerPackage, sizeUnit, status(FgStatus), dispatchedAt?, dispatchedById?, dispatchNote? }`
- **FinishedGoodQr** `{ id, finishedGoodId(unique), payload Json, imageRef }` — separate from `QrCode`, which is hard-bound to `Material`.

**Enums**
- `Role`: ADMIN | SUPERVISOR | OPERATOR | OVERSIGHT | PRODUCTION_HEAD | DISPATCH
- `Department`: PU | ENAMEL | POWDER
- `POStatus`: PO_UPLOADED → AI_EXTRACTED → OPERATOR_VERIFIED → REGISTERED
- `MaterialStatus`: REGISTERED → ARRIVED → SCANNED → WEIGHED → READY_FOR_PRODUCTION
- `RequestStatus`: PENDING | IN_PROGRESS (parent only) | APPROVED | PARTIAL | REJECTED
- `StockTxnType`: ADD | DEDUCT | DISCARD
- `BatchStatus`: OPEN → OUTPUT_RECORDED → CONFIRMED → CLOSED
- `FgStatus`: GENERATED → DISPATCHED, with three side-exits: SCRAPPED / REFURBISHED
  (returned goods) and — **known no-op** — `READY`. Nothing in the codebase ever sets
  READY: minting the QRs (GENERATED) *is* the release to Dispatch, whose queue reads
  `status IN (GENERATED, READY)`. The value exists as the hook for a future separate
  "labelled & stored" step between printing and dispatch visibility; wire it up by
  setting it after label printing — the dispatch queue already accepts it. Until then
  do not assume it is part of the flow.
- `MatchType`: EXACT | SIMILAR | NONE

## 8. Key flows

**Extraction + confirm (Phase 1 hard gate)**
1. `POST /purchase-orders` → file to storage, PO `PO_UPLOADED`, audit.
2. `POST /:id/extract` → Claude → line items with match status → `AI_EXTRACTED`. On failure `{ fallback: true }` and manual entry.
3. Operator edits the working set (**not** Materials).
4. `POST /:id/confirm` → **only now** create N Material rows + QRs → `REGISTERED`. *(I1, I3)*

> **Bulk-unit guard:** when the AI reads a line's quantity in a weight/volume unit
> (KG/LTR/MT/…), that number is a bulk total, not a package count. The server forces
> `quantity = 1` and surfaces the bulk figure so the operator enters the real bag count.
> This exists because one invoice produced 2600 QR codes from "2300 KG" + "300 KG".

**Receiving (no weighing)**
- A truckload can be ~2,500 sacks, so receiving is **scan-only** and accepts continuous rapid-fire
  input. There is no per-unit weighing step in the flow.
- `Material.balanceKg` is seeded from the **PO pack weight** at registration. A unit whose PO line
  carries no pack weight cannot be issued until one is set on the line — every unit on that line
  then inherits it.
- **`POST /receiving/:uniqueId/weight` still exists**, now purely as a *correction* path for a unit
  whose real weight differs from the pack weight. It is idempotent on an identical re-send (offline
  retry), and if stock has already moved on the unit it **shifts** the balance by the delta rather
  than overwriting it, so a correction never erases recorded consumption.
  (Until 2026-07-20 this method set `receivedWeight` but never `balanceKg` — every balance in the
  system had come from a one-time migration backfill. It now maintains the balance itself.)
- Every scan screen can switch between the **phone camera** and an **external WiFi/USB scanner**.

**Request → issue (Phase 2)**
1. Head raises a request; each line optionally carries a `batchId`.
2. Store reviews each line (accept / partial / reject-with-reason); parent status is derived from the line mix.
3. Store scans a unit → QR-verify against the line → **review screen** (unit, material, department, batch, quantity, resulting balance) → confirm.
4. `POST /stock/transactions` writes the ledger row and updates `Material.balanceKg` **in one DB transaction**, with the unit row locked. Over-deduction rejected. *(I11)*

**FIFO (soft, never blocks)**
- Basis: `Material.arrivedAt` ascending, tie-broken by `uniqueId`. Only units with balance > 0.
- Scanning a non-oldest unit shows a prominent warning naming the older unit; the operator may proceed.
- Proceeding writes a `FIFO_OVERRIDE` audit entry (unit used, unit skipped, both ages, actor) — computed server-side so it cannot be suppressed.
- Ageing thresholds: **amber ≥ 30 days, red ≥ 60 days** (`fifo.util.ts`), surfaced on the dashboards and on the Stock Levels → **Stock ageing** tab.

**Batch → output → FG → dispatch (Phase 3)**
1. Head creates a **Batch** (number unique within their department).
2. Request lines reference `batchId` **per line**, so one request can serve several batches. A later top-up against the same batch **accumulates** (total consumed = sum of everything issued across all requests).
3. Requesting against a CONFIRMED/CLOSED batch is **warned, not blocked**, and audited `BATCH_POST_CONFIRM_TOPUP`.
4. Head records **ProductionOutput** as a draft → reviews → `POST /:id/confirm`. *(hard gate)*
5. `POST /finished-goods/generate/:outputId` mints one `FinishedGood` + QR per package. Blocked unless confirmed; `fgGeneratedAt` prevents a second minting. *(I12)*
6. Dispatch scans each FG QR (`MC-` codes are rejected with a clear message), or bulk-dispatches the remainder of a batch (audited distinctly).

**Traceability** — `GET /batches/:id/trace` returns both directions:
`FinishedGood → Batch → ProductionRequestItem[] → StockTransaction[] → Material → PurchaseOrder → supplier`,
plus what came out (outputs, FG units, dispatch state).

## 9. Scanning UX (all three scan screens)

A single shared loop, modelled on UPI payment scanners, because operators scan many units
back to back:

```
camera live → locks on → camera CLOSES → detail/action → confirm
   ↑                                                        ↓
   └────────── reopens automatically ←── ~2s success ───────┘
```

- `useScanFlow` owns the state machine (`scanning | detail | success`); `ScanPanel` renders
  the camera **only** while scanning, so a hit **unmounts** `CameraQrScanner` and its cleanup
  (`stop()` + `clear()`) genuinely releases the media track — hiding it would keep the phone's
  camera powered.
- The first camera start needs a tap (browsers require a user gesture); after permission is
  granted in the session, reopens are silent.
- **Failed scans keep the camera open** and show the error inline, so the operator retries
  without navigating.
- Applies to all three scan screens. The manual/USB-scanner field follows the same loop and
  refocuses automatically after each success.
- **Scanner mode toggle:** each screen chooses **camera** or **external scanner** explicitly,
  because the factory uses both and which is in hand varies by station.

## 10. Conventions

- REST, JSON, `kebab` URL segments, `/api` prefix. All write endpoints emit an AuditLog entry.
- Auth: `Authorization: Bearer <jwt>`. Guards: `JwtAuthGuard` + `RolesGuard`.
- Tests: invariants get tests with implementation. **261 backend tests** across 28 suites.
- Frontend calls the backend via `frontend/src/lib/api.ts` (base from `VITE_API_URL`, `/api` in prod).
- Env: every secret via env var; `.env.example` committed, `.env` ignored.
- **Design system — "Paint Chip".** Brand red `#EB0102`, yellow `#FEEF03`, violet `#8802C9`; a warm
  neutral `chip-*` ramp; **severity tokens** (critical / warning / healthy / info) that status colours
  bind to — never the categorical ramp, or a palette change silently makes "Partial" look like
  "Rejected". Red is an **accent only**. All 14 measured text/background pairs pass WCAG AA.
  Animations are GPU-accelerated (transform/opacity) and respect `prefers-reduced-motion`.
- **Mobile-first where it matters.** Audited at 320/375/390/412/768 px; layout containers carry
  `min-w-0` so a wide table or tab strip scrolls inside itself instead of stretching the page.
  Touch devices get 44px tap targets via `@media(pointer:coarse)`; desktop sizing is unchanged.

## 11. Audit events (current, all phases)

| Area | Actions |
|---|---|
| PO / material | `PO_UPLOADED`, `PO_EXTRACTED`, `PO_CONFIRMED`, `MATERIAL_REGISTERED`, `SCANNED`, `WEIGHT_ENTERED`, `WEIGHT_CORRECTED` |
| Catalogue | `CATALOGUE_IMPORTED`, `CATALOGUE_ITEM_CREATED`, `CATALOGUE_ITEM_ADDED_FROM_NO_MATCH`, `CATALOGUE_ITEM_UPDATED`, `CATALOGUE_ITEM_SKU_CHANGED`, `CATALOGUE_ITEM_DEACTIVATED` |
| Requests | `PRODUCTION_REQUEST_CREATED`, `REQUEST_ITEM_APPROVED`, `REQUEST_ITEM_PARTIAL`, `REQUEST_ITEM_REJECTED`, `BATCH_POST_CONFIRM_TOPUP` |
| Stock | `STOCK_ADD`, `STOCK_DEDUCT`, `STOCK_DISCARD`, `FIFO_OVERRIDE` |
| Phase 3 | `BATCH_CREATED`, `OUTPUT_RECORDED`, `OUTPUT_RECORDED_EXTRA`, `OUTPUT_UPDATED`, `OUTPUT_CONFIRMED`, `OUTPUT_DRAFT_DELETED`, `FG_QR_GENERATED`, `FG_DISPATCHED`, `FG_DISPATCHED_BULK`, `FG_CORRECTED`, `FG_RETURN_SCRAPPED`, `FG_RETURN_REFURBISHED` |
| Users | `LOGIN`, `USER_CREATED`, `USER_RENAMED`, `USER_UPDATED`, `USER_PASSWORD_RESET`, `USER_DEACTIVATED`, `USER_REACTIVATED` — plus `USER_SEEDED` / `SEED_ADMIN_CREATED`, written only by the seed scripts |
| Handover | `SYSTEM_FLUSHED_FOR_HANDOVER` — written once by `prisma/flush.ts`, the **only** permitted exception to I4 |

## 12. Open / deferred decisions

- **Purchase review gate before QR printing** — client explicitly deferred.
- **`render.yaml` is a leftover** from an abandoned Render deployment. Production is **Railway**.
  It is inert but misleading — delete it or mark it dead.
- **The local `.env` points at the same Neon database as production.** There is no separate dev
  database, so anything run locally writes to live data.
- **Low-stock tiers** (`< 5 kg` critical, `< 20 kg` low) and **ageing tiers** (30/60 days) are
  code constants; move to Settings if the client wants them tunable.
- **Seeded passwords** — the five non-admin logins still use the default `ChangeMe123!`
  (override via `SEED_PHASE2_PASSWORD` / `SEED_PHASE3_PASSWORD`). Change before real go-live.
- **Frontend has no test runner.** All 261 tests are backend. Adding vitest + testing-library
  would be a deliberate separate task.

---
_Last updated: 2026-07-21 — Phases 1–3 live. Includes FIFO, the Paint Chip design system, weight-free
receiving, the scanner mode toggle, catalogue import, dispatch analytics and the Company Brain._
