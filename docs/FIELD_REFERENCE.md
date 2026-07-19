# Field Reference — Modern Colours

A complete reference for every database column across all three phases (raw-material
inward, requests/stock movement, finished goods & dispatch).
Source of truth: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).
Update this file whenever the schema changes.

**Source** legend: **PO** = read from the purchase-order document · **User** = entered by
an operator/admin · **System** = generated/derived by the backend.

---

## User — application accounts

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | Referenced by audit, PO, weighing records |
| `email` | Login identity (unique) | User | String | Login |
| `passwordHash` | Bcrypt hash of password | System | String | Login (never returned) |
| `name` | Display name | User | String | Shown in header / audit |
| `role` | `ADMIN`(Store) \| `SUPERVISOR` \| `OPERATOR` \| `OVERSIGHT`(Admin, view-only) \| `PRODUCTION_HEAD` \| `DISPATCH` | User | Enum | Server-side RBAC on every route (I5) |
| `department` | `PU` \| `ENAMEL` \| `POWDER` — set **only** for `PRODUCTION_HEAD` | User | Enum? | Forces department isolation server-side (I10) |
| `active` | Soft enable/disable | User | Boolean | Deactivated users cannot log in |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## MasterCatalogueItem — the SKU master list

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `materialName` | Canonical material name | User (CSV/manual) | String | Fuzzy-matched against PO lines (informational, never gates) |
| `sku` | Unique item/product code | User (CSV/manual) | String (unique) | Match key; auto-generated `TMP-xxxx` if blank |
| `hsnCode` | HSN/SAC tax code | User (CSV/manual) | String? | Reference; **own column** (never merged into `sku`) |
| `category` | Grouping (Binder, Pigment…) | User | String? | Display / filter |
| `unit` | Default measure (KG, LTR…) | User | String? | Display |
| `standardPackaging` | e.g. "25 Kg Bag" | User | String? | Display / packing reference |
| `metadata` | Extra unmapped CSV columns | System | JSON? | Preserved for Phase 2 |
| `active` | Soft-delete flag | User | Boolean | Only active items are matched |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## PurchaseOrder — the document (one per uploaded/typed PO)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `poNumber` | Supplier PO/invoice number | PO / User | String? | Display, search |
| `supplier` | Vendor name | PO / User | String? | Copied onto each Material |
| `fileKey` | Storage key of the document (R2/disk) | System | String? | Null for manual (fileless) POs |
| `fileName` | Original filename | User | String? | Preview / download |
| `status` | `PO_UPLOADED`→`AI_EXTRACTED`→`OPERATOR_VERIFIED`→`REGISTERED` | System | Enum | Drives the review/confirm gate |
| `source` | `AI` \| `MANUAL` | System | Enum | How the data was produced |
| `extractedJson` | Raw Claude output | System | JSON? | Audit / debugging |
| `deliveryDate` | Stated delivery/due date | PO / User | DateTime? | Display |
| `uploadedById` | Who created it | System | UUID | Audit |
| `confirmedById` / `confirmedAt` | Who confirmed & when | System | UUID? / DateTime? | The hard gate (I1) |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## POLineItem — editable working set BEFORE confirmation (never auto-promoted, I1)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `poId` | Parent PO | System | UUID | Cascade-deleted with the PO |
| `materialName` | Material description | PO / User | String | Becomes each Material's name |
| `hsnCode` | HSN/SAC tax code | PO / User | String? | **Own column** (fixed post-demo; was wrongly under `sku`) |
| `sku` | Supplier item/product code | PO / User | String? | Match key; **never** the HSN or quantity |
| `quantity` | **Number of physical packages** (bags/drums) | PO / User | Int | One QR/Material created per unit on confirm |
| `unit` | Package type (Bag/Drum) or bulk measure | PO / User | String? | Display; carried to Material |
| `weight` | PO-stated weight **per package** (kg) | PO / User | Float? | Reference; carried to Material |
| `batchNumber` | Batch/lot number | PO / User | String? | **Kept in DB, hidden in UI** — see note below |
| `matchType` | `EXACT`\|`SIMILAR`\|`NONE` catalogue match | System | Enum | Informational only (I6) |
| `matchedCatalogueId` | Linked catalogue item | System | UUID? | Informational |
| `edited` | Operator changed this row | System | Boolean | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## Material — one row per physical unit, created on confirm (I3)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `uniqueId` | `MC-000001` sequential ID | System | String (unique) | Encoded in the QR; scanned at receiving |
| `poId` | Parent PO | System | UUID | — |
| `materialName` | Copied from the line item | System | String | Label + scan display |
| `sku` | Copied from the line item | System | String? | Label |
| `hsnCode` | Copied from the line item | System | String? | Label / Phase 2 reference |
| `supplier` | Copied from the PO | System | String? | Label |
| `batchNumber` | Copied from the line item | System | String? | Kept for Phase 2 traceability |
| `unit` | Copied from the line item | System | String? | Display |
| `weight` | PO-stated per-package weight | System | Float? | Reference (distinct from `receivedWeight`) |
| `status` | `REGISTERED`→`ARRIVED`→`SCANNED`→`WEIGHED`→`READY_FOR_PRODUCTION` | System | Enum | Receiving lifecycle |
| `receivedWeight` | Actual weight at receiving | User | Float? | Entered on scan; **Phase 2 weighing machine target** |
| `weighedById` / `weighedAt` | Who weighed & when | System | UUID? / DateTime? | Audit |
| `arrivedAt` / `scannedAt` | Lifecycle timestamps | System | DateTime? | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## QrCode — one per Material

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `materialId` | Owning material (unique) | System | UUID | 1:1 with Material |
| `payload` | JSON encoded in the QR (`uniqueId`, name, sku, hsnCode, supplier, poNumber, batch, date) | System | JSON | Read on scan |
| `imageRef` | Rendered QR PNG (data URL) | System | String? | Label rendering |
| `createdAt` | Timestamp | System | DateTime | — |

