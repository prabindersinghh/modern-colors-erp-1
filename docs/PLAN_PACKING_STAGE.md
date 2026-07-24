# Plan — Packing stage: hardener, thinner, cartons, and the Packer role

> **Status:** ✅ IMPLEMENTED & LIVE (2026-07-24). Delivered across commits `8370a8a`
> (families/cartons/Packer), `7f27d1e` (post-commit read fix) and `4d35954` (PG goods
> lists). Live matrices green (packing 22/22, PG lists 11/11). `PACKING_STAGE` created OFF.
> **Prepared:** 2026-07-22, verified against the live code at commit `88fcec3`.
> **Every claim about current behaviour below was read from the code, not recalled.**
> This batch runs AFTER the Gate sidebar fix + slip download already deployed.

---

## 0. What the code actually does today (verified)

The feature threads through five subsystems; here is what each one really is now, so the
plan below is additive rather than a rewrite.

- **Minting** — `FinishedGoodsService.generate()` is the confirm-gated mint (I12). It
  requires `output.confirmed`, refuses twice via `output.fgGeneratedAt`, and loops
  `output.packageCount` times pulling `nextval('finished_good_unique_seq')`, creating a
  `FinishedGood` + `FinishedGoodQr` each, all in one transaction. **This is the exact
  shape the two new families copy.**
- **`FgStatus`** has five values: `GENERATED, READY, DISPATCHED, SCRAPPED, REFURBISHED`.
  **`READY` is dead** — nothing writes it; dispatch reads `{ in: [GENERATED, READY] }` so
  it tolerates the value but nothing produces it. Documented as a known no-op.
- **Dispatch** — `dispatchUnit()` locks the row `FOR UPDATE`, rejects a non-FG code,
  throws `ConflictException` if already `DISPATCHED`, else sets `DISPATCHED` + who/when,
  audited `FG_DISPATCHED`. `dispatchBatch()` bulk-shifts a batch. `ready()` lists
  `{ in: [GENERATED, READY] }` grouped by batch. **This is the double-scan pattern the
  carton scans copy verbatim.**
- **Returns** — `scrap()` / `refurbish()` lock `FOR UPDATE`, require status `DISPATCHED`,
  and set `SCRAPPED` (terminal) or `REFURBISHED` (mints a replacement via
  `refurbishedFromId`). Returns act on a **dispatched unit**.
- **Trace** — `BatchService.trace()` walks batch → requestItems → issues → units → PO
  (`po: { poNumber, supplier }`). It is keyed on the **batch**, so it already reaches
  everything; packing extends it, never replaces it.
- **Reprint lock** — `LabelScope` enum = `PO_LABELS, MC_UNIT_LABEL, FG_OUTPUT_LABELS,
  FG_UNIT_LABEL`. The lock keys a print scope to a target id.
- **Named doors** — there are **FOUR** today: `@AllowCorrection`, `@AllowUserAdmin`,
  `@AllowReprintApproval`, `@AllowAccessFlip`. `user-admin.spec.ts` asserts the exact set.
- **Roles** — 7: ADMIN, SUPERVISOR, OPERATOR, OVERSIGHT, PRODUCTION_HEAD, DISPATCH,
  REVIEWER. Packer is the 8th.
- **Flush** — `DELETE_ORDER` lists FinishedGoodQr, FinishedGood…; `sequences` resets
  `material_unique_seq, finished_good_unique_seq, receiving_slip_seq`;
  `flush-plan.spec.ts` derives the model list from the schema and fails on an unaccounted
  model.

**One correction to the brief's framing:** hardener and thinner are described as "real
produced units, not attributes" — agreed, and they will be `FinishedGood` rows. But they
are NOT finished *paint*, so putting them in the same table needs a discriminator (see
§2, `family`) rather than blending them into FG counts everywhere. That is the single
biggest design decision and I flag it up front.

---

## 1. Role addition — PACKER (the 8th role)

`ALTER TYPE "Role" ADD VALUE 'PACKER'`. UI label "Packer". Home = his packing desk.

Server-side surface (a new `PackingController`, `@Roles(Role.PACKER)` + ADMIN/OVERSIGHT
read-through where useful):

