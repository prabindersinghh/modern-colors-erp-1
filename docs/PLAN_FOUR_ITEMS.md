# Plan — Four-item batch: arrival time, short QR, session gating, Store's two tabs

> **Status:** PLAN ONLY — nothing built.
> **Prepared:** 2026-07-22, verified against live code at `88fcec3`.
> **Sequencing:** after the Gate sidebar fix + slip download (in flight). The Gate/Store
> split is settled — Store does Review & Confirm and mints; Gate is scan-and-go. None of
> these four touch that.
> **Every current-behaviour claim below was read from the code.**

---

## Item 1 — Arrival-time field on PO upload (Gate)

**Verified:** `PurchaseOrder` has `createdAt` (upload instant), `deliveryDate`, `confirmedAt`.
There is no "arrival time" concept. `createdAt` is the row-creation time and must not be
repurposed.

**Plan:**
- Migration (additive): `ALTER TABLE "PurchaseOrder" ADD COLUMN "arrivedAt" TIMESTAMP(3);`
  Nullable — pre-existing rows have no recorded arrival, and the UI falls back to
  `createdAt` for display when null.
- Upload form (`GateHomePage`) gains an arrival-time input, defaulting to now, editable
  (trucks arrive before the guard reaches the phone).
- `POST /purchase-orders` accepts an optional `arrivedAt`; stored on the row; **never
  touches `createdAt`**.
- Surfaced on: the slip (a new "Arrived" line in `slip-pdf.ts` + the slip payload), the
  Gate history row, and audited in the `PO_UPLOADED` entry (`after: { arrivedAt }`).
- Backup + pre-deploy guard as standing.

**One line for you:** additive column, nullable, display falls back to `createdAt`.

---

## Item 2 — Shorten the QR — and it is nearly free

### What each family's payload IS today (verified, not recalled)

`QrService` encodes **`JSON.stringify(payload)`** into the QR (`qr.service.ts:162,166`).
The payloads:

- **MC- (raw material):** `{ uniqueId, materialName, sku, hsnCode, supplier, poNumber,
  batch, date }` — ~8 fields, typically 150–250 characters.
- **FG- (finished good):** `{ uniqueId, productName, batch, department, size, shade,
  productSku, date, kind }` — ~9 fields, similar length.

That long JSON is why the modules are dense and decode is slower on the 256px raster.

### The decisive finding — scanning already ignores the payload

`extractUniqueId` in `StockPage.tsx` (and the shared scan path):
```
try { const o = JSON.parse(text); if (o?.uniqueId) return o.uniqueId } catch {}
return text.trim()
```
**It already accepts BOTH formats.** A QR containing the bare string `MC-000123` returns
`MC-000123` via the fallback; a QR containing the full JSON returns `o.uniqueId`. Every
scan endpoint resolves by `uniqueId` and never reads the other fields off the scan.

### Old vs new payload (the line you asked to see before deploy)

| | Today | Proposed |
|---|---|---|
| MC label encodes | `{"uniqueId":"MC-000123","materialName":"Titanium Dioxide","sku":"TIO2-001","hsnCode":"...","supplier":"...","poNumber":"...","batch":null,"date":"2026-..."}` | `MC-000123` |
| FG label encodes | `{"uniqueId":"FG-000045","productName":"...","batch":"...","department":"PU","size":"20 L",...}` | `FG-000045` |
| Chars | ~150–250 | 9–10 |

**The short format is the unique ID itself** — the simplest thing that scans, exactly as
you anticipated. Fewer QR modules → larger cells on the same 216×108pt sticker → faster,
more reliable decode. **Label geometry unchanged. Sequences unchanged. Stored `payload`
JSON on the row is unchanged** (the human-readable record and the label reprint both keep
reading it) — only the STRING BURNED INTO THE QR IMAGE shortens.

### The hard constraint — old stuck labels scan forever

Because `extractUniqueId` already handles JSON, old labels keep working with **zero**
change. The plan makes that a permanent guarantee rather than an accident:
- A test with **real old full-JSON payloads as fixtures** asserting `extractUniqueId`
  still returns the right id.
- The QR renderer changes from `JSON.stringify(payload)` to `payload.uniqueId` for new
  mints; the reveal/label paths keep the full stored JSON.
- A backend test asserting every scan-resolving endpoint keys on `uniqueId` and never
  reads a payload field from scan input.

**Scope:** frontend renderer + tests. No migration, no backup needed — this changes only
what new QR *images* encode. (If you prefer belt-and-braces, I can also make the backend
`dataUrl/pngBuffer` accept a short-mode flag; not required, since the id-only string
already round-trips.)

---

## Item 3 — Start-session gating for scanning

### Verified: receiving sessions do NOT block anything server-side

`frontend/src/lib/receivingSession.ts` is **client-only** (localStorage, its own header
says "Deliberately CLIENT-SIDE ONLY"). The backend `receiving` module has `scan`, `recent`,
`weight` and **no session concept**. So today a scan works with or without a "session" —
Start/Done is a UI summary, not a gate. Dispatch has no session at all.

So the brief's "verify it blocks; make it blocking if not" resolves to: **build a real
server-side session gate**, for Gate receiving and for Dispatch.

