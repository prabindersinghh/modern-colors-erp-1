# Changelog

> **Document version:** 1.1
> **Last updated:** 2026-07-24
> **Describes:** Modern Colours ERP — Phases 1–3 complete and live, plus the analytics,
> handover, packing stage, Good Receipt Note + Gate-side minting, and Oversight sweep. All
> dates and times are taken from git commit history, not from memory.

Times are the commit timestamps in local (IST) time. Where a commit message described
intent, the entry below reflects what the diff actually changed.

---

## 24 July 2026 — Packing stage, Good Receipt Note, Gate-side minting, Oversight sweep

| Commit | Change |
|---|---|
| `eaa263f` | **Arrival time** on Gate's invoice upload (additive `PurchaseOrder.arrivedAt`). |
| `f47561a` | **Server-side scan-session gating** — a scan is refused outside an open Start/Done session (Receive Stock + Dispatch). |
| `8370a8a` | **Packing stage** — hardener (FGHD-) / thinner (FGTH-) families via a `family` discriminator, `Carton`/`CartonItem`, the **Packer** role. Behind `PACKING_STAGE` (created OFF). Live matrix 22/22. |
| `3627985` | **Arrival date/time locked** (server-stamped, immutable) + Store-login UI (catalogue "Quantity", min-only stock, dashboard 3-slips-with-see-all). |
| `4d35954` | **PG goods lists** — the packer composes one list of straights + combos; ONE confirm mints a PG- for every entry, one PDF prints all A5 labels. `PackingList` model. Live matrix 11/11. |
| `aabbc35` | **Receiving slip → Good Receipt Note** format (logo, GOOD RECEIPT NOTE, Supplier + Date of Receipt, Sr No / Material+code / Quantity / Pack Size / Unit Codes, Gate + Store signatures). Moving-strip tagline → "Colours That Lasts Forever". |
| `47bb966` | **Gate-side MC- minting (I1 relocated)** — the minting act moved from Store's confirm to the Gate's hand-over, so the GRN carries the codes (not "pending"). Store's confirm became an **accept** (additive `ReceivingSlip.acceptedAt`). Live matrix 18/18. |
| `8fae4d6` | **Oversight total-visibility sweep** — read-only OVERSIGHT across scan sessions, the packing desk/lists/cartons, GRN slips, arrival times, audit with unit ids. Zero new writes; **doors still exactly four**. |

Both operational flags (`STORE_INWARD_ACCESS`, `PACKING_STAGE`) remain **OFF**. Every
migration was additive and applied through the pre-deploy guard; every item was
live-verified on production before the next.

---

## 22 July 2026 — Labels print once; printing them again needs approval

| Commit | Change |
|---|---|
| `bc5755b` | **Reprint approvals — the lock** |

The owner asked for label generation to be a one-time act. Reading the code first
changed the shape of the fix: **minting already happened exactly once and was already
guarded** — `QrCode.materialId` is unique for raw material, and `fgGeneratedAt` returns
409 on a second finished-goods mint. What was unguarded was **printing**. Every label
route was a stateless `GET` that re-rendered the stored payload, and nothing anywhere
recorded that a print had happened.

So this is a lock on reprints, not a change to minting. `Material` and `FinishedGood`
each gained `labelPrintedAt`; the first print of any label set is free, silent, and
stamps every label in its scope. A later print needs an approved request carrying a
reason, and **the approval carries a quota** — the factory Admin says how many prints it
buys, each print spends one, and the request re-locks as `CONSUMED` when they are gone.

Approving is the **third named door** through Oversight's view-only rule, built like the
other two: its own controller, its own two-sided guard, no `@Roles` anywhere on it.
Store was the obvious alternative and is the wrong one — Store is itself the main printer
of raw-material labels, so letting Store approve would have made the commonest case
self-approval, and the lock would be decoration exactly where it is used most. Because
Oversight *can* print raw-material labels, self-approval is refused. The sweep in
`user-admin.spec.ts` now asserts the complete Oversight write surface is exactly three
doors, so a fourth cannot appear quietly.