## Setting — encrypted key/value (Claude API key, I2)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `key` | e.g. `CLAUDE_API_KEY` (unique) | System | String | Lookup |
| `valueEncrypted` | AES-256-GCM ciphertext | System | String | Never returned to the frontend |
| `valueMasked` | e.g. `sk-ant-…x9f2` | System | String | Safe to display |
| `iv` / `authTag` | GCM nonce + tag | System | String | Decryption |
| `updatedById` / `updatedAt` / `createdAt` | Audit | System | — | — |

## AuditLog — append-only history (I4)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `entityType` / `entityId` | What was acted on | System | String | Trace |
| `action` | e.g. `AI_EXTRACTED`, `MATERIALS_REGISTERED`, `WEIGHT_ENTERED` | System | String | Trace |
| `actorId` | Who did it | System | UUID? | Trace |
| `beforeJson` / `afterJson` | State snapshots | System | JSON? | Corrections reference the original row |
| `device` | Source device | System | String? | Trace |
| `correctionOfId` | Points to a corrected row | System | UUID? | Corrections never mutate history |
| `createdAt` | Timestamp | System | DateTime | — |


## Material — Phase 2 additions

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `balanceKg` | **Live remaining stock (KG) on this unit** | System | Float? | Initialised to `receivedWeight` when the unit is weighed; updated in the same DB transaction as every ledger row, so balance and ledger can never drift. `null` = never weighed, and such units are blocked from all stock movement. |

> `arrivedAt` does double duty in Phase 2: it is the **FIFO basis** (oldest arrival is
> consumed first, tie-broken by `uniqueId`) and the **stock-ageing basis**
> (amber ≥ 30 days, red ≥ 60 days).

---

# Phase 2 — Requests & stock movement