### Plan — one shared mechanism

- Migration (additive): a `ScanSession` table.
```sql
CREATE TYPE "ScanKind" AS ENUM ('RECEIVING', 'DISPATCH');
CREATE TABLE "ScanSession" (
    "id"          TEXT       NOT NULL,
    "kind"        "ScanKind" NOT NULL,
    "openedById"  TEXT       NOT NULL,
    "openedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"    TIMESTAMP(3),
    "scanCount"   INTEGER    NOT NULL DEFAULT 0,
    CONSTRAINT "ScanSession_pkey" PRIMARY KEY ("id")
);
-- At most one OPEN session per (kind, user): a partial unique index.
CREATE UNIQUE INDEX "ScanSession_one_open"
    ON "ScanSession"("kind","openedById") WHERE "closedAt" IS NULL;
```
- `POST /scan-sessions` (open), `POST /scan-sessions/:id/close` (close, returns the
  summary), `GET /scan-sessions/current?kind=`. Open/close both audited.
- **Server-side gate:** `receiving/scan` and `dispatch/scan` + `dispatch/batch` reject
  with a clear 409/400 when the actor has no open session of the matching kind. This is
  the actual enforcement — not UI hiding.
- Frontend: a "Start session" button on Gate receiving and on Dispatch; the UPI-style
  continuous loop runs **inside** an open session, unchanged; close shows the existing
  summary style (`8619cea`'s look, now driven by a real server count).
- Flush: `ScanSession` added to `DELETE_ORDER` (references User, which is preserved, so it
  slots before the user-independent tables); `flush-plan.spec.ts` updated.

**Note on Scan & Issue (asked, NOT building):** the same gate would fit Store's Scan &
Issue for one more `ScanKind` value and one guard line — roughly 30 minutes. The doc names
only Gate and Dispatch, so I will not build it; flagging the cost as requested.

**Correction to flag:** the brief says "receiving already has Start/Done sessions
(8619cea) — verify it BLOCKS". It does not block; it summarizes. This item is therefore
"build the blocking gate", larger than "make an existing gate blocking". Called out so the
size is not a surprise.

---

## Item 4 — Store's two new read tabs

### 4a — Audit log (read-only, Store-scoped)

**Verified:** `AuditController` `@Get()` is already `@Roles(ADMIN, SUPERVISOR)` and filters
by `entityType/entityId/take`. **Store IS ADMIN, so Store can already reach it** — but
unfiltered, it would expose the whole factory's trail, which the doc says it must not.

**One-line scope (my default, confirm or adjust):** Store sees audit rows for the actions
relevant to its desk — inward (`PO_*`, `MATERIALS_REGISTERED`, `RECEIVING_SLIP_*`), stock
(`STOCK_*`, `FIFO_OVERRIDE`), and issue (`REQUEST_*`, `BATCH_*` issue actions) — NOT user
admin, NOT settings, NOT other roles' private actions.

**Plan:**
- Add an allow-listed action-set filter to `audit.list` and a Store-facing route/tab that
  requests only that set (enforced server-side by the set, not by the client asking
  nicely).
- **Reuse, not duplicate:** the Oversight per-login audit view is queued as a later batch.
  This builds the read component and the service filter in a way that batch extends
  (different scope, same components) — I will structure the audit-view component to take a
  scope prop so Oversight's per-login view reuses it. I will NOT pre-build Oversight's
  view here.
- Tested: a Store audit request returns only in-scope actions; an out-of-scope entityType
  is absent even if asked for.

### 4b — Batches (read-only, cross-department)

**Verified and already true server-side:** `BatchController` list/trace use
`READ_ROLES = [PRODUCTION_HEAD, ADMIN, OVERSIGHT]`, and a head is department-scoped while
**ADMIN/OVERSIGHT read all** (the controller comment says so and the service applies
`departmentFilter` only for heads). So **Store can already read all batches across
departments; only a frontend tab is missing.** No backend change, no migration.

**Plan:**
- A read-only Batches tab on Store's dashboard listing batches across departments (it
  issues against them), reusing the existing batch list/trace endpoints. No writes exposed.
- A test asserting Store reaches batch reads and NO batch write (create/confirm stay
  PRODUCTION_HEAD-only), and that this opens no department bypass elsewhere.

---

## Cross-cutting

- **Migrations:** Items 1 and 3 add columns/tables (backup + pre-deploy guard, host
  confirmed ap-southeast-1 non-pooled). Items 2 and 4 need **no migration** (2 is a
  render change; 4 is scoping + UI).
- **Flush:** only Item 3's `ScanSession` is new — added to the plan + spec.
- **Door sweep:** unchanged — none of these add an Oversight write door.
- **Build order:** 4b (frontend-only, smallest) → 2 (render + tests) → 1 (migration) →
  3 (migration + gate) → 4a (scoped filter + reused component).
- **Live verification per item**, exit-code verified, standing report + tap-through.

## Open decisions before building

1. **Item 2:** confirm short format = bare unique id (recommended, simplest that scans).
2. **Item 3:** confirm the server-side gate is wanted (it does not exist today), and that
   Scan & Issue stays out.
3. **Item 4a:** confirm the Store audit scope (inward/stock/issue actions, not the whole
   trail).