All four raw-material export formats share **one** allowance: the CSV feeds label-design
software that prints the same stickers, so switching format is not a way round the lock.
A single unit's PNG is its own scope, so pulling one PNG does not lock a whole invoice —
but printing the roll stamps every unit, so pulling one afterwards is correctly a reprint.

A correction-driven reprint carries its own single-use allowance: `qrReprintNeeded` is set
only when a correction changed a printed field, which is an Oversight act in its own right,
and demanding a second approval to fix a label Oversight just invalidated would leave wrong
stickers on drums while someone waited. Clearing that flag now happens inside the same
transaction that records the print, so "flag cleared" and "print recorded" can no longer
disagree — previously they were separate writes.

> **Expect one free print per existing label this week.** Nothing was backfilled: every
> unit that existed before 22 July 2026 starts with `labelPrintedAt = NULL`, so each gets
> one more approval-free print and the lock bites from the *second*. This is deliberate —
> nothing in the data recorded whether a label had ever been printed, so any backfill would
> have been a guess that could block a genuine first print. It is not a bug, and it becomes
> moot after the handover flush, when every unit is new.

Reprints go through the **same** `buildLabelRoll` as first prints, never a copy, so the
216×108pt one-label-per-page geometry cannot drift between them.

---

## 21 July 2026 (evening) — The factory owner manages his own logins

| Time | Commit | Change |
|---|---|---|
| 18:16 | `28ad071` | **Admin can create production head and dispatch logins** |
| 21:58 | `26bc9f7` | Users tab made readable on a phone |
| 23:02 | `c4bafed` | Seeded logins labelled as such; renaming a login |

Until now every login came from a seed script, so adding a second PU head meant a
developer. The Admin (Oversight) can now create Production Head and Dispatch logins
himself, reset their passwords, and deactivate or reactivate them.

**This did not make Oversight a write role.** User management is a *second named door*,
built the same way as the FG correction door: its own controller, its own guard
(`UserAdminGuard`), `@AllowUserAdmin()` on each handler, and no `@Roles` anywhere on it.
`user-admin.spec.ts` sweeps every controller in the app and asserts that OVERSIGHT still
appears in no mutating `@Roles` list, and that the complete set of doors is exactly the
six user-admin handlers plus `FgCorrectionsController.correct`. Adding a seventh
mutating route for Oversight anywhere else fails that test.

What the server enforces, not just the form:

- **No escalation.** Only `PRODUCTION_HEAD` and `DISPATCH` can be minted. The pre-existing
  Store creation path accepted any role and was capped at the same time.
- **The domain is ours.** The form submits a local part only; the server appends
  `@moderncolours.local`. A smuggled `evil@gmail.com` is rejected by the charset rule.
- **Heads need a department; Dispatch is department-less by force**, whatever is posted.
- **Nothing is ever deleted.** Removing a login deactivates it, so its history stays
  attributed. Store and Admin logins cannot be deactivated at all — locking the factory
  out would be unrecoverable.
- **No password or hash is logged, returned, or written to the audit trail.** Tests
  assert the audit entry contains neither.

Multiple heads in one department **share that department's data and can continue each
other's batches**, while every action stays recorded under the individual login —
`multi-head.spec.ts` proves the scoping layer cannot tell a seeded head from a created
one, and `GET /analytics/my` breaks activity down per person.

**Seeded logins are now labelled.** The six accounts that came with the system
(`admin@`, `oversight@`, `pu@`, `enamel@`, `powder@`, `dispatch@`) looked exactly like
ones the owner creates himself. Each row in the Users tab now reads *"Came with the
system"* or *"Created by you"*, and a seeded login still on a published default password
is flagged so it gets reset or retired. The check is a bcrypt compare done server-side
against seeded accounts only — created logins cannot hold a default, because
`passwordProblem()` rejects `ChangeMe123!` at creation and at reset.