## ProductionRequest — the request header

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `department` | Requesting department | System | Enum | **Forced** to the head's own department; a value sent by the client is ignored (I10) |
| `requestedById` | Head who raised it | System | UUID | Audit / display |
| `note` | Optional note or batch label | User | String? | Display |
| `status` | Overall status, **derived from the line mix** | System | Enum | `PENDING` → `IN_PROGRESS` (some lines actioned) → `APPROVED` / `PARTIAL` / `REJECTED` |
| `reviewedById` / `reviewedAt` | Store user who last actioned a line | System | UUID? / DateTime? | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## ProductionRequestItem — one material line (the unit of approval)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `requestId` | Parent request | System | UUID | Cascade-deleted with the request |
| `materialName` | Material requested | User (catalogue pick) | String | Verified against the scanned QR at issue time |
| `sku` / `catalogueItemId` | Catalogue reference | User | String? / String? | Match key |
| `requestedKg` | How much the head asked for | User | Float | Display |
| `status` | `PENDING` \| `APPROVED` \| `PARTIAL` \| `REJECTED` | Store | Enum | Set **per line**; drives the parent status |
| `approvedKg` | What Store approved (= requested, or lower for a partial) | Store | Float? | **Caps** how much may be issued against this line |
| `rejectionReason` | Why a line was rejected | Store | String? | Shown to the requesting head |
| `issuedKg` | Running total actually issued | System | Float | Incremented per verified scan; the line row is locked `FOR UPDATE` so concurrent scans cannot exceed `approvedKg` |
| `batchId` | **Phase 3 — which batch this line's material is for** | User | UUID? | Held per LINE, so one request can serve several batches. Nullable: pre-Phase-3 lines have none. |
| `reviewedAt` / `fulfilledAt` | Lifecycle timestamps | System | DateTime? | `fulfilledAt` stamps when `issuedKg` reaches `approvedKg` |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## StockTransaction — the append-only movement ledger (I4)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `materialId` | The physical unit that was scanned | System | UUID | — |
| `type` | `ADD` \| `DEDUCT` \| `DISCARD` | Store | Enum | Every scan offers all three |
| `quantityKg` | Amount moved (always > 0) | Store | Float | The **actual** amount issued, which may differ from the approved figure |
| `department` | To/from department | Store | Enum? | **Required** for ADD/DEDUCT; forced `null` for DISCARD |
| `requestItemId` | Linked request line (DEDUCT only) | System | UUID? | Null for a standalone scan |
| `actorId` | Store user who scanned | System | UUID | Audit |
| `balanceAfter` | Unit balance snapshot after this movement | System | Float | Lets the ledger be reconciled against `Material.balanceKg` |
| `note` | Free-text reason | Store | String? | e.g. spillage, returned unused |
| `createdAt` | Timestamp | System | DateTime | — |

> **Never updated or deleted.** The ledger row and `Material.balanceKg` are written in one
> DB transaction with the unit row locked `SELECT … FOR UPDATE`, so concurrent scans can
> never drive a unit negative (I11).

---

# Phase 3 — Batches, finished goods & dispatch

## Batch — the thread from raw materials to finished goods

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `batchNumber` | Human code typed by the head, e.g. `B-001` | User | String | **Unique per department** (`@@unique([department, batchNumber])`) — PU `B-001` and ENAMEL `B-001` may coexist |
| `department` | Owning department | System | Enum | Forced to the head's own (I10) |
| `status` | `OPEN` → `OUTPUT_RECORDED` → `CONFIRMED` → `CLOSED` | System | Enum | A top-up request against a CONFIRMED/CLOSED batch is **warned, not blocked** |
| `note` | Optional note | User | String? | Display |
| `createdById` | Head who opened it | System | UUID | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Picker sorts newest first |

> A batch is a **first-class record, not free text**, so a head can pick an existing batch
> for a top-up and the finished-goods → raw-material trace can never break on a typo.
> Consumption **accumulates**: a batch's total is the sum of everything issued against
> every line pointing at it, across all requests.

## ProductionOutput — what was actually produced (review gate)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `batchId` | Batch whose raw materials went in | User | UUID | Links input to output |
| `productName` | Finished product made | User | String | Printed on the FG label |
| `packageCount` | **Number of drums/packages produced** | User | Int | One FinishedGood + one QR minted per package (I3) |
| `sizePerPackage` | e.g. `20` | User | Float | Label |
| `sizeUnit` | `L` or `Kg` | User | String | Label |
| `productionDate` | When it was made | User | DateTime | Label / trace |
| `shade` | Colour / shade reference | User | String? | Label |
| `productSku` | Finished-goods catalogue code | User | String? | Label |
| `notes` | Anything unusual about the run | User | String? | Trace |
| `confirmed` | **The review gate** | User | Boolean | FG QRs cannot be generated until true; the record locks against edits on confirm |
| `confirmedById` / `confirmedAt` | Who confirmed & when | System | UUID? / DateTime? | Audit |
| `fgGeneratedAt` | When FG units were minted | System | DateTime? | **Guard against double-minting** — a second generate is rejected (I12) |
| `recordedById` | Head who entered it | System | UUID | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## FinishedGood — one row per physical drum (the FG counterpart of Material)

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `uniqueId` | `FG-000001` sequential ID | System | String (unique) | Minted from its **own Postgres sequence**, distinct from `MC-`, so a raw unit can never be mistaken for finished goods in a scan or a report |
| `outputId` | Parent output run | System | UUID | Trace |
| `batchId` | Batch it came from | System | UUID | Trace back to the raw materials consumed |
| `productName` / `sizePerPackage` / `sizeUnit` | Copied from the output | System | String / Float / String | Label + dispatch display |
| `status` | `GENERATED` → `READY` → `DISPATCHED` | System | Enum | Dispatch lifecycle |
| `dispatchedAt` / `dispatchedById` | When dispatched and by whom | System | DateTime? / UUID? | Set on the dispatch scan; a second dispatch of the same drum is rejected |
| `dispatchNote` | Free-text note at dispatch | Dispatch | String? | Audit |
| `createdAt` / `updatedAt` | Timestamps | System | DateTime | Audit |