| Packer can | Packer cannot |
|---|---|
| List the under-packing pool (units he may pack) | Raw stock, requests, batches, invoices, slips |
| Scan FG/FGHD/FGTH → `UNDER_PACKING` | Mint FG (that stays the production head's confirm) |
| Compose + confirm packed-goods lists → mint PG | Users, settings, analytics, dispatch |
| Print PG labels | Edit a confirmed carton |
| Scan PG → `PACKED` | Dispatch (that stays DISPATCH) |

Isolation asserted the same way REVIEWER's is: a controller-sweep spec proving PACKER
appears on no route outside the packing surface, and holds no named door.

---

## 2. Schema diff + migration SQL (additive only)

### 2.1 The two new FG families — a discriminator, not two tables

Hardener and thinner are physically the same shape as an FG unit (a produced package with
a QR, a status, a dispatch/return lifecycle). Reusing `FinishedGood` avoids duplicating
the entire status machine, dispatch lock, returns and trace three times. They are told
apart by a new column:

```sql
CREATE TYPE "FgFamily" AS ENUM ('FINISHED_GOOD', 'HARDENER', 'THINNER');
ALTER TABLE "FinishedGood" ADD COLUMN "family" "FgFamily" NOT NULL DEFAULT 'FINISHED_GOOD';
```

The default backfills every existing row as `FINISHED_GOOD` — no data rewrite, and every
existing query keeps its meaning. `uniqueId` prefix encodes the same fact for humans:
`FG-`, `FGHD-`, `FGTH-`, each its own sequence:

```sql
CREATE SEQUENCE IF NOT EXISTS finished_good_hardener_seq START 1;
CREATE SEQUENCE IF NOT EXISTS finished_good_thinner_seq  START 1;
```

The hardener/thinner quantities the head records live on the output as counts (they are
produced *alongside* the FG line, from the same output):

```sql
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerCount"  INTEGER NOT NULL DEFAULT 0;
-- Their own pack size/unit — see Q9a. Nullable: an output may make no hardener.
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerSize" DOUBLE PRECISION;
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerUnit" TEXT;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerSize"  DOUBLE PRECISION;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerUnit"  TEXT;
```

### 2.2 The carton (packed goods)

```sql
CREATE TYPE "CartonStatus" AS ENUM ('DRAFT', 'PACKED', 'DISPATCHED', 'VOIDED');

CREATE TABLE "Carton" (
    "id"            TEXT           NOT NULL,
    "uniqueId"      TEXT           NOT NULL,   -- "PG-000001", own sequence
    "status"        "CartonStatus" NOT NULL DEFAULT 'DRAFT',
    "packedById"    TEXT           NOT NULL,
    "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt"   TIMESTAMP(3),               -- when PG- minted; contents frozen
    "packedAt"      TIMESTAMP(3),               -- when scanned PACKED
    "dispatchedAt"  TIMESTAMP(3),
    "dispatchedById" TEXT,
    "voidedAt"      TIMESTAMP(3),
    "voidedById"    TEXT,
    "voidReason"    TEXT,
    "note"          TEXT,
    CONSTRAINT "Carton_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Carton_uniqueId_key" ON "Carton"("uniqueId");
CREATE INDEX "Carton_status_idx" ON "Carton"("status");

-- Contents. A join row per unit. The UNIQUE on finishedGoodId is invariant #6:
-- a unit can be in exactly one carton, enforced by CONSTRAINT not convention.
CREATE TABLE "CartonItem" (
    "id"             TEXT NOT NULL,
    "cartonId"       TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    CONSTRAINT "CartonItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartonItem_finishedGoodId_key" ON "CartonItem"("finishedGoodId");
CREATE INDEX "CartonItem_cartonId_idx" ON "CartonItem"("cartonId");

ALTER TABLE "Carton" ADD CONSTRAINT "Carton_packedById_fkey"
    FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "Carton" ADD CONSTRAINT "Carton_dispatchedById_fkey"
    FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "Carton" ADD CONSTRAINT "Carton_voidedById_fkey"
    FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "CartonItem" ADD CONSTRAINT "CartonItem_cartonId_fkey"
    FOREIGN KEY ("cartonId") REFERENCES "Carton"("id") ON DELETE CASCADE;
ALTER TABLE "CartonItem" ADD CONSTRAINT "CartonItem_finishedGoodId_fkey"
    FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT;

CREATE SEQUENCE IF NOT EXISTS carton_unique_seq START 1;
```

**The `CartonItem.finishedGoodId` UNIQUE is the load-bearing constraint** — it makes
"a unit cannot be in two cartons" a database fact. A voided carton must therefore *release*
its items (delete the CartonItem rows) so they can be repacked — see §4.

### 2.3 New FgStatus values

```sql
ALTER TYPE "FgStatus" ADD VALUE 'UNDER_PACKING' BEFORE 'DISPATCHED';
ALTER TYPE "FgStatus" ADD VALUE 'PACKED' BEFORE 'DISPATCHED';
```

### 2.4 Reprint scope + the flag

```sql
ALTER TYPE "LabelScope" ADD VALUE 'FG_OUTPUT_ALL_FAMILIES'; -- the 3-family print run
ALTER TYPE "LabelScope" ADD VALUE 'CARTON_LABEL';           -- one PG mega label
-- Cutover flag; SystemFlag already exists (the STORE_INWARD_ACCESS pattern).
-- No DDL — a row created lazily on first write.
```

---

## 3. Status lifecycle (the full state machine)

### 3.1 FG / FGHD / FGTH unit

```
                 (mint at confirm)
                        │
                        ▼
   ┌──────────────► GENERATED ──────────────────────────────┐
   │                    │                                    │  (flag OFF: legacy direct
   │         packer scans unit                               │   dispatch still allowed —
   │                    ▼                                    │   grandfather path)
   │              UNDER_PACKING                              │
   │                    │                                    ▼
   │         carton confirmed + scanned PACKED          DISPATCHED
   │                    ▼                                    │
   │                 PACKED                          returns: scrap/refurbish
   │                    │                                    ▼
   │         dispatch scans the PG mega QR          SCRAPPED / REFURBISHED
   │                    ▼
   │              DISPATCHED  (carton + all contents together)
   │                    │
   │            returns as today
   └────────────────────┘
```

- **`GENERATED → UNDER_PACKING`**: packer scans the unit in. Double-scan guarded
  (`FOR UPDATE`, reject if already past GENERATED).
- **`UNDER_PACKING → PACKED`**: set when the carton it belongs to is scanned PACKED — the
  unit is not individually scanned to PACKED, the carton is, and its contents follow.
- **`PACKED → DISPATCHED`**: dispatch scans the PG mega QR; the carton and every content
  unit go DISPATCHED in one transaction.
- **`SCRAPPED / REFURBISHED`**: unchanged, still only from `DISPATCHED`.
- **`READY`**: stays dead. I will NOT repurpose it — reusing a dead value for a live
  meaning is exactly the kind of ambiguity the codebase avoids. Documented again.

### 3.2 Carton

```
DRAFT ──confirm(mint PG)──► PACKED-list built, PG minted, contents FROZEN
  │                                    │
  │                          packer scans PG ▼
  │                              (contents → PACKED)
  │                                    │
  │                          dispatch scans PG ▼
  └──void (only DRAFT)──► VOIDED    DISPATCHED
```

Wait — correction: a carton's PG mints **at confirm**, and confirm is the freeze. So the
"scan PG → PACKED" step happens on an already-confirmed carton. Precise lifecycle:

- **DRAFT**: packer is composing; contents mutable; no PG yet.
- **confirm**: hard gate (mirrors output confirm). PG- mints, contents become immutable,
  status stays logically "confirmed" — represented as PACKED-pending. To keep one status
  column honest I use `confirmedAt` for the freeze and the `status` enum for the physical
  milestone. So after confirm status is still effectively pre-scan; the **PACKED** enum
  value is set when the packer scans the PG. `DRAFT → (confirmedAt set) → PACKED (scan) →
  DISPATCHED (dispatch scan)`.
- **void**: allowed only before confirm (DRAFT) OR as an explicit post-confirm void that
  releases contents (see §4). A dispatched carton cannot be voided.
- **Double-dispatch**: `Carton.status = DISPATCHED` checked under `FOR UPDATE`; a second
  scan throws, exactly like `dispatchUnit` today.

---

## 4. Void / repack mechanics (brief item 4)

The requirement: contents immutable after confirm; a wrong carton is voided and repacked,
never edited. Proposed mechanics:

- **Before confirm** (DRAFT): edit freely — add/remove CartonItem rows. No PG exists yet,
  so nothing printed can disagree.
- **After confirm, before dispatch**: the carton is frozen. To fix it the packer **voids**
  it: `status → VOIDED`, `voidedReason` required, audited `CARTON_VOIDED`. Voiding
  **deletes the CartonItem rows** (releasing each unit's UNIQUE lock) and sets each
  content unit back to `UNDER_PACKING`. The PG- id is retired forever (never reused). The
  packer then builds a fresh carton with a new PG-. The printed mega QR of a voided carton,
  if scanned, resolves to a VOIDED carton and dispatch refuses it.
- **After dispatch**: no void. That is a return (Q9c).

This gives the invariant its teeth: a printed PG label can never describe different
contents than the record, because contents are frozen at the same instant the PG is
minted, and the only way to change them is to abandon that PG entirely.

---

## 5. Endpoint map

### 5.1 Production output (head) — extend, not replace

- `POST /production-output` and its confirm: gain optional `hardenerCount/Size/Unit`,
  `thinnerCount/Size/Unit`. Existing outputs keep working (defaults 0/null).
- `POST /finished-goods/generate/:outputId` (the confirm mint): now mints **three
  families** in one transaction — FG × packageCount, FGHD × hardenerCount, FGTH ×
  thinnerCount — each from its own sequence, each with a QR. `fgGeneratedAt` still guards
  the whole lot. One label run prints all three (same `buildLabelRoll`, 216×108pt).

### 5.2 Packing (new `PackingController`, `@Roles(PACKER)` + ADMIN/OVERSIGHT read)

| Method | Route | Purpose |
|---|---|---|
| GET | `/packing/pool` | Units in GENERATED/UNDER_PACKING available to pack |
| POST | `/packing/scan-in` | Scan a unit → UNDER_PACKING (double-scan guarded) |
| GET | `/packing/cartons` | His cartons, by state |
| POST | `/packing/cartons` | Start a DRAFT carton |
| POST | `/packing/cartons/:id/items` | Add a unit (DRAFT only) |
| DELETE | `/packing/cartons/:id/items/:fgId` | Remove a unit (DRAFT only) |
| POST | `/packing/cartons/:id/confirm` | **Hard gate**: mint PG, freeze contents |
| POST | `/packing/cartons/:id/void` | Void + release contents (with reason) |
| GET | `/packing/cartons/:id/labels.pdf` | PG mega label (via buildLabelRoll / new carton format — Q9d) |
| POST | `/packing/cartons/:id/mark-packed` | Scan PG → carton + contents PACKED |

### 5.3 Dispatch — flag-gated additions

- `GET /finished-goods/dispatch/cartons` (new): PG cards when the flag is ON.
- `POST /finished-goods/dispatch/scan-carton` (new): scan PG → carton + contents
  DISPATCHED, one transaction, double-scan guarded.
- Existing `dispatch/scan` (direct FG): **stays**, but when the flag is ON it refuses a
  unit whose status is PACKED ("dispatch the carton, not the drum") and still allows a
  grandfathered GENERATED unit (§8).

### 5.4 Public scan resolve (the mega QR reveal)

- `GET /packing/carton/:uniqueId` (PACKER, DISPATCH, ADMIN, OVERSIGHT): scanning a PG
  reveals exact contents — FG/FGHD/FGTH unit ids, product names, batch.

### 5.5 Reprint approval

The reprint lock gains `FG_OUTPUT_ALL_FAMILIES` (the 3-family run keyed on outputId) and
`CARTON_LABEL` (keyed on cartonId). Oversight still approves; **no new named door** — the
approval door already exists and covers any scope.

---

## 6. Traceability (item 7)

Trace is batch-keyed and already walks to the invoice, so it keeps working untouched for
pre-packing history. Two additions, both additive:

- **PG forward**: `GET /packing/carton/:uniqueId` → contents → each unit's `outputId` /
  `batchId` → existing trace. Hardener/thinner units carry the same `batchId`/`outputId`
  as the FG line of that output, so they trace to the same batch automatically.
- **Unit backward**: a `FinishedGood` gains an optional `cartonItem` relation, so
  `GET /finished-goods/unit/:uniqueId` can show "packed in PG-000012, dispatched".

`GET /batches/:id/trace` is not modified.

---

## 7. Cutover (item 8) — coexistence, nobody stranded

`SystemFlag` key `PACKING_STAGE` (`on`/`off`, default `off`), same pattern as the flip.
**Fifth named door** if Oversight controls it — my recommendation: **yes**, Oversight
owns it via `@AllowAccessFlip` (the SAME door — it already governs a flag; it can govern
this one, so the door COUNT stays 4). I will state this explicitly in the sweep: the door
set is unchanged, one decorator now guards two flag keys.

- **OFF (today)**: dispatch scans FG drums directly. Packing routes exist but the pool is
  empty of intent; nothing forces packing.
- **ON**: dispatch's home shows PG cards; direct FG scan refuses a PACKED unit.
- **Grandfathering**: pre-existing `GENERATED` FG units when the flag flips ON remain
  **directly dispatchable** — `dispatch/scan` still accepts a GENERATED unit regardless of
  flag. Only PACKED units require the carton path. So no finished good is ever
  undispatchable: old stock ships the old way, new stock flows through packing. The packer
  can also straight-pass a single GENERATED unit into a 1-item carton if the factory wants
  everything uniform, but it is not forced.

Reversible in seconds, both directions audited, exactly like STORE_INWARD_ACCESS.

---

## 8. Flush + sequences

`DELETE_ORDER` gains, in FK-safe order (children first):
`CartonItem` → `Carton`, both **before** `FinishedGood` (CartonItem references
FinishedGood; Carton references User which is preserved). Sequences reset:
`finished_good_hardener_seq`, `finished_good_thinner_seq`, `carton_unique_seq` added
alongside the existing three. `flush-plan.spec.ts` will fail until Carton + CartonItem are
accounted for — that is the mechanism working, and I will make it pass rather than suppress
it.

---

## 9. Open questions — answered with recommendations

**Q9a — hardener/thinner units & the kg/L rule.** *Recommendation:* they get their own
pack size + unit on the output (litres is typical for thinner, kg or L for hardener),
stored in the new nullable columns. The never-blend rule already operates per-line via
`measure`; the slip and any aggregate treat FGHD/FGTH lines with their own unit, so no new
blend context is introduced — it is the same rule applied to two more line kinds. **No
total ever sums across families or units.**

**Q9b — FGHD/FGTH in analytics/ageing/Company Brain.** *Recommendation:* shown, as
**separate lines**, never folded into the FG paint count. `dispatch-analytics` and Company
Brain gain a family breakdown; FG ageing lists each family separately. The risk otherwise
is "500 finished goods" silently meaning 300 paint + 100 hardener + 100 thinner, which
misreads the factory. I will add family to those group-bys and keep FG-only headline
numbers labelled "finished paint".

**Q9c — returns of a dispatched carton.** *Recommendation, minimal correct:* returns stay
**per unit**, because scrap/refurbish already operate on a dispatched unit and a returned
item is physically one drum, not a carton. A whole-carton return is sugar over "scrap each
content unit". So: dispatch a carton → its units are DISPATCHED → an individual unit can be
scrapped/refurbished exactly as today. I will NOT build whole-carton return in v1; the
data supports it later (the CartonItem link survives dispatch) without a migration.

**Q9d — mega QR label geometry.** *Recommendation:* a **second fixed format**, larger —
an A5 carton label, because it must list multiple unit ids and a scannable mega QR, which
does not fit 216×108pt. This is its own spec (`buildCartonLabel`), NEVER a change to
`buildLabelRoll`, whose 216×108pt geometry is invariant. The existing label roll is
untouched; the carton label is a new renderer like `slip-pdf.ts`.

**Q9e (I add this) — what does the packer scan a unit FROM?** A unit is minted GENERATED
at the head's confirm. Between confirm and packing it physically sits in the factory. The
packer scans its existing FG/FGHD/FGTH QR — no new sticker at scan-in; UNDER_PACKING is a
status change, not a reprint. Only the CARTON gets a new PG sticker.

**Q9f (I add this) — combo composition freedom.** Per the brief, do not hard-enforce
1+1+1. A carton is any non-empty set of UNDER_PACKING units the packer chooses; the
mega QR records exactly what he put in. The only constraints are: every item must be his
own UNDER_PACKING unit, and no item already in another carton (the UNIQUE handles the
second).

---

## 10. Test plan

- **Mint**: confirm mints all three families from three sequences; `fgGeneratedAt` still
  blocks a second run; zero hardener/thinner still mints FG cleanly.
- **Packing isolation**: a controller-sweep spec asserting PACKER reaches only the packing
  surface and holds no door (modelled on `reviewer-isolation.spec.ts`).
- **Carton invariants**: a unit cannot join two cartons (UNIQUE), a confirmed carton
  cannot be edited, a dispatched carton cannot be dispatched or voided twice — each
  asserted at the service against the constraint.
- **Void/repack**: void releases items to UNDER_PACKING, retires the PG, a new carton gets
  a fresh PG.
- **Lifecycle**: GENERATED→UNDER_PACKING→PACKED→DISPATCHED transitions; grandfathered
  GENERATED still dispatches directly with the flag ON.
- **Flag**: PACKING_STAGE OFF = today's behaviour byte-for-byte; ON = PG cards + PACKED
  units refused on direct scan; both audited.
- **Door sweep**: explicitly assert the door set is STILL the four existing doors (the
  flag reuses `@AllowAccessFlip`), so the count does not silently change.
- **Flush**: `flush-plan.spec.ts` passes with Carton/CartonItem + three sequences.
- **Never-blend**: a mixed kg/L family set asserts no summed total across families/units.
- **Trace**: PG → contents → batch → invoice, both directions; `/batches/:id/trace`
  unchanged.

## 11. Cutover sequence (build order)

1. Backup (schema snapshot, row counts, full `FinishedGood` + `ProductionOutput` export —
   the tables the migration alters; new tables start empty).
2. Migration through the pre-deploy guard (host confirmed ap-southeast-1 non-pooled).
3. Backend: family mint, packing service/controller, carton lifecycle, flag, trace, label
   renderer, all specs — exit-code verified.
4. Frontend: packer desk, dispatch PG cards (flag-aware, degrade on old API), head output
   hardener/thinner inputs.
5. Seed `packer@` (idempotent, seeded=true, default-password flagged).
6. Deploy; state the skew window.
7. Live matrix end-to-end on production BEFORE reporting done (item 10's full chain).
8. PACKING_STAGE stays OFF until you say flip — same discipline as STORE_INWARD_ACCESS.

---

## 12. What changes to the door-sweep count — stated explicitly

**No change.** Four named doors before, four after. `PACKING_STAGE` is governed by the
existing `@AllowAccessFlip` door, which already exists to flip an operational flag and is
not specific to one flag key. The sweep spec will be updated to assert both flag keys
route through that one door, and that the door *set* is unchanged — so a fifth door
appearing later still fails the test.

---

## 13. Open decisions I need from you before building

1. **Reuse `FinishedGood` with a `family` discriminator (§2.1)** — recommended — vs three
   separate tables. Everything above assumes reuse. This is the one hard-to-reverse call.
2. **Q9c**: per-unit returns only in v1 (recommended), or whole-carton return now?
3. **Q9d**: A5 carton label as a second fixed format (recommended) — confirm the geometry
   is yours to pick, or give me exact dimensions.
4. **PACKING_STAGE via the existing access-flip door (door count stays 4)** — recommended
   — vs a dedicated fifth door. 
5. Anything in §9 you'd answer differently.

Nothing is built. On approval I start at §11.1 (backup) and proceed in order.

---

## 14. APPROVED (2026-07-22) — decisions locked

All five §13 decisions **YES** as recommended: (1) reuse `FinishedGood` + `family`
discriminator; (2) per-unit returns in v1, whole-carton return deferred (CartonItem link
survives dispatch, so future-migration-free); (3) A5 `buildCartonLabel`, never touching
`buildLabelRoll`, must print on a plain A4 office printer (A5-on-A4 acceptable); (4)
`PACKING_STAGE` through the existing `@AllowAccessFlip` door — **door count stays four**,
sweep asserts both flag keys route through it; (5) §9 answers accepted incl. Q9e (no new
sticker at scan-in) and Q9f (no hard 1+1+1; record what was packed).

**Two gaps to close in the build (both verified against code):**

- **Gap A — dispatch must positively require GENERATED/READY, flag-independent.**
  `dispatchUnit()` today only refuses `DISPATCHED`. It must also refuse `UNDER_PACKING`
  and `PACKED` with a 409 naming the state, **regardless of PACKING_STAGE**, so a unit a
  packer has scanned into an in-progress carton cannot ship out from under him. Test:
  direct scan of an UNDER_PACKING unit → 409, flag ON and OFF.

- **Gap B — refurbish must copy `family`.** Verified `returns.service.ts:112-148`:
  `refurbish()` hardcodes `nextval(FG_SEQ)`, `formatFgId`, and `kind: 'FINISHED_GOOD'`.
  A returned FGHD/FGTH replacement must mint from the matching sequence with the matching
  family and prefix. Test per family.

**Sequencing:** this batch starts AFTER the four-item doc batch (arrival time, short QR,
start-session, Store tabs) ships — one deployable stream at a time.

**Live matrix (§11.7) additionally ends with a void/repack cycle:** confirm carton → void
with reason → contents released to UNDER_PACKING → repack into a fresh PG → the voided PG
scanned → refused with the VOIDED message.

**Flip discipline:** PACKING_STAGE stays OFF after deploy; flip only on explicit word.
The two flags are separate acts — `STORE_INWARD_ACCESS` and `PACKING_STAGE` — never flip
one on an instruction meant for the other.