**Renaming** (`POST /admin/users/:id/rename`, audited as `USER_RENAMED`) changes the
display name and nothing else — never the email, role, department or active state — and
refuses the protected Store/Admin accounts like every other action on that door.
`pu2@moderncolours.local`, created while verifying the multi-head flow, was renamed to
*"TEST PU Login — not for production use"* and left deactivated: its history stays intact
and it remains the standing proof that department handover works.

---

## 21 July 2026 — Analytics for the owner and for Dispatch

| Time | Commit | Change |
|---|---|---|
| 00:14 | `114f1d8` | **Dispatch analytics + Company Brain factory-flow view** |
| 00:30 | `8db8edc` | **Company Brain becomes the Oversight landing view** |

**Dispatch analytics** (`GET /analytics/dispatch`) — dispatched-over-time, volume by
department, batches fully/partly/not dispatched, ready count and backlog with the oldest
waiting unit, and average time from FG generation to dispatch. Shared by the Dispatch
worker's own dashboard and the Admin view **from the same service**, so the two can never
disagree about how much left the factory. Scoped to finished goods at the data layer —
the service never queries raw stock, requests or Phase 1 tables.

**Company Brain** (`GET /analytics/flow`, Admin only) — a Sankey flow of
`raw received → issued per department → produced → dispatched / awaiting`, with a
date-range filter, click-through drill-down per stage, and conversion stats.

Two correctness decisions worth knowing:

- **Litres and kilograms are never summed.** Production reports both separately, and
  yield returns `null` rather than a wrong-but-confident number when output is in litres
  and input in kilograms. Three tests lock this.
- **The flow balances.** An early version showed 11 kg received but only 4 kg issued,
  silently implying everything that came in went out. A *"Still in store"* node now
  carries the remainder so every kilogram is accounted for.

**Graphify was evaluated and rejected** (the client asked). It is a Python CLI that turns
codebases into knowledge graphs for AI assistants — not a charting library, no React/TS
integration, and no Sankey support. recharts' `Sankey` was used instead: already a
dependency, so no bundle cost.

**3D was deliberately not built.** A Sankey encodes quantity as ribbon thickness;
perspective foreshortening distorts exactly that.

`dispatch-isolation.spec.ts` **failed** when DISPATCH was granted the analytics
controller. Rather than weaken it, it was tightened to assert DISPATCH reaches exactly
one route (`dispatchOverview`) and is still denied stock, store, department and flow
analytics.

---

## 20 July 2026 — The busiest day: UI overhaul, weighing removal, an outage, and handover prep

### Design system (01:12 → 11:45)

| Time | Commit | Change |
|---|---|---|
| 01:12 | `afae3d6` | Six client-feedback items (see below) |
| 01:35 | `0c214d6` | `phase1-access.spec.ts` — prove Phase 1 access survived DISPATCH gating |
| 01:50 | `cb788e6` | UPI-style continuous scan loop across all three scanning screens |
| 02:30 | `d4e4014` | Mobile: Stock Levels overflow fix + 44px touch targets |
| 02:42 | `6d4e1f3` | Docs brought current with Phase 3 |
| 02:53 | `3b53d36` | Requests: explain the empty batch dropdown |
| 04:03 | `76b0c13` | **Paint Chip design system** — tokens, motion, brand assets, 3 preview screens |
| 11:45 | `8f2fb5a` | **Paint Chip rollout** across every remaining screen |

**Paint Chip** is the design system (Option C from the design-options PDF): brand hues
sampled from the actual logo (red `#EB0102`, yellow `#FEEF03`, violet `#8802C9`), a warm
neutral ramp so white space reads as paper, a four-level severity language
(critical / warning / healthy / info), five warm-tinted elevation layers, and a motion
vocabulary of four easings and five durations. `prefers-reduced-motion` collapses
animation to an instant fade and **stops** continuous loops rather than cycling them at
0.01 ms.