## FinishedGoodQr — one per FinishedGood

| Field | Purpose | Source | Type | Workflow |
|---|---|---|---|---|
| `id` | Primary key | System | UUID | — |
| `finishedGoodId` | Owning FG unit (unique) | System | UUID | 1:1 with FinishedGood |
| `payload` | JSON encoded in the QR (`uniqueId`, productName, batch, department, size, shade, productSku, date, `kind: FINISHED_GOOD`) | System | JSON | Read on the dispatch scan |
| `imageRef` | Rendered QR PNG (data URL) | System | String? | Label rendering |
| `createdAt` | Timestamp | System | DateTime | — |

> Deliberately **separate** from `QrCode`, which is hard-bound to `Material` by a unique
> FK. Label rendering is shared: both go through `QrService.buildLabelRoll()` and print on
> the same 3×1.5in (216×108pt) one-label-per-page roll.

---

## Enum reference

| Enum | Values | Notes |
|---|---|---|
| `Role` | `ADMIN`, `SUPERVISOR`, `OPERATOR`, `OVERSIGHT`, `PRODUCTION_HEAD`, `DISPATCH` | `ADMIN` is labelled **Store** in the UI; `OVERSIGHT` is labelled **Admin** (view-only) |
| `Department` | `PU`, `ENAMEL`, `POWDER` | Set only on `PRODUCTION_HEAD` users; drives server-side isolation |
| `POStatus` | `PO_UPLOADED`, `AI_EXTRACTED`, `OPERATOR_VERIFIED`, `REGISTERED` | Document lifecycle |
| `MaterialStatus` | `REGISTERED`, `ARRIVED`, `SCANNED`, `WEIGHED`, `READY_FOR_PRODUCTION` | Per-unit receiving lifecycle |
| `MatchType` | `EXACT`, `SIMILAR`, `NONE` | Informational only — never blocks receiving (I6) |
| `RequestStatus` | `PENDING`, `IN_PROGRESS`, `APPROVED`, `PARTIAL`, `REJECTED` | `IN_PROGRESS` is **parent-only**; lines never carry it |
| `StockTxnType` | `ADD`, `DEDUCT`, `DISCARD` | `DISCARD` is department-less by design |
| `BatchStatus` | `OPEN`, `OUTPUT_RECORDED`, `CONFIRMED`, `CLOSED` | CONFIRMED/CLOSED → top-ups warn but proceed |
| `FgStatus` | `GENERATED`, `READY`, `DISPATCHED` | Per-drum dispatch lifecycle |

---

## Note — Batch column decision (post-demo item 9)

The **Batch** field was removed from all UI tables (PO review, labels) per the client's
request, **but the `batchNumber` column is intentionally retained** on `POLineItem` and
`Material` (and in the QR `payload`). Rationale: batch/lot tracking is a strong candidate
for production traceability, and dropping the column would lose data and force a rework.
It is simply not displayed or captured in the receiving UI. Re-surfacing it later is a
UI-only change — no migration required.

**Resolved in Phase 3:** batch tracking is now handled properly by the first-class
[Batch](#batch--the-thread-from-raw-materials-to-finished-goods) model rather than by this
free-text column. The supplier-side `batchNumber` above is still the supplier lot number
carried in from the invoice; the Phase 3 `Batch` is the factory’s own production batch.
The two are distinct and both are retained.

---

_Last updated: 2026-07-20 — Phase 3 (Finished Goods & Dispatch)._