At rollout, red was **demoted from `--primary` to an accent**. Using the brand red for
every default button made ordinary actions look like alarms and collided with the
critical severity level. Primary is now deep warm ink; red is reserved for the logo, the
active-nav rail, focus rings and genuine danger.

**Bugs found during the design work** — the kind a future maintainer needs to know were
already handled:

- **Inter was never actually loading.** It had been declared in `tailwind.config.js` for
  weeks but never imported, so the app silently rendered in `system-ui`. Now self-hosted
  via `@fontsource`.
- **`STATUS_COLOR` pointed at the categorical chart ramp**, whose hues moved with the new
  palette. "Partial" would have silently turned red and become indistinguishable from
  "Rejected". Now bound to the severity tokens.
- **Chrome autofill** forced a pale blue over inputs, overriding the design system for
  anyone with a saved password.
- **4 WCAG AA contrast failures**, only visible once measured: `chip-500` at 4.42:1, and
  `healthy` at 3.99:1 on its surface and 4.23:1 as a solid button. All 14 measured pairs
  now pass (worst 4.70:1).
- **13 touch targets under 44px** at 390px — sidebar nav at 40px, sign-out and tab
  triggers at 36px.
- **The CSS motion layer was silently dropped.** `@import './styles/motion.css'` was
  placed *after* the `@tailwind` directives; a CSS `@import` after any other rule is
  discarded by the parser, with no build error. Every animation was missing.
- **5 screens rendered an `<h1>` duplicating the title** the Navbar already showed.

### FG label 500 (13:21)

| Time | Commit | Change |
|---|---|---|
| 13:21 | `3a7e25a` | Fix 500 on finished-goods label generation |

`buildLabelRoll()` read `payload.materialName`, but FG payloads carry `productName`, so
**every FG label roll threw** and returned 500. It had been broken since Phase 3 shipped
and was invisible because the call site cast the payload with `as never`, silencing the
compiler error that would have caught it. Both payload shapes now flow through one
renderer, so the 3×1.5in geometry can never drift between them.

### Weighing removed from receiving (15:00 → 15:28)

| Time | Commit | Change |
|---|---|---|
| 15:00 | `8ecc000` | **Receiving: weighing removed, rapid-fire scanning, balance from the PO** |
| 15:28 | `b20e5f4` | **Scanner mode toggle** — camera vs external scanner |

The driving constraint: **a truckload can be ~2,500 sacks.** Scanning *and* weighing each
one took days. Weighing now happens only where the quantity genuinely matters —
Store → Production issue.

- A unit's opening `balanceKg` is seeded from the PO's per-package weight **at
  registration**, so units arrive already carrying stock.
- Units with no usable weight still register and scan, but are **blocked from issue** and
  surfaced in a **needs-weight queue**; the fix is one pack-weight entry *per PO line*
  (~5 per invoice) at Review & Confirm, not per sack.
- **A latent bug was fixed:** `weigh()` set `receivedWeight` but never `balanceKg`. Every
  live balance had come from a one-time backfill in the Phase 2 migration, so any unit
  weighed after that migration got a weight but no stock balance and was silently blocked
  from issue.

**Scanner mode toggle** — every scan screen can switch between the device camera and a
WiFi/USB 2D scanner, mid-run, remembered per device. In external mode the camera
component is **not rendered at all** rather than hidden: hiding it keeps the media track
open, which means an unrequested permission prompt and a flat battery by mid-shift.
Verified by instrumenting `getUserMedia` — 0 calls on all three screens.

### Extraction improvements (same work as above)

PO weight coverage was measured before building, not assumed:

| Measure | Before | After |
|---|---|---|
| PO line items with usable weight | 21/70 (30.0%) | 27/70 (38.6%) |
| **Units that would get a balance** | **54/274 (19.7%)** | **86/274 (31.4%)** |

The gap was real: three sample invoices showed why. **Rallison** states
`Pack Size 25 Kg/1 BAG` (extractable). **Vimal** states `Packing: 4 Drums x 25 Kgs` in a
free-text note — the weight is on the document but was extracted as `null`.
**P.K. Dyes** states `2,300.000 KG` with no pack size anywhere, and genuinely never will.

Fixes: `weight` became a **required** field in the extraction tool schema (the model was
omitting it), a `packingNote` field was added, and `derive-pack-weight.ts` was written as
a **deterministic fallback** that recovers the pack size from a packing note, a pack-size
column, the description text (`AEROSIL 200 (10KGS)` → 10), or total ÷ count. It is
conservative by design: 14 tests, including asserting it returns `null` for the P.K. Dyes
bulk case rather than inventing a number.

### Catalogue import (16:05)

| Time | Commit | Change |
|---|---|---|
| 16:05 | `51ba3d4` | Downloadable template + AI-assisted validation + partial import |

- **Template download** (CSV + Excel) with canonical headers and worked examples; one
  example deliberately leaves an optional field blank, because operators otherwise type
  `-` or `N/A` and those import as literal values.
- **AI validation** before commit, using the client's own Claude key. **Assistive, never a
  gate** — no key, timeout, bad response or a file over 200 rows all return the parsed
  rows plus deterministic flags so the import still works. Cost: **$0.007–$0.039** per
  run depending on file size; $0 when skipped or unavailable.
- **Editable preview + partial import** — fix flagged cells in place, select rows, import
  the good ones.
- **Bug found:** the parser did not skip `#` comment rows, so the template's own usage
  notes would have imported as materials named `"# HOW TO USE..."`.

### The R2 outage (16:37 → 22:50)

| Time | Commit | Change |
|---|---|---|
| 16:37 | `52ae1cf` | Storage: make failures diagnosable instead of an opaque 500 |
| 16:40 | `4170bbf` | Storage probe reports the raw R2 error code |
| 16:50 | `a7c56c4` | **Security:** require auth on the storage health probe |
| 22:40 | `142b009` | Extraction degrades to manual entry when storage is unavailable |
| 22:50 | `44df396` | **Security:** strip infrastructure identifiers from storage errors |

Invoice upload started returning `500 Internal server error` in production. Diagnosis
established that DB writes worked, non-storage reads worked, but **both** storage read
and write failed — so the fault was the storage backend, not the app. The root cause was
**Cloudflare R2 returning `AccessDenied` (403)**: the API token was valid but lacked
Object Read & Write on the bucket.

The real defect on our side was that **every storage error collapsed into a generic
500**, telling the storekeeper nothing. Storage errors now return **503 with a specific
cause** and tell the operator they can still enter the invoice manually.
`GET /health/storage?deep=1` runs a real write→read→compare round-trip.

**Two security regressions were introduced and fixed the same day** — both worth knowing:

1. The storage health probe shipped **public**. It disclosed the R2 endpoint host —
   which **embeds the Cloudflare account ID** — plus the bucket name and missing env
   vars, and its deep mode performed an R2 **write** on every call (an unauthenticated
   cost amplifier). Now `JwtAuthGuard + RolesGuard`, ADMIN/OVERSIGHT only, in its own
   controller so the public liveness route cannot inherit the guards and this one cannot
   lose them.
2. The **error messages themselves** embedded the endpoint host and bucket name. The
   extraction change then made it worse by writing that message **into the append-only
   audit log** and returning it to OPERATOR as well as ADMIN. Fixed at the source: the
   message now names only the failure *category*; identifiers stay in server logs and on
   the admin-gated probe.

Also fixed: a storage read failure during extraction threw `400 Bad Request` — implying
"your request was malformed, don't retry" for a transient outage — instead of returning
the `fallback: true` signal that routes the operator to manual entry per invariant I7.

**No files were lost in the outage.** All 22 PO records were reconciled against R2: 12
present (03 Jul → 20 Jul), 8 missing (24 Jun → 01 Jul, all pre-go-live disk-era test
files), **zero missing from the outage day**. `storage.put()` runs *before* the DB
insert, so a failure aborts with no orphaned record.

### Handover preparation (23:32)

| Time | Commit | Change |
|---|---|---|
| 23:32 | `35e0917` | Pack-weight backfill + guarded flush script (**not run**) |

160 of 165 blocked units were given derived opening balances. **5 are deliberately left
blocked** so the needs-weight queue and the blocking guard stay exercisable — two are the
genuine P.K. Dyes bulk lines, three are fixtures across Bag and Drum. `Material` has no
free-text field, so the reason for each is written to the audit trail
(`PACK_WEIGHT_UNAVAILABLE`).

`prisma/flush.ts` was **built and tested but never run**. See
[`HANDOVER.md`](./HANDOVER.md). A **delete-order bug was found while building it**:
`Batch` was scheduled before `ProductionRequestItem`, which references it. It happened to
work because the FK is `ON DELETE SET NULL`, but it relied on a referential action a
future schema change could flip to `RESTRICT`.

---

## 19 July 2026 — Phase 3: Finished Goods & Dispatch

| Time | Commit | Change |
|---|---|---|
| 21:52 | `f31dc74` | Phase 3 schema + additive migration |
| 23:20 | `df2349c` | Phase 3 Steps 2–8: batches, output, FG QRs, dispatch, traceability |

Migration `20260719161842_phase3_finished_goods_dispatch`, fully additive. Pre/post
snapshots proved existing data untouched: 171 materials, 400 audit rows, 6 units /
97.8 kg identical on both sides.

- **Batch is a first-class record**, unique per department, held on the request **line**
  so one request can serve several batches. Top-ups against a confirmed batch **warn
  rather than block**, and consumption accumulates.
- **Confirm gate (I12):** FG QRs cannot be minted until the production output is
  confirmed, and `fgGeneratedAt` makes a second generate a hard error — so a drum can
  never get two identities.
- **`FG-` has its own Postgres sequence**, separate from `MC-`.
- **New DISPATCH role** sees finished goods only — proven by `dispatch-isolation.spec.ts`
  across all non-FG controllers.
- **Full traceability:** `GET /batches/:id/trace` returns materials in (with source POs
  and suppliers) ↔ finished goods out.

**Security work done at the same time:** the material, dashboard, catalogue and
purchase-order controllers had **no class-level `@Roles`** — harmless before DISPATCH
existed, but it meant a new role would have reached them by default. Class-level gates
were added, and `phase1-access.spec.ts` (47 assertions, commit `0c214d6`) was written to
**prove Operator and Supervisor access was not broken** by that change.

### The six client-feedback items (20 July, 01:12, `afae3d6`)

| # | Item | What changed |
|---|---|---|
| 1 | "In-Hand Stock" rename | Terminology updated across the stock screens |
| 2 | Stock ageing display | Ageing tab + amber/red badges; amber ≥ 30 days, red ≥ 60 |
| 3 | **QR generation speed** | **100 labels: 8568 ms → 2555 ms (3.35×)**; PDF 1735 KB → 698 KB; ZIP 3580 → 1199 ms |
| 4 | Generate → Save → Print | Each step is now a deliberate action |
| 5 | Review-before-issue gate | Store reviews the line before the deduction commits |
| 6 | Actual quantity issued | The weighed amount is captured and may differ from the approved figure; both are kept |

The QR speed work was **profiled before optimising** (encode 2.0 s / embed 0.84 s / save
2.05 s), then: print resolution 512 → 256 px, bounded-parallel encoding, deduped embeds,
and `save({ objectsPerTick: 200, useObjectStreams: false })`. **Scannability was checked
numerically, not by eye:** 0.544 mm module at 4.2 px/module, both above scanner minimums.

---

## 13 July 2026 — FIFO and the 2600-QR bug

| Time | Commit | Change |
|---|---|---|
| 12:16 | `d1022fc` | **Fix: the 2600-QR bug** |
| 13:23 | `810c8ee` | No-Match SKUs → catalogue; provisional-SKU lifecycle |
| 18:47 | `0625aa2` | **FIFO stock consumption — soft, non-blocking** |

**The 2600-QR bug:** AI extraction put a bulk KG figure (2300, 300) into `quantity`,
which is a *package count* — so the system queued one label per kilogram. Fixed
**structurally**, not just in the prompt: a deterministic `BULK_UNITS` guard forces
`quantity = 1` when the unit is a bulk measure, so a future prompt regression cannot
reintroduce it.

**FIFO** was verified before design — `arrivedAt` was already 100% populated, so **no
migration was needed**. Deducting a newer unit while older stock exists **warns and
records a `FIFO_OVERRIDE` audit row; it never blocks**, because the floor sometimes has a
good reason.

---

## 9–10 July 2026 — Phase 2: Requests, issuing and stock

| Date/Time | Commit | Change |
|---|---|---|
| 09 Jul 16:36 | `0b67620` | Phase 2 schema + additive migration |
| 09 Jul 16:55 | `bd9bf27` | Idempotent role setup script |
| 09 Jul 21:29 | `e8c14ca` | Role auth + **server-side department isolation** |
| 09 Jul 22:02 | `c78e5a6` | Production-head request + scoped dashboard |
| 09 Jul 22:43 | `14c125c` | Multi-material requests (parent + line items) |
| 10 Jul 00:12 | `c06a497` | Store request inbox — per-line accept/partial/reject |
| 10 Jul 00:33 | `e0ba46f` | Scan & stock movement (Add/Deduct/Discard) |
| 10 Jul 11:44 | `23f1c91` | Live stock levels + **append-only movement ledger** |
| 10 Jul 12:44 | `de2c423` | Admin oversight dashboard |
| 10 Jul 12:47 | `1574958` | End-to-end UAT script |
| 10 Jul 13:38 | `6a5f0da` | Rich Admin analytics with charts + low-stock alerts |
| 10 Jul 14:11 | `d997ee3` | Store + Production Head dashboards |

The ledger row and `Material.balanceKg` are written in **one DB transaction with the unit
row locked `SELECT … FOR UPDATE`** — invariant I11. A later review found the same class
of race on `ProductionRequestItem.issuedKg` (two deducts against one line via different
units could both pass the approved cap); fixed by locking the request line inside the
transaction too.

---

## 3–7 July 2026 — Go-live and post-demo fixes

| Date/Time | Commit | Change |
|---|---|---|
| 03 Jul 01:40–10:51 | `b3b32ac`…`d252228` | **Going live**: Railway boot, Dockerfile, IPv6, env robustness |
| 04 Jul 12:40 | `17dfedb` | Priority 1 post-demo: PO field mapping, manual entry, preview, QR count, CSV import |
| 04 Jul 12:46 | `9b7148c` | Priority 2: S.No, weight column, batch removed from UI |
| 04 Jul 12:52 | `bafbdc6` | Priority 3: **3×1.5in QR sticker layout** |
| 04 Jul 19:32 | `e674645` | **Mobile-data resilience** (fixes mobile login failures) |
| 06 Jul 15:53 | `fe34a00` | Rename "PO / Purchase Order" → "Invoice" across the UI |
| 07 Jul 12:45 | `86c822b` | One 3×1.5in label per page for the label-roll printer |

**LIVE since 2026-07-03.** The go-live gotchas are documented in
[`DEPLOYMENT.md`](./DEPLOYMENT.md) and were hard-won:

- **Neon's pooled endpoint hangs `prisma migrate deploy`** — PgBouncer has no advisory
  locks, so migrations must use the direct host (`DIRECT_URL`).
- **Railway healthchecks are IPv6-only** while its public edge is IPv4; binding
  `0.0.0.0` passes the build but fails the healthcheck.
- **Environment variables must be staged before the deploy that reads them** — the app
  fails fast on missing secrets by design, so a premature deploy crash-loops and looks
  like a build problem.
- **The Jio mobile-data incident:** the app worked on office WiFi but appeared broken on
  Jio mobile data, presenting as a CORS error — which sent the first round of debugging
  to the wrong place. What actually mattered: `CORS_ORIGIN` must be the **exact** origin
  with **no trailing slash**; a Vercel preview deploy has a *different* origin; and a
  failed preflight on a flaky connection looks identical to a CORS misconfiguration. The
  API client now retries transient network failures rather than surfacing the first blip
  as a hard error.

---

## 20–27 June 2026 — Phase 1: Material inward

| Date/Time | Commit | Change |
|---|---|---|
| 20 Jun 15:58 | `a4e3299` | Initial frontend prototype |
| 24 Jun 05:44 | `314cb2a` | Monorepo restructure, living docs, NestJS + Prisma scaffold |
| 24 Jun 05:49 | `67776f8` | Excise Phase 2 from the active app; **switch DB to Neon** (drop Docker) |
| 24 Jun 05:59 | `713f900` | Auth + RBAC + audit foundation |
| 24 Jun 06:04 | `e12300a` | **Security:** fail-fast env validation, no hardcoded secret fallbacks |
| 24 Jun 14:44 | `07c0f9a` | Master Catalogue (import + CRUD + match) |
| 24 Jun 14:52 | `4e761ad` | Settings — encrypted Claude API key |
| 24 Jun 15:05 | `bbd773c` | PO upload + Claude AI extraction + manual fallback |
| 24 Jun 20:17 | `0697288` | Confirm gate, material + QR registration, receiving, dashboard |
| 26 Jun 05:10 | `c8bba70` | Frontend rebuild — wire Phase 1 screens to the API |
| 26 Jun 05:22 | `21ace7b` | Mobile: off-canvas sidebar, touch menus, modal gutters |
| 27 Jun 01:57 | `cc91228` | **Camera-first scanning** |

Security hardening throughout: PO filename sanitised against `Content-Disposition`
header injection (`0a8151a`), `poId` sanitised in the labels header (`f7b1a8c`),
dependency vulnerabilities patched and upload size capped (`f879cd4`), CSV export
hardened against formula injection (`186423b`).

---

## Test suite growth

Counts are from the commit that introduced them.

| Date | Tests | Suites | What was added |
|---|---|---|---|
| 2026-07-19 | 169 | 16 | Phase 3 complete |
| 2026-07-20 | 172 | 17 | FIFO ageing/severity contract |
| 2026-07-20 | 177 | 18 | FG label regression (the 500) |
| 2026-07-20 | 210 | 21 | Weighing removal, opening balance |
| 2026-07-20 | 227 | 23 | Catalogue template + AI validation |
| 2026-07-20 | 236 | 24 | Storage failure handling |
| 2026-07-20 | 239 | 25 | Health endpoint access control |
| 2026-07-20 | 244 | 26 | Extraction degradation |
| 2026-07-20 | 245 | 26 | Storage identifier-leak guard |
| 2026-07-20 | 253 | 27 | Flush plan validation |
| 2026-07-21 | **261** | **28** | Dispatch analytics + flow correctness |

---

## Still open

- **UI/UX**: the Paint Chip system is fully rolled out. The tagline and design option
  were chosen; nothing is blocked.
- **Client click-through on real hardware** — the camera scan loop on a phone, the WiFi
  2D scanner, and label printing on the actual label printer at exactly 3×1.5in. No test
  can prove these.
- **The handover flush** has been built and dry-run tested but **never executed**. See
  [`HANDOVER.md`](./HANDOVER.md).
- **Catalogue decision at handover:** is the Master Catalogue demo data, or the factory's
  real ~500–600 SKUs? This decides the `--flush-catalogue` flag.
